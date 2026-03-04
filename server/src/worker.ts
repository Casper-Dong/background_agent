import { Job as BullJob } from "bullmq";
import { config } from "./config";
import { createWorker, JobPayload } from "./queue";
import { getJob, updateJob, appendLog, createArtifact, getJobLogs, pool } from "./db";
import {
  launchSandbox,
  waitForSandbox,
  removeSandbox,
  cleanupStaleSandboxes,
} from "./services/sandbox";
import { getRepoCloneUrl, generateBranchName, createPullRequest, getPublicRepoUrl } from "./services/github";
import * as slack from "./services/slack";
import { logBus } from "./services/logs";

console.log("[worker] Starting worker...");

// ── Periodic cleanup of stale sandboxes ────────────────

setInterval(() => {
  cleanupStaleSandboxes().catch((err) =>
    console.error("[worker] Cleanup error:", err.message)
  );
}, 10 * 60 * 1000); // Every 10 minutes

// ── Main job processor ─────────────────────────────────

const worker = createWorker(async (bullJob: BullJob<JobPayload>) => {
  const { jobId } = bullJob.data;
  console.log(`[worker] Processing job ${jobId}`);

  const job = await getJob(jobId);
  if (!job) {
    console.error(`[worker] Job ${jobId} not found`);
    return;
  }

  if (job.status === "cancelled") {
    console.log(`[worker] Job ${jobId} was cancelled, skipping`);
    return;
  }

  let containerId: string | undefined;
  let branch: string | undefined;

  try {
    // ── 1. Mark as running ───────────────────────────────

    await updateJob(jobId, { status: "running", started_at: new Date() });
    await log(jobId, "Job started", "info", "system");

    // Notify Slack
    if (job.slack_channel) {
      try {
        const threadTs = await slack.postMessage({
          channel: job.slack_channel,
          thread_ts: job.slack_thread_ts || undefined,
          ...slack.formatJobProgress(0, job.max_iterations, "Starting sandbox..."),
        });
        if (!job.slack_thread_ts && threadTs) {
          await updateJob(jobId, { slack_thread_ts: threadTs });
        }
      } catch (err: any) {
        console.warn("[worker] Slack notification failed:", err.message);
      }
    }

    // ── 2. Prepare branch ────────────────────────────────

    branch = generateBranchName(jobId);
    await updateJob(jobId, { branch });
    await log(jobId, `Branch: ${branch}`, "info", "system");

    // ── 3. Launch sandbox ────────────────────────────────

    const repoCloneUrl = await getRepoCloneUrl();
    await log(jobId, "Launching sandbox container...", "info", "system");
    const maxLaunchAttempts = 3;
    let cId: string | undefined;
    for (let attempt = 1; attempt <= maxLaunchAttempts; attempt++) {
      try {
        const launched = await launchSandbox(
          {
            jobId,
            task: job.task,
            repoCloneUrl,
            branch,
            baseBranch: job.base_branch,
            agentType: job.agent_type,
            maxIterations: job.max_iterations,
            timeoutSeconds: job.timeout_seconds,
          },
          // onLog callback — store in DB and broadcast via logBus
          (line, source) => {
            const logEntry = {
              level: "info",
              message: line,
              source,
              ts: new Date(),
            };
            appendLog(jobId, line, "info", source).catch(() => {});
            logBus.publish(jobId, logEntry);
          }
        );
        cId = launched.containerId;
        break;
      } catch (err: any) {
        const transient = isTransientDockerLaunchError(err);
        if (!transient || attempt === maxLaunchAttempts) {
          throw err;
        }
        await log(
          jobId,
          `Sandbox launch failed (attempt ${attempt}/${maxLaunchAttempts}): ${err.message}. Retrying...`,
          "warn",
          "system"
        );
        await sleep(1500 * attempt);
      }
    }
    if (!cId) throw new Error("Sandbox launch failed after retries");

    containerId = cId;
    await updateJob(jobId, { container_id: containerId });
    await log(jobId, `Sandbox container: ${containerId.slice(0, 12)}`, "info", "system");

    // ── 4. Wait for sandbox to complete ──────────────────

    const result = await waitForSandbox(containerId, job.timeout_seconds);

    await log(jobId, `Sandbox exited with code ${result.exitCode}`, "info", "system");

    // Store artifacts
    if (result.diffSummary) {
      await createArtifact({
        job_id: jobId,
        type: "diff",
        name: "Changes diff",
        content: result.diffSummary,
      });
    }
    if (result.testOutput) {
      await createArtifact({
        job_id: jobId,
        type: "test_output",
        name: "Test output",
        content: result.testOutput,
      });
    }

    await updateJob(jobId, {
      diff_summary: result.diffSummary || null,
      test_output: result.testOutput || null,
    });

    // ── 5. Handle result ─────────────────────────────────

    if (result.exitCode === 0) {
      // Success — create PR
      await updateJob(jobId, { status: "verifying" });
      await log(jobId, "Sandbox succeeded, creating PR...", "info", "system");

      let prUrl: string | null = null;
      let prNumber: number | null = null;

      if (config.GITHUB_TOKEN && config.GITHUB_OWNER && config.GITHUB_REPO) {
        try {
          const pr = await createPullRequest({
            title: `[Agent] ${job.task.slice(0, 72)}`,
            body: formatPrBody(job.task, jobId, result.diffSummary, result.testOutput),
            head: branch,
            base: job.base_branch,
          });
          prUrl = pr.url;
          prNumber = pr.number;
          await log(jobId, `PR created: ${prUrl}`, "info", "system");
        } catch (err: any) {
          await log(jobId, `PR creation failed: ${err.message}`, "warn", "system");
          // Not fatal — sandbox already pushed the branch
        }
      } else {
        await log(jobId, "GitHub not configured, skipping PR creation", "warn", "system");
      }

      await updateJob(jobId, {
        status: "succeeded",
        completed_at: new Date(),
        pr_url: prUrl,
        pr_number: prNumber,
      });

      await log(jobId, "Job completed successfully", "info", "system");

      // Notify Slack
      await notifySlackCompletion(job, "succeeded", prUrl);
      await appendExecutionSummary({
        jobId,
        task: job.task,
        agentType: job.agent_type,
        maxIterations: job.max_iterations,
        status: "succeeded",
        branch,
        prUrl,
        diffSummary: result.diffSummary,
        testOutput: result.testOutput,
      });

    } else {
      // Failure
      const errorMsg = result.error || `Sandbox exited with code ${result.exitCode}`;
      await updateJob(jobId, {
        status: "failed",
        completed_at: new Date(),
        error: errorMsg,
      });
      await log(jobId, `Job failed: ${errorMsg}`, "error", "system");

      await notifySlackCompletion(job, "failed", null, errorMsg);
      await appendExecutionSummary({
        jobId,
        task: job.task,
        agentType: job.agent_type,
        maxIterations: job.max_iterations,
        status: "failed",
        branch,
        error: errorMsg,
        diffSummary: result.diffSummary,
        testOutput: result.testOutput,
      });
    }

    // Signal SSE clients that the job is done
    logBus.emit(`job:${jobId}:done`, { status: (await getJob(jobId))?.status });

  } catch (err: any) {
    console.error(`[worker] Error processing job ${jobId}:`, err);

    await updateJob(jobId, {
      status: "failed",
      completed_at: new Date(),
      error: err.message,
    });
    await log(jobId, `Worker error: ${err.message}`, "error", "system");

    await notifySlackCompletion(job, "failed", null, err.message);
    await appendExecutionSummary({
      jobId,
      task: job.task,
      agentType: job.agent_type,
      maxIterations: job.max_iterations,
      status: "failed",
      branch,
      error: err.message,
    });
    logBus.emit(`job:${jobId}:done`, { status: "failed" });

  } finally {
    // Clean up sandbox container
    if (containerId) {
      await removeSandbox(containerId).catch((err) =>
        console.warn("[worker] Failed to remove sandbox:", err.message)
      );
    }
  }
});

