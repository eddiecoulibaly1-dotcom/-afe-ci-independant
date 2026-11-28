-- AFE-CI COO mission archive: immutable closure snapshots and document references.
-- Additive only. Apply to Preview/test first; never run against Production without approval.
create sequence if not exists public.afe_coo_mission_archive_number_seq;
create table if not exists public.afe_coo_mission_archives (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.debate_workspaces(id) on delete cascade,
  mission_id uuid not null references public.afe_agent_missions(id) on delete restrict,
  mission_number text not null, archive_date date not null, archived_at timestamptz not null default now(),
  mission_title text not null, department_id uuid, department_name text, agent_id uuid, agent_name text,
  mission_snapshot jsonb not null, tasks_snapshot jsonb not null default '[]'::jsonb,
  document_status text not null default 'pending' check (document_status in ('pending','partial','complete')),
  document_count integer not null default 0 check (document_count >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, mission_id), unique (workspace_id, mission_number), unique (id, workspace_id)
);
create table if not exists public.afe_coo_mission_archive_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.debate_workspaces(id) on delete cascade,
  archive_id uuid not null,
  source_document_id uuid references public.debate_workspace_documents(id) on delete set null,
  title text not null, description text not null default '', storage_path text not null, source_storage_path text not null,
  mime_type text not null default 'application/octet-stream', size_bytes bigint not null default 0 check (size_bytes >= 0),
  uploaded_by uuid references auth.users(id) on delete set null, source_created_at timestamptz,
  linked_by uuid references auth.users(id) on delete set null, linked_at timestamptz not null default now(),
  unique (archive_id, source_document_id), unique (archive_id, storage_path),
  foreign key (archive_id, workspace_id) references public.afe_coo_mission_archives(id, workspace_id) on delete cascade
);
create index if not exists afe_coo_mission_archives_date_idx on public.afe_coo_mission_archives(workspace_id, archive_date desc, mission_number desc);
create index if not exists afe_coo_mission_archive_documents_idx on public.afe_coo_mission_archive_documents(workspace_id, archive_id, linked_at desc);
alter table public.afe_coo_mission_archives enable row level security;
alter table public.afe_coo_mission_archive_documents enable row level security;
drop policy if exists afe_coo_archives_server_only on public.afe_coo_mission_archives;
create policy afe_coo_archives_server_only on public.afe_coo_mission_archives for all to anon, authenticated using (false) with check (false);
drop policy if exists afe_coo_archive_documents_server_only on public.afe_coo_mission_archive_documents;
create policy afe_coo_archive_documents_server_only on public.afe_coo_mission_archive_documents for all to anon, authenticated using (false) with check (false);
grant all on public.afe_coo_mission_archives, public.afe_coo_mission_archive_documents to service_role;
grant usage, select on sequence public.afe_coo_mission_archive_number_seq to service_role;
create or replace function public.afe_coo_archive_completed_mission() returns trigger
language plpgsql set search_path = '' as $$
declare v_number text; v_tasks jsonb; v_department text; v_agent text;
begin
  if new.status <> 'completed' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'completed' then return new; end if;
  v_number := 'MIS-' || lpad(nextval('public.afe_coo_mission_archive_number_seq')::text, 6, '0');
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at), '[]'::jsonb) into v_tasks
    from public.afe_operational_tasks t where t.workspace_id = new.workspace_id and t.mission_id = new.id;
  select d.name into v_department from public.afe_org_departments d where d.workspace_id = new.workspace_id and d.id = new.department_id;
  select a.name into v_agent from public.afe_agents a where a.workspace_id = new.workspace_id and a.id = new.agent_id;
  insert into public.afe_coo_mission_archives (workspace_id, mission_id, mission_number, archive_date, mission_title, department_id, department_name, agent_id, agent_name, mission_snapshot, tasks_snapshot)
  values (new.workspace_id, new.id, v_number, coalesce(new.completed_at::date, now()::date), new.title, new.department_id, v_department, new.agent_id, v_agent, to_jsonb(new), v_tasks)
  on conflict (workspace_id, mission_id) do nothing;
  return new;
end;
$$;
revoke all on function public.afe_coo_archive_completed_mission() from public, anon, authenticated;
grant execute on function public.afe_coo_archive_completed_mission() to service_role;
drop trigger if exists afe_coo_archive_completed_mission_trigger on public.afe_agent_missions;
create trigger afe_coo_archive_completed_mission_trigger after insert or update of status on public.afe_agent_missions
for each row execute function public.afe_coo_archive_completed_mission();
insert into public.afe_coo_mission_archives (workspace_id, mission_id, mission_number, archive_date, mission_title, department_id, department_name, agent_id, agent_name, mission_snapshot, tasks_snapshot)
select m.workspace_id, m.id, 'MIS-' || lpad(nextval('public.afe_coo_mission_archive_number_seq')::text, 6, '0'),
       coalesce(m.completed_at::date, m.updated_at::date, m.created_at::date), m.title, m.department_id, d.name, m.agent_id, a.name, to_jsonb(m),
       coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.afe_operational_tasks t where t.workspace_id=m.workspace_id and t.mission_id=m.id), '[]'::jsonb)
from public.afe_agent_missions m
left join public.afe_org_departments d on d.workspace_id=m.workspace_id and d.id=m.department_id
left join public.afe_agents a on a.workspace_id=m.workspace_id and a.id=m.agent_id
where m.status='completed' on conflict (workspace_id, mission_id) do nothing;
