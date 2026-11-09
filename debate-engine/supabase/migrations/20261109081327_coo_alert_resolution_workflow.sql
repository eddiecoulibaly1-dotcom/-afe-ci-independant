-- Durable, verifiable COO alert-resolution workflow.
-- Service-only: all reads and writes pass through authenticated workspace-scoped API routes.

ALTER TABLE public.afe_coo_alerts
  ADD COLUMN IF NOT EXISTS workflow_status text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS diagnosis text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS corrective_action text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS evidence_reference text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS resolution_summary text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS verification_note text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS reopen_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reopened_at timestamptz;

UPDATE public.afe_coo_alerts
SET workflow_status = CASE
  WHEN status = 'resolved' THEN 'resolved'
  WHEN status = 'acknowledged' THEN 'assigned'
  ELSE 'new'
END,
assigned_to = COALESCE(assigned_to, acknowledged_by),
assigned_at = COALESCE(assigned_at, acknowledged_at)
WHERE workflow_status = 'new';

ALTER TABLE public.afe_coo_alerts
  DROP CONSTRAINT IF EXISTS afe_coo_alerts_workflow_status_check;
ALTER TABLE public.afe_coo_alerts
  ADD CONSTRAINT afe_coo_alerts_workflow_status_check
  CHECK (workflow_status IN ('new','assigned','diagnosing','in_progress','pending_verification','resolved','reopened'));

ALTER TABLE public.afe_coo_alerts
  DROP CONSTRAINT IF EXISTS afe_coo_alerts_reopen_count_check;
ALTER TABLE public.afe_coo_alerts
  ADD CONSTRAINT afe_coo_alerts_reopen_count_check CHECK (reopen_count >= 0);

CREATE INDEX IF NOT EXISTS afe_coo_alerts_workflow_queue_idx
  ON public.afe_coo_alerts (workspace_id, workflow_status, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS afe_coo_alerts_assigned_to_idx
  ON public.afe_coo_alerts (assigned_to, workspace_id)
  WHERE assigned_to IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.afe_coo_alert_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.debate_workspaces(id) ON DELETE CASCADE,
  alert_id uuid NOT NULL REFERENCES public.afe_coo_alerts(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (length(event_type) BETWEEN 3 AND 80),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS afe_coo_alert_events_history_idx
  ON public.afe_coo_alert_events (workspace_id, alert_id, created_at DESC);

ALTER TABLE public.afe_coo_alert_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.afe_coo_alert_events FROM anon, authenticated;
GRANT ALL ON TABLE public.afe_coo_alert_events TO service_role;

COMMENT ON TABLE public.afe_coo_alert_events IS
  'Append-only audit trail for COO alert diagnosis, assignment, remediation, evidence, verification and reopening. Access only through server-side workspace authorization.';
