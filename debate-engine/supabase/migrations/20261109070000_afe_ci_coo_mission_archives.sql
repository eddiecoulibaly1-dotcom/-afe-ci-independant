-- AFE-CI COO central mission archive
-- Additive only. The trigger snapshots completed missions; source records and files are never deleted.
-- Apply first in Preview/test. Production application requires separate approval.

CREATE SEQUENCE IF NOT EXISTS public.afe_coo_mission_archive_number_seq;

CREATE TABLE IF NOT EXISTS public.afe_coo_mission_archives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  mission_number text GENERATED ALWAYS AS ('MIS-' || lpad(archive_number::text, 8, '0')) STORED,
  workspace_id uuid NOT NULL REFERENCES public.debate_workspaces(id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  mission_title text NOT NULL,
  department_name text,
  agent_name text,
  archive_date date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  archived_at timestamptz NOT NULL DEFAULT now(),
  mission_snapshot jsonb NOT NULL CHECK (jsonb_typeof(mission_snapshot) = 'object'),
  tasks_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tasks_snapshot) = 'array'),
  related_missions_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(related_missions_snapshot) = 'array'),
  events_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(events_snapshot) = 'array'),
  document_count integer NOT NULL DEFAULT 0 CHECK (document_count >= 0),
  document_status text NOT NULL DEFAULT 'pending' CHECK (document_status IN ('pending','partial','complete')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, mission_id),
  UNIQUE (workspace_id, mission_number)
);

CREATE TABLE IF NOT EXISTS public.afe_coo_mission_archive_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.debate_workspaces(id) ON DELETE CASCADE,
  archive_id uuid NOT NULL,
  source_document_id uuid,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 180),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  storage_path text NOT NULL,
  source_storage_path text,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 50000000),
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source_created_at timestamptz,
  linked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (archive_id, workspace_id)
    REFERENCES public.afe_coo_mission_archives(id, workspace_id) ON DELETE CASCADE,
  UNIQUE (archive_id, source_document_id),
  UNIQUE (workspace_id, storage_path)
);

CREATE INDEX IF NOT EXISTS afe_coo_mission_archives_date_idx
  ON public.afe_coo_mission_archives(workspace_id, archive_date DESC, archive_number DESC);
CREATE INDEX IF NOT EXISTS afe_coo_mission_archive_documents_archive_idx
  ON public.afe_coo_mission_archive_documents(workspace_id, archive_id, linked_at DESC);
CREATE INDEX IF NOT EXISTS afe_coo_mission_archive_documents_source_idx
  ON public.afe_coo_mission_archive_documents(workspace_id, source_document_id)
  WHERE source_document_id IS NOT NULL;

ALTER TABLE public.afe_coo_mission_archives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.afe_coo_mission_archive_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.afe_coo_mission_archives, public.afe_coo_mission_archive_documents FROM anon, authenticated;
GRANT ALL ON TABLE public.afe_coo_mission_archives, public.afe_coo_mission_archive_documents TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.afe_coo_mission_archives_archive_number_seq TO service_role;

COMMENT ON TABLE public.afe_coo_mission_archives IS
  'Immutable workspace-scoped closure snapshot of a completed COO mission, indexed by generated mission number and UTC archive date.';
COMMENT ON TABLE public.afe_coo_mission_archive_documents IS
  'Private durable copies and immutable source metadata for documents attached to a COO mission archive.';

CREATE OR REPLACE FUNCTION public.afe_coo_archive_completed_mission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_department_name text;
  v_agent_name text;
  v_tasks jsonb;
  v_events jsonb;
