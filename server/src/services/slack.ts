import { WebClient } from "@slack/web-api";
import { config } from "../config";

let client: WebClient | null = null;

function getClient(): WebClient | null {
  if (!config.SLACK_BOT_TOKEN) return null;
  if (!client) {
    client = new WebClient(config.SLACK_BOT_TOKEN);
  }
  return client;
}

export async function postMessage(params: {
  channel: string;
  text: string;
  thread_ts?: string;
  blocks?: unknown[];
}): Promise<string | undefined> {
  const slack = getClient();
  if (!slack) {
    console.log("[slack] Bot token not set, skipping message:", params.text);
    return undefined;
  }

  try {
    const result = await slack.chat.postMessage({
      channel: params.channel,
      text: params.text,
      thread_ts: params.thread_ts,
      blocks: params.blocks as any,
      unfurl_links: false,
    });
    return result.ts;
  } catch (err: any) {
    console.warn("[slack] chat.postMessage failed:", err?.data?.error || err.message);
    return undefined;
  }
}

export async function updateMessage(params: {
  channel: string;
  ts: string;
  text: string;
  blocks?: unknown[];
}): Promise<void> {
  const slack = getClient();
  if (!slack) return;

  try {
    await slack.chat.update({
      channel: params.channel,
      ts: params.ts,
      text: params.text,
      blocks: params.blocks as any,
    });
  } catch (err: any) {
    console.warn("[slack] chat.update failed:", err?.data?.error || err.message);
  }
}

export function formatJobStarted(jobId: string, task: string, webUrl: string): {
  text: string;
  blocks: unknown[];
} {
  const text = `Agent job started: ${task}`;
  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Agent Job Started* :gear:\n>${task}`,
      },
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `Job ID: \`${jobId.slice(0, 8)}\`` },
        { type: "mrkdwn", text: `<${webUrl}/jobs/${jobId}|View logs>` },
      ],
    },
  ];
  return { text, blocks };
}

export function formatJobProgress(iteration: number, maxIterations: number, status: string): {
  text: string;
  blocks: unknown[];
} {
  const text = `Iteration ${iteration}/${maxIterations}: ${status}`;
  const blocks = [
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `:arrows_counterclockwise: Iteration ${iteration}/${maxIterations} — ${status}` },
      ],
    },
  ];
  return { text, blocks };
}

export function formatJobCompleted(params: {
  jobId: string;
  task: string;
  status: string;
  prUrl?: string | null;
  error?: string | null;
  webUrl: string;
}): { text: string; blocks: unknown[] } {
  const icon = params.status === "succeeded" ? ":white_check_mark:" : ":x:";
  const statusText = params.status === "succeeded" ? "Succeeded" : "Failed";
  const text = `Agent job ${statusText.toLowerCase()}: ${params.task}`;

  const fields: unknown[] = [
    { type: "mrkdwn", text: `*Status:* ${icon} ${statusText}` },
  ];
  if (params.prUrl) {
    fields.push({ type: "mrkdwn", text: `*PR:* <${params.prUrl}|Open PR>` });
  }
  if (params.error) {
    fields.push({ type: "mrkdwn", text: `*Error:* ${params.error.slice(0, 200)}` });
  }

  const blocks = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Agent Job ${statusText}* ${icon}\n>${params.task}` },
    },
    {
      type: "section",
      fields,
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `<${params.webUrl}/jobs/${params.jobId}|View full details>` },
      ],
    },
  ];
  return { text, blocks };
}

export function isConfigured(): boolean {
  return !!config.SLACK_BOT_TOKEN;
}
