"""Run executor: claimed task → working agent → verified completion.

Flow per ARCHITECTURE §5: load doc → build context → execute engine →
stream comments/costs → attach evidence → complete (the API + DB trigger
decide whether 'done' is earned)."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from .api import ApiClient
from .config import Config
from .db import ClaimedRun, budget_headroom, load_task_doc, mark_run_running
from .engine import AnthropicEngine, ClaudeCLIEngine, RunResult, build_prompt

log = logging.getLogger("agentd.runner")

MAX_EVIDENCE_BYTES = 30_000


def make_engine(cfg: Config, agent: dict[str, Any], prices: dict[str, Any]):
    model = agent.get("model") or "claude-sonnet-4-6"
    if cfg.engine == "claude-cli":
        return ClaudeCLIEngine(model=None, max_turns=cfg.max_turns)
    return AnthropicEngine(model=model, max_turns=cfg.max_turns, prices=prices)


def execute_run(conn, cfg: Config, api: ApiClient, agent: dict[str, Any],
                claim: ClaimedRun, prices: dict[str, Any]) -> None:
    run_id = claim.run_id
    agent_name = agent["name"]
    workspace = cfg.workspace_for(agent_name)

    # budget gate BEFORE any model call (DETAILS §7.1) — hard stop, not a warning
    ok, reason = budget_headroom(conn, agent["id"], claim.task_id)
    if not ok:
        log.warning("budget stop for %s: %s", agent_name, reason)
        api.comment(run_id, f"⛔ Budget check failed before starting: {reason}", kind="status_update")
        api.complete(run_id, "failed", f"blocked by budget: {reason}",
                     error={"type": "budget", "message": reason, "recoverable": True})
        return

    mark_run_running(conn, run_id, claim.task_id, agent["id"])
    api.comment(
        run_id,
        f"🛰 **{agent.get('display_name') or agent_name}** claimed this task "
        f"(attempt #{claim.attempt_number}). Workspace: `{workspace.name}`.",
        kind="status_update",
    )

    task_doc = load_task_doc(conn, claim.task_id)
    prompt = build_prompt(task_doc)
    system_prompt = agent.get("system_prompt") or f"You are {agent_name}, an autonomous agent."
    engine = make_engine(cfg, agent, prices)

    try:
        result: RunResult = engine.run(prompt, system_prompt, workspace)
    except Exception as exc:
        log.exception("engine crashed")
        api.complete(run_id, "failed", f"engine error: {exc}",
                     error={"type": "engine", "message": str(exc), "recoverable": True})
        return

    # cost is recorded even for failed runs — every model call costs money
    if result.tokens_in or result.tokens_out or result.cost_usd:
        api.cost(run_id, result.model, result.tokens_in, result.tokens_out, result.cost_usd)

    if not result.ok:
        api.comment(run_id, f"❌ Run did not produce a verifiable result: {result.error}",
                    kind="status_update")
        api.complete(run_id, "failed", result.result_summary,
                     error={"type": "no_verdict", "message": result.error or "unknown",
                            "recoverable": True})
        return

    # attach evidence files the agent claims prove the work (jail-checked)
    attached = []
    for rel in result.evidence_files[:10]:
        p = (workspace / rel).resolve()
        if not p.is_relative_to(workspace.resolve()):
            log.warning("evidence path escapes jail, skipping: %s", rel)
            continue
        if not p.is_file():
            continue
        try:
            content = p.read_text(errors="replace")[:MAX_EVIDENCE_BYTES]
        except OSError:
            continue
        api.artifact(run_id, name=Path(rel).name, content=content,
                     kind="evidence", is_evidence=True)
        attached.append(Path(rel).name)

    api.comment(
        run_id,
        f"✅ Work finished. {result.result_summary}\n\n"
        f"Criteria verified: {', '.join(result.criteria_met) or 'none'} · "
        f"Evidence attached: {', '.join(attached) or 'none'}",
        kind="status_update",
    )
    outcome = api.complete(run_id, "succeeded", result.result_summary,
                           criteria_met=result.criteria_met)
    log.info("run %s complete → task status %s", run_id, outcome.get("task_status"))
