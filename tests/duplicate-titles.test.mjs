import test from 'node:test';
import assert from 'node:assert/strict';
import {duplicateRuntime} from './duplicate-runtime.mjs';
import {introducedDuplicate,mayChangeTitleIdentity,sameTitleIdentity} from '../supabase/functions/watchlog-pin/duplicate-titles.mjs';
const tracked=()=>({id:'original',title:'NCIS: New York',type:'Series',releaseYear:'2026',imdbId:'tt41814550',tvmazeShowId:'91405',status:'Watching',curSeason:1,curEp:3,watchedSeasons:0,watchedEpisodes:{1:[1,2,3]},releasedEpisodes:{1:[1,2,3]},airedEpisodeCounts:{1:3},episodeCounts:{1:6},episodeScheduleVerified:true,episodeHistory:[{id:'watch3',season:1,episode:3,watchedAt:'2026-10-23T14:21:00Z'}],notes:'Original notes',lists:['CBS'],favorite:true,hideFromWeeklyReleases:true,date:'2026-08-30',createdAt:'2026-08-26T22:00:00Z',updatedAt:'2026-10-23T14:21:00Z',metadataUpdatedAt:'2026-10-23T14:00:00Z'});
const additional=()=>({...tracked(),id:'new',imdbId:'tt41814911',status:'Planned',curSeason:null,curEp:null,watchedEpisodes:{},episodeHistory:[],notes:'New notes',lists:['Crime'],favorite:false,hideFromWeeklyReleases:false,date:'2026-10-24',createdAt:'2026-10-24T01:34:00Z',updatedAt:'2026-10-24T01:34:00Z',metadataUpdatedAt:'2026-10-24T01:35:00Z',seasonImages:{1:'https://static.tvmaze.com/season.jpg'},episodeImages:{1:{1:'https://static.tvmaze.com/episode.jpg'}}});
test('A shared TVMaze identity is a duplicate even when IMDb IDs differ',()=>{
 const app=duplicateRuntime(),a=tracked(),b=additional();
 assert.equal(app.itemsAreDuplicate(a,b),true);assert.equal(sameTitleIdentity(a,b),true);assert.equal(app.findTrackedDuplicate(b,[a]).id,'original');
});
test('Distinct reboots and franchise entries remain separate on both client and server',()=>{
 const app=duplicateRuntime(),a=tracked();
 for(const b of [{...additional(),tvmazeShowId:'91406'}, {...a,title:'NCIS: Los Angeles',imdbId:'tt1111111',tvmazeShowId:'111'}, {...a,type:'Film'}]){
  assert.equal(app.itemsAreDuplicate(a,b),false);assert.equal(sameTitleIdentity(a,b),false);
 }
 assert.equal(app.itemsAreDuplicate({title:'Twin',type:'Series',releaseYear:'2000'},{title:'Twin',type:'Series',releaseYear:'2026'}),false);
});
test('Cleanup keeps the original record, progress, notes, lists and reminder opt-out',()=>{
 const app=duplicateRuntime(),result=app.deduplicateLibrary([additional(),tracked()]),merged=JSON.parse(JSON.stringify(result.items[0]));
 assert.equal(result.removedCount,1);assert.equal(merged.id,'original');assert.equal(merged.imdbId,'tt41814911');assert.equal(merged.status,'Watching');assert.equal(merged.curEp,3);assert.equal(merged.curSeason,1);assert.deepEqual(merged.watchedEpisodes,{1:[1,2,3]});assert.equal(merged.episodeHistory[0].id,'watch3');
 assert.match(merged.notes,/Original notes/);assert.match(merged.notes,/New notes/);assert.deepEqual(merged.lists.sort(),['CBS','Crime']);assert.equal(merged.favorite,true);assert.equal(merged.hideFromWeeklyReleases,true);assert.equal(merged.date,'2026-08-30');assert.equal(merged.seasonImages[1],'https://static.tvmaze.com/season.jpg');assert.equal(merged.episodeImages[1][1],'https://static.tvmaze.com/episode.jpg');
 const again=app.mergeDuplicateItems(merged,additional());assert.equal(again.notes,merged.notes);assert.equal(again.id,merged.id);
});
test('Server checks the final patch and permits atomic cleanup and progress edits',()=>{
 const a=tracked(),b=additional();
 assert.equal(introducedDuplicate([a],[{id:b.id,create:b}]).duplicateId,a.id);
 assert.equal(introducedDuplicate([a,b],[{id:a.id,set:{notes:'Updated'}},{id:b.id,delete:true}]),null);
 assert.equal(mayChangeTitleIdentity([{id:a.id,set:{curEp:4}}]),false);
 assert.equal(mayChangeTitleIdentity([{id:a.id,set:{imdbId:b.imdbId}}]),true);
 assert.equal(introducedDuplicate([a],[{id:a.id,delete:'false'},{id:b.id,create:b}]).duplicateId,a.id);
});
test('Two duplicate creates in one request are rejected and genuine remakes can be added',()=>{
 const a=tracked(),b=additional();assert.ok(introducedDuplicate([],[{id:a.id,create:a},{id:b.id,create:b}]));
 assert.equal(introducedDuplicate([a],[{id:b.id,create:{...b,tvmazeShowId:'999'}}]),null);
});