// ── Helpers ────────────────────────────────────────────

async function log(jobId: string, message: string, level: string, source: string) {
  await appendLog(jobId, message, level, source);
  logBus.publish(jobId, { level, message, source, ts: new Date() });
}

async function notifySlackCompletion(
  job: any,
  status: string,
  prUrl?: string | null,
  error?: string | null
) {
  if (!job.slack_channel) return;
  try {
    await slack.postMessage({
      channel: job.slack_channel,
      thread_ts: job.slack_thread_ts || undefined,
      ...slack.formatJobCompleted({
        jobId: job.id,
        task: job.task,
        status,
        prUrl,
        error,
        webUrl: config.API_URL.replace(":3001", ":1259"),
      }),
    });
  } catch (err: any) {
    console.warn("[worker] Slack notification failed:", err.message);
  }
}

async function appendExecutionSummary(params: {
  jobId: string;
  task: string;
  agentType: string;
  maxIterations: number;
  status: "succeeded" | "failed" | "cancelled";
  branch?: string | null;
  prUrl?: string | null;
  error?: string | null;
  diffSummary?: string | null;
  testOutput?: string | null;
}) {
  try {
    const logs = await getJobLogs(params.jobId, 0, 10000);
    const summary = buildExecutionSummary(params, logs);
    await log(
      params.jobId,
      summary,
      params.status === "succeeded" ? "info" : "warn",
      "system"
    );
    await createArtifact({
      job_id: params.jobId,
      type: "summary",
      name: "Execution summary",
      content: summary,
    });
  } catch (err: any) {
    console.warn(`[worker] Failed to append execution summary for ${params.jobId}:`, err.message);
  }
}

