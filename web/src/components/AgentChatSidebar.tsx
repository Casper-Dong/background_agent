import { useEffect, useMemo, useRef, useState } from "react";
import { Job, JobLog } from "../api";

type ChatKind = "message" | "tool" | "thinking" | "system";
type ChatFilter = "all" | ChatKind;

interface ChatEvent {
  key: string;
  kind: ChatKind;
  text: string;
  ts: string;
  source: string;
}

const TOOL_PATTERNS = [
  /\btool\b/i,
  /\bfunction call\b/i,
  /\bexec_command\b/i,
  /\bwrite_stdin\b/i,
  /\bapply_patch\b/i,
  /\brunning verify\.sh\b/i,
  /\brunning verification\b/i,
  /\brunning agent\b/i,
  /\bcloning repo\b/i,
  /\binstalling .*dependencies\b/i,
  /\bcommitting changes\b/i,
  /\bpushing branch\b/i,
  /\b(git|npm|pnpm|yarn|npx|node|python|pytest|cargo|go test|docker|flyctl)\b/i,
];

const THINKING_PATTERNS = [
  /\bplanning\b/i,
  /\banaly(s|z)ing\b/i,
  /\breasoning\b/i,
  /\binvestigat/i,
  /\biterat/i,
  /\bchecking\b/i,
  /\breviewing\b/i,
  /\bscanning\b/i,
  /\bexploring\b/i,
  /\bpreparing\b/i,
  /\bconsidering\b/i,
];

const SYSTEM_PATTERNS = [
  /\bjob started\b/i,
  /\bsandbox exited\b/i,
  /\bjob completed\b/i,
  /\bjob failed\b/i,
  /\bpr created\b/i,
  /\bbranch:\b/i,
  /\bsandbox container\b/i,
];

function toKey(log: JobLog, index: number): string {
  if (log.id !== undefined && log.id !== null && String(log.id).trim() !== "") {
    return `id:${String(log.id)}`;
  }
  return `idx:${index}:${log.ts}:${log.source}`;
}

function normalizeMessage(message: string): string {
  let text = message.trim();

  // Strip one or more RFC3339 timestamps prefixed by docker log streaming.
  const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s+/;
  while (timestamp.test(text)) {
    text = text.replace(timestamp, "");
  }

  text = text.replace(/^\[(sandbox|agent|verify)\]\s*\d{2}:\d{2}:\d{2}\s*/i, "");
  text = text.replace(/^\[(sandbox|agent|verify)\]\s*/i, "");

  return text.trim();
}

function classifyLog(log: JobLog, normalizedText: string): ChatKind {
  const composite = `${log.source} ${normalizedText}`;

  if (TOOL_PATTERNS.some((pattern) => pattern.test(composite))) {
    return "tool";
  }

  if (THINKING_PATTERNS.some((pattern) => pattern.test(composite))) {
    return "thinking";
  }

  if (log.source === "sandbox" || log.source === "agent") {
    return "thinking";
  }

  if (SYSTEM_PATTERNS.some((pattern) => pattern.test(composite))) {
    return "system";
  }

  return "message";
}

function toChatEvent(log: JobLog, index: number): ChatEvent {
  const text = normalizeMessage(log.message);
  return {
    key: toKey(log, index),
    text: text || log.message,
    kind: classifyLog(log, text),
    ts: log.ts,
    source: log.source,
  };
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function kindLabel(kind: ChatKind): string {
  if (kind === "tool") return "Tool Call";
  if (kind === "thinking") return "Thinking";
  if (kind === "system") return "System";
  return "Message";
}

export function AgentChatSidebar({
  job,
  logs,
  isActive,
  streamError,
}: {
  job: Job;
  logs: JobLog[];
  isActive: boolean;
  streamError: string | null;
}) {
  const [filter, setFilter] = useState<ChatFilter>("all");
  const threadRef = useRef<HTMLDivElement>(null);

  const events = useMemo(() => logs.map(toChatEvent), [logs]);
  const filteredEvents = useMemo(
    () => (filter === "all" ? events : events.filter((event) => event.kind === filter)),
    [events, filter]
  );

  const counters = useMemo(
    () => ({
      all: events.length,
      message: events.filter((event) => event.kind === "message").length,
      tool: events.filter((event) => event.kind === "tool").length,
      thinking: events.filter((event) => event.kind === "thinking").length,
      system: events.filter((event) => event.kind === "system").length,
    }),
    [events]
  );

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [filteredEvents.length, isActive]);

  return (
    <aside className="chat-sidebar">
      <div className="chat-sidebar-header">
        <div>
          <p className="chat-eyebrow">Agent Stream</p>
          <h2>Live Sidebar</h2>
        </div>
        <span className={`stream-badge ${isActive ? "stream-live" : "stream-idle"}`}>
          {isActive ? "Live" : "Idle"}
        </span>
      </div>

      <div className="chat-filters">
        <button
          className={`chat-filter ${filter === "all" ? "chat-filter-active" : ""}`}
          onClick={() => setFilter("all")}
        >
          All {counters.all}
        </button>
        <button
          className={`chat-filter ${filter === "message" ? "chat-filter-active" : ""}`}
          onClick={() => setFilter("message")}
        >
          Msg {counters.message}
        </button>
        <button
          className={`chat-filter ${filter === "tool" ? "chat-filter-active" : ""}`}
          onClick={() => setFilter("tool")}
        >
          Tools {counters.tool}
        </button>
        <button
          className={`chat-filter ${filter === "thinking" ? "chat-filter-active" : ""}`}
          onClick={() => setFilter("thinking")}
        >
          Thinking {counters.thinking}
        </button>
      </div>

      <div className="chat-thread" ref={threadRef}>
        <article className="chat-item chat-user">
          <div className="chat-item-meta">
            <span className="chat-role">User</span>
            <span className="chat-time">{new Date(job.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          </div>
          <p className="chat-body">{job.task}</p>
        </article>

        {filteredEvents.map((event) => (
          <article key={event.key} className={`chat-item chat-${event.kind}`}>
            <div className="chat-item-meta">
              <span className="chat-role">{kindLabel(event.kind)}</span>
              <span className="chat-time">{formatTime(event.ts)}</span>
            </div>
            <p className="chat-body">{event.text}</p>
            <span className="chat-source">{event.source}</span>
          </article>
        ))}

        {filteredEvents.length === 0 && (
          <div className="chat-empty">No events for this filter yet.</div>
        )}

        {isActive && (
          <div className="chat-streaming">
            <span className="typing-dot" />
            Streaming agent activity...
          </div>
        )}

        {streamError && <div className="chat-stream-error">Stream error: {streamError}</div>}
      </div>
    </aside>
  );
}
