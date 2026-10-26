/* Public metadata only. A provider must match the selected identity before use. */
const cache=new Map(),inFlight=new Map(),TTL=6*60*60*1000;
const SYNOPSIS_VERSION=6;
const clean=value=>String(value??'').replace(/<[^>]*>/g,' ').replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|quot|apos|lt|gt|nbsp));/gi,(all,decimal,hex,name)=>{
  if(name)return {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '}[name.toLowerCase()];
  const n=parseInt(decimal||hex,decimal?10:16);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';
}).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
const nameKey=value=>clean(value).replace(/&/g,' and ').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const imdbID=value=>/^tt\d{5,12}$/.test(String(value||''))?String(value):'';
const numericID=value=>/^\d{1,10}$/.test(String(value||''))?String(value):'';
const yearOf=value=>/^\d{4}/.test(String(value||''))?String(value).slice(0,4):'';
const text=value=>clean(value).slice(0,8000);
const imdbURL=id=>'https://www.imdb.com/title/'+id+'/';
function record(fields,name,url){return {...fields,source:name,sourceUrl:url,sources:[{name,url}],descriptionSource:fields.description?name:'',ratingSource:fields.rating?name:''};}
// Preferred sources get a short opportunity to answer, never an unbounded
// veto over an already verified synopsis from another provider.
async function briefly(task,ms=120){
 let timer;
 try{return await Promise.race([task,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),ms);})]);}
 finally{clearTimeout(timer);}
}
const firstSynopsis=tasks=>Promise.any(tasks.map(task=>Promise.resolve(task).then(details=>{
 if(!details?.description)throw Error('No matched synopsis');return details;
}))).catch(()=>null);

/* Exact first-party platform domains. Metadata from third-party aggregators
   and arbitrary URLs must never be treated as official broadcaster content. */
