-- E12 strategic decision packs: workspace-scoped server-side persistence.
create table if not exists public.afe_org_decision_packs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.debate_workspaces(id) on delete cascade,
  decision_pack_id text not null,
  payload jsonb not null,
  status text not null default 'draft' check (status in ('draft','submitted','approved','rejected','returned-for-revision','execution-authorized','evaluating','closed')),
  created_by uuid,
  audit_events jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, decision_pack_id)
);
create index if not exists afe_org_decision_packs_workspace_status_idx on public.afe_org_decision_packs(workspace_id,status,updated_at desc);
alter table public.afe_org_decision_packs enable row level security;
revoke all on public.afe_org_decision_packs from anon, authenticated;
grant all on public.afe_org_decision_packs to service_role;
