-- Atomically persist an agent's task results, review evidence and mission transition.
-- The mission row is locked before the lease is checked; a reaper or replacement
-- worker cannot acquire a new lease until this transaction commits.
CREATE OR REPLACE FUNCTION public.commit_afe_agent_mission_execution(
  p_mission_id uuid,
  p_workspace_id uuid,
  p_agent_id uuid,
  p_lease_token uuid,
  p_result jsonb,
  p_review jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_mission public.afe_agent_missions%ROWTYPE;
  v_tasks jsonb;
  v_results jsonb;
  v_expected_count integer;
  v_result_count integer;
  v_updated_count integer;
  v_incomplete_count integer;
  v_blocked_count integer;
  v_progress integer;
  v_reason text;
  v_now timestamptz;
  v_pending_result jsonb;
BEGIN
  IF pg_catalog.jsonb_typeof(p_result) IS DISTINCT FROM 'object'
     OR pg_catalog.jsonb_typeof(p_review) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'INVALID_EXECUTION_PAYLOAD' USING ERRCODE = '22023';
  END IF;

  -- Serialize against lease renewal, expiry recovery and competing workers.
  SELECT m.* INTO v_mission
  FROM public.afe_agent_missions AS m
  WHERE m.id = p_mission_id
    AND m.workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MISSION_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  v_now := pg_catalog.clock_timestamp();

  IF v_mission.agent_id <> p_agent_id
     OR v_mission.status <> 'running'
     OR v_mission.lease_token IS DISTINCT FROM p_lease_token
     OR v_mission.lease_expires_at IS NULL
     OR v_mission.lease_expires_at <= v_now THEN
    RAISE EXCEPTION 'MISSION_LEASE_LOST' USING ERRCODE = '55000';
  END IF;

  v_tasks := COALESCE(v_mission.input_context -> 'cooTasks', '[]'::jsonb);
  v_results := COALESCE(p_result -> 'task_results', '[]'::jsonb);

  IF pg_catalog.jsonb_typeof(v_tasks) <> 'array'
     OR pg_catalog.jsonb_typeof(v_results) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_TASK_RESULT_ARRAY' USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.jsonb_array_length(v_tasks),
         pg_catalog.jsonb_array_length(v_results)
  INTO v_expected_count, v_result_count;

  IF v_expected_count <> v_result_count THEN
    RAISE EXCEPTION 'TASK_RESULT_COVERAGE_MISMATCH' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(v_tasks) AS expected(item)
    WHERE COALESCE(expected.item ->> 'id', '') = ''
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(v_results) AS result(item)
    WHERE COALESCE(result.item ->> 'taskId', '') = ''
  ) THEN
    RAISE EXCEPTION 'TASK_ID_MISSING' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT expected.item ->> 'id'
    FROM pg_catalog.jsonb_array_elements(v_tasks) AS expected(item)
    GROUP BY expected.item ->> 'id'
    HAVING pg_catalog.count(*) > 1
  ) OR EXISTS (
    SELECT result.item ->> 'taskId'
    FROM pg_catalog.jsonb_array_elements(v_results) AS result(item)
    GROUP BY result.item ->> 'taskId'
    HAVING pg_catalog.count(*) > 1
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_TASK_RESULT' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(v_tasks) AS expected(item)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(v_results) AS result(item)
      WHERE result.item ->> 'taskId' = expected.item ->> 'id'
    )
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(v_results) AS result(item)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(v_tasks) AS expected(item)
      WHERE expected.item ->> 'id' = result.item ->> 'taskId'
    )
  ) THEN
    RAISE EXCEPTION 'TASK_RESULT_ID_SET_MISMATCH' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(v_results) AS result(item)
    WHERE COALESCE(result.item ->> 'status', '') NOT IN ('done', 'in_progress', 'blocked')
       OR CASE
            WHEN COALESCE(result.item ->> 'progressPercent', '') ~ '^[0-9]{1,3}$'
            THEN (result.item ->> 'progressPercent')::integer NOT BETWEEN 0 AND 100
            ELSE true
          END
       OR (
            result.item ->> 'status' = 'done'
            AND (
              COALESCE(pg_catalog.length(pg_catalog.btrim(result.item ->> 'deliverable')), 0) < 20
              OR COALESCE(result.item ->> 'progressPercent', '') <> '100'
            )
          )
       OR (
            result.item ->> 'status' = 'blocked'
            AND COALESCE(pg_catalog.length(pg_catalog.btrim(result.item ->> 'blockedReason')), 0) = 0
          )
  ) THEN
    RAISE EXCEPTION 'TASK_RESULT_VALIDATION_FAILED' USING ERRCODE = '22023';
  END IF;

  IF v_expected_count > 0 THEN
    IF (
      SELECT pg_catalog.count(*)
      FROM public.afe_operational_tasks AS t
      WHERE t.workspace_id = p_workspace_id
        AND t.mission_id = p_mission_id
        AND t.id::text IN (
          SELECT expected.item ->> 'id'
          FROM pg_catalog.jsonb_array_elements(v_tasks) AS expected(item)
        )
    ) <> v_expected_count THEN
      RAISE EXCEPTION 'MISSION_TASK_SET_CHANGED' USING ERRCODE = '55000';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.afe_operational_tasks AS t
      WHERE t.workspace_id = p_workspace_id
        AND t.mission_id = p_mission_id
        AND t.id::text IN (
          SELECT expected.item ->> 'id'
          FROM pg_catalog.jsonb_array_elements(v_tasks) AS expected(item)
        )
        AND t.status = 'cancelled'
    ) THEN
      RAISE EXCEPTION 'MISSION_CONTAINS_CANCELLED_TASK' USING ERRCODE = '55000';
    END IF;

    WITH parsed AS (
      SELECT
        result.item ->> 'taskId' AS task_id,
        result.item ->> 'status' AS status,
        (result.item ->> 'progressPercent')::integer AS progress_percent,
        NULLIF(pg_catalog.left(result.item ->> 'blockedReason', 3000), '') AS blocked_reason
      FROM pg_catalog.jsonb_array_elements(v_results) AS result(item)
    )
    UPDATE public.afe_operational_tasks AS t
    SET status = parsed.status,
        progress_percent = parsed.progress_percent,
        blocked_reason = CASE WHEN parsed.status = 'blocked' THEN parsed.blocked_reason ELSE NULL END,
        completed_at = CASE
          WHEN parsed.status = 'done' THEN COALESCE(t.completed_at, v_now)
          ELSE NULL
        END,
        updated_at = v_now
    FROM parsed
    WHERE t.id::text = parsed.task_id
      AND t.workspace_id = p_workspace_id
      AND t.mission_id = p_mission_id;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count <> v_expected_count THEN
      RAISE EXCEPTION 'TASK_RESULT_WRITE_COUNT_MISMATCH' USING ERRCODE = '55000';
    END IF;
  ELSE
    IF v_result_count <> 0 THEN
      RAISE EXCEPTION 'UNEXPECTED_TASK_RESULTS' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT
    pg_catalog.count(*) FILTER (WHERE result.item ->> 'status' <> 'done'),
    pg_catalog.count(*) FILTER (WHERE result.item ->> 'status' = 'blocked'),
    CASE WHEN v_expected_count = 0 THEN 100
         ELSE pg_catalog.round(pg_catalog.avg((result.item ->> 'progressPercent')::numeric))::integer
    END
  INTO v_incomplete_count, v_blocked_count, v_progress
  FROM pg_catalog.jsonb_array_elements(v_results) AS result(item);

  v_incomplete_count := COALESCE(v_incomplete_count, 0);
  v_blocked_count := COALESCE(v_blocked_count, 0);
  v_progress := COALESCE(v_progress, 100);

  IF v_incomplete_count > 0 THEN
    SELECT CASE
      WHEN v_blocked_count > 0 THEN
        'Blocages à traiter : ' || pg_catalog.string_agg(
          COALESCE(t.title, result.item ->> 'taskId') || ' — ' ||
          COALESCE(NULLIF(pg_catalog.btrim(result.item ->> 'blockedReason'), ''), 'motif non précisé'),
          ' ; '
        ) FILTER (WHERE result.item ->> 'status' = 'blocked')
      ELSE
        'Exécution partielle : ' || v_incomplete_count::text || ' tâche(s) restent à terminer.'
    END
    INTO v_reason
    FROM pg_catalog.jsonb_array_elements(v_results) AS result(item)
    LEFT JOIN public.afe_operational_tasks AS t
      ON t.id::text = result.item ->> 'taskId'
     AND t.workspace_id = p_workspace_id
     AND t.mission_id = p_mission_id;
  ELSE
    v_reason := 'Livrables soumis — validation indépendante et décision COO requises avant clôture.';
  END IF;

  -- Persist the mission transition, task rows and audit events in this same transaction.
  IF v_incomplete_count > 0 THEN
    UPDATE public.afe_agent_missions
    SET status = 'paused',
        progress_percent = v_progress,
        blocked_reason = pg_catalog.left(v_reason, 3000),
        result = p_result || pg_catalog.jsonb_build_object(
          'execution_state', 'partial',
          'blocked_task_count', v_blocked_count,
          'mission_progress_percent', v_progress
        ),
        lease_token = NULL,
        lease_expires_at = NULL,
        updated_at = v_now
    WHERE id = p_mission_id AND workspace_id = p_workspace_id;
  ELSE
    v_pending_result := p_result || pg_catalog.jsonb_build_object(
      'coo_review', pg_catalog.jsonb_build_object(
        'status', 'pending',
        'closureEligible', false,
        'independentReview', p_review,
        'submittedAt', v_now
      )
    );

    UPDATE public.afe_agent_missions
    SET status = 'paused',
        result = v_pending_result,
        progress_percent = 100,
        blocked_reason = v_reason,
        lease_token = NULL,
        lease_expires_at = NULL,
        updated_at = v_now
    WHERE id = p_mission_id AND workspace_id = p_workspace_id;
  END IF;

  INSERT INTO public.afe_agent_events (
    workspace_id, mission_id, agent_id, actor_type, event_type, payload
  ) VALUES (
    p_workspace_id, p_mission_id, p_agent_id, 'worker',
    'mission.deliverables.submitted',
    pg_catalog.jsonb_build_object(
      'summary', p_result -> 'summary',
      'analysis', p_result -> 'analysis',
      'deliverables', p_result -> 'deliverables',
      'taskDeliverables', COALESCE(p_result -> 'task_results', '[]'::jsonb),
      'risks', p_result -> 'risks',
      'assumptions', p_result -> 'assumptions'
    )
  );

  INSERT INTO public.afe_agent_events (
    workspace_id, mission_id, agent_id, actor_type, event_type, payload
  ) VALUES (
    p_workspace_id, p_mission_id, p_agent_id, 'worker',
    'mission.evidence.reviewed',
    p_review || pg_catalog.jsonb_build_object(
      'reviewerType', 'deterministic_independent_evidence_gate',
      'semanticReviewerType', 'independent_ai_semantic_reviewer',
      'deterministicGate', COALESCE(p_review -> 'deterministicGate', p_review)
    )
  );

  IF v_incomplete_count > 0 THEN
    INSERT INTO public.afe_agent_events (
      workspace_id, mission_id, agent_id, actor_type, event_type, payload
    ) VALUES (
      p_workspace_id, p_mission_id, p_agent_id, 'worker',
      'coo.tasks.incomplete',
      pg_catalog.jsonb_build_object(
        'blockedCount', v_blocked_count,
        'progressPercent', v_progress,
        'reason', v_reason,
        'incompleteTasks', (
          SELECT COALESCE(pg_catalog.jsonb_agg(t.title ORDER BY t.title), '[]'::jsonb)
          FROM public.afe_operational_tasks AS t
          WHERE t.workspace_id = p_workspace_id
            AND t.mission_id = p_mission_id
            AND t.status <> 'done'
        )
      )
    );
  ELSE
    INSERT INTO public.afe_agent_events (
      workspace_id, mission_id, agent_id, actor_type, event_type, payload
    ) VALUES (
      p_workspace_id, p_mission_id, p_agent_id, 'worker',
      'mission.awaiting_coo_validation',
      pg_catalog.jsonb_build_object(
        'reviewStatus', 'pending',
        'closureEligible', false,
        'deliverableCount', pg_catalog.jsonb_array_length(COALESCE(p_result -> 'deliverables', '[]'::jsonb)),
        'taskCount', v_expected_count
      )
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'complete', v_incomplete_count = 0,
    'blockedCount', v_blocked_count,
    'progressPercent', v_progress,
    'reason', v_reason,
    'awaitingCooValidation', v_incomplete_count = 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.commit_afe_agent_mission_execution(uuid, uuid, uuid, uuid, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_afe_agent_mission_execution(uuid, uuid, uuid, uuid, jsonb, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.commit_afe_agent_mission_execution(uuid, uuid, uuid, uuid, jsonb, jsonb) IS
  'Atomically fences worker mission execution, persists task results and review events, and releases the current lease.';
NOTIFY pgrst, 'reload schema';
