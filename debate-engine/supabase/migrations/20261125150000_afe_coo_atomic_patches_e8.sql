-- E8: Atomic COO task/mission updates with audit trace and optimistic concurrency.
create or replace function public.afe_coo_patch_task_with_audit(
  p_workspace_id uuid,
  p_task_id uuid,
  p_expected_status text,
  p_expected_updated_at timestamptz,
  p_patch jsonb,
  p_actor_id uuid,
  p_audit_details jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.afe_operational_tasks%rowtype;
begin
  update public.afe_operational_tasks
  set status = coalesce(p_patch->>'status', status),
      progress_percent = coalesce((p_patch->>'progress_percent')::smallint, progress_percent),
      completed_at = case when p_patch ? 'completed_at' then (p_patch->>'completed_at')::timestamptz else completed_at end,
      blocked_reason = case when p_patch ? 'blocked_reason' then p_patch->>'blocked_reason' else blocked_reason end,
      completion_evidence = case when p_patch ? 'completion_evidence' then p_patch->'completion_evidence' else completion_evidence end,
      completion_exception_reason = case when p_patch ? 'completion_exception_reason' then p_patch->>'completion_exception_reason' else completion_exception_reason end,
      due_at = case when p_patch ? 'due_at' then (p_patch->>'due_at')::timestamptz else due_at end,
      assigned_agent_id = case when p_patch ? 'assigned_agent_id' then (p_patch->>'assigned_agent_id')::uuid else assigned_agent_id end,
      assigned_user_id = case when p_patch ? 'assigned_user_id' then (p_patch->>'assigned_user_id')::uuid else assigned_user_id end,
      updated_at = coalesce((p_patch->>'updated_at')::timestamptz, now())
  where id = p_task_id and workspace_id = p_workspace_id
    and status = p_expected_status and updated_at = p_expected_updated_at
  returning * into v_row;
  if not found then
    raise exception 'COO_TASK_CONFLICT_OR_NOT_FOUND' using errcode='P0001';
  end if;
  insert into public.debate_workspace_audit(workspace_id,actor_id,action,entity_type,entity_id,details)
  values(p_workspace_id,p_actor_id,'coo.task.updated','task',p_task_id::text,p_audit_details);
  return to_jsonb(v_row);
end $$;
revoke all on function public.afe_coo_patch_task_with_audit(uuid,uuid,text,timestamptz,jsonb,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.afe_coo_patch_task_with_audit(uuid,uuid,text,timestamptz,jsonb,uuid,jsonb) to service_role;

create or replace function public.afe_coo_patch_mission_with_audit(
  p_workspace_id uuid,
  p_mission_id uuid,
  p_expected_updated_at timestamptz,
  p_patch jsonb,
  p_actor_id uuid,
  p_audit_details jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.afe_agent_missions%rowtype;
begin
  update public.afe_agent_missions
  set due_at = case when p_patch ? 'due_at' then (p_patch->>'due_at')::timestamptz else due_at end,
      progress_percent = coalesce((p_patch->>'progress_percent')::smallint, progress_percent),
      blocked_reason = case when p_patch ? 'blocked_reason' then p_patch->>'blocked_reason' else blocked_reason end,
      updated_at = coalesce((p_patch->>'updated_at')::timestamptz, now())
  where id = p_mission_id and workspace_id = p_workspace_id and updated_at = p_expected_updated_at
  returning * into v_row;
  if not found then
    raise exception 'COO_MISSION_CONFLICT_OR_NOT_FOUND' using errcode='P0001';
  end if;
  insert into public.debate_workspace_audit(workspace_id,actor_id,action,entity_type,entity_id,details)
  values(p_workspace_id,p_actor_id,'coo.mission.updated','mission',p_mission_id::text,p_audit_details);
  return to_jsonb(v_row);
end $$;
revoke all on function public.afe_coo_patch_mission_with_audit(uuid,uuid,timestamptz,jsonb,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.afe_coo_patch_mission_with_audit(uuid,uuid,timestamptz,jsonb,uuid,jsonb) to service_role;
