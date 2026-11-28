-- E13.2: make atomic COO incomplete-task audit event retry-safe.
-- Requires afe_agent_events.idempotency_key and its workspace-scoped unique index from E13.1.
CREATE OR REPLACE FUNCTION public.apply_coo_task_results_atomic(
 p_workspace_id uuid,p_mission_id uuid,p_lease_token uuid,p_mission_result jsonb,p_task_results jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m public.afe_agent_missions%ROWTYPE;expected jsonb;r jsonb;tid uuid;st text;pr integer;blocked integer:=0;incomplete integer:=0;titles text[]:=ARRAY[]::text[];avgp integer;sum_p integer:=0;count_expected integer;reason text;
BEGIN
 SELECT * INTO m FROM public.afe_agent_missions WHERE id=p_mission_id AND workspace_id=p_workspace_id AND status='running' AND lease_token=p_lease_token AND lease_expires_at>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Lease lost';END IF;
 expected:=m.input_context->'cooTasks';
 IF expected IS NULL THEN RETURN jsonb_build_object('complete',true,'blockedCount',0,'reason','');END IF;
 IF jsonb_typeof(expected)<>'array' THEN RAISE EXCEPTION 'Mission COO task context must be an array';END IF;
 IF jsonb_array_length(expected)=0 THEN RETURN jsonb_build_object('complete',true,'blockedCount',0,'reason','');END IF;
 IF p_task_results IS NULL THEN RAISE EXCEPTION 'Task results coverage mismatch';END IF;
 IF jsonb_typeof(p_task_results)<>'array' THEN RAISE EXCEPTION 'Task results coverage mismatch';END IF;
 IF jsonb_array_length(p_task_results)<>jsonb_array_length(expected) THEN RAISE EXCEPTION 'Task results coverage mismatch';END IF;
 count_expected:=jsonb_array_length(expected);
 IF (SELECT count(DISTINCT x.value->>'taskId') FROM jsonb_array_elements(p_task_results) AS x(value))<>count_expected
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(expected) e WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_task_results) x WHERE x.value->>'taskId'=e.value->>'id'))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_task_results) x WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(expected) e WHERE e.value->>'id'=x.value->>'taskId')) THEN RAISE EXCEPTION 'Task IDs do not match mission';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_task_results) LOOP
  tid:=(r->>'taskId')::uuid;st:=r->>'status';pr:=GREATEST(0,LEAST(100,COALESCE((r->>'progressPercent')::integer,0)));
  IF st IS NULL OR st NOT IN('done','in_progress','blocked') THEN RAISE EXCEPTION 'Invalid task status';END IF;
  IF st='done' AND (pr<>100 OR length(btrim(COALESCE(r->>'deliverable','')))<20) THEN RAISE EXCEPTION 'Completed task requires full progress and deliverable';END IF;
  IF st='blocked' AND length(btrim(COALESCE(r->>'blockedReason','')))=0 THEN RAISE EXCEPTION 'Blocked task requires reason';END IF;
  UPDATE public.afe_operational_tasks SET status=st,progress_percent=pr,blocked_reason=CASE WHEN st='blocked' THEN left(r->>'blockedReason',3000) ELSE NULL END,completed_at=CASE WHEN st='done' THEN now() ELSE NULL END,updated_at=now() WHERE id=tid AND workspace_id=p_workspace_id AND mission_id=p_mission_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Task outside mission or missing';END IF;
  sum_p:=sum_p+pr;
  IF st<>'done' THEN incomplete:=incomplete+1;IF st='blocked' THEN blocked:=blocked+1;END IF;titles:=array_append(titles,(SELECT title FROM public.afe_operational_tasks WHERE id=tid));END IF;
 END LOOP;
 avgp:=round(sum_p::numeric/count_expected)::integer;
 IF incomplete>0 THEN
  reason:=CASE WHEN blocked>0 THEN 'Blocages à traiter : '||array_to_string(titles,' ; ') ELSE 'Exécution partielle : '||incomplete||' tâche(s) restent à terminer.' END;
  UPDATE public.afe_agent_missions SET status='paused',progress_percent=avgp,blocked_reason=left(reason,3000),result=COALESCE(p_mission_result,'{}')||jsonb_build_object('execution_state','partial','blocked_task_count',blocked,'mission_progress_percent',avgp),lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=p_mission_id;
  INSERT INTO public.afe_agent_events(workspace_id,mission_id,agent_id,actor_type,event_type,payload,idempotency_key)
  VALUES(p_workspace_id,p_mission_id,m.agent_id,'worker','coo.tasks.incomplete',jsonb_build_object('blockedCount',blocked,'incompleteTasks',titles,'progressPercent',avgp,'reason',left(reason,3000),'atomic',true),
    'mission:'||p_mission_id::text||':attempt:'||m.attempt_count::text||':coo-task-incomplete')
  ON CONFLICT (workspace_id,idempotency_key) DO NOTHING;
  RETURN jsonb_build_object('complete',false,'blockedCount',blocked,'reason',left(reason,3000));
 END IF;
 UPDATE public.afe_agent_missions SET progress_percent=100,blocked_reason=NULL,updated_at=now() WHERE id=p_mission_id;
 RETURN jsonb_build_object('complete',true,'blockedCount',0,'reason','');
END;$$;
REVOKE ALL ON FUNCTION public.apply_coo_task_results_atomic(uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_coo_task_results_atomic(uuid,uuid,uuid,jsonb,jsonb) TO service_role;
