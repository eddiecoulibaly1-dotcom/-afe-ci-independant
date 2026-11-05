-- AFE-CI Team Governance: membership mutations must remain server-authorized.
-- The application uses authenticated API handlers with a server-only Supabase secret.
-- Direct browser writes to membership rows bypass the application's owner/admin
-- hierarchy checks (for example, an admin could otherwise grant the owner role).
DROP POLICY IF EXISTS debate_workspace_members_admin_insert ON public.debate_workspace_members;
DROP POLICY IF EXISTS debate_workspace_members_admin_update ON public.debate_workspace_members;
DROP POLICY IF EXISTS debate_workspace_members_admin_delete ON public.debate_workspace_members;

-- Members may read only their own membership row through the public Data API.
-- All membership creation, role changes and removals are performed by the
-- authenticated server API, which enforces workspace-scoped role hierarchy.
