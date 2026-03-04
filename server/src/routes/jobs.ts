import { Router, Request, Response } from "express";
import { z } from "zod";
import { createJob, getJob, listJobs, getJobLogs, getArtifacts, updateJob } from "../db";
import { jobQueue } from "../queue";
import { logBus } from "../services/logs";
import { stopSandbox } from "../services/sandbox";
import { config } from "../config";

export const jobsRouter = Router();

// ── POST /api/jobs — Create a new job ──────────────────

const createJobSchema = z.object({
  task: z.string().min(1).max(10000),
  agent_type: z.enum(["claude-code", "codex", "opencode", "mock", "auto"]).optional(),
  max_iterations: z.number().int().min(1).max(20).optional(),
  timeout_seconds: z.number().int().min(60).max(7200).optional(),
  base_branch: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

jobsRouter.post("/", async (req: Request, res: Response) => {
  try {
    const body = createJobSchema.parse(req.body);
    const job = await createJob({
      ...body,
      agent_type: body.agent_type === "auto" ? undefined : body.agent_type,
    });

    // Enqueue for worker
    await jobQueue.add("run-agent", { jobId: job.id }, {
      jobId: job.id,
    });

    res.status(201).json(job);
  } catch (err: any) {
    if (err.name === "ZodError") {
      res.status(400).json({ error: "Invalid input", details: err.errors });
    } else {
      console.error("[api] Error creating job:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// ── GET /api/jobs — List jobs ──────────────────────────

jobsRouter.get("/", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Number(req.query.offset) || 0;
    const jobs = await listJobs(limit, offset);
    res.json(jobs);
  } catch (err) {
    console.error("[api] Error listing jobs:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/jobs/:id — Get a job ──────────────────────

jobsRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found" });

    const artifacts = await getArtifacts(job.id);
    res.json({ ...job, artifacts });
  } catch (err) {
    console.error("[api] Error getting job:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/jobs/:id/cancel — Cancel a running job ───

jobsRouter.post("/:id/cancel", async (req: Request, res: Response) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found" });

    if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") {
      return res.status(400).json({ error: `Job is already ${job.status}` });
    }

    // Stop sandbox container if running
    if (job.container_id) {
      try {
        await stopSandbox(job.container_id);
      } catch (err: any) {
        console.warn("[api] Failed to stop sandbox:", err.message);
      }
    }

    const updated = await updateJob(job.id, {
      status: "cancelled",
      completed_at: new Date(),
      error: "Cancelled by user",
    });

    res.json(updated);
  } catch (err) {
    console.error("[api] Error cancelling job:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/jobs/:id/logs — Get logs (SSE or JSON) ────

jobsRouter.get("/:id/logs", async (req: Request, res: Response) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found" });

    const acceptsSSE = req.headers.accept?.includes("text/event-stream");

    if (!acceptsSSE) {
      // Return logs as JSON
      const afterId = Number(req.query.after) || 0;
      const logs = await getJobLogs(job.id, afterId);
      return res.json(logs);
    }

    // SSE streaming
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",  // Disable nginx buffering
    });

    // Send existing logs first
    const existingLogs = await getJobLogs(job.id, 0, 10000);
    for (const log of existingLogs) {
      res.write(`data: ${JSON.stringify(log)}\n\n`);
    }

    // If job is already done, close
    if (["succeeded", "failed", "cancelled"].includes(job.status)) {
      res.write(`event: done\ndata: ${JSON.stringify({ status: job.status })}\n\n`);
      res.end();
      return;
    }

    // Subscribe to live logs
    const unsubscribe = logBus.subscribe(job.id, (log) => {
      res.write(`data: ${JSON.stringify(log)}\n\n`);
    });

    // Listen for job completion
    const onDone = (data: any) => {
      res.write(`event: done\ndata: ${JSON.stringify(data)}\n\n`);
      cleanup();
      res.end();
    };
    logBus.on(`job:${job.id}:done`, onDone);

    const cleanup = () => {
      unsubscribe();
      logBus.off(`job:${job.id}:done`, onDone);
    };

    req.on("close", cleanup);
    req.on("error", cleanup);
  } catch (err) {
    console.error("[api] Error streaming logs:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});
