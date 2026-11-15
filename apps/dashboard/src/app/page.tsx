"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { Spinner, EmptyState, timeAgo, AGENT_STATUS_DOT, effectiveAgentStatus } from "@/components/ui";
import type { AgentStatus } from "@agos/shared";

export default function OpsCenter() {
  const status = trpc.system.status.useQuery(undefined, { refetchInterval: 10_000 });
  const events = trpc.event.list.useQuery({ limit: 30 }, { refetchInterval: 5_000 });
  const agents = trpc.agent.list.useQuery(undefined, { refetchInterval: 10_000 });
  const spend = trpc.cost.todaySpend.useQuery(undefined, { refetchInterval: 30_000 });

  const c = status.data?.counts;
  const paused = Boolean(
    (status.data?.state?.global_pause as { paused?: boolean } | undefined)?.paused,
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ops Center</h1>
          <p className="font-mono text-[11px] text-dim tracking-widest mt-1">
            SYSTEM {paused ? <span className="text-lava">■ PAUSED</span> : <span className="text-ok">● NOMINAL</span>}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "AGENTS ONLINE", value: `${c?.agents_online ?? "–"}/${c?.agents_total ?? "–"}`, tone: "text-horizon" },
          { label: "QUEUE DEPTH", value: c?.queue_depth ?? "–", tone: "text-horizon" },
          { label: "ACTIVE RUNS", value: c?.active_runs ?? "–", tone: "text-flare" },
          { label: "SPEND TODAY", value: `$${Number(spend.data ?? 0).toFixed(2)}`, tone: "text-flare" },
        ].map((stat) => (
          <div key={stat.label} className="panel panel-glow p-4">
            <div className="font-mono text-[10px] tracking-[0.25em] text-dim">{stat.label}</div>
            <div className={`text-3xl font-semibold mt-2 ${stat.tone}`}>{stat.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-5 gap-6">
        <div className="col-span-3 panel p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-mono text-xs tracking-[0.25em] text-mist">⇶ LIVE EVENT STREAM</h2>
            <Link href="/activity" className="font-mono text-[10px] text-horizon hover:underline">FULL FEED →</Link>
          </div>
          {events.isLoading ? <Spinner /> : !events.data?.length ? (
            <EmptyState text="no events yet" />
          ) : (
            <div className="space-y-0 font-mono text-xs max-h-[420px] overflow-y-auto">
              {events.data.map((e) => (
                <div key={e.id as string} className="flex gap-3 py-1.5 border-b border-edge/50 last:border-0">
                  <span className="text-dim shrink-0 w-16">{timeAgo(e.created_at as string)}</span>
                  <span className="text-flare shrink-0">{String(e.event_type)}</span>
                  <span className="text-dim truncate">{String(e.subject_type)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="col-span-2 panel p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-mono text-xs tracking-[0.25em] text-mist">⬡ AGENTS</h2>
            <Link href="/agents" className="font-mono text-[10px] text-horizon hover:underline">GRID →</Link>
          </div>
          {agents.isLoading ? <Spinner /> : !agents.data?.length ? (
            <EmptyState text="no agents registered" />
          ) : (
            <div className="space-y-2">
              {agents.data.map((a) => (
                <Link
                  key={a.id as string}
                  href={`/agents?focus=${a.id}`}
                  className="flex items-center gap-3 p-2 rounded border border-transparent hover:border-edge transition-colors"
                >
                  <span className="text-xl">{String(a.avatar ?? "🤖")}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">{String(a.display_name ?? a.name)}</div>
                    <div className="font-mono text-[10px] text-dim truncate">
                      {a.current_task_title ? String(a.current_task_title) : String(a.machine_id)}
                    </div>
                  </div>
                  <span
                    className={`w-2 h-2 rounded-full ${AGENT_STATUS_DOT[effectiveAgentStatus(a.status as AgentStatus, a.last_heartbeat_at as string | null)]}`}
                    title={effectiveAgentStatus(a.status as AgentStatus, a.last_heartbeat_at as string | null)}
                  />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
