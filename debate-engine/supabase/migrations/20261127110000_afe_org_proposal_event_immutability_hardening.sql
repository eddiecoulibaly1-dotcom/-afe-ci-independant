-- Harden the already-applied E10 event guard: fixed search_path and TRUNCATE protection.
create or replace function public.afe_org_proposal_events_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$ begin
  raise exception 'Organizational proposal events are immutable';
end $$;
drop trigger if exists afe_org_proposal_events_immutable on public.afe_org_improvement_proposal_events;
create trigger afe_org_proposal_events_immutable
before update or delete on public.afe_org_improvement_proposal_events
for each row execute function public.afe_org_proposal_events_immutable();
drop trigger if exists afe_org_proposal_events_truncate_guard on public.afe_org_improvement_proposal_events;
create trigger afe_org_proposal_events_truncate_guard
before truncate on public.afe_org_improvement_proposal_events
for each statement execute function public.afe_org_proposal_events_immutable();
