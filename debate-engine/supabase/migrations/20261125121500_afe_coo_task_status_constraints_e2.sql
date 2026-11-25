-- E2: database-level task status invariants, enforced for all new and changed rows.
-- NOT VALID avoids rejecting legacy rows immediately; PostgreSQL enforces the constraints on new writes.
ALTER TABLE public.afe_operational_tasks
  ADD CONSTRAINT afe_coo_task_done_invariant
  CHECK (
    status <> 'done'
    OR (
      progress_percent = 100
      AND completed_at IS NOT NULL
      AND blocked_reason IS NULL
      AND (completion_evidence IS NOT NULL OR completion_exception_reason IS NOT NULL)
    )
  ) NOT VALID;

ALTER TABLE public.afe_operational_tasks
  ADD CONSTRAINT afe_coo_task_blocked_invariant
  CHECK (
    status <> 'blocked'
    OR (
      completed_at IS NULL
      AND progress_percent < 100
      AND NULLIF(btrim(blocked_reason), '') IS NOT NULL
    )
  ) NOT VALID;

ALTER TABLE public.afe_operational_tasks
  ADD CONSTRAINT afe_coo_task_open_state_invariant
  CHECK (
    status NOT IN ('todo', 'in_progress', 'cancelled')
    OR (completed_at IS NULL AND blocked_reason IS NULL)
  ) NOT VALID;
