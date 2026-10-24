-- AFE-CI Debate Engine V1.0.6
-- Realtime uses Postgres Changes as a refresh signal; Postgres remains the source of truth.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.debate_share_links;
ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_audit_log;

ALTER TABLE public.notifications REPLICA IDENTITY FULL;
ALTER TABLE public.debate_share_links REPLICA IDENTITY FULL;
ALTER TABLE public.admin_audit_log REPLICA IDENTITY FULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debate_share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
