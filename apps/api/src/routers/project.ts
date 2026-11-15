import { z } from "zod";
import { router, publicProcedure, dbError } from "../trpc.js";
import { sql, emit } from "../db.js";
import { PROJECT_STATUSES } from "@agos/shared";

const goalSchema = z.object({ id: z.string(), text: z.string(), done: z.boolean() });

export const projectRouter = router({
  list: publicProcedure.query(async () => {
    return sql`
      select p.*,
        (select count(*)::int from tasks t where t.project_id = p.id and t.deleted_at is null) as task_count,
        (select count(*)::int from tasks t where t.project_id = p.id and t.deleted_at is null and t.status = 'done') as done_count,
        coalesce((select sum(t.spent_usd) from tasks t where t.project_id = p.id), 0) as spent_usd
      from projects p
      where p.deleted_at is null
      order by p.created_at desc`;
  }),

  get: publicProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ input }) => {
    const [project] = await sql`select * from projects where id = ${input.id} and deleted_at is null`;
    if (!project) throw new Error("project not found");
    const tasks = await sql`
      select t.*, a.display_name as agent_display_name, a.avatar as agent_avatar
      from tasks t
      left join agents a on a.id = t.assigned_agent_id
      where t.project_id = ${input.id} and t.deleted_at is null
      order by t.priority asc, t.created_at desc`;
    return { project, tasks };
  }),

  create: publicProcedure
    .input(z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      goals: z.array(goalSchema).default([]),
      defaultBudgetUsd: z.number().nonnegative().nullish(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await sql.begin(async (tx) => {
          const [project] = await tx`
            insert into projects (name, description, goals, default_budget_usd)
            values (${input.name}, ${input.description ?? null}, ${tx.json(input.goals)}, ${input.defaultBudgetUsd ?? null})
            returning *`;
          await emit(tx, {
            type: "project.created", actorType: ctx.actorType, actorId: ctx.actorId,
            subjectType: "project", subjectId: project.id as string,
            data: { name: input.name },
          });
          return project;
        });
      } catch (err) { dbError(err); }
    }),

  update: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).optional(),
      description: z.string().nullish(),
      goals: z.array(goalSchema).optional(),
      status: z.enum(PROJECT_STATUSES).optional(),
      defaultBudgetUsd: z.number().nonnegative().nullish(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...patch } = input;
      try {
        return await sql.begin(async (tx) => {
          const [before] = await tx`select status from projects where id = ${id}`;
          if (!before) throw new Error("project not found");
          const [project] = await tx`
            update projects set
              name = coalesce(${patch.name ?? null}, name),
              description = coalesce(${patch.description ?? null}, description),
              goals = coalesce(${patch.goals ? tx.json(patch.goals) : null}, goals),
              status = coalesce(${patch.status ?? null}, status),
              default_budget_usd = coalesce(${patch.defaultBudgetUsd ?? null}, default_budget_usd)
            where id = ${id}
            returning *`;
          await emit(tx, {
            type: patch.status && patch.status !== before.status ? "project.status_changed" : "project.updated",
            actorType: ctx.actorType, actorId: ctx.actorId,
            subjectType: "project", subjectId: id,
            data: { diff: patch, from: before.status },
          });
          return project;
        });
      } catch (err) { dbError(err); }
    }),

  archive: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await sql.begin(async (tx) => {
          const [project] = await tx`
            update projects set status = 'archived', deleted_at = now()
            where id = ${input.id} returning *`;
          await emit(tx, {
            type: "project.status_changed", actorType: ctx.actorType, actorId: ctx.actorId,
            subjectType: "project", subjectId: input.id,
            data: { to: "archived", soft_deleted: true },
          });
          return project;
        });
      } catch (err) { dbError(err); }
    }),
});
