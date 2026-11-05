-- Default-deny direct client access and cover all new foreign keys with indexes.
do $$ declare t text; begin foreach t in array array['debate_workspace_settings','debate_workspace_invites','debate_workspace_roles','debate_workspace_tasks','debate_workspace_comments','debate_workspace_approvals','debate_workspace_documents','debate_workspace_audit','debate_workspace_automation_rules'] loop execute format('drop policy if exists deny_direct_client_access on public.%I',t); execute format('create policy deny_direct_client_access on public.%I for all to anon, authenticated using (false) with check (false)',t); end loop; end $$;
create index if not exists debate_workspace_invites_email_pending_idx on public.debate_workspace_invites(email) where accepted_at is null and revoked_at is null;
create index if not exists debate_workspace_invites_accepted_by_idx on public.debate_workspace_invites(accepted_by);
create index if not exists debate_workspace_invites_invited_by_idx on public.debate_workspace_invites(invited_by);
create index if not exists debate_workspace_roles_created_by_idx on public.debate_workspace_roles(created_by);
create index if not exists debate_workspace_settings_created_by_idx on public.debate_workspace_settings(created_by);
create index if not exists debate_workspace_tasks_assigned_to_idx on public.debate_workspace_tasks(assigned_to);
create index if not exists debate_workspace_tasks_created_by_idx on public.debate_workspace_tasks(created_by);
create index if not exists debate_workspace_comments_debate_id_idx on public.debate_workspace_comments(debate_id);
create index if not exists debate_workspace_comments_author_id_idx on public.debate_workspace_comments(author_id);
create index if not exists debate_workspace_comments_parent_id_idx on public.debate_workspace_comments(parent_id);
create index if not exists debate_workspace_approvals_debate_id_idx on public.debate_workspace_approvals(debate_id);
create index if not exists debate_workspace_approvals_requested_by_idx on public.debate_workspace_approvals(requested_by);
create index if not exists debate_workspace_approvals_decided_by_idx on public.debate_workspace_approvals(decided_by);
create index if not exists debate_workspace_documents_debate_id_idx on public.debate_workspace_documents(debate_id);
create index if not exists debate_workspace_documents_uploaded_by_idx on public.debate_workspace_documents(uploaded_by);
create index if not exists debate_workspace_audit_actor_id_idx on public.debate_workspace_audit(actor_id);
create index if not exists debate_workspace_automation_created_by_idx on public.debate_workspace_automation_rules(created_by);
