import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {readAppSource} from './app-source.mjs';

const source=readAppSource();
const suite=fs.readFileSync(new URL('./app-behavior.test.mjs',import.meta.url),'utf8');
const helper=suite.slice(suite.indexOf('function extractFunction'),suite.indexOf('test("Current'));
const {extractFunction}=new Function('html','assert','vm',helper+'\nreturn {extractFunction};')(source,assert,vm);
const functions=(...names)=>names.map(name=>extractFunction(source,name)).join('\n');
const copy=value=>JSON.parse(JSON.stringify(value));
const films=[
 {title:'Example',format:'Film',source:'imdb',externalId:'tt1111111',year:'1990'},
 {title:'Example',format:'Film',source:'imdb',externalId:'tt2222222',year:'2020'}
];
function filmVerifier(imdbRows=films,appleRows=[]){
 const context=vm.createContext({console,searchIMDbTitles:async()=>imdbRows,searchAppleMovies:async()=>appleRows,suggestionScore:()=>1});
 vm.runInContext(functions('normalizeTitle','bestIMDbFilmMatch','bestAppleFilmMatch','isFutureDateOnly','verifiedFilmReleaseData'),context);
 return context;
}

test('Cleanup retains a manually logged film and its same-name television adaptation',()=>{
 const context=vm.createContext({});
 vm.runInContext(functions('normalizeTitle','isWeakFilmRecord','cleanShadowTitleEntries'),context);
 const film={id:'film',title:'Example',type:'Film',status:'Watched',platform:'',notes:'Keep my film notes'};
 const series={id:'series',title:'Example',type:'Series',imdbId:'tt3333333'};
 const rows=context.cleanShadowTitleEntries([film,series]);
 assert.deepEqual(copy(rows),[film,series]);
 assert.equal(rows[0],film,'cleanup does not replace or discard the manual record');
});

test('Film release verification enforces the selected year and refuses ambiguous remakes',async()=>{
 const context=filmVerifier();
 const result=await context.verifiedFilmReleaseData('Example',{year:'1990'});
 assert.equal(result.imdbId,'tt1111111');assert.equal(result.year,'1990');
 const ambiguous=await context.verifiedFilmReleaseData('Example');
 assert.equal(ambiguous.imdbId,'');assert.equal(ambiguous.year,'');
 const missing=await context.verifiedFilmReleaseData('Example',{year:'1980'});
 assert.equal(missing.imdbId,'');assert.equal(missing.year,'1980');
 const wrongTitle=await context.verifiedFilmReleaseData('Different title',{year:'2020'});
 assert.equal(wrongTitle.imdbId,'');
});

test('An existing IMDb identity never switches to a different suggestion when its result is absent',async()=>{
 const context=filmVerifier();
 const result=await context.verifiedFilmReleaseData('Example',{imdbId:'tt9999999',year:'1980'});
 assert.equal(result.imdbId,'tt9999999');assert.equal(result.year,'1980');
 assert.deepEqual(copy(result.sources),[]);
 assert.equal(context.bestAppleFilmMatch([{title:'Different',format:'Film',year:'1980'}],'Example','1980'),null);
 assert.equal(context.bestAppleFilmMatch([{title:'Example',format:'Film',year:'2020'}],'Example','1990'),null);
});

test('Selecting an Apple-only older film writes that film IMDb identity into the actual editor',async()=>{
 const context=filmVerifier(),nodes=new Map();
 const $=id=>{if(!nodes.has(id))nodes.set(id,{value:''});return nodes.get(id);};
 Object.assign(context,{$,mediaItems:[],findTrackedDuplicate:()=>null,clearTimeout,activeCatalogueController:null,
  searchTimer:null,searchRequestId:0,editorApplyRevision:0,activeTitleSearchKey:'',cancelSuggestionProgress(){},
  titleInput:{value:''},suggestList:{classList:{add(){}}},modal:{classList:{contains:()=>false}},
  loadUKAvailability(){},typeSelect:{value:''},seriesSection:{style:{}},upcomingSection:{style:{}},filmSection:{style:{}},
  clearAiringFields(){},filmReleaseDate:{value:''},filmReleaseSource:{value:''},filmVerifyNote:{textContent:''},
  rememberEditorVerification(){},refreshEditorDuplicateWarning(){}});
 vm.runInContext(functions('fillFilmReleaseData','selectSuggestion','updateFilmVerifyNote'),context);
 await context.selectSuggestion({title:'Example',format:'Film',source:'apple',year:'1990',externalId:'123',releaseDate:'1990-05-01'});
 assert.equal($('imdb-id').value,'tt1111111');assert.equal($('release-year').value,'1990');
});

