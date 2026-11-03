-- Qualify outer table columns to avoid accidental inner-column shadowing in RLS.
drop policy if exists debates_select_access on public.debates;
create policy debates_select_access on public.debates for select to authenticated using (
 user_id=(select auth.uid())
 or exists(select 1 from public.debate_workspace_members m where m.workspace_id=public.debates.workspace_id and m.user_id=(select auth.uid()))
 or exists(select 1 from public.debate_shares s where s.debate_id=public.debates.id and s.user_id=(select auth.uid()))
);
drop policy if exists debates_update_access on public.debates;
create policy debates_update_access on public.debates for update to authenticated using (
 user_id=(select auth.uid())
 or exists(select 1 from public.debate_workspace_members m where m.workspace_id=public.debates.workspace_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','editor'))
 or exists(select 1 from public.debate_shares s where s.debate_id=public.debates.id and s.user_id=(select auth.uid()) and s.permission='editor')
) with check (
 user_id=(select auth.uid()) or workspace_id is null
 or exists(select 1 from public.debate_workspace_members m where m.workspace_id=public.debates.workspace_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','editor'))
);
notify pgrst, 'reload schema';