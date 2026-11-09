-- Preserve the complete delegated mission tree and its operational event history.
alter table public.afe_coo_mission_archives
  add column if not exists related_missions_snapshot jsonb not null default '[]'::jsonb;
alter table public.afe_coo_mission_archives
  add column if not exists events_snapshot jsonb not null default '[]'::jsonb;

create or replace function public.afe_coo_archive_completed_mission() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_number text;
  v_tasks jsonb;
  v_related jsonb;
  v_events jsonb;
  v_department text;
  v_agent text;
begin
  if new.status <> 'completed' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'completed' then return new; end if;

  v_number := 'MIS-' || lpad(nextval('public.afe_coo_mission_archive_number_seq')::text, 6, '0');

  with recursive mission_tree(id) as (
    select new.id
    union
    select child.id
    from public.afe_agent_missions child
    join mission_tree parent on child.parent_mission_id = parent.id
    where child.workspace_id = new.workspace_id
  )
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at), '[]'::jsonb)
    into v_tasks
  from public.afe_operational_tasks t
  where t.workspace_id = new.workspace_id and t.mission_id in (select id from mission_tree);

  with recursive mission_tree(id) as (
    select new.id
    union
    select child.id
    from public.afe_agent_missions child
    join mission_tree parent on child.parent_mission_id = parent.id
    where child.workspace_id = new.workspace_id
  )
  select coalesce(jsonb_agg(
    to_jsonb(m) || jsonb_build_object('department_name', d.name, 'agent_name', a.name)
    order by m.created_at
  ), '[]'::jsonb)
    into v_related
  from public.afe_agent_missions m
  left join public.afe_org_departments d on d.workspace_id = m.workspace_id and d.id = m.department_id
  left join public.afe_agents a on a.workspace_id = m.workspace_id and a.id = m.agent_id
  where m.workspace_id = new.workspace_id and m.id in (select id from mission_tree);

  with recursive mission_tree(id) as (
    select new.id
    union
    select child.id
    from public.afe_agent_missions child
    join mission_tree parent on child.parent_mission_id = parent.id
    where child.workspace_id = new.workspace_id
  )
  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at), '[]'::jsonb)
    into v_events
  from public.afe_agent_events e
  where e.workspace_id = new.workspace_id and e.mission_id in (select id from mission_tree);

  select d.name into v_department from public.afe_org_departments d
    where d.workspace_id = new.workspace_id and d.id = new.department_id;
  select a.name into v_agent from public.afe_agents a
    where a.workspace_id = new.workspace_id and a.id = new.agent_id;

  insert into public.afe_coo_mission_archives (
    workspace_id, mission_id, mission_number, archive_date, mission_title,
    department_id, department_name, agent_id, agent_name, mission_snapshot,
    tasks_snapshot, related_missions_snapshot, events_snapshot
  ) values (
    new.workspace_id, new.id, v_number, coalesce(new.completed_at::date, now()::date), new.title,
    new.department_id, v_department, new.agent_id, v_agent, to_jsonb(new),
    v_tasks, v_related, v_events
  ) on conflict (workspace_id, mission_id) do nothing;

  return new;
end;
$$;

-- Backfill the expanded snapshots for every previously archived mission.
with recursive mission_tree(archive_id, workspace_id, mission_id) as (
  select a.id, a.workspace_id, a.mission_id
  from public.afe_coo_mission_archives a
  union
  select tree.archive_id, tree.workspace_id, child.id
  from mission_tree tree
  join public.afe_agent_missions child
    on child.parent_mission_id = tree.mission_id and child.workspace_id = tree.workspace_id
),
related as (
  select tree.archive_id,
    coalesce(jsonb_agg(to_jsonb(m) || jsonb_build_object('department_name', d.name, 'agent_name', ag.name) order by m.created_at), '[]'::jsonb) as snapshot
  from mission_tree tree
  join public.afe_agent_missions m on m.id = tree.mission_id and m.workspace_id = tree.workspace_id
  left join public.afe_org_departments d on d.workspace_id = m.workspace_id and d.id = m.department_id
  left join public.afe_agents ag on ag.workspace_id = m.workspace_id and ag.id = m.agent_id
  group by tree.archive_id
),
tasks as (
  select tree.archive_id, coalesce(jsonb_agg(to_jsonb(t) order by t.created_at), '[]'::jsonb) as snapshot
  from mission_tree tree
  join public.afe_operational_tasks t on t.mission_id = tree.mission_id and t.workspace_id = tree.workspace_id
  group by tree.archive_id
),
events as (
  select tree.archive_id, coalesce(jsonb_agg(to_jsonb(e) order by e.created_at), '[]'::jsonb) as snapshot
  from mission_tree tree
  join public.afe_agent_events e on e.mission_id = tree.mission_id and e.workspace_id = tree.workspace_id
  group by tree.archive_id
)
update public.afe_coo_mission_archives a
set related_missions_snapshot = coalesce(related.snapshot, '[]'::jsonb),
    tasks_snapshot = coalesce(tasks.snapshot, '[]'::jsonb),
    events_snapshot = coalesce(events.snapshot, '[]'::jsonb),
    updated_at = now()
from related
left join tasks on tasks.archive_id = related.archive_id
left join events on events.archive_id = related.archive_id
where a.id = related.archive_id;
