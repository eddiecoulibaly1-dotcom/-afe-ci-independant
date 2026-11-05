-- AFE-CI Autonomous Organization V1 — P0 security and persistence foundation.
-- Apply only to the isolated afe-ci-test Supabase project until acceptance.
-- All agent data is server-mediated; browser roles receive no direct table privileges.

CREATE TABLE IF NOT EXISTS public.afe_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.debate_workspaces(id) ON DELETE CASCADE,
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  specialty text NOT NULL CHECK (length(btrim(specialty)) BETWEEN 2 AND 160),
  mandate text NOT NULL CHECK (length(btrim(mandate)) BETWEEN 10 AND 12000),
  system_instructions text NOT NULL DEFAULT '' CHECK (length(system_instructions) <= 30000),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','archived')),
  autonomy_level smallint NOT NULL DEFAULT 1 CHECK (autonomy_level BETWEEN 1 AND 3),
  model_provider text CHECK (model_provider IN ('openai','gemini','gateway')),
  model_id text CHECK (model_id IS NULL OR length(model_id) <= 160),
  config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug),
  UNIQUE (id, workspace_id)
);

CREATE TABLE IF NOT EXISTS public.afe_agent_tool_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  tool_key text NOT NULL CHECK (tool_key ~ '^[a-z][a-z0-9_.-]{2,100}$'),
  permission text NOT NULL CHECK (permission IN ('read','write','execute')),
  approval_required boolean NOT NULL DEFAULT true,
  limits jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(limits) = 'object'),
  enabled boolean NOT NULL DEFAULT false,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agent_id, workspace_id) REFERENCES public.afe_agents(id, workspace_id) ON DELETE CASCADE,
  UNIQUE (agent_id, tool_key)
);

CREATE TABLE IF NOT EXISTS public.afe_agent_missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.debate_workspaces(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 240),
  objective text NOT NULL CHECK (length(btrim(objective)) BETWEEN 10 AND 20000),
  input_context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(input_context) = 'object'),
  priority smallint NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  autonomy_level smallint NOT NULL DEFAULT 1 CHECK (autonomy_level BETWEEN 1 AND 3),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','planning','running','waiting_approval','paused','completed','failed','cancelled')),
  idempotency_key text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  run_after timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  result jsonb CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  failure_code text,
  failure_message text CHECK (failure_message IS NULL OR length(failure_message) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agent_id, workspace_id) REFERENCES public.afe_agents(id, workspace_id) ON DELETE CASCADE,
  UNIQUE (workspace_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.afe_agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  mission_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  runtime text NOT NULL CHECK (runtime IN ('vercel_workflow','server_worker','test_harness')),
  external_run_id text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','waiting','completed','failed','cancelled')),
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(checkpoint) = 'object'),
  usage jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(usage) = 'object'),
  error_code text,
  error_message text CHECK (error_message IS NULL OR length(error_message) <= 4000),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (mission_id, workspace_id) REFERENCES public.afe_agent_missions(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id, workspace_id) REFERENCES public.afe_agents(id, workspace_id) ON DELETE CASCADE,
  UNIQUE (runtime, external_run_id)
);

