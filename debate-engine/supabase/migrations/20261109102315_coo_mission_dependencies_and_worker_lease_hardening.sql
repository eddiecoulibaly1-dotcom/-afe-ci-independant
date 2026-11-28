-- P1: enforce dependency cycles and readiness, and renew long-running worker leases.
CREATE INDEX IF NOT EXISTS afe_agent_mission_dependencies_mission_idx ON public.afe_agent_mission_dependencies (workspace_id, mission_id);
CREATE INDEX IF NOT EXISTS afe_agent_mission_dependencies_prerequisite_idx ON public.afe_agent_mission_dependencies (workspace_id, depends_on_mission_id);
ALTER TABLE public.afe_agent_mission_dependencies DROP CONSTRAINT IF EXISTS afe_agent_mission_dependencies_no_self_check;
ALTER TABLE public.afe_agent_mission_dependencies ADD CONSTRAINT afe_agent_mission_dependencies_no_self_check CHECK (mission_id <> depends_on_mission_id);

CREATE OR REPLACE FUNCTION public.guard_afe_agent_mission_dependency_cycle()
RETURNS trigger LANGUAGE plpgsql AS '
DECLARE v_cycle boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.workspace_id::text,0));
 IF NEW.mission_id=NEW.depends_on_mission_id THEN RAISE EXCEPTION ''A mission cannot depend on itself''; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.afe_agent_missions WHERE id=NEW.mission_id AND workspace_id=NEW.workspace_id)
 OR NOT EXISTS(SELECT 1 FROM public.afe_agent_missions WHERE id=NEW.depends_on_mission_id AND workspace_id=NEW.workspace_id) THEN
  RAISE EXCEPTION ''Dependency missions must belong to the same workspace'';
 END IF;
 WITH RECURSIVE reachable(mission_id) AS (
  SELECT NEW.depends_on_mission_id
  UNION
  SELECT d.depends_on_mission_id FROM public.afe_agent_mission_dependencies d
  JOIN reachable r ON d.mission_id=r.mission_id WHERE d.workspace_id=NEW.workspace_id
 ) SELECT EXISTS(SELECT 1 FROM reachable WHERE mission_id=NEW.mission_id) INTO v_cycle;
 IF v_cycle THEN RAISE EXCEPTION ''Mission dependency cycle detected''; END IF;
 RETURN NEW;
END';

DROP TRIGGER IF EXISTS afe_agent_mission_dependency_cycle_guard ON public.afe_agent_mission_dependencies;
CREATE TRIGGER afe_agent_mission_dependency_cycle_guard
 BEFORE INSERT OR UPDATE OF workspace_id,mission_id,depends_on_mission_id
 ON public.afe_agent_mission_dependencies FOR EACH ROW
 EXECUTE FUNCTION public.guard_afe_agent_mission_dependency_cycle();

CREATE OR REPLACE FUNCTION public.sync_afe_agent_mission_dependency_gate()
RETURNS trigger LANGUAGE plpgsql AS '
DECLARE v_workspace uuid; v_mission uuid; v_prerequisite uuid; v_status text;
BEGIN
 IF TG_OP=''DELETE'' THEN
  v_workspace:=OLD.workspace_id; v_mission:=OLD.mission_id;
 ELSE
  v_workspace:=NEW.workspace_id; v_mission:=NEW.mission_id; v_prerequisite:=NEW.depends_on_mission_id;
 END IF;
 IF TG_OP<>''DELETE'' THEN
  SELECT status INTO v_status FROM public.afe_agent_missions WHERE id=v_prerequisite AND workspace_id=v_workspace;
  IF v_status IS DISTINCT FROM ''completed'' THEN
   UPDATE public.afe_agent_missions SET status=''paused'',
    blocked_reason=''DEPENDENCY_BLOCKED: prerequisite ''||v_prerequisite::text||'' is ''||COALESCE(v_status,''missing''),
    updated_at=now()
   WHERE id=v_mission AND workspace_id=v_workspace AND status IN (''queued'',''planning'');
  END IF;
 ELSE
  UPDATE public.afe_agent_missions m SET status=''queued'',blocked_reason=NULL,run_after=now(),updated_at=now()
  WHERE m.id=v_mission AND m.workspace_id=v_workspace AND m.status=''paused''
   AND m.blocked_reason LIKE ''DEPENDENCY_BLOCKED:%''
   AND NOT EXISTS(
    SELECT 1 FROM public.afe_agent_mission_dependencies d
    JOIN public.afe_agent_missions p ON p.id=d.depends_on_mission_id AND p.workspace_id=d.workspace_id
    WHERE d.workspace_id=v_workspace AND d.mission_id=v_mission AND p.status<>''completed''
   );
 END IF;
 RETURN NULL;
