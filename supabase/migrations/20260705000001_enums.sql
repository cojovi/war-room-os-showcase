-- 0001: enum types (DETAILS.md §2)

create type project_status as enum ('active', 'paused', 'archived', 'completed');

create type task_status as enum (
  'draft', 'pending', 'claimed', 'in_progress', 'review',
  'blocked', 'done', 'failed', 'cancelled'
);

create type run_status as enum (
  'queued', 'starting', 'running', 'awaiting_approval',
  'succeeded', 'failed', 'abandoned', 'killed'
);

create type agent_status as enum ('offline', 'idle', 'working', 'blocked', 'paused', 'error');

create type assignment_mode as enum ('manual', 'suggested', 'autonomous');

create type author_type as enum ('human', 'agent', 'system');

create type comment_kind as enum ('comment', 'status_update', 'question', 'decision', 'handoff');

create type artifact_kind as enum ('file', 'link', 'code', 'log', 'image', 'evidence');

create type approval_status as enum ('pending', 'approved', 'denied', 'expired');

create type severity as enum ('info', 'success', 'warning', 'critical');

create type gated_action as enum (
  'delete_file_outside_workspace',
  'shell_outside_workspace',
  'deploy_production',
  'send_email',
  'send_message',
  'spend_money',
  'access_secret',
  'modify_home_automation',
  'install_software',
  'network_request_new_domain',
  'write_to_shared_repo'
);
