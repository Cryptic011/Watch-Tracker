import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const read=name=>fs.readFileSync(new URL('../supabase/'+name,import.meta.url),'utf8');
test('PIN changes atomically revoke other sessions and passkeys, and roll back on database errors',async()=>{
 const db=new PGlite();
 try{
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
  await db.exec(read('migrations/20260904000100_create_pin_backend.sql').replace(/create extension[^;]+;/,''));
  await db.exec(read('migrations/20261104200824_review_passkeys_and_preferences.sql'));
  await db.exec(read('migrations/20261112234419_atomic_pin_change.sql'));
  const {rows:[{id}]}=await db.query("insert into public.watchlog_pin_accounts(email,pin_hash,pin_salt) values('pin-test.invalid','old-hash','old-salt') returning id");
  const {rows:[{id:other}]}=await db.query("insert into public.watchlog_pin_accounts(email,pin_hash,pin_salt) values('other-test.invalid','other-hash','other-salt') returning id");
  await db.query("insert into public.watchlog_pin_sessions(token_hash,account_id,expires_at) values('current',$1,now()+interval '1 day'),('previous',$1,now()+interval '1 day'),('expired',$1,now()-interval '1 day'),('unrelated',$2,now()+interval '1 day')",[id,other]);
  await db.query("insert into public.watchlog_passkeys(id,account_id,public_key,device_type) values('key',$1,'test-key','singleDevice')",[id]);
  await db.query("insert into public.watchlog_passkey_challenges(account_id,challenge,kind,expires_at) values($1,'test','registration',now()+interval '1 minute')",[id]);
  await db.exec("create function public.fail_test_revocation() returns trigger language plpgsql as $$begin if old.token_hash='previous' then raise exception 'Injected revocation failure';end if;return old;end$$;create trigger fail_test_revocation before delete on public.watchlog_pin_sessions for each row execute function public.fail_test_revocation();");
  await assert.rejects(db.query("select public.watchlog_change_pin($1,'current','new-hash','new-salt')",[id]),/Injected revocation failure/);
  assert.equal((await db.query('select pin_hash from public.watchlog_pin_accounts where id=$1',[id])).rows[0].pin_hash,'old-hash');
  assert.equal((await db.query('select count(*)::int as count from public.watchlog_pin_sessions where account_id=$1',[id])).rows[0].count,3);
  assert.equal((await db.query('select count(*)::int as count from public.watchlog_passkeys')).rows[0].count,1);
  assert.equal((await db.query('select count(*)::int as count from public.watchlog_passkey_challenges')).rows[0].count,1);
  await db.exec('drop trigger fail_test_revocation on public.watchlog_pin_sessions;');
  for(const [account,token]of [[id,'missing'],[id,'expired'],[other,'current']]){
   const result=await db.query('select public.watchlog_change_pin($1,$2,\'new-hash\',\'new-salt\') as changed',[account,token]);
   assert.equal(result.rows[0].changed,false);
  }
  await db.query("update public.watchlog_pin_accounts set failed_attempts=4,locked_until=now()+interval '1 minute' where id=$1",[id]);
  assert.equal((await db.query("select public.watchlog_change_pin($1,'current','new-hash','new-salt') as changed",[id])).rows[0].changed,true);
  const account=(await db.query('select pin_hash,pin_salt,failed_attempts,locked_until from public.watchlog_pin_accounts where id=$1',[id])).rows[0];
  assert.deepEqual(account,{pin_hash:'new-hash',pin_salt:'new-salt',failed_attempts:0,locked_until:null});
  assert.deepEqual((await db.query('select token_hash from public.watchlog_pin_sessions order by token_hash')).rows.map(row=>row.token_hash),['current','unrelated']);
  assert.equal((await db.query('select count(*)::int as count from public.watchlog_passkeys')).rows[0].count,0);
  assert.equal((await db.query('select count(*)::int as count from public.watchlog_passkey_challenges')).rows[0].count,0);
  const privileges=(await db.query("select has_function_privilege('anon','public.watchlog_change_pin(uuid,text,text,text)','execute') as anon,has_function_privilege('authenticated','public.watchlog_change_pin(uuid,text,text,text)','execute') as authenticated,has_function_privilege('service_role','public.watchlog_change_pin(uuid,text,text,text)','execute') as backend")).rows[0];
  assert.deepEqual(privileges,{anon:false,authenticated:false,backend:true});
 }finally{await db.close();}
});

