-- Make proposal creation and DG deliverable decisions auditable in the same transaction.
CREATE OR REPLACE FUNCTION public.audit_afe_coo_dependency_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.afe_coo_dependency_events(workspace_id, edge_id, actor_id, event_type, details)
  VALUES (
    NEW.workspace_id, NEW.id, NEW.proposed_by, 'dependency.proposed',
    jsonb_build_object(
      'dependent_kind', NEW.dependent_kind,
      'dependent_task_id', NEW.dependent_task_id,
      'dependent_mission_id', NEW.dependent_mission_id,
      'prerequisite_kind', NEW.prerequisite_kind,
      'prerequisite_task_id', NEW.prerequisite_task_id,
      'prerequisite_mission_id', NEW.prerequisite_mission_id,
      'prerequisite_department_id', NEW.prerequisite_department_id,
      'relation_type', NEW.relation_type,
      'expected_deliverable', NEW.expected_deliverable,
      'confidence', NEW.confidence,
      'status', NEW.status
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS afe_coo_dependency_insert_audit ON public.afe_coo_dependency_edges;
CREATE TRIGGER afe_coo_dependency_insert_audit
AFTER INSERT ON public.afe_coo_dependency_edges
FOR EACH ROW EXECUTE FUNCTION public.audit_afe_coo_dependency_insert();

CREATE OR REPLACE FUNCTION public.audit_afe_coo_deliverable_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v_event_type text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('accepted','rejected') THEN RETURN NEW; END IF;
  v_event_type := CASE WHEN NEW.status = 'accepted'
    THEN 'deliverable.accepted_by_dg'
    ELSE 'deliverable.rejected_by_dg' END;
  INSERT INTO public.afe_coo_dependency_events(workspace_id, deliverable_id, actor_id, event_type, details)
  VALUES (
    NEW.workspace_id, NEW.id, NEW.accepted_by, v_event_type,
    jsonb_build_object(
      'from', OLD.status,
      'to', NEW.status,
      'producer_kind', NEW.producer_kind,
      'producer_task_id', NEW.producer_task_id,
      'producer_mission_id', NEW.producer_mission_id,
      'deliverable_key', NEW.deliverable_key,
      'version', NEW.version,
      'verification_notes', NEW.verification_notes,
      'changed_at', now()
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS afe_coo_deliverable_decision_audit ON public.afe_coo_deliverables;
CREATE TRIGGER afe_coo_deliverable_decision_audit
AFTER UPDATE OF status ON public.afe_coo_deliverables
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.audit_afe_coo_deliverable_decision();

REVOKE TRUNCATE ON TABLE public.afe_coo_dependency_events FROM service_role;
