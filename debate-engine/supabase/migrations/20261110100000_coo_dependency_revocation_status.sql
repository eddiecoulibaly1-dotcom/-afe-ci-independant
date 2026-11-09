-- Explicitly support revocation as a distinct, auditable terminal decision.
ALTER TABLE public.afe_coo_dependency_edges
  DROP CONSTRAINT IF EXISTS afe_coo_dependency_edges_status_check;

ALTER TABLE public.afe_coo_dependency_edges
  ADD CONSTRAINT afe_coo_dependency_edges_status_check
  CHECK (status = ANY (ARRAY['pending_dg','active','satisfied','rejected','blocked','revoked']::text[]));
