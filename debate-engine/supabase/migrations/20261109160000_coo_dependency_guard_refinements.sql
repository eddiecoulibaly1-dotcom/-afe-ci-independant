-- Refinements for task-level dependency execution and multi-task deliverable capture.
-- Existing triggers are replaced in place; no historical data is rewritten.

CREATE OR REPLACE FUNCTION public.guard_afe_coo_dependency_edge()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_dependent_key text;
  v_prerequisite_key text;
  v_cycle boolean;
  v_mission_status text;
  v_mission_id uuid;
  v_dependent_task_mission uuid;
  v_prerequisite_task_mission uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.workspace_id::text,0));
  v_dependent_key := public.afe_coo_dependency_node_key(NEW.dependent_kind, NEW.dependent_task_id, NEW.dependent_mission_id, NULL);
  v_prerequisite_key := public.afe_coo_dependency_node_key(NEW.prerequisite_kind, NEW.prerequisite_task_id, NEW.prerequisite_mission_id, NEW.prerequisite_department_id);

  IF NEW.dependent_kind = 'task' THEN
    SELECT m.id, m.status INTO v_mission_id, v_mission_status
    FROM public.afe_operational_tasks t
    LEFT JOIN public.afe_agent_missions m ON m.id = t.mission_id AND m.workspace_id = t.workspace_id
    WHERE t.id = NEW.dependent_task_id AND t.workspace_id = NEW.workspace_id;
  ELSE
    SELECT id, status INTO v_mission_id, v_mission_status
    FROM public.afe_agent_missions
    WHERE id = NEW.dependent_mission_id AND workspace_id = NEW.workspace_id;
  END IF;

  IF v_mission_status = 'running' AND NEW.status IN ('active','pending_dg') THEN
    RAISE EXCEPTION 'Pause the dependent mission before proposing or activating a dependency';
  END IF;

  IF NEW.relation_type = 'hard_prerequisite'
     AND NEW.dependent_kind = 'task'
     AND NEW.prerequisite_kind = 'task' THEN
    SELECT mission_id INTO v_dependent_task_mission
    FROM public.afe_operational_tasks
    WHERE id = NEW.dependent_task_id AND workspace_id = NEW.workspace_id;
    SELECT mission_id INTO v_prerequisite_task_mission
    FROM public.afe_operational_tasks
    WHERE id = NEW.prerequisite_task_id AND workspace_id = NEW.workspace_id;
    IF v_dependent_task_mission IS NOT NULL
       AND v_dependent_task_mission = v_prerequisite_task_mission THEN
      RAISE EXCEPTION 'Hard task dependencies inside the same mission are not supported by the batch worker';
    END IF;
  END IF;

  IF NEW.status <> 'rejected' THEN
    WITH RECURSIVE reachable(node_key) AS (
      SELECT v_prerequisite_key
      UNION
      SELECT public.afe_coo_dependency_node_key(
        e.prerequisite_kind, e.prerequisite_task_id, e.prerequisite_mission_id, e.prerequisite_department_id
      )
      FROM public.afe_coo_dependency_edges e
      JOIN reachable r ON public.afe_coo_dependency_node_key(
        e.dependent_kind, e.dependent_task_id, e.dependent_mission_id, NULL
      ) = r.node_key
      WHERE e.workspace_id = NEW.workspace_id
        AND e.status <> 'rejected'
        AND e.id IS DISTINCT FROM NEW.id
    )
    SELECT EXISTS (SELECT 1 FROM reachable WHERE node_key = v_dependent_key) INTO v_cycle;
    IF v_cycle THEN RAISE EXCEPTION 'COO dependency cycle detected'; END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.capture_afe_coo_mission_deliverables()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  item jsonb;
  v_task_id uuid;
  v_task record;
  v_text text;
  v_key text;
  v_version integer;
  v_index integer := 0;
  v_mission record;
