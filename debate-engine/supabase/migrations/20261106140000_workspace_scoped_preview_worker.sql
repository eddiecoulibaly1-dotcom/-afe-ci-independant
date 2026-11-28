-- Workspace-scoped manual worker execution for isolated Preview/testing.
-- Apply to afe-ci-test only; do not apply to Production without approval.

CREATE OR REPLACE FUNCTION public.claim_afe_agent_mission_for_workspace(
  p_workspace_id uuid,
  p_lease_seconds integer DEFAULT 180
) RETURNS TABLE(mission_id uuid, workspace_id uuid, agent_id uuid, lease_token uuid, attempt_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v public.afe_agent_missions%ROWTYPE;
BEGIN
  IF p_workspace_id IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 600 THEN
    RAISE EXCEPTION 'invalid workspace or lease';
  END IF;
  SELECT m.* INTO v
  FROM public.afe_agent_missions m
  WHERE m.workspace_id=p_workspace_id
    AND ((m.status='queued' AND m.run_after<=now()) OR (m.status='running' AND m.lease_expires_at<now()))
    AND m.attempt_count<m.max_attempts
    AND NOT EXISTS (SELECT 1 FROM public.afe_agent_approvals ap WHERE ap.mission_id=m.id AND ap.status='pending')
    AND EXISTS (SELECT 1 FROM public.afe_agents a WHERE a.id=m.agent_id AND a.workspace_id=m.workspace_id AND a.status='active')
  ORDER BY m.priority DESC,m.created_at
  FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.afe_agent_missions m
  SET status='running',attempt_count=m.attempt_count+1,lease_token=gen_random_uuid(),
      lease_expires_at=now()+make_interval(secs=>p_lease_seconds),
      started_at=COALESCE(m.started_at,now()),updated_at=now()
  WHERE m.id=v.id
  RETURNING m.id,m.workspace_id,m.agent_id,m.lease_token,m.attempt_count
  INTO mission_id,workspace_id,agent_id,lease_token,attempt_count;
  INSERT INTO public.afe_agent_events(workspace_id,mission_id,agent_id,actor_type,event_type,payload)
  VALUES(v.workspace_id,v.id,v.agent_id,'worker','mission.claimed',
    jsonb_build_object('attempt',attempt_count,'trigger','workspace_manual'));
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION public.dispatch_afe_agent_messages_for_workspace(
  p_workspace_id uuid,
  p_limit integer DEFAULT 5
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE item record; n integer:=0;
BEGIN
  IF p_workspace_id IS NULL OR p_limit<1 OR p_limit>10 THEN
    RAISE EXCEPTION 'invalid workspace or dispatch limit';
  END IF;
  FOR item IN
    SELECT id FROM public.afe_agent_messages
    WHERE workspace_id=p_workspace_id AND status='queued'
      AND message_type IN ('task','handoff')
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT p_limit
  LOOP
    PERFORM public.dispatch_afe_agent_message(item.id);
    n:=n+1;
  END LOOP;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.claim_afe_agent_mission_for_workspace(uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.dispatch_afe_agent_messages_for_workspace(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_afe_agent_mission_for_workspace(uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.dispatch_afe_agent_messages_for_workspace(uuid,integer) TO service_role;

COMMENT ON FUNCTION public.claim_afe_agent_mission_for_workspace(uuid,integer) IS
  'Claims one eligible mission from exactly one workspace; service_role only.';
COMMENT ON FUNCTION public.dispatch_afe_agent_messages_for_workspace(uuid,integer) IS
  'Dispatches a bounded number of task/handoff messages from exactly one workspace; service_role only.';
