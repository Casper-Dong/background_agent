# Deploying on a VPS

## Requirements

- 4+ GB RAM, 2+ vCPUs (more if running multiple concurrent sandboxes)
- Docker + Docker Compose v2
- A domain with DNS pointed at the VPS
- TLS termination (Caddy, Certbot, or cloud LB)
- Optional: a remote Docker daemon endpoint (for example Fly.io-hosted)

## Steps

### 1. Provision the server

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

### 2. Clone the repo

```bash
git clone https://github.com/YOUR_ORG/background-agent.git
cd background-agent
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env — set production values:
#   NODE_ENV=production
#   API_SECRET=<random 32+ char string>
#   API_URL=https://agent.yourdomain.com
#   GITHUB_TOKEN=ghp_...
#   SLACK_BOT_TOKEN=xoxb-...
#   etc.
```

### 4. Build and start

```bash
# Build sandbox image
docker build -t background-agent-sandbox ./sandbox

# Start all services (with nginx proxy)
docker compose --profile with-proxy up --build -d
```

### 4b. Use a remote Docker daemon (Fly.io or similar)

If you want the worker to launch sandbox containers on a remote Docker host instead of local
`/var/run/docker.sock`, set these environment variables:

```bash
# Keep local socket configured as fallback
DOCKER_SOCKET=/var/run/docker.sock

# Remote daemon endpoint
DOCKER_HOST=tcp://your-fly-docker-host.internal:2376

# TLS (set to 1 for secure daemons)
DOCKER_TLS_VERIFY=1

# Provide certs either by path...
DOCKER_CERT_PATH=/etc/docker-certs

# ...or directly as secrets (raw PEM with \n or base64)
DOCKER_TLS_CA_PEM=
DOCKER_TLS_CERT_PEM=
DOCKER_TLS_KEY_PEM=

# Optional, if daemon expects a specific API version
DOCKER_API_VERSION=1.43
```

Notes:
- When `DOCKER_HOST` is set, the worker connects to that daemon and does not require local socket access.
- For Fly deployment, store PEM values in Fly secrets and expose them as env vars to the worker process.
- Ensure the remote daemon can pull `background-agent-sandbox` and has outbound internet for git/npm.

Fly secret example:
```bash
fly secrets set \
  DOCKER_HOST=tcp://your-fly-docker-host.internal:2376 \
  DOCKER_TLS_VERIFY=1 \
  DOCKER_TLS_CA_PEM="$(cat ca.pem)" \
  DOCKER_TLS_CERT_PEM="$(cat cert.pem)" \
  DOCKER_TLS_KEY_PEM="$(cat key.pem)"
```

### 5. TLS with Caddy (recommended)

Install Caddy on the host (not in Docker):

```bash
sudo apt install -y caddy
```

Create `/etc/caddy/Caddyfile`:
```
agent.yourdomain.com {
    reverse_proxy localhost:8080
}
```

```bash
sudo systemctl restart caddy
```

### 6. Update Slack app URLs

In the Slack app settings, update:
- Slash command URL: `https://agent.yourdomain.com/api/slack/commands`
- Interactivity URL: `https://agent.yourdomain.com/api/slack/interactions`

## Monitoring

```bash
# View logs
docker compose logs -f api worker

# Check job queue
docker compose exec redis redis-cli LLEN bull:agent-jobs:wait

# Database access
docker compose exec postgres psql -U agent background_agent
```

## Backups

```bash
# Postgres backup
docker compose exec postgres pg_dump -U agent background_agent > backup.sql

# Restore
docker compose exec -T postgres psql -U agent background_agent < backup.sql
```

## Scaling

- Increase worker concurrency in `server/src/queue.ts` (`concurrency` setting)
- For multiple workers: run `docker compose up --scale worker=3`
- For production: consider separate Redis and Postgres hosts
