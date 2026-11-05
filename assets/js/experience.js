/* Home, saved-library navigation and device continuity. */
let homeRecommendationRequest=null,homeRecommendationRetryAt=0;
function homeIsVisible(){return Boolean(currentUser&&currentTab==='library'&&!libraryOnlyPage&&!calendarOnlyPage);}
function homeArtworkItem(item){return {...item,type:item.type||item.format||'Series',id:item.id||item.externalId||item.tvmazeId||item.imdbId,tvmazeShowId:item.tvmazeShowId||item.tvmazeId||(item.source==='tvmaze'?item.externalId:'')};}
function homePoster(item,attributes,subtitle=''){
  const artwork=homeArtworkItem(item),key=`${artwork.type}:${artwork.imdbId||artwork.tvmazeShowId||artwork.id}`;
  return `<button type="button" class="home-poster" ${attributes}><span class="home-poster-art"><span>${esc(item.title)}</span><img hidden alt="" data-art="${esc(key)}" decoding="async"></span><strong>${esc(item.title)}</strong>${subtitle?`<small>${esc(subtitle)}</small>`:''}</button>`;
}
function homeRecommendationSeeds(items){
  return items.map(item=>{
    const watched=Object.values(item.watchedEpisodes||{}).some(episodes=>Array.isArray(episodes)&&episodes.length)||Number(item.curEp)>0||Number(item.watchedSeasons)>0;
    return {item,weight:1+(item.favorite?3:0)+(watched||item.status==='Watched'?2:0)+(item.status==='Watching'?1:0)};
  }).sort((a,b)=>b.weight-a.weight||recentAdditionTime(b.item)-recentAdditionTime(a.item)).slice(0,32).map(({item,weight})=>({title:item.title,type:item.type,tvmazeId:item.tvmazeShowId,imdbId:item.imdbId,genres:item.genres||item.verifiedDetails?.genres||[],description:item.description||item.verifiedDetails?.description||'',weight}));
}
function homeSection(title,content){return `<section class="home-section"><h2>${title}</h2>${content}</section>`;}
function renderHomeDashboard(){
  const root=$('home-view');if(!root||!homeIsVisible())return;
  const items=mediaItems.filter(item=>!item.archived),account=String(currentUser.id);
  const continued=items.filter(isEpisodeTrackable).flatMap(item=>{
    const marked=(item.episodeHistory||[]).filter(event=>event.kind!=='unmark');
    const activity=marked.length?Math.max(...marked.map(event=>toMillis(event.watchedAt)),0):toMillis(item.lastEpisodeWatchedAt);
    const next=nextWatchEpisode(item);
    return activity&&next?[{item,next,activity}]:[];
  }).sort((a,b)=>b.activity-a.activity).slice(0,12);
  const upcoming=calendarWindowEvents(items).events.filter(event=>event.date.getTime()>Date.now()&&event.date.getTime()<=Date.now()+7*86400000).slice(0,12);
  const recent=[...items].sort((a,b)=>recentAdditionTime(b)-recentAdditionTime(a)).slice(0,12);
  const seeds=homeRecommendationSeeds(items),signature=JSON.stringify(seeds),cacheKey='watchlog_recommendations_v2_'+account;
  const cached=safeReadJSON(cacheKey,null);
  const recommendations=(cached?.items||[]).filter(row=>!discoveryDuplicate(row)).slice(0,12);
  const carousel=cards=>`<div class="home-carousel">${cards}</div>`;
  const recommendationContent=recommendations.length?carousel(recommendations.map((item,index)=>homePoster(item,`data-home-recommend="${index}"`,item.reason||'Based on your library')).join('')):`<p class="home-empty">${navigator.onLine===false?'Connect to discover recommendations based on your library.':items.length?'Finding shows based on your library…':'Save a few shows to discover recommendations.'}</p>`;
  const markup=homeSection('Recommended for you',recommendationContent)+homeSection('Continue Watching',continued.length?carousel(continued.map(({item,next})=>`<article class="home-continue">${homePoster(item,`data-home-item="${esc(item.id)}"`,`Next · S${next.season} E${next.episode}`)}<button type="button" class="home-mark" data-home-mark="${esc(item.id)}" data-season="${next.season}" data-episode="${next.episode}"${episodeLogBusy.has(String(item.id))?' disabled':''}>Mark watched</button></article>`).join('')):'<p class="home-empty">Mark an episode watched to continue that show here.</p>')+homeSection('Coming Up',upcoming.length?carousel(upcoming.map(event=>homePoster(event.item,`data-home-item="${esc(event.item.id)}"`,`${event.label} · ${formatLocalDate(event.date)}`)).join('')):'<p class="home-empty">No saved releases in the next seven days.</p>')+homeSection('Recently Added',recent.length?carousel(recent.map(item=>homePoster(item,`data-home-item="${esc(item.id)}"`)).join('')):'<p class="home-empty">Your newest saved titles will appear here.</p>');
  if(root._homeMarkup!==markup){root.innerHTML=markup;root._homeMarkup=markup;}
  root._recommendations=recommendations;
  root._artItems=[...items,...recommendations.map(homeArtworkItem)];
  window.WatchLogGallery?.observeScheduleArtwork?.(root,root._artItems);
  if(items.length&&navigator.onLine!==false&&!homeRecommendationRequest&&Date.now()>homeRecommendationRetryAt&&(!cached||cached.signature!==signature||Date.now()-cached.savedAt>((cached.items||[]).length?6*3600000:60000))){
    homeRecommendationRetryAt=Date.now()+60000;
    homeRecommendationRequest=pinApi('recommendations',{seeds,country:typeof releaseViewingCountry==='function'?releaseViewingCountry():'GB',exclude:items.slice(0,1000).map(item=>({title:item.title,tvmazeId:item.tvmazeShowId,imdbId:item.imdbId}))}).then(result=>{
      if(String(currentUser?.id)!==account)return;
      if(Array.isArray(result.results))safeWriteJSON(cacheKey,{items:result.results,savedAt:Date.now(),signature});
    }).catch(()=>{}).finally(()=>{
      homeRecommendationRequest=null;
      if(String(currentUser?.id)===account&&homeIsVisible()){
        renderHomeDashboard();
        const empty=root.querySelector('.home-section .home-empty');
        if(empty)empty.textContent='Recommendations are temporarily unavailable. Your library is ready to browse.';
      }
    });
  }
}
$('home-view').addEventListener('click',event=>{
  const open=event.target.closest('[data-home-item]');
  if(open){openMediaRow(open.dataset.homeItem,open);return;}
  const mark=event.target.closest('[data-home-mark]');
  if(mark){void toggleEpisodeWatched(mark.dataset.homeMark,Number(mark.dataset.season),Number(mark.dataset.episode));return;}
  const recommendation=event.target.closest('[data-home-recommend]');
  if(recommendation){const item=$('home-view')._recommendations?.[Number(recommendation.dataset.homeRecommend)];if(item)showDiscoveryDetail(item,recommendation);}
});
