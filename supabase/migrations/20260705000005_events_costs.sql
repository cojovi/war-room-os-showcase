-- 0005: events (the spine) + cost_events — both append-only (ARCHITECTURE.md §3.9–3.10)

create table events (
  id uuid primary key default gen_random_uuid(),
  seq bigserial unique,
  event_type text not null,
  event_version smallint not null default 1,
  actor_type author_type not null,
  actor_id uuid,
  subject_type text not null,
  subject_id uuid not null,
  payload jsonb not null,
  correlation_id uuid,
  created_at timestamptz not null default now()
);

create table cost_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references agent_runs(id),
  agent_id uuid,
  task_id uuid,
  model text not null,
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  cost_usd numeric(10,6) not null default 0,
  recorded_at timestamptz not null default now()
);

-- Append-only enforcement: trigger (works for all roles incl. table owner)
-- + REVOKE belt-and-suspenders applied in 0009 with role grants.
create function forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only: % not allowed', tg_table_name, tg_op;
end;
$$;

create trigger events_append_only
  before update or delete on events
  for each row execute function forbid_mutation();

create trigger cost_events_append_only
  before update or delete on cost_events
  for each row execute function forbid_mutation();
