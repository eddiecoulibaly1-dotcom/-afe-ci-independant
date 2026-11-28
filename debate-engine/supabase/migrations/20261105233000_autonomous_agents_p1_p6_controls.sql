-- AFE-CI Autonomous Organization V1 — P1/P3/P4/P5/P6 server-side controls.
-- Apply to isolated test database only. Queue remains dormant until a durable worker is deployed.
CREATE INDEX IF NOT EXISTS afe_agent_missions_claim_idx ON public.afe_agent_missions(status,run_after,priority DESC,created_at) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS afe_agent_steps_claim_idx ON public.afe_agent_mission_steps(status,lease_expires_at,created_at) WHERE status IN ('pending','running');
CREATE INDEX IF NOT EXISTS afe_agent_memory_shared_idx ON public.afe_agent_memory(workspace_id,visibility,status,created_at DESC);
CREATE INDEX IF NOT EXISTS afe_agent_messages_dispatch_idx ON public.afe_agent_messages(workspace_id,status,created_at);
CREATE INDEX IF NOT EXISTS afe_agent_approvals_expiry_idx ON public.afe_agent_approvals(status,expires_at) WHERE status='pending';

CREATE OR REPLACE FUNCTION public.claim_afe_agent_mission(p_lease_seconds integer DEFAULT 120)
RETURNS TABLE(mission_id uuid, workspace_id uuid, agent_id uuid, lease_token uuid, attempt_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v public.afe_agent_missions%ROWTYPE;
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 600 THEN RAISE EXCEPTION 'invalid lease'; END IF;
  SELECT * INTO v FROM public.afe_agent_missions m
  WHERE ((m.status='queued' AND m.run_after<=now()) OR (m.status='running' AND m.lease_expires_at<now()))
    AND m.attempt_count < m.max_attempts
    AND EXISTS (SELECT 1 FROM public.afe_agents a WHERE a.id=m.agent_id AND a.workspace_id=m.workspace_id AND a.status='active')
  ORDER BY m.priority DESC,m.created_at
  FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.afe_agent_missions m SET status='running',attempt_count=m.attempt_count+1,
    lease_token=gen_random_uuid(),lease_expires_at=now()+make_interval(secs=>p_lease_seconds),
    started_at=COALESCE(m.started_at,now()),updated_at=now()
  WHERE m.id=v.id
  RETURNING m.id,m.workspace_id,m.agent_id,m.lease_token,m.attempt_count
  INTO mission_id,workspace_id,agent_id,lease_token,attempt_count;
  INSERT INTO public.afe_agent_events(workspace_id,mission_id,agent_id,actor_type,event_type,payload)
  VALUES(v.workspace_id,v.id,v.agent_id,'worker','mission.claimed',jsonb_build_object('attempt',attempt_count));
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION public.claim_afe_agent_mission(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_afe_agent_mission(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_afe_agent_mission(p_mission_id uuid,p_lease_token uuid,p_result jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n integer;
BEGIN
 UPDATE public.afe_agent_missions SET status='completed',result=COALESCE(p_result,'{}'::jsonb),
  completed_at=now(),updated_at=now(),lease_token=NULL,lease_expires_at=NULL
 WHERE id=p_mission_id AND status='running' AND lease_token=p_lease_token;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n=1 THEN INSERT INTO public.afe_agent_events(workspace_id,mission_id,agent_id,actor_type,event_type,payload)
  SELECT workspace_id,id,agent_id,'worker','mission.completed',COALESCE(p_result,'{}'::jsonb) FROM public.afe_agent_missions WHERE id=p_mission_id;
 END IF;
 RETURN n=1;
END $$;
REVOKE ALL ON FUNCTION public.finish_afe_agent_mission(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_afe_agent_mission(uuid,uuid,jsonb) TO service_role;
