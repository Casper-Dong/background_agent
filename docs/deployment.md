# Deploying on a VPS

## Requirements

- 4+ GB RAM, 2+ vCPUs (more if running multiple concurrent sandboxes)
- Docker + Docker Compose v2
- A domain with DNS pointed at the VPS
- TLS termination (Caddy, Certbot, or cloud LB)

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
