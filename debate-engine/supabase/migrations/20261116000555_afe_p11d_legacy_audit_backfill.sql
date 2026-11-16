-- P1.1-D: repair legacy COO mission/task rows that predate atomic creation.
-- This is data-only reconciliation: it never recreates or modifies missions/tasks.
INSERT INTO public.afe_agent_events(
  workspace_id, mission_id, agent_id, actor_type, actor_id, event_type, payload
)
SELECT m.workspace_id,m.id,m.agent_id,'human',m.created_by,'coo.mission.created',
  pg_catalog.jsonb_build_object('title',m.title,'departmentId',m.department_id,
    'operationalOwnerUserId',m.operational_owner_user_id,'dueAt',m.due_at,
    'idempotencyKey',m.idempotency_key,'backfilled',true,
    'backfillMigration','afe_p11d_legacy_audit_backfill','originalCreatedAt',m.created_at)
FROM public.afe_agent_missions m
WHERE m.department_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.afe_agent_events e
    WHERE e.workspace_id=m.workspace_id AND e.mission_id=m.id
      AND e.event_type='coo.mission.created');

INSERT INTO public.debate_workspace_audit(
  workspace_id,actor_id,action,entity_type,entity_id,details
)
SELECT m.workspace_id,m.created_by,'coo.mission.created','mission',m.id::text,
  pg_catalog.jsonb_build_object('departmentId',m.department_id,'agentId',m.agent_id,
    'operationalOwnerUserId',m.operational_owner_user_id,'dueAt',m.due_at,
    'idempotencyKey',m.idempotency_key,'backfilled',true,
    'backfillMigration','afe_p11d_legacy_audit_backfill','originalCreatedAt',m.created_at)
FROM public.afe_agent_missions m
WHERE m.department_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.debate_workspace_audit a
    WHERE a.workspace_id=m.workspace_id AND a.action='coo.mission.created'
      AND a.entity_type='mission' AND a.entity_id=m.id::text);

INSERT INTO public.debate_workspace_audit(
  workspace_id,actor_id,action,entity_type,entity_id,details
)
SELECT t.workspace_id,t.created_by,'coo.task.created','task',t.id::text,
  pg_catalog.jsonb_build_object('departmentId',t.department_id,'missionId',t.mission_id,
    'assignedAgentId',t.assigned_agent_id,'assignedUserId',t.assigned_user_id,
    'idempotencyKey',t.idempotency_key,'backfilled',true,
    'backfillMigration','afe_p11d_legacy_audit_backfill','originalCreatedAt',t.created_at)
FROM public.afe_operational_tasks t
WHERE t.department_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.debate_workspace_audit a
    WHERE a.workspace_id=t.workspace_id AND a.action='coo.task.created'
      AND a.entity_type='task' AND a.entity_id=t.id::text);

NOTIFY pgrst, 'reload schema';
