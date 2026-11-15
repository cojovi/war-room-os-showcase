"use client";

import Link from "next/link";
import { use, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Spinner, EmptyState, StatusBadge, PriorityPips, money } from "@/components/ui";
import { TaskCreateForm } from "@/components/task-create";
import type { TaskStatus, ProjectGoal } from "@agos/shared";

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = trpc.project.get.useQuery({ id });
  const [showForm, setShowForm] = useState(false);

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <EmptyState text={q.error?.message ?? "not found"} />;

  const { project, tasks } = q.data;
  const goals = (project.goals ?? []) as ProjectGoal[];

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <Link href="/projects" className="font-mono text-[10px] text-dim hover:text-horizon">← PROJECTS</Link>
        <div className="flex items-center justify-between mt-1">
          <h1 className="text-2xl font-semibold tracking-tight">{String(project.name)}</h1>
          <span className="font-mono text-[10px] tracking-widest text-dim uppercase border border-edge px-2 py-1 rounded">
            {String(project.status)}
          </span>
        </div>
        {typeof project.description === "string" && project.description && (
          <p className="text-mist mt-2 max-w-3xl">{project.description}</p>
        )}
      </div>

      {goals.length > 0 && (
        <div className="panel p-4">
          <div className="font-mono text-[10px] tracking-[0.25em] text-dim mb-2">GOALS</div>
          <ul className="space-y-1">
            {goals.map((g) => (
              <li key={g.id} className="text-sm flex items-center gap-2">
                <span className={g.done ? "text-ok" : "text-dim"}>{g.done ? "◈" : "◇"}</span>
                <span className={g.done ? "line-through text-dim" : ""}>{g.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="font-mono text-xs tracking-[0.25em] text-mist">☰ TASKS ({tasks.length})</h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="font-mono text-xs tracking-widest border border-flare/60 text-flare px-4 py-2 rounded hover:bg-flare/10 transition-colors"
        >
          + NEW TASK
        </button>
      </div>

      {showForm && <TaskCreateForm projectId={id} onDone={() => setShowForm(false)} />}

      {!tasks.length ? (
        <EmptyState text="no tasks yet" />
      ) : (
        <div className="panel divide-y divide-edge/50">
          {tasks.map((t) => (
            <Link key={t.id as string} href={`/tasks/${t.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-horizon/5 transition-colors">
              <PriorityPips priority={Number(t.priority)} />
              <span className="flex-1 text-sm truncate">{String(t.title)}</span>
              {t.agent_display_name != null && (
                <span className="font-mono text-[10px] text-violet-2">
                  {String(t.agent_avatar ?? "")} {String(t.agent_display_name)}
                </span>
              )}
              <span className="font-mono text-[10px] text-dim">{money(t.spent_usd)}</span>
              <StatusBadge status={t.status as TaskStatus} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
