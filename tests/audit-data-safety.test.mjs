import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {webcrypto} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {readAppSource} from './app-source.mjs';

const source=readAppSource(),sync=fs.readFileSync(new URL('../assets/js/sync.js',import.meta.url),'utf8');
const suite=fs.readFileSync(new URL('./app-behavior.test.mjs',import.meta.url),'utf8');
const helper=suite.slice(suite.indexOf('function extractFunction'),suite.indexOf('test("Current'));
const {extractFunction}=new Function('html','assert','vm',helper+'\nreturn {extractFunction};')(source,assert,vm);
const copy=value=>JSON.parse(JSON.stringify(value));
function load(names,globals={}){
 const context=vm.createContext(globals);
 vm.runInContext(names.map(name=>extractFunction(source,name)).join('\n'),context);
 return context;
}
function registerImport(context){
 let handle;
 context.document={getElementById:id=>id==='import-library-backup'?{addEventListener(name,fn){handle=fn;}}:{textContent:''}};
 vm.runInContext(sync.slice(sync.indexOf('  document.getElementById("import-library-backup")'),sync.indexOf('  changePinBtn.onclick=')),context);
 return handle;
}
const backup={format:'watchlog-library-backup',version:1,items:[{id:'original',title:'Example',type:'Series',releaseYear:'2003',imdbId:'tt0364845',notes:'Keep me',status:'Watching',date:'2026-11-01',watchedEpisodes:{1:[1,2]},episodeHistory:[{id:'event',season:1,episode:2,kind:'mark'}]}]};
const parser=vm.createContext({Blob,TextDecoder,DecompressionStream});
vm.runInContext(fs.readFileSync(new URL('../assets/js/library-import.js',import.meta.url),'utf8'),parser);

test('Shortened successful schedules retain saved ticks, history and progress through cleanup',async()=>{
 for(const shortened of [{1:[1,2]},{2:[1]}]){
  const item={id:'show',type:'Series',title:'Example',tvmazeShowId:'12',episodeScheduleVerified:true,releasedEpisodes:{1:[1,2,3]},episodeCounts:{1:3},airedEpisodeCounts:{1:3},watchedEpisodes:{1:[1,2,3]},episodeHistory:[{season:1,episode:3,kind:'mark'}],curSeason:1,curEp:3,metadataUpdatedAt:'2026-11-01'};
  let response={episodeScheduleAvailable:true,resolvedShowId:'12',releasedEpisodes:shortened,episodeCounts:{1:2},airedEpisodeCounts:{1:2},latestAired:1,completedSeasons:0},saved;
  const c=load(['scheduleMetadataRefresh','isEpisodeTrackable','positiveEpisodeMap','normalizeReleasedEpisodeMap','normalizeWatchedEpisodeMap','migratePlannedStatuses','knownSeasonTotal','sanitizeUnreleasedEpisodeProgress','releasedEpisodeMap','highestWatchedEpisode'],{
   mediaItems:[item],metadataRefreshInFlight:new Map(),metadataRefreshAttemptAt:new Map(),activeEpisodeTrackerId:'',
   cloneLibrarySnapshot:structuredClone,mediaVerificationIdentity:row=>row.tvmazeShowId,verifiedSeasonData:async()=>response,
   episodeReleaseTimestamp:()=>'',nowISO:()=>new Date().toISOString(),console,
   commitRefreshedLibrary(){saved=c.sanitizeUnreleasedEpisodeProgress(c.mediaItems[0]);},updateEpisodeTracker(){}
  });
  await c.scheduleMetadataRefresh(item);
  assert.deepEqual(copy(saved.watchedEpisodes),{1:[1,2,3]});assert.deepEqual(copy(saved.episodeHistory),item.episodeHistory);
  assert.equal(saved.curEp,3);assert.equal(saved.metadataUpdatedAt,item.metadataUpdatedAt);
  response={...response,releasedEpisodes:{1:[1,2,3,4]},episodeCounts:{1:4},airedEpisodeCounts:{1:4}};
  await c.scheduleMetadataRefresh(c.mediaItems[0]);
  assert.deepEqual(copy(saved.releasedEpisodes),{1:[1,2,3,4]});assert.equal(saved.curEp,3);
 }
});

