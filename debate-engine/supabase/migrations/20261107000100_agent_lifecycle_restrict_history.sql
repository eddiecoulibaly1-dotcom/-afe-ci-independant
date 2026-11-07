-- AFE-CI Agent Lifecycle Management
-- Preserve missions, runs, memories, events, approvals, messages, tool grants
-- and deliberation contributions when an agent is permanently deleted.
-- Existing CASCADE rules could erase historical records. RESTRICT makes the
-- database the final safety boundary; archival remains the normal operation.

begin;

alter table public.afe_agent_approvals
  drop constraint if exists afe_agent_approvals_requested_by_agent_id_workspace_id_fkey;
alter table public.afe_agent_approvals
  add constraint afe_agent_approvals_requested_by_agent_id_workspace_id_fkey
  foreign key (requested_by_agent_id, workspace_id)
  references public.afe_agents (id, workspace_id) on delete restrict;

alter table public.afe_agent_events
  drop constraint if exists afe_agent_events_agent_id_workspace_id_fkey;
alter table public.afe_agent_events
  add constraint afe_agent_events_agent_id_workspace_id_fkey
  foreign key (agent_id, workspace_id)
  references public.afe_agents (id, workspace_id) on delete restrict;

alter table public.afe_agent_memory
  drop constraint if exists afe_agent_memory_agent_id_workspace_id_fkey;
alter table public.afe_agent_memory
  add constraint afe_agent_memory_agent_id_workspace_id_fkey
  foreign key (agent_id, workspace_id)
  references public.afe_agents (id, workspace_id) on delete restrict;

alter table public.afe_agent_messages
  drop constraint if exists afe_agent_messages_from_agent_id_workspace_id_fkey;
alter table public.afe_agent_messages
  add constraint afe_agent_messages_from_agent_id_workspace_id_fkey
  foreign key (from_agent_id, workspace_id)
  references public.afe_agents (id, workspace_id) on delete restrict;

alter table public.afe_agent_messages
  drop constraint if exists afe_agent_messages_to_agent_id_workspace_id_fkey;
alter table public.afe_agent_messages
  add constraint afe_agent_messages_to_agent_id_workspace_id_fkey
  foreign key (to_agent_id, workspace_id)
  references public.afe_agents (id, workspace_id) on delete restrict;

alter table public.afe_agent_missions
  drop constraint if exists afe_agent_missions_agent_id_workspace_id_fkey;
alter table public.afe_agent_missions
  add constraint afe_agent_missions_agent_id_workspace_id_fkey
  foreign key (agent_id, workspace_id)
  references public.afe_agents (id, workspace_id) on delete restrict;

alter table public.afe_agent_runs
  drop constraint if exists afe_agent_runs_agent_id_workspace_id_fkey;
alter table public.afe_agent_runs
  add constraint afe_agent_runs_agent_id_workspace_id_fkey
  foreign key (agent_id, workspace_id)
  references public.afe_agents (id, workspace_id) on delete restrict;

alter table public.afe_agent_tool_grants
  drop constraint if exists afe_agent_tool_grants_agent_id_workspace_id_fkey;
alter table public.afe_agent_tool_grants
  add constraint afe_agent_tool_grants_agent_id_workspace_id_fkey
  foreign key (agent_id, workspace_id)
  references public.afe_agents (id, workspace_id) on delete restrict;

alter table public.afe_deliberation_contributions
  drop constraint if exists afe_deliberation_contributions_agent_id_workspace_id_fkey;
alter table public.afe_deliberation_contributions
  add constraint afe_deliberation_contributions_agent_id_workspace_id_fkey
  foreign key (agent_id, workspace_id)
  references public.afe_agents (id, workspace_id) on delete restrict;

commit;
