-- 0011: the reaper (Phase 4 keystone) + daily budget reset
-- Runs inside Postgres via pg_cron so it survives hub outages and machine
-- reboots — the DB is the only component that is always up.
--
-- Policy (ARCHITECTURE §5, DETAILS §14):
--   * agent silent > 60s  → status 'offline' + agent.heartbeat_lost event
--   * active run whose agent is silent > 90s → run 'abandoned', task back to
--     'pending' with retry_count+1 (or 'failed' + critical notification when
--     retries are exhausted), agent slot freed
--   * runs in 'awaiting_approval' are NOT reaped — they are checkpointed and
--     legitimately waiting on a human, possibly for hours.

create or replace function reap_stale_agents_and_runs() returns jsonb
language plpgsql as $$
declare
  agents_flipped int := 0;
  runs_reaped int := 0;
  a record;
  r record;
begin
  -- 1) dead daemons → offline
  for a in
    select id, name, status, last_heartbeat_at
    from agents
    where deleted_at is null
      and status in ('idle', 'working', 'blocked', 'error')
      and (last_heartbeat_at is null or last_heartbeat_at < now() - interval '60 seconds')
  loop
    update agents set status = 'offline' where id = a.id;
    insert into events (event_type, actor_type, subject_type, subject_id, payload)
    values ('agent.heartbeat_lost', 'system', 'agent', a.id,
            jsonb_build_object('schema_version', 1, 'data', jsonb_build_object(
              'last_heartbeat_at', a.last_heartbeat_at, 'from_status', a.status)));
    insert into notifications (severity, title, body, link_type, link_id)
    values ('warning', 'Agent heartbeat lost',
            format('%s stopped heartbeating (last: %s) — marked offline by the reaper.',
                   a.name, coalesce(a.last_heartbeat_at::text, 'never')),
            'agent', a.id);
    agents_flipped := agents_flipped + 1;
  end loop;

  -- 2) runs stranded by a dead agent → abandoned + task requeued/failed
  for r in
    select ar.id as run_id, ar.task_id, ar.agent_id,
           t.status as task_status, t.retry_count, t.max_retries, t.title
    from agent_runs ar
    join agents ag on ag.id = ar.agent_id
    join tasks t on t.id = ar.task_id
    where ar.status in ('queued', 'starting', 'running')
      and (ag.last_heartbeat_at is null or ag.last_heartbeat_at < now() - interval '90 seconds')
  loop
    update agent_runs
    set status = 'abandoned', ended_at = now(),
        error = jsonb_build_object('type', 'heartbeat_lost',
                                   'message', 'agent stopped heartbeating; run reaped',
                                   'recoverable', true)
    where id = r.run_id;
    update agents set current_run_id = null
    where id = r.agent_id and current_run_id = r.run_id;
    insert into events (event_type, actor_type, subject_type, subject_id, payload)
    values ('run.abandoned', 'system', 'run', r.run_id,
            jsonb_build_object('schema_version', 1, 'data', jsonb_build_object(
              'task_id', r.task_id, 'agent_id', r.agent_id, 'reason', 'heartbeat lost')));

    if r.task_status in ('claimed', 'in_progress') then
      if r.task_status = 'in_progress' and r.retry_count + 1 >= r.max_retries then
        update tasks set status = 'failed', retry_count = retry_count + 1 where id = r.task_id;
        insert into events (event_type, actor_type, subject_type, subject_id, payload)
        values ('task.status_changed', 'system', 'task', r.task_id,
                jsonb_build_object('schema_version', 1, 'data', jsonb_build_object(
                  'from', r.task_status, 'to', 'failed',
                  'reason', 'run abandoned by reaper; retries exhausted')));
        insert into notifications (severity, title, body, link_type, link_id)
        values ('critical', 'Task failed after agent died',
                format('"%s" exhausted retries after its agent stopped heartbeating.', r.title),
                'task', r.task_id);
      else
        update tasks set status = 'pending', retry_count = retry_count + 1 where id = r.task_id;
        insert into events (event_type, actor_type, subject_type, subject_id, payload)
        values ('task.status_changed', 'system', 'task', r.task_id,
                jsonb_build_object('schema_version', 1, 'data', jsonb_build_object(
                  'from', r.task_status, 'to', 'pending',
                  'reason', 'run abandoned by reaper; requeued')));
      end if;
    end if;
    runs_reaped := runs_reaped + 1;
  end loop;

  return jsonb_build_object('agents_marked_offline', agents_flipped,
                            'runs_abandoned', runs_reaped);
end;
$$;

-- Daily budget reset (DETAILS §7.1). Chicago midnight ≈ 05:00 UTC during CDT;
-- during CST it fires at 23:00 local, which errs harmless-early. Good enough
-- until a tz-aware scheduler matters.
create or replace function reset_daily_budgets() returns void
language plpgsql as $$
begin
  update agents set spent_today_usd = 0 where spent_today_usd <> 0;
end;
$$;

-- Schedule via pg_cron where available (hosted Supabase). Plain/local
-- Postgres lacks the extension — tests call the functions directly.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('warroom-reaper', '* * * * *',
                          'select reap_stale_agents_and_runs()');
    perform cron.schedule('warroom-budget-reset', '0 5 * * *',
                          'select reset_daily_budgets()');
  else
    raise notice 'pg_cron not available; reaper must be invoked externally';
  end if;
end;
$$;
