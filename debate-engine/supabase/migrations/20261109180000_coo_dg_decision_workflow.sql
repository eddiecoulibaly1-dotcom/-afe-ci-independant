-- DG decision workflow V1. Server-only tables; authenticated access is enforced by the API.
create table if not exists public.afe_coo_dg_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.debate_workspaces(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 8 and 240),
  decision_type text not null default 'governance' check (decision_type in ('governance','strategy','budget','organization','risk','other')),
  summary text not null check (char_length(btrim(summary)) between 20 and 12000),
  rationale text not null check (char_length(btrim(rationale)) between 10 and 12000),
  requested_outcome text not null check (requested_outcome in ('approve','approve_with_conditions','reject','return_for_revision','acknowledge')),
  requested_by uuid not null,
  submitted_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','approved','approved_with_conditions','rejected','returned_for_revision')),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint afe_coo_dg_decisions_decision_pair check (
    (status = 'pending' and decided_by is null and decided_at is null)
    or (status <> 'pending' and decided_by is not null and decided_at is not null)
  )
);
create index if not exists afe_coo_dg_decisions_workspace_status_idx
  on public.afe_coo_dg_decisions(workspace_id,status,submitted_at desc);
create table if not exists public.afe_coo_dg_decision_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.debate_workspaces(id) on delete cascade,
  decision_id uuid not null references public.afe_coo_dg_decisions(id) on delete cascade,
  event_type text not null check (event_type in ('submitted','approved','approved_with_conditions','rejected','returned_for_revision')),
  actor_id uuid not null,
  note text,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists afe_coo_dg_decision_events_decision_idx
  on public.afe_coo_dg_decision_events(workspace_id,decision_id,created_at);
alter table public.afe_coo_dg_decisions enable row level security;
alter table public.afe_coo_dg_decisions force row level security;
alter table public.afe_coo_dg_decision_events enable row level security;
alter table public.afe_coo_dg_decision_events force row level security;
revoke all on table public.afe_coo_dg_decisions from public, anon, authenticated;
revoke all on table public.afe_coo_dg_decision_events from public, anon, authenticated;
revoke all on table public.afe_coo_dg_decisions from service_role;
revoke all on table public.afe_coo_dg_decision_events from service_role;
grant select,insert,update on table public.afe_coo_dg_decisions to service_role;
grant select,insert on table public.afe_coo_dg_decision_events to service_role;
create or replace function public.guard_afe_coo_dg_decision_event_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'DG decision events are append-only';
end;
$$;
drop trigger if exists afe_coo_dg_decision_events_immutable on public.afe_coo_dg_decision_events;
create trigger afe_coo_dg_decision_events_immutable
before update or delete on public.afe_coo_dg_decision_events
for each row execute function public.guard_afe_coo_dg_decision_event_immutable();
revoke all on function public.guard_afe_coo_dg_decision_event_immutable() from public, anon, authenticated;

create or replace function public.capture_afe_coo_dg_decision_event()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_type text;
  v_actor uuid;
  v_note text;
begin
  if tg_op = 'INSERT' then
    v_type := 'submitted';
    v_actor := new.requested_by;
    v_note := 'Dossier soumis à la Direction générale.';
    insert into public.afe_coo_dg_decision_events(workspace_id,decision_id,event_type,actor_id,note,snapshot)
    values(new.workspace_id,new.id,v_type,v_actor,v_note,jsonb_build_object('title',new.title,'decision_type',new.decision_type,'requested_outcome',new.requested_outcome,'version',new.version));
    return new;
  end if;
  if old.status = 'pending' and new.status <> 'pending' then
    v_type := new.status;
    v_actor := new.decided_by;
    v_note := new.decision_note;
    insert into public.afe_coo_dg_decision_events(workspace_id,decision_id,event_type,actor_id,note,snapshot)
    values(new.workspace_id,new.id,v_type,v_actor,v_note,jsonb_build_object('previous_status',old.status,'status',new.status,'version',new.version));
  end if;
  return new;
end;
$$;
drop trigger if exists afe_coo_dg_decision_event_capture on public.afe_coo_dg_decisions;
create trigger afe_coo_dg_decision_event_capture
after insert or update of status on public.afe_coo_dg_decisions
for each row execute function public.capture_afe_coo_dg_decision_event();
revoke all on function public.capture_afe_coo_dg_decision_event() from public, anon, authenticated;

-- Make the new server-only tables visible to PostgREST immediately.
notify pgrst, 'reload schema';

-- Prevent bulk truncation from bypassing the append-only row trigger.
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
