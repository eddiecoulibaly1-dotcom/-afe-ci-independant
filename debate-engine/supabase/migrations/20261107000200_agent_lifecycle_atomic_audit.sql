-- AFE-CI P0: atomic agent lifecycle transitions and immutable audit events.
-- This RPC is callable only with the Supabase service_role key. The application
-- server performs workspace-admin authorization before invoking it.
-- The row lock serializes concurrent transitions; status and event commit together.

begin;

create or replace function public.afe_transition_agent_lifecycle(
  p_workspace_id uuid,
  p_agent_id uuid,
  p_actor_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_agent public.afe_agents%rowtype;
  v_previous_status text;
  v_next_status text;
  v_event_type text;
  v_event_id bigint;
begin
  if p_workspace_id is null or p_agent_id is null or p_actor_id is null then
    raise exception 'workspace, agent and actor are required' using errcode = '22023';
  end if;

  select *
    into v_agent
    from public.afe_agents
   where id = p_agent_id
     and workspace_id = p_workspace_id
   for update;

  if not found then
    raise exception 'agent not found in workspace' using errcode = 'P0002';
  end if;

  v_previous_status := v_agent.status;

  case p_action
    when 'activate' then
      if v_previous_status <> 'draft' then
        raise exception 'invalid agent lifecycle transition: % -> active', v_previous_status using errcode = '23514';
      end if;
      v_next_status := 'active';
      v_event_type := 'agent.activated';
    when 'pause' then
      if v_previous_status <> 'active' then
        raise exception 'invalid agent lifecycle transition: % -> paused', v_previous_status using errcode = '23514';
      end if;
      v_next_status := 'paused';
      v_event_type := 'agent.paused';
    when 'archive' then
      if v_previous_status not in ('active', 'paused') then
        raise exception 'invalid agent lifecycle transition: % -> archived', v_previous_status using errcode = '23514';
      end if;
      v_next_status := 'archived';
      v_event_type := 'agent.archived';
    when 'restore' then
      if v_previous_status <> 'archived' then
        raise exception 'invalid agent lifecycle transition: % -> draft', v_previous_status using errcode = '23514';
      end if;
      v_next_status := 'draft';
      v_event_type := 'agent.restored';
    else
      raise exception 'unsupported agent lifecycle action' using errcode = '22023';
  end case;

  update public.afe_agents
     set status = v_next_status,
         updated_at = transaction_timestamp()
   where id = p_agent_id
     and workspace_id = p_workspace_id
   returning * into v_agent;

  insert into public.afe_agent_events (
    workspace_id, agent_id, actor_type, actor_id, event_type, payload
  ) values (
    p_workspace_id, p_agent_id, 'human', p_actor_id, v_event_type,
    jsonb_build_object(
      'previous_status', v_previous_status,
      'new_status', v_next_status,
      'action', p_action,
      'actor_id', p_actor_id,
      'occurred_at', transaction_timestamp()
    )
  )
  returning id into v_event_id;

  return jsonb_build_object('agent', to_jsonb(v_agent), 'event_id', v_event_id);
end;
$function$;

revoke all on function public.afe_transition_agent_lifecycle(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.afe_transition_agent_lifecycle(uuid, uuid, uuid, text)
  to service_role;

commit;