function buildExecutionSummary(
  params: {
    task: string;
    agentType: string;
    maxIterations: number;
    status: "succeeded" | "failed" | "cancelled";
    branch?: string | null;
    prUrl?: string | null;
    error?: string | null;
    diffSummary?: string | null;
    testOutput?: string | null;
  },
  logs: Array<{ message: string }>
): string {
  const normalized = logs.map((entry) => normalizeLogLine(entry.message));
  const includes = (pattern: RegExp) => normalized.some((line) => pattern.test(line));
  const retryCount = normalized.filter((line) => /retrying/i.test(line)).length;
  const maxIterationSeen = normalized.reduce((max, line) => {
    const match = line.match(/===\s*Iteration\s+(\d+)\s*\/\s*(\d+)\s*===/i);
    if (!match) return max;
    return Math.max(max, Number(match[1]) || 0);
  }, 0);

  const actionChecks = [
    { label: "Started sandbox environment", done: includes(/launching sandbox container|sandbox container:/i) },
    { label: "Cloned repository and created branch", done: includes(/cloning repo|creating branch|switched to a new branch/i) },
    { label: `Ran ${params.agentType} to implement changes`, done: includes(/running agent|running claude|running opencode|running openai codex|mock agent/i) },
    { label: "Ran verification loop", done: includes(/running verify\.sh|running verification|\[verify\]/i) },
    { label: "Committed changes", done: includes(/committing changes|\[[^\]]+\]\s+agent:/i) },
    { label: "Pushed branch", done: includes(/pushing branch|push complete|new branch/i) },
    { label: "Opened pull request", done: Boolean(params.prUrl) || includes(/pr created:/i) },
  ];

  const plan = [
    `1. Prepare an isolated sandbox and branch for the task.`,
    `2. Run ${params.agentType} in iterative passes (up to ${params.maxIterations}).`,
    `3. Execute verify.sh after each pass and fix issues until checks pass or attempts are exhausted.`,
    `4. Commit/push the branch and create a PR when verification succeeds.`,
  ];

  const performed = actionChecks.map((step) => `- [${step.done ? "x" : " "}] ${step.label}`);
  const verificationStatus = deriveVerificationStatus(params.testOutput, normalized);
  const diffHeadline = extractDiffHeadline(params.diffSummary);
  const safeError = params.error ? params.error.replace(/\s+/g, " ").trim().slice(0, 500) : "";

  const outcome: string[] = [
    `- Status: ${params.status}`,
    `- Branch: ${params.branch || "n/a"}`,
    `- Iterations used: ${maxIterationSeen || "n/a"} / ${params.maxIterations}`,
    `- Verification: ${verificationStatus}`,
  ];
  if (params.prUrl) outcome.push(`- PR: ${params.prUrl}`);
  if (diffHeadline) outcome.push(`- Diff: ${diffHeadline}`);
  if (retryCount > 0) outcome.push(`- Launch retries: ${retryCount}`);
  if (safeError) outcome.push(`- Error: ${safeError}`);

  return [
    "Execution summary",
    `Task: ${params.task}`,
    "",
    "Planned approach:",
    ...plan,
    "",
    "What was done:",
    ...performed,
    "",
    "Outcome:",
    ...outcome,
  ].join("\n");
}

function normalizeLogLine(message: string): string {
  let text = message.trim();
  const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s+/;
  while (timestamp.test(text)) {
    text = text.replace(timestamp, "");
  }
  return text;
}

function extractDiffHeadline(diffSummary?: string | null): string {
  if (!diffSummary) return "";
  const lines = diffSummary
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== "---");
  if (lines.length === 0) return "";
  return lines[0];
}

function deriveVerificationStatus(
  testOutput: string | null | undefined,
  normalizedLogs: string[]
): string {
  const combined = `${testOutput || ""}\n${normalizedLogs.join("\n")}`;
  if (/all checks passed|verification passed|exit code:\s*0/i.test(combined)) {
    return "passed";
  }
  if (/verification failed|fail:|test failures|exit code:\s*[1-9]/i.test(combined)) {
    return "failed";
  }
  return "unknown";
}

function formatPrBody(
  task: string,
  jobId: string,
  diffSummary?: string,
  testOutput?: string
): string {
  let body = `## Task\n\n${task}\n\n`;
  body += `> Generated by Background Agent (job \`${jobId.slice(0, 8)}\`)\n\n`;

  if (diffSummary) {
    body += `## Changes\n\n\`\`\`\n${diffSummary.slice(0, 3000)}\n\`\`\`\n\n`;
  }

  if (testOutput) {
    body += `<details><summary>Test output</summary>\n\n\`\`\`\n${testOutput.slice(0, 5000)}\n\`\`\`\n\n</details>\n\n`;
  }

  body += `---\n*Automated by [Background Agent]*`;
  return body;
}

function isTransientDockerLaunchError(err: any): boolean {
  const message = String(err?.message || "").toLowerCase();
  return (
    message.includes("socket hang up") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("timed out") ||
    (message.includes("no such container") && message.includes("page not found"))
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Graceful shutdown ──────────────────────────────────

async function shutdown() {
  console.log("[worker] Shutting down...");
  await worker.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log("[worker] Ready, waiting for jobs...");
