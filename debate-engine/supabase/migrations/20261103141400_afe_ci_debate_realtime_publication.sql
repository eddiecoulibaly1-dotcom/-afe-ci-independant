do $$
begin
  if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
    create publication supabase_realtime;
  end if;
  begin alter publication supabase_realtime add table public.notifications; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.debate_share_links; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.admin_audit_log; exception when duplicate_object then null; end;
end $$;
alter table public.notifications replica identity full;
alter table public.debate_share_links replica identity full;
alter table public.admin_audit_log replica identity full;