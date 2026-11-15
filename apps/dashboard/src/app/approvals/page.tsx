"use client";

import { trpc } from "@/lib/trpc";
import { Spinner, EmptyState, timeAgo } from "@/components/ui";

export default function ApprovalsPage() {
  const utils = trpc.useUtils();
  const q = trpc.approval.list.useQuery({ status: "pending" }, { refetchInterval: 5_000 });
  const decide = trpc.approval.decide.useMutation({
    onSuccess: () => {
      utils.approval.list.invalidate();
      utils.approval.pendingCount.invalidate();
    },
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-end justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
        <p className="font-mono text-[10px] text-dim tracking-widest">HUMAN IS ROOT · GATES ARE NOT THEATER</p>
      </div>

      {q.isLoading ? <Spinner /> : !q.data?.length ? (
        <EmptyState text="nothing awaiting approval" />
      ) : (
        <div className="space-y-4">
          {q.data.map((r) => (
            <div key={r.id as string} className="panel panel-glow p-5 border-l-2 border-l-lava">
              <div className="flex items-center gap-3">
                <span className="text-xl">{String(r.agent_avatar ?? "🤖")}</span>
                <div className="flex-1">
                  <div className="text-sm">
                    <span className="font-semibold">{String(r.agent_display_name)}</span>
                    <span className="text-mist"> wants to </span>
                    <span className="font-mono text-lava">{String(r.action_type)}</span>
                  </div>
                  <div className="font-mono text-[10px] text-dim mt-0.5">
                    TASK // {String(r.task_title)} · EXPIRES {timeAgo(r.expires_at as string).replace(" ago", "")}
                  </div>
                </div>
              </div>
              {typeof r.risk_note === "string" && r.risk_note && (
                <p className="text-sm text-mist mt-3 border-l-2 border-edge pl-3">{r.risk_note}</p>
              )}
              <pre className="font-mono text-[10px] text-mist bg-onyx border border-edge rounded p-3 mt-3 overflow-x-auto">
                {JSON.stringify(r.action_detail, null, 2)}
              </pre>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => decide.mutate({ id: r.id as string, approved: true })}
                  disabled={decide.isPending}
                  className="font-mono text-xs tracking-widest bg-ok text-void font-bold px-4 py-2 rounded hover:bg-ok/85 disabled:opacity-40"
                >
                  APPROVE
                </button>
                <button
                  onClick={() => decide.mutate({ id: r.id as string, approved: false })}
                  disabled={decide.isPending}
                  className="font-mono text-xs tracking-widest border border-lava text-lava px-4 py-2 rounded hover:bg-lava/10 disabled:opacity-40"
                >
                  DENY
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
