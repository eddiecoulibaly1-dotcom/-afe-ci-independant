-- V0.9: debate-specific profiles, workspaces, roles and controlled sharing.
create table if not exists public.debate_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.debate_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.debate_workspace_members (
  workspace_id uuid not null references public.debate_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('owner','admin','editor','viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

alter table public.debates add column if not exists workspace_id uuid references public.debate_workspaces(id) on delete set null;

create table if not exists public.debate_shares (
  debate_id uuid not null references public.debates(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  permission text not null default 'viewer' check (permission in ('viewer','editor')),
  shared_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (debate_id, user_id)
);

create index if not exists idx_debate_workspaces_owner on public.debate_workspaces(owner_id, created_at desc);
create index if not exists idx_debate_workspace_members_user on public.debate_workspace_members(user_id, workspace_id);
create index if not exists idx_debates_workspace_created on public.debates(workspace_id, created_at desc);
create index if not exists idx_debate_shares_user on public.debate_shares(user_id, created_at desc);

create or replace function public.set_debate_workspace_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists trg_debate_profiles_updated_at on public.debate_profiles;
create trigger trg_debate_profiles_updated_at before update on public.debate_profiles for each row execute function public.set_debate_workspace_updated_at();
drop trigger if exists trg_debate_workspaces_updated_at on public.debate_workspaces;
create trigger trg_debate_workspaces_updated_at before update on public.debate_workspaces for each row execute function public.set_debate_workspace_updated_at();

create or replace function public.handle_new_debate_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.debate_profiles(user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email,''), '@', 1)))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_auth_user_debate_profile on auth.users;
create trigger trg_auth_user_debate_profile after insert on auth.users for each row execute function public.handle_new_debate_profile();

alter table public.debate_profiles enable row level security;
alter table public.debate_workspaces enable row level security;
alter table public.debate_workspace_members enable row level security;
alter table public.debate_shares enable row level security;

revoke all on public.debate_profiles from anon, authenticated;
revoke all on public.debate_workspaces from anon, authenticated;
revoke all on public.debate_workspace_members from anon, authenticated;
revoke all on public.debate_shares from anon, authenticated;

create policy debate_profiles_self_select on public.debate_profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy debate_profiles_self_update on public.debate_profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy debate_workspaces_member_select on public.debate_workspaces for select to authenticated using (
  owner_id = (select auth.uid()) or exists (select 1 from public.debate_workspace_members m where m.workspace_id = id and m.user_id = (select auth.uid()))
);
create policy debate_workspaces_owner_insert on public.debate_workspaces for insert to authenticated with check (owner_id = (select auth.uid()));
create policy debate_workspaces_owner_update on public.debate_workspaces for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy debate_workspaces_owner_delete on public.debate_workspaces for delete to authenticated using (owner_id = (select auth.uid()));

create policy debate_workspace_members_self_select on public.debate_workspace_members for select to authenticated using (user_id = (select auth.uid()));
create policy debate_workspace_members_admin_insert on public.debate_workspace_members for insert to authenticated with check (
  exists (select 1 from public.debate_workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())) or
  exists (select 1 from public.debate_workspace_members me where me.workspace_id = workspace_id and me.user_id = (select auth.uid()) and me.role in ('owner','admin'))
);
create policy debate_workspace_members_admin_update on public.debate_workspace_members for update to authenticated using (
  exists (select 1 from public.debate_workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())) or
  exists (select 1 from public.debate_workspace_members me where me.workspace_id = workspace_id and me.user_id = (select auth.uid()) and me.role in ('owner','admin'))
) with check (role in ('owner','admin','editor','viewer'));
create policy debate_workspace_members_admin_delete on public.debate_workspace_members for delete to authenticated using (
  exists (select 1 from public.debate_workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())) or
  exists (select 1 from public.debate_workspace_members me where me.workspace_id = workspace_id and me.user_id = (select auth.uid()) and me.role in ('owner','admin'))
);

create policy debate_shares_participant_select on public.debate_shares for select to authenticated using (shared_by = (select auth.uid()) or user_id = (select auth.uid()));
create policy debate_shares_owner_insert on public.debate_shares for insert to authenticated with check (shared_by = (select auth.uid()));
create policy debate_shares_owner_delete on public.debate_shares for delete to authenticated using (shared_by = (select auth.uid()) or user_id = (select auth.uid()));

create policy debates_select_v09_access on public.debates for select to authenticated using (
  user_id = (select auth.uid()) or
  exists (select 1 from public.debate_workspace_members m where m.workspace_id = workspace_id and m.user_id = (select auth.uid())) or
  exists (select 1 from public.debate_shares s where s.debate_id = id and s.user_id = (select auth.uid()))
);
create policy debates_update_v09_access on public.debates for update to authenticated using (
  user_id = (select auth.uid()) or
  exists (select 1 from public.debate_workspace_members m where m.workspace_id = workspace_id and m.user_id = (select auth.uid()) and m.role in ('owner','admin','editor')) or
  exists (select 1 from public.debate_shares s where s.debate_id = id and s.user_id = (select auth.uid()) and s.permission = 'editor')
) with check (user_id = (select auth.uid()) or workspace_id is null or exists (select 1 from public.debate_workspace_members m where m.workspace_id = workspace_id and m.user_id = (select auth.uid()) and m.role in ('owner','admin','editor')));
