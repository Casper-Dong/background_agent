import { Pool, PoolClient } from "pg";
import { config } from "./config";

export const pool = new Pool({
  host: config.POSTGRES_HOST,
  port: config.POSTGRES_PORT,
  database: config.POSTGRES_DB,
  user: config.POSTGRES_USER,
  password: config.POSTGRES_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30_000,
});

pool.on("error", (err) => {
  console.error("[db] Unexpected pool error:", err.message);
});

// ── Job helpers ────────────────────────────────────────

export interface Job {
  id: string;
  task: string;
  status: string;
  repo_url: string;
  branch: string | null;
  base_branch: string;
  pr_url: string | null;
  pr_number: number | null;
  agent_type: string;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  container_id: string | null;
  iteration: number;
  max_iterations: number;
  timeout_seconds: number;
  error: string | null;
  diff_summary: string | null;
  test_output: string | null;
  slack_channel: string | null;
  slack_thread_ts: string | null;
  created_by: string | null;
  metadata: Record<string, unknown>;
}

export interface JobLog {
  id: number;
  job_id: string;
  ts: Date;
  level: string;
  message: string;
  source: string;
}

export interface Artifact {
  id: string;
  job_id: string;
  type: string;
  name: string;
  content: string | null;
  url: string | null;
  created_at: Date;
}

export async function createJob(params: {
  task: string;
  repo_url?: string;
  agent_type?: string;
  max_iterations?: number;
  timeout_seconds?: number;
  slack_channel?: string;
  slack_thread_ts?: string;
  created_by?: string;
  base_branch?: string;
  metadata?: Record<string, unknown>;
}): Promise<Job> {
  const { rows } = await pool.query<Job>(
    `INSERT INTO jobs (task, repo_url, agent_type, max_iterations, timeout_seconds,
                       slack_channel, slack_thread_ts, created_by, base_branch, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      params.task,
      params.repo_url || `https://github.com/${config.GITHUB_OWNER}/${config.GITHUB_REPO}.git`,
      params.agent_type || config.AGENT_TYPE,
      params.max_iterations || config.SANDBOX_MAX_ITERATIONS,
      params.timeout_seconds || config.SANDBOX_TIMEOUT_SECONDS,
      params.slack_channel || null,
      params.slack_thread_ts || null,
      params.created_by || null,
      params.base_branch || config.GITHUB_DEFAULT_BRANCH,
      JSON.stringify(params.metadata || {}),
    ]
  );
  return rows[0];
}

export async function getJob(id: string): Promise<Job | null> {
  const { rows } = await pool.query<Job>("SELECT * FROM jobs WHERE id = $1", [id]);
  return rows[0] || null;
}

export async function listJobs(limit = 50, offset = 0): Promise<Job[]> {
  const { rows } = await pool.query<Job>(
    "SELECT * FROM jobs ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    [limit, offset]
  );
  return rows;
}

export async function updateJob(
  id: string,
  updates: Partial<Pick<Job, "status" | "branch" | "pr_url" | "pr_number" | "container_id" |
    "iteration" | "error" | "diff_summary" | "test_output" | "started_at" | "completed_at" |
    "slack_thread_ts">>
): Promise<Job | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      setClauses.push(`${key} = $${paramIdx}`);
      values.push(value);
      paramIdx++;
    }
  }
  if (setClauses.length === 0) return getJob(id);

  values.push(id);
  const { rows } = await pool.query<Job>(
    `UPDATE jobs SET ${setClauses.join(", ")} WHERE id = $${paramIdx} RETURNING *`,
    values
  );
  return rows[0] || null;
}

export async function appendLog(
  jobId: string,
  message: string,
  level = "info",
  source = "system"
): Promise<void> {
  // Redact common secret patterns
  const redacted = redactSecrets(message);
  await pool.query(
    "INSERT INTO job_logs (job_id, message, level, source) VALUES ($1, $2, $3, $4)",
    [jobId, redacted, level, source]
  );
}

export async function getJobLogs(
  jobId: string,
  afterId = 0,
  limit = 500
): Promise<JobLog[]> {
  const { rows } = await pool.query<JobLog>(
    "SELECT * FROM job_logs WHERE job_id = $1 AND id > $2 ORDER BY id ASC LIMIT $3",
    [jobId, afterId, limit]
  );
  return rows;
}

export async function createArtifact(params: {
  job_id: string;
  type: string;
  name: string;
  content?: string;
  url?: string;
}): Promise<Artifact> {
  const { rows } = await pool.query<Artifact>(
    `INSERT INTO artifacts (job_id, type, name, content, url)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [params.job_id, params.type, params.name, params.content || null, params.url || null]
  );
  return rows[0];
}

export async function getArtifacts(jobId: string): Promise<Artifact[]> {
  const { rows } = await pool.query<Artifact>(
    "SELECT * FROM artifacts WHERE job_id = $1 ORDER BY created_at ASC",
    [jobId]
  );
  return rows;
}

// ── Secret redaction ───────────────────────────────────

const SECRET_PATTERNS = [
  /ghp_[A-Za-z0-9_]{36,}/g,
  /gho_[A-Za-z0-9_]{36,}/g,
  /github_pat_[A-Za-z0-9_]{82}/g,
  /xoxb-[0-9A-Za-z-]+/g,
  /xoxp-[0-9A-Za-z-]+/g,
  /sk-[A-Za-z0-9]{32,}/g,
  /Bearer\s+[A-Za-z0-9._\-]+/gi,
  /ANTHROPIC_API_KEY=[^\s]+/g,
  /OPENAI_API_KEY=[^\s]+/g,
  /GITHUB_TOKEN=[^\s]+/g,
  /SLACK_BOT_TOKEN=[^\s]+/g,
  /password[=:]\s*\S+/gi,
];

function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}
