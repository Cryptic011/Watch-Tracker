import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {deflateRawSync} from 'node:zlib';
const context=vm.createContext({Blob,TextDecoder,DecompressionStream});
vm.runInContext(fs.readFileSync(new URL('../assets/js/library-import.js',import.meta.url),'utf8'),context);
const parse=(rows,name)=>JSON.parse(JSON.stringify(context.WatchLogTrakt.parse(typeof rows==='string'?rows:JSON.stringify(rows),name)));
test('Trakt watched exports retain season, episode and watch date without duplicate history',()=>{
 const rows=[{show:{title:'Example',year:2021,ids:{imdb:'tt1234567',trakt:42}},seasons:[{number:2,episodes:[{number:3,plays:1,last_watched_at:'2026-11-01T10:00:00Z'}]}]}];
 const {items}=parse(rows,'watched-shows.json');
 assert.deepEqual(items[0].watchedEpisodes,{'2':[3]});
 assert.equal(items[0].imdbId,'tt1234567');
 assert.equal(items[0].lastEpisodeWatchedAt,'2026-11-01T10:00:00Z');
});
test('Trakt history rows merge watched episodes for a single show',()=>{
 const show={title:'Example',ids:{trakt:42}};
 const rows=[1,2,2].map(number=>({type:'episode',show,episode:{season:1,number},watched_at:'2026-11-01T10:00:00Z'}));
 const {items}=parse(rows,'history.json');
 assert.equal(items.length,1);assert.deepEqual(items[0].watchedEpisodes,{'1':[1,2]});assert.equal(items[0].episodeHistory.length,2);
});
test('Quoted CSV titles and nested Trakt watchlists remain importable',()=>{
 const csv='type,title,year,imdb_id,watched_at\nmovie,"A title, with a comma",2020,tt1234567,2026-11-01T10:00:00Z\n';
 const film=parse(csv,'movies.csv').items[0];
 assert.equal(film.title,'A title, with a comma');assert.equal(film.status,'Watched');
 const result=parse({watchlist:[{type:'show',show:{title:'Saved',ids:{trakt:55}}}]});
 assert.equal(result.items[0].type,'Series');assert.equal(result.items[0].status,'Planned');
});
test('Nested exports and CSV episode numbers preserve show identity and progress',()=>{
 const nested=parse({watched:{shows:[{show:{title:'Nested',ids:{trakt:10}},seasons:[{number:1,episodes:[{number:1,plays:1}]}]}]}});
 assert.deepEqual(nested.items[0].watchedEpisodes,{'1':[1]});
 const csv=parse('type,show,episode,season,watched_at\nepisode,Example,2,3,2026-11-01T10:00:00Z','episodes.csv');
 assert.equal(csv.items[0].title,'Example');assert.deepEqual(csv.items[0].watchedEpisodes,{'3':[2]});
});

test('A standard compressed Trakt ZIP exposes its JSON export without extracting paths',async()=>{
 const name=Buffer.from('history.json'),payload=Buffer.from(JSON.stringify([{type:'movie',movie:{title:'ZIP title',ids:{trakt:1}},watched_at:'2026-11-01T10:00:00Z'}])),compressed=deflateRawSync(payload);
 const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(8,8);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(payload.length,22);local.writeUInt16LE(name.length,26);
 const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(8,10);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(payload.length,24);central.writeUInt16LE(name.length,28);
 const directory=local.length+name.length+compressed.length;
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(directory,16);
 const bytes=Buffer.concat([local,name,compressed,central,name,end]);
 const files=await context.WatchLogTrakt.readFiles([{name:'trakt-export.zip',arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}]);
 assert.equal(files.length,1);assert.equal(parse(await files[0].text(),'history.json').items[0].title,'ZIP title');
});
