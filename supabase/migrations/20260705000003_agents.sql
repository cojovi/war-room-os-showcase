-- 0003: agents, agent_capabilities (ARCHITECTURE.md §3.4–3.5)

create table agents (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  display_name text,
  avatar text,
  machine_id text not null,
  status agent_status not null default 'offline',
  current_run_id uuid, -- FK added in 0004 after agent_runs exists
  model text,
  system_prompt text,
  max_concurrent_runs int not null default 1,
  daily_budget_usd numeric(10,4),
  spent_today_usd numeric(10,4) not null default 0,
  last_heartbeat_at timestamptz,
  agent_card jsonb not null default '{}'::jsonb,
  memory jsonb not null default '{}'::jsonb,
  stats jsonb not null default '{"runs_total": 0, "runs_succeeded": 0, "runs_failed": 0, "avg_duration_s": 0}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table agent_capabilities (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id),
  skill text not null,
  proficiency smallint not null default 3 check (proficiency between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_id, skill)
);

alter table tasks
  add constraint tasks_assigned_agent_id_fkey
  foreign key (assigned_agent_id) references agents(id);
