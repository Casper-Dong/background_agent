import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { listJobs, Job } from "../api";
import { JobCard } from "../components/JobCard";
import { CreateJobModal } from "../components/CreateJobModal";

export function Dashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const navigate = useNavigate();

  const fetchJobs = useCallback(async () => {
    try {
      const data = await listJobs();
      setJobs(data);
    } catch (err) {
      console.error("Failed to fetch jobs:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Jobs</h1>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          + New Job
        </button>
      </div>

      {loading ? (
        <div className="loading">Loading jobs...</div>
      ) : jobs.length === 0 ? (
        <div className="empty-state">
          <p>No jobs yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="job-grid">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateJobModal
          onClose={() => setShowCreate(false)}
          onCreated={(job) => {
            setShowCreate(false);
            navigate(`/jobs/${job.id}`);
          }}
        />
      )}
    </div>
  );
}
