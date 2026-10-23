-- V0.9 hardening: avoid recursive RLS evaluation on workspace memberships.
drop policy if exists debate_workspace_members_member_select on public.debate_workspace_members;
create policy debate_workspace_members_self_select on public.debate_workspace_members for select to authenticated using (user_id = (select auth.uid()));
revoke execute on function public.handle_new_debate_profile() from public, anon, authenticated;
