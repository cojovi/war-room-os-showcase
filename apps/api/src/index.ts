import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { trpcServer } from "@hono/trpc-server";
import { router } from "./trpc.js";
import type { Context } from "./trpc.js";
import { sql } from "./db.js";
import { daemonRoutes } from "./daemon.js";
import { projectRouter } from "./routers/project.js";
import { taskRouter } from "./routers/task.js";
import { commentRouter } from "./routers/comment.js";
import { artifactRouter } from "./routers/artifact.js";
import { agentRouter } from "./routers/agent.js";
import {
  runRouter, approvalRouter, eventRouter,
  costRouter, notificationRouter, systemRouter,
} from "./routers/misc.js";

export const appRouter = router({
  project: projectRouter,
  task: taskRouter,
  comment: commentRouter,
  artifact: artifactRouter,
  agent: agentRouter,
  run: runRouter,
  approval: approvalRouter,
  event: eventRouter,
  cost: costRouter,
  notification: notificationRouter,
  system: systemRouter,
});
export type AppRouter = typeof appRouter;

const app = new Hono();

app.use("*", cors({ origin: ["http://127.0.0.1:3107", "http://localhost:3107"] }));

app.get("/health", async (c) => {
  const [{ ok }] = await sql`select 1 as ok`;
  return c.json({ ok: ok === 1, service: "war-room-api" });
});

app.use("/trpc/*", trpcServer({
  router: appRouter,
  endpoint: "/trpc",
  createContext: (): Context => ({ actorType: "human", actorId: null }),
}));

// Daemon-facing REST surface (DETAILS §12).
app.get("/d/system/pause-state", async (c) => {
  const [row] = await sql`select value from system_state where key = 'global_pause'`;
  return c.json(row.value);
});
app.route("/d", daemonRoutes);
app.onError((err, c) => c.json({ error: err.message }, 400));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
  console.log(`war-room-api listening on :${port}`);
});
