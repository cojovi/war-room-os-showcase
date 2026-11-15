"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/lib/trpc";

const NAV = [
  { href: "/", label: "OPS CENTER", icon: "◉" },
  { href: "/projects", label: "PROJECTS", icon: "▦" },
  { href: "/tasks", label: "TASKS", icon: "☰" },
  { href: "/agents", label: "AGENTS", icon: "⬡" },
  { href: "/activity", label: "ACTIVITY", icon: "⇶" },
  { href: "/approvals", label: "APPROVALS", icon: "✓" },
];

export function Sidebar() {
  const pathname = usePathname();
  const approvals = trpc.approval.pendingCount.useQuery(undefined, { refetchInterval: 15_000 });

  return (
    <aside className="w-56 shrink-0 border-r border-edge flex flex-col bg-ink/40 backdrop-blur">
      <div className="px-5 pt-6 pb-5 border-b border-edge">
        <div className="font-mono text-[10px] tracking-[0.35em] text-flare">⬢ WAR ROOM</div>
        <div className="text-xl font-semibold tracking-tight mt-0.5">
          OS<span className="text-violet-2">_</span>
        </div>
      </div>
      <nav className="flex-1 py-4">
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-5 py-2.5 font-mono text-xs tracking-[0.18em] transition-colors border-l-2 ${
                active
                  ? "border-flare text-porcelain bg-flare/5"
                  : "border-transparent text-dim hover:text-mist hover:bg-horizon/5"
              }`}
            >
              <span className={active ? "text-flare" : ""}>{item.icon}</span>
              {item.label}
              {item.href === "/approvals" && (approvals.data ?? 0) > 0 && (
                <span className="ml-auto bg-lava text-void text-[10px] font-bold px-1.5 rounded">
                  {approvals.data}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="px-5 py-4 border-t border-edge font-mono text-[10px] text-dim leading-relaxed">
        SHOWCASE // FICTIONAL DATA
        <br />
        OPERATOR // DEMO
      </div>
    </aside>
  );
}

export function KillSwitch() {
  const utils = trpc.useUtils();
  const status = trpc.system.status.useQuery(undefined, { refetchInterval: 10_000 });
  const pause = trpc.system.pause.useMutation({ onSuccess: () => utils.system.status.invalidate() });
  const resume = trpc.system.resume.useMutation({ onSuccess: () => utils.system.status.invalidate() });
  const [confirming, setConfirming] = useState(false);

  const paused = Boolean(
    (status.data?.state?.global_pause as { paused?: boolean } | undefined)?.paused,
  );

  if (paused) {
    return (
      <button
        onClick={() => resume.mutate()}
        disabled={resume.isPending}
        className="font-mono text-xs tracking-widest border border-lava bg-lava/20 text-lava px-4 py-2 rounded hover:bg-lava/30 transition-colors pulse-dot"
      >
        ■ SYSTEM PAUSED — CLICK TO RESUME
      </button>
    );
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] text-lava tracking-widest">QUIESCE ALL AGENTS?</span>
        <button
          onClick={() => { pause.mutate({ reason: "manual kill switch" }); setConfirming(false); }}
          className="font-mono text-xs border border-lava bg-lava text-void font-bold px-3 py-2 rounded hover:bg-lava/85"
        >
          CONFIRM
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="font-mono text-xs border border-edge text-dim px-3 py-2 rounded hover:text-mist"
        >
          ABORT
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="font-mono text-xs tracking-widest border border-lava/60 text-lava px-4 py-2 rounded hover:bg-lava/10 hover:border-lava transition-colors"
      title="Global kill switch — pauses all agents on all machines"
    >
      ⏻ KILL SWITCH
    </button>
  );
}

export function TopBar() {
  const status = trpc.system.status.useQuery(undefined, { refetchInterval: 10_000 });
  const spend = trpc.cost.todaySpend.useQuery(undefined, { refetchInterval: 30_000 });
  const c = status.data?.counts;

  return (
    <header className="h-16 shrink-0 border-b border-edge flex items-center justify-between px-6 bg-ink/30 backdrop-blur">
      <div className="flex items-center gap-6 font-mono text-[11px] tracking-widest text-dim">
        <span>
          AGENTS <span className="text-horizon">{c?.agents_online ?? "–"}/{c?.agents_total ?? "–"}</span>
        </span>
        <span>
          QUEUE <span className="text-horizon">{c?.queue_depth ?? "–"}</span>
        </span>
        <span>
          ACTIVE RUNS <span className="text-flare">{c?.active_runs ?? "–"}</span>
        </span>
        <span>
          SPEND TODAY <span className="text-flare">${Number(spend.data ?? 0).toFixed(2)}</span>
        </span>
      </div>
      <KillSwitch />
    </header>
  );
}
