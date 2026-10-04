-- Read-only verification AFTER applying migration 003. All columns should be true.
select
  to_regclass('public.profiles') is not null as profiles_table,
  to_regprocedure('public.get_my_profile()') is not null as profile_read_rpc,
  to_regprocedure('public.update_my_profile(text,integer)') is not null as profile_update_rpc,
  to_regprocedure('public.rename_group(uuid,text,integer)') is not null as group_rename_rpc,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='groups' and column_name='version') as group_versions,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='group_members' and column_name='nickname') as group_nicknames,
  exists(select 1 from pg_catalog.pg_class where oid=to_regclass('public.profiles') and relrowsecurity) as profile_rls;