END';
DROP TRIGGER IF EXISTS afe_agent_mission_dependency_gate ON public.afe_agent_mission_dependencies;
CREATE TRIGGER afe_agent_mission_dependency_gate
 AFTER INSERT OR UPDATE OR DELETE ON public.afe_agent_mission_dependencies
 FOR EACH ROW EXECUTE FUNCTION public.sync_afe_agent_mission_dependency_gate();

CREATE OR REPLACE FUNCTION public.release_afe_agent_mission_dependents()
RETURNS trigger LANGUAGE plpgsql AS '
BEGIN
 IF NEW.status<>''completed'' THEN
  UPDATE public.afe_agent_missions m SET status=''paused'',
   blocked_reason=''DEPENDENCY_BLOCKED: prerequisite ''||NEW.id::text||'' is ''||NEW.status,
   updated_at=now()
  WHERE m.workspace_id=NEW.workspace_id AND m.status IN (''queued'',''planning'')
   AND EXISTS(SELECT 1 FROM public.afe_agent_mission_dependencies d WHERE d.workspace_id=NEW.workspace_id AND d.mission_id=m.id AND d.depends_on_mission_id=NEW.id);
 ELSIF NEW.status=''completed'' THEN
  UPDATE public.afe_agent_missions m SET status=''queued'',blocked_reason=NULL,run_after=now(),updated_at=now()
  WHERE m.workspace_id=NEW.workspace_id AND m.status=''paused'' AND m.blocked_reason LIKE ''DEPENDENCY_BLOCKED:%''
   AND EXISTS(SELECT 1 FROM public.afe_agent_mission_dependencies d WHERE d.workspace_id=NEW.workspace_id AND d.mission_id=m.id AND d.depends_on_mission_id=NEW.id)
   AND NOT EXISTS(
    SELECT 1 FROM public.afe_agent_mission_dependencies d
    JOIN public.afe_agent_missions p ON p.id=d.depends_on_mission_id AND p.workspace_id=d.workspace_id
    WHERE d.workspace_id=NEW.workspace_id AND d.mission_id=m.id AND p.status<>''completed''
   );
 END IF;
 RETURN NEW;
END';
DROP TRIGGER IF EXISTS afe_agent_mission_dependents_status_gate ON public.afe_agent_missions;
CREATE TRIGGER afe_agent_mission_dependents_status_gate
 AFTER UPDATE OF status ON public.afe_agent_missions
 FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
 EXECUTE FUNCTION public.release_afe_agent_mission_dependents();

CREATE OR REPLACE FUNCTION public.renew_afe_agent_mission_lease(
 p_mission_id uuid,p_workspace_id uuid,p_lease_token uuid,p_lease_seconds integer DEFAULT 180
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS '
DECLARE v_count integer;
BEGIN
 IF p_mission_id IS NULL OR p_workspace_id IS NULL OR p_lease_token IS NULL OR p_lease_seconds<30 OR p_lease_seconds>600 THEN
  RAISE EXCEPTION ''invalid lease renewal arguments'';
 END IF;
 UPDATE public.afe_agent_missions SET lease_expires_at=now()+make_interval(secs=>p_lease_seconds),updated_at=now()
 WHERE id=p_mission_id AND workspace_id=p_workspace_id AND status=''running''
  AND lease_token=p_lease_token AND lease_expires_at>now();
 GET DIAGNOSTICS v_count=ROW_COUNT;
 RETURN v_count=1;
END';
REVOKE ALL ON FUNCTION public.renew_afe_agent_mission_lease(uuid,uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.renew_afe_agent_mission_lease(uuid,uuid,uuid,integer) TO service_role;
