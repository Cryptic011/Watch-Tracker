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
test('Recommendations match specific library themes and exclude titles outside the seed subset',async()=>{
 const seed={id:99121,name:'Space watch',type:'Scripted',genres:['Drama','Science-Fiction'],summary:'Explorers travel through space aboard a starship.',language:'English'};
 const shows=[{id:99122,name:'Starship voyage',type:'Scripted',genres:['Drama','Science-Fiction'],summary:'Explorers aboard a starship travel through space.',image:{medium:'https://static.tvmaze.com/a.jpg'},rating:{average:7}},{id:99123,name:'Generic drama',genres:['Drama'],summary:'A family struggles with money.',image:{medium:'https://static.tvmaze.com/b.jpg'},rating:{average:10}},{id:99124,name:'Already in library',genres:['Science-Fiction'],image:{medium:'https://static.tvmaze.com/c.jpg'}}];
 const result=await getRecommendations([{title:seed.name,tvmazeId:'99121',weight:6}],async url=>url.endsWith('/shows/99121')?seed:shows,{exclude:[{title:'Already in library',tvmazeId:'99124'}]});
 assert.equal(result[0].title,'Starship voyage');assert.match(result[0].reason,/Space watch/);assert.ok(!result.some(row=>row.title==='Already in library'));
});
test('Film library genres influence show recommendations and feed failures keep matching results usable',async()=>{
 const candidate={id:99201,name:'Detective anthology',genres:['Crime'],image:{medium:'https://static.tvmaze.com/d.jpg'}};
 const result=await getRecommendations([{title:'Saved crime film',type:'Film',genres:['Crime'],weight:3}],async url=>{if(url.includes('/schedule'))throw Error('Provider unavailable');return [candidate];});
 assert.equal(result[0].title,candidate.name);assert.match(result[0].reason,/Saved crime film/);
});
