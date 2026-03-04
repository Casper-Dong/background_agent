const API_BASE = "/api";

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
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  iteration: number;
  max_iterations: number;
  error: string | null;
  diff_summary: string | null;
  test_output: string | null;
  artifacts?: Artifact[];
}

export interface Artifact {
  id: string;
  job_id: string;
  type: string;
  name: string;
  content: string | null;
  url: string | null;
}

export interface JobLog {
  id: number | string;
  job_id: string;
  ts: string;
  level: string;
  message: string;
  source: string;
}

export async function listJobs(): Promise<Job[]> {
  const res = await fetch(`${API_BASE}/jobs`);
  if (!res.ok) throw new Error("Failed to fetch jobs");
  return res.json();
}

export async function getJob(id: string): Promise<Job> {
  const res = await fetch(`${API_BASE}/jobs/${id}`);
  if (!res.ok) throw new Error("Failed to fetch job");
  return res.json();
}

export async function createJob(task: string, opts?: {
  agent_type?: string;
  max_iterations?: number;
}): Promise<Job> {
  const res = await fetch(`${API_BASE}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task, ...opts }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create job");
  }
  return res.json();
}

export async function cancelJob(id: string): Promise<Job> {
  const res = await fetch(`${API_BASE}/jobs/${id}/cancel`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to cancel job");
  return res.json();
}

export function streamLogs(
  jobId: string,
  onLog: (log: JobLog) => void,
  onDone: (data: { status: string }) => void,
  onError: (err: Error) => void
): () => void {
  const eventSource = new EventSource(`${API_BASE}/jobs/${jobId}/logs`);

  eventSource.onmessage = (event) => {
    try {
      const log = JSON.parse(event.data);
      onLog(log);
    } catch {}
  };

  eventSource.addEventListener("done", (event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data);
      onDone(data);
    } catch {}
    eventSource.close();
  });

  eventSource.onerror = () => {
    onError(new Error("Log stream connection lost"));
    eventSource.close();
  };

  return () => eventSource.close();
}
