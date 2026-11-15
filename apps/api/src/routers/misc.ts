// run / approval / event / cost / notification / system routers (DETAILS §12)
import { z } from "zod";
import { router, publicProcedure, dbError } from "../trpc.js";
import { sql, emit } from "../db.js";

export const runRouter = router({
  get: publicProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ input }) => {
    const [run] = await sql`
      select r.*, a.display_name as agent_display_name, t.title as task_title
      from agent_runs r join agents a on a.id = r.agent_id join tasks t on t.id = r.task_id
      where r.id = ${input.id}`;
    if (!run) throw new Error("run not found");
    return run;
  }),
  listByTask: publicProcedure.input(z.object({ taskId: z.string().uuid() })).query(async ({ input }) => {
    return sql`select r.*, a.display_name as agent_display_name from agent_runs r
               join agents a on a.id = r.agent_id
               where r.task_id = ${input.taskId} order by r.attempt_number desc`;
  }),
  listByAgent: publicProcedure.input(z.object({ agentId: z.string().uuid() })).query(async ({ input }) => {
    return sql`select r.*, t.title as task_title from agent_runs r
               join tasks t on t.id = r.task_id
               where r.agent_id = ${input.agentId} order by r.created_at desc limit 50`;
  }),
  kill: publicProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input, ctx }) => {
    try {
      return await sql.begin(async (tx) => {
        const [run] = await tx`
          update agent_runs set status = 'killed', ended_at = now()
          where id = ${input.id} and status in ('queued', 'starting', 'running', 'awaiting_approval')
          returning *`;
        if (!run) throw new Error("run not found or already terminal");
        await tx`update agents set current_run_id = null, status = 'idle'
                 where current_run_id = ${input.id}`;
        await emit(tx, {
          type: "run.killed", actorType: ctx.actorType, actorId: ctx.actorId,
          subjectType: "run", subjectId: input.id,
          data: { task_id: run.task_id, agent_id: run.agent_id },
        });
        return run;
      });
    } catch (err) { dbError(err); }
  }),
});

export const approvalRouter = router({
  list: publicProcedure
    .input(z.object({ status: z.enum(["pending", "approved", "denied", "expired"]).default("pending") }).optional())
    .query(async ({ input }) => {
      const status = input?.status ?? "pending";
      return sql`
        select ap.*, t.title as task_title, a.display_name as agent_display_name, a.avatar as agent_avatar
        from approval_requests ap
        join tasks t on t.id = ap.task_id
        join agent_runs r on r.id = ap.run_id
        join agents a on a.id = r.agent_id
        where ap.status = ${status} and ap.deleted_at is null
        order by ap.created_at asc`;
    }),
  pendingCount: publicProcedure.query(async () => {
    const [{ count }] = await sql`select count(*)::int as count from approval_requests where status = 'pending' and deleted_at is null`;
    return count as number;
  }),
  decide: publicProcedure
    .input(z.object({ id: z.string().uuid(), approved: z.boolean(), note: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await sql.begin(async (tx) => {
          const [req] = await tx`
            update approval_requests
            set status = ${input.approved ? "approved" : "denied"}, decided_at = now()
            where id = ${input.id} and status = 'pending'
            returning *`;
          if (!req) throw new Error("approval request not found or already decided");
          await emit(tx, {
            type: "approval.decided", actorType: ctx.actorType, actorId: ctx.actorId,
            subjectType: "approval_request", subjectId: input.id,
            data: { action_type: req.action_type, decision: input.approved ? "approved" : "denied", note: input.note ?? null },
          });
          return req;
        });
      } catch (err) { dbError(err); }
    }),
});

export const eventRouter = router({
  list: publicProcedure
    .input(z.object({
      type: z.string().optional(),
      subjectType: z.string().optional(),
      subjectId: z.string().uuid().optional(),
      sinceSeq: z.number().int().optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }).optional())
    .query(async ({ input }) => {
      const f = input ?? { limit: 100 };
      return sql`
        select * from events
        where true
          ${f.type ? sql`and event_type like ${f.type + "%"}` : sql``}
          ${f.subjectType ? sql`and subject_type = ${f.subjectType}` : sql``}
          ${f.subjectId ? sql`and subject_id = ${f.subjectId}` : sql``}
          ${f.sinceSeq ? sql`and seq > ${f.sinceSeq}` : sql``}
        order by seq desc
        limit ${f.limit ?? 100}`;
    }),
});

