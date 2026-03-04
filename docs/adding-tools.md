# How to Add a New Agent or Integration

## Adding a New Agent Adapter

The sandbox's `entrypoint.sh` dispatches to different agent CLIs based on `AGENT_TYPE`.

### 1. Add the CLI to the sandbox image

Edit `sandbox/Dockerfile`:
```dockerfile
# Install your agent CLI
RUN npm install -g your-agent-cli
```

### 2. Add the case to entrypoint.sh

Edit `sandbox/entrypoint.sh`, add a new case in the agent dispatch:
```bash
your-agent)
  if command -v your-agent &> /dev/null; then
    echo "[agent] Running YourAgent..."
    your-agent run "$PROMPT" 2>&1 || AGENT_EXIT=$?
  else
    log "your-agent not found, falling back to mock"
    run_mock_agent "$PROMPT"
  fi
  ;;
```

### 3. Update the config

Edit `server/src/config.ts` — add your agent to the enum:
```ts
AGENT_TYPE: z.enum(["claude-code", "codex", "opencode", "your-agent", "mock"]).default("mock"),
```

Also update the Zod schema in `server/src/routes/jobs.ts`.

### 4. Pass required env vars

If your agent needs an API key, add it to `sandbox.ts`:
```ts
if (opts.agentType === "your-agent" && config.YOUR_AGENT_KEY) {
  envVars.push(`YOUR_AGENT_KEY=${config.YOUR_AGENT_KEY}`);
}
```

### 5. Rebuild

```bash
docker build -t background-agent-sandbox ./sandbox
docker compose up --build -d worker
```

## Adding a New Integration (e.g., Discord, Linear)

### 1. Create the service

Add `server/src/services/your-integration.ts` following the pattern in `slack.ts`.

### 2. Add a route (if needed)

Add `server/src/routes/your-integration.ts` and register it in `server/src/index.ts`.

### 3. Hook into the worker

In `server/src/worker.ts`, add notification calls at the relevant points:
- Job started
- Iteration progress
- Job completed

### 4. Add config vars

Update `server/src/config.ts` and `.env.example`.
