-- Collaborative preferences, comments and a separately edited official plan.
-- Requires 202610040001_private_groups.sql. No private seed data.
begin;

alter table public.trips add column start_date date
  check (start_date between date '0001-01-01' and date '9999-12-31');
alter table public.group_members add column display_name text not null default ''
  check (length(display_name) <= 80);
alter table public.activities add constraint activities_trip_id_id_unique unique (trip_id,id);

create table public.activity_preferences (
  trip_id uuid not null references public.trips(id) on delete cascade,
  activity_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  choice text not null check (choice in ('must','yes','maybe','skip')),
  priority integer not null default 0 check (priority between 0 and 5),
  note text not null default '' check (length(note) <= 1000),
  updated_at timestamptz not null default now(),
  primary key(activity_id,user_id),
  foreign key(trip_id,activity_id) references public.activities(trip_id,id) on delete cascade
);
create index preferences_by_trip on public.activity_preferences(trip_id);
create table public.activity_comments (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  activity_id uuid not null,
  created_by uuid not null references auth.users(id),
  body text not null check (length(btrim(body)) between 1 and 3000),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(trip_id,activity_id) references public.activities(trip_id,id) on delete cascade
);
create index comments_by_trip_activity on public.activity_comments(trip_id,activity_id,created_at);
create table public.itinerary_days (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  day_number integer not null check(day_number between 1 and 365),
  title text not null default '' check(length(title) <= 120),
  stop_id uuid,
  notes text not null default '' check(length(notes) <= 3000),
  unique(trip_id,id),
  unique(trip_id,day_number),
  foreign key(trip_id,stop_id) references public.trip_stops(trip_id,id)
);
create table public.itinerary_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  day_id uuid not null,
  activity_id uuid,
  title text not null check(length(btrim(title)) between 1 and 200),
  position integer not null default 0 check(position between 0 and 10000),
  time_slot text check(time_slot ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$'),
  duration_minutes integer check(duration_minutes between 0 and 1440),
  notes text not null default '' check(length(notes) <= 3000),
  is_alternative boolean not null default false,
  subgroup text not null default '' check(length(subgroup) <= 120),
  foreign key(trip_id,day_id) references public.itinerary_days(trip_id,id),
  foreign key(trip_id,activity_id) references public.activities(trip_id,id)
);
create index itinerary_items_by_day on public.itinerary_items(trip_id,day_id,position);
create table public.plan_approvals (
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  version integer not null check(version > 0),
  approved_at timestamptz not null default now(),
  primary key(trip_id,user_id)
);

alter table public.activity_preferences enable row level security;
alter table public.activity_comments enable row level security;
alter table public.itinerary_days enable row level security;
alter table public.itinerary_items enable row level security;
alter table public.plan_approvals enable row level security;
create policy preferences_read on public.activity_preferences for select to authenticated using(app_private.trip_member(trip_id));
create policy comments_read on public.activity_comments for select to authenticated using(app_private.trip_member(trip_id));
create policy itinerary_days_read on public.itinerary_days for select to authenticated using(app_private.trip_member(trip_id));
create policy itinerary_items_read on public.itinerary_items for select to authenticated using(app_private.trip_member(trip_id));
create policy plan_approvals_read on public.plan_approvals for select to authenticated using(app_private.trip_member(trip_id));
revoke all on public.activity_preferences, public.activity_comments, public.itinerary_days, public.itinerary_items, public.plan_approvals from public,anon,authenticated;
grant select on public.activity_preferences, public.activity_comments, public.itinerary_days, public.itinerary_items, public.plan_approvals to authenticated;
-- Existing member SELECT privilege intentionally includes the new display_name.
-- No direct start_date/display_name writes are granted: the RPCs control them.

create trigger itinerary_days_touch after insert or update or delete on public.itinerary_days for each row execute function app_private.touch_trip();
create trigger itinerary_items_touch after insert or update or delete on public.itinerary_items for each row execute function app_private.touch_trip();
create trigger comments_version before update on public.activity_comments for each row execute function app_private.bump_version();

create function app_private.clear_removed_member_choices() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.activity_preferences p using public.trips t where p.trip_id=t.id and t.group_id=old.group_id and p.user_id=old.user_id;
  delete from public.plan_approvals a using public.trips t where a.trip_id=t.id and t.group_id=old.group_id and a.user_id=old.user_id;
  return old;
end $$;
create trigger removed_member_choices before delete on public.group_members for each row execute function app_private.clear_removed_member_choices();

