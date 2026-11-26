-- E9.2: mission dependency add/remove are transactional with audit and cycle-safe locking.
CREATE OR REPLACE FUNCTION public.afe_coo_manage_mission_dependency_atomic(
  p_workspace_id uuid,
  p_mission_id uuid,
  p_action text,
  p_depends_on_mission_id uuid,
  p_dependency_id uuid,
  p_actor_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mission public.afe_agent_missions%rowtype;
  v_prerequisite public.afe_agent_missions%rowtype;
  v_dependency public.afe_agent_mission_dependencies%rowtype;
  v_exists boolean := false;
  v_cycle boolean := false;
  v_path uuid[];
BEGIN
  IF p_action NOT IN ('add','remove') THEN
    RAISE EXCEPTION 'COO_DEPENDENCY_INVALID_ACTION' USING ERRCODE='P0001';
  END IF;
  -- Serialize all graph mutations for this workspace to prevent concurrent cycle creation.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 913742));

  SELECT * INTO v_mission FROM public.afe_agent_missions
  WHERE id=p_mission_id AND workspace_id=p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COO_DEPENDENCY_MISSION_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF v_mission.status NOT IN ('queued','paused') THEN
    RAISE EXCEPTION 'COO_DEPENDENCY_MISSION_STATE_INVALID' USING ERRCODE='P0001';
  END IF;

  IF p_action='add' THEN
    IF p_depends_on_mission_id IS NULL OR p_depends_on_mission_id=p_mission_id THEN
      RAISE EXCEPTION 'COO_DEPENDENCY_INVALID_TARGET' USING ERRCODE='P0001';
    END IF;
    SELECT * INTO v_prerequisite FROM public.afe_agent_missions
    WHERE id=p_depends_on_mission_id AND workspace_id=p_workspace_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'COO_DEPENDENCY_PREREQUISITE_NOT_FOUND' USING ERRCODE='P0001'; END IF;
    IF v_prerequisite.status IN ('failed','cancelled') THEN
      RAISE EXCEPTION 'COO_DEPENDENCY_PREREQUISITE_TERMINAL_INVALID' USING ERRCODE='P0001';
    END IF;

    SELECT id INTO v_dependency FROM public.afe_agent_mission_dependencies
    WHERE workspace_id=p_workspace_id AND mission_id=p_mission_id
      AND depends_on_mission_id=p_depends_on_mission_id LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('action','add','added',false,'dependency',to_jsonb(v_dependency));
    END IF;

    -- Starting at the proposed prerequisite, follow existing prerequisite edges.
    WITH RECURSIVE reach(node_id,path,cycle) AS (
      SELECT p_depends_on_mission_id, ARRAY[p_depends_on_mission_id]::uuid[], false
      UNION ALL
      SELECT d.depends_on_mission_id, r.path||d.depends_on_mission_id,
             d.depends_on_mission_id=p_mission_id
      FROM reach r
      JOIN public.afe_agent_mission_dependencies d
        ON d.workspace_id=p_workspace_id AND d.mission_id=r.node_id
      WHERE NOT r.cycle AND NOT d.depends_on_mission_id=ANY(r.path)
    )
    SELECT coalesce(bool_or(node_id=p_mission_id OR cycle),false), (array_agg(path ORDER BY cardinality(path) DESC))[1]
    INTO v_cycle,v_path FROM reach;
    IF v_cycle THEN RAISE EXCEPTION 'COO_DEPENDENCY_CYCLE_DETECTED' USING ERRCODE='P0001'; END IF;

    INSERT INTO public.afe_agent_mission_dependencies(workspace_id,mission_id,depends_on_mission_id,created_by)
    VALUES(p_workspace_id,p_mission_id,p_depends_on_mission_id,p_actor_id)
    RETURNING * INTO v_dependency;
    INSERT INTO public.debate_workspace_audit(workspace_id,actor_id,action,entity_type,entity_id,details)
    VALUES(p_workspace_id,p_actor_id,'coo.mission.dependency.added','mission',p_mission_id::text,
      jsonb_build_object('dependsOnMissionId',p_depends_on_mission_id,'dependencyId',v_dependency.id,'atomicity','E9.2'));
    RETURN jsonb_build_object('action','add','added',true,'dependency',to_jsonb(v_dependency));
  END IF;

  IF p_dependency_id IS NULL THEN RAISE EXCEPTION 'COO_DEPENDENCY_ID_REQUIRED' USING ERRCODE='P0001'; END IF;
  DELETE FROM public.afe_agent_mission_dependencies
  WHERE id=p_dependency_id AND workspace_id=p_workspace_id AND mission_id=p_mission_id
  RETURNING * INTO v_dependency;
  IF NOT FOUND THEN RAISE EXCEPTION 'COO_DEPENDENCY_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  INSERT INTO public.debate_workspace_audit(workspace_id,actor_id,action,entity_type,entity_id,details)
  VALUES(p_workspace_id,p_actor_id,'coo.mission.dependency.removed','mission',p_mission_id::text,
    jsonb_build_object('dependsOnMissionId',v_dependency.depends_on_mission_id,'dependencyId',v_dependency.id,'atomicity','E9.2'));
  RETURN jsonb_build_object('action','remove','removed',true,'dependency',to_jsonb(v_dependency));
END;
$$;
REVOKE ALL ON FUNCTION public.afe_coo_manage_mission_dependency_atomic(uuid,uuid,text,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.afe_coo_manage_mission_dependency_atomic(uuid,uuid,text,uuid,uuid,uuid) TO service_role;
