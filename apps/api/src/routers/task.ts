import { z } from "zod";
import { router, publicProcedure, dbError } from "../trpc.js";
import { sql, emit, type Tx } from "../db.js";
import { TASK_STATUSES, ASSIGNMENT_MODES, routeTask } from "@agos/shared";

const criterionSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  met: z.boolean().default(false),
  verified_by: z.string().nullable().default(null),
});

// task.ready fires when a pending task has all deps done (DETAILS §4) — the orchestrator's cue.
async function emitReadyIfReady(tx: Tx, taskId: string): Promise<void> {
  const [row] = await tx`
    select 1 as ready from tasks t
    where t.id = ${taskId} and t.status = 'pending'
      and not exists (
        select 1 from task_dependencies d
        join tasks dep on dep.id = d.depends_on_task_id
        where d.task_id = t.id and dep.status <> 'done')`;
  if (row) {
    await emit(tx, {
      type: "task.ready", actorType: "system", subjectType: "task", subjectId: taskId, data: {},
    });
  }
}

export const taskRouter = router({
  listByProject: publicProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input }) => {
      return sql`
        select t.*, a.display_name as agent_display_name, a.avatar as agent_avatar
        from tasks t left join agents a on a.id = t.assigned_agent_id
        where t.project_id = ${input.projectId} and t.deleted_at is null
        order by t.priority asc, t.created_at desc`;
    }),

  listAll: publicProcedure.query(async () => {
    return sql`
      select t.*, p.name as project_name, a.display_name as agent_display_name, a.avatar as agent_avatar
      from tasks t
      join projects p on p.id = t.project_id
      left join agents a on a.id = t.assigned_agent_id
      where t.deleted_at is null
      order by t.priority asc, t.created_at desc`;
  }),

  get: publicProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ input }) => {
    const [task] = await sql`
      select t.*, p.name as project_name, a.display_name as agent_display_name, a.avatar as agent_avatar
      from tasks t
      join projects p on p.id = t.project_id
      left join agents a on a.id = t.assigned_agent_id
      where t.id = ${input.id} and t.deleted_at is null`;
    if (!task) throw new Error("task not found");
    const [comments, artifacts, runs, dependencies, events] = await Promise.all([
      sql`select c.*, a.display_name as agent_display_name, a.avatar as agent_avatar
          from task_comments c left join agents a on a.id = c.author_id
          where c.task_id = ${input.id} and c.deleted_at is null
          order by c.created_at asc`,
      sql`select * from artifacts where task_id = ${input.id} and deleted_at is null order by created_at desc`,
      sql`select r.*, a.display_name as agent_display_name, a.avatar as agent_avatar
          from agent_runs r join agents a on a.id = r.agent_id
          where r.task_id = ${input.id} order by r.attempt_number desc`,
      sql`select d.depends_on_task_id, t.title, t.status
          from task_dependencies d join tasks t on t.id = d.depends_on_task_id
          where d.task_id = ${input.id}`,
      sql`select * from events where subject_type = 'task' and subject_id = ${input.id}
          order by seq desc limit 50`,
    ]);
    return { task, comments, artifacts, runs, dependencies, events };
  }),

  create: publicProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      title: z.string().min(1),
      description: z.string().optional(),
      priority: z.number().int().min(1).max(5).default(3),
      assignmentMode: z.enum(ASSIGNMENT_MODES).default("manual"),
      requiredSkills: z.array(z.string()).default([]),
      acceptanceCriteria: z.array(criterionSchema).default([]),
      proofRequired: z.boolean().default(true),
      parentTaskId: z.string().uuid().nullish(),
      budgetUsd: z.number().nonnegative().nullish(),
      dueAt: z.string().datetime().nullish(),
      // create straight to pending when criteria are present
      submit: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      const status = input.submit && input.acceptanceCriteria.length > 0 ? "pending" : "draft";
      // Roster routing (docs/agents/AGENT_ROSTER.md): when mode is autonomous/suggested
      // and the caller did not pin skills, derive exclusive required_skills from title/body.
      const shouldRoute =
        (input.assignmentMode === "autonomous" || input.assignmentMode === "suggested")
        && input.requiredSkills.length === 0;
      const decision = shouldRoute ? routeTask(input.title, input.description) : null;
      const requiredSkills = decision?.requiredSkills ?? input.requiredSkills;

      try {
        return await sql.begin(async (tx) => {
          let candidateIds: string[] = [];
          if (decision && input.assignmentMode === "suggested") {
            const names = decision.candidates.map((c) => c.agentName);
            if (names.length) {
              const rows = await tx`
                select id, name from agents
                where name = any(${names}) and deleted_at is null`;
              const byName = new Map(rows.map((r) => [r.name as string, r.id as string]));
              candidateIds = names.map((n) => byName.get(n)).filter((id): id is string => !!id);
            }
          }

          const [task] = await tx`
            insert into tasks (project_id, parent_task_id, title, description, status, priority,
                               assignment_mode, required_skills, acceptance_criteria, proof_required,
                               budget_usd, due_at, candidate_agent_ids)
            values (${input.projectId}, ${input.parentTaskId ?? null}, ${input.title},
                    ${input.description ?? null}, ${status}, ${input.priority},
                    ${input.assignmentMode}, ${requiredSkills}, ${tx.json(input.acceptanceCriteria)},
                    ${input.proofRequired}, ${input.budgetUsd ?? null}, ${input.dueAt ?? null},
                    ${candidateIds})
            returning *`;
          await emit(tx, {
            type: "task.created", actorType: ctx.actorType, actorId: ctx.actorId,
            subjectType: "task", subjectId: task.id as string,
            data: {
              snapshot: {
                title: input.title, status, priority: input.priority, project_id: input.projectId,
                required_skills: requiredSkills,
                route: decision
                  ? { agent: decision.agentName, reason: decision.reason, score: decision.score }
                  : null,
              },
            },
          });
          if (decision) {
            await emit(tx, {
              type: input.assignmentMode === "suggested" ? "orchestrator.suggested" : "orchestrator.assigned",
              actorType: "system",
              subjectType: "task", subjectId: task.id as string,
              data: {
                agent_name: decision.agentName,
                required_skills: requiredSkills,
                reason: decision.reason,
                score: decision.score,
                candidates: decision.candidates,
              },
            });
          }
          if (status === "pending") await emitReadyIfReady(tx, task.id as string);
          return task;
        });
      } catch (err) { dbError(err); }
    }),

  update: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      title: z.string().min(1).optional(),
      description: z.string().nullish(),
      priority: z.number().int().min(1).max(5).optional(),
      assignmentMode: z.enum(ASSIGNMENT_MODES).optional(),
      requiredSkills: z.array(z.string()).optional(),
      proofRequired: z.boolean().optional(),
      budgetUsd: z.number().nonnegative().nullish(),
      dueAt: z.string().datetime().nullish(),
      aiSummary: z.string().nullish(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...patch } = input;
      try {
        return await sql.begin(async (tx) => {
          const [task] = await tx`
            update tasks set
              title = coalesce(${patch.title ?? null}, title),
              description = coalesce(${patch.description ?? null}, description),
              priority = coalesce(${patch.priority ?? null}, priority),
              assignment_mode = coalesce(${patch.assignmentMode ?? null}, assignment_mode),
              required_skills = coalesce(${patch.requiredSkills ?? null}, required_skills),
              proof_required = coalesce(${patch.proofRequired ?? null}, proof_required),
              budget_usd = coalesce(${patch.budgetUsd ?? null}, budget_usd),
              due_at = coalesce(${patch.dueAt ?? null}, due_at),
              ai_summary = coalesce(${patch.aiSummary ?? null}, ai_summary)
            where id = ${id} and deleted_at is null
            returning *`;
          if (!task) throw new Error("task not found");
          await emit(tx, {
            type: "task.updated", actorType: ctx.actorType, actorId: ctx.actorId,
            subjectType: "task", subjectId: id, data: { diff: patch },
          });
          return task;
        });
      } catch (err) { dbError(err); }
    }),

  setStatus: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      status: z.enum(TASK_STATUSES),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await sql.begin(async (tx) => {
          const [before] = await tx`select status from tasks where id = ${input.id}`;
          if (!before) throw new Error("task not found");
          // The DB trigger enforces legality + DoD; we just attempt it.
          const [task] = await tx`
            update tasks set status = ${input.status} where id = ${input.id} returning *`;
          await emit(tx, {
            type: "task.status_changed", actorType: ctx.actorType, actorId: ctx.actorId,
            subjectType: "task", subjectId: input.id,
            data: { from: before.status, to: input.status, reason: input.reason ?? null },
          });
          if (input.status === "blocked") {
            await emit(tx, {
              type: "task.blocked", actorType: ctx.actorType, actorId: ctx.actorId,
              subjectType: "task", subjectId: input.id, data: { reason: input.reason ?? null },
            });
          }
          if (before.status === "blocked" && input.status === "pending") {
            await emit(tx, {
              type: "task.unblocked", actorType: ctx.actorType, actorId: ctx.actorId,
              subjectType: "task", subjectId: input.id, data: { reason: input.reason ?? null },
            });
          }
          if (input.status === "pending") await emitReadyIfReady(tx, input.id);
          return task;
        });
      } catch (err) { dbError(err); }
    }),

  setCriteria: publicProcedure
    .input(z.object({ id: z.string().uuid(), criteria: z.array(criterionSchema).min(0) }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await sql.begin(async (tx) => {
          const [task] = await tx`
            update tasks set acceptance_criteria = ${tx.json(input.criteria)}
            where id = ${input.id} and deleted_at is null returning *`;
          if (!task) throw new Error("task not found");
          await emit(tx, {
            type: "task.updated", actorType: ctx.actorType, actorId: ctx.actorId,
            subjectType: "task", subjectId: input.id,
            data: { diff: { acceptance_criteria: input.criteria } },
          });
          return task;
        });
      } catch (err) { dbError(err); }
    }),

  checkCriterion: publicProcedure
    .input(z.object({ id: z.string().uuid(), criterionId: z.string(), met: z.boolean(), verifiedBy: z.string().default("cody") }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await sql.begin(async (tx) => {
          const [task] = await tx`
            update tasks set acceptance_criteria = (
              select coalesce(jsonb_agg(
                case when c->>'id' = ${input.criterionId}
                  then c || jsonb_build_object('met', ${input.met}::boolean, 'verified_by', ${input.met ? input.verifiedBy : null}::text)
                  else c end), '[]'::jsonb)
              from jsonb_array_elements(acceptance_criteria) c)
            where id = ${input.id} returning *`;
          if (!task) throw new Error("task not found");
          await emit(tx, {
            type: "task.updated", actorType: ctx.actorType, actorId: ctx.actorId,
            subjectType: "task", subjectId: input.id,
            data: { diff: { criterion: input.criterionId, met: input.met } },
          });
          return task;
        });
      } catch (err) { dbError(err); }
    }),

  assign: publicProcedure
    .input(z.object({ id: z.string().uuid(), agentId: z.string().uuid().nullable() }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await sql.begin(async (tx) => {
          const [task] = await tx`
            update tasks set assigned_agent_id = ${input.agentId}
            where id = ${input.id} and deleted_at is null returning *`;
          if (!task) throw new Error("task not found");
          await emit(tx, {
            type: "task.updated", actorType: ctx.actorType, actorId: ctx.actorId,
            subjectType: "task", subjectId: input.id,
            data: { diff: { assigned_agent_id: input.agentId } },
          });
          return task;
        });
      } catch (err) { dbError(err); }
    }),

  addDependency: publicProcedure
    .input(z.object({ taskId: z.string().uuid(), dependsOnTaskId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      if (input.taskId === input.dependsOnTaskId) throw new Error("a task cannot depend on itself");
      try {
        return await sql.begin(async (tx) => {
          // cycle check (API-layer, DETAILS §3.3): walk up from dependsOn; if we reach taskId, reject
          const cycle = await tx`
            with recursive up as (
              select depends_on_task_id from task_dependencies where task_id = ${input.dependsOnTaskId}
              union
              select d.depends_on_task_id from task_dependencies d join up on d.task_id = up.depends_on_task_id
            ) select 1 from up where depends_on_task_id = ${input.taskId} limit 1`;
          if (cycle.length > 0) throw new Error("dependency would create a cycle");
          await tx`
            insert into task_dependencies (task_id, depends_on_task_id)
            values (${input.taskId}, ${input.dependsOnTaskId})
            on conflict do nothing`;
          await emit(tx, {
            type: "task.updated", actorType: ctx.actorType, actorId: ctx.actorId,
            subjectType: "task", subjectId: input.taskId,
            data: { diff: { add_dependency: input.dependsOnTaskId } },
          });
          return { ok: true };
        });
      } catch (err) { dbError(err); }
    }),

  removeDependency: publicProcedure
    .input(z.object({ taskId: z.string().uuid(), dependsOnTaskId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await sql.begin(async (tx) => {
          await tx`
            delete from task_dependencies
            where task_id = ${input.taskId} and depends_on_task_id = ${input.dependsOnTaskId}`;
          await emit(tx, {
            type: "task.updated", actorType: ctx.actorType, actorId: ctx.actorId,
            subjectType: "task", subjectId: input.taskId,
            data: { diff: { remove_dependency: input.dependsOnTaskId } },
          });
          await emitReadyIfReady(tx, input.taskId);
          return { ok: true };
        });
      } catch (err) { dbError(err); }
    }),
});
