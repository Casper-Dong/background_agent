import { Octokit } from "@octokit/rest";
import { config } from "../config";

let octokit: Octokit | null = null;

function getOctokit(): Octokit {
  if (!octokit) {
    if (!config.GITHUB_TOKEN) {
      throw new Error("GITHUB_TOKEN is not set");
    }
    octokit = new Octokit({ auth: config.GITHUB_TOKEN });
  }
  return octokit;
}

const owner = () => config.GITHUB_OWNER;
const repo = () => config.GITHUB_REPO;

export async function createBranch(branchName: string, baseBranch: string): Promise<void> {
  const ok = getOctokit();
  const { data: ref } = await ok.git.getRef({
    owner: owner(),
    repo: repo(),
    ref: `heads/${baseBranch}`,
  });

  await ok.git.createRef({
    owner: owner(),
    repo: repo(),
    ref: `refs/heads/${branchName}`,
    sha: ref.object.sha,
  });
}

export async function createPullRequest(params: {
  title: string;
  body: string;
  head: string;
  base: string;
}): Promise<{ url: string; number: number }> {
  const ok = getOctokit();
  const { data: pr } = await ok.pulls.create({
    owner: owner(),
    repo: repo(),
    title: params.title,
    body: params.body,
    head: params.head,
    base: params.base,
  });
  return { url: pr.html_url, number: pr.number };
}

export async function getRepoCloneUrl(): Promise<string> {
  // Use HTTPS clone URL with embedded token for sandbox auth
  return `https://x-access-token:${config.GITHUB_TOKEN}@github.com/${owner()}/${repo()}.git`;
}

export function getPublicRepoUrl(): string {
  return `https://github.com/${owner()}/${repo()}`;
}

export function generateBranchName(jobId: string): string {
  const shortId = jobId.slice(0, 8);
  const timestamp = Date.now().toString(36);
  return `agent/${shortId}-${timestamp}`;
}
