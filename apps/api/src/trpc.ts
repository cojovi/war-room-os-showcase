import { initTRPC, TRPCError } from "@trpc/server";

// Local showcase: requests represent the fictional operator.
// Do not expose this unauthenticated demonstration API to a network.
export type Context = {
  actorType: "human";
  actorId: null;
};

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    // Surface Postgres trigger messages (DoD violations, illegal transitions)
    // verbatim — they are the product speaking, not noise.
    const cause = error.cause as { message?: string } | undefined;
    return {
      ...shape,
      message: cause?.message?.includes("violation") || cause?.message?.includes("illegal")
        ? cause.message
        : shape.message,
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

export function dbError(err: unknown): never {
  const message = err instanceof Error ? err.message : "database error";
  throw new TRPCError({ code: "BAD_REQUEST", message, cause: err });
}
