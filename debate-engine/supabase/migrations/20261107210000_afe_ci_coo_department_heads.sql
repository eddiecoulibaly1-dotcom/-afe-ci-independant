-- Allow the COO to designate accountable human and agent leads for operational departments.
-- Independent arbitration and human validation remain protected by the server authorization layer.

ALTER TABLE public.afe_org_departments
  ADD COLUMN IF NOT EXISTS director_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS afe_org_departments_director_user_idx
  ON public.afe_org_departments(director_user_id) WHERE director_user_id IS NOT NULL;

COMMENT ON COLUMN public.afe_org_departments.director_user_id IS
  'Accountable human lead for an operational department; assignments are workspace-membership validated by the server.';
