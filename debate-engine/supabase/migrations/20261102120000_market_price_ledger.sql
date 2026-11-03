-- AFE-CI market price ledger: append-only observations and corrections.
-- Apply manually only after review and explicit approval. Never run against production by default.
create extension if not exists pgcrypto;

create table if not exists public.market_price_import_batches (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete restrict,
  source_name text not null,
  file_name text,
  file_sha256 text not null,
  row_count integer not null check (row_count >= 0),
  inserted_count integer not null default 0 check (inserted_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  status text not null default 'received' check (status in ('received','completed','failed')),
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.market_price_observations (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.market_price_import_batches(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  source_observation_id text,
  fingerprint text not null unique,
  product text not null,
  normalized_product text not null,
  kind text not null check (kind in ('input_purchase','feed','raw_material','sale_price','transport','energy','labor','health','equipment')),
  value numeric(18,4) not null check (value >= 0),
  currency text not null,
  unit text not null,
  country text not null,
  region text,
  city text,
  source_name text not null,
  source_url text not null check (source_url ~ '^https://'),
  source_class text not null check (source_class in ('government','public_market_system','official_supplier','producer','marketplace','press','technical_publication','unknown')),
  published_at timestamptz,
  observed_at timestamptz,
  retrieved_at timestamptz not null,
  valid_until timestamptz,
  notes text,
  supersedes_id uuid references public.market_price_observations(id) on delete restrict,
  correction_reason text,
  created_at timestamptz not null default now(),
  constraint market_price_correction_reason check (
    (supersedes_id is null and correction_reason is null)
    or (supersedes_id is not null and length(trim(correction_reason)) >= 8)
  )
);

create index if not exists market_price_observations_product_geo_date_idx
  on public.market_price_observations (normalized_product, kind, country, city, observed_at desc);
create index if not exists market_price_observations_source_idx
  on public.market_price_observations (source_name, source_observation_id);
create index if not exists market_price_observations_batch_idx
  on public.market_price_observations (batch_id);

create or replace function public.reject_market_price_mutation()
returns trigger language plpgsql set search_path = pg_catalog, public as $
begin
  raise exception 'Market price observations are append-only; insert a correction instead.';
end;
$$;

drop trigger if exists market_price_observations_no_update on public.market_price_observations;
create trigger market_price_observations_no_update
  before update or delete on public.market_price_observations
  for each row execute function public.reject_market_price_mutation();

create or replace function public.validate_market_price_correction()
returns trigger language plpgsql as $$
declare original public.market_price_observations%rowtype;
begin
  if new.supersedes_id is null then return new; end if;
  select * into original from public.market_price_observations where id = new.supersedes_id;
  if not found then raise exception 'Observation to correct was not found'; end if;
  if original.created_by <> new.created_by
    or original.normalized_product <> new.normalized_product
    or original.kind <> new.kind
    or original.currency <> new.currency
    or original.unit <> new.unit
    or original.country <> new.country
    or coalesce(original.region,'') <> coalesce(new.region,'')
    or coalesce(original.city,'') <> coalesce(new.city,'')
  then raise exception 'Correction must preserve owner, product, kind, currency, unit and geography'; end if;
  if exists(select 1 from public.market_price_observations child where child.supersedes_id = original.id) then
    raise exception 'This observation already has a correction; correct the latest version instead';
  end if;
  return new;
end;
$$;

drop trigger if exists market_price_observations_validate_correction on public.market_price_observations;
create trigger market_price_observations_validate_correction
  before insert on public.market_price_observations
  for each row execute function public.validate_market_price_correction();

create or replace view public.market_price_observations_current
with (security_invoker = true) as
select o.*
from public.market_price_observations o
where not exists (
  select 1 from public.market_price_observations newer where newer.supersedes_id = o.id
);

alter table public.market_price_import_batches enable row level security;
alter table public.market_price_observations enable row level security;

drop policy if exists market_price_batches_select_own on public.market_price_import_batches;
create policy market_price_batches_select_own on public.market_price_import_batches
  for select to authenticated using (created_by = (select auth.uid()));

drop policy if exists market_price_observations_select_own on public.market_price_observations;
create policy market_price_observations_select_own on public.market_price_observations
  for select to authenticated using (created_by = auth.uid());

-- Client sessions are read-only. Server writes occur only after bearer-token validation.
grant select on public.market_price_import_batches to authenticated;
grant select on public.market_price_observations to authenticated;
grant select on public.market_price_observations_current to authenticated;

-- Explicitly deny bulk truncation to application roles; row UPDATE/DELETE are blocked by trigger.
revoke truncate on public.market_price_import_batches from anon, authenticated, service_role;
revoke truncate on public.market_price_observations from anon, authenticated, service_role;
