"use client";

import type { TaskStatus, AgentStatus, Severity } from "@agos/shared";

export const TASK_STATUS_STYLE: Record<TaskStatus, { label: string; cls: string }> = {
  draft: { label: "DRAFT", cls: "text-dim border-edge" },
  pending: { label: "PENDING", cls: "text-horizon border-horizon/40" },
  claimed: { label: "CLAIMED", cls: "text-violet-2 border-violet-2/50" },
  in_progress: { label: "IN PROGRESS", cls: "text-flare border-flare/50" },
  review: { label: "REVIEW", cls: "text-porcelain border-mist/40" },
  blocked: { label: "BLOCKED", cls: "text-lava border-lava/50" },
  done: { label: "DONE", cls: "text-ok border-ok/40" },
  failed: { label: "FAILED", cls: "text-lava border-lava/60" },
  cancelled: { label: "CANCELLED", cls: "text-dim border-edge" },
};

export const AGENT_STATUS_DOT: Record<AgentStatus, string> = {
  offline: "bg-lava",
  idle: "bg-horizon",
  working: "bg-flare pulse-dot",
  blocked: "bg-flare",
  paused: "bg-mist",
  error: "bg-lava pulse-dot",
};

// A dead daemon keeps its last status forever (until the Phase 4 reaper),
// so the UI treats a stale heartbeat as offline regardless of the DB word.
export const HEARTBEAT_STALE_MS = 60_000;

export function effectiveAgentStatus(
  status: AgentStatus,
  lastHeartbeatAt: string | null | undefined,
): AgentStatus {
  if (status === "offline") return "offline";
  if (!lastHeartbeatAt) return "offline";
  const age = Date.now() - new Date(lastHeartbeatAt).getTime();
  return age > HEARTBEAT_STALE_MS ? "offline" : status;
}

export const SEVERITY_COLOR: Record<Severity, string> = {
  info: "text-horizon",
  success: "text-ok",
  warning: "text-flare",
  critical: "text-lava",
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  const s = TASK_STATUS_STYLE[status];
  return (
    <span className={`inline-flex items-center border px-1.5 py-0.5 rounded text-[10px] font-mono tracking-widest ${s.cls}`}>
      {s.label}
    </span>
  );
}

export function PriorityPips({ priority }: { priority: number }) {
  return (
    <span className="font-mono text-[10px] tracking-widest" title={`priority ${priority}`}>
      <span className={priority <= 2 ? "text-flare" : priority === 3 ? "text-horizon" : "text-dim"}>
        {"P" + priority}
      </span>
    </span>
  );
}

export function Spinner() {
  return <div className="text-dim font-mono text-xs animate-pulse py-8 text-center">▚ LOADING…</div>;
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="text-center py-10 text-dim font-mono text-xs tracking-widest uppercase">
      ─ {text} ─
    </div>
  );
}

export function timeAgo(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function money(v: unknown): string {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : 0;
  return `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}
