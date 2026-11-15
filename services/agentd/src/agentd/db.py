"""Direct-to-Postgres operations the daemon is allowed (ARCHITECTURE §5):
the transactional claim and the heartbeat. Everything else goes via the API."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any

import psycopg
from psycopg.rows import dict_row

log = logging.getLogger("agentd.db")


@dataclass
class ClaimedRun:
    run_id: str
    task_id: str
    task: dict[str, Any]
    attempt_number: int


def connect(database_url: str) -> psycopg.Connection:
    return psycopg.connect(database_url, row_factory=dict_row, autocommit=False)


def is_paused(conn: psycopg.Connection) -> bool:
    with conn.cursor() as cur:
        cur.execute("select value from system_state where key = 'global_pause'")
        row = cur.fetchone()
    conn.commit()
    return bool(row and row["value"].get("paused"))


def get_agent(conn: psycopg.Connection, name: str) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            """select a.*, coalesce(
                 (select array_agg(c.skill) from agent_capabilities c where c.agent_id = a.id),
                 '{}') as skills
               from agents a where a.name = %s and a.deleted_at is null""",
            (name,),
        )
        row = cur.fetchone()
    conn.commit()
    return row


def get_model_prices(conn: psycopg.Connection) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute("select value from system_state where key = 'model_prices'")
        row = cur.fetchone()
    conn.commit()
    return row["value"] if row else {}


def budget_headroom(conn: psycopg.Connection, agent_id: str, task_id: str) -> tuple[bool, str]:
    """Pre-call budget check (DETAILS §7.1). Returns (ok, reason_if_not)."""
    with conn.cursor() as cur:
        cur.execute(
            """select
                 t.spent_usd as task_spent,
                 coalesce(t.budget_usd, p.default_budget_usd) as task_budget,
                 a.spent_today_usd, a.daily_budget_usd,
                 (select (value->>'daily_cap_usd')::numeric from system_state where key='global_budget') as global_cap,
                 (select coalesce(sum(cost_usd), 0) from cost_events
                   where recorded_at >= date_trunc('day', now() at time zone 'America/Chicago')
                                        at time zone 'America/Chicago') as global_spent
               from tasks t
               join projects p on p.id = t.project_id
               join agents a on a.id = %s
               where t.id = %s""",
            (agent_id, task_id),
        )
        row = cur.fetchone()
    conn.commit()
    if row is None:
        return False, "task not found"
    if row["task_budget"] is not None and row["task_spent"] >= row["task_budget"]:
        return False, f"task budget exhausted (${row['task_spent']} of ${row['task_budget']})"
    if row["daily_budget_usd"] is not None and row["spent_today_usd"] >= row["daily_budget_usd"]:
        return False, f"agent daily budget exhausted (${row['spent_today_usd']})"
    if row["global_cap"] is not None and row["global_spent"] >= row["global_cap"]:
        return False, f"global daily cap hit (${row['global_spent']} of ${row['global_cap']})"
    return True, ""


def heartbeat(conn: psycopg.Connection, machine_id: str, agent_names: list[str]) -> None:
    """Heartbeat by agent name (not machine_id) so a host can adopt agents
    when their home daemon is down. Also stamps machine_id to the live host."""
    with conn.cursor() as cur:
        cur.execute(
            """update agents set last_heartbeat_at = now(),
                 machine_id = %s,
                 status = case when status = 'offline' then 'idle' else status end
               where name = any(%s) and deleted_at is null""",
            (machine_id, agent_names),
        )
    conn.commit()


def register_boot(conn: psycopg.Connection, machine_id: str, agent_names: list[str]) -> None:
    """On boot: offline → idle + agent.status_changed events (DETAILS §9.2).
    Matches by agent name so agents can be relocated across machines."""
    with conn.cursor() as cur:
        cur.execute(
            """update agents set status = 'idle', last_heartbeat_at = now(),
                 machine_id = %s
               where name = any(%s) and deleted_at is null and status = 'offline'
               returning id, name""",
            (machine_id, agent_names),
        )
        woken = cur.fetchall()
        for a in woken:
            cur.execute(
                """insert into events (event_type, actor_type, actor_id, subject_type, subject_id, payload)
                   values ('agent.status_changed', 'system', null, 'agent', %s, %s)""",
                (a["id"], json.dumps({
                    "schema_version": 1,
                    "data": {"from": "offline", "to": "idle", "via": "agentd boot",
                             "machine_id": machine_id},
                })),
            )
    conn.commit()


def set_offline(conn: psycopg.Connection, machine_id: str, agent_names: list[str]) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """update agents set status = 'offline'
               where name = any(%s) and machine_id = %s
                 and status in ('idle', 'working') and deleted_at is null""",
            (agent_names, machine_id),
        )
    conn.commit()


def claim_one(conn: psycopg.Connection, agent: dict[str, Any]) -> ClaimedRun | None:
    """The claim transaction (DETAILS §3.1). All-or-nothing: task claim,
    run insert, agent flip, and events commit together."""
    agent_id = agent["id"]
    skills: list[str] = list(agent.get("skills") or [])
    try:
        with conn.cursor() as cur:
            cur.execute(
                """with claimable as (
                     select t.id
                     from tasks t
                     where t.status = 'pending'
                       and t.deleted_at is null
                       and (t.assigned_agent_id = %(agent_id)s
                            or (t.assigned_agent_id is null
                                and t.assignment_mode = 'autonomous'
                                and t.required_skills <@ %(skills)s::text[]))
                       and not exists (
                         select 1 from task_dependencies d
                         join tasks dep on dep.id = d.depends_on_task_id
                         where d.task_id = t.id and dep.status <> 'done')
                       and not exists (
                         select 1 from system_state
                         where key = 'global_pause' and (value->>'paused')::bool = true)
                     order by t.priority asc, t.created_at asc
                     limit 1
                     for update skip locked
                   )
                   update tasks set status = 'claimed', assigned_agent_id = %(agent_id)s, updated_at = now()
                   from claimable where tasks.id = claimable.id
                   returning tasks.*""",
                {"agent_id": agent_id, "skills": skills},
            )
            task = cur.fetchone()
            if task is None:
                conn.rollback()
                return None

            attempt = int(task["retry_count"]) + 1
            cur.execute(
                """insert into agent_runs (task_id, agent_id, attempt_number, status, claim_source, started_at)
                   values (%s, %s, %s, 'starting', %s, now())
                   returning id""",
                (task["id"], agent_id, attempt,
                 "manual_assign" if task["assigned_agent_id"] == agent_id and task["assignment_mode"] == "manual"
                 else "self_claimed"),
            )
            run_id = cur.fetchone()["id"]

            cur.execute(
                "update agents set status = 'working', current_run_id = %s where id = %s",
                (run_id, agent_id),
            )
            for etype, payload in (
                ("task.claimed", {"agent_id": str(agent_id), "run_id": str(run_id),
                                  "claim_source": "self_claimed"}),
                ("run.created", {"task_id": str(task["id"]), "attempt_number": attempt}),
            ):
                cur.execute(
                    """insert into events (event_type, actor_type, actor_id, subject_type, subject_id, payload)
                       values (%s, 'agent', %s, %s, %s, %s)""",
                    (etype, agent_id,
                     "task" if etype.startswith("task") else "run",
                     task["id"] if etype.startswith("task") else run_id,
                     json.dumps({"schema_version": 1, "data": payload})),
                )
        conn.commit()
        return ClaimedRun(run_id=str(run_id), task_id=str(task["id"]),
                          task=dict(task), attempt_number=attempt)
    except Exception:
        conn.rollback()
        raise


def mark_run_running(conn: psycopg.Connection, run_id: str, task_id: str, agent_id: str) -> None:
    with conn.cursor() as cur:
        cur.execute("update agent_runs set status = 'running' where id = %s", (run_id,))
        cur.execute("update tasks set status = 'in_progress' where id = %s", (task_id,))
        for etype, subject_type, subject_id in (
            ("run.started", "run", run_id),
            ("task.status_changed", "task", task_id),
        ):
            payload = ({"schema_version": 1, "data": {"from": "claimed", "to": "in_progress"}}
                       if etype == "task.status_changed"
                       else {"schema_version": 1, "data": {}})
            cur.execute(
                """insert into events (event_type, actor_type, actor_id, subject_type, subject_id, payload)
                   values (%s, 'agent', %s, %s, %s, %s)""",
                (etype, agent_id, subject_type, subject_id, json.dumps(payload)),
            )
    conn.commit()


def load_task_doc(conn: psycopg.Connection, task_id: str) -> dict[str, Any]:
    """The living doc: description, criteria, recent comments, artifacts."""
    with conn.cursor() as cur:
        cur.execute("select * from tasks where id = %s", (task_id,))
        task = cur.fetchone()
        cur.execute(
            """select author_type, body, kind, created_at from task_comments
               where task_id = %s and deleted_at is null
               order by created_at desc limit 20""",
            (task_id,),
        )
        comments = cur.fetchall()
        cur.execute(
            """select name, kind, is_evidence from artifacts
               where task_id = %s and deleted_at is null""",
            (task_id,),
        )
        artifacts = cur.fetchall()
    conn.commit()
    return {"task": task, "comments": comments, "artifacts": artifacts}
