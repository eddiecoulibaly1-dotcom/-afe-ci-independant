-- AFE-CI Team & Governance Engine: additive schema only; do not apply to Production without approval.
create table if not exists public.debate_workspace_settings (
 workspace_id uuid primary key references public.debate_workspaces(id) on delete cascade,
 description text not null default '', category text not null default 'general',
 color text not null default '#147b5b' check(color ~ '^#[0-9A-Fa-f]{6}$'),
 archived_at timestamptz, created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.debate_workspace_invites (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.debate_workspaces(id) on delete cascade,
 email text not null, role text not null check(role in ('admin','editor','viewer')), token_hash text not null unique,
 invited_by uuid not null references auth.users(id) on delete restrict, accepted_by uuid references auth.users(id) on delete set null,
 expires_at timestamptz not null, accepted_at timestamptz, revoked_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists debate_workspace_invites_pending_idx on public.debate_workspace_invites(workspace_id,email) where accepted_at is null and revoked_at is null;
create table if not exists public.debate_workspace_roles (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.debate_workspaces(id) on delete cascade,
 name text not null, permissions jsonb not null default '{}'::jsonb, created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(), unique(workspace_id,name)
);
create table if not exists public.debate_workspace_tasks (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.debate_workspaces(id) on delete cascade,
 title text not null, description text not null default '', status text not null default 'todo' check(status in ('todo','in_progress','blocked','done','cancelled')),
 priority text not null default 'normal' check(priority in ('low','normal','high','critical')), due_at timestamptz,
 assigned_to uuid references auth.users(id) on delete set null, created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.debate_workspace_comments (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.debate_workspaces(id) on delete cascade,
 debate_id uuid references public.debates(id) on delete cascade, author_id uuid not null references auth.users(id) on delete restrict,
 parent_id uuid references public.debate_workspace_comments(id) on delete cascade, body text not null check(length(body) between 1 and 10000),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.debate_workspace_approvals (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.debate_workspaces(id) on delete cascade,
 debate_id uuid not null references public.debates(id) on delete cascade, requested_by uuid not null references auth.users(id) on delete restrict,
 status text not null default 'pending' check(status in ('pending','approved','rejected','needs_changes')), note text not null default '',
 decided_by uuid references auth.users(id) on delete set null, decision_note text not null default '', decided_at timestamptz,
 created_at timestamptz not null default now()
);
create table if not exists public.debate_workspace_documents (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.debate_workspaces(id) on delete cascade,
 debate_id uuid references public.debates(id) on delete set null, title text not null, description text not null default '',
 storage_path text not null, mime_type text not null default 'application/octet-stream',
 size_bytes bigint not null default 0 check(size_bytes between 0 and 50000000),
 uploaded_by uuid not null references auth.users(id) on delete restrict, created_at timestamptz not null default now(),
 unique(workspace_id,storage_path)
);
create table if not exists public.debate_workspace_audit (
 id bigint generated always as identity primary key, workspace_id uuid not null references public.debate_workspaces(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null, action text not null, entity_type text not null,
 entity_id text not null, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table if not exists public.debate_workspace_automation_rules (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.debate_workspaces(id) on delete cascade,
 name text not null, event_type text not null, configuration jsonb not null default '{}'::jsonb,
 enabled boolean not null default true, created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now()
);
create index if not exists debate_workspace_tasks_due_idx on public.debate_workspace_tasks(workspace_id,due_at) where status not in ('done','cancelled');
create index if not exists debate_workspace_comments_idx on public.debate_workspace_comments(workspace_id,debate_id,created_at);
create index if not exists debate_workspace_approvals_idx on public.debate_workspace_approvals(workspace_id,created_at desc) where status='pending';
create index if not exists debate_workspace_documents_idx on public.debate_workspace_documents(workspace_id,created_at desc);
create index if not exists debate_workspace_audit_idx on public.debate_workspace_audit(workspace_id,created_at desc);
create index if not exists debate_workspace_automation_idx on public.debate_workspace_automation_rules(workspace_id,event_type) where enabled;
do $$ declare t text; begin
 foreach t in array array['debate_workspace_settings','debate_workspace_invites','debate_workspace_roles','debate_workspace_tasks','debate_workspace_comments','debate_workspace_approvals','debate_workspace_documents','debate_workspace_audit','debate_workspace_automation_rules']
 loop execute format('alter table public.%I enable row level security',t); execute format('revoke all on public.%I from anon, authenticated',t); end loop;
end $$;

-- Only the server-side service role may access these tables; browser roles remain revoked.
grant all on table public.debate_workspace_settings, public.debate_workspace_invites, public.debate_workspace_roles, public.debate_workspace_tasks, public.debate_workspace_comments, public.debate_workspace_approvals, public.debate_workspace_documents, public.debate_workspace_audit, public.debate_workspace_automation_rules to service_role;
grant usage, select on sequence public.debate_workspace_audit_id_seq to service_role;
notify pgrst, 'reload schema';
