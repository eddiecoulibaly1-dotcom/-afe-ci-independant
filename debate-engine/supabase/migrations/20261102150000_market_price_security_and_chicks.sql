-- AFE-CI hardening + chick quotation metadata.
-- Apply only after review and explicit approval; intended for the isolated test project first.

-- Fingerprints are unique per owner, not globally.
alter table public.market_price_observations
  drop constraint if exists market_price_observations_fingerprint_key;
create unique index if not exists market_price_observations_owner_fingerprint_uidx
  on public.market_price_observations (created_by, fingerprint);

-- At most one direct correction per observation, including concurrent requests.
create unique index if not exists market_price_observations_one_correction_uidx
  on public.market_price_observations (supersedes_id)
  where supersedes_id is not null;

-- Composite owner key: a quotation cannot reference another user's import batch.
-- A unique index is a valid referenced key for a PostgreSQL foreign key.
create unique index if not exists market_price_import_batches_id_owner_uidx
  on public.market_price_import_batches (id, created_by);

alter table public.market_price_observations
  drop constraint if exists market_price_observations_batch_id_fkey;
alter table public.market_price_observations
  drop constraint if exists market_price_observations_batch_owner_fkey;
alter table public.market_price_observations
  add constraint market_price_observations_batch_owner_fkey
  foreign key (batch_id, created_by)
  references public.market_price_import_batches (id, created_by)
  on delete restrict;

-- Server-role privileges are explicit. Never expose this key to browser clients.
grant select, insert, update on public.market_price_import_batches to service_role;
grant select, insert on public.market_price_observations to service_role;
grant select on public.market_price_observations_current to service_role;

-- Optional attributes for chick quotations; NULL for other market observations.
alter table public.market_price_observations
  add column if not exists product_category text,
  add column if not exists strain text,
  add column if not exists vaccination_status text,
  add column if not exists minimum_quantity integer,
  add column if not exists pack_size integer,
  add column if not exists delivery_fee numeric(18,4),
  add column if not exists availability_date date;

alter table public.market_price_observations
  drop constraint if exists market_price_observations_product_category_check;
alter table public.market_price_observations
  add constraint market_price_observations_product_category_check
  check (product_category is null or product_category in ('chick','feed','raw_material','equipment','health','other'));

alter table public.market_price_observations
  drop constraint if exists market_price_observations_quantity_check;
alter table public.market_price_observations
  add constraint market_price_observations_quantity_check
  check ((minimum_quantity is null or minimum_quantity > 0)
     and (pack_size is null or pack_size > 0)
     and (delivery_fee is null or delivery_fee >= 0));

-- Every correction must preserve the quotation's identity and commercial attributes.
-- The correction API changes the price and observation metadata, not chick attributes.
create or replace function public.validate_market_price_correction()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
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
    or original.region is distinct from new.region
    or original.city is distinct from new.city
    or original.product_category is distinct from new.product_category
    or original.strain is distinct from new.strain
    or original.vaccination_status is distinct from new.vaccination_status
    or original.minimum_quantity is distinct from new.minimum_quantity
    or original.pack_size is distinct from new.pack_size
    or original.delivery_fee is distinct from new.delivery_fee
    or original.availability_date is distinct from new.availability_date
  then raise exception 'Correction must preserve owner, product, kind, currency, unit, geography and chick quotation attributes'; end if;
  if exists(select 1 from public.market_price_observations child where child.supersedes_id = original.id) then
    raise exception 'This observation already has a correction; correct the latest version instead';
  end if;
  return new;
end;
$$;

create index if not exists market_price_observations_chick_lookup_idx
  on public.market_price_observations (created_by, product_category, strain, city, observed_at desc)
  where product_category = 'chick';

-- Cover the owner and batch foreign keys for efficient deletes/joins.
create index if not exists market_price_import_batches_created_by_idx
  on public.market_price_import_batches (created_by);
create index if not exists market_price_observations_batch_owner_idx
  on public.market_price_observations (batch_id, created_by);

-- Integrity checks for source metadata and temporal consistency.
alter table public.market_price_import_batches
  drop constraint if exists market_price_import_batches_sha256_check;
alter table public.market_price_import_batches
  add constraint market_price_import_batches_sha256_check
  check (file_sha256 ~ '^[0-9a-fA-F]{64}$');

alter table public.market_price_observations
  drop constraint if exists market_price_observations_currency_unit_check;
alter table public.market_price_observations
  add constraint market_price_observations_currency_unit_check
  check (length(trim(currency)) between 3 and 8 and length(trim(unit)) between 1 and 48);

alter table public.market_price_observations
  drop constraint if exists market_price_observations_validity_check;
alter table public.market_price_observations
  add constraint market_price_observations_validity_check
  check (valid_until is null or observed_at is null or valid_until >= observed_at);

-- Refresh the view after adding chick quotation columns.
-- PostgreSQL expands SELECT * when the view is created; without this replacement,
-- the view silently omits columns added above and GET /market-prices cannot return them.
create or replace view public.market_price_observations_current
with (security_invoker = true) as
select o.*
from public.market_price_observations o
where not exists (
  select 1
  from public.market_price_observations newer
  where newer.supersedes_id = o.id
);

grant select on public.market_price_observations_current to authenticated, service_role;
