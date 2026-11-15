-- P1.1-D: mission/task creation, audit and assignment notification share one transaction.
-- Invoked only by the authenticated server using the Supabase service role.
CREATE OR REPLACE FUNCTION public.afe_create_coo_mission_with_audit(
  p_workspace_id uuid,
  p_agent_id uuid,
  p_created_by uuid,
  p_department_id uuid,
  p_title text,
  p_objective text,
  p_idempotency_key text,
  p_input_context jsonb DEFAULT '{}'::jsonb,
  p_priority smallint DEFAULT 3,
  p_autonomy_level smallint DEFAULT 1,
  p_operational_owner_user_id uuid DEFAULT NULL,
  p_due_at timestamptz DEFAULT NULL,
  p_parent_mission_id uuid DEFAULT NULL,
  p_orchestration_mode text DEFAULT 'leaf',
  p_dependency_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS public.afe_agent_missions
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_mission public.afe_agent_missions%ROWTYPE;
BEGIN
  IF p_workspace_id IS NULL OR p_agent_id IS NULL OR p_department_id IS NULL
     OR p_created_by IS NULL
     OR length(btrim(coalesce(p_title, ''))) < 3
     OR length(btrim(coalesce(p_objective, ''))) < 10
     OR length(btrim(coalesce(p_idempotency_key, ''))) NOT BETWEEN 1 AND 160
     OR p_priority NOT BETWEEN 1 AND 5
     OR p_autonomy_level NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'INVALID_COO_MISSION_INPUT' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.afe_org_departments d
    WHERE d.id = p_department_id AND d.workspace_id = p_workspace_id
      AND d.active AND NOT d.is_independent AND NOT d.human_only
  ) THEN
    RAISE EXCEPTION 'COO_DEPARTMENT_NOT_OPERABLE' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.afe_agents a
    WHERE a.id = p_agent_id AND a.workspace_id = p_workspace_id
      AND a.status = 'active'
      AND (a.department_id IS NULL OR a.department_id = p_department_id)
  ) THEN
    RAISE EXCEPTION 'ACTIVE_AGENT_NOT_FOUND_IN_DEPARTMENT' USING ERRCODE = '23503';
  END IF;

  IF p_operational_owner_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.debate_workspaces w
    WHERE w.id = p_workspace_id AND w.owner_id = p_operational_owner_user_id
    UNION ALL
    SELECT 1 FROM public.debate_workspace_members m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id = p_operational_owner_user_id
      AND m.role IN ('owner','admin','editor')
  ) THEN
    RAISE EXCEPTION 'COO_OPERATIONAL_OWNER_NOT_EDITOR' USING ERRCODE = '23514';
  END IF;

  -- Serialize identical intents before checking whether this request already committed.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':' || p_idempotency_key, 0)
  );
  SELECT m.* INTO v_mission
  FROM public.afe_agent_missions m
  WHERE m.workspace_id = p_workspace_id AND m.idempotency_key = p_idempotency_key
  LIMIT 1;
  IF FOUND THEN
    RETURN v_mission;
  END IF;

  v_mission := public.afe_create_agent_mission(
    p_workspace_id, p_agent_id, p_created_by, p_title, p_objective,
    coalesce(p_input_context, '{}'::jsonb), p_priority, p_autonomy_level,
    p_idempotency_key, p_parent_mission_id, p_orchestration_mode,
    coalesce(p_dependency_ids, '{}'::uuid[])
  );

  UPDATE public.afe_agent_missions
  SET department_id = p_department_id,
      operational_owner_user_id = p_operational_owner_user_id,
      due_at = p_due_at,
      updated_at = pg_catalog.now()
  WHERE id = v_mission.id AND workspace_id = p_workspace_id
  RETURNING * INTO v_mission;

  INSERT INTO public.afe_agent_events(
    workspace_id, mission_id, agent_id, actor_type, actor_id, event_type, payload
  ) VALUES (
    p_workspace_id, v_mission.id, p_agent_id, 'human', p_created_by,
    'coo.mission.created',
    pg_catalog.jsonb_build_object(
      'title', v_mission.title,
      'departmentId', p_department_id,
      'operationalOwnerUserId', p_operational_owner_user_id,
      'dueAt', p_due_at
    )
  );

  INSERT INTO public.debate_workspace_audit(
    workspace_id, actor_id, action, entity_type, entity_id, details
  ) VALUES (
    p_workspace_id, p_created_by, 'coo.mission.created', 'mission', v_mission.id::text,
    pg_catalog.jsonb_build_object(
      'departmentId', p_department_id,
      'agentId', p_agent_id,
      'operationalOwnerUserId', p_operational_owner_user_id,
      'dueAt', p_due_at,
      'idempotencyKey', p_idempotency_key
    )
  );

  RETURN v_mission;
END;
$function$;

