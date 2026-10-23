create table if not exists public.debate_share_links (
  id uuid primary key default gen_random_uuid(),
  debate_id uuid not null references public.debates(id) on delete cascade,
  token_hash text not null unique,
  permission text not null default 'viewer' check (permission in ('viewer','editor')),
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_accessed_at timestamptz
);

create index if not exists debate_share_links_debate_idx on public.debate_share_links(debate_id);
create index if not exists debate_share_links_active_idx on public.debate_share_links(token_hash) where revoked_at is null;
create index if not exists notifications_user_unread_idx on public.notifications(user_id, created_at desc) where read_at is null;
create index if not exists admin_audit_log_actor_time_idx on public.admin_audit_log(actor_id, created_at desc);

alter table public.debate_share_links enable row level security;
drop policy if exists debate_share_links_owner_select on public.debate_share_links;
drop policy if exists debate_share_links_owner_insert on public.debate_share_links;
drop policy if exists debate_share_links_owner_update on public.debate_share_links;
drop policy if exists debate_share_links_owner_delete on public.debate_share_links;
create policy debate_share_links_owner_select on public.debate_share_links for select to authenticated using (created_by = (select auth.uid()));
create policy debate_share_links_owner_insert on public.debate_share_links for insert to authenticated with check (created_by = (select auth.uid()));
create policy debate_share_links_owner_update on public.debate_share_links for update to authenticated using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));
create policy debate_share_links_owner_delete on public.debate_share_links for delete to authenticated using (created_by = (select auth.uid()));
