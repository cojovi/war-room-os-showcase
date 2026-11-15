-- 0006: approval_requests, notifications, system_state (ARCHITECTURE.md §3.11–3.13)

create table approval_requests (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references agent_runs(id),
  task_id uuid not null references tasks(id),
  action_type gated_action not null,
  action_detail jsonb not null,
  risk_note text,
  status approval_status not null default 'pending',
  decided_by uuid,
  decided_at timestamptz,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  recipient text not null default 'cody',
  severity severity not null default 'info',
  title text not null,
  body text,
  link_type text,
  link_id uuid,
  channels text[] not null default '{dashboard}',
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table system_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into system_state (key, value) values
  ('global_pause', '{"paused": false, "paused_by": null, "paused_at": null, "reason": null}'),
  ('global_budget', '{"daily_cap_usd": 25, "spent_today_usd": 0}'),
  ('model_prices', '{
    "claude-sonnet-4-6": {"in_per_mtok": 3.00, "out_per_mtok": 15.00},
    "claude-opus-4-8":   {"in_per_mtok": 15.00, "out_per_mtok": 75.00},
    "claude-haiku-4-5":  {"in_per_mtok": 1.00, "out_per_mtok": 5.00}
  }'),
  ('nats_relay_cursor', '{"seq": 0}');
