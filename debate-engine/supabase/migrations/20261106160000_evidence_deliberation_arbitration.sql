-- AFE-CI Evidence, deliberation and arbitration persistence.
-- Apply ONLY to isolated development/test Supabase after SQL review.
-- No Production migration is authorized by this file.
CREATE TABLE IF NOT EXISTS public.afe_evidence_artifacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES public.debate_workspaces(id) ON DELETE CASCADE,
 deliberation_id uuid,
 source_kind text NOT NULL CHECK(source_kind IN ('github_file','github_commit','migration','test_result','ci_run','preview_log')),
 source_uri text NOT NULL CHECK(length(source_uri)<=2048),
 repository text NOT NULL,
 source_ref text NOT NULL,
 commit_sha text NOT NULL CHECK(commit_sha ~ '^[0-9a-f]{40}$'),
 source_path text,
 line_start integer CHECK(line_start IS NULL OR line_start>0),
 line_end integer CHECK(line_end IS NULL OR line_end>=line_start),
 content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'),
 collector_version text NOT NULL,
 access_mode text NOT NULL DEFAULT 'read_only' CHECK(access_mode='read_only'),
 verification text NOT NULL CHECK(verification IN ('verified','partial','unverified')),
 excerpt text CHECK(excerpt IS NULL OR length(excerpt)<=12000),
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(metadata)='object'),
 collected_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,content_sha256,repository,commit_sha,source_path,line_start,line_end)
);
CREATE TABLE IF NOT EXISTS public.afe_deliberations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES public.debate_workspaces(id) ON DELETE CASCADE,
 mission_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','arbitrating','completed','cancelled')),
 current_round integer NOT NULL DEFAULT 1 CHECK(current_round BETWEEN 1 AND 8),
 max_rounds integer NOT NULL DEFAULT 5 CHECK(max_rounds BETWEEN 1 AND 8),
 max_contributions integer NOT NULL DEFAULT 24 CHECK(max_contributions BETWEEN 2 AND 64),
 created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(mission_id,workspace_id) REFERENCES public.afe_agent_missions(id,workspace_id) ON DELETE CASCADE,
 UNIQUE(id,workspace_id)
);
ALTER TABLE public.afe_evidence_artifacts ADD CONSTRAINT afe_evidence_deliberation_fk
 FOREIGN KEY(deliberation_id,workspace_id) REFERENCES public.afe_deliberations(id,workspace_id) ON DELETE CASCADE;
CREATE TABLE IF NOT EXISTS public.afe_deliberation_contributions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL,
 deliberation_id uuid NOT NULL,
 round_no integer NOT NULL CHECK(round_no BETWEEN 1 AND 8),
 agent_id uuid NOT NULL,
 contribution_type text NOT NULL CHECK(contribution_type IN ('position','objection','rebuttal','evidence_review','revision')),
 body text NOT NULL CHECK(length(btrim(body)) BETWEEN 10 AND 20000),
 evidence_ids uuid[] NOT NULL DEFAULT '{}',
 responds_to uuid REFERENCES public.afe_deliberation_contributions(id) ON DELETE RESTRICT,
 idempotency_key text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(deliberation_id,workspace_id) REFERENCES public.afe_deliberations(id,workspace_id) ON DELETE CASCADE,
 FOREIGN KEY(agent_id,workspace_id) REFERENCES public.afe_agents(id,workspace_id) ON DELETE CASCADE,
 UNIQUE(deliberation_id,idempotency_key),
 UNIQUE(id,deliberation_id,workspace_id),
 FOREIGN KEY(responds_to,deliberation_id,workspace_id) REFERENCES public.afe_deliberation_contributions(id,deliberation_id,workspace_id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS public.afe_arbitration_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL,
 deliberation_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','human_review_required','approved','rejected')),
 decisions jsonb NOT NULL CHECK(jsonb_typeof(decisions)='array'),
 unresolved_disagreements jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(unresolved_disagreements)='array'),
 limitations jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(limitations)='array'),
 human_approval_required boolean NOT NULL DEFAULT true CHECK(human_approval_required),
 approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(deliberation_id,workspace_id) REFERENCES public.afe_deliberations(id,workspace_id) ON DELETE CASCADE,
 UNIQUE(deliberation_id)
);
CREATE INDEX IF NOT EXISTS afe_evidence_workspace_idx ON public.afe_evidence_artifacts(workspace_id,collected_at DESC);
CREATE INDEX IF NOT EXISTS afe_deliberations_mission_idx ON public.afe_deliberations(mission_id,created_at DESC);
CREATE INDEX IF NOT EXISTS afe_contributions_round_idx ON public.afe_deliberation_contributions(deliberation_id,round_no,created_at);
CREATE INDEX IF NOT EXISTS afe_arbitration_workspace_idx ON public.afe_arbitration_reports(workspace_id,status,created_at DESC);
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['afe_evidence_artifacts','afe_deliberations','afe_deliberation_contributions','afe_arbitration_reports'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated',t);
  EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role',t);
 END LOOP;
END $$;
-- Immutable evidence: corrections create a new artifact; no UPDATE/DELETE path.
CREATE OR REPLACE FUNCTION public.afe_reject_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $
BEGIN RAISE EXCEPTION 'Evidence artifacts are immutable; create a new artifact.'; END $$;
DROP TRIGGER IF EXISTS afe_evidence_immutable ON public.afe_evidence_artifacts;
CREATE TRIGGER afe_evidence_immutable BEFORE UPDATE OR DELETE ON public.afe_evidence_artifacts
 FOR EACH ROW EXECUTE FUNCTION public.afe_reject_evidence_mutation();
REVOKE ALL ON FUNCTION public.afe_reject_evidence_mutation() FROM PUBLIC, anon, authenticated;
