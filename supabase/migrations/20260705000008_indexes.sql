-- 0008: minimum index set (DETAILS.md §3.5)

create index tasks_claim_idx on tasks (status, priority, created_at);
create index tasks_project_idx on tasks (project_id);
create index tasks_assigned_agent_idx on tasks (assigned_agent_id);
create index tasks_parent_idx on tasks (parent_task_id);

create index events_subject_idx on events (subject_type, subject_id, seq desc);
create index events_type_idx on events (event_type, seq desc);

create index task_comments_task_idx on task_comments (task_id, created_at);

create index agent_runs_task_idx on agent_runs (task_id, attempt_number);
create index agent_runs_agent_idx on agent_runs (agent_id, started_at desc);

create index cost_events_agent_idx on cost_events (agent_id, recorded_at);
create index cost_events_task_idx on cost_events (task_id);

create index approval_requests_pending_idx on approval_requests (status) where status = 'pending';
create index notifications_unread_idx on notifications (recipient, read_at) where read_at is null;
