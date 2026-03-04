import { useState, useEffect, useRef, useCallback } from "react";
import { streamLogs, JobLog } from "../api";

export function useLogStream(jobId: string | undefined, isActive: boolean) {
  const [logs, setLogs] = useState<JobLog[]>([]);
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const connect = useCallback(() => {
    if (!jobId || !isActive) return;

    cleanupRef.current?.();

    const cleanup = streamLogs(
      jobId,
      (log) => {
        setLogs((prev) => [...prev, log]);
      },
      (_data) => {
        setIsDone(true);
      },
      (err) => {
        setError(err.message);
      }
    );

    cleanupRef.current = cleanup;
  }, [jobId, isActive]);

  useEffect(() => {
    connect();
    return () => {
      cleanupRef.current?.();
    };
  }, [connect]);

  return { logs, isDone, error };
}
