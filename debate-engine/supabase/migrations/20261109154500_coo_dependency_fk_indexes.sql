-- Cover the foreign keys introduced by the COO dependency intelligence schema.
CREATE INDEX IF NOT EXISTS afe_coo_deliverables_task_fk_idx
  ON public.afe_coo_deliverables(producer_task_id, workspace_id);
CREATE INDEX IF NOT EXISTS afe_coo_deliverables_mission_fk_idx
  ON public.afe_coo_deliverables(producer_mission_id, workspace_id);
CREATE INDEX IF NOT EXISTS afe_coo_deliverables_department_fk_idx
  ON public.afe_coo_deliverables(department_id, workspace_id);
CREATE INDEX IF NOT EXISTS afe_coo_deliverables_submitted_by_idx
  ON public.afe_coo_deliverables(submitted_by);
CREATE INDEX IF NOT EXISTS afe_coo_deliverables_accepted_by_idx
  ON public.afe_coo_deliverables(accepted_by);
CREATE INDEX IF NOT EXISTS afe_coo_deliverables_source_event_idx
  ON public.afe_coo_deliverables(source_event_id);
CREATE INDEX IF NOT EXISTS afe_coo_deliverables_supersedes_fk_idx
  ON public.afe_coo_deliverables(supersedes_id, workspace_id);

CREATE INDEX IF NOT EXISTS afe_coo_dependency_edges_dependent_task_fk_idx
  ON public.afe_coo_dependency_edges(dependent_task_id, workspace_id);
CREATE INDEX IF NOT EXISTS afe_coo_dependency_edges_dependent_mission_fk_idx
  ON public.afe_coo_dependency_edges(dependent_mission_id, workspace_id);
CREATE INDEX IF NOT EXISTS afe_coo_dependency_edges_prereq_task_fk_idx
  ON public.afe_coo_dependency_edges(prerequisite_task_id, workspace_id);
CREATE INDEX IF NOT EXISTS afe_coo_dependency_edges_prereq_mission_fk_idx
  ON public.afe_coo_dependency_edges(prerequisite_mission_id, workspace_id);
CREATE INDEX IF NOT EXISTS afe_coo_dependency_edges_prereq_department_fk_idx
  ON public.afe_coo_dependency_edges(prerequisite_department_id, workspace_id);
CREATE INDEX IF NOT EXISTS afe_coo_dependency_edges_deliverable_fk_idx
  ON public.afe_coo_dependency_edges(required_deliverable_id, workspace_id);
CREATE INDEX IF NOT EXISTS afe_coo_dependency_edges_proposed_by_idx
  ON public.afe_coo_dependency_edges(proposed_by);
CREATE INDEX IF NOT EXISTS afe_coo_dependency_edges_reviewed_by_idx
  ON public.afe_coo_dependency_edges(reviewed_by);

CREATE INDEX IF NOT EXISTS afe_coo_dependency_events_edge_fk_idx
  ON public.afe_coo_dependency_events(edge_id, workspace_id);
CREATE INDEX IF NOT EXISTS afe_coo_dependency_events_deliverable_fk_idx
  ON public.afe_coo_dependency_events(deliverable_id, workspace_id);
CREATE INDEX IF NOT EXISTS afe_coo_dependency_events_actor_idx
  ON public.afe_coo_dependency_events(actor_id);

CREATE INDEX IF NOT EXISTS afe_coo_escalations_edge_fk_idx
  ON public.afe_coo_escalations(edge_id, workspace_id);
CREATE INDEX IF NOT EXISTS afe_coo_escalations_department_fk_idx
  ON public.afe_coo_escalations(responsible_department_id, workspace_id);
CREATE INDEX IF NOT EXISTS afe_coo_escalations_owner_idx
  ON public.afe_coo_escalations(responsible_owner_user_id);
CREATE INDEX IF NOT EXISTS afe_coo_escalations_dg_idx
  ON public.afe_coo_escalations(dg_user_id);
