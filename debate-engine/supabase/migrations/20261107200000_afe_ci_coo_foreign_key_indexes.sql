-- Cover the new and extended COO control-plane foreign keys.
-- Additive indexes only; safe for the isolated test project.

CREATE INDEX IF NOT EXISTS afe_org_departments_created_by_idx
  ON public.afe_org_departments(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS afe_org_departments_director_agent_idx
  ON public.afe_org_departments(director_agent_id, workspace_id) WHERE director_agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS afe_agents_created_by_idx
  ON public.afe_agents(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS afe_agents_department_workspace_idx
  ON public.afe_agents(department_id, workspace_id) WHERE department_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS afe_agent_missions_agent_workspace_idx
  ON public.afe_agent_missions(agent_id, workspace_id);
CREATE INDEX IF NOT EXISTS afe_agent_missions_created_by_idx
  ON public.afe_agent_missions(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS afe_agent_missions_department_workspace_idx
  ON public.afe_agent_missions(department_id, workspace_id) WHERE department_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS afe_agent_missions_operational_owner_idx
  ON public.afe_agent_missions(operational_owner_user_id) WHERE operational_owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS afe_agent_missions_parent_workspace_idx
  ON public.afe_agent_missions(parent_mission_id, workspace_id) WHERE parent_mission_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS afe_operational_tasks_mission_workspace_idx
  ON public.afe_operational_tasks(mission_id, workspace_id) WHERE mission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS afe_operational_tasks_department_workspace_idx
  ON public.afe_operational_tasks(department_id, workspace_id);
CREATE INDEX IF NOT EXISTS afe_operational_tasks_assigned_agent_workspace_idx
  ON public.afe_operational_tasks(assigned_agent_id, workspace_id) WHERE assigned_agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS afe_operational_tasks_assigned_user_idx
  ON public.afe_operational_tasks(assigned_user_id) WHERE assigned_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS afe_operational_tasks_created_by_idx
  ON public.afe_operational_tasks(created_by) WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS afe_coo_alerts_mission_workspace_idx
  ON public.afe_coo_alerts(mission_id, workspace_id) WHERE mission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS afe_coo_alerts_task_workspace_idx
  ON public.afe_coo_alerts(task_id, workspace_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS afe_coo_alerts_acknowledged_by_idx
  ON public.afe_coo_alerts(acknowledged_by) WHERE acknowledged_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS afe_coo_alerts_resolved_by_idx
  ON public.afe_coo_alerts(resolved_by) WHERE resolved_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS afe_coo_reports_generated_by_idx
  ON public.afe_coo_reports(generated_by) WHERE generated_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS afe_coo_settings_coo_user_idx
  ON public.afe_coo_settings(coo_user_id) WHERE coo_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS afe_coo_settings_dg_user_idx
  ON public.afe_coo_settings(dg_user_id) WHERE dg_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS afe_coo_settings_created_by_idx
  ON public.afe_coo_settings(created_by) WHERE created_by IS NOT NULL;
