#!/usr/bin/env bash
set -euo pipefail

# ── Environment ─────────────────────────────────────────
JOB_ID="${JOB_ID:?JOB_ID is required}"
TASK="${TASK:?TASK is required}"
REPO_CLONE_URL="${REPO_CLONE_URL:?REPO_CLONE_URL is required}"
BRANCH="${BRANCH:?BRANCH is required}"
BASE_BRANCH="${BASE_BRANCH:-main}"
AGENT_TYPE="${AGENT_TYPE:-mock}"
MAX_ITERATIONS="${MAX_ITERATIONS:-5}"

RESULT_DIR="/workspace/.agent-result"
REPO_DIR="/workspace/repo"

mkdir -p "$RESULT_DIR"

# ── Helper functions ────────────────────────────────────

log() {
  echo "[sandbox] $(date -u +%H:%M:%S) $*"
}

error_exit() {
  echo "$1" > "$RESULT_DIR/error.txt"
  log "ERROR: $1"
  exit 1
}

run_mock_agent() {
  local prompt="$1"
  echo "[agent] Mock agent received task:"
  echo "[agent] $(echo "$prompt" | head -5)"
  echo "[agent] "
  echo "[agent] Planning changes..."
  sleep 1
  echo "[agent] Analyzing codebase..."
  sleep 1

  # Create a demo change to show the flow works
  if [ -f "README.md" ]; then
    echo "[agent] Editing README.md..."
    echo "" >> README.md
    echo "<!-- Agent note: ${TASK:0:200} -->" >> README.md
  else
    echo "[agent] Creating README.md..."
    cat > README.md << 'AGENTEOF'
# Project

Updated by Background Agent

---
*Automated change*
AGENTEOF
  fi

  echo "[agent] Mock agent completed"
}

# ── 1. Clone repo ──────────────────────────────────────
log "Cloning repo..."
git clone --depth=50 --branch "$BASE_BRANCH" "$REPO_CLONE_URL" "$REPO_DIR" 2>&1 || \
  error_exit "Failed to clone repository"

cd "$REPO_DIR"

log "Creating branch $BRANCH..."
git checkout -b "$BRANCH" 2>&1

# ── 2. Bootstrap (install deps) ────────────────────────
if [ -f "package-lock.json" ] || [ -f "package.json" ]; then
  log "Installing Node.js dependencies..."
  npm ci --ignore-scripts 2>&1 || npm install --ignore-scripts 2>&1 || true
fi

if [ -f "requirements.txt" ]; then
  log "Installing Python dependencies..."
  python3 -m pip install --user -r requirements.txt 2>&1 || true
fi

# ── 3. Prepare verify script ───────────────────────────
if [ ! -f "./verify.sh" ]; then
  log "No verify.sh found in repo, using default template"
  cp /defaults/verify.sh ./verify.sh
fi
chmod +x ./verify.sh

# ── 4. Agent loop ──────────────────────────────────────
ITERATION=0
VERIFY_OUTPUT=""
AGENT_SUCCESS=false

while [ "$ITERATION" -lt "$MAX_ITERATIONS" ]; do
  ITERATION=$((ITERATION + 1))
  log "=== Iteration $ITERATION / $MAX_ITERATIONS ==="

  # Build the prompt — include prior verify failures as context
  PROMPT="$TASK"
  if [ -n "$VERIFY_OUTPUT" ]; then
    PROMPT="$TASK

The previous iteration's verification failed with the following output:

$VERIFY_OUTPUT

Please fix the issues and try again."
  fi

  # ── Run agent ───────────────────────────────────────
  log "Running agent ($AGENT_TYPE)..."
  AGENT_EXIT=0

  case "$AGENT_TYPE" in
    claude-code)
      if command -v claude &> /dev/null; then
        echo "[agent] Running Claude Code CLI..."
        claude -p "$PROMPT" \
          --allowedTools "Edit,Write,Bash(git *),Bash(npm *),Bash(node *),Bash(npx *),Bash(cat *),Bash(ls *),Bash(find *),Bash(grep *)" \
          2>&1 || AGENT_EXIT=$?
      else
        log "claude CLI not found, falling back to mock"
        run_mock_agent "$PROMPT"
      fi
      ;;

    codex)
      if command -v codex &> /dev/null; then
        echo "[agent] Running OpenAI Codex CLI..."
        codex --quiet --approval-mode full-auto "$PROMPT" 2>&1 || AGENT_EXIT=$?
      else
        log "codex CLI not found, falling back to mock"
        run_mock_agent "$PROMPT"
      fi
      ;;

    opencode)
      if command -v opencode &> /dev/null; then
        echo "[agent] Running OpenCode..."
        echo "$PROMPT" | opencode 2>&1 || AGENT_EXIT=$?
      else
        log "opencode not found, falling back to mock"
        run_mock_agent "$PROMPT"
      fi
      ;;

    mock|*)
      run_mock_agent "$PROMPT"
      ;;
  esac

  if [ "$AGENT_EXIT" -ne 0 ]; then
    log "Agent exited with code $AGENT_EXIT"
  fi

  # ── Run verify ──────────────────────────────────────
  log "Running verify.sh..."
  echo "[verify] Running verification..."
  VERIFY_OUTPUT=""
  VERIFY_EXIT=0

  VERIFY_OUTPUT=$(timeout 300 ./verify.sh 2>&1) || VERIFY_EXIT=$?

  echo "[verify] Exit code: $VERIFY_EXIT"
  if [ -n "$VERIFY_OUTPUT" ]; then
    echo "$VERIFY_OUTPUT" | tail -30
  fi

  if [ "$VERIFY_EXIT" -eq 0 ]; then
    log "Verification PASSED on iteration $ITERATION"
    AGENT_SUCCESS=true
    break
  else
    log "Verification FAILED (exit code $VERIFY_EXIT)"
  fi
done

# ── 5. Collect results ─────────────────────────────────
cd "$REPO_DIR"

# Generate diff summary
{
  git diff --stat "$BASE_BRANCH" 2>/dev/null || true
  echo "---"
  git diff "$BASE_BRANCH" 2>/dev/null || true
} > "$RESULT_DIR/diff.txt"

# Save last verify output
echo "$VERIFY_OUTPUT" > "$RESULT_DIR/test-output.txt"

# ── 6. Commit and push ─────────────────────────────────
HAS_CHANGES=false
if ! git diff --quiet 2>/dev/null; then
  HAS_CHANGES=true
fi
if [ -n "$(git ls-files --others --exclude-standard 2>/dev/null)" ]; then
  HAS_CHANGES=true
fi

if [ "$HAS_CHANGES" = true ]; then
  log "Committing changes..."
  git add -A
  STATUS_LABEL="verified"
  if [ "$AGENT_SUCCESS" != true ]; then
    STATUS_LABEL="unverified"
  fi
  git commit -m "agent: ${TASK:0:72}

Automated changes by Background Agent (job ${JOB_ID:0:8})
Iterations: $ITERATION/$MAX_ITERATIONS
Status: $STATUS_LABEL" 2>&1

  log "Pushing branch $BRANCH..."
  git push origin "$BRANCH" 2>&1 || error_exit "Failed to push branch"
  log "Push complete"
else
  log "No changes to commit"
fi

# ── 7. Exit ─────────────────────────────────────────────
if [ "$AGENT_SUCCESS" = true ]; then
  log "Job completed successfully after $ITERATION iteration(s)"
  exit 0
else
  echo "Verification failed after $ITERATION iterations" > "$RESULT_DIR/error.txt"
  log "Job failed after $ITERATION iterations"
  exit 1
fi
