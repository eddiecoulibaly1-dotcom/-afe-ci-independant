-- Permit bounded recovery beyond the initial three attempts.
-- A provider/schema incident must not permanently strand an otherwise recoverable debate.
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
    and s.attempt_count < 8
    and (
      s.status = 'pending'
      or s.status = 'failed'
      or (s.status = 'running' and s.lease_expires_at < now())
    )
  returning s.*;
end;
$$;

revoke all on function public.claim_debate_execution_step(uuid, integer, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.claim_debate_execution_step(uuid, integer, text, jsonb, integer) to service_role;
notify pgrst, 'reload schema';
