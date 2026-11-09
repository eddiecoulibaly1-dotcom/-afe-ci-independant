-- Preserve audit ordering and allow referential cleanup only when initiated by parent cascades.

CREATE OR REPLACE FUNCTION public.prevent_afe_coo_dependency_event_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'COO dependency audit events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS afe_coo_dependency_status_audit ON public.afe_coo_dependency_edges;
CREATE TRIGGER afe_coo_dependency_status_audit
  BEFORE UPDATE OF status ON public.afe_coo_dependency_edges
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.log_afe_coo_dependency_status_change();