export const costRouter = router({
  summary: publicProcedure
    .input(z.object({ by: z.enum(["task", "agent", "day"]).default("day") }).optional())
    .query(async ({ input }) => {
      const by = input?.by ?? "day";
      if (by === "task") {
        return sql`select task_id, sum(cost_usd) as cost_usd, sum(tokens_in) as tokens_in, sum(tokens_out) as tokens_out
                   from cost_events group by task_id order by sum(cost_usd) desc`;
      }
      if (by === "agent") {
        return sql`select agent_id, sum(cost_usd) as cost_usd, sum(tokens_in) as tokens_in, sum(tokens_out) as tokens_out
                   from cost_events group by agent_id order by sum(cost_usd) desc`;
      }
      return sql`select date_trunc('day', recorded_at at time zone 'America/Chicago') as day,
                        sum(cost_usd) as cost_usd
                 from cost_events group by 1 order by 1 desc limit 30`;
    }),
  todaySpend: publicProcedure.query(async () => {
    const [row] = await sql`
      select coalesce(sum(cost_usd), 0) as spent
      from cost_events
      where recorded_at >= date_trunc('day', now() at time zone 'America/Chicago') at time zone 'America/Chicago'`;
    return row.spent as string;
  }),
  list: publicProcedure.query(async () => {
    return sql`select * from cost_events order by recorded_at desc limit 200`;
  }),
});

export const notificationRouter = router({
  list: publicProcedure
    .input(z.object({ unreadOnly: z.boolean().default(false) }).optional())
    .query(async ({ input }) => {
      const unread = input?.unreadOnly ?? false;
      return sql`
        select * from notifications
        where deleted_at is null ${unread ? sql`and read_at is null` : sql``}
        order by created_at desc limit 100`;
    }),
  markRead: publicProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
    await sql`update notifications set read_at = now() where id = ${input.id} and read_at is null`;
    return { ok: true };
  }),
  markAllRead: publicProcedure.mutation(async () => {
    await sql`update notifications set read_at = now() where read_at is null`;
    return { ok: true };
  }),
});

export const systemRouter = router({
  status: publicProcedure.query(async () => {
    const rows = await sql`select key, value from system_state`;
    const state = Object.fromEntries(rows.map((r) => [r.key as string, r.value]));
    const [counts] = await sql`
      select
        (select count(*)::int from agents
          where status in ('idle', 'working') and deleted_at is null
            and last_heartbeat_at > now() - interval '60 seconds') as agents_online,
        (select count(*)::int from agents where deleted_at is null) as agents_total,
        (select count(*)::int from tasks where status = 'pending' and deleted_at is null) as queue_depth,
        (select count(*)::int from agent_runs where status in ('starting', 'running', 'awaiting_approval')) as active_runs,
        (select count(*)::int from approval_requests where status = 'pending' and deleted_at is null) as pending_approvals`;
    return { state, counts };
  }),

  pause: publicProcedure
    .input(z.object({ reason: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await sql.begin(async (tx) => {
          const value = {
            paused: true, paused_by: "cody",
            paused_at: new Date().toISOString(), reason: input.reason,
          };
          await tx`update system_state set value = ${tx.json(value)} where key = 'global_pause'`;
          await emit(tx, {
            type: "system.paused", actorType: ctx.actorType, actorId: ctx.actorId,
            subjectType: "system", subjectId: "00000000-0000-0000-0000-000000000000",
            data: { by: "cody", reason: input.reason },
          });
          return value;
        });
      } catch (err) { dbError(err); }
    }),

  resume: publicProcedure.mutation(async ({ ctx }) => {
    try {
      return await sql.begin(async (tx) => {
        const value = { paused: false, paused_by: null, paused_at: null, reason: null };
        await tx`update system_state set value = ${tx.json(value)} where key = 'global_pause'`;
        await emit(tx, {
          type: "system.resumed", actorType: ctx.actorType, actorId: ctx.actorId,
          subjectType: "system", subjectId: "00000000-0000-0000-0000-000000000000",
          data: { by: "cody" },
        });
        return value;
      });
    } catch (err) { dbError(err); }
  }),

  setBudget: publicProcedure
    .input(z.object({ dailyCapUsd: z.number().positive() }))
    .mutation(async ({ input }) => {
      await sql`
        update system_state
        set value = jsonb_set(value, '{daily_cap_usd}', ${input.dailyCapUsd}::text::jsonb)
        where key = 'global_budget'`;
      return { ok: true };
    }),

  setModelPrices: publicProcedure
    .input(z.record(z.object({ in_per_mtok: z.number().nonnegative(), out_per_mtok: z.number().nonnegative() })))
    .mutation(async ({ input }) => {
      await sql`update system_state set value = ${sql.json(input)} where key = 'model_prices'`;
      return { ok: true };
    }),
});
