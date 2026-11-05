const cache=new Map();
const names=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const stop=new Set('about after again against also among another around based become before being between could during each every first follows from have into just life lives more most must only other over series show some story than that their them then there these they this through together under very were when where which while will with work world would years young team'.split(' '));
const terms=value=>new Set(names(String(value||'').replace(/<[^>]*>/g,' ')).split(' ').filter(word=>word.length>3&&!stop.has(word)));
const genreWeight=genre=>/^(Drama|Comedy)$/i.test(genre)?0.45:1.5;
const clean=seed=>({title:String(seed?.title||'').slice(0,160),tvmazeId:/^\d{1,10}$/.test(String(seed?.tvmazeId||''))?String(seed.tvmazeId):'',imdbId:/^tt\d{5,12}$/.test(String(seed?.imdbId||''))?String(seed.imdbId):'',type:String(seed?.type||'Series'),genres:Array.isArray(seed?.genres)?seed.genres.filter(value=>typeof value==='string').map(value=>value.slice(0,40)).slice(0,12):[],summary:String(seed?.description||'').slice(0,2000),weight:Math.max(1,Math.min(6,Number(seed?.weight)||1))});

export async function getRecommendations(seeds,get,{exclude=[],country='GB'}={}){
  const selected=(Array.isArray(seeds)?seeds:[]).slice(0,32).map(clean).filter(row=>row.title||row.tvmazeId||row.imdbId);
  if(!selected.length)return [];
  const excluded=[...selected,...(Array.isArray(exclude)?exclude:[]).slice(0,1000).map(clean)];
  const region=/^[A-Z]{2}$/.test(String(country))?country:'GB';
  const key=JSON.stringify([selected,excluded.map(row=>[row.title,row.tvmazeId,row.imdbId]),region]);
  const cached=cache.get(key);if(cached&&cached.expires>Date.now())return cached.rows;
  const ids=new Set(excluded.map(row=>row.tvmazeId).filter(Boolean)),imdb=new Set(excluded.map(row=>row.imdbId).filter(Boolean)),savedNames=new Set(excluded.map(row=>names(row.title)).filter(Boolean));
  const sources=await Promise.allSettled(selected.filter(row=>row.type!=='Film'&&(row.tvmazeId||row.imdbId)).slice(0,8).map(async seed=>{
    const show=await get(seed.tvmazeId?'https://api.tvmaze.com/shows/'+seed.tvmazeId:'https://api.tvmaze.com/lookup/shows?imdb='+seed.imdbId);
    if(!show||Array.isArray(show)||(seed.tvmazeId&&String(show.id)!==seed.tvmazeId)||(seed.imdbId&&show.externals?.imdb&&show.externals.imdb!==seed.imdbId))return null;
    ids.add(String(show.id));if(show.externals?.imdb)imdb.add(show.externals.imdb);
    return {...seed,genres:show.genres?.length?show.genres:seed.genres,summary:show.summary||seed.summary,language:show.language,type:show.type||'Scripted',tvmazeId:String(show.id)};
  }));
  const verified=new Map(sources.filter(row=>row.status==='fulfilled'&&row.value).map(row=>[row.value.tvmazeId||row.value.imdbId,row.value]));
  const profile=selected.map(seed=>verified.get(seed.tvmazeId)||[...verified.values()].find(row=>row.imdbId&&row.imdbId===seed.imdbId)||seed).filter(seed=>seed.genres.length).map(seed=>({...seed,keywords:terms(seed.summary)}));
  if(!profile.length)return [];
  const pageNumbers=[...new Set([...verified.values()].map(seed=>Math.floor(Number(seed.tvmazeId)/250)))].slice(0,3);
  if(!pageNumbers.length)pageNumbers.push(0);
  const date=new Date().toISOString().slice(0,10);
  const urls=[...pageNumbers.map(page=>'https://api.tvmaze.com/shows?page='+page),'https://api.tvmaze.com/schedule/web?country='+region+'&date='+date,'https://api.tvmaze.com/schedule?country='+region+'&date='+date];
  if(region!=='US')urls.push('https://api.tvmaze.com/schedule?country=US&date='+date);
  const responses=await Promise.allSettled(urls.map(get));
  const shows=[...new Map(responses.flatMap(response=>response.status==='fulfilled'&&Array.isArray(response.value)?response.value.map(row=>row.show||row._embedded?.show||row):[]).filter(show=>show?.id&&show.name).map(show=>[show.id,show])).values()];
  const candidates=[];
  for(const show of shows){
    if(ids.has(String(show.id))||imdb.has(show.externals?.imdb)||savedNames.has(names(show.name))||!(show.image?.original||show.image?.medium))continue;
    const keywords=terms(show.summary),matches=[];
    for(const seed of profile){
      const shared=(show.genres||[]).filter(genre=>seed.genres.includes(genre));if(!shared.length)continue;
      if(seed.type==='Scripted'&&show.type&&show.type!=='Scripted'&&show.type!=='Animation')continue;
      const overlap=[...keywords].filter(word=>seed.keywords.has(word)).length;
      const genre=shared.reduce((sum,value)=>sum+genreWeight(value),0)/Math.sqrt(seed.genres.reduce((sum,value)=>sum+genreWeight(value),0)*(show.genres||[]).reduce((sum,value)=>sum+genreWeight(value),0));
      matches.push({seed,shared,score:(genre*8+Math.min(4,overlap)*1.2+(seed.language&&seed.language===show.language?.trim()?0.5:0))*Math.sqrt(seed.weight)});
    }
    matches.sort((a,b)=>b.score-a.score);const best=matches[0];if(!best)continue;
    candidates.push({show,best,score:best.score+Math.min(2,(Number(show.rating?.average)||0)/5)+Math.min(1,matches.length*.1)});
  }
  // Let different library interests share the row instead of one seed filling it.
  const chosen=[],usedNames=new Set(),perSeed=new Map();
  candidates.sort((a,b)=>b.score-a.score||String(a.show.name).localeCompare(String(b.show.name)));
  for(const limit of [3,16])for(const candidate of candidates){
    if(chosen.length>=16)break;
    const name=names(candidate.show.name),seed=candidate.best.seed.title;
    if(usedNames.has(name)||(perSeed.get(seed)||0)>=limit)continue;
    chosen.push(candidate);usedNames.add(name);perSeed.set(seed,(perSeed.get(seed)||0)+1);
  }
  const rows=chosen.map(({show,best})=>({source:'tvmaze',externalId:String(show.id),tvmazeId:String(show.id),imdbId:show.externals?.imdb||'',title:show.name,format:'Series',year:String(show.premiered||'').slice(0,4),posterUrl:show.image.original||show.image.medium,description:show.summary||'',reason:best.shared.slice(0,2).join(' · ')+' · Like '+best.seed.title,detail:'Based on your library',genres:show.genres}));
  if(rows.length){if(cache.size>=100)cache.delete(cache.keys().next().value);cache.set(key,{rows,expires:Date.now()+6*3600000});}
  return rows;
}
