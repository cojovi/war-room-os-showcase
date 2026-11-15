import { existsSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import type { AuthorType, EventType } from "@agos/shared";

// Load repo-root .env (real env vars always win over file values).
for (const candidate of [".env", "../../.env", "../.env"]) {
  const p = resolve(process.cwd(), candidate);
  if (existsSync(p)) {
    process.loadEnvFile(p);
    break;
  }
}

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:test@localhost:54322/postgres";

export const sql = postgres(DATABASE_URL, {
  max: 10,
  onnotice: () => {},
});

export type Sql = typeof sql;
export type Tx = postgres.TransactionSql<Record<string, unknown>>;

export interface EmitArgs {
  type: EventType;
  actorType: AuthorType;
  actorId?: string | null;
  subjectType: string;
  subjectId: string;
  data?: Record<string, unknown>;
  correlationId?: string | null;
}

// Outbox pattern (DETAILS §3.2): every mutation and its event(s) commit together.
// Always called with the transaction handle, never the root client.
export async function emit(tx: Tx, e: EmitArgs): Promise<void> {
  await tx`
    insert into events (event_type, actor_type, actor_id, subject_type, subject_id, payload, correlation_id)
    values (
      ${e.type}, ${e.actorType}, ${e.actorId ?? null}, ${e.subjectType}, ${e.subjectId},
      ${tx.json({
        schema_version: 1,
        occurred_at: new Date().toISOString(),
        actor: { type: e.actorType, id: e.actorId ?? null },
        subject: { type: e.subjectType, id: e.subjectId },
        data: e.data ?? {},
      } as postgres.JSONValue)},
      ${e.correlationId ?? null}
    )`;
}
