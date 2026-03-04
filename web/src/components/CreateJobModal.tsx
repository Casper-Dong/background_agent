import { useState, FormEvent } from "react";
import { createJob, Job } from "../api";

interface Props {
  onCreated: (job: Job) => void;
  onClose: () => void;
}

export function CreateJobModal({ onCreated, onClose }: Props) {
  const [task, setTask] = useState("");
  const [agentType, setAgentType] = useState("auto");
  const [maxIterations, setMaxIterations] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!task.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      const opts: { agent_type?: string; max_iterations: number } = {
        max_iterations: maxIterations,
      };
      if (agentType !== "auto") {
        opts.agent_type = agentType;
      }

      const job = await createJob(task.trim(), opts);
      onCreated(job);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New Agent Job</h2>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="task">Task description</label>
            <textarea
              id="task"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="Fix the flaky test in auth.test.ts by handling the race condition in token refresh..."
              rows={4}
              required
              autoFocus
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="agent">Agent</label>
              <select id="agent" value={agentType} onChange={(e) => setAgentType(e.target.value)}>
                <option value="auto">Auto (recommended)</option>
                <option value="codex">OpenAI Codex</option>
                <option value="claude-code">Claude Code</option>
                <option value="opencode">OpenCode</option>
                <option value="mock">Mock (demo)</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="iterations">Max iterations</label>
              <input
                id="iterations"
                type="number"
                min={1}
                max={20}
                value={maxIterations}
                onChange={(e) => setMaxIterations(Number(e.target.value))}
              />
            </div>
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting || !task.trim()}>
              {submitting ? "Creating..." : "Create Job"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
