"use client";

import { trpc } from "@/lib/trpc";
import { Spinner, EmptyState, AGENT_STATUS_DOT, effectiveAgentStatus, money, timeAgo } from "@/components/ui";
import type { AgentStatus } from "@agos/shared";

export default function AgentsPage() {
  const utils = trpc.useUtils();
  const q = trpc.agent.list.useQuery(undefined, { refetchInterval: 10_000 });
  const pause = trpc.agent.pause.useMutation({ onSuccess: () => utils.agent.list.invalidate() });
  const resume = trpc.agent.resume.useMutation({ onSuccess: () => utils.agent.list.invalidate() });

  if (q.isLoading) return <Spinner />;
  const agents = q.data ?? [];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-end justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
        <p className="font-mono text-[10px] text-dim tracking-widest">
          {agents.length} REGISTERED ·{" "}
          {agents.filter((a) => effectiveAgentStatus(a.status as AgentStatus, a.last_heartbeat_at as string | null) !== "offline").length} LIVE
          · DOT = HEARTBEAT &lt;60S
        </p>
      </div>
      {!agents.length ? (
        <EmptyState text="no agents registered" />
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {agents.map((a) => {
            const status = effectiveAgentStatus(a.status as AgentStatus, a.last_heartbeat_at as string | null);
            const stale = status === "offline" && a.status !== "offline";
            const hb = a.last_heartbeat_at ? timeAgo(a.last_heartbeat_at as string) : "never";
            return (
              <div key={a.id as string} className="panel panel-glow p-5">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-lg bg-onyx border border-edge flex items-center justify-center text-2xl">
                    {String(a.avatar ?? "🤖")}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{String(a.display_name ?? a.name)}</div>
                    <div className="font-mono text-[10px] text-dim truncate">{String(a.machine_id)}</div>
                  </div>
                  <div className="flex items-center gap-1.5" title={stale ? "daemon stopped heartbeating — treated as offline" : undefined}>
                    <span className={`w-2.5 h-2.5 rounded-full ${AGENT_STATUS_DOT[status]}`} />
                    <span className={`font-mono text-[10px] uppercase ${status === "offline" ? "text-lava" : "text-mist"}`}>
                      {status}{stale ? " (STALE)" : ""}
                    </span>
                  </div>
                </div>

                <div className="mt-4 font-mono text-[10px] text-dim space-y-1">
                  <div>MODEL // {String(a.model ?? "—")}</div>
                  <div>HEARTBEAT // {hb}</div>
                  <div>
                    TODAY // <span className="text-flare">{money(a.spent_today_usd)}</span>
                    {a.daily_budget_usd != null && <> of {money(a.daily_budget_usd)}</>}
                  </div>
                  {a.current_task_title != null && (
                    <div className="text-flare truncate">▶ {String(a.current_task_title)}</div>
                  )}
                </div>

                {Array.isArray(a.skills) && a.skills.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {(a.skills as string[]).map((s) => (
                      <span key={s} className="font-mono text-[9px] tracking-wider text-horizon border border-horizon/30 px-1.5 py-0.5 rounded">
                        {s}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-4 pt-3 border-t border-edge/50">
                  {status === "paused" ? (
                    <button
                      onClick={() => resume.mutate({ id: a.id as string })}
                      className="font-mono text-[10px] tracking-widest text-ok border border-ok/40 px-3 py-1.5 rounded hover:bg-ok/10"
                    >
                      ▶ RESUME
                    </button>
                  ) : (
                    <button
                      onClick={() => pause.mutate({ id: a.id as string })}
                      className="font-mono text-[10px] tracking-widest text-mist border border-edge px-3 py-1.5 rounded hover:border-edge-2"
                    >
                      ⏸ PAUSE
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
