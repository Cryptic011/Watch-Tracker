import { firstPartyURL } from './title-details.mjs';

const cache=new Map(),pending=new Map();
const titleKey=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const positive=value=>/^\d+$/.test(String(value))&&Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):0;
// Keep this list aligned with img-src and the browser's episode artwork check.
export function publisherImageURL(value){
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||url.port)return '';
    return /^(?:static\.nbc\.com|www\.nbc\.com|wwwimage-us\.pplusstatic\.com|wwwimage-intl\.pplusstatic\.com|ichef\.bbci\.co\.uk|[^.]+\.mzstatic\.com)$/.test(url.hostname)?url.href:'';
  }catch{return '';}
}

// A broadcaster-hosted episode image may still be a frame grab. Require the
// publisher to explicitly identify the image as a poster, then match its episode.
function labelledPoster(value){
  if(!value||typeof value!=='object')return false;
  const labels=[value.caption,value.name,value.description,...[value.additionalType].flat()].filter(label=>typeof label==='string');
  if(labels.some(label=>/\b(?:screen[ -]?(?:shot|grab)|frame[ -]?grab|still(?:[ -]?(?:image|frame|photo))?|video thumbnail)\b/i.test(label)))return false;
  return labels.some(label=>/^(?:(?:official|promotional|episode)\s+)*poster(?:\s+(?:for|of)\b.*)?[.!]?$/i.test(label.trim())||/^https?:\/\/[^ ]+[\/#](?:EpisodePoster|Poster)$/i.test(label.trim()));
}

export function parsePublisherEpisodeArtwork(markup,show,episodes){
  const images={},sources=new Map(),nodes=[],byId=new Map();
  if(typeof markup!=='string'||markup.length>2000000)return images;
  const visit=(value,depth=0)=>{
    if(!value||typeof value!=='object'||nodes.length>=5000||depth>30)return;
    nodes.push(value);
    if(typeof value['@id']==='string'&&Object.keys(value).length>1)byId.set(value['@id'],value);
    for(const child of Object.values(value))visit(child,depth+1);
  };
  for(const script of markup.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)){
    try{visit(JSON.parse(script[1]));}catch{/* Invalid publisher metadata is optional. */}
  }
  const resolve=value=>value?.['@id']&&byId.has(value['@id'])?byId.get(value['@id']):value;
  const records=new Map((Array.isArray(episodes)?episodes:[]).map(ep=>[`${ep.season}:${ep.number}`,ep]));
  for(const node of nodes){
    if(![node['@type']].flat().some(type=>type==='TVEpisode'||type==='https://schema.org/TVEpisode'))continue;
    const season=resolve(node.partOfSeason),series=resolve(node.partOfSeries||season?.partOfSeries);
    const s=positive(season?.seasonNumber),e=positive(node.episodeNumber),key=`${s}:${e}`,episode=records.get(key);
    if(!s||!e||!episode||titleKey(series?.name)!==titleKey(show.name)||!titleKey(episode.name)||titleKey(node.name)!==titleKey(episode.name))continue;
    const published=String(series?.datePublished||series?.startDate||'').slice(0,4);
    if(published&&published!==String(show.premiered||'').slice(0,4))continue;
    const imageURL=value=>{value=resolve(value);return publisherImageURL(typeof value==='string'?value:value?.contentUrl||value?.url);};
    const covers=new Set([series?.image,season?.image].flat().map(imageURL).filter(Boolean));
    const candidates=[node.image].flat().map(resolve).filter(labelledPoster).map(imageURL).filter(url=>url&&!covers.has(url));
    if(candidates[0]){
      if(!sources.has(key))sources.set(key,new Set());
      sources.get(key).add(candidates[0]);
    }
  }
  const uses=new Map();
  for(const [key,urls] of sources)for(const url of urls){if(!uses.has(url))uses.set(url,new Set());uses.get(url).add(key);}
  for(const [key,urls] of sources){
    if(urls.size!==1||uses.get([...urls][0]).size!==1)continue; // Conflicting records must not pick a random image.
    const [s,e]=key.split(':');(images[s]||(images[s]={}))[e]=[...urls][0];
  }
  return images;
}

export async function getEpisodeArtwork(input,request=fetch,{useCache=true,timeoutMs=4500}={}){
  const id=positive(input.tvmazeShowId),imdb=String(input.imdbId||'');
  if(!id||!titleKey(input.title))return {state:'unmatched',episodeImages:{}};
  const key=JSON.stringify([id,imdb,titleKey(input.title)]),saved=cache.get(key);
  if(useCache&&saved?.expires>Date.now())return structuredClone(saved.value);
  if(useCache&&pending.has(key))return structuredClone(await pending.get(key));
  const controller=new AbortController();let timer;
  const task=(async()=>{
    const get=async(url,html=false)=>{
      // Redirects are rejected before following them, including private destinations.
      const response=await request(url,{signal:controller.signal,redirect:'error',credentials:'omit',headers:{Accept:html?'text/html':'application/json'}});
      if(!response.ok)throw Error('Artwork source unavailable');
      const reader=response.body.getReader();let size=0;const chunks=[];
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2000000){await reader.cancel();throw Error('Artwork response too large');}chunks.push(value);}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      const text=new TextDecoder().decode(bytes);return html?text:JSON.parse(text);
    };
    const show=await get(`https://api.tvmaze.com/shows/${id}`);
    if(Number(show?.id)!==id||titleKey(show.name)!==titleKey(input.title)||(imdb&&show.externals?.imdb!==imdb))return {state:'unmatched',episodeImages:{}};
    // Discover the URL from the verified provider record, never from caller input.
    const site=firstPartyURL(show.officialSite);
    if(!site)return {state:'ready',episodeImages:{}};
    const [markup,episodes]=await Promise.all([get(site.url,true),get(`https://api.tvmaze.com/shows/${id}/episodes`)]);
    return {state:'ready',episodeImages:parsePublisherEpisodeArtwork(markup,show,episodes),source:site.name,sourceUrl:site.url};
  })();
  const bounded=Promise.race([task,new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve({state:'unavailable',episodeImages:{}});},timeoutMs);})])
    .catch(()=>({state:'unavailable',episodeImages:{}})).then(value=>({...value,artworkPolicy:'publisher-labelled-posters-v2'})).finally(()=>{clearTimeout(timer);controller.abort();});
  if(useCache)pending.set(key,bounded);
  try{
    const value=await bounded;
    if(useCache&&value.state==='ready'){
      if(cache.size>=100)cache.delete(cache.keys().next().value);
      cache.set(key,{value,expires:Date.now()+(Object.keys(value.episodeImages).length?6*60*60*1000:15*60*1000)});
    }
    return structuredClone(value);
  }finally{if(pending.get(key)===bounded)pending.delete(key);}
}
