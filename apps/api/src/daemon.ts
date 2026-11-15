// Daemon-facing REST surface (DETAILS §12). The daemon claims tasks and
// heartbeats direct-to-Postgres for atomicity (ARCHITECTURE §5); everything
// else flows through here so events, rollups, and validation stay in one place.
import { Hono } from "hono";
import { createHash } from "node:crypto";
import { sql, emit, type Tx } from "./db.js";
import type { CommentKind, ArtifactKind } from "@agos/shared";

export const daemonRoutes = new Hono();

// Serialize matching request keys, and commit effects plus their replay response
// in the same transaction. A reused key must describe the same route and body.
async function withIdempotency(
  c: { req: { header: (n: string) => string | undefined; method: string; path: string; json: () => Promise<unknown> } },
  fn: (tx: Tx) => Promise<Record<string, unknown>>,
): Promise<{ body: Record<string, unknown>; replayed: boolean }> {
  const key = c.req.header("Idempotency-Key");
  if (key && key.length > 240) throw new Error("idempotency key is too long");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([c.req.method, c.req.path, await c.req.json()]))
    .digest("hex");
  return sql.begin(async (tx) => {
    if (key) {
      await tx`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      const [existing] = await tx`select response, request_fingerprint from idempotency_keys where key = ${key}`;
      if (existing) {
        if (existing.request_fingerprint !== fingerprint) {
          throw new Error("idempotency key already belongs to a different request");
        }
        return { body: existing.response as Record<string, unknown>, replayed: true };
      }
    }
    const body = await fn(tx);
    if (key) {
      await tx`insert into idempotency_keys (key, response, request_fingerprint)
               values (${key}, ${sql.json(body as never)}, ${fingerprint})`;
    }
    return { body, replayed: false };
  });
}

interface RunRow {
  id: string;
  task_id: string;
  agent_id: string;
  status: string;
  agent_name: string;
}

async function loadRun(tx: Tx, runId: string): Promise<RunRow | undefined> {
  const [run] = await tx`
    select r.id, r.task_id, r.agent_id, r.status, a.name as agent_name
    from agent_runs r join agents a on a.id = r.agent_id
    where r.id = ${runId}`;
  return run as RunRow | undefined;
}

daemonRoutes.post("/heartbeat", async (c) => {
  const { machine_id, agent_names } = await c.req.json<{ machine_id: string; agent_names: string[] }>();
  await sql.begin(async (tx) => {
    const woken = await tx`
      update agents set last_heartbeat_at = now(),
        status = case when status = 'offline' then 'idle' else status end
      where machine_id = ${machine_id} and name = any(${agent_names ?? []})
      returning id, name, (status = 'idle') as now_idle`;
    for (const a of woken) {
      // only emit for offline→idle flips, not every 5s beat
      if (a.now_idle) continue;
    }
  });
  const [pause] = await sql`select value from system_state where key = 'global_pause'`;
  return c.json({ ok: true, pause: pause.value });
});

daemonRoutes.post("/runs/:id/progress", async (c) => {
  const runId = c.req.param("id");
  const { note, pct } = await c.req.json<{ note: string; pct?: number }>();
  const { body } = await withIdempotency(c, async (tx) => {
      const run = await loadRun(tx, runId);
      if (!run) throw new Error("run not found");
      await tx`update agent_runs set reasoning_summary = ${note} where id = ${runId}`;
      await emit(tx, {
        type: "run.progress", actorType: "agent", actorId: run.agent_id,
        subjectType: "run", subjectId: runId,
        data: { note, pct: pct ?? null, task_id: run.task_id },
      });
      return { ok: true };
    },
  );
  return c.json(body);
});

daemonRoutes.post("/runs/:id/comments", async (c) => {
  const runId = c.req.param("id");
  const { body: text, kind } = await c.req.json<{ body: string; kind?: CommentKind }>();
  const { body } = await withIdempotency(c, async (tx) => {
      const run = await loadRun(tx, runId);
      if (!run) throw new Error("run not found");
      const [comment] = await tx`
        insert into task_comments (task_id, run_id, author_type, author_id, body, kind)
        values (${run.task_id}, ${runId}, 'agent', ${run.agent_id}, ${text}, ${kind ?? "status_update"})
        returning id`;
      await emit(tx, {
        type: "task.comment_added", actorType: "agent", actorId: run.agent_id,
        subjectType: "task", subjectId: run.task_id,
        data: { comment_id: comment.id, author: "agent", kind: kind ?? "status_update" },
      });
      return { ok: true, comment_id: comment.id };
    },
  );
  return c.json(body);
});

daemonRoutes.post("/runs/:id/costs", async (c) => {
  const runId = c.req.param("id");
  const { model, tokens_in, tokens_out, cost_usd } = await c.req.json<{
    model: string; tokens_in: number; tokens_out: number; cost_usd: number;
  }>();
  const { body } = await withIdempotency(c, async (tx) => {
      const run = await loadRun(tx, runId);
      if (!run) throw new Error("run not found");
      await tx`
        insert into cost_events (run_id, agent_id, task_id, model, tokens_in, tokens_out, cost_usd)
        values (${runId}, ${run.agent_id}, ${run.task_id}, ${model}, ${tokens_in}, ${tokens_out}, ${cost_usd})`;
      await tx`
        update agent_runs set
          tokens_in = tokens_in + ${tokens_in},
          tokens_out = tokens_out + ${tokens_out},
          cost_usd = cost_usd + ${cost_usd}
        where id = ${runId}`;
      await tx`update tasks set spent_usd = spent_usd + ${cost_usd} where id = ${run.task_id}`;
      await tx`update agents set spent_today_usd = spent_today_usd + ${cost_usd} where id = ${run.agent_id}`;
      await emit(tx, {
        type: "cost.recorded", actorType: "agent", actorId: run.agent_id,
        subjectType: "run", subjectId: runId,
        data: { model, tokens_in, tokens_out, cost_usd },
      });
      return { ok: true };
    },
  );
  return c.json(body);
});

daemonRoutes.post("/runs/:id/artifacts", async (c) => {
  const runId = c.req.param("id");
  const { name, kind, inline_content, content_type, is_evidence } = await c.req.json<{
    name: string; kind?: ArtifactKind; inline_content?: string;
    content_type?: string; is_evidence?: boolean;
  }>();
  const { body } = await withIdempotency(c, async (tx) => {
      const run = await loadRun(tx, runId);
      if (!run) throw new Error("run not found");
      const [{ next_version }] = await tx`
        select coalesce(max(version), 0) + 1 as next_version
        from artifacts where task_id = ${run.task_id} and name = ${name}`;
      const [artifact] = await tx`
        insert into artifacts (task_id, run_id, name, kind, inline_content, content_type, size_bytes, is_evidence, version)
        values (${run.task_id}, ${runId}, ${name}, ${kind ?? "file"}, ${inline_content ?? null},
                ${content_type ?? null},
                ${inline_content ? Buffer.byteLength(inline_content) : null},
                ${is_evidence ?? false}, ${next_version as number})
        returning id`;
      await emit(tx, {
        type: "task.artifact_added", actorType: "agent", actorId: run.agent_id,
        subjectType: "task", subjectId: run.task_id,
        data: { artifact_id: artifact.id, kind: kind ?? "file", is_evidence: is_evidence ?? false },
      });
      return { ok: true, artifact_id: artifact.id };
    },
  );
  return c.json(body);
});

daemonRoutes.post("/runs/:id/complete", async (c) => {
  const runId = c.req.param("id");
  const { status, result_summary, error, criteria_met } = await c.req.json<{
    status: "succeeded" | "failed";
    result_summary: string;
    error?: { type: string; message: string; recoverable?: boolean };
    criteria_met?: string[]; // criterion ids the agent verified
  }>();

  const { body } = await withIdempotency(c, async (tx) => {
      const run = await loadRun(tx, runId);
      if (!run) throw new Error("run not found");

      await tx`
        update agent_runs set status = ${status}, ended_at = now(),
          result_summary = ${result_summary},
          error = ${error ? tx.json(error as never) : null}
        where id = ${runId}`;
      await tx`
        update agents set status = 'idle', current_run_id = null,
          stats = jsonb_set(jsonb_set(stats,
            '{runs_total}', (coalesce((stats->>'runs_total')::int, 0) + 1)::text::jsonb),
            ${status === "succeeded" ? "{runs_succeeded}" : "{runs_failed}"},
            (coalesce((stats->>${status === "succeeded" ? "runs_succeeded" : "runs_failed"})::int, 0) + 1)::text::jsonb)
        where id = ${run.agent_id}`;
      await emit(tx, {
        type: status === "succeeded" ? "run.succeeded" : "run.failed",
        actorType: "agent", actorId: run.agent_id,
        subjectType: "run", subjectId: runId,
        data: { task_id: run.task_id, result_summary, error: error ?? null },
      });

      // mark verified criteria (verified_by = agent name)
      if (criteria_met?.length) {
        await tx`
          update tasks set acceptance_criteria = (
            select coalesce(jsonb_agg(
              case when c->>'id' = any(${criteria_met})
                then c || jsonb_build_object('met', true, 'verified_by', ${run.agent_name}::text)
                else c end), '[]'::jsonb)
            from jsonb_array_elements(acceptance_criteria) c)
          where id = ${run.task_id}`;
      }

      let taskStatus: string;
      if (status === "succeeded") {
        // Try to close the task; the DoD trigger is the judge. If it objects
        // (unmet criteria / missing evidence), the task goes to review instead.
        try {
          await tx.savepoint(async (sp) => {
            await sp`update tasks set status = 'done' where id = ${run.task_id}`;
          });
          taskStatus = "done";
        } catch {
          await tx`update tasks set status = 'review' where id = ${run.task_id}`;
          taskStatus = "review";
        }
      } else {
        const [t] = await tx`
          update tasks set retry_count = retry_count + 1 where id = ${run.task_id}
          returning retry_count, max_retries`;
        if (Number(t.retry_count) >= Number(t.max_retries)) {
          await tx`update tasks set status = 'failed' where id = ${run.task_id}`;
          taskStatus = "failed";
          await tx`
            insert into notifications (severity, title, body, link_type, link_id, channels)
            values ('critical', 'Task failed after max retries', ${result_summary},
                    'task', ${run.task_id}, '{dashboard}')`;
        } else {
          await tx`update tasks set status = 'pending' where id = ${run.task_id}`;
          taskStatus = "pending";
        }
      }
      await emit(tx, {
        type: "task.status_changed", actorType: "agent", actorId: run.agent_id,
        subjectType: "task", subjectId: run.task_id,
        data: { from: "in_progress", to: taskStatus, reason: `run ${status}` },
      });
      return { ok: true, task_status: taskStatus };
    },
  );
  return c.json(body);
});
