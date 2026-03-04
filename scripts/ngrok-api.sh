#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
LOG_FILE="/tmp/rue-ngrok.log"
while true; do
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] starting ngrok http 3001" >> "$LOG_FILE"
  /opt/homebrew/bin/ngrok http 3001 --log=stdout >> "$LOG_FILE" 2>&1 || true
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ngrok exited; restarting in 2s" >> "$LOG_FILE"
  sleep 2
done
