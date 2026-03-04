# Common Failure Modes & Debugging

## Job stuck in "queued"

**Cause**: Worker isn't running or can't connect to Redis.

```bash
# Check worker status
docker compose logs worker

# Check Redis connectivity
docker compose exec redis redis-cli ping

# Verify queue has items
docker compose exec redis redis-cli LLEN bull:agent-jobs:wait
```

## Job fails immediately with "Failed to clone repository"

**Cause**: GitHub token is invalid or doesn't have repo access.

```bash
# Test the token
curl -H "Authorization: token YOUR_TOKEN" https://api.github.com/repos/OWNER/REPO

# Check token permissions — needs Contents: Read/Write
```

## Sandbox timeout

**Cause**: Agent is stuck or tests take too long.

- Increase `SANDBOX_TIMEOUT_SECONDS` in `.env`
- Check if `verify.sh` hangs (e.g., waiting for user input or a server)
- Check sandbox logs in the web UI

## "Sandbox image not found"

```bash
# Build the sandbox image
docker build -t background-agent-sandbox ./sandbox

# Verify
docker images | grep background-agent-sandbox
```

## Docker socket permission denied

**Cause**: Worker container can't access the Docker socket.

```bash
# On Linux, the docker group GID must match
docker compose exec worker ls -la /var/run/docker.sock

# Fix: add the correct group to docker-compose.yml worker service:
#   user: "1000:$(getent group docker | cut -d: -f3)"
```

If you are using a remote Docker daemon (`DOCKER_HOST`), this section does not apply. Instead,
verify remote connectivity:

```bash
# From inside the worker container
docker compose exec worker sh -lc 'echo "$DOCKER_HOST"'

# Confirm TLS/certs are loaded when required
docker compose exec worker sh -lc 'env | grep "^DOCKER_"'
```

Common remote errors:
- `connect ECONNREFUSED ...`: wrong host/port or daemon not listening on TCP.
- `x509: certificate signed by unknown authority`: missing/incorrect `DOCKER_TLS_CA_PEM` or `DOCKER_CERT_PATH/ca.pem`.
- `remote error: tls: bad certificate`: wrong client cert/key pair.

## SSE log stream disconnects

**Cause**: Proxy timeout or buffering.

- Check nginx config has `proxy_buffering off` and long `proxy_read_timeout`
- If using Cloudflare, disable "Auto Minify" and enable WebSocket support
- The web UI will auto-reconnect on refresh

## PR creation fails

**Cause**: Branch wasn't pushed, or token lacks PR permissions.

```bash
# Check if branch exists on remote
git ls-remote origin | grep BRANCH_NAME

# Test PR creation manually
gh pr create --head BRANCH --base main --title "test" --body "test"
```

## Sandbox container cleanup

Stale containers are cleaned automatically every 10 minutes. Manual cleanup:

```bash
# List managed containers
docker ps -a --filter label=background-agent.managed=true

# Remove all
docker ps -a --filter label=background-agent.managed=true -q | xargs docker rm -f
```

## Viewing raw container logs

```bash
# Find the container ID from the job detail page, then:
docker logs CONTAINER_ID

# Or follow live
docker logs -f CONTAINER_ID
```

## Database issues

```bash
# Connect to Postgres
docker compose exec postgres psql -U agent background_agent

# Check job status
SELECT id, status, error, created_at FROM jobs ORDER BY created_at DESC LIMIT 10;

# Reset a stuck job
UPDATE jobs SET status = 'failed', error = 'Manual reset', completed_at = now() WHERE id = 'JOB_ID';
```
