"use client";

import Link from "next/link";
import { use, useState } from "react";
import ReactMarkdown from "react-markdown";
import { trpc } from "@/lib/trpc";
import { Spinner, EmptyState, StatusBadge, PriorityPips, timeAgo, money } from "@/components/ui";
import {
  LEGAL_TASK_TRANSITIONS,
  type TaskStatus,
  type AcceptanceCriterion,
  type CommentKind,
} from "@agos/shared";

export default function TaskDoc({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const utils = trpc.useUtils();
  const q = trpc.task.get.useQuery({ id }, { refetchInterval: 10_000 });

  const invalidate = () => utils.task.get.invalidate({ id });
  const setStatus = trpc.task.setStatus.useMutation({ onSuccess: invalidate });
  const checkCriterion = trpc.task.checkCriterion.useMutation({ onSuccess: invalidate });
  const setCriteria = trpc.task.setCriteria.useMutation({ onSuccess: invalidate });
  const addComment = trpc.comment.add.useMutation({ onSuccess: () => { invalidate(); setBody(""); } });
  const attach = trpc.artifact.attach.useMutation({
    onSuccess: () => { invalidate(); setArtifactName(""); setArtifactContent(""); setShowArtifactForm(false); },
  });

  const [body, setBody] = useState("");
  const [kind, setKind] = useState<CommentKind>("comment");
  const [newCriterion, setNewCriterion] = useState("");
  const [showArtifactForm, setShowArtifactForm] = useState(false);
  const [artifactName, setArtifactName] = useState("");
  const [artifactContent, setArtifactContent] = useState("");
  const [artifactIsEvidence, setArtifactIsEvidence] = useState(true);

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <EmptyState text={q.error?.message ?? "not found"} />;

  const { task, comments, artifacts, runs } = q.data;
  const criteria = (task.acceptance_criteria ?? []) as AcceptanceCriterion[];
  const status = task.status as TaskStatus;
  const nextStates = LEGAL_TASK_TRANSITIONS[status] ?? [];
  const metCount = criteria.filter((c) => c.met).length;

  const mutationError = setStatus.error?.message ?? checkCriterion.error?.message ?? setCriteria.error?.message;

  return (
    <div className="max-w-6xl mx-auto grid grid-cols-3 gap-6">
      {/* ── main column: the living doc ── */}
      <div className="col-span-2 space-y-5">
        <div>
          <Link href={`/projects/${task.project_id}`} className="font-mono text-[10px] text-dim hover:text-horizon">
            ← {String(task.project_name).toUpperCase()}
          </Link>
          <div className="flex items-start justify-between gap-4 mt-1">
            <h1 className="text-2xl font-semibold tracking-tight">{String(task.title)}</h1>
            <div className="flex items-center gap-2 shrink-0 mt-1">
              <PriorityPips priority={Number(task.priority)} />
              <StatusBadge status={status} />
            </div>
          </div>
        </div>

        {typeof task.ai_summary === "string" && task.ai_summary && (
          <div className="panel p-4 border-l-2 border-l-violet-2">
            <div className="font-mono text-[10px] tracking-[0.25em] text-violet-2 mb-1.5">◈ AI SUMMARY</div>
            <p className="text-sm text-mist leading-relaxed">{task.ai_summary}</p>
          </div>
        )}

        {mutationError && (
          <div className="panel p-3 border-l-2 border-l-lava">
            <p className="font-mono text-xs text-lava">{mutationError}</p>
          </div>
        )}

        <div className="panel p-5">
          <div className="font-mono text-[10px] tracking-[0.25em] text-dim mb-3">DESCRIPTION</div>
          {typeof task.description === "string" && task.description ? (
            <div className="md-body text-sm text-porcelain/90">
              <ReactMarkdown>{task.description}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-dim text-sm italic">No description.</p>
          )}
        </div>

        <div className="panel p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="font-mono text-[10px] tracking-[0.25em] text-dim">
              ACCEPTANCE CRITERIA — {metCount}/{criteria.length} MET
            </div>
            {Boolean(task.proof_required) && (
              <span className="font-mono text-[10px] text-flare tracking-widest">⚠ PROOF REQUIRED</span>
            )}
          </div>
          <div className="space-y-2">
            {criteria.map((c) => (
              <label key={c.id} className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={c.met}
                  onChange={(e) => checkCriterion.mutate({ id, criterionId: c.id, met: e.target.checked })}
                  className="mt-1 accent-[#57d9a3]"
                />
                <span className={`text-sm ${c.met ? "text-dim line-through" : "text-porcelain/90"}`}>
                  {c.text}
                  {c.met && c.verified_by && (
                    <span className="font-mono text-[10px] text-ok ml-2 no-underline">✓ {c.verified_by}</span>
                  )}
                </span>
              </label>
            ))}
          </div>
          <form
            className="flex gap-2 mt-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newCriterion.trim()) return;
              setCriteria.mutate({
                id,
                criteria: [...criteria, { id: `c${Date.now()}`, text: newCriterion.trim(), met: false, verified_by: null }],
              });
              setNewCriterion("");
            }}
          >
            <input
              value={newCriterion}
              onChange={(e) => setNewCriterion(e.target.value)}
              placeholder="Add criterion…"
              className="flex-1 bg-onyx border border-edge rounded px-3 py-1.5 text-sm outline-none focus:border-edge-2"
            />
            <button type="submit" className="font-mono text-[10px] text-horizon hover:underline shrink-0">+ ADD</button>
          </form>
        </div>

        {/* thread */}
        <div className="panel p-5">
          <div className="font-mono text-[10px] tracking-[0.25em] text-dim mb-4">
            THREAD — {comments.length} {comments.length === 1 ? "COMMENT" : "COMMENTS"}
          </div>
          <div className="space-y-4">
            {comments.map((c) => (
              <div key={c.id as string} className="flex gap-3">
                <div className="w-8 h-8 rounded bg-onyx border border-edge flex items-center justify-center text-sm shrink-0">
                  {c.author_type === "human" ? "👤" : c.author_type === "system" ? "⚙" : String(c.agent_avatar ?? "🤖")}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold">
                      {c.author_type === "human" ? "Cody" : c.author_type === "system" ? "System" : String(c.agent_display_name ?? "Agent")}
                    </span>
                    {c.kind !== "comment" && (
                      <span className="font-mono text-[9px] tracking-widest text-violet-2 border border-violet-2/40 px-1 rounded uppercase">
                        {String(c.kind)}
                      </span>
                    )}
                    <span className="font-mono text-[10px] text-dim">{timeAgo(c.created_at as string)}</span>
                  </div>
                  <div className="md-body text-sm text-porcelain/85 mt-0.5">
                    <ReactMarkdown>{String(c.body)}</ReactMarkdown>
                  </div>
                </div>
              </div>
            ))}
            {!comments.length && <p className="text-dim text-sm italic">No comments yet.</p>}
          </div>

          <form
            className="mt-5 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (body.trim()) addComment.mutate({ taskId: id, body: body.trim(), kind });
            }}
          >
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Comment (markdown, @mentions)…"
              rows={3}
              className="w-full bg-onyx border border-edge rounded px-3 py-2 text-sm outline-none focus:border-edge-2 resize-y"
            />
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={addComment.isPending || !body.trim()}
                className="font-mono text-xs tracking-widest bg-flare text-void font-bold px-4 py-1.5 rounded hover:bg-flare/85 disabled:opacity-40"
              >
                POST
              </button>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as CommentKind)}
                className="bg-onyx border border-edge rounded px-2 py-1 font-mono text-[10px] text-mist"
              >
                {(["comment", "question", "decision", "handoff"] as const).map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
              {addComment.error && <span className="text-lava font-mono text-xs">{addComment.error.message}</span>}
            </div>
          </form>
        </div>
      </div>

      {/* ── right rail: state, artifacts, runs, cost ── */}
      <div className="space-y-5">
        <div className="panel p-4">
          <div className="font-mono text-[10px] tracking-[0.25em] text-dim mb-3">STATE CONTROL</div>
          <div className="flex flex-wrap gap-2">
            {nextStates.length ? nextStates.map((s) => (
              <button
                key={s}
                onClick={() => setStatus.mutate({ id, status: s })}
                disabled={setStatus.isPending}
                className={`font-mono text-[10px] tracking-widest border px-2.5 py-1.5 rounded transition-colors ${
                  s === "done" ? "border-ok/50 text-ok hover:bg-ok/10"
                  : s === "cancelled" || s === "failed" ? "border-lava/50 text-lava hover:bg-lava/10"
                  : "border-edge text-mist hover:border-edge-2 hover:text-porcelain"
                }`}
              >
                → {s.toUpperCase().replace("_", " ")}
              </button>
            )) : <span className="font-mono text-[10px] text-dim">TERMINAL STATE</span>}
          </div>
          <div className="mt-3 font-mono text-[10px] text-dim leading-relaxed">
            MODE: {String(task.assignment_mode).toUpperCase()}<br />
            {Array.isArray(task.required_skills) && task.required_skills.length > 0 && (
              <>SKILLS: {(task.required_skills as string[]).join(", ")}<br /></>
            )}
            {task.agent_display_name != null && <>AGENT: {String(task.agent_avatar ?? "")} {String(task.agent_display_name)}<br /></>}
            RETRIES: {Number(task.retry_count)}/{Number(task.max_retries)}
          </div>
        </div>

        <div className="panel p-4">
          <div className="font-mono text-[10px] tracking-[0.25em] text-dim mb-2">COST METER</div>
          <div className="text-2xl font-semibold text-flare">{money(task.spent_usd)}</div>
          <div className="font-mono text-[10px] text-dim mt-1">
            BUDGET {task.budget_usd != null ? money(task.budget_usd) : "PROJECT DEFAULT"}
          </div>
        </div>

        <div className="panel p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="font-mono text-[10px] tracking-[0.25em] text-dim">ARTIFACTS ({artifacts.length})</div>
            <button onClick={() => setShowArtifactForm((v) => !v)} className="font-mono text-[10px] text-horizon hover:underline">
              + ATTACH
            </button>
          </div>
          {showArtifactForm && (
            <form
              className="space-y-2 mb-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (artifactName.trim()) {
                  attach.mutate({
                    taskId: id, name: artifactName.trim(), kind: artifactIsEvidence ? "evidence" : "file",
                    inlineContent: artifactContent || null, isEvidence: artifactIsEvidence,
                  });
                }
              }}
            >
              <input
                value={artifactName}
                onChange={(e) => setArtifactName(e.target.value)}
                placeholder="Name"
                className="w-full bg-onyx border border-edge rounded px-2 py-1.5 text-xs outline-none focus:border-edge-2"
              />
              <textarea
                value={artifactContent}
                onChange={(e) => setArtifactContent(e.target.value)}
                placeholder="Inline content / link"
                rows={2}
                className="w-full bg-onyx border border-edge rounded px-2 py-1.5 text-xs outline-none focus:border-edge-2"
              />
              <label className="font-mono text-[10px] text-dim flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={artifactIsEvidence} onChange={(e) => setArtifactIsEvidence(e.target.checked)} className="accent-[#ff7a00]" />
                COUNTS AS EVIDENCE
              </label>
              <button type="submit" disabled={attach.isPending} className="font-mono text-[10px] tracking-widest bg-violet-2 text-void font-bold px-3 py-1.5 rounded hover:bg-violet-2/85 disabled:opacity-40">
                ATTACH
              </button>
            </form>
          )}
          <div className="space-y-2">
            {artifacts.map((a) => (
              <div key={a.id as string} className="border border-edge rounded p-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-violet-2 uppercase">{String(a.kind)}</span>
                  <span className="text-xs truncate flex-1">{String(a.name)}</span>
                  {Boolean(a.is_evidence) && <span className="font-mono text-[9px] text-ok border border-ok/40 px-1 rounded">EVIDENCE</span>}
                  <span className="font-mono text-[9px] text-dim">v{Number(a.version)}</span>
                </div>
                {typeof a.inline_content === "string" && a.inline_content && (
                  <pre className="font-mono text-[10px] text-mist mt-1.5 bg-onyx rounded p-1.5 overflow-x-auto max-h-24">{a.inline_content}</pre>
                )}
              </div>
            ))}
            {!artifacts.length && <p className="text-dim text-xs italic">None attached.</p>}
          </div>
        </div>

        <div className="panel p-4">
          <div className="font-mono text-[10px] tracking-[0.25em] text-dim mb-3">RUN HISTORY ({runs.length})</div>
          <div className="space-y-2">
            {runs.map((r) => (
              <div key={r.id as string} className="border border-edge rounded p-2 font-mono text-[10px]">
                <div className="flex items-center gap-2">
                  <span className="text-mist">#{Number(r.attempt_number)}</span>
                  <span>{String(r.agent_avatar ?? "")} {String(r.agent_display_name)}</span>
                  <span className={`ml-auto uppercase ${
                    r.status === "succeeded" ? "text-ok" : ["failed", "killed", "abandoned"].includes(String(r.status)) ? "text-lava" : "text-flare"
                  }`}>{String(r.status)}</span>
                </div>
                {typeof r.result_summary === "string" && r.result_summary && (
                  <p className="text-dim mt-1">{r.result_summary}</p>
                )}
              </div>
            ))}
            {!runs.length && (
              <p className="text-dim text-xs italic">No attempts yet. Runs appear when an agent claims this task (Phase 2).</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
