create table if not exists public.afe_org_strategy_snapshots (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.debate_workspaces(id) on delete cascade,
 generated_at timestamptz not null,
 horizon_days integer not null check (horizon_days in (30,60,90)),
 strategy_snapshot jsonb not null,
 created_by uuid,
 created_at timestamptz not null default now(),
 unique(workspace_id,generated_at,horizon_days)
);
create index if not exists afe_org_strategy_snapshots_workspace_time_idx on public.afe_org_strategy_snapshots(workspace_id,generated_at desc);
alter table public.afe_org_strategy_snapshots enable row level security;
revoke all on public.afe_org_strategy_snapshots from anon,authenticated;
grant select,insert,update,delete on public.afe_org_strategy_snapshots to service_role;
