-- E13 runtime reliability: make mission deliverable/review event writes retry-safe.
-- Apply only after the target TEST/Preview database is positively isolated from Production.
ALTER TABLE public.afe_agent_events
  ADD COLUMN IF NOT EXISTS idempotency_key text;

-- NULL keys remain allowed for legacy event producers; keyed events are unique per workspace.
CREATE UNIQUE INDEX IF NOT EXISTS afe_agent_events_workspace_idempotency_key_uq
  ON public.afe_agent_events(workspace_id, idempotency_key);
