-- Grant only the narrow, reversible workspace-scoped capabilities required
-- by the designated COO IA. The agent never receives database credentials.
INSERT INTO public.afe_agent_tool_grants (
  workspace_id,
  agent_id,
  tool_key,
  permission,
  enabled,
  approval_required,
  limits,
  granted_by
)
SELECT
  a.workspace_id,
  a.id,
  capability.tool_key,
  capability.permission,
  true,
  false,
  capability.limits,
  settings.dg_user_id
FROM public.afe_coo_settings AS settings
JOIN public.afe_agents AS a
  ON a.id = settings.coo_agent_id
 AND a.workspace_id = settings.workspace_id
CROSS JOIN (
  VALUES
    ('coo.organization.read', 'read', '{"workspace_scoped":true,"reversible_only":true,"max_per_run":1}'::jsonb),
    ('coo.workload.read', 'read', '{"workspace_scoped":true,"reversible_only":true,"max_per_run":2}'::jsonb),
    ('coo.missions.create', 'write', '{"workspace_scoped":true,"reversible_only":true,"max_per_run":6}'::jsonb),
    ('coo.tasks.create', 'write', '{"workspace_scoped":true,"reversible_only":true,"max_per_run":30}'::jsonb)
) AS capability(tool_key, permission, limits)
WHERE a.slug = 'afe-ci-coo'
  AND a.status = 'active'
  AND settings.coo_enabled = true
  AND settings.coo_kill_switch = false
  AND settings.coo_autonomy_level = 2
ON CONFLICT (agent_id, tool_key) DO UPDATE
SET workspace_id = EXCLUDED.workspace_id,
    permission = EXCLUDED.permission,
    enabled = EXCLUDED.enabled,
    approval_required = EXCLUDED.approval_required,
    limits = EXCLUDED.limits,
    granted_by = EXCLUDED.granted_by,
    updated_at = now();

COMMENT ON TABLE public.afe_agent_tool_grants IS
  'Workspace-scoped agent capabilities. COO IA uses only explicit, reversible, server-enforced grants; no agent receives service-role credentials.';
