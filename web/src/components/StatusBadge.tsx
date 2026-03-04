const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  queued: { label: "Queued", className: "badge badge-queued" },
  running: { label: "Running", className: "badge badge-running" },
  verifying: { label: "Verifying", className: "badge badge-running" },
  succeeded: { label: "Succeeded", className: "badge badge-succeeded" },
  failed: { label: "Failed", className: "badge badge-failed" },
  cancelled: { label: "Cancelled", className: "badge badge-cancelled" },
};

export function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || { label: status, className: "badge" };
  return <span className={config.className}>{config.label}</span>;
}
