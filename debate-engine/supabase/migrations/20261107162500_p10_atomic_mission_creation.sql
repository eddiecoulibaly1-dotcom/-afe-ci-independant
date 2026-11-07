-- P10: atomic mission creation, dependency registration and audit event.
begin;
create or replace function public.afe_create_agent_mission(
 p_workspace_id uuid,
 p_agent_id uuid,
 p_created_by uuid,
 p_title text,
 p_objective text,
 p_input_context jsonb default '{}'::jsonb,
 p_priority smallint default 3,
 p_autonomy_level smallint default 1,
 p_idempotency_key text default null,
 p_parent_mission_id uuid default null,
 p_orchestration_mode text default 'leaf',
 p_dependency_ids uuid[] default '{}'::uuid[]
) returns public.afe_agent_missions
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare
 v public.afe_agent_missions%rowtype;
 v_dependency uuid;
 v_mode text;
begin
 if p_workspace_id is null or p_agent_id is null or length(trim(coalesce(p_title,'')))<3 or length(trim(coalesce(p_objective,'')))<10 then
   raise exception 'invalid mission input' using errcode='22023';
 end if;
 if p_priority not between 1 and 5 or p_autonomy_level not between 1 and 3 then
   raise exception 'invalid mission priority or autonomy' using errcode='22023';
 end if;
 if p_idempotency_key is not null then
   perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':'||p_idempotency_key,0));
   select * into v from public.afe_agent_missions
    where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key limit 1;
   if found then return v; end if;
 end if;
 if not exists(select 1 from public.afe_agents where id=p_agent_id and workspace_id=p_workspace_id and status='active') then
   raise exception 'active agent not found in workspace' using errcode='23503';
 end if;
 if p_parent_mission_id is not null then
   select * into v from public.afe_agent_missions
    where id=p_parent_mission_id and workspace_id=p_workspace_id for update;
   if not found then raise exception 'parent mission not found in workspace' using errcode='23503'; end if;
   if v.orchestration_mode<>'coordinator' or v.delegation_state<>'open' or v.status not in ('queued','planning','paused') then
     raise exception 'parent coordinator delegation is not open' using errcode='23514';
   end if;
   v_mode:='leaf';
 else
   if p_orchestration_mode not in ('leaf','coordinator') then raise exception 'invalid orchestration mode' using errcode='22023'; end if;
   v_mode:=p_orchestration_mode;
 end if;
 insert into public.afe_agent_missions(
   workspace_id,agent_id,created_by,title,objective,input_context,priority,autonomy_level,
   idempotency_key,parent_mission_id,orchestration_mode,delegation_state
 ) values (
   p_workspace_id,p_agent_id,p_created_by,trim(p_title),trim(p_objective),coalesce(p_input_context,'{}'::jsonb),
   p_priority,p_autonomy_level,p_idempotency_key,p_parent_mission_id,v_mode,
   case when v_mode='coordinator' then 'open' else 'closed' end
 ) returning * into v;

 foreach v_dependency in array coalesce(p_dependency_ids,'{}'::uuid[]) loop
   perform public.afe_add_mission_dependency(p_workspace_id,v.id,v_dependency,p_created_by);
 end loop;

 insert into public.afe_agent_events(workspace_id,mission_id,agent_id,actor_type,actor_id,event_type,payload)
 values(p_workspace_id,v.id,p_agent_id,'human',p_created_by,
        case when p_parent_mission_id is null then 'mission.queued' else 'mission.child_queued' end,
        jsonb_build_object('title',v.title,'parentMissionId',p_parent_mission_id,
                           'dependencies',to_jsonb(coalesce(p_dependency_ids,'{}'::uuid[])),
                           'delegationState',v.delegation_state));
 return v;
end $$;
revoke all on function public.afe_create_agent_mission(uuid,uuid,uuid,text,text,jsonb,smallint,smallint,text,uuid,text,uuid[]) from public,anon,authenticated;
grant execute on function public.afe_create_agent_mission(uuid,uuid,uuid,text,text,jsonb,smallint,smallint,text,uuid,text,uuid[]) to service_role;
commit;