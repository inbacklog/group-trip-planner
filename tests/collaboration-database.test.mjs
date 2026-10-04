import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

// Real PostgreSQL ACL/RLS tests with an Auth shim, not hosted Supabase or
// parallel database connections. All fixture content is synthetic.
let db, groupA, groupB, tripA, tripA2, tripB, activityA, activityA2, activityB, stopA, stopB;
const users = Object.fromEntries(['owner','member','other','outsider','new'].map(k => [k, randomUUID()]));
const privateTables = ['activity_preferences','activity_comments','itinerary_days','itinerary_items','plan_approvals'];
async function query(sql, params = []) { return (await db.query(sql, params)).rows; }
async function scalar(sql, params = []) { return Object.values((await query(sql, params))[0])[0]; }
async function as(user, work) {
  await db.exec(user === null ? 'set role anon' : 'set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? '']);
  try { return await work(); } finally { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub', '', false)"); }
}
const rpc = (name, args) => scalar(`select public.${name}(${args.map((_, i) => `$${i+1}`).join(',')})`, args);
const version = trip => scalar('select version from public.trips where id=$1', [trip]);
const denied = (work, codes = ['42501','22023','23503','23514']) => assert.rejects(work, e => codes.includes(e.code));
const saveDay = async (trip, fields, id = null, request = randomUUID(), expected) => rpc('save_itinerary_day', [trip,id,JSON.stringify(fields),expected ?? await version(trip),request]);
const saveItem = async (trip, fields, id = null, request = randomUUID(), expected) => rpc('save_itinerary_item', [trip,id,JSON.stringify(fields),expected ?? await version(trip),request]);

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
    alter default privileges in schema public grant all on tables to anon,authenticated;
    alter default privileges in schema public grant execute on functions to anon,authenticated;
  `);
  for (const file of ['202610040001_private_groups.sql','202610040002_collaboration.sql']) {
    const sql = await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
    try { await db.exec(sql); } catch(e) { throw new Error(`${file}: ${e.code} ${e.message} at ${e.position}; ${sql.slice(Math.max(0,Number(e.position)-100),Number(e.position)+100)}`); }
  }
  for (const id of Object.values(users)) await db.query('insert into auth.users(id) values($1)', [id]);
  groupA = await as(users.owner, () => rpc('create_group', ['Synthetic collaboration A',randomUUID()]));
  groupB = await as(users.outsider, () => rpc('create_group', ['Synthetic collaboration B',randomUUID()]));
  tripA = await as(users.owner, () => rpc('create_trip', [groupA,'Synthetic A','blank',randomUUID()]));
  tripA2 = await as(users.owner, () => rpc('create_trip', [groupA,'Synthetic A2','blank',randomUUID()]));
  tripB = await as(users.outsider, () => rpc('create_trip', [groupB,'Synthetic B','blank',randomUUID()]));
  for (const member of [users.member,users.other]) {
    const token = await as(users.owner, () => rpc('create_invitation',[groupA]));
    await as(member, () => rpc('accept_invitation',[token]));
  }
  activityA = await as(users.owner, () => rpc('create_item',['activities',tripA,JSON.stringify({title:'Synthetic A idea'}),randomUUID()]));
  activityA2 = await as(users.owner, () => rpc('create_item',['activities',tripA2,JSON.stringify({title:'Synthetic A2 idea'}),randomUUID()]));
  activityB = await as(users.outsider, () => rpc('create_item',['activities',tripB,JSON.stringify({title:'Synthetic B idea'}),randomUUID()]));
  stopA = await as(users.owner, () => rpc('create_stop',[tripA,'Synthetic A stop',0,randomUUID()]));
  stopB = await as(users.outsider, () => rpc('create_stop',[tripB,'Synthetic B stop',0,randomUUID()]));
});
after(async () => { if(db) await db.close(); });

test('Preferences are personal, clearable, private and do not alter official plan version', async () => {
  const initial = await as(users.owner, () => version(tripA));
  await as(users.member, async () => {
    await rpc('set_activity_preference',[activityA,'must',5,'Synthetic personal reason']);
    assert.deepEqual(await query('select user_id,choice,priority,note from public.activity_preferences where activity_id=$1',[activityA]), [{user_id:users.member,choice:'must',priority:5,note:'Synthetic personal reason'}]);
    await rpc('set_activity_preference',[activityA,'maybe',2,'Reconsidered']);
    assert.equal(await scalar('select count(*)::int from public.activity_preferences where activity_id=$1',[activityA]),1);
    await denied(() => rpc('set_activity_preference',[activityA,'invalid',1,'']));
    await denied(() => rpc('set_activity_preference',[activityA,'yes',6,'']));
    await denied(() => rpc('set_activity_preference',[activityA,'yes',0,'x'.repeat(1001)]));
    await denied(() => rpc('set_activity_preference',[activityB,'must',5,'']));
    await denied(() => db.query("update public.activity_preferences set user_id=$1 where activity_id=$2",[users.owner,activityA]));
    assert.equal(await version(tripA),initial);
    await rpc('set_activity_preference',[activityA,null,0,'']);
    assert.equal(await scalar('select count(*)::int from public.activity_preferences where activity_id=$1',[activityA]),0);
  });
});

test('Comments are idempotent, author-edited, version checked and safely moderated without changing authors', async () => {
  let comment; const initial=await as(users.owner,()=>version(tripA)); const request=randomUUID();
  await as(users.member,async()=>{
    comment=await rpc('create_activity_comment',[activityA,'Synthetic comment',request]);
    assert.equal(await rpc('create_activity_comment',[activityA,'Synthetic comment',request]),comment);
    await denied(()=>rpc('create_activity_comment',[activityA,'Changed arguments',request]));
    await rpc('edit_activity_comment',[comment,'Updated <script>inert text</script>',1]);
    assert.equal(await scalar('select version from public.activity_comments where id=$1',[comment]),2);
    assert.equal(await scalar('select created_by from public.activity_comments where id=$1',[comment]),users.member);
    await denied(()=>rpc('edit_activity_comment',[comment,'Stale write',1]),['40001']);
    await denied(()=>rpc('create_activity_comment',[activityA,' ',randomUUID()]));
    await denied(()=>rpc('create_activity_comment',[activityA,'x'.repeat(3001),randomUUID()]));
    assert.equal(await version(tripA),initial);
  });
  await as(users.other,async()=>{
    await denied(()=>rpc('edit_activity_comment',[comment,'Someone else',2]));
    await denied(()=>rpc('delete_activity_comment',[comment,2]));
  });
  await as(users.owner,async()=>{
    await denied(()=>rpc('edit_activity_comment',[comment,'Owner impersonation',2]));
    await denied(()=>rpc('delete_activity_comment',[comment,1]),['40001']);
    await rpc('delete_activity_comment',[comment,2]);
    assert.equal(await scalar('select count(*)::int from public.activity_comments where id=$1',[comment]),0);
    assert.equal(await version(tripA),initial);
  });
});

test('Display names are self-only, scoped and do not alter plans or roles', async()=>{
  await as(users.member,async()=>{
    const initial=await version(tripA);
    await rpc('set_member_display_name',[groupA,' Synthetic nickname ']);
    assert.deepEqual(await query('select display_name,role from public.group_members where group_id=$1 and user_id=$2',[groupA,users.member]),[{display_name:'Synthetic nickname',role:'member'}]);
    await denied(()=>rpc('set_member_display_name',[groupB,'Foreign rename']));
    await denied(()=>rpc('set_member_display_name',[groupA,'x'.repeat(81)]));
    await denied(()=>db.query("update public.group_members set display_name='Forged' where group_id=$1 and user_id=$2",[groupA,users.owner]));
    assert.equal(await version(tripA),initial);
  });
});

test('Official days/items support undated planning, partial edits and atomic idempotent retry before stale-version rejection',async()=>{
  await as(users.owner,async()=>{
    const expected=await version(tripA); const request=randomUUID(); const fields={day_number:1,title:'Synthetic arrival',stop_id:stopA,notes:'Keep this note'};
    const day=await saveDay(tripA,fields,null,request,expected);
    assert.equal(await saveDay(tripA,fields,null,request,expected),day);
    assert.equal(await scalar('select start_date from public.trips where id=$1',[tripA]),null);
    assert.equal(await scalar('select count(*)::int from public.itinerary_days where trip_id=$1',[tripA]),1);
    await denied(()=>saveDay(tripA,{day_number:2},null,randomUUID(),expected),['40001']);
    await saveDay(tripA,{title:'Synthetic renamed'},day);
    assert.equal(await scalar('select notes from public.itinerary_days where id=$1',[day]),fields.notes);
    const itemExpected=await version(tripA); const itemRequest=randomUUID();
    const itemFields={day_id:day,activity_id:activityA,title:'Synthetic planned idea',position:2,time_slot:'09:30',duration_minutes:90,notes:'Draft note',is_alternative:true,subgroup:'Synthetic subgroup'};
    const item=await saveItem(tripA,itemFields,null,itemRequest,itemExpected);
    assert.equal(await saveItem(tripA,itemFields,null,itemRequest,itemExpected),item);
    await saveItem(tripA,{time_slot:null,position:0},item);
    const saved=(await query('select * from public.itinerary_items where id=$1',[item]))[0];
    assert.equal(saved.time_slot,null); assert.equal(saved.position,0); assert.equal(saved.duration_minutes,90); assert.equal(saved.is_alternative,true); assert.equal(saved.notes,'Draft note');
    await denied(async()=>rpc('delete_itinerary_day',[day,await version(tripA)]));
    await denied(()=>db.query('delete from public.activities where id=$1',[activityA]));
    await rpc('delete_itinerary_item',[item,await version(tripA)]);
    await rpc('delete_itinerary_day',[day,await version(tripA)]);
    assert.equal(await scalar('select count(*)::int from public.itinerary_days where id=$1',[day]),0);
  });
});

test('Same-trip foreign keys and strict fields reject forged parents, owners and malformed plan input atomically',async()=>{
  const dayB=await as(users.outsider,()=>saveDay(tripB,{day_number:1}));
  await as(users.owner,async()=>{
    const day=await saveDay(tripA,{day_number:1});
    const dayOther=await saveDay(tripA2,{day_number:1});
    const expected=await version(tripA);
    const badDays=[{day_number:2,stop_id:stopB},{day_number:2,created_by:users.other},{day_number:0},{day_number:2.5},{day_number:366},{day_number:2,notes:'x'.repeat(3001)},{day_number:2,title:null}];
    for(const fields of badDays) await denied(()=>saveDay(tripA,fields));
    const badItems=[
      {day_id:dayB,title:'Foreign day'}, {day_id:dayOther,title:'Same group other trip day'},
      {day_id:day,activity_id:activityB,title:'Foreign activity'}, {day_id:day,activity_id:activityA2,title:'Same group other trip activity'},
      {day_id:day,title:'Forged',user_id:users.other}, {day_id:day,title:'Bad time',time_slot:'25:00'},
      {day_id:day,title:'Bad time',time_slot:'9:00'}, {day_id:day,title:'Bad duration',duration_minutes:1441},
      {day_id:day,title:'Bad flag',is_alternative:'false'}, {day_id:day,title:'Bad position',position:-1},
      {day_id:day,title:'Bad subgroup',subgroup:'x'.repeat(121)}, {day_id:day,title:''},
    ];
    for(const fields of badItems) await denied(()=>saveItem(tripA,fields));
    assert.equal(await version(tripA),expected,'Rejected writes must not change plan version');
    assert.equal(await scalar('select count(*)::int from public.itinerary_items where trip_id=$1',[tripA]),0);
    await denied(()=>saveDay(tripA,{title:'Move чужой'},dayB));
  });
});

test('Going-only approvals track exact plan versions; preferences/comments/nicknames do not invalidate them',async()=>{
  await as(users.member,()=>rpc('set_participation',[tripA,'going']));
  await as(users.member,async()=>{
    const current=await version(tripA);
    await rpc('set_plan_approval',[tripA,current,true]);
    await rpc('set_activity_preference',[activityA,'yes',3,'Synthetic choice']);
    await rpc('create_activity_comment',[activityA,'Synthetic comment after approval',randomUUID()]);
    await rpc('set_member_display_name',[groupA,'Member after approval']);
    assert.equal(await version(tripA),current);
    assert.equal(await scalar('select version from public.plan_approvals where trip_id=$1 and user_id=$2',[tripA,users.member]),current);
  });
  await as(users.other,()=>denied(async()=>rpc('set_plan_approval',[tripA,await version(tripA),true])));
  await as(users.owner,async()=>{
    await rpc('set_trip_start_date',[tripA,'2040-01-05',await version(tripA)]);
    const current=await version(tripA);
    const old=await scalar('select version from public.plan_approvals where trip_id=$1 and user_id=$2',[tripA,users.member]);
    assert.ok(old<current);
    assert.equal(await scalar("select start_date::text from public.trips where id=$1",[tripA]),'2040-01-05');
    await rpc('set_trip_start_date',[tripA,null,current]);
    assert.equal(await scalar('select start_date from public.trips where id=$1',[tripA]),null);
  });
  await as(users.member,async()=>{
    const current=await version(tripA);
    await denied(()=>rpc('set_plan_approval',[tripA,current-1,true]),['40001']);
    await rpc('set_plan_approval',[tripA,current,true]);
    await rpc('set_participation',[tripA,'not_going']);
    await denied(async()=>rpc('set_plan_approval',[tripA,await version(tripA),true]));
    await rpc('set_participation',[tripA,'going']);
    assert.ok(await scalar('select version from public.plan_approvals where trip_id=$1 and user_id=$2',[tripA,users.member])<await version(tripA));
    await rpc('set_plan_approval',[tripA,await version(tripA),false]);
    assert.equal(await scalar('select count(*)::int from public.plan_approvals where trip_id=$1 and user_id=$2',[tripA,users.member]),0);
  });
});

test('Plan snapshot returns matching private content, sources and members through one stable invoker statement',async()=>{
  await as(users.owner,async()=>{
    const day=await saveDay(tripA,{day_number:100,title:'Synthetic snapshot day'});
    const item=await saveItem(tripA,{day_id:day,activity_id:activityA,title:'Synthetic snapshot item',position:0});
    const snapshot=await rpc('get_plan_snapshot',[tripA]);
    assert.equal(snapshot.trip.id,tripA);
    assert.equal(snapshot.trip.version,await version(tripA));
    for(const key of ['days','items','approvals','participants','activities','stops']) {
      assert.ok(Array.isArray(snapshot[key]),key);
      assert.ok(snapshot[key].every(row=>row.trip_id===tripA),key);
    }
    assert.ok(snapshot.days.some(row=>row.id===day));
    assert.ok(snapshot.items.some(row=>row.id===item && row.day_id===day));
    assert.ok(snapshot.activities.some(row=>row.id===activityA));
    assert.ok(snapshot.stops.some(row=>row.id===stopA));
    assert.ok(snapshot.members.every(row=>row.group_id===groupA));
    assert.ok(snapshot.members.some(row=>row.user_id===users.member && typeof row.display_name==='string'));
    assert.deepEqual(snapshot.days.map(row=>row.day_number),[...snapshot.days.map(row=>row.day_number)].sort((a,b)=>a-b));
    const empty=await rpc('get_plan_snapshot',[tripA2]);
    assert.deepEqual(empty.items,[]); assert.deepEqual(empty.approvals,[]);
  });
  await as(users.outsider,()=>assert.doesNotReject(async()=>assert.equal(await rpc('get_plan_snapshot',[tripA]),null)));
  await as(users.new,()=>assert.doesNotReject(async()=>assert.equal(await rpc('get_plan_snapshot',[tripA]),null)));
  await as(null,()=>denied(()=>rpc('get_plan_snapshot',[tripA])));
  assert.deepEqual(await query("select prosecdef,provolatile from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='get_plan_snapshot'"),[{prosecdef:false,provolatile:'s'}]);
});

test('Content, route and official-plan changes make approvals stale without moving stored booking anchors',async()=>{
  await as(users.owner,async()=>{
    const anchors={anchors:[{date:'2041-03-14',time:'00:30',timezone:'UTC',locked:true}]};
    await db.query('update public.trips set details=$1::jsonb where id=$2',[JSON.stringify(anchors),tripA]);
    const day=await saveDay(tripA,{day_number:101,title:'Synthetic approval day'});
    const item=await saveItem(tripA,{day_id:day,title:'Synthetic approval item'});
    const changes=[
      ()=>db.query("update public.activities set title='Synthetic revised idea' where id=$1",[activityA]),
      ()=>db.query("update public.trip_stops set name='Synthetic revised stop' where id=$1",[stopA]),
      ()=>saveDay(tripA,{notes:'Synthetic plan change'},day),
      ()=>saveItem(tripA,{is_alternative:true,subgroup:'Synthetic group'},item),
      async()=>rpc('set_trip_start_date',[tripA,'2041-03-10',await version(tripA)]),
    ];
    for(const change of changes){
      const approvedVersion=await version(tripA);
      await rpc('set_plan_approval',[tripA,approvedVersion,true]);
      await change();
      assert.ok(await version(tripA)>approvedVersion);
      assert.equal(await scalar('select version from public.plan_approvals where trip_id=$1 and user_id=$2',[tripA,users.owner]),approvedVersion);
    }
    assert.deepEqual(await scalar('select details from public.trips where id=$1',[tripA]),anchors);
    assert.equal(await scalar('select count(*)::int from public.itinerary_items where id=$1',[item]),1);
  });
});

test('Collaboration tables deny anonymous/outsider reads and direct privilege or author forgery',async()=>{
  await as(null,async()=>{
    for(const table of privateTables) await denied(()=>query(`select * from public.${table}`));
    await denied(()=>rpc('set_activity_preference',[activityA,'must',5,'']));
    await denied(()=>rpc('create_activity_comment',[activityA,'Anonymous',randomUUID()]));
  });
  await as(users.outsider,async()=>{
    for(const table of privateTables) assert.equal(await scalar(`select count(*)::int from public.${table} where trip_id=$1`,[tripA]),0);
    await denied(()=>rpc('create_activity_comment',[activityA,'Foreign comment',randomUUID()]));
    await denied(()=>rpc('save_itinerary_day',[tripA,null,JSON.stringify({day_number:5}),1,randomUUID()]));
    await denied(()=>rpc('set_trip_start_date',[tripA,null,1]));
    await denied(()=>rpc('set_plan_approval',[tripA,1,true]));
  });
  await as(users.member,async()=>{
    await denied(async()=>rpc('save_itinerary_day',[tripA,null,JSON.stringify({day_number:5}),await version(tripA),randomUUID()]));
    await denied(async()=>rpc('set_trip_start_date',[tripA,null,await version(tripA)]));
    await denied(()=>db.query("insert into public.activity_preferences(trip_id,activity_id,user_id,choice) values($1,$2,$3,'must')",[tripA,activityA,users.owner]));
    await denied(()=>db.query("insert into public.activity_comments(trip_id,activity_id,created_by,body) values($1,$2,$3,'Forged')",[tripA,activityA,users.owner]));
    await denied(()=>db.query("insert into public.itinerary_days(trip_id,day_number) values($1,300)",[tripA]));
    await denied(()=>db.query('insert into public.plan_approvals(trip_id,user_id,version) values($1,$2,1)',[tripA,users.owner]));
    await denied(()=>db.query("update public.trips set start_date='2040-01-01' where id=$1",[tripA]));
  });
});

test('Membership removal deletes preferences/approvals, retains historical comments and cannot replay old writes after removal',async()=>{
  const request=randomUUID(); let comment;
  await as(users.member,async()=>{
    await rpc('set_activity_preference',[activityA,'must',5,'Before removal']);
    await rpc('set_plan_approval',[tripA,await version(tripA),true]);
    comment=await rpc('create_activity_comment',[activityA,'Historical comment',request]);
  });
  await as(users.owner,()=>rpc('remove_member',[groupA,users.member]));
  await as(users.member,async()=>{
    for(const table of privateTables) assert.equal(await scalar(`select count(*)::int from public.${table}`),0);
    await denied(()=>rpc('create_activity_comment',[activityA,'Historical comment',request]));
    await denied(()=>rpc('edit_activity_comment',[comment,'After removal',1]));
  });
  await as(users.owner,async()=>{
    assert.equal(await scalar('select count(*)::int from public.activity_preferences where user_id=$1',[users.member]),0);
    assert.equal(await scalar('select count(*)::int from public.plan_approvals where user_id=$1',[users.member]),0);
    assert.equal(await scalar('select created_by from public.activity_comments where id=$1',[comment]),users.member);
  });
  const token=await as(users.owner,()=>rpc('create_invitation',[groupA]));
  await as(users.member,async()=>{
    await rpc('accept_invitation',[token]);
    assert.equal(await scalar('select count(*)::int from public.activity_preferences where user_id=$1',[users.member]),0);
    assert.equal(await scalar('select count(*)::int from public.plan_approvals where user_id=$1',[users.member]),0);
    assert.equal(await scalar('select count(*)::int from public.trip_participants where user_id=$1',[users.member]),0);
  });
});

test('Activity/preference snapshots include the current private roster and participation with scoped preferences/comments',async()=>{
  const second=await as(users.owner,()=>rpc('create_item',['activities',tripA,JSON.stringify({title:'Synthetic second snapshot idea'}),randomUUID()]));
  await as(users.member,async()=>{
    await rpc('set_participation',[tripA,'going']);
    await rpc('set_activity_preference',[activityA,'must',5,'Synthetic snapshot preference']);
    await rpc('set_activity_preference',[second,'maybe',1,'Synthetic second preference']);
    await rpc('create_activity_comment',[activityA,'Synthetic snapshot comment',randomUUID()]);
    await rpc('create_activity_comment',[second,'Synthetic second comment',randomUUID()]);
    const activity=await rpc('get_activity_collaboration',[activityA]);
    assert.ok(activity.preferences.length>0); assert.ok(activity.comments.length>0);
    assert.ok(activity.preferences.every(row=>row.activity_id===activityA));
    assert.ok(activity.comments.every(row=>row.activity_id===activityA));
    assert.ok(activity.members.every(row=>row.group_id===groupA));
    assert.ok(activity.participants.every(row=>row.trip_id===tripA));
    assert.equal(activity.participants.find(row=>row.user_id===users.member).status,'going');
    await rpc('set_participation',[tripA,'not_going']);
    const current=await rpc('get_activity_collaboration',[activityA]);
    const overview=await rpc('get_preference_snapshot',[tripA]);
    assert.equal(current.participants.find(row=>row.user_id===users.member).status,'not_going');
    assert.equal(overview.participants.find(row=>row.user_id===users.member).status,'not_going');
    assert.ok(overview.preferences.some(row=>row.activity_id===activityA));
    assert.ok(overview.preferences.some(row=>row.activity_id===second));
    assert.ok(overview.preferences.every(row=>row.trip_id===tripA));
  });
  await as(users.owner,()=>rpc('remove_member',[groupA,users.other]));
  await as(users.member,async()=>{
    for(const [name,id] of [['get_activity_collaboration',activityA],['get_preference_snapshot',tripA]]) {
      const snapshot=await rpc(name,[id]);
      assert.ok(!snapshot.members.some(row=>row.user_id===users.other));
    }
  });
  for(const user of [users.other,users.outsider,users.new]) await as(user,async()=>{
    assert.equal(await rpc('get_activity_collaboration',[activityA]),null);
    assert.equal(await rpc('get_preference_snapshot',[tripA]),null);
  });
  await as(null,async()=>{
    await denied(()=>rpc('get_activity_collaboration',[activityA]));
    await denied(()=>rpc('get_preference_snapshot',[tripA]));
  });
  await as(users.owner,async()=>{
    await db.query('delete from public.activities where id=$1',[second]);
    assert.equal(await rpc('get_activity_collaboration',[second]),null);
    assert.equal(await rpc('get_preference_snapshot',[randomUUID()]),null);
  });
  const functions=await query("select prosecdef,provolatile from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('get_activity_collaboration','get_preference_snapshot')");
  assert.equal(functions.length,2); assert.ok(functions.every(fn=>!fn.prosecdef && fn.provolatile==='s'));
});

test('New tables have RLS and privileged functions retain fixed search paths and restricted execution',async()=>{
  const rows=await query("select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1)",[privateTables]);
  assert.equal(rows.length,privateTables.length); assert.ok(rows.every(row=>row.relrowsecurity));
  const functions=await query("select proname,proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and prosecdef");
  for(const fn of functions) assert.ok(fn.proconfig?.includes('search_path=""'),fn.proname);
  await as(users.member,()=>denied(()=>rpc('set_member_display_name',[groupB,'No access'])));
  await as(users.member,()=>denied(()=>scalar('select app_private.lock_plan($1,true)',[tripA])));
});
