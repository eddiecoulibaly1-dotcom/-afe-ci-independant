-- P1: durable worker heartbeat history, including idle cron ticks.
CREATE TABLE IF NOT EXISTS public.afe_coo_worker_ticks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_key text NOT NULL CHECK (length(worker_key) BETWEEN 3 AND 120),
  environment text NOT NULL DEFAULT 'unknown' CHECK (length(environment) BETWEEN 1 AND 40),
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','idle','awaiting_validation','paused','retry_scheduled','failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  mission_id uuid REFERENCES public.afe_agent_missions(id) ON DELETE SET NULL,
  reaped_count integer NOT NULL DEFAULT 0 CHECK (reaped_count >= 0),
  dispatched_count integer NOT NULL DEFAULT 0 CHECK (dispatched_count >= 0),
  error_message text,
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS afe_coo_worker_ticks_latest_idx
  ON public.afe_coo_worker_ticks (environment, worker_key, started_at DESC);
CREATE INDEX IF NOT EXISTS afe_coo_worker_ticks_mission_idx
  ON public.afe_coo_worker_ticks (mission_id, started_at DESC)
  WHERE mission_id IS NOT NULL;
ALTER TABLE public.afe_coo_worker_ticks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.afe_coo_worker_ticks FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.afe_coo_worker_ticks TO service_role;
COMMENT ON TABLE public.afe_coo_worker_ticks IS
  'Server-only worker execution heartbeats, including idle cron invocations, lease renewals, outcomes and bounded recovery metadata.';
