/* Library presentation only. All progress, edits and reminders use the existing app. */
window.WatchLogGallery=(()=>{
  let category='',api=null,host=null,observer=null,dialog=null,active=0;
  const cache=new Map(),pending=new Set(),queue=[];
  const ARTWORK_CACHE_MS=6*60*60*1000;
  const freshArt=id=>{const entry=cache.get(id);return entry&&Date.now()-entry.checkedAt<ARTWORK_CACHE_MS?entry.url:'';};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const isFilm=item=>item.type==='Film';
  const key=item=>`${item.type}:${item.imdbId||item.tvmazeShowId||item.id}`;
  const safeImage=value=>{try{const u=new URL(value);return u.protocol==='https:'&&(/(^|\.)media-amazon\.com$|(^|\.)tvmaze\.com$/.test(u.hostname))?u.href:'';}catch{return '';}};
  function applyImage(img,url){if(!url)return;img.onload=()=>{img.hidden=false;};img.onerror=()=>{img.hidden=true;};img.src=url;}
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
    if(url)cache.set(id,{url,checkedAt:Date.now()});if(cache.size>250)cache.delete(cache.keys().next().value);
    document.querySelectorAll('.gallery-art img').forEach(img=>{if(img.dataset.art===id)applyImage(img,url);});
  }).finally(()=>{active--;pending.delete(id);pump();});}}
  function observe(root,items){
    const byKey=new Map(items.map(item=>[key(item),item]));
    if(!observer&&typeof IntersectionObserver!=="undefined")observer=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;const box=entry.target;observer.unobserve(box);const img=box.querySelector("img[data-art]");if(!img)return;const item=img._galleryItem;if(!item)continue;const id=key(item),cached=freshArt(id);if(cached){applyImage(img,cached);continue;}if(!pending.has(id)){pending.add(id);queue.push(item);pump();}}},{rootMargin:'160px'});
    const images=[...root.querySelectorAll('[data-art]')];images.forEach(img=>{img._galleryItem=byKey.get(img.dataset.art);const cached=freshArt(img.dataset.art);if(cached)applyImage(img,cached);else if(observer)observer.observe(img.parentElement);else if(img._galleryItem&&!pending.has(img.dataset.art)){pending.add(img.dataset.art);queue.push(img._galleryItem);}});if(!observer)pump();
  }
  function art(item){
    const initials=String(item.title||'?').split(/\s+/).slice(0,2).map(s=>s[0]).join('');
    return `<div class="gallery-art"><span aria-hidden="true">${esc(initials)}</span><div class="gallery-art-title">${esc(item.title||'Untitled')}</div><div class="gallery-art-meta">${esc(isFilm(item)?'FILM':'SERIES')} · ${esc(item.releaseYear||'WATCHED LOGGER')}</div><img hidden alt="" data-art="${esc(key(item))}" decoding="async"></div>`;
  }
  function stateBadge(item){const last=api.last(item);return last?`<span class="gallery-tile-status done">✓ S${esc(last.season)} E${esc(last.episode)} watched</span>`:`<span class="gallery-tile-status">${esc(item.status==='Saved'?'Planned':item.status||'Planned')}</span>`;}
  function releaseTime(item){const value=isFilm(item)?item.filmReleaseDate:item.seriesReleaseDate;const time=Date.parse(value?`${String(value).slice(0,10)}T12:00:00`:'');return Number.isFinite(time)?time:0;}
  function releaseYear(item){const time=releaseTime(item);return time?String(new Date(time).getFullYear()):/^\d{4}$/.test(String(item.releaseYear||''))?String(item.releaseYear):'Date unknown';}
  function releaseGroups(items){
    const groups=new Map();
    for(const item of items){const year=releaseYear(item);if(!groups.has(year))groups.set(year,[]);groups.get(year).push(item);}
    return [...groups].sort(([a],[b])=>(Number(b)||0)-(Number(a)||0)).map(([year,rows])=>({year,rows:rows.slice().sort((a,b)=>releaseTime(b)-releaseTime(a)||String(a.title).localeCompare(String(b.title)))}));
  }
  function releasedByYear(item,now){return /^\d{4}$/.test(String(item.releaseYear||''))&&Number(item.releaseYear)<new Date(now).getFullYear();}
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
  function section(title,items,carousel=false){return items.length?`<section class="gallery-section"><h3>${esc(title)}<span class="gallery-count">${items.length}</span></h3><div class="${carousel?'gallery-carousel'+(category==='Film'?' gallery-film-carousel':''):'gallery-grid'}">${items.map(item=>tile(item,carousel)).join('')}</div></section>`:'';}
  function paintTrackerImage(container,url,label){
    const placeholder=`<span class="gallery-artwork-placeholder" aria-label="No artwork available">${esc(label)}</span>`;
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
    paintTrackerArtwork(section,{
      episodeImages:item.episodeImagesSource==='TVMaze'?item.episodeImages||{}:{},
      seasonImages:item.seasonImagesSource==='TVMaze'?item.seasonImages||{}:{}
    });
    if(!callbacks.trackerArtwork)return;
    try{
      const artwork=await callbacks.trackerArtwork(item);
      if(section===dialog.querySelector('.gallery-season-list')&&dialog.dataset.item===String(item.id))paintTrackerArtwork(section,artwork);
    }catch(_){}
  }
  function episodeRow(item,season,episode,watched){
    const complete=watched.has(episode),title=item.episodeTitles?.[season]?.[episode]||'Episode '+episode;
    const date=item.episodeReleaseDates?.[season]?.[episode]||'',dateText=date?api.date(new Date(/^\d{4}-\d{2}-\d{2}$/.test(date)?date+'T12:00:00':date)):'';
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
      </summary><div class="gallery-season-episodes">${episodes.map(episode=>episodeRow(item,season,episode,done)).join('')}</div>
    </details>`;
  }
  async function changeProgress(item,button,save){
    const section=dialog.querySelector('.gallery-season-list'),expanded=[...dialog.querySelectorAll('.gallery-season[open]')].map(node=>node.dataset.season),scrollTop=dialog.scrollTop;
    const selector=button.hasAttribute('data-gallery-season')?`[data-gallery-season="${button.dataset.gallerySeason}"]`:`[data-gallery-toggle-episode="${button.dataset.galleryToggleEpisode}"]`;
    dialog.querySelectorAll('[data-gallery-season],[data-gallery-toggle-episode]').forEach(control=>{control.disabled=true;});
    try{await save();}
    finally{
      const fresh=api.items().find(row=>String(row.id)===String(item.id));
      if(fresh&&dialog.open&&section===dialog.querySelector('.gallery-season-list')&&dialog.dataset.item===String(item.id)){
        detail(fresh);
        for(const node of dialog.querySelectorAll('.gallery-season'))node.open=expanded.includes(node.dataset.season);
        dialog.scrollTop=scrollTop;
        dialog.querySelector(selector)?.focus({preventScroll:true});
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
      const description=decoder.value.replace(/\s+/g,' ').trim();
      const facts=[
        ['Release date',details.premiered?api.date(new Date(details.premiered+'T12:00:00')):details.year||''],
        ['Genres',Array.isArray(details.genres)?details.genres.join(' · '):''],
        ['Seasons',details.seasons||''],['Status',details.status||''],
        ['Rating',Number.isFinite(details.rating)?details.rating+'/10':''],
        ['Runtime',details.runtime?details.runtime+' min':''],['Language',details.language||'']
      ].filter(([,value])=>value!=='');
      target.innerHTML=`<h3>About ${esc(item.title)}</h3><p>${esc(description||'A description isn’t available for this title yet.')}</p>${facts.length?`<dl>${facts.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`:''}${details.source?`<small>Source: ${esc(details.source)}</small>`:''}`;
    }catch(_){
      if(target!==dialog.querySelector('[data-gallery-details]'))return;
      target.innerHTML='<p>Details are temporarily unavailable.</p><button type="button" class="btn btn-secondary" data-gallery-retry-details>Retry</button>';
      target.querySelector('button').onclick=()=>loadTitleDetails(item);
    }
  }
  function detail(item){
    if(!dialog){
      dialog=document.createElement('dialog');dialog.className='gallery-detail';dialog.setAttribute('aria-label','Title details');document.body.append(dialog);
      dialog.addEventListener('click',event=>{if(event.target===dialog||event.target.closest('[data-gallery-close]'))dialog.close();});
      dialog.addEventListener('close',()=>{host?.querySelector(`[data-gallery-item="${CSS.escape(dialog.dataset.item||'')}"]`)?.focus();});
    }
    dialog.dataset.item=String(item.id);
    const show=!isFilm(item),last=api.last(item);
    const watchedTo=show?(last?`S${last.season} E${last.episode}`:'Not started'):(item.status==='Watched'?'Complete':'Not started');
    let savedNotes=String(item.notes||'').trim();
    const releases=show?(api.released?.(item)||item.releasedEpisodes||{}):{},watched=show?(api.watched?.(item)||item.watchedEpisodes||{}):{};
    const seasons=Object.keys(releases).map(Number).filter(number=>Number.isInteger(number)&&number>0).sort((left,right)=>left-right);
    dialog.innerHTML=`<header class="gallery-detail-header"><h2>${esc(item.title)}</h2><div class="gallery-detail-header-actions">
      <button type="button" class="gallery-menu-button" data-gallery-menu aria-label="Title actions" aria-expanded="false">•••</button>
      <button type="button" class="gallery-back" data-gallery-close aria-label="Close details">×</button></div></header>
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
        ${show?`<section class="gallery-season-list"><h3>All Episodes</h3>${seasons.map(season=>seasonRow(item,season,releases,watched)).join('')||'<p class="gallery-empty">No verified released episodes available yet.</p>'}</section>`:''}
        <div class="gallery-detail-copy" data-gallery-watch-summary><strong>${esc(item.status||'Planned')}</strong><p>Watched to - ${esc(watchedTo)}</p><p>Watched on: ${esc(item.platform||'Not specified')}</p></div>
      </section>
      <section id="gallery-info-panel" class="gallery-info-panel hidden" role="tabpanel" aria-labelledby="gallery-info-tab" data-gallery-panel="details"><div data-gallery-details aria-live="polite">Loading details…</div></section>
      <div class="gallery-action-menu hidden" data-gallery-action-menu><button type="button" data-gallery-edit-menu>Edit show or film</button><button type="button" data-gallery-notes>Notes</button><button type="button" class="danger" data-gallery-delete>Delete show or film</button></div>
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
    cancelNotes.onclick=()=>{editor.classList.add('hidden');preview.classList.toggle('hidden',!savedNotes);menuButton.focus({preventScroll:true});};
    saveNotes.onclick=async()=>{
      saveNotes.disabled=true;cancelNotes.disabled=true;saveNotes.textContent='Saving…';notesStatus.textContent='';
      try{
        const value=notes.value.trim();
        if(!await api.saveNotes?.(item.id,value))throw new Error('Save failed');
        savedNotes=value;preview.querySelector('p').textContent=value;preview.classList.toggle('hidden',!value);editor.classList.add('hidden');
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
    dialog.querySelectorAll('[data-gallery-toggle-episode]').forEach(button=>{button.onclick=()=>{
      const [season,episode]=button.dataset.galleryToggleEpisode.split(':').map(Number);
      return changeProgress(item,button,()=>api.toggleEpisode?.(item.id,season,episode));
    };});
    dialog.querySelectorAll('[data-gallery-season]').forEach(button=>{button.onclick=event=>{
      event.preventDefault();event.stopPropagation();
      return changeProgress(item,button,()=>api.toggleSeason?.(item.id,Number(button.dataset.gallerySeason)));
    };});
    observe(dialog,[item]);if(!dialog.open)dialog.showModal();void loadTrackerArtwork(item);void loadTitleDetails(item);
  }
  function back(){
    if(dialog?.open){dialog.close();return true;}
    if(category){category='';api?.render?.();return true;}
    return false;
  }
  function mount(element,rows,callbacks){
    host=element;api=callbacks;observer?.disconnect();host.classList.add('gallery-active');
    if(!host._galleryEvents){host._galleryEvents=true;host.addEventListener('click',event=>{
      const manage=event.target.closest('[data-gallery-manage]');
      if(manage){api.manage?.(JSON.parse(manage.dataset.galleryManageIds||'[]'),manage.dataset.galleryManage);return;}
      const cat=event.target.closest('[data-gallery-category]');if(cat){category=cat.dataset.galleryCategory;api.render();host.querySelector('.gallery-back')?.focus();return;}
      if(event.target.closest('[data-gallery-back]')){category='';api.render();host.querySelector('.gallery-category')?.focus();return;}
      const target=event.target.closest('[data-gallery-item]');if(target){const item=api.items().find(row=>String(row.id)===target.dataset.galleryItem);if(item)detail(item);}
    });}
    if(!category){host.innerHTML=`<div class="gallery-home">${[['Film','Movies','▤'],['Series','Series','▣']].map(([type,label,icon])=>{
      const items=rows.filter(item=>type==='Film'?isFilm(item):!isFilm(item));return `<button type="button" class="gallery-category" data-gallery-category="${type}"><span class="gallery-category-icon" aria-hidden="true">${icon}</span><span><strong>${label}</strong><small>${items.length} title${items.length===1?'':'s'}</small></span><span class="gallery-fan" aria-hidden="true">${items.slice(0,3).map(item=>art(item)).join('')}</span></button>`;
    }).join('')}</div><p class="gallery-caption">${rows.length} titles in this view</p>`;}
    else{const items=rows.filter(item=>category==='Film'?isFilm(item):!isFilm(item)),tracked=api.items().filter(item=>category==='Film'?isFilm(item):!isFilm(item)),parts=sections(items,api.upcoming);
      const content=api.filter==='Watched'?releaseGroups(items).map(group=>section(group.year,group.rows)).join(''):section('Upcoming',parts.future,true)+section('Released',parts.released)+section('Date unknown',parts.remaining);
      host.innerHTML=`<div class="gallery-nav"><button type="button" class="gallery-back" data-gallery-back aria-label="Back to Library">‹</button><h2>${category==='Film'?'Movies':'Series'}</h2><span class="gallery-heading-actions"><span class="gallery-count" data-gallery-total-count aria-label="${tracked.length} tracked ${category==='Film'?'films':'series'}">${tracked.length}</span>${manageButton(tracked,category==='Film'?'Movies':'Series')}</span></div>${content}${items.length?'':'<p class="gallery-empty">No titles match your search or filter.</p>'}`;}
    observe(host,rows);
  }
  return {mount,sections,releaseGroups,back,hasCategory:()=>Boolean(category)};
})();
