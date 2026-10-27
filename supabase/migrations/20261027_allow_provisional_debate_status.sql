-- Keep the database state machine aligned with the Debate Engine terminal states.
-- V1.0.7 can legitimately finish with a provisional decision when evidence is incomplete.
alter table public.debates drop constraint if exists debates_status_check;
alter table public.debates add constraint debates_status_check
  check (status = any (array['running'::text,'converged'::text,'provisional'::text,'unresolved'::text,'failed'::text]));
