#!/bin/zsh
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
APP_NAME="waterloo-mafia-docker"
LOCAL_REMOTE="23750:2375"
BIND_ADDR="0.0.0.0"
LOG_FILE="/tmp/fly-proxy.supervisor.log"

while true; do
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] starting fly proxy ${LOCAL_REMOTE} for ${APP_NAME}" >> "$LOG_FILE"
  /opt/homebrew/bin/flyctl proxy "$LOCAL_REMOTE" -a "$APP_NAME" -b "$BIND_ADDR" >> "$LOG_FILE" 2>&1 || true
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] fly proxy exited; restarting in 2s" >> "$LOG_FILE"
  sleep 2
done
