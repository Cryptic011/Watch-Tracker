/* Public metadata only. A provider must match the selected identity before use. */
const cache=new Map(),inFlight=new Map(),TTL=6*60*60*1000;
const clean=value=>String(value??'').replace(/<[^>]*>/g,' ').replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|quot|apos|lt|gt|nbsp));/gi,(all,decimal,hex,name)=>{
  if(name)return {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '}[name.toLowerCase()];
  const n=parseInt(decimal||hex,decimal?10:16);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';
}).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
const nameKey=value=>clean(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const imdbID=value=>/^tt\d{5,12}$/.test(String(value||''))?String(value):'';
const numericID=value=>/^\d{1,10}$/.test(String(value||''))?String(value):'';
const yearOf=value=>/^\d{4}/.test(String(value||''))?String(value).slice(0,4):'';
const text=value=>clean(value).slice(0,8000);
const imdbURL=id=>'https://www.imdb.com/title/'+id+'/';
function record(fields,name,url){return {...fields,source:name,sourceUrl:url,sources:[{name,url}],descriptionSource:fields.description?name:'',ratingSource:fields.rating?name:''};}
export function parseIMDbDetails(html,id,type){
  const rows=[];
  for(const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)){
    try{const data=JSON.parse(match[1]);for(const row of Array.isArray(data)?data:[data]){rows.push(row);if(Array.isArray(row?.['@graph']))rows.push(...row['@graph']);}}catch{}
  }
  const matches=rows.filter(row=>{
    const types=[row?.['@type']].flat();if(!types.includes(type==='Film'?'Movie':'TVSeries')&&! (type==='Series'&&types.includes('TVMiniSeries')))return false;
    try{const url=new URL(row.url||row['@id']);return /^(www\.)?imdb\.com$/.test(url.hostname)&&url.protocol==='https:'&&url.pathname.replace(/\/$/,'')==='/title/'+id;}catch{return false;}
  });
  if(matches.length!==1)return null;
  const row=matches[0],duration=String(row.duration||'').match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/),rating=Number(row.aggregateRating?.ratingValue);
  return record({description:text(row.description),premiered:/^\d{4}-\d{2}-\d{2}$/.test(row.datePublished||'')?row.datePublished:'',year:yearOf(row.datePublished),genres:[row.genre||[]].flat().filter(v=>typeof v==='string').map(clean).slice(0,15),runtime:duration?Number(duration[1]||0)*60+Number(duration[2]||0)||null:null,rating:Number.isFinite(rating)&&rating>0&&rating<=10?rating:null},'IMDb',imdbURL(id));
}
export async function getTitleDetails(input,request=fetch,{useCache=true}={}){
  const type=input.type==='Film'?'Film':input.type==='Series'?'Series':null;
  if(!type)return {state:'unmatched',sources:[]};
  const selected={type,title:clean(input.title).slice(0,160),year:yearOf(input.year||input.releaseYear),imdbId:imdbID(input.imdbId),tvmazeId:numericID(input.tvmazeShowId||input.tvmazeId),appleId:input.source==='apple'?numericID(input.externalId):''};
  const key=JSON.stringify(selected),cached=cache.get(key);
  if(useCache&&cached?.expires>Date.now())return structuredClone(cached.value);
  if(useCache&&inFlight.has(key))return structuredClone(await inFlight.get(key));
  const task=resolveDetails(selected,request);
  if(useCache)inFlight.set(key,task);
  try{
    const value=await task;
    if(useCache&&value.state==='ready'&&value.description){if(cache.size>=200)cache.delete(cache.keys().next().value);cache.set(key,{value,expires:Date.now()+TTL});}
    return structuredClone(value);
  }finally{if(inFlight.get(key)===task)inFlight.delete(key);}
}
async function resolveDetails(selected,request){
  const deadline=Date.now()+16000;
  const get=async(url,asText=false,init={})=>{
    const remaining=deadline-Date.now();if(remaining<100)throw Error('Details deadline reached');
    const response=await request(url,{...init,signal:AbortSignal.timeout(Math.min(3000,remaining)),headers:{'User-Agent':'WatchedLogger/1.0 (title metadata)','Accept':asText?'text/html':'application/json',...(init.headers||{})}});
    if(!response.ok)throw Error('Metadata source unavailable');
    return asText?response.text():response.json();
  };
  const attempt=async task=>{try{return await task();}catch{return null;}};
  // Editorial title information is resolved from IMDb before any fallback.
  // TVMaze is reserved for episode/schedule information elsewhere in the app.
  let id=selected.imdbId,canonical=null;
  const identity=async()=>{
    if(canonical)return canonical;
    if(!selected.title&&!id)return null;
    const data=await get('https://v3.sg.media-imdb.com/suggestion/titles/x/'+encodeURIComponent(id||selected.title.toLowerCase())+'.json');
    const matches=(Array.isArray(data.d)?data.d:[]).filter(row=>{
      const series=/series|miniseries/i.test(String(row.qid||row.q||'')),film=/feature|movie|short|documentary/i.test(String(row.qid||row.q||''));
      if(!imdbID(row.id)||(selected.type==='Series'?!series:!film||series))return false;
      return id?row.id===id:Boolean(selected.year)&&nameKey(row.l)===nameKey(selected.title)&&String(row.y)===selected.year;
    });
    if(matches.length!==1)return null;
    canonical={title:clean(matches[0].l),year:yearOf(matches[0].y)};id=matches[0].id;return canonical;
  };
  if(!id)await attempt(identity);
  // A selected TVMaze ID can supply the linked IMDb identifier only when the
  // actual series identity matches. Never import its synopsis or rating.
  if(!id&&selected.type==='Series'&&selected.tvmazeId)await attempt(async()=>{
    const show=await get('https://api.tvmaze.com/shows/'+selected.tvmazeId);
    if(String(show?.id)!==selected.tvmazeId||nameKey(show?.name)!==nameKey(selected.title)||
      (selected.year&&yearOf(show?.premiered)!==selected.year))return null;
    id=imdbID(show?.externals?.imdb);return id||null;
  });
  let result=id?await attempt(async()=>parseIMDbDetails(await get(imdbURL(id),true),id,selected.type)):null;
  const add=details=>{
    if(!details)return;
    if(!result){result=details;return;}
    let used=false;
    for(const field of ['description','premiered','year','genres','status','rating','runtime','language','seasons']){
      if((!result[field]||(Array.isArray(result[field])&&!result[field].length))&&details[field]){result[field]=details[field];used=true;if(field==='description')result.descriptionSource=details.descriptionSource||details.source;if(field==='rating')result.ratingSource=details.ratingSource||details.source;}
    }
    if(used)for(const source of details.sources||[])if(!result.sources.some(row=>row.url===source.url))result.sources.push(source);
  };
  // The film distributor's own listing is the next authoritative source.
  // For series, use an exact IMDb-linked catalogue description instead.
  if(!result?.description&&selected.type==='Film')add(await attempt(async()=>{
    const match=await attempt(identity);
    if(!selected.appleId&&(!match?.title||!match.year))return null;
    const url=selected.appleId?'https://itunes.apple.com/lookup?id='+selected.appleId+'&country=gb':'https://itunes.apple.com/search?term='+encodeURIComponent(match.title)+'&country=gb&media=movie&entity=movie&limit=40';
    const data=await get(url),matches=(data.results||[]).filter(row=>row.kind==='feature-movie'&&(selected.appleId?String(row.trackId)===selected.appleId:nameKey(row.trackName)===nameKey(match.title)&&yearOf(row.releaseDate)===match.year));
    if(matches.length!==1)return null;
    const row=matches[0];let link;
    try{link=new URL(row.trackViewUrl);if(link.protocol!=='https:'||!['itunes.apple.com','tv.apple.com'].includes(link.hostname))return null;}catch{return null;}
    return record({description:text(row.longDescription||row.shortDescription),premiered:String(row.releaseDate||'').slice(0,10),year:yearOf(row.releaseDate),genres:row.primaryGenreName?[clean(row.primaryGenreName)]:[],runtime:row.trackTimeMillis?Math.round(row.trackTimeMillis/60000):null},'Apple TV',link.href);
  }));
  if(!result?.description&&id&&(canonical?.title||selected.title))add(await attempt(async()=>{
    const query='query($title: String!) { popularTitles(country: GB, first: 20, filter: {searchQuery: $title}) { edges { node { objectType content(country: GB, language: en) { title originalReleaseYear shortDescription externalIds { imdbId } fullPath } } } } }';
    const data=await get('https://apis.justwatch.com/graphql',false,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,variables:{title:canonical?.title||selected.title}})});
    if(data.errors?.length)return null;
    const matches=(data.data?.popularTitles?.edges||[]).map(row=>row.node).filter(row=>row.objectType===(selected.type==='Film'?'MOVIE':'SHOW')&&row.content?.externalIds?.imdbId===id);
    if(matches.length!==1)return null;
    const content=matches[0].content;if(!text(content.shortDescription)||!/^\/(?!\/)/.test(content.fullPath||''))return null;
    const url=new URL(content.fullPath,'https://www.justwatch.com');if(url.hostname!=='www.justwatch.com'||url.protocol!=='https:')return null;
    return record({description:text(content.shortDescription),year:yearOf(content.originalReleaseYear)},'JustWatch',url.href);
  }));
  return {...(result||{sources:[]}),imdbId:id,imdbUrl:id?imdbURL(id):'',state:result?.description?'ready':result?'partial':id||selected.tvmazeId||selected.appleId?'unavailable':'unmatched'};
}