BEGIN
  IF NEW.status IS DISTINCT FROM 'completed' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT d.name INTO v_department_name
  FROM public.afe_org_departments d
  WHERE d.id = NEW.department_id AND d.workspace_id = NEW.workspace_id
  LIMIT 1;

  SELECT a.name INTO v_agent_name
  FROM public.afe_agents a
  WHERE a.id = NEW.agent_id AND a.workspace_id = NEW.workspace_id
  LIMIT 1;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at, t.id), '[]'::jsonb)
  INTO v_tasks
  FROM public.afe_operational_tasks t
  WHERE t.workspace_id = NEW.workspace_id AND t.mission_id = NEW.id;

  SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.created_at, e.id), '[]'::jsonb)
  INTO v_events
  FROM public.afe_agent_events e
  WHERE e.workspace_id = NEW.workspace_id AND e.mission_id = NEW.id;

  INSERT INTO public.afe_coo_mission_archives (
    workspace_id, mission_id, mission_title, department_name, agent_name,
    archive_date, archived_at, mission_snapshot, tasks_snapshot, events_snapshot
  ) VALUES (
    NEW.workspace_id, NEW.id, NEW.title, v_department_name, v_agent_name,
    (now() AT TIME ZONE 'UTC')::date, now(), to_jsonb(NEW),
    COALESCE(v_tasks, '[]'::jsonb), COALESCE(v_events, '[]'::jsonb)
  )
  ON CONFLICT (workspace_id, mission_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS afe_agent_missions_archive_completed ON public.afe_agent_missions;
CREATE TRIGGER afe_agent_missions_archive_completed
AFTER INSERT OR UPDATE OF status ON public.afe_agent_missions
FOR EACH ROW
WHEN (NEW.status = 'completed')
EXECUTE FUNCTION public.afe_coo_archive_completed_mission();

-- Backfill all missions already marked completed at migration time. Idempotent and non-destructive.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT m.*
    FROM public.afe_agent_missions m
    WHERE m.status = 'completed'
      AND NOT EXISTS (
        SELECT 1 FROM public.afe_coo_mission_archives a
        WHERE a.workspace_id = m.workspace_id AND a.mission_id = m.id
      )
    ORDER BY COALESCE(m.updated_at, m.created_at), m.id
  LOOP
    PERFORM public.afe_coo_archive_completed_mission_backfill(r);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.afe_coo_archive_completed_mission_backfill(p_mission public.afe_agent_missions)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_department_name text;
  v_agent_name text;
  v_tasks jsonb;
  v_events jsonb;
BEGIN
  SELECT d.name INTO v_department_name FROM public.afe_org_departments d
    WHERE d.id = p_mission.department_id AND d.workspace_id = p_mission.workspace_id LIMIT 1;
  SELECT a.name INTO v_agent_name FROM public.afe_agents a
    WHERE a.id = p_mission.agent_id AND a.workspace_id = p_mission.workspace_id LIMIT 1;
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at, t.id), '[]'::jsonb) INTO v_tasks
    FROM public.afe_operational_tasks t WHERE t.workspace_id = p_mission.workspace_id AND t.mission_id = p_mission.id;
  SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.created_at, e.id), '[]'::jsonb) INTO v_events
    FROM public.afe_agent_events e WHERE e.workspace_id = p_mission.workspace_id AND e.mission_id = p_mission.id;
  INSERT INTO public.afe_coo_mission_archives (
    workspace_id, mission_id, mission_title, department_name, agent_name,
    archive_date, archived_at, mission_snapshot, tasks_snapshot, events_snapshot
  ) VALUES (
    p_mission.workspace_id, p_mission.id, p_mission.title, v_department_name, v_agent_name,
    (COALESCE(p_mission.updated_at, p_mission.created_at, now()) AT TIME ZONE 'UTC')::date,
    COALESCE(p_mission.updated_at, p_mission.created_at, now()), to_jsonb(p_mission),
    COALESCE(v_tasks, '[]'::jsonb), COALESCE(v_events, '[]'::jsonb)
  )
  ON CONFLICT (workspace_id, mission_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.afe_coo_archive_completed_mission() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.afe_coo_archive_completed_mission_backfill(public.afe_agent_missions) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.afe_coo_archive_completed_mission() TO service_role;
GRANT EXECUTE ON FUNCTION public.afe_coo_archive_completed_mission_backfill(public.afe_agent_missions) TO service_role;
