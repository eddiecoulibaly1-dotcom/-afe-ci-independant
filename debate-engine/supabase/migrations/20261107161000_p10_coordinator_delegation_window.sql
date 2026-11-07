-- P10: explicit coordinator delegation window.
-- Coordinators are not claimable until an editor closes delegation after adding all children.
begin;

alter table public.afe_agent_missions
  add column if not exists delegation_state text not null default 'closed';

alter table public.afe_agent_missions
  drop constraint if exists afe_agent_missions_delegation_state_check;

alter table public.afe_agent_missions
  add constraint afe_agent_missions_delegation_state_check
  check (delegation_state in ('open','closed'));

-- New coordinator missions explicitly open their delegation window in the API.
-- Existing coordinators are conservatively closed; no existing work is silently reopened.

create or replace function public.afe_close_mission_delegation(
  p_workspace_id uuid,
  p_mission_id uuid,
  p_actor_id uuid default null
) returns public.afe_agent_missions
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
declare v public.afe_agent_missions%rowtype;
begin
  select * into v
    from public.afe_agent_missions
   where id=p_mission_id and workspace_id=p_workspace_id
   for update;

  if not found then
    raise exception 'coordinator mission not found in workspace' using errcode='23503';
  end if;
  if v.orchestration_mode <> 'coordinator' then
    raise exception 'only coordinator missions have a delegation window' using errcode='23514';
  end if;
  if v.status not in ('queued','planning','paused') then
    raise exception 'delegation cannot be closed after coordinator execution has started' using errcode='23514';
  end if;

  update public.afe_agent_missions
     set delegation_state='closed', updated_at=now()
   where id=p_mission_id and workspace_id=p_workspace_id
   returning * into v;

  insert into public.afe_agent_events(workspace_id,mission_id,actor_type,actor_id,event_type,payload)
  values(p_workspace_id,p_mission_id,'human',p_actor_id,'mission.delegation_closed',
         jsonb_build_object('closed_at',now()));

  return v;
end $$;

revoke all on function public.afe_close_mission_delegation(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.afe_close_mission_delegation(uuid,uuid,uuid) to service_role;

create or replace function public.claim_afe_agent_mission(p_lease_seconds integer default 120)
returns table(mission_id uuid, workspace_id uuid, agent_id uuid, lease_token uuid, attempt_count integer)
language plpgsql security definer set search_path=public as $$
declare v public.afe_agent_missions%rowtype;
begin
 if p_lease_seconds<30 or p_lease_seconds>600 then raise exception 'invalid lease'; end if;
 select m.* into v from public.afe_agent_missions m
 where ((m.status='queued' and m.run_after<=now()) or (m.status='running' and m.lease_expires_at<now()))
 and m.attempt_count<m.max_attempts
 and not exists(select 1 from public.afe_agent_approvals ap where ap.mission_id=m.id and ap.status='pending')
 and exists(select 1 from public.afe_agents a where a.id=m.agent_id and a.workspace_id=m.workspace_id and a.status='active')
 and not exists(
   select 1 from public.afe_agent_mission_dependencies d
   join public.afe_agent_missions prerequisite on prerequisite.id=d.depends_on_mission_id and prerequisite.workspace_id=d.workspace_id
   where d.workspace_id=m.workspace_id and d.mission_id=m.id
   and prerequisite.status not in ('completed','failed','cancelled')
 )
 and (m.orchestration_mode<>'coordinator' or m.delegation_state='closed')
 and (
   m.orchestration_mode<>'coordinator'
   or not exists(select 1 from public.afe_agent_missions child where child.workspace_id=m.workspace_id and child.parent_mission_id=m.id)
   or not exists(select 1 from public.afe_agent_missions child where child.workspace_id=m.workspace_id and child.parent_mission_id=m.id and child.status not in ('completed','failed','cancelled'))
 )
 order by m.priority desc,m.created_at for update skip locked limit 1;
 if not found then return; end if;
 update public.afe_agent_missions m set status='running',attempt_count=m.attempt_count+1,lease_token=gen_random_uuid(),
 lease_expires_at=now()+make_interval(secs=>p_lease_seconds),started_at=coalesce(m.started_at,now()),updated_at=now()
 where m.id=v.id returning m.id,m.workspace_id,m.agent_id,m.lease_token,m.attempt_count
 into mission_id,workspace_id,agent_id,lease_token,attempt_count;
 insert into public.afe_agent_events(workspace_id,mission_id,agent_id,actor_type,event_type,payload)
 values(v.workspace_id,v.id,v.agent_id,'worker','mission.claimed',jsonb_build_object('attempt',attempt_count));
 return next;
end $$;

create or replace function public.claim_afe_agent_mission_for_workspace(
 p_workspace_id uuid,p_lease_seconds integer default 180
) returns table(mission_id uuid,workspace_id uuid,agent_id uuid,lease_token uuid,attempt_count integer)
language plpgsql security definer set search_path=public as $$
declare v public.afe_agent_missions%rowtype;
begin
 if p_workspace_id is null or p_lease_seconds<30 or p_lease_seconds>600 then raise exception 'invalid workspace or lease'; end if;
 select m.* into v from public.afe_agent_missions m
 where m.workspace_id=p_workspace_id
 and ((m.status='queued' and m.run_after<=now()) or (m.status='running' and m.lease_expires_at<now()))
 and m.attempt_count<m.max_attempts
 and not exists(select 1 from public.afe_agent_approvals ap where ap.mission_id=m.id and ap.status='pending')
 and exists(select 1 from public.afe_agents a where a.id=m.agent_id and a.workspace_id=m.workspace_id and a.status='active')
 and not exists(
   select 1 from public.afe_agent_mission_dependencies d
   join public.afe_agent_missions prerequisite on prerequisite.id=d.depends_on_mission_id and prerequisite.workspace_id=d.workspace_id
   where d.workspace_id=m.workspace_id and d.mission_id=m.id
   and prerequisite.status not in ('completed','failed','cancelled')
 )
 and (m.orchestration_mode<>'coordinator' or m.delegation_state='closed')
 and (
   m.orchestration_mode<>'coordinator'
   or not exists(select 1 from public.afe_agent_missions child where child.workspace_id=m.workspace_id and child.parent_mission_id=m.id)
   or not exists(select 1 from public.afe_agent_missions child where child.workspace_id=m.workspace_id and child.parent_mission_id=m.id and child.status not in ('completed','failed','cancelled'))
 )
 order by m.priority desc,m.created_at for update skip locked limit 1;
 if not found then return; end if;
 update public.afe_agent_missions m set status='running',attempt_count=m.attempt_count+1,lease_token=gen_random_uuid(),
 lease_expires_at=now()+make_interval(secs=>p_lease_seconds),started_at=coalesce(m.started_at,now()),updated_at=now()
 where m.id=v.id returning m.id,m.workspace_id,m.agent_id,m.lease_token,m.attempt_count
 into mission_id,workspace_id,agent_id,lease_token,attempt_count;
 insert into public.afe_agent_events(workspace_id,mission_id,agent_id,actor_type,event_type,payload)
 values(v.workspace_id,v.id,v.agent_id,'worker','mission.claimed',jsonb_build_object('attempt',attempt_count,'trigger','workspace_manual'));
 return next;
end $$;

revoke all on function public.claim_afe_agent_mission(integer) from public,anon,authenticated;
grant execute on function public.claim_afe_agent_mission(integer) to service_role;
revoke all on function public.claim_afe_agent_mission_for_workspace(uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_afe_agent_mission_for_workspace(uuid,integer) to service_role;

commit;
