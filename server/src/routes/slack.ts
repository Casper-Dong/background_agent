import { Router, Request, Response } from "express";
import crypto from "crypto";
import { config } from "../config";
import { createJob, updateJob } from "../db";
import { jobQueue } from "../queue";
import * as slackService from "../services/slack";

export const slackRouter = Router();

// ── Slack signature verification middleware ─────────────

function verifySlackSignature(req: Request, res: Response, next: Function) {
  if (!config.SLACK_SIGNING_SECRET) {
    // Skip verification in development without Slack config
    return next();
  }

  const timestamp = req.headers["x-slack-request-timestamp"] as string;
  const signature = req.headers["x-slack-signature"] as string;

  if (!timestamp || !signature) {
    return res.status(401).json({ error: "Missing Slack signature headers" });
  }

  // Reject requests older than 5 minutes
  const fiveMinAgo = Math.floor(Date.now() / 1000) - 300;
  if (parseInt(timestamp) < fiveMinAgo) {
    return res.status(401).json({ error: "Request too old" });
  }

  const rawBody = (req as any).rawBody;
  if (!rawBody) {
    return res.status(401).json({ error: "Cannot verify signature without raw body" });
  }

  const sigBasestring = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto.createHmac("sha256", config.SLACK_SIGNING_SECRET);
  const computed = `v0=${hmac.update(sigBasestring).digest("hex")}`;

  if (!crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature))) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  next();
}

// ── POST /api/slack/commands — Slash command handler ───

slackRouter.post("/commands", verifySlackSignature, async (req: Request, res: Response) => {
  try {
    const { command, text, user_id, user_name, channel_id, response_url } = req.body;

    if (command !== "/inspect") {
      return res.json({ response_type: "ephemeral", text: `Unknown command: ${command}` });
    }

    if (!text || !text.trim()) {
      return res.json({
        response_type: "ephemeral",
        text: "Usage: `/inspect <task description>`\nExample: `/inspect Fix the flaky test in auth.test.ts`",
      });
    }

    const task = text.trim();

    // Respond immediately (Slack requires response within 3s)
    res.json({
      response_type: "in_channel",
      text: `:hourglass: Starting agent job: ${task}`,
    });

    // Create job asynchronously
    setImmediate(async () => {
      try {
        const job = await createJob({
          task,
          slack_channel: channel_id,
          created_by: user_name || user_id,
        });

        // Best-effort Slack thread bootstrapping. Job creation/queue should
        // still succeed even if chat:write scope isn't installed yet.
        const threadTs = await slackService.postMessage({
          channel: channel_id,
          ...slackService.formatJobStarted(
            job.id,
            task,
            config.API_URL.replace(":3001", ":1259")
          ),
        });

        if (threadTs) {
          await updateJob(job.id, { slack_thread_ts: threadTs });
        }

        await jobQueue.add("run-agent", { jobId: job.id }, { jobId: job.id });
      } catch (err) {
        console.error("[slack] Error creating job from command:", err);
      }
    });
  } catch (err) {
    console.error("[slack] Error handling command:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ── POST /api/slack/interactions — Button/action handler

slackRouter.post("/interactions", verifySlackSignature, async (req: Request, res: Response) => {
  try {
    const payload = JSON.parse(req.body.payload || "{}");
    // Handle interactive components (e.g., cancel button) in future
    res.json({ text: "Acknowledged" });
  } catch (err) {
    console.error("[slack] Error handling interaction:", err);
    res.status(500).json({ error: "Internal error" });
  }
});
