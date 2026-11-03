-- AFE-CI repair for environments where the ledger and chick metadata migrations
-- have already been applied before the current-observations view was refreshed.
-- Safe to run after 20261102150000_market_price_security_and_chicks.sql.
-- Does not alter or delete any market observations.

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