test('Actual editor save uses the visible manual platform, including clearing a previous provider',async()=>{
 for(const platform of ['BBC iPlayer','']){
  const original={id:'film',title:'Example',type:'Film',status:'Watched',platform:'Netflix',notes:'Keep film notes'};
  const series={id:'series',title:'Example',type:'Series',imdbId:'tt3333333'};
  const values={'item-id':'film',title:'Example',type:'Film',status:'Watched',platform};
  const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{value:values[id]??''});return nodes.get(id);};
  const context=vm.createContext({console,currentUser:{id:'test'},mediaItems:[original,series],mediaForm:{},saveBtn:{},$,
   selectedUKPlatform:'Netflix',ukPlatform:{value:'Netflix'},filmReleaseDate:{value:''},filmReleaseSource:{value:''},
   nowISO:()=> '2026-10-24T10:00:00Z',localISODate:()=> '2026-10-24',freshEditorVerification:()=>({}),
   pendingEditorVerification:()=>null,findTrackedDuplicate:()=>null,migratePlannedStatuses:rows=>({rows}),
   sameRecordWithoutUpdateTime:()=>false,render(){},closeEditor(){},persistLibrary:async()=>{},
   alert:message=>{throw Error(message);}});
  vm.runInContext(source.slice(source.indexOf('mediaForm.onsubmit=async e=>{'),source.indexOf('  deleteBtn.onclick=')),context);
  await context.mediaForm.onsubmit({preventDefault(){}});
  assert.equal(context.mediaItems[0].platform,platform);
  assert.equal(context.mediaItems[0].notes,'Keep film notes');assert.equal(context.mediaItems.length,2);
 }
});

test('Unmarking the final episode clears the summary while retaining legacy migration fallback',()=>{
 const context=vm.createContext({localISODate:()=> '2026-10-24',toMillis:value=>Date.parse(value)||0});
 vm.runInContext(functions('isEpisodeTrackable','positiveEpisodeMap','normalizeReleasedEpisodeMap','releasedEpisodeMap',
  'releasedEpisodeCounts','normalizeWatchedEpisodeMap','legacyWatchedEpisodeMap','watchedEpisodeMap','highestWatchedEpisode',
  'fullyWatchedSeasonCount','applyEpisodeToggle','lastLoggedEpisode'),context);
 const mark={id:'first',kind:'mark',season:1,episode:1,watchedAt:'2026-10-23T10:00:00Z'};
 const row={type:'Series',episodeScheduleVerified:true,releasedEpisodes:{1:[1]},episodeCounts:{1:1},verifiedCompletedSeasons:1,
  watchedEpisodes:{1:[1]},curSeason:1,curEp:1,lastWatchedSeason:1,lastWatchedEpisode:1,episodeHistory:[mark]};
 const unmarked=context.applyEpisodeToggle(row,1,1,false,{...mark,id:'unmark',kind:'unmark',watchedAt:'2026-10-24T10:00:00Z'});
 assert.deepEqual(copy(unmarked.watchedEpisodes),{});assert.equal(context.lastLoggedEpisode(unmarked),null);
 const legacy={type:'Series',lastWatchedSeason:1,lastWatchedEpisode:1,episodeHistory:[mark]};
 assert.equal(context.lastLoggedEpisode(legacy).episode,1,'legacy records without an explicit map remain readable');
});

test('Every gateway first-party source renders its description and exact-host attribution link',async()=>{
 const backend=fs.readFileSync(new URL('../supabase/functions/watchlog-pin/title-details.mjs',import.meta.url),'utf8');
 const firstParty=JSON.parse('{'+backend.split('const FIRST_PARTY=new Map(Object.entries({')[1].split('}));')[0]+'}');
 let returned;
 const context=vm.createContext({URL,console,pinApi:async()=>({details:returned}),esc:value=>String(value)});
 vm.runInContext('const METADATA_CACHE_TTL_MS=21600000,titleDetailsCache=new Map();'+functions('cachedMetadataRequest','fetchOfficialTitleDetails','titleDetailsSourceLinks'),context);
 for(const [host,name] of Object.entries(firstParty)){
  const url='https://'+host+'/title/example';
  returned={state:'ready',synopsisVersion:3,synopsisScope:'film',source:name,descriptionSource:name,description:'An official whole-title synopsis.',sources:[{name,url}]};
  const result=await context.fetchOfficialTitleDetails({title:host,type:'Film'});
  assert.equal(result.description,returned.description,name);
  assert.match(context.titleDetailsSourceLinks(result),new RegExp(host.replaceAll('.','\\.')),host);
 }
 for(const url of ['https://media.netflix.com.evil.example/title','http://media.netflix.com/title','https://user@media.netflix.com/title','https://media.netflix.com:8443/title']){
  assert.equal(context.titleDetailsSourceLinks({sources:[{name:'Netflix Media Center',url}]}),'',url);
 }
 returned={source:'Wikipedia',description:'Unverified text',sources:[]};
 assert.equal((await context.fetchOfficialTitleDetails({title:'Untrusted',type:'Film'})).state,'unavailable');
});

test('Frontend requests canonical series metadata for Anime without changing its library format',async()=>{
 const item={title:'Anime Example',type:'Anime',imdbId:'tt1234567'};let payload;
 const context=vm.createContext({console,pinApi:async(_action,input)=>{payload=input;return{details:{state:'ready',synopsisVersion:3,synopsisScope:'series',source:'IMDb',description:'A verified anime series synopsis.'}};}});
 vm.runInContext('const METADATA_CACHE_TTL_MS=21600000,titleDetailsCache=new Map();'+functions('cachedMetadataRequest','fetchOfficialTitleDetails'),context);
 assert.equal((await context.fetchOfficialTitleDetails(item)).state,'ready');
 assert.equal(payload.type,'Series');assert.equal(item.type,'Anime');
});