test('PIN endpoint delegates the complete change to one RPC and reports its failures',async()=>{
 for(const outcome of [{data:true},{data:false},{error:new Error('Injected transaction failure')}]){
  let handler;const calls=[];
  const context=vm.createContext({createClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return outcome;},from(){throw Error('Separate credential writes are forbidden');}}),
   Deno:{env:{get:()=>''},serve:fn=>handler=fn},TextEncoder,Response,Request,crypto:webcrypto,btoa,atob,console:{error(){}}});
  vm.runInContext(stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/watchlog-pin/index.ts',import.meta.url),'utf8').replace(/^import .*\n/gm,'')),context);
  vm.runInContext('getSession=async()=>({accountId:"account",tokenHash:"current"});readMaintenance=async()=>({enabled:false});derivePin=async()=>"new-pin-hash";',context);
  const response=await handler(new Request('https://example.test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'change_pin',pin:'4321'})}));
  assert.equal(response.status,outcome.error?500:outcome.data?200:401);
  assert.equal(calls.length,1);assert.equal(calls[0].name,'watchlog_change_pin');
  assert.equal(calls[0].args.p_account,'account');assert.equal(calls[0].args.p_token_hash,'current');assert.equal(calls[0].args.p_pin_hash,'new-pin-hash');
 }
});

test('The reminder backend rejects a schedule that drops previously released episodes',()=>{
 const worker=fs.readFileSync(new URL('../supabase/functions/watchlog-reminders/index.ts',import.meta.url),'utf8');
 const block=worker.slice(worker.indexOf('function episodeUtcValue('),worker.indexOf('function serverScheduleRefreshDue('));
 const c=vm.createContext({});vm.runInContext(block,c);
 const item={id:'show',releasedEpisodes:{1:[1,2,3]},watchedEpisodes:{1:[1,2,3]},curSeason:1,curEp:3};
 assert.equal(c.buildServerEpisodeSchedule(item,[{season:1,number:1,airdate:'2020-01-01'}]),item);
 const complete=[1,2,3,4].map(number=>({season:1,number,airdate:'2020-01-01'}));
 const updated=c.buildServerEpisodeSchedule(item,complete);
 assert.deepEqual(copy(updated.releasedEpisodes),{1:[1,2,3,4]});assert.deepEqual(copy(updated.watchedEpisodes),item.watchedEpisodes);
});

test('An incomplete editor preview cannot clamp the saved form progress',()=>{
 const c=load(['applySeasonDataResult','normalizeReleasedEpisodeMap'],{mediaItems:[{id:'show',releasedEpisodes:{1:[1,2,3]}}],$:id=>{assert.equal(id,'item-id');return {value:'show'};}});
 assert.equal(c.applySeasonDataResult({episodeScheduleAvailable:true,releasedEpisodes:{1:[1,2]}},{preserveProgress:true,remember:true}),null);
});

test('Multiple native backups retain all native fields through the actual import route',async()=>{
 let imported;
 const c=vm.createContext({currentUser:{id:'A'},persistenceGeneration:1,mediaItems:[],cloneLibrarySnapshot:structuredClone,
  window:{WatchLogTrakt:{previewFiles:async files=>{imported=[];for(const file of await parser.WatchLogTrakt.readFiles(files))imported.push(...copy(parser.WatchLogTrakt.parse(await file.text(),file.name)).items);}}}});
 const handle=registerImport(c);
 await handle({currentTarget:{files:['backup.json','other.json'].map(name=>({name,size:100,text:async()=>JSON.stringify(backup)})),value:'selected'}});
 assert.deepEqual(imported,[backup.items[0],backup.items[0]]);
 assert.throws(()=>parser.WatchLogTrakt.parse(JSON.stringify({...backup,version:2}),'backup.json'),/supported Watch Tracker backup/);
});

