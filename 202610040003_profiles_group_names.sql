-- Upgrade an existing installation AFTER migrations 001 and 002.
-- No trips, activities, preferences, invitations or existing names are deleted.
-- Existing group names remain aliases until a member explicitly clears them.
begin;

do $$
begin
  if to_regprocedure('public.set_member_display_name(uuid,text)') is null then
    raise exception 'Install migrations 001 and 002 before this upgrade. No changes applied.';
  end if;
  if to_regclass('public.profiles') is not null then
    raise exception 'Profiles already exist. Check migration history before rerunning. No changes applied.';
  end if;
end $$;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 80),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy profiles_read_self on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;

-- Replace the old name-column grant: all renames must use version-checked RPC.
revoke update(name) on public.groups from public,anon,authenticated;
revoke update on public.groups from public,anon,authenticated;
alter table public.groups add column version integer not null default 1 check (version > 0);
alter table public.group_members add column nickname text check (length(nickname) between 1 and 80);
-- Preserve previously chosen group-specific names, rather than silently overwriting them.
update public.group_members set nickname = nullif(btrim(display_name), '');

-- display_name remains a membership-scoped projection. Other users never read profiles.
-- Use the same per-user lock for profile updates and new memberships to avoid stale copies.
create function app_private.project_member_name() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('profile:' || new.user_id::text, 0));
  new.display_name := coalesce(new.nickname,
    (select p.display_name from public.profiles p where p.user_id = new.user_id), '');
  return new;
end $$;
create trigger member_name_projection before insert or update of nickname,display_name
  on public.group_members for each row execute function app_private.project_member_name();
revoke all on function app_private.project_member_name() from public,anon,authenticated;

create function public.get_my_profile() returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select jsonb_build_object('display_name',p.display_name,'version',p.version)
    into v_result from public.profiles p where p.user_id = auth.uid();
  return coalesce(v_result, jsonb_build_object('display_name','','version',0));
end $$;

create function public.update_my_profile(p_display_name text,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_version integer;
begin
  v_user := app_private.require_user();
  if p_display_name is null or length(btrim(p_display_name)) not between 1 and 80
     or p_display_name ~ '[[:cntrl:]]' then
    raise exception 'Invalid display name (1-80 characters required)' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('profile:' || v_user::text,0));
  select version into v_version from public.profiles where user_id=v_user for update;
  if p_expected_version is null or p_expected_version is distinct from coalesce(v_version,0) then
    raise exception 'Profile changed; refresh before saving' using errcode='40001';
  end if;
  insert into public.profiles(user_id,display_name) values(v_user,btrim(p_display_name))
    on conflict(user_id) do update set display_name=excluded.display_name,
      version=public.profiles.version+1,updated_at=now();
  update public.group_members set display_name=btrim(p_display_name)
    where user_id=v_user and nickname is null;
  return public.get_my_profile();
end $$;

-- Empty nickname means "use my account name"; only the caller's own membership is writable.
create or replace function public.set_member_display_name(p_group_id uuid,p_display_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_user();
  if p_display_name is null or length(btrim(p_display_name))>80 or p_display_name ~ '[[:cntrl:]]' then
    raise exception 'Invalid display name' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('profile:' || auth.uid()::text,0));
  perform app_private.lock_member(p_group_id,false);
  update public.group_members set nickname=nullif(btrim(p_display_name),'')
    where group_id=p_group_id and user_id=auth.uid();
end $$;

create function public.rename_group(p_group_id uuid,p_name text,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_version integer; v_result jsonb;
begin
  perform app_private.lock_member(p_group_id,true);
  if p_name is null or length(btrim(p_name)) not between 1 and 120 or p_name ~ '[[:cntrl:]]' then
    raise exception 'Invalid group name' using errcode='22023';
  end if;
  select version into v_version from public.groups where id=p_group_id for update;
  if p_expected_version is null or v_version is distinct from p_expected_version then
    raise exception 'Group changed; refresh before saving' using errcode='40001';
  end if;
  update public.groups set name=btrim(p_name),version=version+1 where id=p_group_id
    returning jsonb_build_object('id',id,'name',name,'created_by',created_by,'version',version) into v_result;
  return v_result;
end $$;

revoke all on function public.get_my_profile(), public.update_my_profile(text,integer),
  public.set_member_display_name(uuid,text), public.rename_group(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.get_my_profile(), public.update_my_profile(text,integer),
  public.set_member_display_name(uuid,text), public.rename_group(uuid,text,integer) to authenticated;
-- Existing group SELECT includes version and nickname; no direct mutation grants are added.
notify pgrst, 'reload schema';
commit;
