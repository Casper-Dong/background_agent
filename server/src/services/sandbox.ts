import fs from "fs";
import path from "path";
import Docker, { DockerOptions } from "dockerode";
import { PassThrough } from "stream";
import { config } from "../config";

const docker = createDockerClient();

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

function createDockerClient(): Docker {
  const dockerHost = config.DOCKER_HOST.trim();
  const apiVersion = config.DOCKER_API_VERSION.trim() || undefined;

  if (!dockerHost) {
    const localOptions: DockerOptions = { socketPath: config.DOCKER_SOCKET };
    if (apiVersion) localOptions.version = apiVersion;
    console.log(`[sandbox] Docker client configured for local socket ${config.DOCKER_SOCKET}`);
    return new Docker(localOptions);
  }

  if (dockerHost.startsWith("unix://")) {
    const socketPath = dockerHost.slice("unix://".length);
    const unixOptions: DockerOptions = { socketPath };
    if (apiVersion) unixOptions.version = apiVersion;
    console.log(`[sandbox] Docker client configured for unix socket ${socketPath}`);
    return new Docker(unixOptions);
  }

  const remoteOptions = buildRemoteDockerOptions(dockerHost, apiVersion);
  console.log(
    `[sandbox] Docker client configured for remote ${remoteOptions.protocol}://${remoteOptions.host}:${remoteOptions.port}`
  );
  return new Docker(remoteOptions);
}

function buildRemoteDockerOptions(dockerHost: string, apiVersion?: string): DockerOptions {
  const normalizedHost = dockerHost.startsWith("tcp://")
    ? `http://${dockerHost.slice("tcp://".length)}`
    : dockerHost;

  let parsed: URL;
  try {
    parsed = new URL(normalizedHost);
  } catch {
    throw new Error(`Invalid DOCKER_HOST value: ${dockerHost}`);
  }

  const scheme = parsed.protocol.replace(":", "");
  if (scheme !== "http" && scheme !== "https") {
    throw new Error(
      `Unsupported DOCKER_HOST protocol "${parsed.protocol}". Use tcp://, http://, https://, or unix://`
    );
  }

  const tlsVerify = isTruthy(config.DOCKER_TLS_VERIFY);
  const useTls = scheme === "https" || tlsVerify;
  const protocol = useTls ? "https" : "http";
  const host = parsed.hostname;
  const port = parsed.port ? Number(parsed.port) : useTls ? 2376 : 2375;

  if (!host) {
    throw new Error(`Invalid DOCKER_HOST value: ${dockerHost}`);
  }

  const options: DockerOptions = { protocol, host, port };
  if (apiVersion) options.version = apiVersion;

  const tlsMaterial = loadTlsMaterial();
  if (tlsMaterial.ca) options.ca = tlsMaterial.ca;
  if (tlsMaterial.cert) options.cert = tlsMaterial.cert;
  if (tlsMaterial.key) options.key = tlsMaterial.key;

  return options;
}

function loadTlsMaterial(): { ca?: Buffer; cert?: Buffer; key?: Buffer } {
  const envCa = parsePem(config.DOCKER_TLS_CA_PEM);
  const envCert = parsePem(config.DOCKER_TLS_CERT_PEM);
  const envKey = parsePem(config.DOCKER_TLS_KEY_PEM);

  const certPath = config.DOCKER_CERT_PATH.trim();
  if (!certPath) {
    return { ca: envCa, cert: envCert, key: envKey };
  }

  return {
    ca: envCa ?? readFileIfExists(path.join(certPath, "ca.pem")),
    cert: envCert ?? readFileIfExists(path.join(certPath, "cert.pem")),
    key: envKey ?? readFileIfExists(path.join(certPath, "key.pem")),
  };
}

function parsePem(value: string): Buffer | undefined {
  const normalized = value.trim();
  if (!normalized) return undefined;

  const multiline = normalized.includes("\\n")
    ? normalized.replace(/\\n/g, "\n")
    : normalized;

  if (multiline.includes("BEGIN")) {
    return Buffer.from(multiline, "utf-8");
  }

  // Allow passing PEM data as base64 for env-secret systems.
  try {
    const decoded = Buffer.from(multiline, "base64").toString("utf-8");
    if (decoded.includes("BEGIN")) {
      return Buffer.from(decoded, "utf-8");
    }
  } catch {}

  return Buffer.from(multiline, "utf-8");
}

function readFileIfExists(filePath: string): Buffer | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    return fs.readFileSync(filePath);
  } catch {
    return undefined;
  }
}

function isTruthy(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return !["0", "false", "no", "off"].includes(normalized);
}