BEGIN
  IF NEW.event_type <> 'mission.deliverables.submitted' THEN RETURN NEW; END IF;
  SELECT m.id, COALESCE(m.department_id, a.department_id) AS department_id, m.workspace_id INTO v_mission
  FROM public.afe_agent_missions m
  LEFT JOIN public.afe_agents a ON a.id = m.agent_id AND a.workspace_id = m.workspace_id
  WHERE m.id = NEW.mission_id AND m.workspace_id = NEW.workspace_id;
  IF NOT FOUND OR v_mission.department_id IS NULL THEN RETURN NEW; END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.payload->'taskDeliverables') = 'array' THEN NEW.payload->'taskDeliverables' ELSE '[]'::jsonb END)
  LOOP
    BEGIN
      v_task_id := NULLIF(item->>'taskId','')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      CONTINUE;
    END;
    v_text := COALESCE(item->>'deliverable','');
    IF v_task_id IS NULL OR length(btrim(v_text)) < 20 OR item->>'status' <> 'done' THEN CONTINUE; END IF;
    SELECT t.id, t.title, t.description, t.department_id INTO v_task
    FROM public.afe_operational_tasks t
    WHERE t.id = v_task_id AND t.workspace_id = NEW.workspace_id AND t.mission_id = NEW.mission_id;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_key := 'task-output-' || v_task_id::text;
    SELECT COALESCE(MAX(d.version),0)+1 INTO v_version
    FROM public.afe_coo_deliverables d
    WHERE d.workspace_id = NEW.workspace_id AND d.producer_task_id = v_task_id AND d.deliverable_key = v_key;
    INSERT INTO public.afe_coo_deliverables(
      workspace_id, producer_kind, producer_task_id, department_id, deliverable_key,
      title, description, content, version, status, acceptance_criteria, submitted_by, source_event_id
    ) VALUES (
      NEW.workspace_id, 'task', v_task_id, v_task.department_id, v_key,
      'Livrable — ' || v_task.title, left(v_task.description,4000),
      jsonb_build_object('text',v_text,'summary',COALESCE(item->>'summary',''),'source','agent_task_result'),
      v_version, 'submitted',
      jsonb_build_array(
        jsonb_build_object('criterion','Le livrable contient un résultat concret et vérifiable','required',true),
        jsonb_build_object('criterion','La tâche est déclarée terminée et sa progression atteint 100 %','required',true),
        jsonb_build_object('criterion','Le résultat répond à la description de la tâche','required',true)
      ), CASE WHEN NEW.actor_type = 'human' THEN NEW.actor_id ELSE NULL END, NEW.id
    ) ON CONFLICT (source_event_id, deliverable_key) WHERE source_event_id IS NOT NULL DO NOTHING;
  END LOOP;

  FOR item IN SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.payload->'deliverables') = 'array' THEN NEW.payload->'deliverables' ELSE '[]'::jsonb END)
  LOOP
    v_index := v_index + 1;
    v_text := CASE WHEN jsonb_typeof(item) = 'string' THEN item #>> '{}' ELSE item::text END;
    IF length(btrim(v_text)) < 20 THEN CONTINUE; END IF;
    v_key := 'mission-output-' || v_index::text;
    SELECT COALESCE(MAX(d.version),0)+1 INTO v_version
    FROM public.afe_coo_deliverables d
    WHERE d.workspace_id = NEW.workspace_id AND d.producer_mission_id = NEW.mission_id AND d.deliverable_key = v_key;
    INSERT INTO public.afe_coo_deliverables(
      workspace_id, producer_kind, producer_mission_id, department_id, deliverable_key,
      title, description, content, version, status, acceptance_criteria, submitted_by, source_event_id
    ) VALUES (
      NEW.workspace_id, 'mission', NEW.mission_id, v_mission.department_id, v_key,
      'Livrable de mission ' || v_index::text, 'Livrable soumis par l’agent de mission.',
      jsonb_build_object('text',v_text,'source','agent_mission_result'),
      v_version, 'submitted',
      jsonb_build_array(
        jsonb_build_object('criterion','Le livrable est concret, traçable et cohérent avec l’objectif de mission','required',true),
        jsonb_build_object('criterion','Les sources et limites sont explicitées','required',true)
      ), NEW.actor_id, NEW.id
    ) ON CONFLICT (source_event_id, deliverable_key) WHERE source_event_id IS NOT NULL DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$;
