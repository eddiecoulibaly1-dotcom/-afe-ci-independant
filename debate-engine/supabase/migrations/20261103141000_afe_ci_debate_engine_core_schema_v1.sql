-- AFE-CI Debate Engine core schema (server-side persistence).
-- All application writes use the server-side Supabase secret key; RLS keeps browser access scoped.
create extension if not exists pgcrypto;

create table if not exists public.debates (
 id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade,
 workspace_id uuid, question text not null, context text,
 mode text not null default 'decision' check (mode in ('exploration','decision','validation')),
 status text not null default 'running' check (status in ('running','converged','unresolved','failed')),
 config jsonb not null default '{}'::jsonb, final_decision jsonb,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.debate_rounds (
 id uuid primary key default gen_random_uuid(), debate_id uuid not null references public.debates(id) on delete cascade,
 round_number integer not null check (round_number>0), architect_proposal jsonb not null,
 red_team_critique jsonb not null, judge_decision jsonb not null, created_at timestamptz not null default now(),
 unique(debate_id,round_number)
);
create table if not exists public.debate_events (
 id uuid primary key default gen_random_uuid(), debate_id uuid not null references public.debates(id) on delete cascade,
 round_id uuid references public.debate_rounds(id) on delete cascade, event_type text not null,
 actor text not null, payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table if not exists public.debate_hypotheses (
 id uuid primary key default gen_random_uuid(), debate_id uuid not null references public.debates(id) on delete cascade,
 statement text not null, status text not null default 'open' check(status in ('open','supported','rejected','untested')),
 confidence numeric(5,2) check(confidence between 0 and 100), source_round integer,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.debate_evidence (
 id uuid primary key default gen_random_uuid(), debate_id uuid not null references public.debates(id) on delete cascade,
 round_id uuid references public.debate_rounds(id) on delete set null,
 kind text not null check(kind in ('source','experiment','metric','user_input','model_claim','other')),
 title text not null, url text, excerpt text, strength numeric(5,2) check(strength between 0 and 100),
 metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table if not exists public.debate_decisions (
 id uuid primary key default gen_random_uuid(), debate_id uuid not null references public.debates(id) on delete cascade,
 decision_type text not null check(decision_type in ('intermediate','final','unresolved')),
 statement text not null, score numeric(5,2) check(score between 0 and 100),
 rationale jsonb not null default '[]'::jsonb,
 status text not null check(status in ('proposed','accepted','rejected','needs_validation')),
 created_at timestamptz not null default now()
);
create table if not exists public.debate_profiles (
 user_id uuid primary key references auth.users(id) on delete cascade, display_name text, phone text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.debate_workspaces (
 id uuid primary key default gen_random_uuid(), name text not null check(char_length(trim(name)) between 2 and 120),
 owner_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.debate_workspace_members (
 workspace_id uuid not null references public.debate_workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null default 'viewer' check(role in ('owner','admin','editor','viewer')),
 created_at timestamptz not null default now(), primary key(workspace_id,user_id)
);
alter table public.debates add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.debates add column if not exists workspace_id uuid;
create table if not exists public.debate_shares (
 debate_id uuid not null references public.debates(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 permission text not null default 'viewer' check(permission in ('viewer','editor')),
 shared_by uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(), primary key(debate_id,user_id)
);
create table if not exists public.debate_share_links (
 id uuid primary key default gen_random_uuid(), debate_id uuid not null references public.debates(id) on delete cascade,
 token_hash text not null unique, permission text not null default 'viewer' check(permission in ('viewer','editor')),
 created_by uuid not null references auth.users(id) on delete cascade, expires_at timestamptz,
 revoked_at timestamptz, created_at timestamptz not null default now(), last_accessed_at timestamptz
);
create table if not exists public.notifications (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 type text not null, title text not null, message text not null, link_type text, link_id text,
 read_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.admin_audit_log (
 id uuid primary key default gen_random_uuid(), actor_id uuid not null references auth.users(id) on delete cascade,
 action text not null, entity_type text not null, entity_id text not null,
 details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

create index if not exists idx_debate_rounds_debate on public.debate_rounds(debate_id,round_number);
create index if not exists idx_debate_events_debate on public.debate_events(debate_id,created_at);
create index if not exists idx_debate_hypotheses_debate on public.debate_hypotheses(debate_id,status);
create index if not exists idx_debate_evidence_debate on public.debate_evidence(debate_id,created_at);
create index if not exists idx_debate_decisions_debate on public.debate_decisions(debate_id,created_at);
create index if not exists idx_debates_user_created on public.debates(user_id,created_at desc);
create index if not exists idx_debate_workspaces_owner on public.debate_workspaces(owner_id,created_at desc);
create index if not exists idx_debate_workspace_members_user on public.debate_workspace_members(user_id,workspace_id);
create index if not exists idx_debates_workspace_created on public.debates(workspace_id,created_at desc);
create index if not exists idx_debate_shares_user on public.debate_shares(user_id,created_at desc);
create index if not exists debate_share_links_debate_idx on public.debate_share_links(debate_id);
create index if not exists debate_share_links_active_idx on public.debate_share_links(token_hash) where revoked_at is null;
create index if not exists notifications_user_unread_idx on public.notifications(user_id,created_at desc) where read_at is null;
create index if not exists admin_audit_log_actor_time_idx on public.admin_audit_log(actor_id,created_at desc);

create or replace function public.set_debate_updated_at()
returns trigger language plpgsql set search_path=public as $$ begin new.updated_at=now(); return new; end; $$;
drop trigger if exists trg_debates_updated_at on public.debates;
create trigger trg_debates_updated_at before update on public.debates for each row execute function public.set_debate_updated_at();
drop trigger if exists trg_debate_hypotheses_updated_at on public.debate_hypotheses;
create trigger trg_debate_hypotheses_updated_at before update on public.debate_hypotheses for each row execute function public.set_debate_updated_at();
drop trigger if exists trg_debate_profiles_updated_at on public.debate_profiles;
create trigger trg_debate_profiles_updated_at before update on public.debate_profiles for each row execute function public.set_debate_updated_at();
drop trigger if exists trg_debate_workspaces_updated_at on public.debate_workspaces;
create trigger trg_debate_workspaces_updated_at before update on public.debate_workspaces for each row execute function public.set_debate_updated_at();

create or replace function public.handle_new_debate_profile()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.debate_profiles(user_id,display_name)
 values(new.id,coalesce(new.raw_user_meta_data->>'full_name',split_part(coalesce(new.email,''),'@',1)))
 on conflict(user_id) do nothing;
 return new;
end; $$;
drop trigger if exists trg_auth_user_debate_profile on auth.users;
create trigger trg_auth_user_debate_profile after insert on auth.users for each row execute function public.handle_new_debate_profile();
revoke execute on function public.handle_new_debate_profile() from public,anon,authenticated;

alter table public.debates enable row level security;
alter table public.debate_rounds enable row level security;
alter table public.debate_events enable row level security;
alter table public.debate_hypotheses enable row level security;
alter table public.debate_evidence enable row level security;
alter table public.debate_decisions enable row level security;
alter table public.debate_profiles enable row level security;
alter table public.debate_workspaces enable row level security;
alter table public.debate_workspace_members enable row level security;
alter table public.debate_shares enable row level security;
alter table public.debate_share_links enable row level security;
alter table public.notifications enable row level security;
alter table public.admin_audit_log enable row level security;

revoke all on public.debates,public.debate_rounds,public.debate_events,public.debate_hypotheses,public.debate_evidence,public.debate_decisions,public.debate_profiles,public.debate_workspaces,public.debate_workspace_members,public.debate_shares,public.debate_share_links,public.notifications,public.admin_audit_log from anon,authenticated;
grant select on public.debates,public.debate_rounds,public.debate_events,public.debate_hypotheses,public.debate_evidence,public.debate_decisions,public.debate_profiles,public.debate_workspaces,public.debate_workspace_members,public.debate_shares,public.debate_share_links,public.notifications,public.admin_audit_log to authenticated;
grant update(display_name,phone,updated_at) on public.debate_profiles to authenticated;
grant update(read_at) on public.notifications to authenticated;

drop policy if exists debates_select_access on public.debates;
create policy debates_select_access on public.debates for select to authenticated using (
 user_id=(select auth.uid()) or exists(select 1 from public.debate_workspace_members m where m.workspace_id=workspace_id and m.user_id=(select auth.uid()))
 or exists(select 1 from public.debate_shares s where s.debate_id=id and s.user_id=(select auth.uid()))
);
drop policy if exists debates_insert_owner on public.debates;
create policy debates_insert_owner on public.debates for insert to authenticated with check(user_id=(select auth.uid()));
drop policy if exists debates_update_access on public.debates;
create policy debates_update_access on public.debates for update to authenticated using (
 user_id=(select auth.uid()) or exists(select 1 from public.debate_workspace_members m where m.workspace_id=workspace_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','editor'))
 or exists(select 1 from public.debate_shares s where s.debate_id=id and s.user_id=(select auth.uid()) and s.permission='editor')
) with check(user_id=(select auth.uid()) or workspace_id is null or exists(select 1 from public.debate_workspace_members m where m.workspace_id=workspace_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','editor')));
drop policy if exists debates_delete_owner on public.debates;
create policy debates_delete_owner on public.debates for delete to authenticated using(user_id=(select auth.uid()));

drop policy if exists debate_profiles_self_select on public.debate_profiles;
create policy debate_profiles_self_select on public.debate_profiles for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists debate_profiles_self_update on public.debate_profiles;
create policy debate_profiles_self_update on public.debate_profiles for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

drop policy if exists debate_workspaces_member_select on public.debate_workspaces;
create policy debate_workspaces_member_select on public.debate_workspaces for select to authenticated using(owner_id=(select auth.uid()) or exists(select 1 from public.debate_workspace_members m where m.workspace_id=id and m.user_id=(select auth.uid())));
drop policy if exists debate_workspaces_owner_insert on public.debate_workspaces;
create policy debate_workspaces_owner_insert on public.debate_workspaces for insert to authenticated with check(owner_id=(select auth.uid()));
drop policy if exists debate_workspaces_owner_update on public.debate_workspaces;
create policy debate_workspaces_owner_update on public.debate_workspaces for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
drop policy if exists debate_workspaces_owner_delete on public.debate_workspaces;
create policy debate_workspaces_owner_delete on public.debate_workspaces for delete to authenticated using(owner_id=(select auth.uid()));

drop policy if exists debate_workspace_members_self_select on public.debate_workspace_members;
create policy debate_workspace_members_self_select on public.debate_workspace_members for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists debate_workspace_members_owner_insert on public.debate_workspace_members;
create policy debate_workspace_members_owner_insert on public.debate_workspace_members for insert to authenticated with check(exists(select 1 from public.debate_workspaces w where w.id=workspace_id and w.owner_id=(select auth.uid())));
drop policy if exists debate_workspace_members_owner_update on public.debate_workspace_members;
create policy debate_workspace_members_owner_update on public.debate_workspace_members for update to authenticated using(exists(select 1 from public.debate_workspaces w where w.id=workspace_id and w.owner_id=(select auth.uid()))) with check(exists(select 1 from public.debate_workspaces w where w.id=workspace_id and w.owner_id=(select auth.uid())));
drop policy if exists debate_workspace_members_owner_delete on public.debate_workspace_members;
create policy debate_workspace_members_owner_delete on public.debate_workspace_members for delete to authenticated using(exists(select 1 from public.debate_workspaces w where w.id=workspace_id and w.owner_id=(select auth.uid())));

drop policy if exists debate_shares_participant_select on public.debate_shares;
create policy debate_shares_participant_select on public.debate_shares for select to authenticated using(shared_by=(select auth.uid()) or user_id=(select auth.uid()));
drop policy if exists debate_shares_owner_insert on public.debate_shares;
create policy debate_shares_owner_insert on public.debate_shares for insert to authenticated with check(shared_by=(select auth.uid()));
drop policy if exists debate_shares_owner_delete on public.debate_shares;
create policy debate_shares_owner_delete on public.debate_shares for delete to authenticated using(shared_by=(select auth.uid()) or user_id=(select auth.uid()));

drop policy if exists debate_share_links_owner_select on public.debate_share_links;
create policy debate_share_links_owner_select on public.debate_share_links for select to authenticated using(created_by=(select auth.uid()));
drop policy if exists notifications_own_select on public.notifications;
create policy notifications_own_select on public.notifications for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists notifications_own_update on public.notifications;
create policy notifications_own_update on public.notifications for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
drop policy if exists admin_audit_log_own_select on public.admin_audit_log;
create policy admin_audit_log_own_select on public.admin_audit_log for select to authenticated using(actor_id=(select auth.uid()));
