-- AFE-CI Debate Engine V1.0.6 security hardening
-- Share-link creation/management is restricted to users who can edit the underlying debate.
-- Audit and notification creation stays server-side; clients only read/update their own records.

drop policy if exists admin_audit_insert_own on public.admin_audit_log;
drop policy if exists notifications_own_insert on public.notifications;

drop policy if exists debate_share_links_owner_insert on public.debate_share_links;
drop policy if exists debate_share_links_owner_select on public.debate_share_links;
drop policy if exists debate_share_links_owner_update on public.debate_share_links;
drop policy if exists debate_share_links_owner_delete on public.debate_share_links;

create policy debate_share_links_owner_select on public.debate_share_links
for select to authenticated
using (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.debates d
    where d.id = debate_share_links.debate_id
      and (
        d.user_id = (select auth.uid())
        or exists (
          select 1 from public.debate_workspace_members m
          where m.workspace_id = d.workspace_id
            and m.user_id = (select auth.uid())
            and m.role = any(array['owner','admin','editor'])
        )
        or exists (
          select 1 from public.debate_shares s
          where s.debate_id = d.id
            and s.user_id = (select auth.uid())
            and s.permission = 'editor'
        )
      )
  )
);

create policy debate_share_links_owner_insert on public.debate_share_links
for insert to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.debates d
    where d.id = debate_share_links.debate_id
      and (
        d.user_id = (select auth.uid())
        or exists (
          select 1 from public.debate_workspace_members m
          where m.workspace_id = d.workspace_id
            and m.user_id = (select auth.uid())
            and m.role = any(array['owner','admin','editor'])
        )
        or exists (
          select 1 from public.debate_shares s
          where s.debate_id = d.id
            and s.user_id = (select auth.uid())
            and s.permission = 'editor'
        )
      )
  )
);

create policy debate_share_links_owner_update on public.debate_share_links
for update to authenticated
using (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.debates d
    where d.id = debate_share_links.debate_id
      and (
        d.user_id = (select auth.uid())
        or exists (
          select 1 from public.debate_workspace_members m
          where m.workspace_id = d.workspace_id
            and m.user_id = (select auth.uid())
            and m.role = any(array['owner','admin','editor'])
        )
        or exists (
          select 1 from public.debate_shares s
          where s.debate_id = d.id
            and s.user_id = (select auth.uid())
            and s.permission = 'editor'
        )
      )
  )
)
with check (created_by = (select auth.uid()));

create policy debate_share_links_owner_delete on public.debate_share_links
for delete to authenticated
using (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.debates d
    where d.id = debate_share_links.debate_id
      and (
        d.user_id = (select auth.uid())
        or exists (
          select 1 from public.debate_workspace_members m
          where m.workspace_id = d.workspace_id
            and m.user_id = (select auth.uid())
            and m.role = any(array['owner','admin','editor'])
        )
        or exists (
          select 1 from public.debate_shares s
          where s.debate_id = d.id
            and s.user_id = (select auth.uid())
            and s.permission = 'editor'
        )
      )
  )
);
