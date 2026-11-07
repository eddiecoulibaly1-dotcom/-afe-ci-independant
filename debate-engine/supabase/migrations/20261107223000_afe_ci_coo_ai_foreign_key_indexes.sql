-- Covering indexes for the new COO AI foreign keys.
CREATE INDEX IF NOT EXISTS afe_coo_runs_coo_agent_workspace_idx
  ON public.afe_coo_runs(coo_agent_id, workspace_id);
CREATE INDEX IF NOT EXISTS afe_coo_runs_initiated_by_idx
  ON public.afe_coo_runs(initiated_by);
CREATE INDEX IF NOT EXISTS afe_coo_settings_coo_agent_workspace_idx
  ON public.afe_coo_settings(coo_agent_id, workspace_id);
