import { useState, useEffect, useRef } from "react";
import { streamLogs, JobLog } from "../api";

function makeLogKey(log: JobLog): string {
  if (log.id !== undefined && log.id !== null && String(log.id).trim() !== "") {
    return `id:${String(log.id)}`;
  }
  return `sig:${log.ts}:${log.level}:${log.source}:${log.message}`;
}

export function useLogStream(
  jobId: string | undefined,
  enabled: boolean,
  shouldRetry: boolean
) {
  const [logs, setLogs] = useState<JobLog[]>([]);
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const doneRef = useRef(false);

  useEffect(() => {
    setLogs([]);
    setIsDone(false);
    setError(null);
    doneRef.current = false;
    seenRef.current.clear();
  }, [jobId]);

  useEffect(() => {
    if (!jobId || !enabled) return;
    let disposed = false;

    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      if (disposed) return;

      cleanupRef.current?.();
      setError(null);

      const cleanup = streamLogs(
        jobId,
        (log) => {
          const key = makeLogKey(log);
          if (seenRef.current.has(key)) return;
          seenRef.current.add(key);
          setError(null);
          setLogs((prev) => [...prev, log]);
        },
        (_data) => {
          setIsDone(true);
          doneRef.current = true;
          setError(null);
        },
        (err) => {
          if (disposed) return;
          setError(err.message);
          if (shouldRetry && !doneRef.current) {
            retryTimer = setTimeout(connect, 1500);
          }
        }
      );

      cleanupRef.current = cleanup;
    };

    connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      cleanupRef.current?.();
    };
  }, [enabled, shouldRetry, jobId]);

  return { logs, isDone, error };
}
