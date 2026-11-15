-- 0009: claimable_tasks view + RLS lockdown + append-only revokes
-- (ARCHITECTURE.md §4 Phase 1, §8.6; DETAILS.md §3.1)

-- What daemons poll. The actual claim uses FOR UPDATE SKIP LOCKED against
-- tasks directly (DETAILS §3.1); this view is the readable filter.
create view claimable_tasks as
select t.*
from tasks t
where t.status = 'pending'
  and t.deleted_at is null
  and not exists (
    select 1 from task_dependencies d
    join tasks dep on dep.id = d.depends_on_task_id
    where d.task_id = t.id and dep.status <> 'done')
  and not exists (
    select 1 from system_state
    where key = 'global_pause' and (value->>'paused')::bool = true);

-- RLS: deny-by-default for Supabase client roles. The API service and daemons
-- connect with dedicated credentials; the dashboard talks only to the API.
do $$
declare t text;
begin
  foreach t in array array[
    'projects', 'tasks', 'task_dependencies', 'agents', 'agent_capabilities',
    'agent_runs', 'task_comments', 'artifacts', 'events', 'cost_events',
    'approval_requests', 'notifications', 'system_state'
  ]
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end;
$$;

-- Belt-and-suspenders for append-only tables (trigger in 0005 is the primary guard).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke update, delete on events, cost_events from anon, authenticated;
  end if;
end;
$$;
