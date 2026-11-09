-- AFE-CI COO Dependency P1 — execution gate reinforcement and automatic analysis queue.
-- Additive only; applies to the afe-ci-test project.

ALTER TABLE public.afe_operational_tasks
  ADD COLUMN IF NOT EXISTS dependency_analysis_status text NOT NULL DEFAULT 'pending'
    CHECK (dependency_analysis_status IN ('pending','analyzed','failed','skipped')),
  ADD COLUMN IF NOT EXISTS dependency_analysis_at timestamptz,
  ADD COLUMN IF NOT EXISTS dependency_analysis_error text
    CHECK (dependency_analysis_error IS NULL OR length(dependency_analysis_error) <= 2000);

CREATE INDEX IF NOT EXISTS afe_operational_tasks_dependency_analysis_idx
  ON public.afe_operational_tasks(workspace_id, dependency_analysis_status, due_at)
  WHERE dependency_analysis_status IN ('pending','failed');

CREATE OR REPLACE FUNCTION public.guard_afe_coo_task_dependency_execution()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_edge_id uuid;
BEGIN
  IF NEW.status NOT IN ('todo','in_progress','done') THEN RETURN NEW; END IF;
  SELECT e.id INTO v_edge_id
  FROM public.afe_coo_dependency_edges e
  WHERE e.workspace_id = NEW.workspace_id
    AND e.dependent_kind = 'task'
    AND e.dependent_task_id = NEW.id
    AND e.status = 'active'
    AND e.relation_type = 'hard_prerequisite'
    AND NOT public.afe_coo_dependency_prerequisite_satisfied(
      e.workspace_id, e.prerequisite_kind, e.prerequisite_task_id,
      e.prerequisite_mission_id, e.required_deliverable_id
    )
  ORDER BY e.created_at
  LIMIT 1;
  IF v_edge_id IS NOT NULL THEN
    NEW.status := 'blocked';
    NEW.blocked_reason := 'COO_DEPENDENCY_BLOCKED: prérequis DG non satisfait (' || v_edge_id::text || ')';
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS afe_coo_task_dependency_execution_guard ON public.afe_operational_tasks;
CREATE TRIGGER afe_coo_task_dependency_execution_guard
  BEFORE UPDATE OF status ON public.afe_operational_tasks
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.guard_afe_coo_task_dependency_execution();

CREATE OR REPLACE FUNCTION public.guard_afe_coo_mission_dependency_execution()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_edge_id uuid;
BEGIN
  IF NEW.status NOT IN ('queued','planning','running','completed') THEN RETURN NEW; END IF;
  SELECT e.id INTO v_edge_id
  FROM public.afe_coo_dependency_edges e
  WHERE e.workspace_id = NEW.workspace_id
    AND e.status = 'active'
    AND e.relation_type = 'hard_prerequisite'
    AND (
      (e.dependent_kind = 'mission' AND e.dependent_mission_id = NEW.id)
      OR
      (e.dependent_kind = 'task' AND EXISTS (
        SELECT 1 FROM public.afe_operational_tasks t
        WHERE t.id = e.dependent_task_id AND t.workspace_id = NEW.workspace_id AND t.mission_id = NEW.id
      ))
    )
    AND NOT public.afe_coo_dependency_prerequisite_satisfied(
      e.workspace_id, e.prerequisite_kind, e.prerequisite_task_id,
      e.prerequisite_mission_id, e.required_deliverable_id
    )
  ORDER BY e.created_at
  LIMIT 1;
  IF v_edge_id IS NOT NULL THEN
    NEW.status := 'paused';
    NEW.blocked_reason := 'COO_DEPENDENCY_BLOCKED: prérequis DG non satisfait (' || v_edge_id::text || ')';
    NEW.lease_token := NULL;
    NEW.lease_expires_at := NULL;
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS afe_coo_mission_dependency_execution_guard ON public.afe_agent_missions;
CREATE TRIGGER afe_coo_mission_dependency_execution_guard
  BEFORE UPDATE OF status ON public.afe_agent_missions
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.guard_afe_coo_mission_dependency_execution();

COMMENT ON COLUMN public.afe_operational_tasks.dependency_analysis_status IS
  'COO dependency analyzer queue: pending tasks are automatically analyzed by the scheduled dependency worker.';
