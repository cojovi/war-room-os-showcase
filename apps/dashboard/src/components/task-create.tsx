"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { ASSIGNMENT_MODES, type AssignmentMode } from "@agos/shared";

export function TaskCreateForm({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const utils = trpc.useUtils();
  const create = trpc.task.create.useMutation({
    onSuccess: () => {
      utils.project.get.invalidate({ id: projectId });
      utils.task.listAll.invalidate();
      onDone();
    },
  });

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState(3);
  const [mode, setMode] = useState<AssignmentMode>("manual");
  const [skills, setSkills] = useState("");
  const [criteria, setCriteria] = useState<string[]>([""]);
  const [proofRequired, setProofRequired] = useState(true);
  const [submitNow, setSubmitNow] = useState(true);

  const validCriteria = criteria.map((c) => c.trim()).filter(Boolean);

  return (
    <form
      className="panel panel-glow p-5 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate({
          projectId,
          title: title.trim(),
          description: description.trim() || undefined,
          priority,
          assignmentMode: mode,
          requiredSkills: skills.split(",").map((s) => s.trim()).filter(Boolean),
          acceptanceCriteria: validCriteria.map((text, i) => ({
            id: `c${i + 1}`, text, met: false, verified_by: null,
          })),
          proofRequired,
          submit: submitNow && validCriteria.length > 0,
        });
      }}
    >
      <div className="font-mono text-xs tracking-[0.25em] text-mist">+ NEW TASK</div>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Task title"
        className="w-full bg-onyx border border-edge rounded px-3 py-2 text-sm outline-none focus:border-edge-2"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (markdown) — the doc body"
        rows={3}
        className="w-full bg-onyx border border-edge rounded px-3 py-2 text-sm outline-none focus:border-edge-2 resize-y"
      />

      <div>
        <div className="font-mono text-[10px] tracking-widest text-dim mb-2">
          ACCEPTANCE CRITERIA — REQUIRED TO LEAVE DRAFT. AGENTS DO NOT VIBE-COMPLETE.
        </div>
        {criteria.map((c, i) => (
          <div key={i} className="flex gap-2 mb-2">
            <input
              value={c}
              onChange={(e) => setCriteria(criteria.map((v, j) => (j === i ? e.target.value : v)))}
              placeholder={`Criterion ${i + 1} — how do we know it's done?`}
              className="flex-1 bg-onyx border border-edge rounded px-3 py-1.5 text-sm outline-none focus:border-edge-2"
            />
            {criteria.length > 1 && (
              <button type="button" onClick={() => setCriteria(criteria.filter((_, j) => j !== i))}
                className="text-dim hover:text-lava px-2">✕</button>
            )}
          </div>
        ))}
        <button type="button" onClick={() => setCriteria([...criteria, ""])}
          className="font-mono text-[10px] text-horizon hover:underline">+ ADD CRITERION</button>
      </div>

      <div className="flex flex-wrap gap-4 items-center">
        <label className="font-mono text-[10px] text-dim tracking-widest flex items-center gap-2">
          PRIORITY
          <select value={priority} onChange={(e) => setPriority(Number(e.target.value))}
            className="bg-onyx border border-edge rounded px-2 py-1 text-porcelain">
            {[1, 2, 3, 4, 5].map((p) => <option key={p} value={p}>P{p}</option>)}
          </select>
        </label>
        <label className="font-mono text-[10px] text-dim tracking-widest flex items-center gap-2">
          MODE
          <select value={mode} onChange={(e) => setMode(e.target.value as AssignmentMode)}
            className="bg-onyx border border-edge rounded px-2 py-1 text-porcelain">
            {ASSIGNMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <input
          value={skills}
          onChange={(e) => setSkills(e.target.value)}
          placeholder={
            mode === "manual"
              ? "skills optional"
              : "leave blank → auto-route from roster"
          }
          title="Primary skills: tech (Gordon), bolt (BoltAgent), billing, estimating (Hermes), content (Loki), mini-homes (Manni). Blank + autonomous/suggested auto-picks from title/description."
          className="bg-onyx border border-edge rounded px-3 py-1.5 text-xs font-mono outline-none focus:border-edge-2 w-64"
        />
        <label className="font-mono text-[10px] text-dim tracking-widest flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={proofRequired} onChange={(e) => setProofRequired(e.target.checked)} className="accent-[#ff7a00]" />
          PROOF REQUIRED
        </label>
        <label className="font-mono text-[10px] text-dim tracking-widest flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={submitNow} onChange={(e) => setSubmitNow(e.target.checked)} className="accent-[#ff7a00]" />
          SUBMIT TO QUEUE (vs save as draft)
        </label>
      </div>

      {create.error && <p className="text-lava font-mono text-xs">{create.error.message}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={create.isPending || !title.trim()}
          className="font-mono text-xs tracking-widest bg-flare text-void font-bold px-4 py-2 rounded hover:bg-flare/85 disabled:opacity-40"
        >
          {create.isPending ? "CREATING…" : "CREATE TASK"}
        </button>
        <button type="button" onClick={onDone} className="font-mono text-xs text-dim px-3 hover:text-mist">CANCEL</button>
      </div>
    </form>
  );
}
