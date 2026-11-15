import { z } from "zod";
import { router, publicProcedure, dbError } from "../trpc.js";
import { sql, emit } from "../db.js";
import { ARTIFACT_KINDS } from "@agos/shared";

// Phase 1: inline artifacts (< 32KB) + links. Supabase Storage presigned
// uploads land when the hosted project exists (blocked on org invoice).
export const artifactRouter = router({
  list: publicProcedure
    .input(z.object({ taskId: z.string().uuid() }))
    .query(async ({ input }) => {
      return sql`select * from artifacts where task_id = ${input.taskId} and deleted_at is null order by created_at desc`;
    }),

  attach: publicProcedure
    .input(z.object({
      taskId: z.string().uuid(),
      runId: z.string().uuid().nullish(),
      name: z.string().min(1),
      kind: z.enum(ARTIFACT_KINDS).default("file"),
      inlineContent: z.string().max(32_768).nullish(),
      storagePath: z.string().nullish(),
      contentType: z.string().nullish(),
      isEvidence: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await sql.begin(async (tx) => {
          // same name + task = new version, never overwrite (ARCHITECTURE §3.8)
          const [{ next_version }] = await tx`
            select coalesce(max(version), 0) + 1 as next_version
            from artifacts where task_id = ${input.taskId} and name = ${input.name}`;
          const [artifact] = await tx`
            insert into artifacts (task_id, run_id, name, kind, inline_content, storage_path,
                                   content_type, size_bytes, is_evidence, version)
            values (${input.taskId}, ${input.runId ?? null}, ${input.name}, ${input.kind},
                    ${input.inlineContent ?? null}, ${input.storagePath ?? null},
                    ${input.contentType ?? null},
                    ${input.inlineContent ? Buffer.byteLength(input.inlineContent) : null},
                    ${input.isEvidence}, ${next_version as number})
            returning *`;
          await emit(tx, {
            type: "task.artifact_added", actorType: ctx.actorType, actorId: ctx.actorId,
            subjectType: "task", subjectId: input.taskId,
            data: { artifact_id: artifact.id, kind: input.kind, is_evidence: input.isEvidence },
          });
          return artifact;
        });
      } catch (err) { dbError(err); }
    }),

  markEvidence: publicProcedure
    .input(z.object({ id: z.string().uuid(), isEvidence: z.boolean().default(true) }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await sql.begin(async (tx) => {
          const [artifact] = await tx`
            update artifacts set is_evidence = ${input.isEvidence}
            where id = ${input.id} and deleted_at is null returning *`;
          if (!artifact) throw new Error("artifact not found");
          await emit(tx, {
            type: "task.artifact_added", actorType: ctx.actorType, actorId: ctx.actorId,
            subjectType: "task", subjectId: artifact.task_id as string,
            data: { artifact_id: input.id, is_evidence: input.isEvidence, marked: true },
          });
          return artifact;
        });
      } catch (err) { dbError(err); }
    }),
});
