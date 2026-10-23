create extension if not exists pgcrypto;

create table if not exists public.debates (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  context text,
  mode text not null default 'decision' check (mode in ('exploration','decision','validation')),
  status text not null default 'running' check (status in ('running','converged','unresolved','failed')),
  config jsonb not null default '{}'::jsonb,
  final_decision jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.debate_rounds (
  id uuid primary key default gen_random_uuid(),
  debate_id uuid not null references public.debates(id) on delete cascade,
  round_number integer not null check (round_number > 0),
  architect_proposal jsonb not null,
  red_team_critique jsonb not null,
  judge_decision jsonb not null,
  created_at timestamptz not null default now(),
  unique (debate_id, round_number)
);

create table if not exists public.debate_events (
  id uuid primary key default gen_random_uuid(),
  debate_id uuid not null references public.debates(id) on delete cascade,
  round_id uuid references public.debate_rounds(id) on delete cascade,
  event_type text not null,
  actor text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.debate_hypotheses (
  id uuid primary key default gen_random_uuid(),
  debate_id uuid not null references public.debates(id) on delete cascade,
  statement text not null,
  status text not null default 'open' check (status in ('open','supported','rejected','untested')),
  confidence numeric(5,2) check (confidence >= 0 and confidence <= 100),
  source_round integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.debate_evidence (
  id uuid primary key default gen_random_uuid(),
  debate_id uuid not null references public.debates(id) on delete cascade,
  round_id uuid references public.debate_rounds(id) on delete set null,
  kind text not null check (kind in ('source','experiment','metric','user_input','model_claim','other')),
  title text not null,
  url text,
  excerpt text,
  strength numeric(5,2) check (strength >= 0 and strength <= 100),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.debate_decisions (
  id uuid primary key default gen_random_uuid(),
  debate_id uuid not null references public.debates(id) on delete cascade,
  decision_type text not null check (decision_type in ('intermediate','final','unresolved')),
  statement text not null,
  score numeric(5,2) check (score >= 0 and score <= 100),
  rationale jsonb not null default '[]'::jsonb,
  status text not null check (status in ('proposed','accepted','rejected','needs_validation')),
  created_at timestamptz not null default now()
);

create index if not exists idx_debate_rounds_debate on public.debate_rounds(debate_id, round_number);
create index if not exists idx_debate_events_debate on public.debate_events(debate_id, created_at);
create index if not exists idx_debate_hypotheses_debate on public.debate_hypotheses(debate_id, status);
create index if not exists idx_debate_evidence_debate on public.debate_evidence(debate_id, created_at);
create index if not exists idx_debate_decisions_debate on public.debate_decisions(debate_id, created_at);

create or replace function public.set_debate_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_debates_updated_at on public.debates;
create trigger trg_debates_updated_at before update on public.debates for each row execute function public.set_debate_updated_at();

drop trigger if exists trg_debate_hypotheses_updated_at on public.debate_hypotheses;
create trigger trg_debate_hypotheses_updated_at before update on public.debate_hypotheses for each row execute function public.set_debate_updated_at();

alter table public.debates enable row level security;
alter table public.debate_rounds enable row level security;
alter table public.debate_events enable row level security;
alter table public.debate_hypotheses enable row level security;
alter table public.debate_evidence enable row level security;
alter table public.debate_decisions enable row level security;

revoke all on public.debates from anon, authenticated;
revoke all on public.debate_rounds from anon, authenticated;
revoke all on public.debate_events from anon, authenticated;
revoke all on public.debate_hypotheses from anon, authenticated;
revoke all on public.debate_evidence from anon, authenticated;
revoke all on public.debate_decisions from anon, authenticated;
