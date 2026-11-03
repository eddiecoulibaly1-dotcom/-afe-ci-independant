drop policy if exists debate_rounds_select_access on public.debate_rounds;
create policy debate_rounds_select_access on public.debate_rounds for select to authenticated using (
 exists(select 1 from public.debates d where d.id=debate_rounds.debate_id and (
  d.user_id=(select auth.uid())
  or exists(select 1 from public.debate_workspace_members m where m.workspace_id=d.workspace_id and m.user_id=(select auth.uid()))
  or exists(select 1 from public.debate_shares s where s.debate_id=d.id and s.user_id=(select auth.uid()))
 ))
);
drop policy if exists debate_events_select_access on public.debate_events;
create policy debate_events_select_access on public.debate_events for select to authenticated using (
 exists(select 1 from public.debates d where d.id=debate_events.debate_id and (
  d.user_id=(select auth.uid())
  or exists(select 1 from public.debate_workspace_members m where m.workspace_id=d.workspace_id and m.user_id=(select auth.uid()))
  or exists(select 1 from public.debate_shares s where s.debate_id=d.id and s.user_id=(select auth.uid()))
 ))
);
drop policy if exists debate_hypotheses_select_access on public.debate_hypotheses;
create policy debate_hypotheses_select_access on public.debate_hypotheses for select to authenticated using (
 exists(select 1 from public.debates d where d.id=debate_hypotheses.debate_id and (
  d.user_id=(select auth.uid())
  or exists(select 1 from public.debate_workspace_members m where m.workspace_id=d.workspace_id and m.user_id=(select auth.uid()))
  or exists(select 1 from public.debate_shares s where s.debate_id=d.id and s.user_id=(select auth.uid()))
 ))
);
drop policy if exists debate_evidence_select_access on public.debate_evidence;
create policy debate_evidence_select_access on public.debate_evidence for select to authenticated using (
 exists(select 1 from public.debates d where d.id=debate_evidence.debate_id and (
  d.user_id=(select auth.uid())
  or exists(select 1 from public.debate_workspace_members m where m.workspace_id=d.workspace_id and m.user_id=(select auth.uid()))
  or exists(select 1 from public.debate_shares s where s.debate_id=d.id and s.user_id=(select auth.uid()))
 ))
);
drop policy if exists debate_decisions_select_access on public.debate_decisions;
create policy debate_decisions_select_access on public.debate_decisions for select to authenticated using (
 exists(select 1 from public.debates d where d.id=debate_decisions.debate_id and (
  d.user_id=(select auth.uid())
  or exists(select 1 from public.debate_workspace_members m where m.workspace_id=d.workspace_id and m.user_id=(select auth.uid()))
  or exists(select 1 from public.debate_shares s where s.debate_id=d.id and s.user_id=(select auth.uid()))
 ))
);
notify pgrst, 'reload schema';