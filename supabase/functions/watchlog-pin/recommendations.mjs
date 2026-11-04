const cache=new Map();
export async function getRecommendations(seeds,get){
  const selected=(Array.isArray(seeds)?seeds:[]).slice(0,16),key=JSON.stringify(selected);
  const cached=cache.get(key);if(cached&&cached.expires>Date.now())return cached.rows;
  const ids=new Set(selected.map(row=>String(row.tvmazeId||''))),imdb=new Set(selected.map(row=>row.imdbId).filter(Boolean));
  const names=new Set(selected.map(row=>String(row.title||'').toLowerCase()));
  const sources=await Promise.allSettled(selected.filter(row=>/^\d{1,10}$/.test(String(row.tvmazeId||''))).slice(0,8).map(row=>get('https://api.tvmaze.com/shows/'+row.tvmazeId)));
  const genres=new Map();
  for(const source of sources)if(source.status==='fulfilled')for(const genre of source.value.genres||[])genres.set(genre,(genres.get(genre)||0)+1);
  if(!genres.size)return [];
  const pages=await Promise.allSettled([0,1,2].map(page=>get('https://api.tvmaze.com/shows?page='+page)));
  const shows=[...new Map(pages.flatMap(page=>page.status==='fulfilled'&&Array.isArray(page.value)?page.value:[]).map(show=>[show.id,show])).values()];
  const rows=shows.filter(show=>!ids.has(String(show.id))&&!imdb.has(show.externals?.imdb)&&!names.has(String(show.name||'').toLowerCase())&&show.image?.medium).map(show=>{
    const shared=(show.genres||[]).filter(genre=>genres.has(genre));
    return {show,shared,score:shared.reduce((sum,genre)=>sum+genres.get(genre),0)*10+Number(show.rating?.average||0)};
  }).filter(row=>row.shared.length).sort((a,b)=>b.score-a.score).slice(0,16).map(({show,shared})=>({source:'tvmaze',externalId:String(show.id),tvmazeId:String(show.id),imdbId:show.externals?.imdb||'',title:show.name,format:'Series',year:String(show.premiered||'').slice(0,4),posterUrl:show.image.original||show.image.medium,description:show.summary||'',reason:shared.slice(0,2).join(' · '),detail:'Recommended from your library',genres:show.genres}));
  if(cache.size>=100)cache.delete(cache.keys().next().value);
  cache.set(key,{rows,expires:Date.now()+12*3600000});return rows;
}
