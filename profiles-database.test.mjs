import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
// Real PostgreSQL RLS/grants via PGlite; Auth JWT identity is a test shim, not hosted Supabase.
let db,ga,gb,ta;
const users=Object.fromEntries(['owner','member','admin','outsider','new'].map(n=>[n,randomUUID()]));
async function scalar(sql,args=[]){return Object.values((await db.query(sql,args)).rows[0])[0];}
async function as(id,fn){await db.exec(id===null?'set role anon':'set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);try{return await fn();}finally{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");}}
async function rpc(name,args=[]){return scalar(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args);}
async function deny(fn,codes=['42501','22023']){await assert.rejects(fn,e=>codes.includes(e.code));}
async function migration(file){return readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8');}
before(async()=>{
 db=new PGlite();await db.exec(`create role anon nologin;create role authenticated nologin;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 alter default privileges in schema public grant all on tables to anon,authenticated;alter default privileges in schema public grant execute on functions to anon,authenticated;`);
 for(const file of ['202610040001_private_groups.sql','202610040002_collaboration.sql'])await db.exec(await migration(file));
 for(const id of Object.values(users))await db.query('insert into auth.users(id) values($1)',[id]);
 ga=await as(users.owner,()=>rpc('create_group',['Group A',randomUUID()]));
 gb=await as(users.outsider,()=>rpc('create_group',['Group B',randomUUID()]));
 await db.query('insert into public.group_members(group_id,user_id,role) values ($1,$2,\'member\'),($1,$3,\'admin\'),($4,$5,\'member\')',[ga,users.member,users.admin,gb,users.owner]);
 await as(users.owner,()=>rpc('set_member_display_name',[ga,'Existing alias']));
 ta=await as(users.owner,()=>rpc('create_trip',[ga,'Do not reset trip','china',randomUUID()]));
 await db.exec(await migration('202610040003_profiles_group_names.sql'));
});
after(async()=>{if(db)await db.close();});
test('PROFILE: upgrade preserves prior names as aliases and has no public directory',async()=>{
 assert.equal(await scalar('select nickname from public.group_members where group_id=$1 and user_id=$2',[ga,users.owner]),'Existing alias');
 await as(users.member,async()=>{assert.deepEqual(await rpc('get_my_profile'),{display_name:'',version:0});await deny(()=>db.query("update public.profiles set display_name='forged'"));await deny(()=>db.query("insert into public.profiles(user_id,display_name) values($1,'forged')",[users.owner]));});
 await as(null,async()=>{await deny(()=>rpc('get_my_profile'));await deny(()=>rpc('update_my_profile',['Anon',0]));await deny(()=>db.query('select * from public.profiles'));});
});
test('PROFILE: global name propagates only to own alias-free memberships; clearing alias uses global',async()=>{
 const version=await scalar('select version from public.trips where id=$1',[ta]);
 await as(users.owner,async()=>{assert.deepEqual(await rpc('update_my_profile',[' Global name ',0]),{display_name:'Global name',version:1});});
 assert.equal(await scalar('select display_name from public.group_members where group_id=$1 and user_id=$2',[ga,users.owner]),'Existing alias');
 assert.equal(await scalar('select display_name from public.group_members where group_id=$1 and user_id=$2',[gb,users.owner]),'Global name');
 await as(users.owner,()=>rpc('set_member_display_name',[ga,'']));
 assert.equal(await scalar('select display_name from public.group_members where group_id=$1 and user_id=$2',[ga,users.owner]),'Global name');
 assert.equal(await scalar('select version from public.trips where id=$1',[ta]),version);
 await as(users.member,async()=>{assert.equal(await scalar('select count(*)::int from public.profiles'),0);assert.equal(await scalar('select display_name from public.group_members where group_id=$1 and user_id=$2',[ga,users.owner]),'Global name');});
});
test('PROFILE: stale versions reject, invalid names reject, alias changes do not affect peers',async()=>{
 await as(users.owner,async()=>{await deny(()=>rpc('update_my_profile',['Lost edit',0]),['40001']);for(const name of ['', '  ','x'.repeat(81),'bad\nname'])await deny(()=>rpc('update_my_profile',[name,1]));});
 await as(users.member,()=>rpc('set_member_display_name',[ga,'Member alias']));
 assert.equal(await scalar('select display_name from public.group_members where group_id=$1 and user_id=$2',[ga,users.owner]),'Global name');
 await as(users.member,()=>deny(()=>rpc('set_member_display_name',[gb,'Intruder'])));
 await as(users.member,()=>deny(()=>db.query("update public.group_members set nickname='forged' where user_id=$1",[users.owner])));
});
test('PROFILE: new groups and invite joins inherit the global name; no changes to roles',async()=>{
 await as(users.new,()=>rpc('update_my_profile',['New traveller',0]));
 const token=await as(users.owner,()=>rpc('create_invitation',[ga]));await as(users.new,()=>rpc('accept_invitation',[token]));
 assert.equal(await scalar('select display_name from public.group_members where group_id=$1 and user_id=$2',[ga,users.new]),'New traveller');
 assert.equal(await scalar('select role from public.group_members where group_id=$1 and user_id=$2',[ga,users.new]),'member');
 const gid=await as(users.new,()=>rpc('create_group',['Another group',randomUUID()]));
 assert.equal(await scalar('select display_name from public.group_members where group_id=$1 and user_id=$2',[gid,users.new]),'New traveller');
});
test('GROUP: owner/admin rename only the name/version; stale edits and non-editors rejected',async()=>{
 const before=await scalar('select to_jsonb(t) from public.trips t where id=$1',[ta]);
 await as(users.member,()=>deny(()=>rpc('rename_group',[ga,'Not permitted',1])));
 await as(users.outsider,()=>deny(()=>rpc('rename_group',[ga,'Not permitted',1])));
 await as(null,()=>deny(()=>rpc('rename_group',[ga,'Not permitted',1])));
 await as(users.owner,async()=>{const g=await rpc('rename_group',[ga,'  Renamed group  ',1]);assert.equal(g.name,'Renamed group');assert.equal(g.version,2);await deny(()=>rpc('rename_group',[ga,'Stale edit',1]),['40001']);await deny(()=>rpc('rename_group',[ga,' ',2]));await deny(()=>db.query("update public.groups set name='direct' where id=$1",[ga]));});
 await as(users.admin,()=>rpc('rename_group',[ga,'Admin name',2]));
 assert.deepEqual(await scalar('select to_jsonb(t) from public.trips t where id=$1',[ta]),before);
 assert.equal(await scalar('select created_by from public.groups where id=$1',[ga]),users.owner);
});
test('PROFILE: migration re-run is guarded and rolls back without removing data',async()=>{
 await assert.rejects(()=>migration('202610040003_profiles_group_names.sql').then(sql=>db.exec(sql)),/Profiles already exist/);await db.exec('rollback');
 assert.equal(await scalar('select name from public.groups where id=$1',[ga]),'Admin name');
 assert.equal(await scalar('select display_name from public.profiles where user_id=$1',[users.owner]),'Global name');
});
