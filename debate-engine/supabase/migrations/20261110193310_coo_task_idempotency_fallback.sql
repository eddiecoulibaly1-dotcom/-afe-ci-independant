-- Backfill-safe fallback for task inserts that omit idempotency_key.
-- Mission-linked tasks use a deterministic key; standalone manual tasks receive a unique key.
CREATE OR REPLACE FUNCTION public.set_afe_operational_task_idempotency_key()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.idempotency_key IS NULL OR btrim(NEW.idempotency_key) = '' THEN
    IF NEW.mission_id IS NOT NULL THEN
      NEW.idempotency_key := NEW.mission_id::text || ':' || md5(lower(btrim(NEW.title)));
    ELSE
      NEW.idempotency_key := 'manual:' || gen_random_uuid()::text;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS afe_operational_tasks_set_idempotency_key
  ON public.afe_operational_tasks;

CREATE TRIGGER afe_operational_tasks_set_idempotency_key
BEFORE INSERT ON public.afe_operational_tasks
FOR EACH ROW
EXECUTE FUNCTION public.set_afe_operational_task_idempotency_key();

REVOKE ALL ON FUNCTION public.set_afe_operational_task_idempotency_key() FROM public, anon, authenticated;

COMMENT ON FUNCTION public.set_afe_operational_task_idempotency_key() IS
  'Ensures task inserts remain compatible with callers that omit idempotency_key; mission-linked keys are deterministic.';
NOTIFY pgrst, 'reload schema';
