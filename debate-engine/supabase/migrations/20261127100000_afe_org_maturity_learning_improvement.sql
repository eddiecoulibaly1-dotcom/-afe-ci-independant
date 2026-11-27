-- E10 organizational maturity, learning and improvement proposal storage.
-- API access is workspace-validated server-side; direct client access remains denied.
create table if not exists public.afe_org_health_snapshots (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.debate_workspaces(id) on delete cascade,
 generated_at timestamptz not null,
 health_snapshot jsonb not null,
 root_cause_snapshot jsonb not null default '[]'::jsonb,
 created_by uuid,
 created_at timestamptz not null default now(),
 unique(workspace_id,generated_at)
);
create index if not exists afe_org_health_snapshots_recent_idx on public.afe_org_health_snapshots(workspace_id,generated_at desc);
create table if not exists public.afe_org_learning_memory (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.debate_workspaces(id) on delete cascade,
 memory_item jsonb not null,
 created_by uuid,
 created_at timestamptz not null default now()
);
create index if not exists afe_org_learning_memory_recent_idx on public.afe_org_learning_memory(workspace_id,created_at desc);
create table if not exists public.afe_org_improvement_proposals (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.debate_workspaces(id) on delete cascade,
 proposal_id text not null,
 proposal jsonb not null,
 status text not null default 'draft' check(status in ('draft','submitted','approved','rejected','implemented','evaluated')),
 created_by uuid,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(workspace_id,proposal_id)
);
create index if not exists afe_org_improvement_proposals_status_idx on public.afe_org_improvement_proposals(workspace_id,status,updated_at desc);
create table if not exists public.afe_org_improvement_proposal_events (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.debate_workspaces(id) on delete cascade,
 proposal_id uuid not null references public.afe_org_improvement_proposals(id) on delete cascade,
 action text not null,
 actor_id uuid,
 event_data jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create index if not exists afe_org_proposal_events_idx on public.afe_org_improvement_proposal_events(workspace_id,proposal_id,created_at);
alter table public.afe_org_health_snapshots enable row level security;
alter table public.afe_org_learning_memory enable row level security;
alter table public.afe_org_improvement_proposals enable row level security;
alter table public.afe_org_improvement_proposal_events enable row level security;
revoke all on public.afe_org_health_snapshots,public.afe_org_learning_memory,public.afe_org_improvement_proposals,public.afe_org_improvement_proposal_events from anon,authenticated;
grant select,insert,update,delete on public.afe_org_health_snapshots,public.afe_org_learning_memory,public.afe_org_improvement_proposals,public.afe_org_improvement_proposal_events to service_role;
create or replace function public.afe_org_proposal_events_immutable() returns trigger language plpgsql as $$ begin raise exception 'Organizational proposal events are immutable'; end $$;
drop trigger if exists afe_org_proposal_events_immutable on public.afe_org_improvement_proposal_events;
create trigger afe_org_proposal_events_immutable before update or delete on public.afe_org_improvement_proposal_events for each row execute function public.afe_org_proposal_events_immutable();
