"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { Spinner, EmptyState, StatusBadge, PriorityPips, money, timeAgo } from "@/components/ui";
import { TASK_STATUSES, type TaskStatus } from "@agos/shared";

export default function TasksPage() {
  const q = trpc.task.listAll.useQuery(undefined, { refetchInterval: 10_000 });

  if (q.isLoading) return <Spinner />;
  const tasks = q.data ?? [];

  const byStatus = new Map<TaskStatus, typeof tasks>();
  for (const s of TASK_STATUSES) byStatus.set(s, []);
  for (const t of tasks) byStatus.get(t.status as TaskStatus)?.push(t);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-end justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
        <p className="font-mono text-[10px] text-dim tracking-widest">
          {tasks.length} TOTAL · GROUPED BY STATUS · CREATE FROM A PROJECT PAGE
        </p>
      </div>
      {!tasks.length ? (
        <EmptyState text="no tasks anywhere" />
      ) : (
        TASK_STATUSES.filter((s) => (byStatus.get(s)?.length ?? 0) > 0).map((s) => (
          <div key={s}>
            <div className="flex items-center gap-3 mb-2">
              <StatusBadge status={s} />
              <span className="font-mono text-[10px] text-dim">{byStatus.get(s)!.length}</span>
            </div>
            <div className="panel divide-y divide-edge/50">
              {byStatus.get(s)!.map((t) => (
                <Link key={t.id as string} href={`/tasks/${t.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-horizon/5 transition-colors">
                  <PriorityPips priority={Number(t.priority)} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{String(t.title)}</div>
                    <div className="font-mono text-[10px] text-dim">{String(t.project_name)}</div>
                  </div>
                  {t.agent_display_name != null && (
                    <span className="font-mono text-[10px] text-violet-2">
                      {String(t.agent_avatar ?? "")} {String(t.agent_display_name)}
                    </span>
                  )}
                  <span className="font-mono text-[10px] text-dim">{money(t.spent_usd)}</span>
                  <span className="font-mono text-[10px] text-dim w-16 text-right">{timeAgo(t.created_at as string)}</span>
                </Link>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
