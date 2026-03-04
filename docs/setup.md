# Local Setup

## Prerequisites

- Docker + Docker Compose v2
- Node.js 20+ (for local dev without Docker)
- A GitHub personal access token (fine-grained)
- (Optional) A Slack app

## Quick Start (Docker)

```bash
# 1. Clone and configure
cp .env.example .env
# Edit .env with your GitHub token, Slack tokens, etc.

# 2. Build the sandbox image
docker build -t background-agent-sandbox ./sandbox

# 3. Start everything
docker compose up --build -d

# 4. Open the web UI
open http://localhost:1259
```

## Quick Start (Local Dev)

```bash
# 1. Install dependencies
cd server && npm install && cd ../web && npm install && cd ..

# 2. Start Postgres + Redis
docker compose up postgres redis -d

# 3. Apply schema
cd server && npm run db:migrate && cd ..

# 4. Build sandbox image
docker build -t background-agent-sandbox ./sandbox

# 5. Start API, Worker, and Web UI in separate terminals
cd server && npm run dev          # Terminal 1: API on :3001
cd server && npm run dev:worker   # Terminal 2: Worker
cd web && npm run dev             # Terminal 3: Web UI on :1259
```

## GitHub Token Setup

Create a fine-grained personal access token at https://github.com/settings/tokens?type=beta

Required permissions (on the target repo):
- **Contents**: Read and write (clone, push branches)
- **Pull requests**: Read and write (create PRs)
- **Metadata**: Read-only (required by GitHub)

Set `GITHUB_TOKEN`, `GITHUB_OWNER`, and `GITHUB_REPO` in `.env`.

## Slack App Setup

1. Go to https://api.slack.com/apps
2. Click "Create New App" → "From a manifest"
3. Paste the contents of `slack-manifest.yml`
4. Replace `YOUR_DOMAIN` with your public API URL (use ngrok for local dev)
5. Install the app to your workspace
6. Copy the **Bot User OAuth Token** → `SLACK_BOT_TOKEN` in `.env`
7. Copy the **Signing Secret** → `SLACK_SIGNING_SECRET` in `.env`

For local development with Slack:
```bash
# Use ngrok to expose your API
ngrok http 3001
# Update the Slack app's slash command URL to: https://YOUR_NGROK/api/slack/commands
```

## Customizing verify.sh

Add a `verify.sh` to your repo root. The agent runs this after each iteration.
If not present, the default template runs lint, typecheck, tests, and build.

Example for a Next.js project:
```bash
#!/usr/bin/env bash
set -euo pipefail
npm run lint
npx tsc --noEmit
npm test -- --watchAll=false
npm run build
```
