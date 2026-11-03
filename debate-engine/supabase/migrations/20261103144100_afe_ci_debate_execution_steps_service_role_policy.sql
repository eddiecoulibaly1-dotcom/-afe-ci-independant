-- Explicitly document the server-only access path; browser roles remain ungranted.
create policy debate_execution_steps_service_role_all
on public.debate_execution_steps
for all
to service_role
using (true)
with check (true);
