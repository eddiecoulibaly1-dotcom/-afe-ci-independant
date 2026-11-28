-- Recover legacy running missions that have no lease expiry recorded.
CREATE OR REPLACE FUNCTION public.reap_expired_afe_agent_mission_leases(
 p_workspace_id uuid DEFAULT NULL,
 p_batch_size integer DEFAULT 50
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS '
DECLARE v_count integer;
BEGIN
 IF p_batch_size<1 OR p_batch_size>100 THEN RAISE EXCEPTION ''invalid reaper batch size''; END IF;
 WITH expired AS (
  SELECT m.id FROM public.afe_agent_missions m
  WHERE m.status=''running'' AND (m.lease_expires_at IS NULL OR m.lease_expires_at<now())
   AND (p_workspace_id IS NULL OR m.workspace_id=p_workspace_id)
  ORDER BY m.lease_expires_at NULLS FIRST
  FOR UPDATE SKIP LOCKED
  LIMIT p_batch_size
 ), reaped AS (
  UPDATE public.afe_agent_missions m
  SET status=CASE WHEN m.attempt_count>=m.max_attempts THEN ''failed'' ELSE ''queued'' END,
   failure_code=''WORKER_LEASE_EXPIRED'',
   failure_message=''Worker lease expired or was missing before a final mission state was recorded.'',
   run_after=CASE WHEN m.attempt_count>=m.max_attempts THEN m.run_after
    ELSE now()+make_interval(secs=>LEAST(900,15*POWER(2,GREATEST(0,m.attempt_count-1))::integer)) END,
   lease_token=NULL,lease_expires_at=NULL,updated_at=now()
  FROM expired e WHERE m.id=e.id
  RETURNING m.id,m.workspace_id,m.agent_id,m.attempt_count,m.max_attempts,m.status
 ), logged AS (
  INSERT INTO public.afe_agent_events(workspace_id,mission_id,agent_id,actor_type,event_type,payload)
  SELECT workspace_id,id,agent_id,''worker'',
   CASE WHEN status=''failed'' THEN ''mission.lease_expired_failed'' ELSE ''mission.lease_expired_retry_scheduled'' END,
   jsonb_build_object(''attempt'',attempt_count,''maxAttempts'',max_attempts,''recoveredStatus'',status)
  FROM reaped
  RETURNING id
 )
 SELECT count(*) INTO v_count FROM reaped;
 RETURN COALESCE(v_count,0);
END';
REVOKE ALL ON FUNCTION public.reap_expired_afe_agent_mission_leases(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reap_expired_afe_agent_mission_leases(uuid,integer) TO service_role;
