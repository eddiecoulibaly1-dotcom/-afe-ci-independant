create index if not exists idx_debate_events_round_id on public.debate_events(round_id);
create index if not exists idx_debate_evidence_round_id on public.debate_evidence(round_id);
create index if not exists idx_debate_share_links_created_by on public.debate_share_links(created_by);
create index if not exists idx_debate_shares_shared_by on public.debate_shares(shared_by);