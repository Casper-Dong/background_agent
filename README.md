# Background Agent "RUE" (Repo, Utility, Engineering)

Inspired by the Ramp article: https://builders.ramp.com/post/why-we-built-our-background-agent

A self-hosted background coding agent system. Submit tasks via Slack (`/inspect`) or the web UI, and an AI agent checks out your repo in an isolated Docker sandbox, makes changes, runs verification, and opens a PR — all without blocking your workflow.

## Architecture

```
                ┌─────────┐     ┌──────────┐
  Slack ──────► │   API   │◄────│  Web UI  │
  /inspect      │ :3001   │     │  :1259   │
                └────┬────┘     └──────────┘
                     │
                ┌────▼────┐
                │  Redis  │  BullMQ queue
                │  :6379  │
                └────┬────┘
                     │
                ┌────▼────┐     ┌──────────────────────┐
                │ Worker  │────►│ Sandbox Container (N) │
                │         │     │  - clone repo         │
                └────┬────┘     │  - run agent CLI      │
                     │          │  - run verify.sh      │
                ┌────▼────┐     │  - commit + push      │
                │Postgres │     └──────────────────────┘
                │  :5432  │
                └─────────┘
```

## Quick Start

### Option A: Full Docker Compose (recommended for deployment)

```bash
cp .env.example .env           # Configure tokens & GitHub settings
docker build -t background-agent-sandbox ./sandbox
docker compose up --build -d
open http://localhost:1259
```

### Option B: Local development (native services)

If you prefer running services outside Docker:

```bash
# 1. Install dependencies
brew install redis postgresql@16    # macOS
brew services start redis
brew services start postgresql@16

# 2. Create the database
createdb background_agent
psql -d background_agent -f server/src/schema.sql

# 3. Configure environment
cp .env.example .env
# Edit .env — set POSTGRES_HOST=localhost, REDIS_HOST=localhost,
# your GitHub token, owner/repo, and at least one API key

# 4. Build and start the API + worker
cd server && npm install && npm run build
node dist/index.js &          # API on :3001
node dist/worker.js &         # Worker

# 5. Start the web UI
cd ../web && npm install && npm run dev   # UI on :1259

# 6. Build the sandbox image (still requires Docker)
docker build -t background-agent-sandbox ./sandbox
```

## Features

- **Slack integration**: `/inspect <task>` starts a job with Slack thread updates (see `slack-manifest.yml`)
- **Web UI**: Create jobs, view live agent conversation trace, diffs, and test output
- **Agent chat sidebar**: Real-time categorized log stream (messages, tool calls, thinking, system) with allow/deny confirmation controls
- **Auto agent selection**: Automatically picks the best available agent based on which API keys are configured
- **Agent adapters**: Claude Code CLI, OpenAI Codex CLI, OpenCode, or mock
- **Verification loop**: Runs `verify.sh` after each agent iteration with baseline comparison to handle pre-existing failures
- **GitHub integration**: Creates branches and opens PRs automatically
- **Execution summaries**: Each job produces a structured summary (planned approach, steps performed, outcome)
- **Security**: Secret redaction on all logs, resource limits, CPU caps, capability restrictions, command allowlists
- **Reliability**: Job timeouts, cancellation with retry, stale container cleanup, transient Docker error retries
- **Log streaming**: Real-time SSE from sandbox → worker → API → web UI with deduplication
- **Docker sandbox isolation**: Each task runs in a fresh container with resource limits

## Agent Types

| Agent         | Env Var              | Notes                                              |
|---------------|----------------------|----------------------------------------------------|
| `auto`        | (any key)            | Default — picks the best agent from available keys |
| `claude-code` | `ANTHROPIC_API_KEY`  | Claude Code CLI (installed in sandbox image)       |
| `codex`       | `OPENAI_API_KEY`     | OpenAI Codex CLI (installed in sandbox image)      |
| `opencode`    | (varies)             | Requires OpenCode CLI in sandbox                   |
| `mock`        | (none)               | Demo mode, makes trivial edits                     |

