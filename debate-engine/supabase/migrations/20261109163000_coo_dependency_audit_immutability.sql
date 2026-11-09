-- Append-only audit and immutable evidence for the COO dependency workflow.

CREATE OR REPLACE FUNCTION public.prevent_afe_coo_dependency_event_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'COO dependency audit events are append-only';
END;
$$;
DROP TRIGGER IF EXISTS afe_coo_dependency_events_append_only ON public.afe_coo_dependency_events;
CREATE TRIGGER afe_coo_dependency_events_append_only
  BEFORE UPDATE OR DELETE ON public.afe_coo_dependency_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_afe_coo_dependency_event_mutation();

CREATE OR REPLACE FUNCTION public.guard_afe_coo_deliverable_version_immutability()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF ROW(
    NEW.workspace_id, NEW.producer_kind, NEW.producer_task_id, NEW.producer_mission_id,
    NEW.department_id, NEW.deliverable_key, NEW.title, NEW.description, NEW.content,
    NEW.version, NEW.acceptance_criteria, NEW.submitted_by, NEW.submitted_at,
    NEW.source_event_id, NEW.supersedes_id
  ) IS DISTINCT FROM ROW(
    OLD.workspace_id, OLD.producer_kind, OLD.producer_task_id, OLD.producer_mission_id,
    OLD.department_id, OLD.deliverable_key, OLD.title, OLD.description, OLD.content,
    OLD.version, OLD.acceptance_criteria, OLD.submitted_by, OLD.submitted_at,
    OLD.source_event_id, OLD.supersedes_id
  ) THEN
    RAISE EXCEPTION 'Submitted COO deliverable versions are immutable; submit a new version instead';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS afe_coo_deliverables_immutable_version ON public.afe_coo_deliverables;
CREATE TRIGGER afe_coo_deliverables_immutable_version
  BEFORE UPDATE ON public.afe_coo_deliverables
  FOR EACH ROW EXECUTE FUNCTION public.guard_afe_coo_deliverable_version_immutability();

CREATE OR REPLACE FUNCTION public.guard_afe_coo_dependency_proposal_immutability()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF ROW(
    NEW.workspace_id, NEW.dependent_kind, NEW.dependent_task_id, NEW.dependent_mission_id,
    NEW.prerequisite_kind, NEW.prerequisite_task_id, NEW.prerequisite_mission_id,
    NEW.prerequisite_department_id, NEW.relation_type, NEW.rationale,
    NEW.expected_deliverable, NEW.acceptance_criteria, NEW.confidence,
    NEW.proposal_source, NEW.proposed_by, NEW.proposed_at, NEW.required_deliverable_id
  ) IS DISTINCT FROM ROW(
    OLD.workspace_id, OLD.dependent_kind, OLD.dependent_task_id, OLD.dependent_mission_id,
    OLD.prerequisite_kind, OLD.prerequisite_task_id, OLD.prerequisite_mission_id,
    OLD.prerequisite_department_id, OLD.relation_type, OLD.rationale,
    OLD.expected_deliverable, OLD.acceptance_criteria, OLD.confidence,
    OLD.proposal_source, OLD.proposed_by, OLD.proposed_at, OLD.required_deliverable_id
  ) THEN
    RAISE EXCEPTION 'COO dependency proposal details are immutable after submission';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS afe_coo_dependency_proposal_immutable ON public.afe_coo_dependency_edges;
CREATE TRIGGER afe_coo_dependency_proposal_immutable
  BEFORE UPDATE ON public.afe_coo_dependency_edges
  FOR EACH ROW EXECUTE FUNCTION public.guard_afe_coo_dependency_proposal_immutability();

CREATE OR REPLACE FUNCTION public.log_afe_coo_dependency_status_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_event_type text; v_actor_id uuid;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  v_event_type := CASE
    WHEN OLD.status = 'pending_dg' AND NEW.status = 'active' THEN 'dependency.activated_by_dg'
    WHEN OLD.status = 'pending_dg' AND NEW.status = 'rejected' THEN 'dependency.rejected_by_dg'
    WHEN OLD.status = 'active' AND NEW.status = 'satisfied' THEN 'dependency.satisfied_automatically'
    WHEN OLD.status = 'satisfied' AND NEW.status = 'active' THEN 'dependency.reopened_automatically'
    ELSE 'dependency.status_changed'
  END;
  v_actor_id := CASE WHEN OLD.status = 'pending_dg' AND NEW.status IN ('active','rejected') THEN NEW.reviewed_by ELSE NULL END;
  INSERT INTO public.afe_coo_dependency_events(workspace_id,edge_id,actor_id,event_type,details)
  VALUES (
    NEW.workspace_id, NEW.id, v_actor_id, v_event_type,
    jsonb_build_object('from',OLD.status,'to',NEW.status,'decision_note',NEW.decision_note,'changed_at',now())
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS afe_coo_dependency_status_audit ON public.afe_coo_dependency_edges;
CREATE TRIGGER afe_coo_dependency_status_audit
  AFTER UPDATE OF status ON public.afe_coo_dependency_edges
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.log_afe_coo_dependency_status_change();
