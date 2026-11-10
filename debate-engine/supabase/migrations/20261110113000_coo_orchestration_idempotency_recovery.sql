-- COO orchestration recovery and task-level idempotency.
-- Additive and safe: refuse to proceed if existing duplicate mission tasks need reconciliation.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.afe_operational_tasks
    WHERE mission_id IS NOT NULL
    GROUP BY workspace_id, mission_id, lower(btrim(title))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'COO task idempotency migration blocked: duplicate mission tasks exist; reconcile them before applying this migration';
  END IF;
END;
$$;

ALTER TABLE public.afe_operational_tasks
  ADD COLUMN IF NOT EXISTS idempotency_key text;

UPDATE public.afe_operational_tasks
SET idempotency_key = CASE
  WHEN mission_id IS NOT NULL
    THEN mission_id::text || ':' || md5(lower(btrim(title)))
  ELSE 'legacy:' || id::text
END
WHERE idempotency_key IS NULL;

ALTER TABLE public.afe_operational_tasks
  ALTER COLUMN idempotency_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS afe_operational_tasks_workspace_idempotency_uidx
  ON public.afe_operational_tasks(workspace_id, idempotency_key);

-- A partial run is recoverable; terminal statuses remain immutable to replays.
ALTER TABLE public.afe_coo_runs
  DROP CONSTRAINT IF EXISTS afe_coo_runs_status_check;

ALTER TABLE public.afe_coo_runs
  ADD CONSTRAINT afe_coo_runs_status_check
  CHECK (status IN ('planning','dispatched','partial','failed','approval_required','cancelled'));

COMMENT ON COLUMN public.afe_operational_tasks.idempotency_key IS
  'Stable workspace-scoped idempotency key. COO-created tasks derive it from mission ID and normalized title.';
NOTIFY pgrst, 'reload schema';