Auto-selection priority: explicit `AGENT_TYPE` > `OPENAI_API_KEY` (codex) > `ANTHROPIC_API_KEY` (claude-code) > mock.

## Docker Sandbox

Each job runs inside an isolated Docker container built from `sandbox/Dockerfile`. The image includes:

- **Node.js 20** (Debian Bookworm)
- **Claude Code CLI** (`@anthropic-ai/claude-code`) and **Codex CLI** (`@openai/codex`) pre-installed globally
- **Python 3** with pip and venv
- **Git**, curl, jq, and common build tools
- A non-root `agent` user with pre-configured git identity

The sandbox entrypoint (`sandbox/entrypoint.sh`) orchestrates the full agent loop:

1. Clone the target repo and create a working branch
2. Install dependencies (npm/pip)
3. Prepare `verify.sh` (uses repo's own or a default template)
4. Run the agent CLI in a loop (up to `MAX_ITERATIONS`)
5. After each pass, run `verify.sh` and feed failures back as context
6. Commit, push, and report results

### Docker socket configuration

The worker creates sandbox containers on the host Docker daemon via socket mounting. On **macOS with Docker Desktop**, the socket path differs from Linux:

```bash
# Linux (default)
DOCKER_SOCKET=/var/run/docker.sock

# macOS with Docker Desktop
DOCKER_SOCKET=/Users/<you>/.docker/run/docker.sock
```

For remote Docker hosts, set `DOCKER_HOST` (e.g., `tcp://docker.internal:2376`) and optionally configure TLS via `DOCKER_TLS_*` variables.

## Configuration

All configuration is via environment variables in `.env`. Key settings:

| Variable                  | Default                     | Description                                         |
|---------------------------|-----------------------------|-----------------------------------------------------|
| `API_PORT`                | `3001`                      | API server port                                     |
| `WEB_URL`                 | `http://localhost:1259`     | Web UI URL                                          |
| `GITHUB_TOKEN`            | —                           | Fine-grained PAT (Contents + PRs read/write)        |
| `GITHUB_OWNER`            | —                           | GitHub org or username                              |
| `GITHUB_REPO`             | —                           | Target repository name                              |
| `GITHUB_DEFAULT_BRANCH`   | `main`                      | Base branch for PRs                                 |
| `ANTHROPIC_API_KEY`       | —                           | For Claude Code agent                               |
| `OPENAI_API_KEY`          | —                           | For Codex agent                                     |
| `AGENT_TYPE`              | auto-detected               | Force a specific agent (`claude-code`, `codex`, `opencode`, `mock`) |
| `SANDBOX_TIMEOUT_SECONDS` | `1800`                      | Max runtime per sandbox (30 min)                    |
| `SANDBOX_MAX_ITERATIONS`  | `5`                         | Max agent loop iterations                           |
| `SANDBOX_CPU_LIMIT`       | `1`                         | CPU cores allocated to each sandbox                 |
| `DOCKER_SOCKET`           | `/var/run/docker.sock`      | Path to Docker socket                               |
| `SLACK_BOT_TOKEN`         | —                           | Slack bot OAuth token                               |
| `SLACK_SIGNING_SECRET`    | —                           | Slack app signing secret                            |

See `.env.example` for the full list including TLS and security options.

## Slack Setup

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From a manifest**
2. Paste the contents of `slack-manifest.yml`
3. Replace `YOUR_DOMAIN` with your actual API endpoint
4. Install the app to your workspace
5. Copy the **Bot Token** (`xoxb-...`) → `SLACK_BOT_TOKEN`
6. Copy the **Signing Secret** → `SLACK_SIGNING_SECRET`

Use `/inspect <task description>` in any channel to kick off a job. RUE will post progress updates in a thread and link to the web UI.

## Documentation

- [Local Setup](docs/setup.md)
- [VPS Deployment](docs/deployment.md)
- [Adding New Agents/Integrations](docs/adding-tools.md)
- [Debugging Guide](docs/debugging.md)

## License

MIT
