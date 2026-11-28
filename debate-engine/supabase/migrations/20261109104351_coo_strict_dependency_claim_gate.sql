CREATE OR REPLACE FUNCTION public.claim_afe_agent_mission(p_lease_seconds integer DEFAULT 120)
RETURNS TABLE(mission_id uuid,workspace_id uuid,agent_id uuid,lease_token uuid,attempt_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS '
DECLARE v public.afe_agent_missions%ROWTYPE;
BEGIN
 IF p_lease_seconds<30 OR p_lease_seconds>600 THEN RAISE EXCEPTION ''invalid lease''; END IF;
 SELECT m.* INTO v FROM public.afe_agent_missions m
 WHERE ((m.status=''queued'' AND m.run_after<=now()) OR (m.status=''running'' AND m.lease_expires_at<now()))
 AND m.attempt_count<m.max_attempts
 AND NOT EXISTS(SELECT 1 FROM public.afe_agent_approvals ap WHERE ap.mission_id=m.id AND ap.status=''pending'')
 AND EXISTS(SELECT 1 FROM public.afe_agents a WHERE a.id=m.agent_id AND a.workspace_id=m.workspace_id AND a.status=''active'')
 AND NOT EXISTS(SELECT 1 FROM public.afe_agent_mission_dependencies d
  JOIN public.afe_agent_missions p ON p.id=d.depends_on_mission_id AND p.workspace_id=d.workspace_id
  WHERE d.workspace_id=m.workspace_id AND d.mission_id=m.id AND p.status<>''completed'')
 AND (m.orchestration_mode<>''coordinator'' OR m.delegation_state=''closed'')
 AND (m.orchestration_mode<>''coordinator'' OR NOT EXISTS(SELECT 1 FROM public.afe_agent_missions c WHERE c.workspace_id=m.workspace_id AND c.parent_mission_id=m.id)
  OR NOT EXISTS(SELECT 1 FROM public.afe_agent_missions c WHERE c.workspace_id=m.workspace_id AND c.parent_mission_id=m.id AND c.status NOT IN (''completed'',''failed'',''cancelled'')))
 ORDER BY m.priority DESC,m.created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE public.afe_agent_missions m SET status=''running'',attempt_count=m.attempt_count+1,lease_token=gen_random_uuid(),
  lease_expires_at=now()+make_interval(secs=>p_lease_seconds),started_at=COALESCE(m.started_at,now()),updated_at=now()
 WHERE m.id=v.id RETURNING m.id,m.workspace_id,m.agent_id,m.lease_token,m.attempt_count
 INTO mission_id,workspace_id,agent_id,lease_token,attempt_count;
 INSERT INTO public.afe_agent_events(workspace_id,mission_id,agent_id,actor_type,event_type,payload)
 VALUES(v.workspace_id,v.id,v.agent_id,''worker'',''mission.claimed'',jsonb_build_object(''attempt'',attempt_count));
 RETURN NEXT;
END';
REVOKE ALL ON FUNCTION public.claim_afe_agent_mission(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_afe_agent_mission(integer) TO service_role;
