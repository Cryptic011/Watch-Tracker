/* Library presentation only. All progress, edits and reminders use the existing app. */
window.WatchLogGallery=(()=>{
  let category='',api=null,host=null,observer=null,dialog=null,returnFocus=null,active=0;
  const cache=new Map(),pending=new Set(),queue=[];
  const ARTWORK_CACHE_MS=6*60*60*1000;
  const freshArt=id=>{const entry=cache.get(id);return entry&&Date.now()-entry.checkedAt<(entry.url?ARTWORK_CACHE_MS:5*60*1000)?entry:null;};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const isFilm=item=>item.type==='Film';
  const key=item=>`${item.type}:${item.imdbId||item.tvmazeShowId||item.id}`;
  const safeImage=value=>{try{const u=new URL(value);return u.protocol==='https:'&&(/(^|\.)media-amazon\.com$|(^|\.)tvmaze\.com$/.test(u.hostname))?u.href:'';}catch{return '';}};
  function savedArt(item){return safeImage(item?.posterUrl||item?.imageUrl||item?.poster||item?.image?.original||item?.image?.medium);}
  function applyImage(img,url){
    if(!url)return;
    if(img.getAttribute?.('src')===url&&(!img._galleryImageFailedAt||Date.now()-img._galleryImageFailedAt<60000))return;
    img._galleryImageFailedAt=0;
    img.onload=()=>{img.hidden=false;img._galleryImageFailedAt=0;};
    img.onerror=()=>{img.hidden=true;img._galleryImageFailedAt=Date.now();};
    img.src=url;
  }
  async function fetchArt(item){
    const signal=AbortSignal.timeout(6500);
    // Saved artwork may be an early teaser. Check the same title's provider
    // identity again, retaining the saved image only when no update is available.
    const direct=safeImage(item.posterUrl||item.imageUrl||item.poster||item.image?.original||item.image?.medium);
    const title=String(item.title||'').trim(),query=encodeURIComponent(title);
    let artworkImdbId=String(item.imdbId||'').trim();
    const normalized=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
    if(!isFilm(item)){
      const imdbId=String(item.imdbId||'').trim(),showId=String(item.tvmazeShowId||'').trim();
      const matches=show=>{
        if(imdbId)return show?.externals?.imdb===imdbId;
        if(showId)return String(show?.id)===showId;
        return normalized(show?.name)===normalized(title)&&(!item.releaseYear||String(show?.premiered||'').slice(0,4)===String(item.releaseYear));
      };
      const url=/^\d+$/.test(showId)?`https://api.tvmaze.com/shows/${showId}`:/^tt\d+$/.test(imdbId)?`https://api.tvmaze.com/lookup/shows?imdb=${encodeURIComponent(imdbId)}`:'';
      if(url)try{const response=await fetch(url,{signal});if(response.ok){const show=await response.json();if(matches(show)){if(/^tt\d+$/.test(String(show.externals?.imdb||'')))artworkImdbId=show.externals.imdb;const image=safeImage(show.image?.original||show.image?.medium);if(image)return image;}}}catch(_){}
      // Never replace a known identity with the first same-name search result.
      if(!imdbId&&!showId&&query)try{
        const response=await fetch(`https://api.tvmaze.com/search/shows?q=${query}`,{signal});
        if(response.ok){const rows=await response.json(),candidates=Array.isArray(rows)?rows.map(row=>row.show).filter(matches):[];
          if(candidates.length===1){const image=safeImage(candidates[0].image?.original||candidates[0].image?.medium);if(image)return image;}}
      }catch(_){}
    }
    if(!query)return direct;
    // A known TVMaze show must never fall back to a different title identity.
    if(!isFilm(item)&&item.tvmazeShowId&&!artworkImdbId)return direct;
    // IMDb suggestion responses do not grant browser CORS access. Use the
    // existing authenticated catalogue endpoint and match identity, not rank.
    if(api?.artwork)try{
      const rows=await api.artwork(artworkImdbId?{...item,imdbId:artworkImdbId}:item);
      const candidates=Array.isArray(rows)?rows:[];
      const matches=candidates.filter(row=>artworkImdbId?row.imdbId===artworkImdbId:normalized(row.title)===normalized(title)&&row.format===(isFilm(item)?'Film':'Series')&&(!item.releaseYear||String(row.year)===String(item.releaseYear)));
      const identities=new Set(matches.map(row=>row.imdbId||row.externalId||row.tvmazeId||''));
      const match=identities.size===1?matches.find(row=>safeImage(row.posterUrl)):null;
      const image=safeImage(match?.posterUrl);if(image)return image;
    }catch(_){}
    return direct;
  }
  function pump(){while(active<3&&queue.length){const item=queue.shift(),id=key(item);active++;fetchArt(item).catch(()=>'').then(url=>{
    cache.set(id,{url,checkedAt:Date.now()});if(cache.size>250)cache.delete(cache.keys().next().value);
    document.querySelectorAll('.gallery-art img').forEach(img=>{if(img.dataset.art===id)applyImage(img,url);});
  }).finally(()=>{active--;pending.delete(id);pump();});}}
  function observe(root,items){
    const byKey=new Map(items.map(item=>[key(item),item]));
    const enqueue=(img,item)=>{
      const id=key(item),cached=freshArt(id);
      applyImage(img,cached?.url||savedArt(item));
      if(!cached&&!pending.has(id)){pending.add(id);queue.push(item);pump();}
    };
    if(!observer&&typeof IntersectionObserver!=="undefined")observer=new IntersectionObserver(entries=>{
      for(const entry of entries){
        if(!entry.isIntersecting)continue;
        const box=entry.target;observer.unobserve(box);
        const img=box.querySelector("img[data-art]");
        if(img?._galleryItem)enqueue(img,img._galleryItem);
      }
    },{rootMargin:'160px'});
    for(const img of root.querySelectorAll('[data-art]')){
      const item=byKey.get(img.dataset.art);img._galleryItem=item;
      if(!item)continue;
      const cached=freshArt(img.dataset.art);
      if(cached)applyImage(img,cached.url||savedArt(item));
      else if(observer)observer.observe(img.parentElement);
      else enqueue(img,item);
    }
  }
  function art(item){
    const initials=String(item.title||'?').split(/\s+/).slice(0,2).map(s=>s[0]).join('');
    return `<div class="gallery-art"><span aria-hidden="true">${esc(initials)}</span><div class="gallery-art-title">${esc(item.title||'Untitled')}</div><div class="gallery-art-meta">${esc(isFilm(item)?'FILM':'SERIES')} · ${esc(item.releaseYear||'WATCH TRACKER')}</div><img hidden alt="" data-art="${esc(key(item))}" decoding="async"></div>`;
  }
  function stateBadge(item){const last=api.last(item);return last?`<span class="gallery-tile-status done">✓ S${esc(last.season)} E${esc(last.episode)} watched</span>`:`<span class="gallery-tile-status">${esc(item.status==='Saved'?'Planned':item.status||'Planned')}</span>`;}
  function releaseTime(item){const value=isFilm(item)?item.filmReleaseDate:item.seriesReleaseDate;const time=Date.parse(value?`${String(value).slice(0,10)}T12:00:00Z`:'');return Number.isFinite(time)?time:0;}
  function releaseYear(item){const time=releaseTime(item);return time?String(new Date(time).getUTCFullYear()):/^\d{4}$/.test(String(item.releaseYear||''))?String(item.releaseYear):'Date unknown';}
  function releaseGroups(items){
    const groups=new Map();
    for(const item of items){const year=releaseYear(item);if(!groups.has(year))groups.set(year,[]);groups.get(year).push(item);}
    return [...groups].sort(([a],[b])=>(Number(b)||0)-(Number(a)||0)).map(([year,rows])=>({year,rows:rows.slice().sort((a,b)=>releaseTime(b)-releaseTime(a)||String(a.title).localeCompare(String(b.title)))}));
  }
  function releasedByYear(item,now){return /^\d{4}$/.test(String(item.releaseYear||''))&&Number(item.releaseYear)<new Date(now).getUTCFullYear();}
  function sections(items,upcoming,now=Date.now()){
    const future=[],released=[],remaining=[],events=new Map();
    for(const item of items){
      const event=upcoming(item,now),time=releaseTime(item);
      events.set(item,event);
      const isUpcoming=event.rank>0;
      const isReleased=time>0?time<=now:releasedByYear(item,now)||!isFilm(item)&&Object.values(item.releasedEpisodes||{}).some(a=>a.length);
      if(isUpcoming)future.push(item);
      if(isReleased)released.push(item);
      if(!isUpcoming&&!isReleased)remaining.push(item);
    }
    future.sort((a,b)=>events.get(a).time-events.get(b).time);
    return {future,released,remaining};
  }
  function tile(item,upcoming=false){
    const event=api.upcoming(item);
    let subtitle=releaseTime(item)?api.date(new Date(releaseTime(item))):item.releaseYear||'Date unknown';
    if(upcoming){const season=event.season||item.nextSeasonNum||item.airingSeason||item.curSeason||'?';const label=event.kind==='episode'?`S${season} E${event.number||'?'}`:event.kind==='season'?`Season ${event.number||'?'}`:'Film release';subtitle=`${label} · ${event.rank===2?api.dateTime(new Date(event.time)):'Date TBA'}`;}
    return `<button type="button" class="gallery-tile" data-gallery-item="${esc(item.id)}" aria-label="Open ${esc(item.title)}">${art(item)}${stateBadge(item)}<strong>${esc(item.title)}</strong><small>${esc(subtitle)}</small></button>`;
  }
  function manageButton(items,label){
    return `<button type="button" class="gallery-manage-button" data-gallery-manage="${esc(label)}" data-gallery-manage-ids="${esc(JSON.stringify(items.map(item=>String(item.id))))}" aria-label="Manage ${esc(label.toLowerCase())} titles" title="Manage ${esc(label.toLowerCase())} titles"${items.length?'':' disabled'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 3 5 5M4 20l4-1L21 6a2.8 2.8 0 0 0-4-4L4 15l-1 6Z"/></svg></button>`;
  }
  function section(title,items,carousel=false){return items.length?`<section class="gallery-section" data-gallery-section="${esc(title)}"><h3>${esc(title)}<span class="gallery-count">${items.length}</span></h3><div class="${carousel?'gallery-carousel'+(category==='Film'?' gallery-film-carousel':''):'gallery-grid'}">${items.map(item=>tile(item,carousel)).join('')}</div></section>`:'';}
  function paintTrackerImage(container,url,label){
    const placeholder=`<span class="gallery-artwork-placeholder" aria-label="No artwork available">${esc(label)}</span>`;
    if(container._trackerImage===url)return;
    container._trackerImage=url;
    container.innerHTML=url?`<img src="${esc(url)}" alt="" loading="lazy" decoding="async">`:placeholder;
    const image=container.querySelector('img');
    if(image)image.onerror=()=>{container.innerHTML=placeholder;};
  }
  function paintTrackerArtwork(section,artwork){
    if(artwork.episodeImages)for(const row of section.querySelectorAll('[data-gallery-episode]')){
      const [season,episode]=row.dataset.galleryEpisode.split(':').map(Number);
      paintTrackerImage(row.querySelector('.gallery-episode-art'),artwork.episodeImages?.[season]?.[episode]||'',`E${episode}`);
    }
    if(artwork.seasonImages)for(const poster of section.querySelectorAll('[data-gallery-season-art]')){
      paintTrackerImage(poster,artwork.seasonImages[poster.dataset.gallerySeasonArt]||'',`S${poster.dataset.gallerySeasonArt}`);
    }
  }
  async function loadTrackerArtwork(item){
    const section=dialog.querySelector('.gallery-season-list'),callbacks=api;
    if(!section)return;
    dialog._trackerArtwork={episodeImages:item.episodeImagesSource==='TVMaze'?item.episodeImages||{}:{},seasonImages:item.seasonImagesSource==='TVMaze'?item.seasonImages||{}:{}};
    paintTrackerArtwork(section,dialog._trackerArtwork);
    if(!callbacks.trackerArtwork)return;
    try{
      const artwork=await callbacks.trackerArtwork(item);
      if(section===dialog.querySelector('.gallery-season-list')&&dialog.dataset.item===String(item.id)){dialog._trackerArtwork=artwork;paintTrackerArtwork(section,artwork);}
    }catch(_){}
  }
  function episodeRow(item,season,episode,watched){
    const complete=watched.has(episode),title=item.episodeTitles?.[season]?.[episode]||'Episode '+episode;
    const date=item.episodeReleaseDates?.[season]?.[episode]||'',dateText=date?api.date(new Date(/^\d{4}-\d{2}-\d{2}$/.test(date)?date+'T12:00:00Z':date)):'';
    return `<div class="gallery-episode-row" data-gallery-episode="${season}:${episode}">
      <span class="gallery-episode-art"><span class="gallery-artwork-placeholder">E${episode}</span></span>
      <span class="gallery-episode-copy"><strong>${episode}. ${esc(title)}</strong>${dateText?`<small>${esc(dateText)}</small>`:''}</span>
      <button type="button" class="gallery-episode-toggle" data-gallery-toggle-episode="${season}:${episode}" aria-pressed="${complete}" aria-label="Mark S${season} E${episode} ${complete?'unwatched':'watched'}"><span class="gallery-episode-check" aria-hidden="true">${complete?'✓':''}</span></button>
    </div>`;
  }
  function seasonRow(item,season,releases,watched){
    const episodes=(releases[season]||[]).map(Number).filter(number=>Number.isInteger(number)&&number>0).sort((left,right)=>left-right);
    const done=new Set((watched[season]||[]).map(Number)),watchedCount=episodes.filter(episode=>done.has(episode)).length,complete=episodes.length>0&&watchedCount===episodes.length;
    return `<details class="gallery-season" data-season="${season}">
      <summary><span class="gallery-season-poster" data-gallery-season-art="${season}"><span class="gallery-artwork-placeholder">S${season}</span></span>
        <span class="gallery-season-label"><strong>Season ${season} <span class="gallery-season-chevron" aria-hidden="true">›</span></strong><small>${watchedCount} of ${episodes.length} episodes watched</small></span>
        <button type="button" class="gallery-season-state" data-gallery-season="${season}" aria-pressed="${complete}" aria-label="Mark all Season ${season} episodes ${complete?'unwatched':'watched'}"><span class="gallery-season-check" aria-hidden="true">${complete?'✓':''}</span></button>
      </summary><div class="gallery-season-episodes" data-season-loaded="false"></div>
    </details>`;
  }
  function populateSeason(node,item,releases,watched){
    const container=node.querySelector('.gallery-season-episodes');
    if(!container||container.dataset.seasonLoaded==='true')return;
    const season=Number(node.dataset.season),done=new Set(watched[season]||[]);
    container.innerHTML=(releases[season]||[]).map(episode=>episodeRow(item,season,episode,done)).join('');
    container.dataset.seasonLoaded='true';
    paintTrackerArtwork(node,dialog._trackerArtwork||{});
  }
  function toggleSeasonDetails(node){
    const expanded=!(node._seasonDesired??node.open),container=node.querySelector('.gallery-season-episodes');
    const summary=node.querySelector('summary'),anchorTop=summary.getBoundingClientRect().top;
    const start=node.open?container.getBoundingClientRect().height:0;
    node._seasonMotion?.cancel();node._seasonMotion=null;
    node._seasonDesired=expanded;
    node.open=true;dialog._populateSeason(node);
    if(!container.animate||window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches){
      node.open=expanded;delete node._seasonDesired;container.classList.remove('is-animating');
      if(!expanded)dialog.scrollTop+=summary.getBoundingClientRect().top-anchorTop;
      return;
    }
    container.classList.add('is-animating');
    const motion=container.animate([{height:start+'px',opacity:start?1:0},{height:(expanded?container.scrollHeight:0)+'px',opacity:expanded?1:0}],{duration:220,easing:'cubic-bezier(.2,.75,.25,1)'});
    node._seasonMotion=motion;
    void motion.finished.catch(()=>{}).finally(()=>{
      if(node._seasonMotion!==motion)return;
      node.open=expanded;node._seasonMotion=null;delete node._seasonDesired;container.classList.remove('is-animating');
      if(!expanded&&node.isConnected)dialog.scrollTop+=summary.getBoundingClientRect().top-anchorTop;
    });
  }
  async function changeProgress(item,button,save){
    const section=dialog.querySelector('.gallery-season-list'),expanded=[...dialog.querySelectorAll('.gallery-season')].filter(node=>node._seasonDesired??node.open).map(node=>node.dataset.season),scrollTop=dialog.scrollTop;
    const selector=button.hasAttribute('data-gallery-watch-next')?'[data-gallery-watch-next]':button.hasAttribute('data-gallery-season')?`[data-gallery-season="${button.dataset.gallerySeason}"]`:`[data-gallery-toggle-episode="${button.dataset.galleryToggleEpisode}"]`;
    dialog.querySelectorAll('[data-gallery-season],[data-gallery-toggle-episode],[data-gallery-watch-next]').forEach(control=>{control.disabled=true;});
    try{await save();}
    finally{
      const fresh=api.items().find(row=>String(row.id)===String(item.id));
      if(fresh&&dialog.open&&section===dialog.querySelector('.gallery-season-list')&&dialog.dataset.item===String(item.id)){
        detail(fresh);
        for(const node of dialog.querySelectorAll('.gallery-season')){node.open=expanded.includes(node.dataset.season);if(node.open)dialog._populateSeason(node);}
        dialog.scrollTop=scrollTop;
        (dialog.querySelector(selector)||dialog.querySelector('[data-gallery-view="watch"]'))?.focus({preventScroll:true});
      }
    }
  }
  async function loadTitleDetails(item){
    const target=dialog.querySelector('[data-gallery-details]');
    target.textContent='Loading details…';
    try{
      const details=await api.titleDetails?.(item)||{};
      if(target!==dialog.querySelector('[data-gallery-details]'))return;
      const decoder=document.createElement('textarea');
      decoder.innerHTML=String(details.description||'').replace(/<[^>]*>/g,' ');
      const description=decoder.value.replace(/[^\S\n]+/g,' ').trim();
      const released=api.released?.(item)||item.releasedEpisodes||{};
      const releasedCount=Object.values(released).filter(episodes=>Array.isArray(episodes)&&episodes.length>0).length;
      const releasedSeasons=releasedCount||item.episodeScheduleVerified===true?releasedCount:(details.releasedSeasons??'Unconfirmed');
      const premiere=details.premiered||item.seriesReleaseDate||item.filmReleaseDate||'';
      const facts=[
        ['Release date',premiere?api.date(new Date(premiere.slice(0,10)+'T12:00:00Z')):details.year||item.releaseYear||''],
        ['Released seasons',isFilm(item)?'':releasedSeasons],['Status',details.status||dialog._trackerArtwork?.details?.status||'Unconfirmed']
      ].filter(([,value])=>value!=='');
      target.innerHTML=`<h3>About ${esc(item.title)}</h3><p>${esc(description||'A verified description is temporarily unavailable.')}</p>${facts.length?`<dl>${facts.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`:''}${!description?'<button type="button" class="btn btn-secondary" data-gallery-retry-details>Retry</button>':''}`;
      const retry=target.querySelector('[data-gallery-retry-details]');if(retry)retry.onclick=()=>loadTitleDetails(item);
    }catch(_){
      if(target!==dialog.querySelector('[data-gallery-details]'))return;
      target.innerHTML='<p>Details are temporarily unavailable.</p><button type="button" class="btn btn-secondary" data-gallery-retry-details>Retry</button>';
      target.querySelector('button').onclick=()=>loadTitleDetails(item);
    }
  }
  function closeDetail(){
    const notes=dialog?.querySelector('[data-gallery-notes-field]'),editing=dialog?.querySelector('[data-gallery-notes-editor]:not(.hidden)');
    if(editing&&notes.value.trim()!==dialog._savedNotes&&!confirm('Discard unsaved notes?'))return false;
    dialog?.close();return true;
  }
  function refreshCurrent(){
    if(!dialog?.open||dialog.querySelector('[data-gallery-notes-editor]:not(.hidden)')||dialog.querySelector('[data-gallery-toggle-episode]:disabled,[data-gallery-season]:disabled'))return false;
    const fresh=api.items().find(row=>String(row.id)===dialog.dataset.item);
    if(!fresh){dialog.close();return true;}
    const scroll=dialog.scrollTop,expanded=[...dialog.querySelectorAll('.gallery-season')].filter(node=>node._seasonDesired??node.open).map(node=>node.dataset.season),view=dialog.querySelector('[data-gallery-view][aria-selected="true"]')?.dataset.galleryView;
    detail(fresh);
    for(const node of dialog.querySelectorAll('.gallery-season')){node.open=expanded.includes(node.dataset.season);if(node.open)dialog._populateSeason(node);}
    if(view==='details')dialog.querySelector('[data-gallery-view="details"]').click();
    dialog.scrollTop=scroll;return true;
  }
  function detail(item){
    if(!dialog){
      dialog=document.createElement('dialog');dialog.className='gallery-detail';dialog.setAttribute('aria-label','Title details');document.body.append(dialog);
      dialog.addEventListener('click',event=>{if(event.target===dialog||event.target.closest('[data-gallery-close]'))closeDetail();});
      dialog.addEventListener('scroll',()=>{if(typeof saveNavigationPosition==='function')saveNavigationPosition();},{passive:true});
      dialog.addEventListener('cancel',event=>{event.preventDefault();closeDetail();});
      dialog.addEventListener('close',()=>{if(dialog._authPaused)return;if(typeof applyPendingAppUpdate==='function')setTimeout(applyPendingAppUpdate,0);window.WatchLogNavigation?.titleClosed?.();const target=returnFocus?.isConnected?returnFocus:host?.querySelector(`[data-gallery-item="${CSS.escape(dialog.dataset.item||'')}"]`);target?.focus({preventScroll:true});});
    }
    dialog.dataset.item=String(item.id);
    const show=!isFilm(item),last=api.last(item);
    dialog.classList.toggle('gallery-series-detail',show);
    const watchedTo=show?(last?`S${last.season} E${last.episode}`:'Not started'):(item.status==='Watched'?'Complete':'Not started');
    let savedNotes=String(item.notes||'').trim();
    dialog._savedNotes=savedNotes;
    const releases=show?(api.released?.(item)||item.releasedEpisodes||{}):{},watched=show?(api.watched?.(item)||item.watchedEpisodes||{}):{};
    const seasons=Object.keys(releases).map(Number).filter(number=>Number.isInteger(number)&&number>0).sort((left,right)=>left-right);
    const episodeTotal=seasons.reduce((sum,season)=>sum+(releases[season]||[]).length,0);
    const watchedTotal=seasons.reduce((sum,season)=>sum+(releases[season]||[]).filter(episode=>(watched[season]||[]).includes(episode)).length,0);
    const next=show?api.next?.(item):null;
    dialog.innerHTML=`<header class="gallery-detail-header">${show?'<button type="button" class="gallery-back" data-gallery-close aria-label="Back to Library">‹</button>':''}<h2>${esc(item.title)}</h2><div class="gallery-detail-header-actions">
      <button type="button" class="gallery-menu-button" data-gallery-menu aria-label="Title actions" aria-expanded="false">•••</button>
      ${show?'':'<button type="button" class="gallery-back" data-gallery-close aria-label="Close details">×</button>'}</div></header>
      <div class="gallery-detail-body">${art(item)}
      <section class="gallery-notes-preview${savedNotes?'':' hidden'}" data-gallery-notes-preview><h3>Notes</h3><p>${esc(savedNotes)}</p></section>
      <section class="gallery-notes-editor hidden" data-gallery-notes-editor aria-labelledby="gallery-notes-label">
        <h3 id="gallery-notes-label">Notes</h3><textarea class="gallery-notes" data-gallery-notes-field aria-label="Notes" placeholder="Personal notes about this show or film">${esc(savedNotes)}</textarea>
        <div class="gallery-notes-actions"><button class="btn btn-primary" type="button" data-gallery-save-notes>Save notes</button><button class="btn btn-secondary" type="button" data-gallery-cancel-notes>Cancel</button></div>
        <p data-gallery-notes-status role="status" aria-live="polite"></p>
      </section>
      <div class="gallery-detail-tabs" role="tablist" aria-label="Title view"><button id="gallery-watch-tab" type="button" role="tab" aria-selected="true" aria-controls="gallery-watch-panel" data-gallery-view="watch">${show?'Episodes':'Overview'}</button><button id="gallery-info-tab" type="button" role="tab" tabindex="-1" aria-selected="false" aria-controls="gallery-info-panel" data-gallery-view="details">Details</button></div>
      <section id="gallery-watch-panel" class="gallery-watch-panel" role="tabpanel" aria-labelledby="gallery-watch-tab" data-gallery-panel="watch">
        ${api.reminder(item,isFilm(item))}
        ${show?`<section class="gallery-season-list"><div class="gallery-episodes-heading"><h3>All Episodes</h3>${episodeTotal?`<span class="gallery-episodes-progress" role="img" aria-label="${watchedTotal} of ${episodeTotal} released episodes watched" style="--watched-progress:${Math.round(watchedTotal/episodeTotal*100)}%"></span>`:''}</div>${seasons.map(season=>seasonRow(item,season,releases,watched)).join('')||'<p class="gallery-empty">Episode list unavailable or not yet released. Refresh verified episode data to check again.</p><button type="button" class="btn btn-secondary" data-gallery-retry-episodes>Refresh episodes</button>'}</section>`:''}
        <div class="gallery-detail-copy" data-gallery-watch-summary>${show?(next?`<button type="button" class="btn btn-primary gallery-watch-next" data-gallery-watch-next>Watch next · S${next.season} E${next.episode}</button>`:seasons.length?'<p class="gallery-caught-up" role="status">All released episodes watched</p>':''):''}<strong>${esc(item.status||'Planned')}</strong><p>Watched to - ${esc(watchedTo)}</p><p>Watched on: ${esc(item.platform||'Not specified')}</p></div>
      </section>
      <section id="gallery-info-panel" class="gallery-info-panel hidden" role="tabpanel" aria-labelledby="gallery-info-tab" data-gallery-panel="details"><div data-gallery-details aria-live="polite">Loading details…</div></section>
      <div class="gallery-action-menu hidden" data-gallery-action-menu><button type="button" data-gallery-edit-menu>Edit show or film</button><button type="button" data-gallery-notes>Notes</button><button type="button" data-gallery-favourite>${item.favorite?'Remove favourite':'Add to favourites'}</button><button type="button" data-gallery-lists>Custom lists</button><button type="button" data-gallery-archive>${item.archived?'Unarchive':'Archive'}</button><button type="button" class="danger" data-gallery-delete>Delete show or film</button></div>
      </div>`;
    dialog.querySelector('[data-gallery-edit-menu]').onclick=()=>{dialog.close();api.edit(item.id);};
    const menu=dialog.querySelector('[data-gallery-action-menu]'),notes=dialog.querySelector('[data-gallery-notes-field]'),saveNotes=dialog.querySelector('[data-gallery-save-notes]');
    const editor=dialog.querySelector('[data-gallery-notes-editor]'),preview=dialog.querySelector('[data-gallery-notes-preview]'),notesStatus=dialog.querySelector('[data-gallery-notes-status]'),cancelNotes=dialog.querySelector('[data-gallery-cancel-notes]');
    const menuButton=dialog.querySelector('[data-gallery-menu]');
    menuButton.onclick=event=>{event.preventDefault();event.stopPropagation();menu.classList.toggle('hidden');menuButton.setAttribute('aria-expanded',String(!menu.classList.contains('hidden')));};
    dialog.querySelector('[data-gallery-notes]').onclick=()=>{
      menu.classList.add('hidden');menuButton.setAttribute('aria-expanded','false');
      notes.value=savedNotes;notesStatus.textContent='';preview.classList.add('hidden');editor.classList.remove('hidden');
      editor.scrollIntoView({block:'start'});notes.focus({preventScroll:true});
    };
    cancelNotes.onclick=()=>{notes.value=savedNotes;editor.classList.add('hidden');preview.classList.toggle('hidden',!savedNotes);refreshCurrent();dialog.querySelector('[data-gallery-menu]')?.focus({preventScroll:true});};
    saveNotes.onclick=async()=>{
      saveNotes.disabled=true;cancelNotes.disabled=true;saveNotes.textContent='Saving…';notesStatus.textContent='';
      try{
        const value=notes.value.trim();
        if(!await api.saveNotes?.(item.id,value))throw new Error('Save failed');
        savedNotes=value;dialog._savedNotes=value;preview.querySelector('p').textContent=value;preview.classList.toggle('hidden',!value);editor.classList.add('hidden');
        if(value)preview.scrollIntoView({block:'start'});menuButton.focus({preventScroll:true});
      }catch(_){notesStatus.textContent='Notes could not be saved. Your text is still here; please retry.';}
      finally{saveNotes.disabled=false;cancelNotes.disabled=false;saveNotes.textContent='Save notes';}
    };
    const tabs=[...dialog.querySelectorAll('[data-gallery-view]')];
    const selectView=(name,focus=false)=>{
      for(const tab of tabs){const selected=tab.dataset.galleryView===name;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;if(selected&&focus)tab.focus();}
      for(const panel of dialog.querySelectorAll('[data-gallery-panel]'))panel.classList.toggle('hidden',panel.dataset.galleryPanel!==name);
    };
    tabs.forEach((tab,index)=>{
      tab.onclick=()=>selectView(tab.dataset.galleryView);
      tab.onkeydown=event=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
        selectView(tabs[next].dataset.galleryView,true);
      };
    });
    dialog.querySelector('[data-gallery-delete]').onclick=async()=>{
      if(!confirm(`Delete ${item.title} from your library?`))return;
      const button=dialog.querySelector('[data-gallery-delete]');button.disabled=true;
      if(await api.remove?.(item.id))dialog.close();else{button.disabled=false;button.textContent='Delete failed — retry';}
    };
    const retryEpisodes=dialog.querySelector('[data-gallery-retry-episodes]');
    if(retryEpisodes)retryEpisodes.onclick=async()=>{
      retryEpisodes.disabled=true;retryEpisodes.textContent='Checking episode sources…';
      const updated=await Promise.resolve(api.refreshEpisodes?.(item,true)).catch(()=>false);
      if(!updated&&retryEpisodes.isConnected){retryEpisodes.disabled=false;retryEpisodes.textContent='Retry episode lookup';}
    };
    const watchNext=dialog.querySelector('[data-gallery-watch-next]');
    if(watchNext)watchNext.onclick=()=>{
      const current=api.items().find(row=>String(row.id)===String(item.id));if(!current)return;
      const candidate=api.next?.(current);if(!candidate){detail(current);return;}
      return changeProgress(current,watchNext,()=>api.toggleEpisode?.(current.id,candidate.season,candidate.episode));
    };
    dialog._populateSeason=node=>populateSeason(node,item,releases,watched);
    for(const node of dialog.querySelectorAll('.gallery-season')){
      node.addEventListener('toggle',()=>{if(node.open)dialog._populateSeason(node);});
      node.querySelector('summary').addEventListener('click',event=>{
        if(event.target.closest('button'))return;
        event.preventDefault();toggleSeasonDetails(node);
      });
    }
    dialog.onclick=event=>{
      const button=event.target.closest('[data-gallery-toggle-episode],[data-gallery-season]');if(!button)return;
      event.preventDefault();event.stopPropagation();
      if(button.disabled)return;
      if(button.hasAttribute('data-gallery-toggle-episode')){
        const [season,episode]=button.dataset.galleryToggleEpisode.split(':').map(Number);
        return changeProgress(item,button,()=>api.toggleEpisode?.(item.id,season,episode));
      }
      return changeProgress(item,button,()=>api.toggleSeason?.(item.id,Number(button.dataset.gallerySeason)));
    };
    for(const [selector,field,on,off] of [['[data-gallery-favourite]','favorite','Remove favourite','Add to favourites'],['[data-gallery-archive]','archived','Unarchive','Archive']]){
      const button=dialog.querySelector(selector);
      button.onclick=async()=>{const current=api.items().find(row=>String(row.id)===String(item.id));if(!current)return;button.disabled=true;const value=!current[field];try{if(await api.organise?.(item.id,{[field]:value}))button.textContent=value?on:off;}finally{button.disabled=false;}};
    }
    dialog.querySelector('[data-gallery-lists]').onclick=()=>api.lists?.(item.id);
    observe(dialog,[item]);if(!dialog.open)dialog.showModal();void loadTrackerArtwork(item);void loadTitleDetails(item);
    if(show)void api.refreshEpisodes?.(item);
  }
  function open(id,trigger=document.activeElement){
    const item=api?.items?.().find(row=>String(row.id)===String(id));
    if(!item)return false;
    window.WatchLogNavigation?.beforeTitle?.();returnFocus=trigger;detail(item);window.WatchLogNavigation?.titleOpened?.();return true;
  }
  function back(){
    if(dialog?.open){closeDetail();return true;}
    if(category){if(window.WatchLogNavigation?.back?.())return true;category='';api?.render?.();api?.navigate?.();return true;}
    return false;
  }
  function mount(element,rows,callbacks){
    host=element;api=callbacks;rows=api.includes?rows.filter(api.includes):rows;observer?.disconnect();host.classList.add('gallery-active');
    if(!host._galleryEvents){host._galleryEvents=true;host.addEventListener('click',event=>{
      const manage=event.target.closest('[data-gallery-manage]');
      if(manage){api.manage?.(JSON.parse(manage.dataset.galleryManageIds||'[]'),manage.dataset.galleryManage);return;}
      const cat=event.target.closest('[data-gallery-category]');if(cat){if(typeof saveNavigationPosition==='function')saveNavigationPosition();category=cat.dataset.galleryCategory;api.render();api.navigate?.();host.querySelector('.gallery-back')?.focus();return;}
      if(event.target.closest('[data-gallery-back]')){if(typeof saveNavigationPosition==='function')saveNavigationPosition();category='';api.render();api.navigate?.();host.querySelector('.gallery-category')?.focus();return;}
      const target=event.target.closest('[data-gallery-item]');if(target)open(target.dataset.galleryItem,target);
    });}
    let markup;
    if(!category){markup=`<div class="gallery-home">${[['Film','Movies','▤'],['Series','Series','▣']].map(([type,label,icon])=>{
      const items=rows.filter(item=>type==='Film'?isFilm(item):!isFilm(item));return `<button type="button" class="gallery-category" data-gallery-category="${type}"><span class="gallery-category-icon" aria-hidden="true">${icon}</span><span><strong>${label}</strong><small>${items.length} title${items.length===1?'':'s'}</small></span><span class="gallery-fan" aria-hidden="true">${items.slice(0,3).map(item=>art(item)).join('')}</span></button>`;
    }).join('')}</div><p class="gallery-caption">${rows.length} titles in this view</p>`;}
    else{const items=rows.filter(item=>category==='Film'?isFilm(item):!isFilm(item)),tracked=api.items().filter(item=>(category==='Film'?isFilm(item):!isFilm(item))&&(!api.includes||api.includes(item))),parts=sections(items,api.upcoming);
      const content=api.filter==='Watched'?releaseGroups(items).map(group=>section(group.year,group.rows)).join(''):section('Upcoming',parts.future,true)+section('Released',parts.released)+section('Date unknown',parts.remaining);
      markup=`<div class="gallery-nav"><button type="button" class="gallery-back" data-gallery-back aria-label="Back to Library">‹</button><h2>${category==='Film'?'Movies':'Series'}</h2><span class="gallery-heading-actions"><span class="gallery-count" data-gallery-total-count aria-label="${tracked.length} tracked ${category==='Film'?'films':'series'}">${tracked.length}</span>${manageButton(tracked,category==='Film'?'Movies':'Series')}</span></div>${content}${items.length?'':'<p class="gallery-empty">No titles match your search or filter.</p>'}`;}
    if(host._galleryMarkup!==markup){
      // Keep live collection/progress controls, listeners and disclosure state.
      if(api.features&&host.contains(api.features)){
        const progress=document.getElementById('continue-watching');
        if(progress&&host.contains(progress))api.features.append(progress);
        host.before(api.features);
      }
      host.innerHTML=markup;host._galleryMarkup=markup;
    }
    if(api.features){
      const heading=host.querySelector('.gallery-nav');
      if(heading&&api.features.previousElementSibling!==heading)heading.after(api.features);
      const progress=document.getElementById('continue-watching');
      if(heading&&progress){
        const anchor=host.querySelector('[data-gallery-section="Upcoming"]')||api.features;
        if(progress.previousElementSibling!==anchor)anchor.after(progress);
      }
    }
    observe(host,rows);
  }
  return {mount,open,sections,releaseGroups,back,refreshCurrent,getCategory:()=>category,setCategory:value=>{category=['Film','Series'].includes(value)?value:'';},hasCategory:()=>Boolean(category)};
})();
