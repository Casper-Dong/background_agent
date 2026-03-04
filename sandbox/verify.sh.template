#!/usr/bin/env bash
# ── verify.sh ─────────────────────────────────────────
# Default verification script for Background Agent.
# Customize this for your project by adding it to your repo root.
#
# This script is run after each agent iteration. Return 0 for pass, non-zero for fail.
# The agent sees the output on failure, so include helpful error messages.
#
# Examples of what to add:
#   - Linting:       npx eslint . --max-warnings=0
#   - Type checking:  npx tsc --noEmit
#   - Unit tests:     npm test
#   - Build check:    npm run build
#   - Custom checks:  curl -sf http://localhost:3000/health

set -euo pipefail

echo "=== Verification ==="

# ── 1. Check syntax / lint ──────────────────────────────
if [ -f "package.json" ]; then
  if grep -q '"lint"' package.json 2>/dev/null; then
    echo "Running linter..."
    npm run lint 2>&1 || { echo "FAIL: Lint errors"; exit 1; }
  fi
fi

# ── 2. Type check (TypeScript) ──────────────────────────
if [ -f "tsconfig.json" ]; then
  if command -v npx &> /dev/null; then
    echo "Running TypeScript type check..."
    npx tsc --noEmit 2>&1 || { echo "FAIL: Type errors"; exit 1; }
  fi
fi

# ── 3. Unit tests ──────────────────────────────────────
if [ -f "package.json" ]; then
  if grep -q '"test"' package.json 2>/dev/null; then
    echo "Running tests..."
    npm test 2>&1 || { echo "FAIL: Test failures"; exit 1; }
  fi
fi

# ── 4. Build ───────────────────────────────────────────
if [ -f "package.json" ]; then
  if grep -q '"build"' package.json 2>/dev/null; then
    echo "Running build..."
    npm run build 2>&1 || { echo "FAIL: Build errors"; exit 1; }
  fi
fi

echo "=== All checks passed ==="
exit 0
