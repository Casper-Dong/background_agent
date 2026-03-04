-- Background Agent schema
-- Applied automatically on first Postgres boot via docker-entrypoint-initdb.d

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Job status enum ────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE job_status AS ENUM (
    'queued',
    'running',
    'verifying',
    'succeeded',
    'failed',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ── Jobs table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task          TEXT          NOT NULL,
  status        job_status    NOT NULL DEFAULT 'queued',
  repo_url      TEXT          NOT NULL DEFAULT '',
  branch        TEXT,
  base_branch   TEXT          NOT NULL DEFAULT 'main',
  pr_url        TEXT,
  pr_number     INTEGER,
  agent_type    TEXT          NOT NULL DEFAULT 'mock',
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  container_id  TEXT,
  iteration     INTEGER       NOT NULL DEFAULT 0,
  max_iterations INTEGER      NOT NULL DEFAULT 5,
  timeout_seconds INTEGER     NOT NULL DEFAULT 1800,
  error         TEXT,
  diff_summary  TEXT,
  test_output   TEXT,
  slack_channel TEXT,
  slack_thread_ts TEXT,
  created_by    TEXT,
  metadata      JSONB         NOT NULL DEFAULT '{}'
);

-- ── Job logs ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_logs (
  id         BIGSERIAL     PRIMARY KEY,
  job_id     UUID          NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  ts         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  level      TEXT          NOT NULL DEFAULT 'info',
  message    TEXT          NOT NULL,
  source     TEXT          NOT NULL DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS idx_job_logs_job_id ON job_logs(job_id, id);

-- ── Artifacts ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS artifacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      UUID        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  type        TEXT        NOT NULL,
  name        TEXT        NOT NULL,
  content     TEXT,
  url         TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_artifacts_job_id ON artifacts(job_id);

-- ── Settings (KV store) ────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       JSONB       NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Helper: auto-update updated_at ─────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_jobs_updated_at ON jobs;
CREATE TRIGGER trg_jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
