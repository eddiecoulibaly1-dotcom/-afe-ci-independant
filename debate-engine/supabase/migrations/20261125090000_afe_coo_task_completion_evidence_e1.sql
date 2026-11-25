ALTER TABLE public.afe_operational_tasks
  ADD COLUMN IF NOT EXISTS completion_evidence jsonb,
  ADD COLUMN IF NOT EXISTS completion_exception_reason text;

COMMENT ON COLUMN public.afe_operational_tasks.completion_evidence IS
  'Structured completion evidence submitted when a COO task is marked done.';
COMMENT ON COLUMN public.afe_operational_tasks.completion_exception_reason IS
  'Documented exception explaining why standard completion evidence is not applicable.';
