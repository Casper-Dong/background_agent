import { useEffect, useRef } from "react";
import { JobLog } from "../api";

const SOURCE_COLORS: Record<string, string> = {
  agent: "#8e5b30",
  verify: "#247a53",
  sandbox: "#6a5b48",
  system: "#7b6852",
};

export function LogViewer({ logs }: { logs: JobLog[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  if (logs.length === 0) {
    return <div className="log-viewer log-empty">Waiting for logs...</div>;
  }

  return (
    <div className="log-viewer">
      {logs.map((log, i) => (
        <div key={log.id || i} className={`log-line log-${log.level}`}>
          <span className="log-time">
            {new Date(log.ts).toLocaleTimeString()}
          </span>
          <span
            className="log-source"
            style={{ color: SOURCE_COLORS[log.source] || "#9ca3af" }}
          >
            [{log.source}]
          </span>
          <span className="log-message">{log.message}</span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
