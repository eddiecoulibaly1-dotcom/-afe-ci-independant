-- E9.2-D1/D3 atomic dispatch and result synchronization; development/test only.
ALTER TABLE public.afe_operational_tasks ADD COLUMN IF NOT EXISTS coo_task_key text;
CREATE UNIQUE INDEX IF NOT EXISTS afe_operational_tasks_coo_task_key_uq ON public.afe_operational_tasks(workspace_id,mission_id,coo_task_key) WHERE coo_task_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.dispatch_coo_workstream_atomic(
 p_workspace_id uuid,p_run_id uuid,p_department_id uuid,p_director_id uuid,p_created_by uuid,
 p_mission_title text,p_objective text,p_input_context jsonb,p_priority smallint,p_autonomy_level smallint,
 p_due_at timestamptz,p_mission_key text,p_tasks jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m public.afe_agent_missions%ROWTYPE; d public.afe_org_departments%ROWTYPE; a public.afe_agents%ROWTYPE; r public.afe_coo_runs%ROWTYPE;
 task jsonb;tid uuid;tkey text;tasks jsonb:='[]'::jsonb;n integer:=0;old_tasks jsonb;idx integer:=0;
BEGIN
 IF p_tasks IS NULL THEN RAISE EXCEPTION 'Tasks array must contain 1..8 entries';END IF;
 IF jsonb_typeof(p_tasks)<>'array' THEN RAISE EXCEPTION 'Tasks array must contain 1..8 entries';END IF;
 IF jsonb_array_length(p_tasks)<1 OR jsonb_array_length(p_tasks)>8 THEN RAISE EXCEPTION 'Tasks array must contain 1..8 entries';END IF;
 SELECT * INTO r FROM public.afe_coo_runs WHERE id=p_run_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COO run not found';END IF;
 SELECT * INTO d FROM public.afe_org_departments WHERE id=p_department_id AND workspace_id=p_workspace_id AND active AND NOT is_independent AND NOT human_only FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Department not eligible';END IF;
 SELECT * INTO a FROM public.afe_agents WHERE id=p_director_id AND workspace_id=p_workspace_id AND department_id=p_department_id AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Director not active in department';END IF;
 INSERT INTO public.afe_agent_missions(workspace_id,agent_id,department_id,created_by,title,objective,input_context,priority,autonomy_level,due_at,progress_percent,idempotency_key,orchestration_mode,orchestration_summary)
 VALUES(p_workspace_id,p_director_id,p_department_id,p_created_by,p_mission_title,p_objective,COALESCE(p_input_context,'{}'),p_priority,p_autonomy_level,p_due_at,0,p_mission_key,'leaf',jsonb_build_object('cooRunId',p_run_id))
 ON CONFLICT(workspace_id,idempotency_key) DO NOTHING;
 SELECT * INTO m FROM public.afe_agent_missions WHERE workspace_id=p_workspace_id AND idempotency_key=p_mission_key FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Mission persistence failed';END IF;
 old_tasks:=m.input_context->'cooTasks';
 FOR task IN SELECT value FROM jsonb_array_elements(p_tasks) LOOP
  idx:=idx+1;tkey:=task->>'task_key';
  IF length(tkey)<4 OR length(tkey)>180 THEN RAISE EXCEPTION 'Invalid task key';END IF;
  tid:=NULL;
  IF jsonb_typeof(old_tasks)='array' THEN
   IF jsonb_array_length(old_tasks)>=idx THEN
    tid:=(old_tasks->(idx-1)->>'id')::uuid;
    UPDATE public.afe_operational_tasks SET coo_task_key=tkey WHERE id=tid AND workspace_id=p_workspace_id AND mission_id=m.id AND coo_task_key IS NULL;
   END IF;
  END IF;
  IF tid IS NULL OR NOT EXISTS(SELECT 1 FROM public.afe_operational_tasks WHERE id=tid AND workspace_id=p_workspace_id AND mission_id=m.id AND coo_task_key=tkey) THEN
   INSERT INTO public.afe_operational_tasks(workspace_id,mission_id,department_id,title,description,priority,assigned_agent_id,due_at,created_by,coo_task_key)
   VALUES(p_workspace_id,m.id,p_department_id,task->>'title',COALESCE(task->>'description',''),GREATEST(1,LEAST(5,COALESCE((task->>'priority')::integer,3))),p_director_id,COALESCE((task->>'due_at')::timestamptz,p_due_at),p_created_by,tkey)
   ON CONFLICT(workspace_id,mission_id,coo_task_key) WHERE coo_task_key IS NOT NULL DO NOTHING;
  END IF;
  SELECT id INTO tid FROM public.afe_operational_tasks WHERE workspace_id=p_workspace_id AND mission_id=m.id AND coo_task_key=tkey;
  IF tid IS NULL THEN RAISE EXCEPTION 'Task persistence failed';END IF;
  tasks:=tasks||jsonb_build_array(jsonb_build_object('id',tid,'title',task->>'title','description',COALESCE(task->>'description',''),'taskKey',tkey));n:=n+1;
 END LOOP;
 UPDATE public.afe_agent_missions SET input_context=COALESCE(p_input_context,'{}')||jsonb_build_object('cooTasks',tasks),updated_at=now() WHERE id=m.id;
 IF NOT EXISTS(SELECT 1 FROM public.afe_agent_events WHERE workspace_id=p_workspace_id AND mission_id=m.id AND event_type='coo.delegation.dispatched' AND payload->>'cooRunId'=p_run_id::text) THEN
  INSERT INTO public.afe_agent_events(workspace_id,mission_id,agent_id,actor_type,actor_id,event_type,payload) VALUES(p_workspace_id,m.id,r.coo_agent_id,'agent',r.coo_agent_id,'coo.delegation.dispatched',jsonb_build_object('cooRunId',p_run_id,'departmentSlug',d.slug,'taskCount',n,'atomic',true));
 END IF;
 RETURN jsonb_build_object('mission',to_jsonb(m),'cooTasks',tasks,'taskCount',n);
END;$$;

CREATE OR REPLACE FUNCTION public.apply_coo_task_results_atomic(p_workspace_id uuid,p_mission_id uuid,p_lease_token uuid,p_mission_result jsonb,p_task_results jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
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
  INSERT INTO public.afe_agent_events(workspace_id,mission_id,agent_id,actor_type,event_type,payload) VALUES(p_workspace_id,p_mission_id,m.agent_id,'worker','coo.tasks.incomplete',jsonb_build_object('blockedCount',blocked,'incompleteTasks',titles,'progressPercent',avgp,'reason',left(reason,3000),'atomic',true));
  RETURN jsonb_build_object('complete',false,'blockedCount',blocked,'reason',left(reason,3000));
 END IF;
 UPDATE public.afe_agent_missions SET progress_percent=100,blocked_reason=NULL,updated_at=now() WHERE id=p_mission_id;
 RETURN jsonb_build_object('complete',true,'blockedCount',0,'reason','');
END;$$;
REVOKE ALL ON FUNCTION public.dispatch_coo_workstream_atomic(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,smallint,smallint,timestamptz,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.apply_coo_task_results_atomic(uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_coo_workstream_atomic(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,smallint,smallint,timestamptz,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_coo_task_results_atomic(uuid,uuid,uuid,jsonb,jsonb) TO service_role;
