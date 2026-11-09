-- AFE-CI Autonomous Organization P8/P9: approval lifecycle and agent handoff dispatch.
-- Apply only to isolated afe-ci-test until acceptance.
ALTER TABLE public.afe_agent_missions
  ADD COLUMN IF NOT EXISTS source_message_id uuid REFERENCES public.afe_agent_messages(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS afe_agent_missions_source_message_uidx
  ON public.afe_agent_missions(source_message_id) WHERE source_message_id IS NOT NULL;

ALTER TABLE public.afe_agent_messages
  ADD COLUMN IF NOT EXISTS dispatched_mission_id uuid REFERENCES public.afe_agent_missions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dispatch_error text CHECK (dispatch_error IS NULL OR length(dispatch_error) <= 1000);

CREATE INDEX IF NOT EXISTS afe_agent_approvals_mission_status_idx
  ON public.afe_agent_approvals(mission_id,status,created_at DESC);

-- A mission with a pending approval must never be claimed by a worker.
CREATE OR REPLACE FUNCTION public.claim_afe_agent_mission(p_lease_seconds integer DEFAULT 120)
RETURNS TABLE(mission_id uuid, workspace_id uuid, agent_id uuid, lease_token uuid, attempt_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v public.afe_agent_missions%ROWTYPE;
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 600 THEN RAISE EXCEPTION 'invalid lease'; END IF;
  SELECT m.* INTO v FROM public.afe_agent_missions m
  WHERE ((m.status='queued' AND m.run_after<=now()) OR (m.status='running' AND m.lease_expires_at<now()))
    AND m.attempt_count < m.max_attempts
    AND NOT EXISTS (SELECT 1 FROM public.afe_agent_approvals ap WHERE ap.mission_id=m.id AND ap.status='pending')
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

-- The API calls this only after checking the workspace administrator role.
-- A decision and mission transition are committed atomically.
CREATE OR REPLACE FUNCTION public.decide_afe_agent_approval(
  p_approval_id uuid, p_workspace_id uuid, p_approver_id uuid,
  p_decision text, p_note text DEFAULT ''
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.afe_agent_approvals%ROWTYPE; m public.afe_agent_missions%ROWTYPE;
BEGIN
  IF p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'invalid decision'; END IF;
  SELECT * INTO a FROM public.afe_agent_approvals
    WHERE id=p_approval_id AND workspace_id=p_workspace_id AND status='pending'
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'approval not pending'; END IF;
  UPDATE public.afe_agent_approvals SET status=p_decision,approver_user_id=p_approver_id,
    decision_note=left(COALESCE(p_note,''),4000),decided_at=now()
    WHERE id=a.id RETURNING * INTO a;
  IF a.mission_id IS NOT NULL THEN
    SELECT * INTO m FROM public.afe_agent_missions WHERE id=a.mission_id AND workspace_id=p_workspace_id FOR UPDATE;
    IF FOUND AND m.status NOT IN ('completed','failed','cancelled') THEN
      IF p_decision='rejected' THEN
        UPDATE public.afe_agent_missions SET status='failed',failure_code='APPROVAL_REJECTED',
          failure_message='Une approbation humaine a été refusée.',lease_token=NULL,lease_expires_at=NULL,updated_at=now()
          WHERE id=m.id;
      ELSIF NOT EXISTS (SELECT 1 FROM public.afe_agent_approvals WHERE mission_id=m.id AND status='pending') THEN
        UPDATE public.afe_agent_missions SET status='queued',run_after=now(),
          lease_token=NULL,lease_expires_at=NULL,updated_at=now()
          WHERE id=m.id AND status='waiting_approval';
      END IF;
      INSERT INTO public.afe_agent_events(workspace_id,mission_id,agent_id,actor_type,actor_id,event_type,payload)
      VALUES(p_workspace_id,m.id,m.agent_id,'human',p_approver_id,'approval.'||p_decision,
        jsonb_build_object('approval_id',a.id,'action_key',a.action_key,'note',left(COALESCE(p_note,''),4000)));
    END IF;
  END IF;
  RETURN jsonb_build_object('approval_id',a.id,'status',a.status,'mission_id',a.mission_id);
END $$;
REVOKE ALL ON FUNCTION public.decide_afe_agent_approval(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.decide_afe_agent_approval(uuid,uuid,uuid,text,text) TO service_role;

-- A queued handoff becomes one idempotent mission for the recipient agent.
-- Unique source_message_id makes repeated cron invocations safe.
CREATE OR REPLACE FUNCTION public.dispatch_afe_agent_message(p_message_id uuid)
RETURNS TABLE(message_id uuid, dispatched_mission_id uuid, dispatch_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE msg public.afe_agent_messages%ROWTYPE; recipient public.afe_agents%ROWTYPE; created public.afe_agent_missions%ROWTYPE;
BEGIN
  SELECT * INTO msg FROM public.afe_agent_messages
    WHERE id=p_message_id AND status='queued' FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO recipient FROM public.afe_agents
    WHERE id=msg.to_agent_id AND workspace_id=msg.workspace_id AND status='active';
  IF NOT FOUND THEN
    UPDATE public.afe_agent_messages SET status='failed',dispatch_error='Agent destinataire absent ou inactif'
      WHERE id=msg.id;
    message_id:=msg.id; dispatched_mission_id:=NULL; dispatch_status:='failed'; RETURN NEXT; RETURN;
  END IF;
  INSERT INTO public.afe_agent_missions(
    workspace_id,agent_id,title,objective,input_context,priority,autonomy_level,
    status,idempotency_key,source_message_id
  ) VALUES (
    msg.workspace_id,recipient.id,left('Délégation : '||msg.subject,240),
    left(COALESCE(msg.body->>'objective',msg.body->>'text',msg.subject),20000),
    jsonb_build_object('handoff_message_id',msg.id,'from_agent_id',msg.from_agent_id,'message_type',msg.message_type,'payload',msg.body),
    3,LEAST(recipient.autonomy_level,2),'queued','handoff:'||msg.id::text,msg.id
  )
  ON CONFLICT (source_message_id) WHERE source_message_id IS NOT NULL DO NOTHING
  RETURNING * INTO created;
  IF created.id IS NULL THEN
    SELECT * INTO created FROM public.afe_agent_missions WHERE source_message_id=msg.id;
  END IF;
  UPDATE public.afe_agent_messages SET status='delivered',delivered_at=COALESCE(delivered_at,now()),
    dispatched_mission_id=created.id,dispatch_error=NULL WHERE id=msg.id;
  INSERT INTO public.afe_agent_events(workspace_id,mission_id,agent_id,actor_type,event_type,payload)
  VALUES(msg.workspace_id,created.id,recipient.id,'system','agent.handoff.dispatched',
    jsonb_build_object('message_id',msg.id,'from_agent_id',msg.from_agent_id,'to_agent_id',recipient.id));
  message_id:=msg.id; dispatched_mission_id:=created.id; dispatch_status:='delivered'; RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION public.dispatch_afe_agent_message(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_afe_agent_message(uuid) TO service_role;

-- Worker dispatcher drains a bounded number of queued handoffs per invocation.
CREATE OR REPLACE FUNCTION public.dispatch_afe_agent_messages(p_limit integer DEFAULT 10)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE item record; n integer:=0;
BEGIN
  IF p_limit<1 OR p_limit>50 THEN RAISE EXCEPTION 'invalid dispatch limit'; END IF;
  FOR item IN SELECT id FROM public.afe_agent_messages WHERE status='queued'
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT p_limit
  LOOP
    PERFORM public.dispatch_afe_agent_message(item.id);
    n:=n+1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.dispatch_afe_agent_messages(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_afe_agent_messages(integer) TO service_role;

COMMENT ON FUNCTION public.decide_afe_agent_approval(uuid,uuid,uuid,text,text) IS
  'Atomic human approval decision and mission resume/reject transition; callable by server service_role only.';
COMMENT ON FUNCTION public.dispatch_afe_agent_message(uuid) IS
  'Idempotently converts a queued inter-agent handoff into a recipient mission; server service_role only.';
