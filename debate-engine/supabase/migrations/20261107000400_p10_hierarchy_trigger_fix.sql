-- P10 hotfix: correct hierarchy trigger boolean assignment.
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
      join public.afe_agent_missions p on p.id=a.parent_mission_id and p.workspace_id=new.workspace_id
     where not a.cycle and a.depth<7
  )
  select coalesce(max(depth),0),coalesce(bool_or(cycle),false)
    into v_depth,v_cycle
    from ancestors;
  if v_cycle then raise exception 'mission hierarchy cycle detected' using errcode='23514'; end if;
  if v_depth=0 then raise exception 'parent mission not found in workspace' using errcode='23503'; end if;
  if v_depth>=5 then raise exception 'maximum mission hierarchy depth exceeded' using errcode='23514'; end if;
  new.orchestration_depth:=v_depth;
  return new;
end $$;