const FIRST_PARTY=new Map(Object.entries({
 "cbs.com":"CBS","paramountplus.com":"Paramount+","nbc.com":"NBC","abc.com":"ABC",
 "fox.com":"FOX","fxnetworks.com":"FX","hbo.com":"HBO","max.com":"Max",
 "disneyplus.com":"Disney+","disney.com":"Disney","hulu.com":"Hulu",
 "netflix.com":"Netflix","primevideo.com":"Prime Video","tv.apple.com":"Apple TV",
 "peacocktv.com":"Peacock","starz.com":"STARZ","showtime.com":"Showtime",
 "amc.com":"AMC","amcplus.com":"AMC+","thecw.com":"The CW","pbs.org":"PBS",
 "bbc.co.uk":"BBC","bbc.com":"BBC","itv.com":"ITV","itvx.com":"ITVX",
 "channel4.com":"Channel 4","sky.com":"Sky","nowtv.com":"NOW",
 "crunchyroll.com":"Crunchyroll","aetv.com":"A&E","freeform.com":"Freeform",
 "adultswim.com":"Adult Swim","usanetwork.com":"USA Network","bet.com":"BET",
 "warnerbros.com":"Warner Bros.","universalpictures.com":"Universal",
 "paramountpictures.com":"Paramount Pictures","sonypictures.com":"Sony Pictures",
 "20thcenturystudios.com":"20th Century Studios","marvel.com":"Marvel",
 "lionsgate.com":"Lionsgate","focusfeatures.com":"Focus Features",
 "discoveryplus.com":"Discovery+","tntdrama.com":"TNT","tbs.com":"TBS",
 "paramountglobalcontent.com":"Paramount Global Content",
 "paramountpressexpress.com":"Paramount Press Express",
 "media.netflix.com":"Netflix Media Center",
 "movies.disney.com":"Disney","starwars.com":"Star Wars","lucasfilm.com":"Lucasfilm",
 "mgm.com":"MGM","amazonmgmstudios.com":"Amazon MGM Studios","searchlightpictures.com":"Searchlight Pictures","harrypotter.com":"Harry Potter",
 "intl.paramountplus.com":"Paramount+","watch.amazon.co.uk":"Prime Video","amazon.co.uk":"Prime Video",
 "rakuten.tv":"Rakuten TV","skystore.com":"Sky Store"
}));
const WATCH_SERVICE_HOSTS=new Set(['cbs.com','paramountplus.com','intl.paramountplus.com','nbc.com','abc.com','fox.com','hbo.com','max.com','disneyplus.com','hulu.com','netflix.com','primevideo.com','watch.amazon.co.uk','amazon.co.uk','tv.apple.com','peacocktv.com','starz.com','showtime.com','amc.com','amcplus.com','thecw.com','pbs.org','bbc.co.uk','bbc.com','itv.com','itvx.com','channel4.com','sky.com','nowtv.com','crunchyroll.com','discoveryplus.com','rakuten.tv','skystore.com']);
const WATCH_LIST_QUERY='query($title:String!){popularTitles(country:GB,first:20,filter:{searchQuery:$title}){edges{node{objectType content(country:GB,language:en){title originalReleaseYear externalIds{imdbId} fullPath shortDescription} offers(country:GB,platform:WEB){monetizationType standardWebURL package{clearName}}}}}}';
function watchServiceURL(value){
 const site=firstPartyURL(value);if(!site||!WATCH_SERVICE_HOSTS.has(site.host))return null;
 const url=new URL(site.url);
 // Amazon retail pages and broadcaster search/login pages are not title pages.
 if(['amazon.co.uk','watch.amazon.co.uk'].includes(site.host)&&!/^\/(?:gp\/video\/detail\/|dp\/|(?:-\/[^/]+\/)?detail(?:\/|$))/.test(url.pathname))return null;
 if(url.pathname==='/'||/\/(?:browse|help|support)(?:\/|$)/i.test(url.pathname))return null;
 if(['tv.apple.com','netflix.com','paramountplus.com','intl.paramountplus.com'].includes(site.host))url.search='';
 site.url=url.href;return site;
}
function serviceKey(value){
 const name=nameKey(value);
 if(/\b(?:amazon|prime video)\b/.test(name))return 'prime video';
 if(name.includes('paramount'))return 'paramount';
 if(name.includes('apple tv'))return 'apple tv';
 return name;
}
async function watchListing(selected,get){
 if(!selected.title)return null;
 const query=WATCH_LIST_QUERY.replaceAll('country:GB','country:'+selected.country);
 const data=await get('https://apis.justwatch.com/graphql',false,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,variables:{title:selected.title}})});
 if(data.errors?.length)return null;
 const rows=(data.data?.popularTitles?.edges||[]).map(row=>row.node).filter(row=>{
  const content=row?.content;
  if(row?.objectType!==(selected.type==='Film'?'MOVIE':'SHOW')||!imdbID(content?.externalIds?.imdbId)||nameKey(content.title)!==nameKey(selected.title))return false;
  if(selected.imdbId&&content.externalIds.imdbId!==selected.imdbId)return false;
  // Strong series IDs can coexist with an old saved current-season year.
  if(selected.year&&(selected.type==='Film'||!selected.imdbId)&&String(content.originalReleaseYear)!==selected.year)return false;
  return Boolean(yearOf(content.originalReleaseYear))&&Boolean(selected.imdbId||selected.year);
 });
 return rows.length===1?rows[0]:null;
}
function isIndividualReleasePath(path){
 const segments=String(path||"").toLowerCase().split("/").filter(Boolean);
 // A network's /shows/title/ homepage or /about/ page is series-level.
 // Episode/season pages, clips and trailers are not overview sources.
 return segments.some((segment,i)=>/^(?:episodes?|seasons?|clips?|videos?|trailers?|episode-guide|episodeguide|season-[0-9]+|season_[0-9]+|s[0-9]+e[0-9]+|s[0-9]+)$/.test(segment)
   ||(/^s[0-9]+$/.test(segment)&&/^e[0-9]+$/.test(segments[i+1]||""))
   ||/^(?:episode|season)[-_]?[0-9]+/.test(segment)
   ||/^(?:episode|season)[-_](?:one|two|three|four|five|six|seven|eight|nine|ten)(?:[-_]|$)/.test(segment));
}
function isReleaseSpecificText(value){
 return /\b(?:(?:season|episode)\s*(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)|s\d+\s*e\d+)\b/i.test(value)
   ||/\b(?:this|new|current|upcoming|latest|next|final|previous|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+season\b/i.test(value)
   ||/\b(?:the|this|next|latest|new|previous|upcoming|final|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+episode\b/i.test(value)
   ||/\b(?:season|episode)\s+(?:premiere|finale|recap|guide|trailer)\b/i.test(value);
}
function synopsisText(value){
 // A watch CTA is website copy, not part of the programme's premise.
 return text(value).replace(/^.{1,160}?\s[-–—|]\s*Watch (?:full )?episodes on [\s\S]*?\bApp\.\s*/i,'').trim();
}
function isWholeTitleSynopsis(value,minimumLength=35){
 const description=text(value);
 if(description.length<minimumLength)return false;
 if(/(?:\.{3}|…)\s*$/.test(description))return false;
 if(/^(?:genre|release date|runtime|cast|rating|seasons?)\s*:/i.test(description))return false;
 // Do not pass plot or press text about a specific season or episode
 // through the overall Show/Film Details panel.
 if(isReleaseSpecificText(description))return false;
 if(/\bwatch (?:full )?episodes on\b|\b(?:sign up|subscribe) (?:now|today|for)\b/i.test(description))return false;
 // Cast announcements and returning-character promos can describe the current
 // run without saying "season" anywhere (including CBS's NCIS SEO copy).
 if(/\b(?:returns?\s+as|(?:is\s+)?back\s+as|reprises?\s+(?:(?:his|her|their|the)\s+)?role|joins?\s+the\s+cast|guest[- ]stars?|guest[- ]starring)\b/i.test(description))return false;
 if(/^\s*(?:watch|stream|new episodes|all episodes|trailer|preview|recap|sign in|sign up|subscribe|start (?:your |a )?free trial)\b/i.test(description))return false;
 return true;
}
function aboutPageDescription(markup,title){
 const source=String(markup||""),expected="about "+nameKey(title);
 for(const heading of source.matchAll(/<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)){
   if(nameKey(heading[2])!==expected)continue;
   const after=source.slice(heading.index+heading[0].length).split(/<(?:h[1-4]|footer|nav)\b/i)[0].slice(0,7000);
   // CBS renders its About copy in a div, not a paragraph. Only read the
   // dedicated copy container beneath this title's exact About heading.
   const copy=after.match(/<div\b[^>]*\bid\s*=\s*["']js-about-copy["'][^>]*>([\s\S]*?)<\/div\s*>/i)?.[1];
   if(copy&&isWholeTitleSynopsis(copy))return text(copy);
   for(const p of after.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)){
     const description=text(p[1]);
     if(isWholeTitleSynopsis(description))return description;
   }
 }
 return "";
}
function platformAboutDescription(markup,site){
 if(!['paramountplus.com','intl.paramountplus.com'].includes(site.host))return '';
 const patterns=[
  /<(?:div|p)\b[^>]*(?:data-testid|class|id)\s*=\s*["'][^"']*(?:about-description|show-description|series-description|movie-description|about-copy|show-summary)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|p)\s*>/gi,
  /<h[1-4]\b[^>]*>\s*About\s*<\/h[1-4]>([\s\S]*?)(?=<h[1-4]\b|<footer\b|$)/gi
 ];
 for(const pattern of patterns)for(const match of markup.matchAll(pattern)){
  const paragraphs=[...match[1].matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)].map(row=>text(row[1]));
  const candidates=paragraphs.length?paragraphs:[text(match[1].split(/Featuring:|Starring:|Read more/i)[0])];
  for(const candidate of candidates)if(isWholeTitleSynopsis(candidate))return candidate;
 }
 return '';
}
function distributorDescription(markup,site,title){
 if(site.host!=="paramountglobalcontent.com")return "";
 const headings=[...markup.matchAll(/<h[12]\b[^>]*>([\s\S]*?)<\/h[12]\s*>/gi)].map(row=>nameKey(row[1]));
 if(!headings.includes(nameKey(title)))return "";
 // The distributor has a truncated teaser and a separate full synopsis. Do
 // not import cast lists, footer text, or the "Show More" control.
 const body=markup.match(/<div\b[^>]*\bclass\s*=\s*["'][^"']*\bfull-synopsis\b[^"']*["'][^>]*>([\s\S]*?)<\/div\s*>/i)?.[1];
 const paragraphs=[...(body||"").matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)].map(row=>text(row[1])).filter(Boolean);
 const description=paragraphs.join("\n\n");
 return isWholeTitleSynopsis(description)?description:"";
}
function firstPartyURL(value){
 try{
   const u=new URL(String(value||""));
   if(u.protocol!=="https:"||u.username||u.password||u.port)return null;
   const host=u.hostname.toLowerCase().replace(/^www\./,""),name=FIRST_PARTY.get(host);
   if(!name||/\/(?:books|games)(?:\/|$)/i.test(u.pathname)||isIndividualReleasePath(u.pathname)||/\/(?:login|sign-in|signin|account|register|search)(?:\/|$)/i.test(u.pathname))return null;
   u.hash="";return{url:u.href,name,host};
 }catch{return null;}
}
function matchesFirstPartyTitle(value,title){
 const expect=nameKey(title),actual=nameKey(value);
 if(!expect||!actual)return false;
 if(actual===expect)return true;
 const stripped=actual.replace(/^(?:watch now|official site|the series|watch|stream|about)\s+/,"");
 if(stripped===expect)return true;
 return [actual,stripped].some(a=>a.startsWith(expect)&&/^(?: on | official | watch | streaming | tv | series | show | movie | film | netflix | cbs | nbc | abc | disney | paramount | apple | bbc | hbo )/.test(a.slice(expect.length)));
}
export function parseFirstPartyDetails(markup,url,{title,type,year,requireYear=false}={}){
 const site=firstPartyURL(url);if(!site||!title||!["Film","Series"].includes(type))return null;
 const source=String(markup||"");if(source.length>2000000)return null;
 const tags=new Map();
 for(const tag of source.match(/<meta\b[^>]*>/gi)||[]){
   const attrs={};
   for(const match of tag.matchAll(/([a-z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi))attrs[match[1].toLowerCase()]=match[2]??match[3]??"";
   const key=String(attrs.property||attrs.name||"").toLowerCase();
   if(key&&attrs.content&&!tags.has(key))tags.set(key,clean(attrs.content));
 }
 const titleTag=clean(source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
 const heading=clean(source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
 const distributorTitle=site.host==="paramountglobalcontent.com"?clean(source.match(/<h2\b[^>]*>([\s\S]*?)<\/h2\s*>/i)?.[1]):"";
 const titles=[tags.get("og:title"),tags.get("twitter:title"),titleTag,heading,distributorTitle].filter(Boolean);
 const structured=[];
 for(const match of source.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)){
  try{const json=JSON.parse(match[1]);for(const row of Array.isArray(json)?json:[json]){
   structured.push(row);if(Array.isArray(row?.["@graph"]))structured.push(...row["@graph"]);
  }}catch{}
 }
 let filmHero=null;
 if(type==='Film'&&site.host==='harrypotter.com'&&new URL(site.url).pathname.startsWith('/discover/films/')){
   const next=source.match(/<script\b[^>]*id\s*=\s*["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script\s*>/i);
   try{const hero=JSON.parse(next?.[1]||'null')?.props?.pageProps?.pageData?.world;
     if(hero&&nameKey(hero.heroTitle)===nameKey(title))filmHero=hero;
   }catch{}
 }
 // Require a programme-wide title match. A homepage's generic OG title
 // cannot validate an <h1> that actually names an individual season/episode.
 const pageHeadings=[...source.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/gi)]
   .map(row=>clean(row[1])).filter(Boolean);
 if(pageHeadings.length===1&&isReleaseSpecificText(pageHeadings[0]))return null;
 const types=type==="Film"?["Movie"]:["TVSeries","TVMiniSeries","TVShow"];
 const candidates=structured.filter(row=>[row?.["@type"]].flat().some(kind=>types.includes(kind))&&matchesFirstPartyTitle(row.name,title));
 const identity=candidates.length===1?candidates[0]:null;
 const works=structured.filter(row=>[row?.['@type']].flat().some(kind=>['Movie','TVSeries','TVMiniSeries','TVShow','TVEpisode','TVSeason','Book','VideoGame'].includes(kind)));
 // Some service episode URLs use opaque IDs. A generic show-level OG title
 // cannot override a single explicit work record naming an episode or remake.
 if(!identity&&works.length===1)return null;
 const wrongFormats=structured.filter(row=>matchesFirstPartyTitle(row?.name,title)&&[row?.['@type']].flat().some(kind=>['Movie','TVSeries','TVMiniSeries','TVShow','TVEpisode','TVSeason','Book','VideoGame'].includes(kind)));
 if(!candidates.length&&wrongFormats.length)return null;
 if(!identity&&!filmHero&&!titles.some(name=>matchesFirstPartyTitle(name,title)))return null;
 // A series page's publication date can refer to its CURRENT SEASON.
 // Only an explicit programme startDate can establish the series premiere;
 // otherwise IMDb may fill the overall show's original premiere date.
 const published=String((type==="Series"?identity?.startDate:(identity?.datePublished||(site.host==='movies.disney.com'?identity?.dateCreated:'')))||""),publishedYear=yearOf(published)||String(filmHero?.heroFootnote||'').match(/Released\s+(\d{4})/)?.[1]||'';
 if(year&&publishedYear&&String(year)!==publishedYear)return null;
 if(requireYear&&year&&!publishedYear)return null;
 const count=Number(typeof identity?.numberOfSeasons==="object"?identity.numberOfSeasons?.value:identity?.numberOfSeasons);
 const seasons=type==="Series"&&Number.isInteger(count)&&count>0&&count<=300?count:null;
 const filmCopy=type==='Film'&&site.host==='movies.disney.com'?[...source.matchAll(/<p\b[^>]*class\s*=\s*["'][^"']*\bdesc\b[^"']*["'][^>]*>([\s\S]*?)<\/p\s*>/gi)].map(row=>text(row[1])):[];
 const descriptions=[
   filmHero?.heroDescription,
   filmCopy.length===1?filmCopy[0]:"",
   platformAboutDescription(source,site),
   distributorDescription(source,site,title),
   aboutPageDescription(source,title),
   identity?.description,
   tags.get("og:description"),
   tags.get("description"),
   tags.get("twitter:description")
 ];
 // ITV programme landing pages can describe the selected player episode in
 // their global meta tags, even when the page title names the overall show.
 // Only a dedicated About section is safe there. Opaque episode IDs are
 // also rejected independently of the visible title.
 const itvPlayer=['itv.com','itvx.com'].includes(site.host)&&new URL(site.url).pathname.startsWith('/watch/');
 if(itvPlayer&&new URL(site.url).pathname.split('/').filter(Boolean).length>3)return null;
 const episodeDescriptions=structured.filter(row=>[row?.['@type']].flat().includes('TVEpisode')).map(row=>nameKey(row.description)).filter(Boolean);
 const safeDescriptions=itvPlayer?[aboutPageDescription(source,title)]:descriptions;
 const description=safeDescriptions.map(synopsisText).find(value=>isWholeTitleSynopsis(value)&&!episodeDescriptions.includes(nameKey(value)))||"";
 if(!description)return null;
 return record({description,year:publishedYear,seasons,
  premiered:/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(published)?published.slice(0,10):"",
  genres:[identity?.genre||[]].flat().filter(x=>typeof x==="string").map(clean).slice(0,15)
 },site.name,site.url);
}

export function parseIMDbDetails(html,id,type,selected={}){
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
  if(selected.title&&row.name&&nameKey(row.name)!==nameKey(selected.title))return null;
  if(type==='Film'&&selected.year&&yearOf(row.datePublished)&&selected.year!==yearOf(row.datePublished))return null;
  return record({description:isWholeTitleSynopsis(row.description,1)?text(row.description):"",premiered:/^\d{4}-\d{2}-\d{2}$/.test(row.datePublished||'')?row.datePublished:'',year:yearOf(row.datePublished),genres:[row.genre||[]].flat().filter(v=>typeof v==='string').map(clean).slice(0,15),runtime:duration?Number(duration[1]||0)*60+Number(duration[2]||0)||null:null,rating:Number.isFinite(rating)&&rating>0&&rating<=10?rating:null},'IMDb',imdbURL(id));
}
export async function getTitleDetails(input,request=fetch,{useCache=true,tmdbToken="",providerTimeoutMs=12000}={}){
  const type=input.type==='Film'?'Film':input.type==='Series'?'Series':null;
  if(!type)return {state:'unmatched',sources:[]};
  const country=String(input.country||'GB').toUpperCase();
  const selected={type,title:clean(input.title).slice(0,160),year:yearOf(input.year||input.releaseYear),imdbId:imdbID(input.imdbId),tvmazeId:numericID(input.tvmazeShowId||input.tvmazeId),appleId:input.source==='apple'?numericID(input.externalId):'',platform:clean(input.platform).slice(0,80),officialUrl:firstPartyURL(input.officialUrl||input.officialSite)?.url||'',country:country==='UK'?'GB':/^[A-Z]{2}$/.test(country)?country:'GB'};
  const key=JSON.stringify(selected),cached=cache.get(key);
  if(useCache&&cached?.expires>Date.now())return structuredClone(cached.value);
  if(useCache&&inFlight.has(key))return structuredClone(await inFlight.get(key));
  const controller=new AbortController();
  const task=resolveDetails(selected,request,tmdbToken,controller.signal,providerTimeoutMs).finally(()=>controller.abort());
  if(useCache)inFlight.set(key,task);
  try{
    const value=await task;
    if(useCache&&value.state==='ready'&&value.description){if(cache.size>=200)cache.delete(cache.keys().next().value);cache.set(key,{value,expires:Date.now()+TTL});}
    return structuredClone(value);
  }finally{if(inFlight.get(key)===task)inFlight.delete(key);}
}
async function resolveDetails(selected,request,tmdbToken="",signal,providerTimeoutMs=12000){
  const deadline=Date.now()+16000;
  const responses=new Map();
  const get=(url,asText=false,init={})=>{
   const key=JSON.stringify([url,asText,init.method||'GET',init.body||'']);
   if(!responses.has(key))responses.set(key,(async()=>{
    const remaining=deadline-Date.now();if(remaining<100)throw Error('Details deadline reached');
    const response=await request(url,{...init,signal:AbortSignal.any([signal,AbortSignal.timeout(Math.min(7000,remaining))]),headers:{'User-Agent':'WatchedLogger/1.0 (title metadata)','Accept':asText?'text/html':'application/json',...(init.headers||{})}});
    if(!response.ok)throw Error('Metadata source unavailable');
    // Never follow a platform redirect to a third-party or unrelated host
    // and continue to attribute the HTML to the original broadcaster.
    if(asText&&firstPartyURL(url)&&response.url){
      const initial=firstPartyURL(url),final=firstPartyURL(response.url);
      if(!final||(final.host!==initial.host&&!(watchServiceURL(url)&&watchServiceURL(response.url)&&final.name===initial.name)))throw Error('Unofficial redirect rejected');
    }
    return asText?response.text():response.json();
   })());
   return responses.get(key);
  };
  let catalogue=null;
  const preferred=resolveWatchServiceDetails(selected,get).catch(()=>null);
  // Keep the existing sources warm so a blocked or inaccessible provider page
  // can fall back without starting a second round of network waits.
  const fallback=resolveCatalogueDetails(selected,get,tmdbToken).then(value=>(catalogue=value)).catch(()=>({state:'unavailable',sources:[]}));
  const service=await briefly(preferred,Math.max(0,Math.min(14000,Number(providerTimeoutMs)||12000)));
  if(!service)return {...await fallback,descriptionMethod:'catalogue'};
  // Facts can come from a separate verified catalogue; the About text and its
  // attribution always remain the streaming service's own description.
  if(!catalogue)catalogue=await briefly(fallback);
  if(catalogue&&(!service.year||!catalogue.year||service.year===catalogue.year)){
    let used=false;
    for(const field of ['premiered','year','genres','status','rating','runtime','language','seasons']){
      if((!service[field]||(Array.isArray(service[field])&&!service[field].length))&&catalogue[field]){service[field]=catalogue[field];used=true;if(field==='rating')service.ratingSource=catalogue.ratingSource||catalogue.source;}
    }
    if(used)for(const source of catalogue.sources||[])if(!service.sources.some(row=>row.url===source.url))service.sources.push(source);
  }
  return {...service,synopsisVersion:SYNOPSIS_VERSION,synopsisScope:selected.type==='Series'?'series':'film',descriptionMethod:'watch-service',state:'ready'};
}
async function resolveWatchServiceDetails(selected,get){
  const attempt=async task=>{try{return await task();}catch{return null;}};
  const readPage=(value,identity=selected)=>attempt(async()=>{
    const site=watchServiceURL(value);if(!site)return null;
    const details=parseFirstPartyDetails(await get(site.url,true),site.url,{...identity,requireYear:identity.type==='Film'});
    return details?{...details,imdbId:identity.imdbId,imdbUrl:identity.imdbId?imdbURL(identity.imdbId):''}:null;
  });
  const tasks=[],preferredTasks=[];
  // A regional service title page is a candidate, never evidence by itself:
  // readPage still validates format, identity and complete show-level copy.
  if(selected.type==='Series'&&selected.country==='GB'){
    const slug=nameKey(selected.title).replace(/ /g,'-');
    if(slug)preferredTasks.push(readPage('https://www.intl.paramountplus.com/gb/shows/'+slug+'/'));
  }

  if(watchServiceURL(selected.officialUrl))tasks.push(readPage(selected.officialUrl));
  const showTask=selected.type==='Series'?attempt(async()=>{
    const url=selected.tvmazeId?'https://api.tvmaze.com/shows/'+selected.tvmazeId:selected.imdbId?
      'https://api.tvmaze.com/lookup/shows?imdb='+encodeURIComponent(selected.imdbId):
      'https://api.tvmaze.com/search/shows?q='+encodeURIComponent(selected.title);
    const data=await get(url);
    const candidates=Array.isArray(data)?data.map(row=>row.show).filter(show=>nameKey(show?.name)===nameKey(selected.title)&&(!selected.year||yearOf(show.premiered)===selected.year)):[data];
    if(candidates.length!==1)return null;
    const show=candidates[0];
    if(!show?.id||nameKey(show.name)!==nameKey(selected.title)||(selected.tvmazeId&&String(show.id)!==selected.tvmazeId)||
      (selected.imdbId&&show.externals?.imdb&&selected.imdbId!==show.externals.imdb))return null;
    return show;
  }):null;
  if(showTask)tasks.push(attempt(async()=>{
    const show=await showTask;if(!show)return null;
    return readPage(show.officialSite,{...selected,imdbId:selected.imdbId||imdbID(show.externals?.imdb),year:yearOf(show.premiered)});
  }));
  preferredTasks.push(attempt(async()=>{
    let identity=selected;
    if(!identity.imdbId&&showTask){const show=await showTask;if(show)identity={...selected,imdbId:imdbID(show.externals?.imdb),year:yearOf(show.premiered)||selected.year};}
    const listing=await watchListing(identity,get);if(!listing)return null;
    const matched={...identity,imdbId:listing.content.externalIds.imdbId,year:yearOf(listing.content.originalReleaseYear)};
    const priority=offer=>Number(serviceKey(offer.package?.clearName)!==serviceKey(selected.platform))*10+({FLATRATE:0,FREE:1,ADS:2,RENT:3,BUY:4}[offer.monetizationType]??99);
    const offers=(Array.isArray(listing.offers)?listing.offers:[]).filter(offer=>['FLATRATE','FREE','ADS','RENT','BUY'].includes(offer.monetizationType)).sort((a,b)=>priority(a)-priority(b));
    const urls=[...new Set(offers.map(offer=>watchServiceURL(offer.standardWebURL)?.url).filter(Boolean))].slice(0,4);
    return firstSynopsis(urls.map(url=>readPage(url,matched)));
  }));
  const platform=await briefly(firstSynopsis(preferredTasks),2500);
  return platform||firstSynopsis(tasks);
}
async function resolveCatalogueDetails(selected,get,tmdbToken=""){
  const attempt=async task=>{try{return await task();}catch{return null;}};
  // Series use TVMaze's show-level record, never an episode or season summary.
  // Film overviews retain the existing studio/IMDb lookup.
  let id=selected.imdbId,canonical=null,identityTask=null;
  let imdbTask=null,imdbDetails=null;
  const loadIMDb=()=>imdbTask||(imdbTask=attempt(async()=>{
    const targetId=id;
    imdbDetails=parseIMDbDetails(await get(imdbURL(targetId),true),targetId,selected.type,selected);
    return imdbDetails;
  }));
  // Start the preferred film source while independent studio discovery runs.
  if(selected.type==='Film'&&id)loadIMDb();
  const identity=()=>identityTask||(identityTask=attempt(async()=>{
    if(!selected.title&&!id)return null;
    const data=await get('https://v3.sg.media-imdb.com/suggestion/titles/x/'+encodeURIComponent(id||selected.title.toLowerCase())+'.json');
    const matches=(Array.isArray(data.d)?data.d:[]).filter(row=>{
      const series=/series|miniseries/i.test(String(row.qid||row.q||'')),film=/feature|movie|short|documentary/i.test(String(row.qid||row.q||''));
      if(!imdbID(row.id)||(selected.type==='Series'?!series:!film||series))return false;
      return id?row.id===id&&(!selected.title||nameKey(row.l)===nameKey(selected.title))&&(!selected.year||String(row.y)===selected.year):Boolean(selected.year)&&nameKey(row.l)===nameKey(selected.title)&&String(row.y)===selected.year;
    });
    if(matches.length!==1){if(id&&(data.d||[]).some(row=>row.id===id))id='';return null;}
    canonical={title:clean(matches[0].l),year:yearOf(matches[0].y)};id=matches[0].id;return canonical;
  }));
  // Older/manual films may have only a title and year. Resolve their IMDb
  // identity independently so a slow suggestion service cannot block Apple,
  // while a working suggestion service can still rescue a retail outage.
  const discoveredIMDb=selected.type==='Film'&&!id?attempt(async()=>{
    await identity();return id?loadIMDb():null;
  }):null;
  let seriesDetails=null;
  const pages=[];
  if(selected.officialUrl)pages.push(selected.officialUrl);
  const officialRequests=new Map();
  const loadOfficial=url=>{
    if(!officialRequests.has(url))officialRequests.set(url,attempt(async()=>{
      const site=firstPartyURL(url);if(!site)return null;
      return parseFirstPartyDetails(await get(site.url,true),site.url,selected);
    }));
    return officialRequests.get(url);
  };
  const suppliedOfficial=selected.officialUrl?loadOfficial(selected.officialUrl):null;
  const seriesTask=selected.type==='Series'?attempt(async()=>{
    const url=selected.tvmazeId?'https://api.tvmaze.com/shows/'+selected.tvmazeId:id?
      'https://api.tvmaze.com/lookup/shows?imdb='+encodeURIComponent(id):
      'https://api.tvmaze.com/search/shows?q='+encodeURIComponent(selected.title);
    const data=await get(url);
    const matches=Array.isArray(data)?data.map(row=>row.show).filter(show=>nameKey(show?.name)===nameKey(selected.title)&&(!selected.year||yearOf(show?.premiered)===selected.year)):[];
    const show=Array.isArray(data)?matches.length===1?matches[0]:null:data;
    if(!show?.id||(selected.tvmazeId&&String(show.id)!==selected.tvmazeId)||
      (id&&show.externals?.imdb&&show.externals.imdb!==id)||
      !matchesFirstPartyTitle(show.name,selected.title)||
      (!selected.tvmazeId&&!id&&selected.year&&yearOf(show.premiered)&&yearOf(show.premiered)!==selected.year))return null;
    if(!id)id=imdbID(show.externals?.imdb);
    const description=String(show.summary||'').split(/<\/p\s*>/i).map(text).filter(Boolean).join('\n\n');
    if(description&&isWholeTitleSynopsis(description,1)){
      // The synopsis is usable even if this optional secondary request stalls.
      const seasons=await briefly(attempt(()=>get('https://api.tvmaze.com/shows/'+show.id+'/seasons')));
      seriesDetails=record({description,premiered:/^\d{4}-\d{2}-\d{2}$/.test(show.premiered||'')?show.premiered:'',
        year:yearOf(show.premiered),genres:Array.isArray(show.genres)?show.genres.map(clean):[],
        status:clean(show.status),language:clean(show.language),runtime:Number(show.averageRuntime||show.runtime)||null,
        rating:typeof show.rating?.average==='number'?show.rating.average:null,
        seasons:Array.isArray(seasons)?seasons.filter(row=>Number(row.number)>0).length:null
      },'TVMaze','https://www.tvmaze.com/shows/'+show.id);
      return show;
    }
    if(firstPartyURL(show.officialSite))pages.push(show.officialSite);
    // CBS has a separate verified About page with its full programme synopsis.
    if(nameKey(show.network?.name)==='cbs'||nameKey(show.webChannel?.name)==='cbs'){
      const slug=clean(show.name).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      if(slug){
        pages.unshift('https://www.cbs.com/shows/'+slug+'/about/');
        // The CBS page may contain only current-run promotional copy. The
        // programme distributor publishes a separate series-wide synopsis.
        pages.push('https://www.paramountglobalcontent.com/title/'+slug);
      }
    }
    return show;
  }):null;
  if(seriesTask)await briefly(seriesTask,180);
  if(seriesDetails)return {...seriesDetails,synopsisVersion:SYNOPSIS_VERSION,synopsisScope:'series',imdbId:id,imdbUrl:id?imdbURL(id):'',state:'ready'};
  // Cross-check the exact IMDb identity, film title and year. The studio
  // homepage takes priority; an attributed film record can rescue outages.
  let filmDatabaseDetails=null;
  const filmDatabaseTask=selected.type==='Film'&&tmdbToken?attempt(async()=>{
    if(!id)await identity();
    if(!id)return null;
      const authorization={headers:{Authorization:'Bearer '+tmdbToken}};
      const hits=await get('https://api.themoviedb.org/3/find/'+encodeURIComponent(id)+'?external_source=imdb_id',false,authorization);
      const found=(Array.isArray(hits.movie_results)?hits.movie_results:[]).filter(movie=>
        Number.isInteger(Number(movie?.id))&&Number(movie.id)>0&&
        nameKey(movie.title||movie.original_title)===nameKey(selected.title)&&
        (!selected.year||yearOf(movie.release_date)===selected.year));
      if(found.length!==1)return null;
      const movie=await get('https://api.themoviedb.org/3/movie/'+Number(found[0].id),false,authorization);
      if(imdbID(movie?.imdb_id)!==id||nameKey(movie.title||movie.original_title)!==nameKey(selected.title)||
        (selected.year&&yearOf(movie.release_date)!==selected.year))return null;
      filmDatabaseDetails=record({description:isWholeTitleSynopsis(movie.overview)?text(movie.overview):"",
        premiered:String(movie.release_date||''),year:yearOf(movie.release_date),
        genres:(Array.isArray(movie.genres)?movie.genres:[]).map(row=>clean(row.name)).filter(Boolean),
        runtime:Number(movie.runtime)||null,status:clean(movie.status),language:clean(movie.original_language)
      },'TMDb','https://www.themoviedb.org/movie/'+Number(movie.id));
      const homepage=firstPartyURL(movie.homepage);
      if(homepage){
        const studioTask=attempt(async()=>parseFirstPartyDetails(await get(homepage.url,true),homepage.url,selected));
        // When the database has no synopsis, keep the studio task in the
        // fallback race until it answers; a short preference window must not
        // discard the only source capable of supplying a description.
        const studio=filmDatabaseDetails.description?await briefly(studioTask):await studioTask;
        if(studio)return studio;
      }
      return filmDatabaseDetails;
  }):null;
  const discoveredOfficial=attempt(async()=>{
    // TVMaze can still finish in the background and provide its verified
    // broadcaster URL, while an independent IMDb fallback is already running.
    if(seriesTask)await seriesTask;
    if(seriesDetails)return seriesDetails;
    return firstSynopsis([...new Set(pages)].slice(0,3).map(loadOfficial));
  });
  const officialTask=suppliedOfficial?firstSynopsis([suppliedOfficial,discoveredOfficial]):discoveredOfficial;
  let result=await briefly(officialTask);
  const add=details=>{
    if(!details)return;
    if(!result){result=details;return;}
    let used=false;
    for(const field of ['description','premiered','year','genres','status','rating','runtime','language','seasons']){
      if((!result[field]||(Array.isArray(result[field])&&!result[field].length))&&details[field]){result[field]=details[field];used=true;if(field==='description')result.descriptionSource=details.descriptionSource||details.source;if(field==='rating')result.ratingSource=details.ratingSource||details.source;}
    }
    if(used)for(const source of details.sources||[])if(!result.sources.some(row=>row.url===source.url))result.sources.push(source);
  };
  // IMDb remains the preferred film source. A store listing is also a valid
  // fallback for non-Apple films, but only for the exact title and release year.
  if(!id&&!selected.year)await attempt(identity);
  const preferredIMDb=id?loadIMDb():null;
  // Give a quick preferred response a brief head start before fanning out.
  const waitedForIMDb=!result?.description&&Boolean(preferredIMDb);
  if(waitedForIMDb){
    add(await briefly(preferredIMDb));
  }
  const fallbackTasks=[officialTask,...(filmDatabaseTask?[filmDatabaseTask]:[]),...(discoveredIMDb?[discoveredIMDb]:[])];
  if(!result?.description&&selected.type==='Film')fallbackTasks.push(attempt(async()=>{
    // An exact selected title/year is sufficient for a retail lookup. Do not
    // make it wait for an unrelated IMDb suggestion request to time out.
    const match=canonical||(!selected.year?await attempt(identity):null);
    const title=match?.title||selected.title,year=match?.year||selected.year;
    if(!title||!year)return null; // A title alone cannot distinguish remakes.
    for(const country of ['gb','us']){
      const url=selected.appleId?'https://itunes.apple.com/lookup?id='+selected.appleId+'&country='+country:
        'https://itunes.apple.com/search?term='+encodeURIComponent(title)+'&country='+country+'&media=movie&entity=movie&limit=40';
      const data=await attempt(()=>get(url));
      if(!Array.isArray(data?.results))continue;
      const matches=data.results.filter(row=>row.kind==='feature-movie'&&
        (!selected.appleId||String(row.trackId)===selected.appleId)&&
        nameKey(row.trackName)===nameKey(title)&&yearOf(row.releaseDate)===year);
      if(matches.length>1)return null;
      if(matches.length!==1)continue;
      const row=matches[0];let link;
      try{link=new URL(row.trackViewUrl);if(link.protocol!=='https:'||!['itunes.apple.com','tv.apple.com'].includes(link.hostname))continue;}catch{continue;}
      const description=[row.longDescription,row.shortDescription].find(value=>isWholeTitleSynopsis(value,1));
      if(!description)continue;
      return record({description:text(description),premiered:String(row.releaseDate||'').slice(0,10),year,
        genres:row.primaryGenreName?[clean(row.primaryGenreName)]:[],runtime:row.trackTimeMillis?Math.round(row.trackTimeMillis/60000):null},'Apple TV',link.href);
    }
    return null;
  }));
  if(!result?.description&&selected.type==='Film'&&id&&selected.title)fallbackTasks.push(attempt(async()=>{
    const listing=await watchListing({...selected,imdbId:id},get);if(!listing)return null;
    const content=listing.content;
    const region=selected.country==='GB'?'uk':selected.country.toLowerCase();
    if(!new RegExp('^/'+region+'/movie/[a-zA-Z0-9_-]+$').test(content.fullPath||'')||!isWholeTitleSynopsis(content.shortDescription))return null;
    return record({description:text(content.shortDescription),year:yearOf(content.originalReleaseYear)},'JustWatch','https://www.justwatch.com'+content.fullPath);
  }));
  // Last-resort studio discovery is generic, not a list of hand-written plots.
  // Unlike an IMDb-linked homepage, a guessed studio path must prove its year.
  if(!result?.description&&selected.type==='Film'&&selected.title&&selected.year){
    const slug=nameKey(selected.title).replace(/ /g,'-');
    const urls=[...(/^(?:harry potter|fantastic beasts)\b/.test(nameKey(selected.title))?['https://www.harrypotter.com/discover/films/'+slug]:[]),'https://movies.disney.com/'+slug,'https://www.warnerbros.com/movies/'+slug,
      'https://www.sonypictures.com/movies/'+slug.replace(/-/g,''),'https://www.mgm.com/movies/'+slug];
    fallbackTasks.unshift(firstSynopsis(urls.map(url=>attempt(async()=>parseFirstPartyDetails(await get(url,true),url,{...selected,requireYear:true})))));
  }
  if(preferredIMDb)fallbackTasks.push(preferredIMDb);
  if(!result?.description){
    const winner=await firstSynopsis(fallbackTasks);
    add(winner);
  }
  if(result?.description&&preferredIMDb&&!imdbDetails&&!waitedForIMDb)add(await briefly(preferredIMDb));
  // Merge only facts that have already arrived. Optional ratings, season
  // counts and slow preferred providers must not delay a usable description.
  add(imdbDetails);
  add(filmDatabaseDetails);
  return {...(result||{sources:[]}),synopsisVersion:SYNOPSIS_VERSION,synopsisScope:selected.type==='Series'?'series':'film',imdbId:id,imdbUrl:id?imdbURL(id):'',state:result?.description?'ready':result?'partial':id||selected.tvmazeId||selected.appleId?'unavailable':'unmatched'};
}
