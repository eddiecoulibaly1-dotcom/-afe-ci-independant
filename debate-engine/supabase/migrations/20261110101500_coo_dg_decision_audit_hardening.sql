-- Harden DG audit append-only guarantees after initial workflow deployment.
revoke all on table public.afe_coo_dg_decisions from service_role;
revoke all on table public.afe_coo_dg_decision_events from service_role;
grant select,insert,update on table public.afe_coo_dg_decisions to service_role;
grant select,insert on table public.afe_coo_dg_decision_events to service_role;
create or replace function public.guard_afe_coo_dg_decision_events_truncate()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'DG decision events are append-only; TRUNCATE is forbidden';
end;
$$;
drop trigger if exists afe_coo_dg_decision_events_truncate_guard on public.afe_coo_dg_decision_events;
create trigger afe_coo_dg_decision_events_truncate_guard
before truncate on public.afe_coo_dg_decision_events
for each statement execute function public.guard_afe_coo_dg_decision_events_truncate();
revoke all on function public.guard_afe_coo_dg_decision_events_truncate() from public, anon, authenticated;
notify pgrst, 'reload schema';
