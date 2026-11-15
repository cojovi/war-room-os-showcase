"use client";

import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Spinner, EmptyState, money } from "@/components/ui";

export default function ProjectsPage() {
  const utils = trpc.useUtils();
  const projects = trpc.project.list.useQuery();
  const create = trpc.project.create.useMutation({
    onSuccess: () => { utils.project.list.invalidate(); setShowForm(false); setName(""); setDescription(""); },
  });

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="font-mono text-xs tracking-widest border border-flare/60 text-flare px-4 py-2 rounded hover:bg-flare/10 transition-colors"
        >
          + NEW PROJECT
        </button>
      </div>

      {showForm && (
        <form
          className="panel panel-glow p-5 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate({ name: name.trim(), description: description.trim() || undefined });
          }}
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
            className="w-full bg-onyx border border-edge rounded px-3 py-2 text-sm outline-none focus:border-edge-2"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (markdown)"
            rows={3}
            className="w-full bg-onyx border border-edge rounded px-3 py-2 text-sm outline-none focus:border-edge-2 resize-y"
          />
          {create.error && <p className="text-lava font-mono text-xs">{create.error.message}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={create.isPending || !name.trim()}
              className="font-mono text-xs tracking-widest bg-flare text-void font-bold px-4 py-2 rounded hover:bg-flare/85 disabled:opacity-40"
            >
              CREATE
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="font-mono text-xs text-dim px-3 hover:text-mist">
              CANCEL
            </button>
          </div>
        </form>
      )}

      {projects.isLoading ? <Spinner /> : !projects.data?.length ? (
        <EmptyState text="no projects — create the first one" />
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {projects.data.map((p) => {
            const total = Number(p.task_count ?? 0);
            const done = Number(p.done_count ?? 0);
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            return (
              <Link key={p.id as string} href={`/projects/${p.id}`} className="panel panel-glow p-5 hover:border-edge-2 transition-colors block">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-lg font-semibold">{String(p.name)}</h2>
                  <span className="font-mono text-[10px] tracking-widest text-dim uppercase border border-edge px-1.5 py-0.5 rounded">
                    {String(p.status)}
                  </span>
                </div>
                {typeof p.description === "string" && p.description && (
                  <p className="text-sm text-mist mt-1 line-clamp-2">{p.description}</p>
                )}
                <div className="mt-4 flex items-center gap-4 font-mono text-[11px] text-dim">
                  <span>{done}/{total} TASKS</span>
                  <span>SPENT {money(p.spent_usd)}</span>
                </div>
                <div className="mt-2 h-1 bg-onyx rounded overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-violet-2 to-flare" style={{ width: `${pct}%` }} />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
