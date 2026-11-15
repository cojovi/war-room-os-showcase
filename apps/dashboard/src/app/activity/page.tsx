"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Spinner, EmptyState, timeAgo } from "@/components/ui";

const FILTERS = ["all", "task", "run", "agent", "project", "system", "approval", "cost", "orchestrator"] as const;

export default function ActivityPage() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const q = trpc.event.list.useQuery(
    { limit: 200, ...(filter !== "all" ? { type: filter + "." } : {}) },
    { refetchInterval: 5_000 },
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-end justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="font-mono text-[10px] text-dim tracking-widest">THE EVENT SPINE · APPEND-ONLY</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`font-mono text-[10px] tracking-widest px-3 py-1.5 rounded border transition-colors ${
              filter === f ? "border-flare text-flare bg-flare/10" : "border-edge text-dim hover:text-mist"
            }`}
          >
            {f.toUpperCase()}
          </button>
        ))}
      </div>

      {q.isLoading ? <Spinner /> : !q.data?.length ? (
        <EmptyState text="no events match" />
      ) : (
        <div className="panel divide-y divide-edge/40">
          {q.data.map((e) => {
            const payload = e.payload as { data?: Record<string, unknown> };
            const detail = JSON.stringify(payload?.data ?? {});
            return (
              <div key={e.id as string} className="px-4 py-2.5 font-mono text-xs flex items-start gap-4">
                <span className="text-dim shrink-0 w-20">{timeAgo(e.created_at as string)}</span>
                <span className="text-dim shrink-0 w-14">#{String(e.seq)}</span>
                <span className="text-flare shrink-0 w-52 truncate">{String(e.event_type)}</span>
                <span className="text-violet-2 shrink-0 w-16">{String(e.actor_type)}</span>
                <span className="text-mist truncate flex-1" title={detail}>
                  {detail.length > 2 ? detail : String(e.subject_type)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
