import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

test('PostgreSQL enforces recovery, granular sync, delivery leases and private RPC grants',async()=>{
  const db=new PGlite();
  try{
    await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema extensions;');
    const migrations=[
      '20260904000100_create_pin_backend.sql','20260904000200_harden_watchlog_sync.sql',
      '20260917030532_create_push_backend.sql','20261023220030_granular_sync_and_recovery.sql',
      '20261023231401_sync_write_receipts.sql','20261024145416_atomic_credentials_and_delivery_claims.sql',
    ];
    for(const name of migrations){
      let sql=fs.readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
      // PGlite lacks pgcrypto. Substitute only the historical configuration
      // secret's default; current functions and regression SQL run unmodified.
      if(['20260904000100_create_pin_backend.sql','20260917030532_create_push_backend.sql'].includes(name))sql=sql.replace(/^create extension if not exists pgcrypto with schema extensions;\n/gm,'').replace("encode(extensions.gen_random_bytes(32), 'hex')","repeat('0',64)");
      await db.exec(sql);
    }
    for(const name of ['granular_sync_and_recovery.sql','atomic_credentials_and_delivery_claims.sql']){
      await db.exec(fs.readFileSync(new URL('../supabase/tests/'+name,import.meta.url),'utf8'));
    }
    assert.equal((await db.query('select count(*)::int as total from public.watchlog_pin_accounts')).rows[0].total,0,'SQL regression fixtures roll back');
  }finally{await db.close();}
});
