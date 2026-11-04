-- Align Test workspace-member management with the established Production contract.
-- Workspace owners and existing workspace admins may manage membership.
-- This migration changes RLS policies only; it does not grant table privileges.
drop policy if exists debate_workspace_members_owner_insert on public.debate_workspace_members;
drop policy if exists debate_workspace_members_owner_update on public.debate_workspace_members;
drop policy if exists debate_workspace_members_owner_delete on public.debate_workspace_members;

drop policy if exists debate_workspace_members_admin_insert on public.debate_workspace_members;
create policy debate_workspace_members_admin_insert
on public.debate_workspace_members
for insert to authenticated
with check (
  exists (
    select 1 from public.debate_workspaces w
    where w.id = debate_workspace_members.workspace_id
      and w.owner_id = (select auth.uid())
  )
  or exists (
    select 1 from public.debate_workspace_members me
    where me.workspace_id = debate_workspace_members.workspace_id
      and me.user_id = (select auth.uid())
      and me.role in ('owner', 'admin')
  )
);

drop policy if exists debate_workspace_members_admin_update on public.debate_workspace_members;
create policy debate_workspace_members_admin_update
on public.debate_workspace_members
for update to authenticated
using (
  exists (
    select 1 from public.debate_workspaces w
    where w.id = debate_workspace_members.workspace_id
      and w.owner_id = (select auth.uid())
  )
  or exists (
    select 1 from public.debate_workspace_members me
    where me.workspace_id = debate_workspace_members.workspace_id
      and me.user_id = (select auth.uid())
      and me.role in ('owner', 'admin')
  )
)
with check (
  role in ('owner', 'admin', 'editor', 'viewer')
);

drop policy if exists debate_workspace_members_admin_delete on public.debate_workspace_members;
create policy debate_workspace_members_admin_delete
on public.debate_workspace_members
for delete to authenticated
using (
  exists (
    select 1 from public.debate_workspaces w
    where w.id = debate_workspace_members.workspace_id
      and w.owner_id = (select auth.uid())
  )
  or exists (
    select 1 from public.debate_workspace_members me
    where me.workspace_id = debate_workspace_members.workspace_id
      and me.user_id = (select auth.uid())
      and me.role in ('owner', 'admin')
  )
);
