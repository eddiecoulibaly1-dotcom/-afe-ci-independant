do $$ begin
 if not exists(select 1 from pg_constraint where conname='debates_workspace_id_fkey' and conrelid='public.debates'::regclass) then
  alter table public.debates add constraint debates_workspace_id_fkey foreign key(workspace_id) references public.debate_workspaces(id) on delete set null;
 end if;
end $$;
notify pgrst, 'reload schema';