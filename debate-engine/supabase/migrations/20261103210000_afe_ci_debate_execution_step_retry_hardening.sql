-- AFE-CI: allow bounded retries for failed/expired execution steps.
-- A worker may write only while its lease is still valid.
create or replace function public.claim_debate_execution_step(
  p_debate_id uuid,
  p_round_number integer,
  p_agent_role text,
  p_input_snapshot jsonb default '{}'::jsonb,
  p_lease_seconds integer default 120
)
returns setof public.debate_execution_steps
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_claim_token uuid := gen_random_uuid();
begin
  if p_round_number < 1 then
    raise exception 'round_number must be positive' using errcode = '22023';
  end if;
  if p_agent_role not in ('architect', 'red_team', 'judge') then
    raise exception 'unsupported agent_role' using errcode = '22023';
  end if;
  if p_lease_seconds < 30 or p_lease_seconds > 300 then
    raise exception 'lease_seconds must be between 30 and 300' using errcode = '22023';
  end if;

  insert into public.debate_execution_steps
    (debate_id, round_number, agent_role, input_snapshot)
  values
    (p_debate_id, p_round_number, p_agent_role, coalesce(p_input_snapshot, '{}'::jsonb))
  on conflict (debate_id, round_number, agent_role) do nothing;

  return query
  update public.debate_execution_steps s
  set status = 'running',
      attempt_count = s.attempt_count + 1,
      input_snapshot = coalesce(p_input_snapshot, s.input_snapshot, '{}'::jsonb),
      claim_token = v_claim_token,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      started_at = coalesce(s.started_at, now()),
      completed_at = null,
      error_code = null,
      error_message = null,
      updated_at = now()
  where s.debate_id = p_debate_id
    and s.round_number = p_round_number
    and s.agent_role = p_agent_role
    and s.attempt_count < 3
    and (
      s.status = 'pending'
      or s.status = 'failed'
      or (s.status = 'running' and s.lease_expires_at < now())
    )
  returning s.*;
end;
$$;

create or replace function public.complete_debate_execution_step(
  p_step_id uuid,
  p_claim_token uuid,
  p_output_payload jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
begin
  update public.debate_execution_steps
  set status = 'completed',
      output_payload = coalesce(p_output_payload, '{}'::jsonb),
      error_code = null,
      error_message = null,
      claim_token = null,
      lease_expires_at = null,
      completed_at = now(),
      updated_at = now()
  where id = p_step_id
    and status = 'running'
    and claim_token = p_claim_token
    and lease_expires_at > now();
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

create or replace function public.fail_debate_execution_step(
  p_step_id uuid,
  p_claim_token uuid,
  p_error_code text,
  p_error_message text
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
begin
  update public.debate_execution_steps
  set status = 'failed',
      error_code = left(coalesce(p_error_code, 'AGENT_FAILED'), 120),
      error_message = left(coalesce(p_error_message, 'Agent execution failed'), 2000),
      claim_token = null,
      lease_expires_at = null,
      updated_at = now()
  where id = p_step_id
    and status = 'running'
    and claim_token = p_claim_token
    and lease_expires_at > now();
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

revoke all on function public.claim_debate_execution_step(uuid, integer, text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.complete_debate_execution_step(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fail_debate_execution_step(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_debate_execution_step(uuid, integer, text, jsonb, integer) to service_role;
grant execute on function public.complete_debate_execution_step(uuid, uuid, jsonb) to service_role;
grant execute on function public.fail_debate_execution_step(uuid, uuid, text, text) to service_role;

notify pgrst, 'reload schema';
