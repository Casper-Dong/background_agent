import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { getJob, cancelJob, Job } from "../api";
import { StatusBadge } from "../components/StatusBadge";
import { LogViewer } from "../components/LogViewer";
import { AgentChatSidebar } from "../components/AgentChatSidebar";
import { useLogStream } from "../hooks/useLogStream";

const TERMINAL_STATUSES = ["succeeded", "failed", "cancelled"];

export function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [activeTab, setActiveTab] = useState<"logs" | "diff" | "tests">("logs");

  const isActive = !!job && !TERMINAL_STATUSES.includes(job.status);
  const { logs, isDone, error: streamError } = useLogStream(id, !!id, isActive);

  const fetchJob = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getJob(id);
      setJob(data);
    } catch (err) {
      console.error("Failed to fetch job:", err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchJob();
    const interval = setInterval(fetchJob, isActive ? 3000 : 30000);
    return () => clearInterval(interval);
  }, [fetchJob, isActive]);

  // Refetch when stream says done
  useEffect(() => {
    if (isDone) fetchJob();
  }, [isDone, fetchJob]);

  async function handleCancel() {
    if (!job || cancelling) return;
    setCancelling(true);
    try {
      const updated = await cancelJob(job.id);
      setJob(updated);
    } catch (err) {
      console.error("Failed to cancel:", err);
    } finally {
      setCancelling(false);
    }
  }

  if (loading) return <div className="loading">Loading job...</div>;
  if (!job) return <div className="error">Job not found</div>;

  return (
    <div className="job-detail">
      <div className="job-detail-header">
        <Link to="/" className="back-link">&larr; Back</Link>
        <div className="job-detail-title">
          <h1>{job.task}</h1>
          <StatusBadge status={job.status} />
        </div>
        <div className="job-detail-meta">
          <span>ID: {job.id.slice(0, 8)}</span>
          <span>Agent: {job.agent_type}</span>
          <span>Iterations: {job.iteration}/{job.max_iterations}</span>
          {job.branch && <span>Branch: {job.branch}</span>}
          <span>Created: {new Date(job.created_at).toLocaleString()}</span>
        </div>
      </div>

      <div className="job-detail-actions">
        {isActive && (
          <button
            className="btn btn-danger"
            onClick={handleCancel}
            disabled={cancelling}
          >
            {cancelling ? "Cancelling..." : "Cancel Job"}
          </button>
        )}
        {job.pr_url && (
          <a href={job.pr_url} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
            View PR #{job.pr_number}
          </a>
        )}
      </div>

      {job.error && (
        <div className="job-error">
          <strong>Error:</strong> {job.error}
        </div>
      )}

      <div className="job-chat-layout">
        <section className="job-chat-main">
          <AgentChatSidebar
            job={job}
            logs={logs}
            isActive={isActive}
            streamError={streamError}
          />
        </section>

        <aside className="job-side-panel">
          <div className="tabs">
            <button
              className={`tab ${activeTab === "logs" ? "tab-active" : ""}`}
              onClick={() => setActiveTab("logs")}
            >
              Logs {isActive && <span className="pulse" />}
            </button>
            <button
              className={`tab ${activeTab === "diff" ? "tab-active" : ""}`}
              onClick={() => setActiveTab("diff")}
            >
              Diff
            </button>
            <button
              className={`tab ${activeTab === "tests" ? "tab-active" : ""}`}
              onClick={() => setActiveTab("tests")}
            >
              Tests
            </button>
          </div>

          <div className="tab-content">
            {activeTab === "logs" && <LogViewer logs={logs} />}

            {activeTab === "diff" && (
              <div className="artifact-viewer">
                {job.diff_summary ? (
                  <pre className="code-block">{job.diff_summary}</pre>
                ) : (
                  <p className="empty-artifact">No diff available yet.</p>
                )}
              </div>
            )}

            {activeTab === "tests" && (
              <div className="artifact-viewer">
                {job.test_output ? (
                  <pre className="code-block">{job.test_output}</pre>
                ) : (
                  <p className="empty-artifact">No test output available yet.</p>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
