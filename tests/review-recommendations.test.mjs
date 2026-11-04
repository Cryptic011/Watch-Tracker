import test from 'node:test';
import assert from 'node:assert/strict';
import {getRecommendations} from '../supabase/functions/watchlog-pin/recommendations.mjs';
test('Recommendations use library genres and exclude saved identities',async()=>{
 const seed={id:12,name:'Saved',genres:['Crime'],externals:{imdb:'tt1234567'}};
 const rows=[seed,{id:13,name:'Relevant',genres:['Crime','Drama'],rating:{average:8},image:{medium:'https://static.tvmaze.com/13.jpg'}},{id:14,name:'Unrelated',genres:['Comedy'],rating:{average:9},image:{medium:'https://static.tvmaze.com/14.jpg'}}];
 const result=await getRecommendations([{tvmazeId:'12',imdbId:'tt1234567',title:'Saved'}],async url=>url.includes('/shows/12')?seed:rows);
 assert.ok(result.length>0);
 assert.ok(result.every(row=>row.title==='Relevant'));
 assert.match(result[0].reason,/Crime/);
});
