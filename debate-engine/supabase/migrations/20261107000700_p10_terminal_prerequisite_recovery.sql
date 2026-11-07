-- P10: release dependents and coordinators after prerequisite missions reach a terminal state.
-- Failed/cancelled outcomes are passed to the executing agent for explicit handling.
-- Apply on isolated TEST first; never apply this migration to Production from this branch.

begin;

create or replace function public.claim_afe_agent_mission(p_lease_seconds integer default 120)
returns table(mission_id uuid, workspace_id uuid, agent_id uuid, lease_token uuid, attempt_count integer)
language plpgsql
security definer
set search_path=public
as $$
declare v public.afe_agent_missions%rowtype;
begin
  if p_lease_seconds < 30 or p_lease_seconds > 600 then raise exception 'invalid lease'; end if;
  select m.* into v
    from public.afe_agent_missions m
   where ((m.status='queued' and m.run_after<=now()) or (m.status='running' and m.lease_expires_at<now()))
     and m.attempt_count < m.max_attempts
     and not exists (select 1 from public.afe_agent_approvals ap where ap.mission_id=m.id and ap.status='pending')
     and exists (select 1 from public.afe_agents a where a.id=m.agent_id and a.workspace_id=m.workspace_id and a.status='active')
     and not exists (
       select 1 from public.afe_agent_mission_dependencies d
       join public.afe_agent_missions prerequisite on prerequisite.id=d.depends_on_mission_id and prerequisite.workspace_id=d.workspace_id
       where d.workspace_id=m.workspace_id and d.mission_id=m.id
         and prerequisite.status not in ('completed','failed','cancelled')
     )
     and (
       m.orchestration_mode <> 'coordinator'
       or not exists (select 1 from public.afe_agent_missions child where child.workspace_id=m.workspace_id and child.parent_mission_id=m.id)
       or not exists (
         select 1 from public.afe_agent_missions child
         where child.workspace_id=m.workspace_id and child.parent_mission_id=m.id
           and child.status not in ('completed','failed','cancelled')
       )
     )
   order by m.priority desc,m.created_at
   for update skip locked limit 1;
  if not found then return; end if;
  update public.afe_agent_missions m
     set status='running',attempt_count=m.attempt_count+1,lease_token=gen_random_uuid(),
         lease_expires_at=now()+make_interval(secs=>p_lease_seconds),
         started_at=coalesce(m.started_at,now()),updated_at=now()
   where m.id=v.id
   returning m.id,m.workspace_id,m.agent_id,m.lease_token,m.attempt_count
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
 and (
  m.orchestration_mode<>'coordinator'
  or not exists(select 1 from public.afe_agent_missions child where child.workspace_id=m.workspace_id and child.parent_mission_id=m.id)
  or not exists(
   select 1 from public.afe_agent_missions child
   where child.workspace_id=m.workspace_id and child.parent_mission_id=m.id
     and child.status not in ('completed','failed','cancelled')
  )
 )
 order by m.priority desc,m.created_at for update skip locked limit 1;
 if not found then return; end if;
 update public.afe_agent_missions m set status='running',attempt_count=m.attempt_count+1,lease_token=gen_random_uuid(),
 lease_expires_at=now()+make_interval(secs=>p_lease_seconds),started_at=coalesce(m.started_at,now()),updated_at=now()
 where m.id=v.id
 returning m.id,m.workspace_id,m.agent_id,m.lease_token,m.attempt_count into mission_id,workspace_id,agent_id,lease_token,attempt_count;
 insert into public.afe_agent_events(workspace_id,mission_id,agent_id,actor_type,event_type,payload)
 values(v.workspace_id,v.id,v.agent_id,'worker','mission.claimed',jsonb_build_object('attempt',attempt_count,'trigger','workspace_manual'));
 return next;
end $$;

revoke all on function public.claim_afe_agent_mission(integer) from public,anon,authenticated;
grant execute on function public.claim_afe_agent_mission(integer) to service_role;
revoke all on function public.claim_afe_agent_mission_for_workspace(uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_afe_agent_mission_for_workspace(uuid,integer) to service_role;

commit;
