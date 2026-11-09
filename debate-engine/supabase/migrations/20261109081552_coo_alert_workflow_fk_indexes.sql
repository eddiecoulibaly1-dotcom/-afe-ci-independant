-- Cover the remaining foreign keys introduced by the alert workflow.
CREATE INDEX IF NOT EXISTS afe_coo_alerts_verified_by_idx
  ON public.afe_coo_alerts (verified_by)
  WHERE verified_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS afe_coo_alert_events_alert_id_idx
  ON public.afe_coo_alert_events (alert_id);
CREATE INDEX IF NOT EXISTS afe_coo_alert_events_actor_id_idx
  ON public.afe_coo_alert_events (actor_id)
  WHERE actor_id IS NOT NULL;
