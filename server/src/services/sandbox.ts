import Docker from "dockerode";
import { PassThrough } from "stream";
import { config } from "../config";

const docker = new Docker({ socketPath: config.DOCKER_SOCKET });

export interface SandboxOptions {
  jobId: string;
  task: string;
  repoCloneUrl: string;
  branch: string;
  baseBranch: string;
  agentType: string;
  maxIterations: number;
  timeoutSeconds: number;
}

export interface SandboxResult {
  exitCode: number;
  diffSummary: string;
  testOutput: string;
  error?: string;
}

export async function launchSandbox(
  opts: SandboxOptions,
  onLog: (line: string, source: string) => void
): Promise<{ containerId: string }> {
  const envVars = [
    `JOB_ID=${opts.jobId}`,
    `TASK=${opts.task}`,
    `REPO_CLONE_URL=${opts.repoCloneUrl}`,
    `BRANCH=${opts.branch}`,
    `BASE_BRANCH=${opts.baseBranch}`,
    `AGENT_TYPE=${opts.agentType}`,
    `MAX_ITERATIONS=${opts.maxIterations}`,
    `COMMAND_ALLOWLIST=${config.COMMAND_ALLOWLIST}`,
  ];

  // Pass agent-specific API keys
  if (opts.agentType === "claude-code" && config.ANTHROPIC_API_KEY) {
    envVars.push(`ANTHROPIC_API_KEY=${config.ANTHROPIC_API_KEY}`);
  }
  if (opts.agentType === "codex" && config.OPENAI_API_KEY) {
    envVars.push(`OPENAI_API_KEY=${config.OPENAI_API_KEY}`);
  }

  const container = await docker.createContainer({
    Image: config.SANDBOX_IMAGE,
    Env: envVars,
    HostConfig: {
      // Resource limits
      Memory: 4 * 1024 * 1024 * 1024, // 4 GB
      NanoCpus: 2_000_000_000,         // 2 CPUs
      PidsLimit: 256,
      // Network: allow for git clone / npm install
      NetworkMode: "bridge",
      // Security
      ReadonlyRootfs: false,
      SecurityOpt: ["no-new-privileges"],
      CapDrop: ["ALL"],
      CapAdd: ["CHOWN", "SETUID", "SETGID", "DAC_OVERRIDE", "FOWNER"],
    },
    Labels: {
      "background-agent.job-id": opts.jobId,
      "background-agent.managed": "true",
    },
    StopTimeout: 10,
  });

  await container.start();

  // Attach to log stream
  const logStream = await container.logs({
    follow: true,
    stdout: true,
    stderr: true,
    timestamps: true,
  });

  // Docker multiplexed stream → line-by-line
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  docker.modem.demuxStream(logStream as any, stdout, stderr);

  let buffer = "";
  const processChunk = (chunk: Buffer) => {
    buffer += chunk.toString("utf-8");
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const source = detectLogSource(line);
      onLog(line, source);
    }
  };

  stdout.on("data", processChunk);
  stderr.on("data", processChunk);

  stdout.on("end", () => {
    if (buffer.trim()) {
      onLog(buffer, detectLogSource(buffer));
    }
  });

  return { containerId: container.id };
}

export async function waitForSandbox(
  containerId: string,
  timeoutSeconds: number
): Promise<SandboxResult> {
  const container = docker.getContainer(containerId);

  // Wait with timeout
  const waitPromise = container.wait();
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Sandbox timeout")), timeoutSeconds * 1000);
  });

  let exitCode: number;
  try {
    const result = await Promise.race([waitPromise, timeoutPromise]);
    exitCode = (result as any).StatusCode;
  } catch (err: any) {
    if (err.message === "Sandbox timeout") {
      try { await container.stop({ t: 5 }); } catch {}
      return {
        exitCode: 124,
        diffSummary: "",
        testOutput: "",
        error: `Sandbox timed out after ${timeoutSeconds}s`,
      };
    }
    throw err;
  }

  // Read result files from container
  let diffSummary = "";
  let testOutput = "";
  let error: string | undefined;

  try {
    diffSummary = await readFileFromContainer(container, "/workspace/.agent-result/diff.txt");
  } catch {}
  try {
    testOutput = await readFileFromContainer(container, "/workspace/.agent-result/test-output.txt");
  } catch {}
  try {
    error = await readFileFromContainer(container, "/workspace/.agent-result/error.txt");
  } catch {}

  return { exitCode, diffSummary, testOutput, error: error || undefined };
}

export async function stopSandbox(containerId: string): Promise<void> {
  try {
    const container = docker.getContainer(containerId);
    await container.stop({ t: 5 });
  } catch (err: any) {
    if (!err.message?.includes("not running")) {
      throw err;
    }
  }
}

export async function removeSandbox(containerId: string): Promise<void> {
  try {
    const container = docker.getContainer(containerId);
    await container.remove({ force: true, v: true });
  } catch (err: any) {
    if (!err.message?.includes("No such container")) {
      console.error(`[sandbox] Failed to remove container ${containerId}:`, err.message);
    }
  }
}

export async function cleanupStaleSandboxes(): Promise<void> {
  const containers = await docker.listContainers({
    all: true,
    filters: { label: ["background-agent.managed=true"] },
  });

  for (const info of containers) {
    const age = Date.now() / 1000 - info.Created;
    // Remove containers older than 2 hours
    if (age > 7200) {
      console.log(`[sandbox] Cleaning up stale container ${info.Id.slice(0, 12)}`);
      await removeSandbox(info.Id);
    }
  }
}

// ── Helpers ────────────────────────────────────────────

async function readFileFromContainer(container: Docker.Container, path: string): Promise<string> {
  const archive = await container.getArchive({ path });
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("end", () => {
      // tar archive → extract file content (skip 512-byte header)
      const buf = Buffer.concat(chunks);
      // Simple tar extraction: find first null-terminated filename, skip 512-byte header
      const headerEnd = 512;
      if (buf.length <= headerEnd) {
        resolve("");
        return;
      }
      // Find the end of file content (tar pads to 512-byte blocks)
      // Read file size from header bytes 124-135 (octal)
      const sizeStr = buf.slice(124, 135).toString("utf-8").trim();
      const fileSize = parseInt(sizeStr, 8) || 0;
      const content = buf.slice(headerEnd, headerEnd + fileSize).toString("utf-8");
      resolve(content);
    });
    archive.on("error", reject);
  });
}

function detectLogSource(line: string): string {
  if (line.includes("[agent]")) return "agent";
  if (line.includes("[verify]")) return "verify";
  if (line.includes("[sandbox]")) return "sandbox";
  return "system";
}
