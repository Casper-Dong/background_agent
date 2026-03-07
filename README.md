# Background Agent "RUE" (Repo, Utility, Engineering)

A self-hosted background coding agent system. Submit tasks via Slack (`/inspect`) or the web UI, and an AI agent checks out your repo, makes changes, runs verification, and opens a PR.

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

```bash
cp .env.example .env           # Configure tokens
docker build -t background-agent-sandbox ./sandbox
docker compose up --build -d
open http://localhost:1259
```

## Features

- **Slack integration**: `/inspect <task>` starts a job with thread updates
- **Web UI**: Create jobs, view live logs, see diffs and test output
- **Agent adapters**: Claude Code CLI, OpenAI Codex CLI, OpenCode, or mock
- **Verification loop**: Runs `verify.sh` after each agent iteration
- **GitHub integration**: Creates branches and opens PRs automatically
- **Security**: Secret redaction, resource limits, capability restrictions
- **Reliability**: Job timeouts, cancellation, stale container cleanup
- **Flexible sandbox runtime**: Local Docker socket or remote Docker host via `DOCKER_HOST`

## Agent Types

| Agent       | Env Var                   | Notes                        |
|------------|---------------------------|------------------------------|
| `mock`     | (none)                    | Demo mode, makes trivial edits |
| `claude-code` | `ANTHROPIC_API_KEY`    | Requires Claude Code CLI in sandbox |
| `codex`    | `OPENAI_API_KEY`          | Requires OpenAI Codex CLI in sandbox |
| `opencode` | (varies)                  | Requires OpenCode CLI in sandbox |

## Documentation

- [Local Setup](docs/setup.md)
- [VPS Deployment](docs/deployment.md)
- [Adding New Agents/Integrations](docs/adding-tools.md)
- [Debugging Guide](docs/debugging.md)

## License

MIT
