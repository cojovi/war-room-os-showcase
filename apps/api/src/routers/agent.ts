import { z } from "zod";
import { router, publicProcedure, dbError } from "../trpc.js";
import { sql, emit } from "../db.js";

export const agentRouter = router({
  list: publicProcedure.query(async () => {
    return sql`
      select a.*,
        t.title as current_task_title, t.id as current_task_id,
        coalesce((select array_agg(c.skill order by c.skill) from agent_capabilities c where c.agent_id = a.id), '{}') as skills
      from agents a
      left join agent_runs r on r.id = a.current_run_id
      left join tasks t on t.id = r.task_id
      where a.deleted_at is null
      order by a.name`;
  }),

  get: publicProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ input }) => {
    const [agent] = await sql`select * from agents where id = ${input.id} and deleted_at is null`;
    if (!agent) throw new Error("agent not found");
    const [capabilities, runs, events] = await Promise.all([
      sql`select * from agent_capabilities where agent_id = ${input.id} order by skill`,
      sql`select r.*, t.title as task_title from agent_runs r join tasks t on t.id = r.task_id
          where r.agent_id = ${input.id} order by r.created_at desc limit 25`,
      sql`select * from events where (actor_id = ${input.id} or (subject_type = 'agent' and subject_id = ${input.id}))
          order by seq desc limit 50`,
    ]);
    return { agent, capabilities, runs, events };
  }),

  register: publicProcedure
    .input(z.object({
      name: z.string().min(1).regex(/^[a-z0-9-]+$/),
      displayName: z.string().min(1),
      avatar: z.string().default("🤖"),
      machineId: z.string().min(1),
      model: z.string().default("claude-sonnet-4-6"),
      systemPrompt: z.string().optional(),
      dailyBudgetUsd: z.number().nonnegative().nullish(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await sql.begin(async (tx) => {
          const [agent] = await tx`
            insert into agents (name, display_name, avatar, machine_id, model, system_prompt, daily_budget_usd)
            values (${input.name}, ${input.displayName}, ${input.avatar}, ${input.machineId},
                    ${input.model}, ${input.systemPrompt ?? null}, ${input.dailyBudgetUsd ?? null})
            returning *`;
          await emit(tx, {
            type: "agent.registered", actorType: ctx.actorType, actorId: ctx.actorId,
            subjectType: "agent", subjectId: agent.id as string,
            data: { name: input.name, machine_id: input.machineId },
          });
          return agent;
        });
      } catch (err) { dbError(err); }
    }),

  update: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      displayName: z.string().optional(),
      avatar: z.string().optional(),
      model: z.string().optional(),
      systemPrompt: z.string().nullish(),
      maxConcurrentRuns: z.number().int().min(1).optional(),
      dailyBudgetUsd: z.number().nonnegative().nullish(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...patch } = input;
      try {
        return await sql.begin(async (tx) => {
          const [agent] = await tx`
            update agents set
              display_name = coalesce(${patch.displayName ?? null}, display_name),
              avatar = coalesce(${patch.avatar ?? null}, avatar),
              model = coalesce(${patch.model ?? null}, model),
              system_prompt = coalesce(${patch.systemPrompt ?? null}, system_prompt),
              max_concurrent_runs = coalesce(${patch.maxConcurrentRuns ?? null}, max_concurrent_runs),
              daily_budget_usd = coalesce(${patch.dailyBudgetUsd ?? null}, daily_budget_usd)
            where id = ${id} and deleted_at is null returning *`;
          if (!agent) throw new Error("agent not found");
          await emit(tx, {
            type: "agent.updated", actorType: ctx.actorType, actorId: ctx.actorId,
            subjectType: "agent", subjectId: id, data: { diff: patch },
          });
          return agent;
        });
      } catch (err) { dbError(err); }
    }),

  pause: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await sql.begin(async (tx) => {
          const [before] = await tx`select status from agents where id = ${input.id}`;
          if (!before) throw new Error("agent not found");
          const [agent] = await tx`update agents set status = 'paused' where id = ${input.id} returning *`;
          await emit(tx, {
            type: "agent.status_changed", actorType: ctx.actorType, actorId: ctx.actorId,
            subjectType: "agent", subjectId: input.id,
            data: { from: before.status, to: "paused" },
          });
          return agent;
        });
      } catch (err) { dbError(err); }
    }),

  resume: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await sql.begin(async (tx) => {
          const [before] = await tx`select status, last_heartbeat_at from agents where id = ${input.id}`;
          if (!before) throw new Error("agent not found");
          // fresh heartbeat within 60s → idle; otherwise offline until the daemon reports in
          const fresh = before.last_heartbeat_at &&
            Date.now() - new Date(before.last_heartbeat_at as string).getTime() < 60_000;
          const to = fresh ? "idle" : "offline";
          const [agent] = await tx`update agents set status = ${to} where id = ${input.id} returning *`;
          await emit(tx, {
            type: "agent.status_changed", actorType: ctx.actorType, actorId: ctx.actorId,
            subjectType: "agent", subjectId: input.id,
            data: { from: before.status, to },
          });
          return agent;
        });
      } catch (err) { dbError(err); }
    }),

  setCapabilities: publicProcedure
    .input(z.object({
      agentId: z.string().uuid(),
      capabilities: z.array(z.object({
        skill: z.string().min(1),
        proficiency: z.number().int().min(1).max(5),
      })),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await sql.begin(async (tx) => {
          await tx`delete from agent_capabilities where agent_id = ${input.agentId}`;
          for (const cap of input.capabilities) {
            await tx`
              insert into agent_capabilities (agent_id, skill, proficiency)
              values (${input.agentId}, ${cap.skill}, ${cap.proficiency})`;
          }
          await emit(tx, {
            type: "agent.updated", actorType: ctx.actorType, actorId: ctx.actorId,
            subjectType: "agent", subjectId: input.agentId,
            data: { diff: { capabilities: input.capabilities } },
          });
          return { ok: true };
        });
      } catch (err) { dbError(err); }
    }),
});
