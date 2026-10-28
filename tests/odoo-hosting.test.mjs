import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';

const root=path.resolve(import.meta.dirname,'..');
const python=process.env.PYTHON||'python3';
const output=fs.mkdtempSync(path.join(os.tmpdir(),'watchlog-odoo-'));
execFileSync(python,[path.join(root,'scripts/build-odoo.py'),'--output',output]);
const action=fs.readFileSync(path.join(output,'public-assets.py'),'utf8');
const files=JSON.parse(action.match(/^files = (.+)$/m)[1]);
const prefix='/website/action/watchlog/',origin='https://app.test';
const source=Buffer.from(files['sw.js'][1],'base64').toString();
const manifest=JSON.parse(Buffer.from(files['asset-manifest.json'][1],'base64').toString());
process.on('exit',()=>fs.rmSync(output,{recursive:true,force:true}));

function worker(){
  const listeners={},stores=new Map(),requests=[];let offline=false;
  const key=value=>new URL(value.url||String(value),origin).href;
  const fetcher=async value=>{
    requests.push(key(value));if(offline)throw Error('Offline');
    const asset=files[new URL(key(value)).pathname.slice(prefix.length)];
    return asset?new Response(Buffer.from(asset[1],'base64'),{headers:{'content-type':asset[0]}}):new Response('Missing',{status:404});
  };
  const caches={keys:async()=>[...stores.keys()],delete:async name=>stores.delete(name),open:async name=>{
    if(!stores.has(name))stores.set(name,new Map());const store=stores.get(name);
    return {match:async value=>store.get(key(value))?.clone(),put:async(value,response)=>store.set(key(value),response.clone()),
      addAll:async values=>{
        const entries=await Promise.all(values.map(async value=>{const response=await fetcher(value);assert.equal(response.status,200);return [key(value),response];}));
        for(const [url,response]of entries)store.set(url,response);
      }};
  }};
  const self={location:{origin},registration:{scope:origin+'/'},addEventListener:(name,fn)=>listeners[name]=fn,
    skipWaiting:async()=>{},clients:{claim:async()=>{}}};
  vm.runInNewContext(source,{self,URL,Request,Response,caches,fetch:fetcher,AbortController,setTimeout,clearTimeout});
  return {listeners,requests,setOffline:()=>{offline=true;},install:async()=>{let result;listeners.install({waitUntil:promise=>result=promise});await result;}};
}

test('Odoo packages the complete versioned app and a valid standalone homepage',()=>{
  for(const name of manifest.assets)assert.ok(files[name.split('?')[0].replace(/^\.\//,'')],name);
  const html=Buffer.from(files['index.html'][1],'base64').toString();
  assert.ok(html.includes('<base href="'+prefix+'">'));
  const pwa=JSON.parse(Buffer.from(files['manifest.webmanifest'][1],'base64').toString());
  assert.equal(pwa.start_url,'/');assert.equal(pwa.scope,'/');
  execFileSync(python,['-c','import sys,xml.etree.ElementTree as E; E.parse(sys.argv[1])',path.join(output,'homepage.xml')]);
});

test('Odoo HTTP action serves only fixed public files and returns 404 for unknown paths',()=>{
  const result=execFileSync(python,['-c',`
import base64,json,sys,types
source=open(sys.argv[1]).read()
class Request:
 def make_response(self,data,headers=None,status=200):
  return {'body':data.decode() if isinstance(data,bytes) else data,'headers':dict(headers or []),'status':status}
request=Request()
results=[]
for path in ['/website/action/watchlog/sw.js','/website/action/watchlog/../../private','/website/action/watchlog/assets/js/app-core.js']:
 request.httprequest=types.SimpleNamespace(path=path)
 context={'request':request,'b64decode':base64.b64decode}
 exec(source,context)
 response=context['response']
 results.append({'headers':response['headers'],'status':response['status'],'length':len(response['body'])})
print(json.dumps(results))
`,path.join(output,'public-assets.py')],{encoding:'utf8'});
  const [worker,unknown,app]=JSON.parse(result);
  assert.equal(worker.status,200);assert.equal(worker.headers['Service-Worker-Allowed'],'/');
  assert.match(worker.headers['Content-Type'],/javascript/);assert.match(worker.headers['Content-Security-Policy'],/connect-src 'self'/);
  assert.equal(unknown.status,404);assert.equal(app.status,200);assert.ok(app.length>10000);
  assert.ok(!/request\.env|sudo\(|\.write\(|\.create\(|\.unlink\(|eval\(/.test(action));
});

test('Odoo offline install loads assets from the hosting route and serves the root offline',async()=>{
  const app=worker();await app.install();
  assert.ok(app.requests.every(url=>url.startsWith(origin+prefix)));
  app.setOffline();let response;
  app.listeners.fetch({request:{url:origin+'/',method:'GET',mode:'navigate'},respondWith:promise=>response=promise});
  assert.match(await(await response).text(),/id="auth-screen"/);
});

test('The root-scoped app worker leaves Odoo login, admin, contact and private routes alone',async()=>{
  const app=worker();
  for(const pathname of ['/odoo','/odoo/settings','/web/login','/web/content/private','/contactus']){
    let claimed=false;
    app.listeners.fetch({request:{url:origin+pathname,method:'GET',mode:'navigate'},respondWith(){claimed=true;}});
    assert.equal(claimed,false,pathname);
  }
});
