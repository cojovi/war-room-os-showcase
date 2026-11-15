-- 0007: updated_at triggers, task status transition + Definition-of-Done enforcement
-- (ARCHITECTURE.md §3.2, DETAILS.md §2.1, §3.3, §3.4)

create function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'projects', 'tasks', 'agents', 'agent_capabilities', 'agent_runs',
    'task_comments', 'artifacts', 'approval_requests', 'notifications', 'system_state'
  ]
  loop
    execute format(
      'create trigger %I before update on %I for each row execute function set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;
end;
$$;

-- Definition of Done + legal status transitions.
-- A task cannot leave draft without ≥1 acceptance criterion.
-- A task cannot become done unless every criterion is met and,
-- if proof_required, ≥1 evidence artifact exists. Agents do not vibe-complete.
create function enforce_task_transitions() returns trigger
language plpgsql as $$
declare
  n_criteria int;
  n_unmet int;
  legal boolean;
begin
  n_criteria := jsonb_array_length(coalesce(new.acceptance_criteria, '[]'::jsonb));

  if tg_op = 'INSERT' then
    if new.status <> 'draft' and n_criteria < 1 then
      raise exception 'task cannot be created as % without at least 1 acceptance criterion', new.status;
    end if;
    return new;
  end if;

  if old.status = new.status then
    return new;
  end if;

  -- legal transition map (DETAILS.md §2.1; reaper paths included)
  legal := case old.status
    when 'draft'       then new.status in ('pending', 'cancelled')
    when 'pending'     then new.status in ('claimed', 'blocked', 'cancelled')
    when 'claimed'     then new.status in ('in_progress', 'pending', 'blocked', 'cancelled')
    when 'in_progress' then new.status in ('review', 'blocked', 'done', 'failed', 'pending', 'cancelled')
    when 'review'      then new.status in ('done', 'pending', 'blocked', 'cancelled')
    when 'blocked'     then new.status in ('pending', 'cancelled')
    when 'failed'      then new.status in ('pending', 'cancelled')
    when 'done'        then false
    when 'cancelled'   then false
  end;

  if not legal then
    raise exception 'illegal task status transition: % -> %', old.status, new.status;
  end if;

  if old.status = 'draft' and new.status = 'pending' then
    if n_criteria < 1 then
      raise exception 'task cannot leave draft without at least 1 acceptance criterion';
    end if;
    if new.title is null or length(trim(new.title)) = 0 then
      raise exception 'task cannot leave draft without a title';
    end if;
  end if;

  if new.status = 'done' then
    if n_criteria < 1 then
      raise exception 'DoD violation: task has no acceptance criteria';
    end if;
    select count(*) into n_unmet
    from jsonb_array_elements(new.acceptance_criteria) c
    where coalesce((c->>'met')::boolean, false) = false;
    if n_unmet > 0 then
      raise exception 'DoD violation: % acceptance criteria not met', n_unmet;
    end if;
    if new.proof_required and not exists (
      select 1 from artifacts
      where task_id = new.id and is_evidence and deleted_at is null
    ) then
      raise exception 'DoD violation: proof_required but no evidence artifact attached';
    end if;
  end if;

  return new;
end;
$$;

create trigger tasks_enforce_transitions
  before insert or update on tasks
  for each row execute function enforce_task_transitions();
