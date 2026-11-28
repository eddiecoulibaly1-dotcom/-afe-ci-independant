-- P8 completion: server-side approval request and P9 task-only dispatch.
CREATE OR REPLACE FUNCTION public.request_afe_agent_approval(
 p_mission_id uuid,p_workspace_id uuid,p_requester_id uuid,p_action_key text,
 p_action_payload jsonb,p_risk_level text DEFAULT 'high'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m public.afe_agent_missions%ROWTYPE; a public.afe_agent_approvals%ROWTYPE;
BEGIN
 IF p_risk_level NOT IN ('low','medium','high','critical') THEN RAISE EXCEPTION 'invalid risk'; END IF;
 IF length(btrim(COALESCE(p_action_key,'')))<2 OR length(p_action_key)>160 THEN RAISE EXCEPTION 'invalid action key'; END IF;
 IF jsonb_typeof(COALESCE(p_action_payload,'{}'::jsonb))<>'object' THEN RAISE EXCEPTION 'invalid payload'; END IF;
 SELECT * INTO m FROM public.afe_agent_missions WHERE id=p_mission_id AND workspace_id=p_workspace_id
 AND status IN ('queued','planning','running','paused','waiting_approval') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'mission not eligible for approval'; END IF;
 INSERT INTO public.afe_agent_approvals(workspace_id,mission_id,requested_by_user_id,action_key,action_payload,risk_level,status)
 VALUES(p_workspace_id,m.id,p_requester_id,left(p_action_key,160),COALESCE(p_action_payload,'{}'::jsonb),p_risk_level,'pending')
 RETURNING * INTO a;
 UPDATE public.afe_agent_missions SET status='waiting_approval',lease_token=NULL,lease_expires_at=NULL,updated_at=now()
 WHERE id=m.id;
 INSERT INTO public.afe_agent_events(workspace_id,mission_id,agent_id,actor_type,actor_id,event_type,payload)
 VALUES(p_workspace_id,m.id,m.agent_id,'human',p_requester_id,'approval.requested',
 jsonb_build_object('approval_id',a.id,'action_key',a.action_key,'risk_level',a.risk_level));
 RETURN jsonb_build_object('approval_id',a.id,'mission_id',m.id,'status',a.status,'risk_level',a.risk_level);
END $$;
REVOKE ALL ON FUNCTION public.request_afe_agent_approval(uuid,uuid,uuid,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_afe_agent_approval(uuid,uuid,uuid,text,jsonb,text) TO service_role;

CREATE OR REPLACE FUNCTION public.dispatch_afe_agent_message(p_message_id uuid)
RETURNS TABLE(message_id uuid,dispatched_mission_id uuid,dispatch_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE msg public.afe_agent_messages%ROWTYPE; recipient public.afe_agents%ROWTYPE; created public.afe_agent_missions%ROWTYPE;
BEGIN
 SELECT * INTO msg FROM public.afe_agent_messages
 WHERE id=p_message_id AND status='queued' AND message_type IN ('task','handoff')
 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT * INTO recipient FROM public.afe_agents
 WHERE id=msg.to_agent_id AND workspace_id=msg.workspace_id AND status='active';
 IF NOT FOUND THEN
  UPDATE public.afe_agent_messages SET status='failed',dispatch_error='Agent destinataire absent ou inactif' WHERE id=msg.id;
  message_id:=msg.id;dispatched_mission_id:=NULL;dispatch_status:='failed';RETURN NEXT;RETURN;
 END IF;
 INSERT INTO public.afe_agent_missions(workspace_id,agent_id,title,objective,input_context,priority,autonomy_level,status,idempotency_key,source_message_id)
 VALUES(msg.workspace_id,recipient.id,left('Délégation : '||msg.subject,240),
 left(COALESCE(msg.body->>'objective',msg.body->>'text',msg.subject),20000),
 jsonb_build_object('handoff_message_id',msg.id,'from_agent_id',msg.from_agent_id,'message_type',msg.message_type,'payload',msg.body),
 3,LEAST(recipient.autonomy_level,2),'queued','handoff:'||msg.id::text,msg.id)
 ON CONFLICT (source_message_id) WHERE source_message_id IS NOT NULL DO NOTHING RETURNING * INTO created;
 IF created.id IS NULL THEN SELECT * INTO created FROM public.afe_agent_missions WHERE source_message_id=msg.id; END IF;
 UPDATE public.afe_agent_messages SET status='delivered',delivered_at=COALESCE(delivered_at,now()),dispatched_mission_id=created.id,dispatch_error=NULL WHERE id=msg.id;
 INSERT INTO public.afe_agent_events(workspace_id,mission_id,agent_id,actor_type,event_type,payload)
 VALUES(msg.workspace_id,created.id,recipient.id,'system','agent.handoff.dispatched',
 jsonb_build_object('message_id',msg.id,'from_agent_id',msg.from_agent_id,'to_agent_id',recipient.id));
 message_id:=msg.id;dispatched_mission_id:=created.id;dispatch_status:='delivered';RETURN NEXT;
END $$;
CREATE OR REPLACE FUNCTION public.dispatch_afe_agent_messages(p_limit integer DEFAULT 10)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE item record;n integer:=0;
BEGIN
 IF p_limit<1 OR p_limit>50 THEN RAISE EXCEPTION 'invalid dispatch limit'; END IF;
 FOR item IN SELECT id FROM public.afe_agent_messages
 WHERE status='queued' AND message_type IN ('task','handoff')
 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT p_limit
 LOOP PERFORM public.dispatch_afe_agent_message(item.id);n:=n+1; END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.dispatch_afe_agent_messages(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_afe_agent_messages(integer) TO service_role;