test('A ZIP containing native and Trakt exports dispatches each format separately',async()=>{
 const entries=[['backup.json',JSON.stringify(backup)],['history.json',JSON.stringify([{movie:{title:'Other film',ids:{trakt:9}},watched_at:'2026-11-01'}])]];
 const parts=[],centralParts=[];let offset=0;
 for(const [filename,text]of entries){
  const name=Buffer.from(filename),payload=Buffer.from(text),compressed=deflateRawSync(payload),local=Buffer.alloc(30),central=Buffer.alloc(46);
  local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(8,8);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(payload.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(8,10);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(payload.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
  parts.push(local,name,compressed);centralParts.push(central,name);offset+=local.length+name.length+compressed.length;
 }
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(Buffer.concat(centralParts).length,12);end.writeUInt32LE(offset,16);
 const bytes=Buffer.concat([...parts,...centralParts,end]),files=await parser.WatchLogTrakt.readFiles([{name:'mixed.zip',arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}]);
 const items=[];for(const file of files)items.push(...copy(parser.WatchLogTrakt.parse(await file.text(),file.name)).items);
 assert.deepEqual(items[0],backup.items[0]);assert.equal(items[1].title,'Other film');assert.equal(items[1].status,'Watched');
});

test('Equal numeric identifiers from different providers do not merge titles',()=>{
 const rows=[{show:{title:'First',ids:{tvdb:42,trakt:100}}},{show:{title:'Different',ids:{trakt:42}}}];
 const items=copy(parser.WatchLogTrakt.parse(JSON.stringify(rows),'watchlist.json')).items;
 assert.equal(items.length,2);assert.notEqual(items[0].id,items[1].id);
});

test('Native import cancels after logout, account switching or same-account reauthentication',async()=>{
 for(const next of [null,{id:'B'},{id:'A'}]){
  let finishRead,saves=0;const read=new Promise(resolve=>finishRead=resolve),replacement=[{id:'b',title:'Replacement library'}];
  const c=load(['mergeLibraries','toMillis'],{currentUser:{id:'A'},persistenceGeneration:1,mediaItems:[],cloneLibrarySnapshot:structuredClone,cleanLibraryRecords:items=>({items}),uuid:()=> 'id',nowISO:()=>new Date().toISOString(),render(){},persistLibrary:async()=>saves++});
  const handle=registerImport(c),task=handle({currentTarget:{files:[{name:'backup.json',size:100,text:()=>read}],value:'selected'}});
  c.currentUser=next;c.persistenceGeneration=2;c.mediaItems=replacement;finishRead(JSON.stringify(backup));await task;
  assert.equal(saves,0);assert.deepEqual(copy(c.mediaItems),replacement);
 }
});

test('A failed import save cannot roll back a replacement account library',async()=>{
 let rejectSave;const saving=new Promise((_resolve,reject)=>rejectSave=reject),replacement=[{id:'b',title:'Replacement library'}];
 const c=load(['mergeLibraries','toMillis'],{currentUser:{id:'A'},persistenceGeneration:1,mediaItems:[],cloneLibrarySnapshot:structuredClone,cleanLibraryRecords:items=>({items}),uuid:()=> 'id',nowISO:()=>new Date().toISOString(),render(){},persistLibrary:()=>saving});
 const handle=registerImport(c),task=handle({currentTarget:{files:[{name:'backup.json',size:100,text:async()=>JSON.stringify(backup)}],value:'selected'}});
 await new Promise(resolve=>setImmediate(resolve));
 c.currentUser={id:'B'};c.persistenceGeneration=2;c.mediaItems=replacement;rejectSave(Error('Injected save error'));await task;
 assert.deepEqual(copy(c.mediaItems),replacement);
});

test('An uninterrupted native backup import preserves the complete saved record',async()=>{
 let saved;
 const c=load(['mergeLibraries','toMillis'],{currentUser:{id:'A'},persistenceGeneration:1,mediaItems:[],cloneLibrarySnapshot:structuredClone,cleanLibraryRecords:items=>({items}),uuid:()=> 'id',nowISO:()=>new Date().toISOString(),render(){},persistLibrary:async items=>saved=copy(items)});
 const handle=registerImport(c);await handle({currentTarget:{files:[{name:'backup.json',size:100,text:async()=>JSON.stringify(backup)}],value:'selected'}});
 assert.equal(typeof saved[0].updatedAt,'string');
 const {updatedAt,...record}=saved[0];assert.deepEqual(record,backup.items[0]);
});