CREATE OR REPLACE FUNCTION public.afe_create_coo_task_with_audit(
  p_workspace_id uuid,
  p_created_by uuid,
  p_department_id uuid,
  p_title text,
  p_idempotency_key text,
  p_mission_id uuid DEFAULT NULL,
  p_description text DEFAULT '',
  p_priority smallint DEFAULT 3,
  p_assigned_agent_id uuid DEFAULT NULL,
  p_assigned_user_id uuid DEFAULT NULL,
  p_due_at timestamptz DEFAULT NULL
)
RETURNS public.afe_operational_tasks
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_task public.afe_operational_tasks%ROWTYPE;
BEGIN
  IF p_workspace_id IS NULL OR p_created_by IS NULL OR p_department_id IS NULL
     OR length(btrim(coalesce(p_title, ''))) NOT BETWEEN 3 AND 220
     OR length(coalesce(p_description, '')) > 6000
     OR length(btrim(coalesce(p_idempotency_key, ''))) NOT BETWEEN 1 AND 160
     OR p_priority NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'INVALID_COO_TASK_INPUT' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.afe_org_departments d
    WHERE d.id = p_department_id AND d.workspace_id = p_workspace_id
      AND d.active AND NOT d.is_independent AND NOT d.human_only
  ) THEN
    RAISE EXCEPTION 'COO_DEPARTMENT_NOT_OPERABLE' USING ERRCODE = '23514';
  END IF;

  IF p_mission_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.afe_agent_missions m
    WHERE m.id = p_mission_id AND m.workspace_id = p_workspace_id
      AND (m.department_id IS NULL OR m.department_id = p_department_id)
  ) THEN
    RAISE EXCEPTION 'MISSION_NOT_FOUND_IN_DEPARTMENT' USING ERRCODE = '23503';
  END IF;

  IF p_assigned_agent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.afe_agents a
    WHERE a.id = p_assigned_agent_id AND a.workspace_id = p_workspace_id
      AND a.status = 'active'
      AND (a.department_id IS NULL OR a.department_id = p_department_id)
  ) THEN
    RAISE EXCEPTION 'ASSIGNED_AGENT_NOT_FOUND_IN_DEPARTMENT' USING ERRCODE = '23503';
  END IF;

  IF p_assigned_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.debate_workspaces w
    WHERE w.id = p_workspace_id AND w.owner_id = p_assigned_user_id
    UNION ALL
    SELECT 1 FROM public.debate_workspace_members m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id = p_assigned_user_id
      AND m.role IN ('owner','admin','editor')
  ) THEN
    RAISE EXCEPTION 'ASSIGNED_USER_NOT_EDITOR' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':' || p_idempotency_key, 0)
  );
  SELECT t.* INTO v_task
  FROM public.afe_operational_tasks t
  WHERE t.workspace_id = p_workspace_id AND t.idempotency_key = p_idempotency_key
  LIMIT 1;
  IF FOUND THEN
    RETURN v_task;
  END IF;

  INSERT INTO public.afe_operational_tasks(
    workspace_id, mission_id, department_id, idempotency_key, title, description,
    priority, assigned_agent_id, assigned_user_id, due_at, created_by
  ) VALUES (
    p_workspace_id, p_mission_id, p_department_id, p_idempotency_key,
    btrim(p_title), coalesce(p_description, ''), p_priority,
    p_assigned_agent_id, p_assigned_user_id, p_due_at, p_created_by
  )
  RETURNING * INTO v_task;

  INSERT INTO public.debate_workspace_audit(
    workspace_id, actor_id, action, entity_type, entity_id, details
  ) VALUES (
    p_workspace_id, p_created_by, 'coo.task.created', 'task', v_task.id::text,
    pg_catalog.jsonb_build_object(
      'departmentId', p_department_id,
      'missionId', p_mission_id,
      'assignedAgentId', p_assigned_agent_id,
      'assignedUserId', p_assigned_user_id,
      'idempotencyKey', p_idempotency_key
    )
  );

  IF p_assigned_user_id IS NOT NULL THEN
    INSERT INTO public.notifications(
      user_id, type, title, message, link_type, link_id
    ) VALUES (
      p_assigned_user_id, 'coo.task.assigned', 'Nouvelle tâche attribuée',
      btrim(p_title), 'workspace', p_workspace_id::text
    );
  END IF;

  RETURN v_task;
END;
$function$;

REVOKE ALL ON FUNCTION public.afe_create_coo_mission_with_audit(
  uuid,uuid,uuid,uuid,text,text,text,jsonb,smallint,smallint,uuid,timestamptz,uuid,text,uuid[]
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.afe_create_coo_mission_with_audit(
  uuid,uuid,uuid,uuid,text,text,text,jsonb,smallint,smallint,uuid,timestamptz,uuid,text,uuid[]
) TO service_role;

REVOKE ALL ON FUNCTION public.afe_create_coo_task_with_audit(
  uuid,uuid,uuid,text,text,uuid,text,smallint,uuid,uuid,timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.afe_create_coo_task_with_audit(
  uuid,uuid,uuid,text,text,uuid,text,smallint,uuid,uuid,timestamptz
) TO service_role;

COMMENT ON FUNCTION public.afe_create_coo_mission_with_audit(
  uuid,uuid,uuid,uuid,text,text,text,jsonb,smallint,smallint,uuid,timestamptz,uuid,text,uuid[]
) IS 'Atomically creates a COO mission, its agent event and its workspace audit entry; idempotent by workspace and key.';

COMMENT ON FUNCTION public.afe_create_coo_task_with_audit(
  uuid,uuid,uuid,text,text,uuid,text,smallint,uuid,uuid,timestamptz
) IS 'Atomically creates a COO task, its workspace audit entry and any assignment notification; idempotent by workspace and key.';

NOTIFY pgrst, 'reload schema';