create function app_private.lock_plan(p_trip_id uuid,p_editor boolean default true) returns integer
language plpgsql set search_path = '' as $$
declare v_group uuid; v_version integer;
begin
  select group_id into v_group from public.trips where id=p_trip_id;
  perform app_private.lock_member(v_group,p_editor);
  select version into v_version from public.trips where id=p_trip_id for update;
  if not found then raise exception 'Not authorized' using errcode='42501'; end if;
  return v_version;
end $$;
create function app_private.check_plan_version(p_actual integer,p_expected integer) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_expected is null or p_actual is distinct from p_expected then
    raise exception 'Plan changed; refresh before saving' using errcode='40001';
  end if;
end $$;
create function app_private.json_integer(p_object jsonb,p_key text,p_min integer,p_max integer,p_nullable boolean default false) returns integer
language plpgsql immutable set search_path = '' as $$
declare v_value numeric;
begin
  if p_nullable and p_object->p_key = 'null'::jsonb then return null; end if;
  if jsonb_typeof(p_object->p_key) is distinct from 'number' then raise exception 'Invalid integer field' using errcode='22023'; end if;
  v_value := (p_object->>p_key)::numeric;
  if v_value<>trunc(v_value) or v_value<p_min or v_value>p_max then raise exception 'Invalid integer range' using errcode='22023'; end if;
  return v_value::integer;
end $$;
create function app_private.json_uuid(p_object jsonb,p_key text,p_nullable boolean default true) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  if p_nullable and p_object->p_key = 'null'::jsonb then return null; end if;
  return app_private.import_text(p_object,p_key,36,true)::uuid;
end $$;

