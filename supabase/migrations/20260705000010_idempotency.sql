-- 0010: idempotency keys for daemon→API writes (DETAILS.md §9.9)
-- Retried HTTP calls must not double-post comments/costs/artifacts.

create table idempotency_keys (
  key text primary key,
  response jsonb not null,
  created_at timestamptz not null default now()
);

-- RLS like everything else; API connects with service credentials.
alter table idempotency_keys enable row level security;
