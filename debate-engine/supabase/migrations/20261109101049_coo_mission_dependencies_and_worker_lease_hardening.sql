-- P1: enforce prerequisite completion, prevent dependency cycles and renew worker leases.
CREATE INDEX IF NOT EXISTS afe_agent_mission_dependencies_mission_idx ON public.afe_agent_mission_dependencies (workspace_id, mission_id);
CREATE INDEX IF NOT EXISTS afe_agent_mission_dependencies_prerequisite_idx ON public.afe_agent_mission_dependencies (workspace_id, depends_on_mission_id);
ALTER TABLE public.afe_agent_mission_dependencies DROP CONSTRAINT IF EXISTS afe_agent_mission_dependencies_no_self_check;
ALTER TABLE public.afe_agent_mission_dependencies ADD CONSTRAINT afe_agent_mission_dependencies_no_self_check CHECK (mission_id <> depends_on_mission_id);

CREATE OR REPLACE FUNCTION public.guard_afe_agent_mission_dependency_cycle()
RETURNS trigger LANGUAGE plpgsql AS $
DECLARE v_cycle boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.workspace_id::text,0));
 IF NEW.mission_id=NEW.depends_on_mission_id THEN RAISE EXCEPTION 'A mission cannot depend on itself'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.afe_agent_missions WHERE id=NEW.mission_id AND workspace_id=NEW.workspace_id)
 OR NOT EXISTS(SELECT 1 FROM public.afe_agent_missions WHERE id=NEW.depends_on_mission_id AND workspace_id=NEW.workspace_id) THEN
  RAISE EXCEPTION 'Dependency missions must belong to the same workspace';
 END IF;
 WITH RECURSIVE reachable(mission_id) AS (
  SELECT NEW.depends_on_mission_id
  UNION
  SELECT d.depends_on_mission_id FROM public.afe_agent_mission_dep¶»§q«^