CREATE TABLE IF NOT EXISTS public.afe_agent_mission_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  mission_id uuid NOT NULL,
  run_id uuid REFERENCES public.afe_agent_runs(id) ON DELETE CASCADE,
  step_key text NOT NULL CHECK (length(step_key) BETWEEN 2 AND 160),
  sequence_no integer NOT NULL CHECK (sequence_no >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','waiting_approval','completed','failed','skipped')),
  input_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(input_payload) = 'object'),
  output_payload jsonb CHECK (output_payload IS NULL OR jsonb_typeof(output_payload) = 'object'),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  idempotency_key text NOT NULL,
  lease_token uuid,
  lease_expires_at timestamptz,
  error_code text,
  error_message text CHECK (error_message IS NULL OR length(error_message) <= 4000),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (mission_id, workspace_id) REFERENCES public.afe_agent_missions(id, workspace_id) ON DELETE CASCADE,
  UNIQUE (mission_id, step_key),
  UNIQUE (mission_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.afe_agent_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.debate_workspaces(id) ON DELETE CASCADE,
  mission_id uuid,
  run_id uuid REFERENCES public.afe_agent_runs(id) ON DELETE SET NULL,
  agent_id uuid,
  actor_type text NOT NULL CHECK (actor_type IN ('human','agent','system','worker')),
  actor_id uuid,
  event_type text NOT NULL CHECK (length(event_type) BETWEEN 2 AND 120),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (mission_id, workspace_id) REFERENCES public.afe_agent_missions(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id, workspace_id) REFERENCES public.afe_agents(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.afe_agent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.debate_workspaces(id) ON DELETE CASCADE,
  mission_id uuid,
  from_agent_id uuid NOT NULL,
  to_agent_id uuid NOT NULL,
  message_type text NOT NULL DEFAULT 'task' CHECK (message_type IN ('task','question','response','review','alert','handoff')),
  subject text NOT NULL CHECK (length(btrim(subject)) BETWEEN 2 AND 240),
  body jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(body) = 'object'),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','delivered','acknowledged','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  FOREIGN KEY (mission_id, workspace_id) REFERENCES public.afe_agent_missions(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (from_agent_id, workspace_id) REFERENCES public.afe_agents(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (to_agent_id, workspace_id) REFERENCES public.afe_agents(id, workspace_id) ON DELETE CASCADE,
  CHECK (from_agent_id <> to_agent_id)
);

CREATE TABLE IF NOT EXISTS public.afe_agent_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.debate_workspaces(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL,
  source_mission_id uuid,
  memory_type text NOT NULL CHECK (memory_type IN ('fact','procedure','preference','lesson','decision','warning')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 240),
  content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  confidence numeric(5,4) NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','validated','rejected','superseded')),
  visibility text NOT NULL DEFAULT 'agent_private' CHECK (visibility IN ('agent_private','workspace_shared')),
  validated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agent_id, workspace_id) REFERENCES public.afe_agents(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (source_mission_id, workspace_id) REFERENCES public.afe_agent_missions(id, workspace_id) ON DELETE SET NULL (source_mission_id)
);

CREATE TABLE IF NOT EXISTS public.afe_agent_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.debate_workspaces(id) ON DELETE CASCADE,
  mission_id uuid,
  run_id uuid REFERENCES public.afe_agent_runs(id) ON DELETE CASCADE,
  requested_by_agent_id uuid,
  requested_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action_key text NOT NULL CHECK (length(action_key) BETWEEN 2 AND 160),
  action_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(action_payload) = 'object'),
  risk_level text NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('low','medium','high','critical')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired','cancelled')),
  approver_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decision_note text CHECK (decision_note IS NULL OR length(decision_note) <= 4000),
  expires_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (mission_id, workspace_id) REFERENCES public.afe_agent_missions(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (requested_by_agent_id, workspace_id) REFERENCES public.afe_agents(id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS afe_agents_workspace_status_idx ON public.afe_agents(workspace_id,status);
CREATE INDEX IF NOT EXISTS afe_agent_missions_queue_idx ON public.afe_agent_missions(status,run_after,priority DESC,created_at);
CREATE INDEX IF NOT EXISTS afe_agent_missions_workspace_idx ON public.afe_agent_missions(workspace_id,created_at DESC);
CREATE INDEX IF NOT EXISTS afe_agent_runs_mission_idx ON public.afe_agent_runs(mission_id,created_at DESC);
CREATE INDEX IF NOT EXISTS afe_agent_steps_mission_idx ON public.afe_agent_mission_steps(mission_id,sequence_no);
CREATE INDEX IF NOT EXISTS afe_agent_events_mission_idx ON public.afe_agent_events(mission_id,created_at);
CREATE INDEX IF NOT EXISTS afe_agent_messages_inbox_idx ON public.afe_agent_messages(to_agent_id,status,created_at);
CREATE INDEX IF NOT EXISTS afe_agent_memory_lookup_idx ON public.afe_agent_memory(agent_id,status,visibility,created_at DESC);
CREATE INDEX IF NOT EXISTS afe_agent_approvals_pending_idx ON public.afe_agent_approvals(workspace_id,status,created_at);

-- The client must never directly create, modify, or read agent execution state.
-- Authenticated application routes perform membership checks before using the
-- server-only Supabase secret. RLS is an independent deny-by-default boundary.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'afe_agents','afe_agent_tool_grants','afe_agent_missions','afe_agent_runs',
    'afe_agent_mission_steps','afe_agent_events','afe_agent_messages',
    'afe_agent_memory','afe_agent_approvals'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
  END LOOP;
END $$;

GRANT USAGE, SELECT ON SEQUENCE public.afe_agent_events_id_seq TO service_role;

COMMENT ON TABLE public.afe_agents IS 'AFE-CI autonomous specialist agents scoped to a workspace; server-managed only.';
COMMENT ON TABLE public.afe_agent_missions IS 'Durable mission queue and lifecycle state; client never executes agents.';
COMMENT ON TABLE public.afe_agent_mission_steps IS 'Idempotent, lease-protected mission checkpoints for crash-safe execution.';
COMMENT ON TABLE public.afe_agent_events IS 'Append-only execution and governance event journal.';
COMMENT ON TABLE public.afe_agent_memory IS 'Agent memory with explicit proposed/validated/rejected lifecycle.';
COMMENT ON TABLE public.afe_agent_approvals IS 'Human approval gates for privileged or high-impact agent actions.';
