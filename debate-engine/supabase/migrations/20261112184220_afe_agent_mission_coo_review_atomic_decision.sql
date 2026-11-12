-- Atomic COO decision for a completed autonomous-agent mission review.
-- The independent evidence review remains advisory: only a distinct authorized
-- human decision can close the mission.
CREATE OR REPLACE FUNCTION public.decide_afe_agent_mission_coo_review(
  p_mission_id uuid,
  p_workspace_id uuid,
  p_reviewer_id uuid,
  p_decision text,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_mission public.afe_agent_missions%ROWTYPE;
  v_coo_review jsonb;
  v_independent_review jsonb;
  v_semantic_review jsonb;
  v_review_status text;
  v_now timestamptz;
  v_note text;
  v_updated public.afe_agent_missions%ROWTYPE;
BEGIN
  IF p_mission_id IS NULL OR p_workspace_id IS NULL OR p_reviewer_id IS NULL THEN
    RAISE EXCEPTION 'MISSION_REVIEW_SCOPE_REQUIRED' USING ERRCODE = '22023';
  END IF;

  IF p_decision IS NULL OR p_decision NOT IN ('accept', 'return', 'reject') THEN
    RAISE EXCEPTION 'INVALID_MISSION_REVIEW_DECISION' USING ERRCODE = '22023';
  END IF;

  v_note := pg_catalog.left(pg_catalog.btrim(COALESCE(p_note, '')), 4000);
  IF p_decision <> 'accept' AND pg_catalog.length(v_note) < 10 THEN
    RAISE EXCEPTION 'MISSION_REVIEW_NOTE_REQUIRED' USING ERRCODE = '22023';
  END IF;

  SELECT m.* INTO v_mission
  FROM public.afe_agent_missions AS m
  WHERE m.id = p_mission_id
    AND m.workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MISSION_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_mission.status <> 'paused'
     OR v_mission.result -> 'coo_review' ->> 'status' IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'MISSION_REVIEW_NOT_PENDING' USING ERRCODE = '55000';
  END IF;

  IF v_mission.created_by IS NOT NULL
     AND v_mission.created_by = p_reviewer_id THEN
    RAISE EXCEPTION 'MISSION_REQUESTER_CANNOT_REVIEW_OWN_MISSION' USING ERRCODE = '42501';
  END IF;

  v_coo_review := COALESCE(v_mission.result -> 'coo_review', '{}'::jsonb);
  v_independent_review := COALESCE(v_coo_review -> 'independentReview', '{}'::jsonb);
  v_semantic_review := COALESCE(v_independent_review -> 'semanticReview', '{}'::jsonb);

  IF p_decision = 'accept' THEN
    IF v_independent_review ->> 'verdict' IS DISTINCT FROM 'accepted'
       OR v_semantic_review ->> 'verdict' IS DISTINCT FROM 'accepted'
       OR v_semantic_review ->> 'citationsVerified' IS DISTINCT FROM 'true'
       OR v_independent_review ->> 'submittingAgentId' IS DISTINCT FROM v_mission.agent_id::text
       OR v_independent_review ->> 'reviewerAgentId' IS NULL
       OR v_independent_review ->> 'reviewerAgentId' = v_mission.agent_id::text THEN
      RAISE EXCEPTION 'INDEPENDENT_REVIEW_NOT_ACCEPTED' USING ERRCODE = '55000';
    END IF;
  END IF;

  v_now := pg_catalog.clock_timestamp();
  v_review_status := CASE
    WHEN p_decision = 'accept' THEN 'accepted'
    WHEN p_decision = 'return' THEN 'revision_requested'
    ELSE 'rejected'
  END;

  v_coo_review := v_coo_review || pg_catalog.jsonb_build_object(
    'status', v_review_status,
    'closureEligible', p_decision = 'accept',
    'reviewedAt', v_now,
    'reviewedBy', p_reviewer_id,
    'note', v_note
  );

  UPDATE public.afe_agent_missions
  SET status = CASE
        WHEN p_decision = 'accept' THEN 'completed'
        WHEN p_decision = 'return' THEN 'queued'
        ELSE 'paused'
      END,
      result = COALESCE(v_mission.result, '{}'::jsonb)
        || pg_catalog.jsonb_build_object('coo_review', v_coo_review),
      input_context = CASE
        WHEN p_decision = 'return' THEN
          COALESCE(v_mission.input_context, '{}'::jsonb)
          || pg_catalog.jsonb_build_object(
            'cooReviewFeedback',
            pg_catalog.jsonb_build_object(
              'note', v_note,
              'reviewedAt', v_now,
              'reviewedBy', p_reviewer_id
            )
          )
        ELSE v_mission.input_context
      END,
      run_after = CASE WHEN p_decision = 'return' THEN v_now ELSE v_mission.run_after END,
      blocked_reason = CASE WHEN p_decision = 'accept' THEN NULL ELSE v_note END,
      completed_at = CASE WHEN p_decision = 'accept' THEN v_now ELSE NULL END,
      lease_token = NULL,
      lease_expires_at = NULL,
      updated_at = v_now
  WHERE id = p_mission_id
    AND workspace_id = p_workspace_id
  RETURNING * INTO v_updated;

  INSERT INTO public.afe_agent_events (
    workspace_id, mission_id, agent_id, actor_type, actor_id, event_type, payload
  ) VALUES (
    p_workspace_id,
    p_mission_id,
    v_mission.agent_id,
    'human',
    p_reviewer_id,
    'mission.coo_review.' || p_decision,
    pg_catalog.jsonb_build_object(
      'decision', p_decision,
      'note', v_note,
      'previousReviewStatus', 'pending',
      'reviewStatus', v_review_status,
      'closureEligible', p_decision = 'accept',
      'independentReviewVerdict', v_independent_review ->> 'verdict'
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'mission', pg_catalog.to_jsonb(v_updated),
    'decision', p_decision,
    'closureEligible', p_decision = 'accept'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.decide_afe_agent_mission_coo_review(uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decide_afe_agent_mission_coo_review(uuid, uuid, uuid, text, text)
  TO service_role;

COMMENT ON FUNCTION public.decide_afe_agent_mission_coo_review(uuid, uuid, uuid, text, text) IS
  'Atomically records a distinct human COO decision for a pending mission review; acceptance requires accepted deterministic and semantic independent reviews.';
NOTIFY pgrst, 'reload schema';