create function public.set_activity_preference(p_activity_id uuid,p_choice text,p_priority integer,p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_trip uuid; v_group uuid;
begin
  perform app_private.require_user();
  select a.trip_id,t.group_id into v_trip,v_group from public.activities a join public.trips t on t.id=a.trip_id where a.id=p_activity_id;
  perform app_private.lock_member(v_group,false);
  if p_choice is null then
    delete from public.activity_preferences where activity_id=p_activity_id and user_id=auth.uid();
    return;
  end if;
  if p_choice not in ('must','yes','maybe','skip') or p_priority is null or p_priority not between 0 and 5 or p_note is null or length(p_note)>1000 then raise exception 'Invalid preference' using errcode='22023'; end if;
  insert into public.activity_preferences(trip_id,activity_id,user_id,choice,priority,note)
  values(v_trip,p_activity_id,auth.uid(),p_choice,p_priority,p_note)
  on conflict(activity_id,user_id) do update set choice=excluded.choice,priority=excluded.priority,note=excluded.note,updated_at=now();
end $$;

create function public.create_activity_comment(p_activity_id uuid,p_body text,p_request_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_trip uuid; v_group uuid; v_id uuid; v_args jsonb := jsonb_build_object('activity_id',p_activity_id,'body',p_body);
begin
  perform app_private.require_user();
  select a.trip_id,t.group_id into v_trip,v_group from public.activities a join public.trips t on t.id=a.trip_id where a.id=p_activity_id;
  perform app_private.lock_member(v_group,false);
  v_id := app_private.operation_result('create_activity_comment',p_request_id,v_args);
  if v_id is not null then return v_id; end if;
  insert into public.activity_comments(trip_id,activity_id,created_by,body) values(v_trip,p_activity_id,auth.uid(),btrim(p_body)) returning id into v_id;
  perform app_private.save_operation('create_activity_comment',p_request_id,v_args,v_id);
  return v_id;
end $$;
create function public.edit_activity_comment(p_comment_id uuid,p_body text,p_expected_version integer) returns void
language plpgsql security definer set search_path = '' as $$
declare v_group uuid; v_author uuid; v_version integer;
begin
  perform app_private.require_user();
  select t.group_id into v_group from public.activity_comments c join public.trips t on t.id=c.trip_id where c.id=p_comment_id;
  perform app_private.lock_member(v_group,false);
  select created_by,version into v_author,v_version from public.activity_comments where id=p_comment_id for update;
  if v_author is distinct from auth.uid() then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_expected_version is null or v_version is distinct from p_expected_version then raise exception 'Comment changed; refresh before saving' using errcode='40001'; end if;
  update public.activity_comments set body=btrim(p_body),updated_at=now() where id=p_comment_id;
end $$;
create function public.delete_activity_comment(p_comment_id uuid,p_expected_version integer) returns void
language plpgsql security definer set search_path = '' as $$
declare v_group uuid; v_author uuid; v_version integer;
begin
  perform app_private.require_user();
  select t.group_id into v_group from public.activity_comments c join public.trips t on t.id=c.trip_id where c.id=p_comment_id;
  perform app_private.lock_member(v_group,false);
  select created_by,version into v_author,v_version from public.activity_comments where id=p_comment_id for update;
  if v_author is distinct from auth.uid() and not app_private.is_editor(v_group) then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_expected_version is null or v_version is distinct from p_expected_version then raise exception 'Comment changed; refresh before deleting' using errcode='40001'; end if;
  delete from public.activity_comments where id=p_comment_id;
end $$;

create function public.save_itinerary_day(p_trip_id uuid,p_day_id uuid,p_fields jsonb,p_expected_version integer,p_request_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_version integer; v_id uuid; v_old public.itinerary_days; v_fields jsonb; v_args jsonb; v_number integer; v_title text; v_notes text; v_stop uuid;
begin
  v_version := app_private.lock_plan(p_trip_id,true);
  perform app_private.allowed_keys(p_fields,array['day_number','title','stop_id','notes']);
  v_args := jsonb_build_object('trip_id',p_trip_id,'day_id',p_day_id,'fields',p_fields,'expected_version',p_expected_version);
  v_id := app_private.operation_result('save_itinerary_day',p_request_id,v_args);
  if v_id is not null then return v_id; end if;
  perform app_private.check_plan_version(v_version,p_expected_version);
  if p_day_id is null then
    v_fields := jsonb_build_object('title','','stop_id',null,'notes','') || p_fields;
  else
    select * into v_old from public.itinerary_days where id=p_day_id and trip_id=p_trip_id;
    if not found then raise exception 'Not authorized' using errcode='42501'; end if;
    v_fields := jsonb_build_object('day_number',v_old.day_number,'title',v_old.title,'stop_id',v_old.stop_id,'notes',v_old.notes) || p_fields;
  end if;
  v_number := app_private.json_integer(v_fields,'day_number',1,365);
  v_title := app_private.import_text(v_fields,'title',120);
  v_notes := app_private.import_text(v_fields,'notes',3000);
  v_stop := app_private.json_uuid(v_fields,'stop_id',true);
  if p_day_id is null then
    insert into public.itinerary_days(trip_id,day_number,title,stop_id,notes) values(p_trip_id,v_number,v_title,v_stop,v_notes) returning id into v_id;
  else
    update public.itinerary_days set day_number=v_number,title=v_title,stop_id=v_stop,notes=v_notes where id=p_day_id returning id into v_id;
  end if;
  perform app_private.save_operation('save_itinerary_day',p_request_id,v_args,v_id);
  return v_id;
end $$;
create function public.delete_itinerary_day(p_day_id uuid,p_expected_version integer) returns void
language plpgsql security definer set search_path = '' as $$
declare v_trip uuid; v_version integer;
begin
  select trip_id into v_trip from public.itinerary_days where id=p_day_id;
  v_version := app_private.lock_plan(v_trip,true);
  perform app_private.check_plan_version(v_version,p_expected_version);
  if exists(select 1 from public.itinerary_items where day_id=p_day_id) then raise exception 'Move or remove day items before deleting this day' using errcode='23503'; end if;
  delete from public.itinerary_days where id=p_day_id;
end $$;
create function public.save_itinerary_item(p_trip_id uuid,p_item_id uuid,p_fields jsonb,p_expected_version integer,p_request_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_version integer; v_id uuid; v_old public.itinerary_items; v_fields jsonb; v_args jsonb;
  v_day uuid; v_activity uuid; v_title text; v_position integer; v_time text; v_duration integer; v_notes text; v_alt boolean; v_subgroup text;
begin
  v_version := app_private.lock_plan(p_trip_id,true);
  perform app_private.allowed_keys(p_fields,array['day_id','activity_id','title','position','time_slot','duration_minutes','notes','is_alternative','subgroup']);
  v_args := jsonb_build_object('trip_id',p_trip_id,'item_id',p_item_id,'fields',p_fields,'expected_version',p_expected_version);
  v_id := app_private.operation_result('save_itinerary_item',p_request_id,v_args);
  if v_id is not null then return v_id; end if;
  perform app_private.check_plan_version(v_version,p_expected_version);
  if p_item_id is null then
    v_fields := jsonb_build_object('activity_id',null,'position',0,'time_slot',null,'duration_minutes',null,'notes','','is_alternative',false,'subgroup','') || p_fields;
  else
    select * into v_old from public.itinerary_items where id=p_item_id and trip_id=p_trip_id;
    if not found then raise exception 'Not authorized' using errcode='42501'; end if;
    v_fields := jsonb_build_object('day_id',v_old.day_id,'activity_id',v_old.activity_id,'title',v_old.title,'position',v_old.position,'time_slot',v_old.time_slot,'duration_minutes',v_old.duration_minutes,'notes',v_old.notes,'is_alternative',v_old.is_alternative,'subgroup',v_old.subgroup) || p_fields;
  end if;
  v_day := app_private.json_uuid(v_fields,'day_id',false);
  v_activity := app_private.json_uuid(v_fields,'activity_id',true);
  v_title := app_private.import_text(v_fields,'title',200,true);
  v_position := app_private.json_integer(v_fields,'position',0,10000);
  if v_fields->'time_slot'='null'::jsonb then v_time:=null; else v_time:=app_private.import_text(v_fields,'time_slot',5); end if;
  if v_time is not null and v_time !~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Invalid time slot' using errcode='22023'; end if;
  v_duration := app_private.json_integer(v_fields,'duration_minutes',0,1440,true);
  v_notes := app_private.import_text(v_fields,'notes',3000);
  if jsonb_typeof(v_fields->'is_alternative') is distinct from 'boolean' then raise exception 'Invalid alternative flag' using errcode='22023'; end if;
  v_alt := (v_fields->>'is_alternative')::boolean;
  v_subgroup := app_private.import_text(v_fields,'subgroup',120);
  if p_item_id is null then
    insert into public.itinerary_items(trip_id,day_id,activity_id,title,position,time_slot,duration_minutes,notes,is_alternative,subgroup)
    values(p_trip_id,v_day,v_activity,btrim(v_title),v_position,v_time,v_duration,v_notes,v_alt,v_subgroup) returning id into v_id;
  else
    update public.itinerary_items set day_id=v_day,activity_id=v_activity,title=btrim(v_title),position=v_position,time_slot=v_time,duration_minutes=v_duration,notes=v_notes,is_alternative=v_alt,subgroup=v_subgroup where id=p_item_id returning id into v_id;
  end if;
  perform app_private.save_operation('save_itinerary_item',p_request_id,v_args,v_id);
  return v_id;
end $$;
create function public.delete_itinerary_item(p_item_id uuid,p_expected_version integer) returns void
language plpgsql security definer set search_path = '' as $$
declare v_trip uuid; v_version integer;
begin
  select trip_id into v_trip from public.itinerary_items where id=p_item_id;
  v_version := app_private.lock_plan(v_trip,true);
  perform app_private.check_plan_version(v_version,p_expected_version);
  delete from public.itinerary_items where id=p_item_id;
end $$;
create function public.set_trip_start_date(p_trip_id uuid,p_start_date date,p_expected_version integer) returns void
language plpgsql security definer set search_path = '' as $$
declare v_version integer;
begin
  v_version := app_private.lock_plan(p_trip_id,true);
  perform app_private.check_plan_version(v_version,p_expected_version);
  -- Dates label relative days only; stored anchors/booking metadata are unchanged.
  update public.trips set start_date=p_start_date where id=p_trip_id and start_date is distinct from p_start_date;
end $$;
create function public.set_plan_approval(p_trip_id uuid,p_expected_version integer,p_approved boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_version integer;
begin
  v_version := app_private.lock_plan(p_trip_id,false);
  perform app_private.check_plan_version(v_version,p_expected_version);
  if p_approved is null then raise exception 'Approval value required' using errcode='22023'; end if;
  if not p_approved then
    delete from public.plan_approvals where trip_id=p_trip_id and user_id=auth.uid();
    return;
  end if;
  if not exists(select 1 from public.trip_participants where trip_id=p_trip_id and user_id=auth.uid() and status='going') then raise exception 'Only going participants can approve' using errcode='42501'; end if;
  insert into public.plan_approvals(trip_id,user_id,version) values(p_trip_id,auth.uid(),v_version)
  on conflict(trip_id,user_id) do update set version=excluded.version,approved_at=now();
end $$;
create function public.set_member_display_name(p_group_id uuid,p_display_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.lock_member(p_group_id,false);
  if p_display_name is null or length(p_display_name)>80 then raise exception 'Invalid display name' using errcode='22023'; end if;
  update public.group_members set display_name=btrim(p_display_name) where group_id=p_group_id and user_id=auth.uid();
end $$;

-- One statement gives the displayed content, members and approval version the
-- same MVCC snapshot. Caller privileges and RLS apply to every subquery.
create function public.get_plan_snapshot(p_trip_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'trip',to_jsonb(t),
    'activities',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at,a.id) from public.activities a where a.trip_id=t.id),'[]'::jsonb),
    'stops',coalesce((select jsonb_agg(to_jsonb(s) order by s.position,s.id) from public.trip_stops s where s.trip_id=t.id),'[]'::jsonb),
    'days',coalesce((select jsonb_agg(to_jsonb(d) order by d.day_number,d.id) from public.itinerary_days d where d.trip_id=t.id),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(to_jsonb(i) order by d.day_number,i.position,i.id) from public.itinerary_items i join public.itinerary_days d on d.id=i.day_id and d.trip_id=i.trip_id where i.trip_id=t.id),'[]'::jsonb),
    'approvals',coalesce((select jsonb_agg(to_jsonb(a) order by a.user_id) from public.plan_approvals a where a.trip_id=t.id),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(to_jsonb(m) order by m.joined_at,m.user_id) from public.group_members m where m.group_id=t.group_id),'[]'::jsonb),
    'participants',coalesce((select jsonb_agg(to_jsonb(p) order by p.user_id) from public.trip_participants p where p.trip_id=t.id),'[]'::jsonb)
  ) from public.trips t where t.id=p_trip_id
$$;

create function public.get_activity_collaboration(p_activity_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'preferences',coalesce((select jsonb_agg(to_jsonb(p) order by p.user_id) from public.activity_preferences p where p.activity_id=a.id),'[]'::jsonb),
    'comments',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at,c.id) from public.activity_comments c where c.activity_id=a.id),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(to_jsonb(m) order by m.joined_at,m.user_id) from public.group_members m where m.group_id=t.group_id),'[]'::jsonb),
    'participants',coalesce((select jsonb_agg(to_jsonb(p) order by p.user_id) from public.trip_participants p where p.trip_id=t.id),'[]'::jsonb)
  ) from public.activities a join public.trips t on t.id=a.trip_id where a.id=p_activity_id
