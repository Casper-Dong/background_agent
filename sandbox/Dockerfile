FROM node:20-bookworm

# ── System deps ─────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    wget \
    jq \
    python3 \
    python3-pip \
    python3-venv \
    build-essential \
    ca-certificates \
    openssh-client \
  && rm -rf /var/lib/apt/lists/*

# ── Agent CLIs ──────────────────────────────────────────
RUN npm install -g @openai/codex @anthropic-ai/claude-code

# ── Create non-root user ────────────────────────────────
RUN useradd -m -s /bin/bash agent
RUN mkdir -p /workspace/.agent-result && chown -R agent:agent /workspace

# ── Copy entrypoint ─────────────────────────────────────
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# ── Default verify script (can be overridden by repo) ───
COPY verify.sh.template /defaults/verify.sh
RUN chmod +x /defaults/verify.sh

WORKDIR /workspace

USER agent

# ── Git config (must be after USER agent) ───────────────
RUN git config --global user.email "agent@background-agent.local" \
 && git config --global user.name "Background Agent" \
 && git config --global init.defaultBranch main

ENTRYPOINT ["/entrypoint.sh"]
