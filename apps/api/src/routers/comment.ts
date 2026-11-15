import { z } from "zod";
import { router, publicProcedure, dbError } from "../trpc.js";
import { sql, emit } from "../db.js";
import { COMMENT_KINDS } from "@agos/shared";

export const commentRouter = router({
  list: publicProcedure
    .input(z.object({ taskId: z.string().uuid() }))
    .query(async ({ input }) => {
      return sql`
        select c.*, a.display_name as agent_display_name, a.avatar as agent_avatar
        from task_comments c left join agents a on a.id = c.author_id
        where c.task_id = ${input.taskId} and c.deleted_at is null
        order by c.created_at asc`;
    }),

  thread: publicProcedure
    .input(z.object({ commentId: z.string().uuid() }))
    .query(async ({ input }) => {
      return sql`
        with recursive thread as (
          select * from task_comments where id = ${input.commentId}
          union all
          select c.* from task_comments c join thread t on c.parent_comment_id = t.id
        ) select * from thread order by created_at asc`;
    }),

  add: publicProcedure
    .input(z.object({
      taskId: z.string().uuid(),
      body: z.string().min(1),
      kind: z.enum(COMMENT_KINDS).default("comment"),
      parentCommentId: z.string().uuid().nullish(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await sql.begin(async (tx) => {
          const [comment] = await tx`
            insert into task_comments (task_id, author_type, author_id, parent_comment_id, body, kind)
            values (${input.taskId}, ${ctx.actorType}, ${ctx.actorId}, ${input.parentCommentId ?? null},
                    ${input.body}, ${input.kind})
            returning *`;
          await emit(tx, {
            type: "task.comment_added", actorType: ctx.actorType, actorId: ctx.actorId,
            subjectType: "task", subjectId: input.taskId,
            data: { comment_id: comment.id, author: ctx.actorType, kind: input.kind },
          });
          return comment;
        });
      } catch (err) { dbError(err); }
    }),
});
