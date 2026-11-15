-- 0004: agent_runs, task_comments, artifacts (ARCHITECTURE.md §3.6–3.8)

create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id),
  agent_id uuid not null references agents(id),
  attempt_number int not null,
  status run_status not null default 'queued',
  claim_source text check (claim_source in ('manual_assign', 'orchestrator_auto', 'orchestrator_suggested', 'self_claimed')),
  reasoning_summary text,
  started_at timestamptz,
  ended_at timestamptz,
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  cost_usd numeric(10,6) not null default 0,
  error jsonb,
  checkpoint jsonb,
  result_summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (task_id, attempt_number)
);

alter table agents
  add constraint agents_current_run_id_fkey
  foreign key (current_run_id) references agent_runs(id);

create table task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id),
  run_id uuid references agent_runs(id),
  author_type author_type not null,
  author_id uuid,
  parent_comment_id uuid references task_comments(id),
  body text not null,
  kind comment_kind not null default 'comment',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table artifacts (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id),
  run_id uuid references agent_runs(id),
  name text not null,
  kind artifact_kind not null default 'file',
  storage_path text,
  inline_content text,
  content_type text,
  size_bytes bigint,
  is_evidence boolean not null default false,
  version int not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
