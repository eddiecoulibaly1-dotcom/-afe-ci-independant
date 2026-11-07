-- AFE-CI COO Operations Control Plane
-- Additive, workspace-scoped, server-mediated schema. Preview/test only.
-- Do not apply to Production without a separately approved migration.

CREATE TABLE IF NOT EXISTS public.afe_org_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.debate_workspaces(id) ON DELETE CASCADE,
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 140),
  mandate text NOT NULL DEFAULT '' CHECK (length(mandate) <= 12000),
  department_kind text NOT NULL DEFAULT 'operational'
    CHECK (department_kind IN ('executive','operational','control','independent','human_authority','support')),
  reports_to_slug text,
  is_independent boolean NOT NULL DEFAULT false,
  human_only boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  director_agent_id uuid,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug),
  UNIQUE (id, workspace_id),
  CHECK (NOT (is_independent AND reports_to_slug IS NOT NULL)),
  CHECK (NOT (human_only AND director_agent_id IS NOT NULL))
);

ALTER TABLE public.afe_agents
  ADD COLUMN IF NOT EXISTS department_id uuid;

ALTER TABLE public.afe_agents
  DROP CONSTRAINT IF EXISTS afe_agents_department_workspace_fk;
ALTER TABLE public.afe_agents
  ADD CONSTRAINT afe_agents_department_workspace_fk
  FOREIGN KEY (department_id, workspace_id)
  REFERENCES public.afe_org_departments(id, workspace_id)
  ON DELETE SET NULL (department_id);

ALTER TABLE public.afe_org_departments
  DROP CONSTRAINT IF EXISTS afe_org_departments_director_agent_fk;
ALTER TABLE public.afe_org_departments
  ADD CONSTRAINT afe_org_departments_director_agent_fk
  FOREIGN KEY (director_agent_id, workspace_id)
  REFERENCES public.afe_agents(id, workspace_id)
  ON DELETE SET NULL (director_agent_id);

ALTER TABLE public.afe_agent_missions
  ADD COLUMN IF NOT EXISTS department_id uuid,
  ADD COLUMN IF NOT EXISTS operational_owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS progress_percent smallint NOT NULL DEFAULT 0
    CHECK (progress_percent BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS blocked_reason text CHECK (blocked_reason IS NULL OR length(blocked_reason) <= 3000);

ALTER TABLE public.afe_agent_missions
  DROP CONSTRAINT IF EXISTS afe_agent_missions_department_workspace_fk;
ALTER TABLE public.afe_agent_missions
  ADD CONSTRAINT afe_agent_missions_department_workspace_fk
  FOREIGN KEY (department_id, workspace_id)
  REFERENCES public.afe_org_departments(id, workspace_id)
  ON DELETE SET NULL (department_id);

CREATE TABLE IF NOT EXISTS public.afe_operational_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.debate_workspaces(id) ON DELETE CASCADE,
  mission_id uuid,
  department_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 220),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 6000),
  status text NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo','in_progress','blocked','done','cancelled')),
  priority smallint NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  progress_percent smallint NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  assigned_agent_id uuid,
  assigned_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  due_at timestamptz,
  blocked_reason text CHECK (blocked_reason IS NULL OR length(blocked_reason) <= 3000),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (mission_id, workspace_id)
    REFERENCES public.afe_agent_missions(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (department_id, workspace_id)
    REFERENCES public.afe_org_departments(id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (assigned_agent_id, workspace_id)
    REFERENCES public.afe_agents(id, workspace_id) ON DELETE SET NULL (assigned_agent_id)
);

CREATE TABLE IF NOT EXISTS public.afe_coo_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.debate_workspaces(id) ON DELETE CASCADE,
  mission_id uuid,
  task_id uuid REFERENCES public.afe_operational_tasks(id) ON DELETE SET NULL,
  alert_type text NOT NULL CHECK (length(alert_type) BETWEEN 2 AND 80),
  severity text NOT NULL CHECK (severity IN ('info','warning','critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  dedupe_key text NOT NULL CHECK (length(dedupe_key) BETWEEN 3 AND 220),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 220),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
  acknowledged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  acknowledged_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (mission_id, workspace_id)
    REFERENCES public.afe_agent_missions(id, workspace_id) ON DELETE CASCADE,
  UNIQUE (workspace_id, dedupe_key)
);

CREATE TABLE IF NOT EXISTS public.afe_coo_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.debate_workspaces(id) ON DELETE CASCADE,
  report_type text NOT NULL CHECK (report_type IN ('daily','weekly','ad_hoc')),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'generated' CHECK (status IN ('generated','sent','failed')),
  idempotency_key text NOT NULL,
  report_content jsonb NOT NULL CHECK (jsonb_typeof(report_content) = 'object'),
  generated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (workspace_id, idempotency_key),
  CHECK (period_end >= period_start)
);

CREATE TABLE IF NOT EXISTS public.afe_coo_settings (
  workspace_id uuid PRIMARY KEY REFERENCES public.debate_workspaces(id) ON DELETE CASCADE,
  coo_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  dg_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  daily_report_enabled boolean NOT NULL DEFAULT true,
  report_hour_utc smallint NOT NULL DEFAULT 8 CHECK (report_hour_utc BETWEEN 0 AND 23),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS afe_org_departments_workspace_idx
  ON public.afe_org_departments(workspace_id, active, department_kind);
CREATE INDEX IF NOT EXISTS afe_agent_missions_department_idx
  ON public.afe_agent_missions(workspace_id, department_id, status, due_at);
CREATE INDEX IF NOT EXISTS afe_operational_tasks_department_idx
  ON public.afe_operational_tasks(workspace_id, department_id, status, due_at);
CREATE INDEX IF NOT EXISTS afe_operational_tasks_assignee_idx
  ON public.afe_operational_tasks(workspace_id, assigned_user_id, status);
CREATE INDEX IF NOT EXISTS afe_coo_alerts_inbox_idx
  ON public.afe_coo_alerts(workspace_id, status, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS afe_coo_reports_period_idx
  ON public.afe_coo_reports(workspace_id, report_type, period_end DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'afe_org_departments','afe_operational_tasks','afe_coo_alerts',
    'afe_coo_reports','afe_coo_settings'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
  END LOOP;
END $$;

REVOKE ALL ON TABLE public.afe_agents, public.afe_agent_missions FROM anon, authenticated;
GRANT ALL ON TABLE public.afe_agents, public.afe_agent_missions TO service_role;

COMMENT ON TABLE public.afe_org_departments IS 'Workspace-scoped institutional departments and reporting lines; managed by the server control plane.';
COMMENT ON TABLE public.afe_operational_tasks IS 'COO-managed tasks assigned to an operational department, agent and/or workspace member.';
COMMENT ON TABLE public.afe_coo_alerts IS 'Deduplicated operational alerts requiring acknowledgement or resolution.';
COMMENT ON TABLE public.afe_coo_reports IS 'Immutable snapshots of daily/weekly/ad-hoc operational reporting to executive governance.';
COMMENT ON TABLE public.afe_coo_settings IS 'Workspace COO designation and automatic Directorate General reporting preferences.';
