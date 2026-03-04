import { Link } from "react-router-dom";
import { Job } from "../api";
import { StatusBadge } from "./StatusBadge";

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function JobCard({ job }: { job: Job }) {
  return (
    <Link to={`/jobs/${job.id}`} className="job-card">
      <div className="job-card-header">
        <StatusBadge status={job.status} />
        <span className="job-card-time">{timeAgo(job.created_at)}</span>
      </div>
      <p className="job-card-task">{job.task}</p>
      <div className="job-card-meta">
        <span className="job-card-id">{job.id.slice(0, 8)}</span>
        <span className="job-card-agent">{job.agent_type}</span>
        {job.branch && <span className="job-card-branch">{job.branch}</span>}
      </div>
    </Link>
  );
}
