-- V0.8: authenticated users own their private debate history.
alter table public.debates add column if not exists user_id uuid references auth.users(id) on delete cascade;
create index if not exists idx_debates_user_created on public.debates(user_id, created_at desc);

revoke all on public.profiles from anon, authenticated;
revoke all on public.debates from anon, authenticated;
revoke all on public.debate_rounds from anon, authenticated;
revoke all on public.debate_events from anon, authenticated;
revoke all on public.debate_hypotheses from anon, authenticated;
revoke all on public.debate_evidence from anon, authenticated;
revoke all on public.debate_decisions from anon, authenticated;

create policy "profiles_select_own" on public.profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy "profiles_update_own" on public.profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "debates_select_own" on public.debates for select to authenticated using ((select auth.uid()) = user_id);
create policy "debates_insert_own" on public.debates for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "debates_update_own" on public.debates for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "debates_delete_own" on public.debates for delete to authenticated using ((select auth.uid()) = user_id);
