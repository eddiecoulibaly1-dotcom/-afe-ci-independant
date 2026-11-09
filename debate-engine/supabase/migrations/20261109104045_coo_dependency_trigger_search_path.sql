-- Pin search_path on trigger functions used by mission dependency gates.
ALTER FUNCTION public.guard_afe_agent_mission_dependency_cycle() SET search_path = public;
ALTER FUNCTION public.sync_afe_agent_mission_dependency_gate() SET search_path = public;
ALTER FUNCTION public.release_afe_agent_mission_dependents() SET search_path = public;
