-- AFE-CI COO Dependency Intelligence P1
-- Additive, workspace-scoped. Apply to afe-ci-test only; never Production without separate approval.

CREATE TABLE IF NOT EXISTS public.afe_coo_deliverables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.debate_workspaces(id) ON DELETE CASCADE,
  producer_kind text NOT NULL CHECK (producer_kind IN ('task','mission')),
  producer_task_id uuid,
  producer_mission_id uuid,
  department_id uuid NOT NULL,
  deliverable_key text NOT NULL CHECK (length(btrim(deliverable_key)) BETWEEN 2 AND 120),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 220),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
  content jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(content) = 'object'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('draft','submitted','accepted','rejected','superseded')),
  acceptance_criteria jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(acceptance_criteria) = 'array'),
  verification_notes text CHECK (verification_notes IS NULL OR length(verification_notes) <= 4000),
  submitted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  source_event_id bigint REFERENCES public.afe_agent_events(id) ON DELETE SET NULL,
  supersedes_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (producer_task_id, workspace_id)
    REFERENCES public.afe_operational_tasks(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (producer_mission_id, workspace_id)
    REFERENCES public.afe_agent_missions(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (department_id, workspace_id)
    REFERENCES public.afe_org_departments(id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (supersedes_id, workspace_id)
    REFERENCES public.afe_coo_deliverables(id, workspace_id) ON DELETE SET NULL (supersedes_id),
  CHECK (
    (producer_kind = 'task' AND producer_task_id IS NOT NULL AND producer_mission_id IS NULL)
    OR
    (producer_kind = 'mission' AND producer_mission_id IS NOT NULL AND producer_task_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS afe_coo_deliverables_version_idx
  ON public.afe_coo_deliverables
  (workspace_id, producer_kind, COALESCE(producer_task_id, producer_mission_id), deliverable_key, version);
CREATE UNIQUE INDEX IF NOT EXISTS afe_coo_deliverables_source_event_idx
  ON public.afe_coo_deliverables(source_event_id, deliverable_key)
  WHERE source_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS afe_coo_deliverables_review_idx
  ON public.afe_coo_deliverables(workspace_id, status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS afe_coo_deliverables_producer_task_idx
  ON public.afe_coo_deliverables(workspace_id, producer_task_id, status)
  WHERE producer_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS afe_coo_deliverables_producer_mission_idx
  ON public.afe_coo_deliverables(workspace_id, producer_mission_id, status)
  WHERE producer_mission_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.afe_coo_dependency_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.debate_workspaces(id) ON DELETE CASCADE,
  dependent_kind text NOT NULL CHECK (dependent_kind IN ('task','mission')),
  dependent_task_id uuid,
  dependent_mission_id uuid,
  prerequisite_kind text NOT NULL CHECK (prerequisite_kind IN ('task','mission','department')),
  prerequisite_task_id uuid,
  prerequisite_mission_id uuid,
  prerequisite_department_id uuid,
  relation_type text NOT NULL CHECK (relation_type IN ('hard_prerequisite','input_reference','parallel','human_gate')),
  status text NOT NULL DEFAULT 'pending_dg'
    CHECK (status IN ('pending_dg','active','satisfied','rejected','blocked')),
  rationale text NOT NULL CHECK (length(btrim(rationale)) BETWEEN 12 AND 4000),
  expected_deliverable text NOT NULL CHECK (length(btrim(expected_deliverable)) BETWEEN 3 AND 1000),
  acceptance_criteria jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(acceptance_criteria) = 'array'),
  confidence numeric(4,3) NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  proposal_source text NOT NULL DEFAULT 'coo_ai' CHECK (proposal_source IN ('coo_ai','human')),
  proposed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decision_note text CHECK (decision_note IS NULL OR length(decision_note) <= 3000),
  required_deliverable_id uuid,
  proposed_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  activated_at timestamptz,
  satisfied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (dependent_task_id, workspace_id)
    REFERENCES public.afe_operational_tasks(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (dependent_mission_id, workspace_id)
    REFERENCES public.afe_agent_missions(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (prerequisite_task_id, workspace_id)
    REFERENCES public.afe_operational_tasks(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (prerequisite_mission_id, workspace_id)
    REFERENCES public.afe_agent_missions(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (prerequisite_department_id, workspace_id)
    REFERENCES public.afe_org_departments(id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (required_deliverable_id, workspace_id)
    REFERENCES public.afe_coo_deliverables(id, workspace_id) ON DELETE RESTRICT,
  CHECK (
    (dependent_kind = 'task' AND dependent_task_id IS NOT NULL AND dependent_mission_id IS NULL)
    OR
    (dependent_kind = 'mission' AND dependent_mission_id IS NOT NULL AND dependent_task_id IS NULL)
  ),
  CHECK (
    (prerequisite_kind = 'task' AND prerequisite_task_id IS NOT NULL AND prerequisite_mission_id IS NULL AND prerequisite_department_id IS NULL)
    OR
    (prerequisite_kind = 'mission' AND prerequisite_mission_id IS NOT NULL AND prerequisite_task_id IS NULL AND prerequisite_department_id IS NULL)
    OR
    (prerequisite_kind = 'department' AND prerequisite_department_id IS NOT NULL AND prerequisite_task_id IS NULL AND prerequisite_mission_id IS NULL)
  ),
  CHECK (dependent_kind <> prerequisite_kind OR
    COALESCE(dependent_task_id, dependent_mission_id) <> COALESCE(prerequisite_task_id, prerequisite_mission_id)),
  CHECK (prerequisite_kind <> 'department' OR relation_type IN ('input_reference','human_gate'))
);
CREATE INDEX IF NOT EXISTS afe_coo_dependency_edges_dependent_idx
  ON public.afe_coo_dependency_edges(workspace_id, dependent_kind, status);
CREATE INDEX IF NOT EXISTS afe_coo_dependency_edges_prerequisite_idx
  ON public.afe_coo_dependency_edges(workspace_id, prerequisite_kind, status);
CREATE UNIQUE INDEX IF NOT EXISTS afe_coo_dependency_edges_unique_idx
  ON public.afe_coo_dependency_edges (
    workspace_id, dependent_kind,
    COALESCE(dependent_task_id, dependent_mission_id),
    prerequisite_kind,
    COALESCE(prerequisite_task_id, prerequisite_mission_id, prerequisite_department_id),
    relation_type
  ) WHERE status <> 'rejected';

CREATE TABLE IF NOT EXISTS public.afe_coo_dependency_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.debate_workspaces(id) ON DELETE CASCADE,
  edge_id uuid,
  deliverable_id uuid,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (length(event_type) BETWEEN 3 AND 100),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (edge_id, workspace_id)
    REFERENCES public.afe_coo_dependency_edges(id, workspace_id) ON DELETE SET NULL (edge_id),
  FOREIGN KEY (deliverable_id, workspace_id)
    REFERENCES public.afe_coo_deliverables(id, workspace_id) ON DELETE SET NULL (deliverable_id)
);
CREATE INDEX IF NOT EXISTS afe_coo_dependency_events_edge_idx
  ON public.afe_coo_dependency_events(workspace_id, edge_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.afe_coo_escalation_policies (
  workspace_id uuid PRIMARY KEY REFERENCES public.debate_workspaces(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  warning_after_minutes integer NOT NULL DEFAULT 60 CHECK (warning_after_minutes BETWEEN 5 AND 10080),
  director_after_minutes integer NOT NULL DEFAULT 180 CHECK (director_after_minutes BETWEEN 10 AND 20160),
  dg_after_minutes integer NOT NULL DEFAULT 360 CHECK (dg_after_minutes BETWEEN 15 AND 43200),
  critical_after_minutes integer NOT NULL DEFAULT 720 CHECK (critical_after_minutes BETWEEN 30 AND 86400),
  pending_review_after_minutes integer NOT NULL DEFAULT 120 CHECK (pending_review_after_minutes BETWEEN 10 AND 20160),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (warning_after_minutes < director_after_minutes),
  CHECK (director_after_minutes < dg_after_minutes),
  CHECK (dg_after_minutes < critical_after_minutes)
);

CREATE TABLE IF NOT EXISTS public.afe_coo_escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.debate_workspaces(id) ON DELETE CASCADE,
  edge_id uuid NOT NULL,
  responsible_department_id uuid,
  responsible_owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  dg_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  escalation_level text NOT NULL DEFAULT 'warning'
    CHECK (escalation_level IN ('warning','director','dg','critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  blocked_since timestamptz NOT NULL,
  elapsed_minutes integer NOT NULL DEFAULT 0 CHECK (elapsed_minutes >= 0),
  threshold_minutes integer NOT NULL CHECK (threshold_minutes > 0),
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 3000),
  last_notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, edge_id),
  FOREIGN KEY (edge_id, workspace_id)
    REFERENCES public.afe_coo_dependency_edges(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (responsible_department_id, workspace_id)
    REFERENCES public.afe_org_departments(id, workspace_id) ON DELETE SET NULL (responsible_department_id)
);
CREATE INDEX IF NOT EXISTS afe_coo_escalations_inbox_idx
  ON public.afe_coo_escalations(workspace_id, status, escalation_level, updated_at DESC);

CREATE OR REPLACE FUNCTION public.afe_coo_dependency_node_key(
  p_kind text, p_task_id uuid, p_mission_id uuid, p_department_id uuid
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT p_kind || ':' || COALESCE(p_task_id, p_mission_id, p_department_id)::text
$$;

CREATE OR REPLACE FUNCTION public.guard_afe_coo_dependency_edge()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_dependent_key text;
  v_prerequisite_key text;
  v_cycle boolean;
  v_mission_status text;
  v_mission_id uuid;
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
DROP TRIGGER IF EXISTS afe_coo_dependency_edge_guard ON public.afe_coo_dependency_edges;
CREATE TRIGGER afe_coo_dependency_edge_guard
  BEFORE INSERT OR UPDATE OF workspace_id, dependent_kind, dependent_task_id, dependent_mission_id,
    prerequisite_kind, prerequisite_task_id, prerequisite_mission_id, prerequisite_department_id, status
  ON public.afe_coo_dependency_edges
  FOR EACH ROW EXECUTE FUNCTION public.guard_afe_coo_dependency_edge();

CREATE OR REPLACE FUNCTION public.afe_coo_dependency_prerequisite_satisfied(
  p_workspace_id uuid, p_kind text, p_task_id uuid, p_mission_id uuid, p_deliverable_id uuid
) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v_ok boolean := false;
BEGIN
  IF p_deliverable_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.afe_coo_deliverables d
      WHERE d.id = p_deliverable_id AND d.workspace_id = p_workspace_id AND d.status = 'accepted'
    ) INTO v_ok;
    RETURN v_ok;
  END IF;
  IF p_kind = 'task' THEN
    SELECT t.status = 'done' AND EXISTS (
      SELECT 1 FROM public.afe_coo_deliverables d
      WHERE d.workspace_id = p_workspace_id AND d.producer_task_id = t.id AND d.status = 'accepted'
    ) INTO v_ok
    FROM public.afe_operational_tasks t
    WHERE t.id = p_task_id AND t.workspace_id = p_workspace_id;
  ELSIF p_kind = 'mission' THEN
    SELECT m.status = 'completed' AND EXISTS (
      SELECT 1 FROM public.afe_coo_deliverables d
      WHERE d.workspace_id = p_workspace_id AND d.producer_mission_id = m.id AND d.status = 'accepted'
    ) INTO v_ok
    FROM public.afe_agent_missions m
    WHERE m.id = p_mission_id AND m.workspace_id = p_workspace_id;
  ELSE
    v_ok := true;
  END IF;
  RETURN COALESCE(v_ok, false);
END;
$$;

-- Fix declaration separately so the function has no dependency on a non-existent local variable.
CREATE OR REPLACE FUNCTION public.sync_afe_coo_dependency_edge()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_satisfied boolean;
  v_mission_id uuid;
  v_mission_status text;
BEGIN
  IF NEW.status <> 'active' OR NEW.relation_type <> 'hard_prerequisite' THEN
    RETURN NEW;
  END IF;
  IF NEW.dependent_kind = 'task' THEN
    SELECT t.mission_id INTO v_mission_id
    FROM public.afe_operational_tasks t
    WHERE t.id = NEW.dependent_task_id AND t.workspace_id = NEW.workspace_id
    FOR UPDATE;
  ELSE
    v_mission_id := NEW.dependent_mission_id;
    PERFORM 1 FROM public.afe_agent_missions WHERE id = v_mission_id AND workspace_id = NEW.workspace_id FOR UPDATE;
  END IF;
  IF v_mission_id IS NOT NULL THEN
    SELECT status INTO v_mission_status FROM public.afe_agent_missions
    WHERE id = v_mission_id AND workspace_id = NEW.workspace_id;
    IF v_mission_status = 'running' THEN
      RAISE EXCEPTION 'Cannot activate a dependency while the dependent mission is running';
    END IF;
  END IF;
  v_satisfied := public.afe_coo_dependency_prerequisite_satisfied(
    NEW.workspace_id, NEW.prerequisite_kind, NEW.prerequisite_task_id,
    NEW.prerequisite_mission_id, NEW.required_deliverable_id
  );
  IF v_satisfied THEN
    UPDATE public.afe_coo_dependency_edges SET status = 'satisfied', satisfied_at = now(), updated_at = now()
    WHERE id = NEW.id AND workspace_id = NEW.workspace_id;
  ELSE
    IF NEW.dependent_kind = 'task' THEN
      UPDATE public.afe_operational_tasks
      SET status = 'blocked',
          blocked_reason = 'COO_DEPENDENCY_BLOCKED: prérequis DG non satisfait (' || NEW.id::text || ')',
          updated_at = now()
      WHERE id = NEW.dependent_task_id AND workspace_id = NEW.workspace_id
        AND status IN ('todo','in_progress');
    END IF;
    IF v_mission_id IS NOT NULL THEN
      UPDATE public.afe_agent_missions
      SET status = 'paused',
          blocked_reason = 'COO_DEPENDENCY_BLOCKED: dépendance DG non satisfaite (' || NEW.id::text || ')',
          updated_at = now()
      WHERE id = v_mission_id AND workspace_id = NEW.workspace_id
        AND status IN ('queued','planning');
    END IF;
  END IF;
  IF NEW.dependent_kind = 'mission' AND NEW.prerequisite_kind = 'mission' THEN
    INSERT INTO public.afe_agent_mission_dependencies(workspace_id, mission_id, depends_on_mission_id, created_by)
    VALUES (NEW.workspace_id, NEW.dependent_mission_id, NEW.prerequisite_mission_id, NEW.proposed_by)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS afe_coo_dependency_edge_sync ON public.afe_coo_dependency_edges;
CREATE TRIGGER afe_coo_dependency_edge_sync
  AFTER INSERT OR UPDATE OF status ON public.afe_coo_dependency_edges
  FOR EACH ROW EXECUTE FUNCTION public.sync_afe_coo_dependency_edge();

CREATE OR REPLACE FUNCTION public.refresh_afe_coo_dependency_readiness(p_workspace_id uuid)
RETURNS integer LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_changed integer := 0; v_count integer := 0;
BEGIN
  UPDATE public.afe_coo_dependency_edges e
  SET status = 'satisfied', satisfied_at = now(), updated_at = now()
  WHERE e.workspace_id = p_workspace_id AND e.status = 'active'
    AND e.relation_type = 'hard_prerequisite'
    AND public.afe_coo_dependency_prerequisite_satisfied(
      e.workspace_id, e.prerequisite_kind, e.prerequisite_task_id,
      e.prerequisite_mission_id, e.required_deliverable_id
    );
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  v_count := v_changed;

  UPDATE public.afe_coo_dependency_edges e
  SET status = 'active', satisfied_at = NULL, updated_at = now()
  WHERE e.workspace_id = p_workspace_id AND e.status = 'satisfied'
    AND e.relation_type = 'hard_prerequisite'
    AND NOT public.afe_coo_dependency_prerequisite_satisfied(
      e.workspace_id, e.prerequisite_kind, e.prerequisite_task_id,
      e.prerequisite_mission_id, e.required_deliverable_id
    );
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  v_count := v_count + v_changed;

  UPDATE public.afe_operational_tasks t
  SET status = CASE WHEN t.progress_percent > 0 THEN 'in_progress' ELSE 'todo' END,
      blocked_reason = NULL, updated_at = now()
  WHERE t.workspace_id = p_workspace_id AND t.status = 'blocked'
    AND t.blocked_reason LIKE 'COO_DEPENDENCY_BLOCKED:%'
    AND NOT EXISTS (
      SELECT 1 FROM public.afe_coo_dependency_edges e
      WHERE e.workspace_id = p_workspace_id AND e.dependent_kind = 'task'
        AND e.dependent_task_id = t.id AND e.status = 'active'
        AND e.relation_type = 'hard_prerequisite'
    );

  UPDATE public.afe_agent_missions m
  SET status = 'queued', blocked_reason = NULL, run_after = now(), updated_at = now()
  WHERE m.workspace_id = p_workspace_id AND m.status = 'paused'
    AND m.blocked_reason LIKE 'COO_DEPENDENCY_BLOCKED:%'
    AND NOT EXISTS (
      SELECT 1 FROM public.afe_coo_dependency_edges e
      WHERE e.workspace_id = p_workspace_id AND e.status = 'active'
        AND e.relation_type = 'hard_prerequisite'
        AND (
          (e.dependent_kind = 'mission' AND e.dependent_mission_id = m.id)
          OR (e.dependent_kind = 'task' AND EXISTS (
            SELECT 1 FROM public.afe_operational_tasks t
            WHERE t.id = e.dependent_task_id AND t.workspace_id = p_workspace_id AND t.mission_id = m.id
          ))
        )
    );
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_refresh_afe_coo_dependency_readiness()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_workspace_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'afe_coo_deliverables' THEN v_workspace_id := COALESCE(NEW.workspace_id, OLD.workspace_id);
  ELSIF TG_TABLE_NAME = 'afe_operational_tasks' THEN v_workspace_id := COALESCE(NEW.workspace_id, OLD.workspace_id);
  ELSE v_workspace_id := COALESCE(NEW.workspace_id, OLD.workspace_id);
  END IF;
  PERFORM public.refresh_afe_coo_dependency_readiness(v_workspace_id);
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS afe_coo_deliverable_readiness_refresh ON public.afe_coo_deliverables;
CREATE TRIGGER afe_coo_deliverable_readiness_refresh
  AFTER INSERT OR UPDATE OF status ON public.afe_coo_deliverables
  FOR EACH ROW EXECUTE FUNCTION public.trigger_refresh_afe_coo_dependency_readiness();
DROP TRIGGER IF EXISTS afe_coo_task_readiness_refresh ON public.afe_operational_tasks;
CREATE TRIGGER afe_coo_task_readiness_refresh
  AFTER UPDATE OF status ON public.afe_operational_tasks
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.trigger_refresh_afe_coo_dependency_readiness();
DROP TRIGGER IF EXISTS afe_coo_mission_readiness_refresh ON public.afe_agent_missions;
CREATE TRIGGER afe_coo_mission_readiness_refresh
  AFTER UPDATE OF status ON public.afe_agent_missions
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.trigger_refresh_afe_coo_dependency_readiness();

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
    v_key := 'task-output';
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
DROP TRIGGER IF EXISTS afe_coo_capture_mission_deliverables ON public.afe_agent_events;
CREATE TRIGGER afe_coo_capture_mission_deliverables
  AFTER INSERT ON public.afe_agent_events
  FOR EACH ROW EXECUTE FUNCTION public.capture_afe_coo_mission_deliverables();

CREATE OR REPLACE FUNCTION public.seed_afe_coo_escalation_policy()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  INSERT INTO public.afe_coo_escalation_policies(workspace_id)
  VALUES (NEW.id) ON CONFLICT (workspace_id) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS debate_workspaces_seed_coo_escalation_policy ON public.debate_workspaces;
CREATE TRIGGER debate_workspaces_seed_coo_escalation_policy
  AFTER INSERT ON public.debate_workspaces
  FOR EACH ROW EXECUTE FUNCTION public.seed_afe_coo_escalation_policy();
INSERT INTO public.afe_coo_escalation_policies(workspace_id)
SELECT id FROM public.debate_workspaces ON CONFLICT (workspace_id) DO NOTHING;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'afe_coo_deliverables','afe_coo_dependency_edges','afe_coo_dependency_events',
    'afe_coo_escalation_policies','afe_coo_escalations'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
  END LOOP;
END $$;

COMMENT ON TABLE public.afe_coo_deliverables IS
  'Versioned, workspace-scoped outputs with producer lineage, acceptance criteria and DG review status.';
COMMENT ON TABLE public.afe_coo_dependency_edges IS
  'Directed task/mission/department dependency graph. COO proposals remain pending until explicit DG approval.';
COMMENT ON TABLE public.afe_coo_escalations IS
  'Accountability register for overdue prerequisites, producer department attribution and DG escalation.';
