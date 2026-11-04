import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../supabase/functions/watchlog-pin/passkeys.mjs',import.meta.url),'utf8').replace(/^import .*\n/,'').replace('export async function','async function');
test('Passkey authentication rejects a foreign origin before database or signature work',async()=>{
 const context=vm.createContext({});
 vm.runInContext(source,context);
 const result=await context.passkeyAction({headers:new Map([['Origin','https://other.example']])},{action:'passkey_auth_verify'},{db:new Proxy({},{get(){throw Error('Unexpected database access');}})});
 assert.equal(result.status,403);
});
test('Passkey management requires a valid existing session',async()=>{
 const context=vm.createContext({});
 vm.runInContext(source,context);
 const result=await context.passkeyAction({headers:new Map([['Origin','https://cryptic011.github.io']])},{action:'passkey_register_options'},{});
 assert.equal(result.status,401);
});
test('A consumed or expired passkey challenge cannot create a login session',async()=>{
 const chain={delete(){return this},eq(){return this},gt(){return this},select(){return this},maybeSingle:async()=>({data:null,error:null})};
 const context=vm.createContext({});
 vm.runInContext(source,context);
 let created=0;
 const result=await context.passkeyAction({headers:new Map([['Origin','https://cryptic011.github.io']])},{action:'passkey_auth_verify',challengeId:'00000000-0000-0000-0000-000000000000',response:{id:'fake'}},{db:{from:()=>chain},createSession(){created++;}});
 assert.equal(result.status,400);assert.equal(created,0);
});
