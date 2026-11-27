-- Cover the proposal_id foreign key with a leading-column index for delete/update checks.
create index if not exists afe_org_proposal_events_proposal_fk_idx
  on public.afe_org_improvement_proposal_events(proposal_id);
