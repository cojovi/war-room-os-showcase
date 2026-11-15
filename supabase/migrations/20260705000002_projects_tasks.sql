-- 0002: projects, tasks, task_dependencies (ARCHITECTURE.md §3.1–3.3)

create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status project_status not null default 'active',
  goals jsonb not null default '[]'::jsonb,
  default_budget_usd numeric(10,4),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  parent_task_id uuid references tasks(id),
  title text not null,
  description text,
  status task_status not null default 'draft',
  priority smallint not null default 3 check (priority between 1 and 5),
  assignment_mode assignment_mode not null default 'manual',
  required_skills text[] not null default '{}',
  assigned_agent_id uuid, -- FK added in 0003 after agents exists
  candidate_agent_ids uuid[] not null default '{}',
  acceptance_criteria jsonb not null default '[]'::jsonb,
  verification_steps jsonb not null default '[]'::jsonb,
  proof_required boolean not null default true,
  ai_summary text,
  budget_usd numeric(10,4),
  spent_usd numeric(10,4) not null default 0,
  approval_policy jsonb not null default '{}'::jsonb,
  retry_count int not null default 0,
  max_retries int not null default 3,
  due_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table task_dependencies (
  task_id uuid not null references tasks(id),
  depends_on_task_id uuid not null references tasks(id),
  created_at timestamptz not null default now(),
  primary key (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id)
);
