-- AFE-CI COO AI orchestration engine
-- Additive, workspace-scoped. Test/Preview only; Production requires separate approval.

ALTER TABLE public.afe_coo_settings
  ADD COLUMN IF NOT EXISTS coo_agent_id uuid,
  ADD COLUMN IF NOT EXISTS coo_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS coo_autonomy_level smallint NOT NULL DEFAULT 1
    CHECK (coo_autonomy_level BETWEEN 1 AND 3),
  ADD COLUMN IF NOT EXISTS coo_kill_switch boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS coo_max_workstreams smallint NOT NULL DEFAULT 6
    CHECK (coo_max_workstreams BETWEEN 1 AND 8),
  ADD COLUMN IF NOT EXISTS coo_max_tasks_per_workstream smallint NOT NULL DEFAULT 5
    CHECK (coo_max_tasks_per_workstream BETWEEN 1 AND 8);

ALTER TABLE public.afe_coo_settings
  DROP CONSTRAINT IF EXISTS afe_coo_settings_agent_workspace_fk;
ALTER TABLE public.afe_coo_settings
  ADD CONSTRAINT afe_coo_settings_agent_workspace_fk
  FOREIGN KEY (coo_agent_id, workspace_id)
  REFERENCES public.afe_agents(id, workspace_id)
  ON DELETE SET NULL (coo_agent_id);

CREATE TABLE IF NOT EXISTS public.afe_coo_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.debate_workspaces(id) ON DELETE CASCADE,
  coo_agent_id uuid NOT NULL,
  initiated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  instruction text NOT NULL CHECK (length(btrim(instruction)) BETWEEN 10 AND 12000),
  status text NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning','dispatched','partial','failed','approval_required','cancelled')),
  idempotency_key text NOT NULL,
  plan jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(plan) = 'object'),
  missions_created smallint NOT NULL DEFAULT 0 CHECK (missions_created BETWEEN 0 AND 64),
  error_message text CHECK (error_message IS NULL OR length(error_message) <= 3000),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  UNIQUE (workspace_id, idempotency_key),
  FOREIGN KEY (coo_agent_id, workspace_id)
    REFERENCES public.afe_agents(id, workspace_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS afe_coo_runs_workspace_status_idx
  ON public.afe_coo_runs(workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS afe_coo_runs_agent_idx
  ON public.afe_coo_runs(coo_agent_id, created_at DESC);

ALTER TABLE public.afe_coo_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.afe_coo_runs FROM anon, authenticated;
GRANT ALL ON TABLE public.afe_coo_runs TO service_role;

COMMENT ON TABLE public.afe_coo_runs IS
  'Auditable COO AI orchestration requests and validated plans; mission execution remains in the existing durable agent queue.';
COMMENT ON COLUMN public.afe_coo_settings.coo_autonomy_level IS
  'COO autonomy level: 1 observe/propose, 2 execute reversible workspace-scoped operations, 3 delegated execution requiring separate governance approval.';
COMMENT ON COLUMN public.afe_coo_settings.coo_kill_switch IS
  'Emergency stop for new COO orchestration runs; does not erase or silently cancel already dispatched missions.';
