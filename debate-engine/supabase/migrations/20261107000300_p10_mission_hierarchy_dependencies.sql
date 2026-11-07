-- P10: hierarchical missions and explicit dependency graph.
-- Additive only. Apply first to an isolated TEST database after schema diff review.

begin;

alter table public.afe_agent_missions
  add column if not exists parent_mission_id uuid,
  add column if not exists orchestration_depth smallint not null default 0,
  add column if not exists orchestration_mode text not null default 'leaf',
  add column if not exists orchestration_summary jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='afe_agent_missions_parent_workspace_fk'
      and conrelid='public.afe_agent_missions'::regclass
  ) then
    alter table public.afe_agent_missions
      add constraint afe_agent_missions_parent_workspace_fk
      foreign key (parent_mission_id, workspace_id)
      references public.afe_agent_missions(id, workspace_id)
      on delete restrict;
  end if;
end $$;

alter table public.afe_agent_missions
  add constraint afe_agent_missions_not_own_parent
  check (parent_mission_id is null or parent_mission_id <> id),
  add constraint afe_agent_missions_depth_bounds
  check (orchestration_depth between 0 and 5),
  add constraint afe_agent_missions_orchestration_mode
  check (orchestration_mode in ('leaf','coordinator'));

create index if not exists afe_agent_missions_parent_idx
  on public.afe_agent_missions(workspace_id,parent_mission_id,created_at);

create table if not exists public.afe_agent_mission_dependencies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.debate_workspaces(id) on delete cascade,
  mission_id uuid not null,
  depends_on_mission_id uuid not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (mission_id,workspace_id) references public.afe_agent_missions(id,workspace_id) on delete cascade,
  foreign key (depends_on_mission_id,workspace_id) references public.afe_agent_missions(id,workspace_id) on delete restrict,
  unique (mission_id,depends_on_mission_id),
  check (mission_id <> depends_on_mission_id)
);

create index if not exists afe_agent_mission_dependencies_dependency_idx
  on public.afe_agent_mission_dependencies(workspace_id,depends_on_mission_id);

alter table public.afe_agent_mission_dependencies enable row level security;
revoke all on table public.afe_agent_mission_dependencies from anon,authenticated;
grant all on table public.afe_agent_mission_dependencies to service_role;

create or replace function public.afe_validate_mission_hierarchy()
returns trigger
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
declare
  v_depth integer;
  v_cycle boolean;
begin
  if new.parent_mission_id is null then
    new.orchestration_depth := 0;
    return new;
  end if;

  if new.parent_mission_id = new.id then
    raise exception 'mission cannot be its own parent' using errcode='23514';
  end if;

  with recursive ancestors(id,parent_mission_id,depth,path,cycle) as (
    select m.id,m.parent_mission_id,1,array[m.id]::uuid[],false
      from public.afe_agent_missions m
     where m.id=new.parent_mission_id and m.workspace_id=new.workspace_id
    union all
    select p.id,p.parent_mission_id,a.depth+1,a.path||p.id,p.id=any(a.path)
      from ancestors a
      join public.afe_agent_missions p
        on p.id=a.parent_mission_id and p.workspace_id=new.workspace_id
     where not a.cycle and a.depth<7
  )
  select coalesce(max(depth),0),bool_or(cycle)
    into v_depth, v_cycle
    from ancestors;

  if coalesce(v_cycle,false) then
    raise exception 'mission hierarchy cycle detected' using errcode='23514';
  end if;
  if v_depth=0 then
    raise exception 'parent mission not found in workspace' using errcode='23503';
  end if;
  if v_depth>=5 then
    raise exception 'maximum mission hierarchy depth exceeded' using errcode='23514';
  end if;
  new.orchestration_depth:=v_depth;
  return new;
end $$;

drop trigger if exists afe_validate_mission_hierarchy_trg on public.afe_agent_missions;
create trigger afe_validate_mission_hierarchy_trg
before insert or update of parent_mission_id,workspace_id
on public.afe_agent_missions
for each row execute function public.afe_validate_mission_hierarchy();

create or replace function public.afe_add_mission_dependency(
  p_workspace_id uuid,
  p_mission_id uuid,
  p_dependency_id uuid,
  p_actor_id uuid default null
) returns uuid
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
declare
  v_id uuid;
  v_cycle boolean;
begin
  if p_mission_id=p_dependency_id then
    raise exception 'mission cannot depend on itself' using errcode='23514';
  end if;

  if not exists(select 1 from public.afe_agent_missions where id=p_mission_id and workspace_id=p_workspace_id)
     or not exists(select 1 from public.afe_agent_missions where id=p_dependency_id and workspace_id=p_workspace_id) then
    raise exception 'mission dependency must remain inside the workspace' using errcode='23503';
  end if;

  with recursive reach(id,path,cycle) as (
    select p_dependency_id,array[p_dependency_id]::uuid[],false
    union all
    select d.depends_on_mission_id,r.path||d.depends_on_mission_id,
           d.depends_on_mission_id=any(r.path)
      from reach r
      join public.afe_agent_mission_dependencies d
        on d.mission_id=r.id and d.workspace_id=p_workspace_id
     where not r.cycle and cardinality(r.path)<100
  )
  select coalesce(bool_or(id=p_mission_id),false) into v_cycle from reach;

  if v_cycle then
    raise exception 'mission dependency cycle detected' using errcode='23514';
  end if;

  insert into public.afe_agent_mission_dependencies(workspace_id,mission_id,depends_on_mission_id,created_by)
  values(p_workspace_id,p_mission_id,p_dependency_id,p_actor_id)
  on conflict(mission_id,depends_on_mission_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.afe_agent_mission_dependencies
     where workspace_id=p_workspace_id and mission_id=p_mission_id
       and depends_on_mission_id=p_dependency_id;
  end if;
  return v_id;
end $$;

revoke all on function public.afe_add_mission_dependency(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.afe_add_mission_dependency(uuid,uuid,uuid,uuid) to service_role;

commit;