$$;
create function public.get_preference_snapshot(p_trip_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'preferences',coalesce((select jsonb_agg(to_jsonb(p) order by p.activity_id,p.user_id) from public.activity_preferences p where p.trip_id=t.id),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(to_jsonb(m) order by m.joined_at,m.user_id) from public.group_members m where m.group_id=t.group_id),'[]'::jsonb),
    'participants',coalesce((select jsonb_agg(to_jsonb(p) order by p.user_id) from public.trip_participants p where p.trip_id=t.id),'[]'::jsonb)
  ) from public.trips t where t.id=p_trip_id
$$;

revoke all on function app_private.clear_removed_member_choices(), app_private.lock_plan(uuid,boolean), app_private.check_plan_version(integer,integer), app_private.json_integer(jsonb,text,integer,integer,boolean), app_private.json_uuid(jsonb,text,boolean) from public,anon,authenticated;
revoke all on function public.set_activity_preference(uuid,text,integer,text), public.create_activity_comment(uuid,text,uuid), public.edit_activity_comment(uuid,text,integer), public.delete_activity_comment(uuid,integer), public.save_itinerary_day(uuid,uuid,jsonb,integer,uuid), public.delete_itinerary_day(uuid,integer), public.save_itinerary_item(uuid,uuid,jsonb,integer,uuid), public.delete_itinerary_item(uuid,integer), public.set_trip_start_date(uuid,date,integer), public.set_plan_approval(uuid,integer,boolean), public.set_member_display_name(uuid,text) from public,anon,authenticated;
grant execute on function public.set_activity_preference(uuid,text,integer,text), public.create_activity_comment(uuid,text,uuid), public.edit_activity_comment(uuid,text,integer), public.delete_activity_comment(uuid,integer), public.save_itinerary_day(uuid,uuid,jsonb,integer,uuid), public.delete_itinerary_day(uuid,integer), public.save_itinerary_item(uuid,uuid,jsonb,integer,uuid), public.delete_itinerary_item(uuid,integer), public.set_trip_start_date(uuid,date,integer), public.set_plan_approval(uuid,integer,boolean), public.set_member_display_name(uuid,text) to authenticated;
revoke all on function public.get_plan_snapshot(uuid), public.get_activity_collaboration(uuid), public.get_preference_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.get_plan_snapshot(uuid), public.get_activity_collaboration(uuid), public.get_preference_snapshot(uuid) to authenticated;
commit;
