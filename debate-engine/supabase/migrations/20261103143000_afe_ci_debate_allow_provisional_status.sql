-- Keep the debate lifecycle status constraint aligned with src/types.ts.
-- "provisional" is a valid terminal state when a recommendation is made
-- but evidence or validation gaps remain.
alter table public.debates drop constraint if exists debates_status_check;

alter table public.debates
  add constraint debates_status_check
  check (status in ('running', 'converged', 'provisional', 'unresolved', 'failed'));
