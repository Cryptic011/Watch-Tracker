  function isEpisodeTrackable(item){return item?.type==="Series"||item?.type==="Anime";}
  function positiveEpisodeMap(value){
    const counts={};
    for(const [season,count] of Object.entries(value||{})){
      const s=Number(season),n=Math.max(0,Number(count||0));
      if(Number.isInteger(s)&&s>0&&Number.isFinite(n)&&n>0)counts[s]=Math.floor(n);
    }
    return counts;
  }
  function normalizeReleasedEpisodeMap(value){
    const result={};
    for(const [seasonValue,episodeValue] of Object.entries(value||{})){
      const season=Number(seasonValue),episodes=[...new Set((Array.isArray(episodeValue)?episodeValue:[]).map(Number).filter(episode=>Number.isInteger(episode)&&episode>0))].sort((a,b)=>a-b);
      if(Number.isInteger(season)&&season>0&&episodes.length)result[season]=episodes;
    }
    return result;
  }
  function releasedEpisodeMap(item){
    if(!isEpisodeTrackable(item))return{};
    const available=map=>typeof releaseAvailableEpisodeMap==='function'?releaseAvailableEpisodeMap(item,map):map;
    if(item?.episodeScheduleVerified===true&&Object.prototype.hasOwnProperty.call(item,"releasedEpisodes"))return available(normalizeReleasedEpisodeMap(item.releasedEpisodes));
    const verified=positiveEpisodeMap(item.airedEpisodeCounts);
    if(item?.episodeScheduleVerified===true||Object.keys(verified).length)return available(Object.fromEntries(Object.entries(verified).map(([season,count])=>[season,Array.from({length:count},(_,index)=>index+1)])));

    // Never treat announced/total episode counts as released episodes. For an
    // unverified schedule, expose only seasons/episodes supported by concrete
    // release evidence already stored on the title.
    const totals=positiveEpisodeMap(item.episodeCounts),counts={};
    const completed=Math.max(0,Number(item.verifiedCompletedSeasons||0));
    for(const [seasonValue,totalValue] of Object.entries(totals)){
      const season=Number(seasonValue);
      if(season<=completed)counts[season]=Number(totalValue);
    }

    const now=Date.now(),activeSeason=Number(item.airingSeason||item.curSeason||0);
    const latest=Number(item.latestEpisodeNum||0),latestTime=toMillis(item.latestEpisodeDate);
    const nextEpisode=Number(item.nextEpisodeNum||0),nextTime=toMillis(item.nextEpisodeDate);
    let activeReleased=0;
    if(activeSeason>0&&latest>0&&latestTime>0&&latestTime<=now)activeReleased=latest;
    if(activeSeason>0&&nextEpisode>1&&nextTime>now)activeReleased=Math.max(activeReleased,nextEpisode-1);
    if(activeSeason>0&&activeReleased>0)counts[activeSeason]=totals[activeSeason]?Math.min(Number(totals[activeSeason]),activeReleased):activeReleased;

    for(const season of Object.keys(counts))if(!Number.isFinite(counts[season])||counts[season]<=0)delete counts[season];
    return available(Object.fromEntries(Object.entries(counts).map(([season,count])=>[season,Array.from({length:count},(_,index)=>index+1)])));
  }
  function releasedEpisodeCounts(item){
    return Object.fromEntries(Object.entries(releasedEpisodeMap(item)).map(([season,episodes])=>[season,Math.max(0,...episodes)]));
  }
  function normalizeWatchedEpisodeMap(value,counts={}){
    const result={};
    for(const [seasonValue,episodeValue] of Object.entries(value||{})){
      const season=Number(seasonValue);if(!Number.isInteger(season)||season<=0)continue;
      const source=Array.isArray(episodeValue)?episodeValue:Object.entries(episodeValue||{}).filter(([,watched])=>Boolean(watched)).map(([episode])=>episode);
      const allowed=Array.isArray(counts[season])?new Set(counts[season].map(Number)):null,maximum=allowed?0:Math.max(0,Number(counts[season]||0));
      const episodes=[...new Set(source.map(Number).filter(episode=>Number.isInteger(episode)&&episode>0&&(allowed?allowed.has(episode):(maximum>0&&episode<=maximum))))].sort((a,b)=>a-b);
      if(episodes.length)result[season]=episodes;
    }
    return result;
  }
  function legacyWatchedEpisodeMap(item,counts=releasedEpisodeMap(item)){
    const result={},fully=Math.max(0,Number(item?.watchedSeasons||0)),current=Math.max(0,Number(item?.curSeason||0)),currentEpisode=Math.max(0,Number(item?.curEp||0));
    for(const [seasonValue,countValue] of Object.entries(counts)){
      const season=Number(seasonValue),available=Array.isArray(countValue)?countValue:Array.from({length:Math.max(0,Number(countValue||0))},(_,index)=>index+1);
      const episodes=season<=fully?available:season===current?available.filter(episode=>episode<=currentEpisode):[];
      if(episodes.length)result[season]=episodes;
    }
    for(const event of (Array.isArray(item?.episodeHistory)?item.episodeHistory:[])){
      const season=Number(event?.season),episode=Number(event?.episode),available=Array.isArray(counts[season])?counts[season]:[];
      if(!Number.isInteger(season)||season<=0||!Number.isInteger(episode)||episode<=0||!available.includes(episode))continue;
      const episodes=new Set(result[season]||[]);
      if(event.kind==="unmark")episodes.delete(episode);else episodes.add(episode);
      if(episodes.size)result[season]=[...episodes].sort((a,b)=>a-b);else delete result[season];
    }
    return normalizeWatchedEpisodeMap(result,counts);
  }
  function watchedEpisodeMap(item,counts=releasedEpisodeMap(item)){
    if(Object.prototype.hasOwnProperty.call(item||{},"watchedEpisodes"))return normalizeWatchedEpisodeMap(item.watchedEpisodes,counts);
    return legacyWatchedEpisodeMap(item,counts);
  }
  function highestWatchedEpisode(map){
    let highest=null;
    for(const [seasonValue,episodes] of Object.entries(map||{}))for(const episodeValue of episodes||[]){
      const season=Number(seasonValue),episode=Number(episodeValue);
      if(!highest||season>highest.season||(season===highest.season&&episode>highest.episode))highest={season,episode};
    }
    return highest;
  }
  function lastLoggedEpisode(item){
    if(isEpisodeTrackable(item)){
      const highest=highestWatchedEpisode(watchedEpisodeMap(item));
      if(highest)return{...highest,watchedAt:item?.lastEpisodeWatchedAt||""};
    }
    const history=Array.isArray(item?.episodeHistory)?item.episodeHistory:[],recent=[...history].reverse().find(event=>event?.kind!=="unmark");
    const season=Number(item?.lastWatchedSeason??recent?.season??0),episode=Number(item?.lastWatchedEpisode??recent?.episode??0);
    if(!Number.isInteger(season)||season<=0||!Number.isInteger(episode)||episode<=0)return null;
    return{season,episode,watchedAt:item?.lastEpisodeWatchedAt||recent?.watchedAt||""};
  }
  function fullyWatchedSeasonCount(item,map,counts){
    const totals=positiveEpisodeMap(item?.episodeCounts),completedLimit=Math.max(0,Number(item?.verifiedCompletedSeasons||0),Number(item?.watchedSeasons||0));let total=0;
    for(const season of Object.keys(counts).map(Number)){
      if(season>completedLimit)continue;
      const maximum=Math.max(0,Number(totals[season]||counts[season]||0)),watched=new Set(map[season]||[]);
      if(maximum>0&&Array.from({length:maximum},(_,index)=>index+1).every(episode=>watched.has(episode)))total++;
    }
    return total;
  }
  function applyEpisodeToggle(item,season,episode,markWatched,event,includeEarlier=true){
    const releases=releasedEpisodeMap(item),counts=releasedEpisodeCounts(item),map=watchedEpisodeMap(item,releases),episodes=new Set(map[season]||[]);
    if(!releases[season]?.includes(episode))return item;
    if(markWatched){for(const number of releases[season])if(number===episode||(includeEarlier&&number<episode))episodes.add(number);}else episodes.delete(episode);
    if(episodes.size)map[season]=[...episodes].sort((a,b)=>a-b);else delete map[season];
    const watchedEpisodes=normalizeWatchedEpisodeMap(map,releases),highest=highestWatchedEpisode(watchedEpisodes);
    let curSeason=Math.max(0,Number(item.curSeason||0)),curEp=Math.max(0,Number(item.curEp||0));
    const currentOrder=curSeason*10000+curEp,targetOrder=season*10000+episode;
    if(markWatched&&targetOrder>currentOrder){curSeason=season;curEp=episode;}
    else if(!markWatched&&targetOrder===currentOrder){curSeason=highest?.season||0;curEp=highest?.episode||0;}
    const status=markWatched&&(item.status==="Planned"||item.status==="Saved")?"Watching":(item.status||"Watching");
    const episodeHistory=[...(Array.isArray(item.episodeHistory)?item.episodeHistory:[]),event].slice(-500);
    const updated={
      ...item,status,curSeason:curSeason||null,curEp:curEp||null,watchedEpisodes,
      watchedSeasons:fullyWatchedSeasonCount(item,watchedEpisodes,counts),
      currentSeasonEpisodeCount:curSeason?Number(counts[curSeason]||0)||null:null,
      episodeHistory,lastEpisodeWatchedAt:highest?event.watchedAt:"",lastWatchedSeason:highest?.season||null,lastWatchedEpisode:highest?.episode||null,
      date:item.date||localISODate(),updatedAt:event.watchedAt
    };
    return updated;
  }
  function applySeasonToggle(item,season,markWatched,events){
    const releases=releasedEpisodeMap(item),available=releases[season]||[];
    if(!available.length||events.length!==available.length)return item;
    const watched=watchedEpisodeMap(item,releases);
    if(markWatched)watched[season]=[...available];else delete watched[season];
    const base={...item,watchedEpisodes:watched,episodeHistory:[...(Array.isArray(item.episodeHistory)?item.episodeHistory:[]),...events.slice(0,-1)].slice(-500)};
    if(!markWatched&&Number(item.curSeason)===season&&available.includes(Number(item.curEp))){
      const highest=highestWatchedEpisode(watched);
      base.curSeason=highest?.season||null;base.curEp=highest?.episode||null;
    }
    // Reuse the same progress summary and persistence rules, once for the
    // entire season instead of rebuilding every episode map for every tick.
    return applyEpisodeToggle(base,season,available[available.length-1],markWatched,events[events.length-1],false);
  }
  async function toggleEpisodeWatched(id,season,episode,{offerUndo=true,restoreSeasonEpisodes=null}={}){
    const key=String(id);if(episodeLogBusy.has(key))return;
    const index=mediaItems.findIndex(item=>String(item.id)===key),item=mediaItems[index];if(index<0||!item)return;
    const releases=releasedEpisodeMap(item),available=releases[season]||[];if(!available.includes(episode))return;
    const wasWatched=(watchedEpisodeMap(item,releases)[season]||[]).includes(episode),markWatched=!wasWatched,event={id:uuid(),kind:markWatched?"mark":"unmark",season,episode,watchedAt:nowISO()};
    const generation=persistenceGeneration;
    const original=item;episodeLogBusy.add(key);episodeLogFeedback={itemId:key,eventId:event.id,season,episode,label:`Saving S${season} E${episode}…`,saving:true};
    mediaItems[index]=Array.isArray(restoreSeasonEpisodes)?available.reduce((current,number)=>{
      const restoreWatched=restoreSeasonEpisodes.includes(number),isWatched=(watchedEpisodeMap(item,releases)[season]||[]).includes(number);
      return restoreWatched===isWatched?current:applyEpisodeToggle(current,season,number,restoreWatched,{...event,id:uuid(),episode:number,kind:restoreWatched?"mark":"unmark"},false);
    },item):applyEpisodeToggle(item,season,episode,markWatched,event);render();
    let saved=false;
    try{
      await persistLibrary(mediaItems,{background:true,precleaned:true});
      episodeLogFeedback={itemId:key,eventId:event.id,season,episode,label:markWatched?`✓ S${season} E${episode} marked watched`:`S${season} E${episode} unmarked`,saving:false};saved=true;
    }catch(error){
      console.error(error);const currentIndex=mediaItems.findIndex(row=>String(row.id)===key);if(currentIndex>=0)mediaItems[currentIndex]=original;
      episodeLogFeedback=null;alert("That episode could not be saved. Please try again.");
    }finally{
      episodeLogBusy.delete(key);render();
      if(saved&&offerUndo)showAppToast(markWatched?`S${season} E${episode} watched`:`S${season} E${episode} unwatched`,"success",6000,async()=>{
        if(generation!==persistenceGeneration)return;
        const current=mediaItems.find(row=>String(row.id)===key);
        const latest=current?.episodeHistory?.filter(row=>row.season===season).at(-1);
        if(!current||latest?.id!==event.id){showAppToast("This episode has changed since. Open it to update its progress.","warn");return;}
        if(await toggleEpisodeWatched(id,season,episode,{offerUndo:false,restoreSeasonEpisodes:watchedEpisodeMap(original,releases)[season]||[]}))showAppToast("Episode change undone.");
      });
      if(saved)setTimeout(()=>{if(episodeLogFeedback?.eventId===event.id){episodeLogFeedback=null;render();}},1500);
    }
    return saved;
  }
  async function toggleSeasonWatched(id,season){
    const key=String(id);if(episodeLogBusy.has(key))return;
    const index=mediaItems.findIndex(item=>String(item.id)===key),item=mediaItems[index];if(index<0||!item)return;
    const releases=releasedEpisodeMap(item),episodes=releases[season]||[];if(!episodes.length)return;
    const watched=watchedEpisodeMap(item,releases)[season]||[],markWatched=!episodes.every(episode=>watched.includes(episode));
    const original=item;episodeLogBusy.add(key);
    const events=episodes.map(episode=>({id:uuid(),kind:markWatched?"mark":"unmark",season,episode,watchedAt:nowISO()}));
    mediaItems[index]=applySeasonToggle(item,season,markWatched,events);render();
    try{await persistLibrary(mediaItems,{background:true,precleaned:true});}
    catch(error){console.error(error);const currentIndex=mediaItems.findIndex(row=>String(row.id)===key);if(currentIndex>=0)mediaItems[currentIndex]=original;alert("That season could not be saved. Please try again.");}
    finally{episodeLogBusy.delete(key);render();}
  }
  async function saveTitleNotes(id,notes){
    const index=mediaItems.findIndex(row=>String(row.id)===String(id));if(index<0)return false;
    const previous=mediaItems[index],updated={...previous,notes,updatedAt:nowISO()};
    mediaItems[index]=updated;
    try{await persistLibrary(mediaItems,{background:true,precleaned:true});render();return true;}
    catch(error){const currentIndex=mediaItems.findIndex(row=>String(row.id)===String(id));if(currentIndex>=0&&mediaItems[currentIndex]===updated)mediaItems[currentIndex]=previous;return false;}
  }
  function closeEpisodeTrackerSheet(){activeEpisodeTrackerId="";activeEpisodeTrackerSeason=0;episodeTrackerModal.classList.add("hidden");setTimeout(applyPendingAppUpdate,0);}
  function openEpisodeTracker(id){
    const item=mediaItems.find(row=>String(row.id)===String(id));if(!isEpisodeTrackable(item))return;
    const releases=releasedEpisodeMap(item),seasons=Object.keys(releases).map(Number).sort((a,b)=>a-b),current=Number(item.curSeason||0);
    activeEpisodeTrackerId=String(id);activeEpisodeTrackerSeason=seasons.includes(current)?current:(seasons[seasons.length-1]||0);episodeTrackerModal.classList.remove("hidden");updateEpisodeTracker();
    if(episodeMetadataNeedsRefresh(item)){
      episodeTrackerRelease.textContent=`${episodeTrackerRelease.textContent} · Checking for new episodes…`;
      void scheduleMetadataRefresh(item);
      updateEpisodeTracker();
    }
    setTimeout(()=>{(activeEpisodeTrackerSeason?episodeTrackerSeason:closeEpisodeTracker).focus();},0);
  }
  function episodeTrackerEmptyState(item){
    if(metadataRefreshInFlight.has(String(item.id)))return {summary:"Checking episode schedule…",message:"Loading episode details. Please wait."};
    if(item.episodeScheduleVerified===true){
      const previouslyAired=Object.keys(positiveEpisodeMap(item.airedEpisodeCounts)).length>0||Number(item.curSeason||0)>0||Number(item.curEp||0)>0;
      if(previouslyAired)return {summary:"Episode list needs refreshing",message:"Previously released episodes could not be verified. Refresh this series; saved watch progress is retained."};
      return {summary:"No released episodes yet",message:"No released episodes are available for this series yet."};
    }
    return {summary:"Episode schedule unavailable",message:"The episode schedule could not be verified. Open Edit show details to check the selected series and refresh its details."};
  }
  function updateEpisodeTracker(){
    if(!activeEpisodeTrackerId||episodeTrackerModal.classList.contains("hidden"))return;
    const item=mediaItems.find(row=>String(row.id)===String(activeEpisodeTrackerId));if(!item){closeEpisodeTrackerSheet();return;}
    const releases=releasedEpisodeMap(item),counts=releasedEpisodeCounts(item),releasedSeasons=Object.keys(releases).map(Number).sort((a,b)=>a-b),latestSeason=releasedSeasons[releasedSeasons.length-1]||0;
    const watchedMap=watchedEpisodeMap(item,releases),highest=highestWatchedEpisode(watchedMap),feedback=episodeLogFeedback?.itemId===String(item.id)?episodeLogFeedback:null;
    if(!releasedSeasons.includes(activeEpisodeTrackerSeason))activeEpisodeTrackerSeason=releasedSeasons.includes(Number(item.curSeason||0))?Number(item.curSeason):latestSeason;
    const emptySchedule=episodeTrackerEmptyState(item);
    episodeTrackerTitle.textContent=item.title||"Show";
    episodeTrackerProgress.textContent=highest?`S${highest.season} E${highest.episode}`:"Not started";
    episodeTrackerRelease.textContent=latestSeason?`Released through S${latestSeason} E${counts[latestSeason]}`:emptySchedule.summary;
    episodeTrackerSeason.innerHTML=releasedSeasons.length?releasedSeasons.map(season=>`<option value="${season}"${season===activeEpisodeTrackerSeason?" selected":""}>Season ${season}</option>`).join(""):'<option value="">No seasons</option>';
    episodeTrackerSeason.disabled=!releasedSeasons.length;
    const available=releases[activeEpisodeTrackerSeason]||[],watched=new Set(watchedMap[activeEpisodeTrackerSeason]||[]),busy=episodeLogBusy.has(String(item.id));
    episodeTrackerSeasonSummary.textContent=available.length?`${watched.size} of ${available.length} released watched`:"";
    const next=nextWatchEpisode(item),nextButton=document.getElementById("episode-watch-next");
    nextButton.hidden=!next;nextButton.disabled=busy;
    nextButton.textContent=next?`Watch next · S${next.season} E${next.episode}`:"All caught up";
    episodeTrackerGrid.innerHTML=available.length?available.map(episode=>{
      const isWatched=watched.has(episode),isSaving=busy&&feedback?.season===activeEpisodeTrackerSeason&&feedback?.episode===episode;
      return`<button class="episode-tick${isWatched?" watched":""}" type="button" data-season="${activeEpisodeTrackerSeason}" data-episode="${episode}" aria-pressed="${isWatched}" aria-label="Season ${activeEpisodeTrackerSeason} episode ${episode}, ${isWatched?"watched":"not watched"}"${busy?" disabled":""}><span>Episode ${episode}</span><span class="episode-state">${isSaving?"Saving…":isWatched?"✓ Watched":"Mark watched"}</span></button>`;
    }).join(""):`<div class="episode-tracker-grid-empty">${esc(emptySchedule.message)}</div>`;
    const watchedTotal=Object.values(watchedMap).reduce((total,episodes)=>total+episodes.length,0);
    episodeTrackerLast.classList.toggle("unmarked",!watchedTotal&&!feedback);
    episodeTrackerLast.textContent=feedback?.label||(watchedTotal?`✓ ${watchedTotal} episode${watchedTotal===1?"":"s"} marked watched`:"No episodes have been marked watched yet.");
  }
  document.getElementById("episode-watch-next").onclick=()=>{
    const item=mediaItems.find(row=>String(row.id)===activeEpisodeTrackerId),next=item&&nextWatchEpisode(item);
    if(next)void toggleEpisodeWatched(item.id,next.season,next.episode);
  };
  closeEpisodeTracker.onclick=closeEpisodeTrackerSheet;
  episodeTrackerModal.addEventListener("click",event=>{if(event.target===episodeTrackerModal)closeEpisodeTrackerSheet();});
  document.addEventListener("keydown",event=>{if(event.key==="Escape"&&!episodeTrackerModal.classList.contains("hidden"))closeEpisodeTrackerSheet();});
  episodeTrackerSeason.onchange=()=>{activeEpisodeTrackerSeason=Number(episodeTrackerSeason.value||0);updateEpisodeTracker();};
  episodeTrackerGrid.addEventListener("click",event=>{const button=event.target.closest("button[data-season][data-episode]");if(!button||!activeEpisodeTrackerId)return;toggleEpisodeWatched(activeEpisodeTrackerId,Number(button.dataset.season),Number(button.dataset.episode));});
  episodeTrackerEdit.onclick=()=>{const id=activeEpisodeTrackerId;closeEpisodeTrackerSheet();if(id)openEdit(id);};
  function recentAdditionTime(item){
    const time=Date.parse(item?.createdAt||'');
    return Number.isFinite(time)?time:0;
  }
  function sortMediaRows(rows){
    const list=[...rows],groups=new Map(),now=Date.now();
    if(typeof activeFilter!=='undefined'&&activeFilter==='Recent'){
      list.sort((a,b)=>recentAdditionTime(b)-recentAdditionTime(a)||titleCollator.compare(a.title||'',b.title||''));
      return{rows:list,groups};
    }
    // Keys live for this sort only: progress edits and release rollovers must
    // always be reflected on the next render, including in-place edits.
    const currentInfo=new Map(),releaseInfo=new Map();
    const currentSort=!["release","title","platform","watched","shows"].includes(activeSort);
    if(currentSort)for(const item of list)currentInfo.set(item,currentSortInfo(item,now));
    if(activeSort==="recent"||activeSort==="release")for(const item of list)releaseInfo.set(item,releaseSortInfo(item,now));
    if(activeSort==="current")list.sort((a,b)=>compareCurrentOrder(a,b,now,currentInfo));
    else if(activeSort==="recent")list.sort((a,b)=>compareRecentOrder(a,b,now,currentInfo,releaseInfo));
    else if(activeSort==="release")list.sort((a,b)=>compareReleaseRecency(a,b,now,releaseInfo));
    else if(activeSort==="title")list.sort((a,b)=>titleCollator.compare(a.title||"",b.title||""));
    else if(activeSort==="platform")list.sort((a,b)=>{
      const ap=String(a.platform||"").trim(),bp=String(b.platform||"").trim();
      if(!ap&&!bp)return titleCollator.compare(a.title||"",b.title||"");
      if(!ap)return 1;if(!bp)return-1;
      return titleCollator.compare(ap,bp)||titleCollator.compare(a.title||"",b.title||"");
    });
    else if(activeSort==="watched")list.sort((a,b)=>watchedSortTime(b)-watchedSortTime(a)||titleCollator.compare(a.title||"",b.title||""));
    else if(activeSort==="shows"){
      /* Calculate each family once. The old comparator recalculated the whole
         NCIS/FBI family scan for every comparison. */
      const context=createShowGroupContext(list);
      for(const item of list)groups.set(String(item.id),showGroupInfo(item,context));
      list.sort((a,b)=>{
        const ag=groups.get(String(a.id)),bg=groups.get(String(b.id));
        return titleCollator.compare(ag?.key||"",bg?.key||"")||titleCollator.compare(a.title||"",b.title||"");
      });
    }else list.sort((a,b)=>compareCurrentOrder(a,b,now,currentInfo));
    return{rows:list,groups};
  }
  function updateCounts(){
    let planned=0,watching=0,watched=0;
    for(const item of mediaItems){if(item.status==="Planned"||item.status==="Saved")planned++;else if(item.status==="Watching")watching++;else if(item.status==="Watched")watched++;}
    $("count-planned").textContent=planned;$("count-watching").textContent=watching;$("count-watched").textContent=watched;
  }
  function categoryControlsVisible(){return currentTab==="library"&&Boolean(typeof libraryOnlyPage!=="undefined"?libraryOnlyPage:window.WatchLogGallery?.hasCategory?.());}
  function updateFloatingAddVisibility(){
    renderLibraryMaintenance();
    if(currentTab!=="search"){
      if(currentTab==="library")document.querySelector(".top-nav h1").textContent=libraryOnlyPage?"Library":"Home";
      document.querySelector(".top-nav h1").classList.toggle("hidden",currentTab!=="library"||categoryControlsVisible());
      if(currentTab==='library')for(const selector of ['.top-nav .search-box','.stats-row'])document.querySelector(selector).classList.toggle('hidden',selector==='.stats-row'&&!libraryOnlyPage);
    }
    addBtn.classList.toggle("hidden",!(currentUser&&currentTab==="library"));
  }
  const ALLOWED_BOTTOM_TABS=new Set(["library","collection","search","settings"]);
  function enforceBottomNavigation(){
    document.querySelectorAll(".bottom-tabs .tab-btn").forEach(button=>{
      const tab=String(button.dataset.tab||"").toLowerCase();
      const label=String(button.textContent||"").trim().toLowerCase();
      if(!ALLOWED_BOTTOM_TABS.has(tab)||label==="history"||label==="watchlist")button.remove();
    });
  }
  enforceBottomNavigation();
  const bottomTabs=document.querySelector(".bottom-tabs"),tabIndicator=document.querySelector(".tab-indicator"),tabGlass=document.querySelector(".tab-glass");
  const navigationMotionPreference=window.matchMedia("(prefers-reduced-motion: reduce)");
  const nativeTabMotion=typeof tabIndicator.animate==="function";
  bottomTabs.classList.toggle("native-tab-motion",nativeTabMotion);
  let tabSlideAnimation=null;
  navigationMotionPreference.addEventListener("change",()=>{tabSlideAnimation?.cancel();});

  function updateTabSelection(tab,forceMotion=false){
    const index=Array.from(tabBtns).findIndex(button=>button.dataset.tab===tab);
    if(index<0)return false;
    const previous=Array.from(tabBtns).findIndex(button=>button.classList.contains("active"));
    // Capture the on-screen position before cancelling an interrupted slide.
    const moving=index!==previous||forceMotion;
    const from=moving&&nativeTabMotion?getComputedStyle(tabIndicator).transform:"";
    const destination=`translateX(${index*100}%)`;
    if(moving)tabSlideAnimation?.cancel();
    tabIndicator.style.transform=destination;
    tabBtns.forEach(button=>{
      const selected=button.dataset.tab===tab;
      button.classList.toggle("active",selected);
      if(selected)button.setAttribute("aria-current","page");else button.removeAttribute("aria-current");
    });
    if(moving){

      if(nativeTabMotion){
        tabSlideAnimation=tabIndicator.animate([
          {transform:from==="none"?"translateX(0)":from},
          {transform:destination}
        ],{duration:navigationMotionPreference.matches?160:650,easing:navigationMotionPreference.matches?"ease-out":"cubic-bezier(.32,0,.18,1)"});
      }

    }
    return true;
  }

  updateTabSelection("library");
  let navigationDrag=null,suppressNavigationClick=false,navigationClickTimer=0;
  bottomTabs.addEventListener("pointerdown",event=>{
    if(navigationDrag||!event.isPrimary||event.button!==0||!event.target.closest(".tab-btn"))return;
    const first=tabBtns[0].getBoundingClientRect();
    navigationDrag={id:event.pointerId,x:event.clientX,y:event.clientY,step:first.width,
      offset:tabIndicator.getBoundingClientRect().left-first.left,moved:false};
  });
  bottomTabs.addEventListener("pointermove",event=>{
    const drag=navigationDrag;if(!drag||drag.id!==event.pointerId)return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    if(!drag.moved){
      if(Math.abs(dy)>Math.abs(dx)&&Math.abs(dy)>8){navigationDrag=null;return;}
      if(Math.abs(dx)<6)return;
      drag.moved=true;tabSlideAnimation?.cancel();
      bottomTabs.classList.add("is-dragging");bottomTabs.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    drag.position=Math.max(0,Math.min((tabBtns.length-1)*drag.step,drag.offset+dx));
    tabIndicator.style.transform="translateX("+drag.position+"px)";
    const preview=Math.round(drag.position/drag.step);
    tabBtns.forEach((button,index)=>button.classList.toggle("drag-preview",index===preview));
  });
  function finishNavigationDrag(event,cancelled=false){
    const drag=navigationDrag;if(!drag||drag.id!==event.pointerId)return;
    navigationDrag=null;
    if(!drag.moved)return;
    suppressNavigationClick=true;clearTimeout(navigationClickTimer);
    navigationClickTimer=setTimeout(()=>{suppressNavigationClick=false;},250);
    bottomTabs.classList.remove("is-dragging");tabGlass.style.transform="";
    tabBtns.forEach(button=>button.classList.remove("drag-preview"));
    const index=Math.round((drag.position??drag.offset)/drag.step);
    const destination=cancelled?bottomTabs.dataset.activeTab:tabBtns[index].dataset.tab;
    updateTabSelection(destination,true);
    if(!cancelled)goToTabHome(destination);
    if(bottomTabs.hasPointerCapture(event.pointerId))bottomTabs.releasePointerCapture(event.pointerId);
  }
  bottomTabs.addEventListener("pointerup",event=>finishNavigationDrag(event));
  bottomTabs.addEventListener("pointercancel",event=>finishNavigationDrag(event,true));
  bottomTabs.addEventListener("lostpointercapture",event=>{
    // Touch starts with implicit capture on the button. Moving capture to the
    // bar releases that button first; its bubbling event is not a cancellation.
    if(event.target!==bottomTabs||bottomTabs.hasPointerCapture(event.pointerId))return;
    finishNavigationDrag(event,true);
  });
  bottomTabs.addEventListener("click",event=>{
    if(!suppressNavigationClick)return;
    suppressNavigationClick=false;event.preventDefault();event.stopImmediatePropagation();
  },true);

  let searchReturnTab="library";
  let primaryPageAnimation=null;
  function animatePrimaryPage(from,to){
    primaryPageAnimation?.cancel();primaryPageAnimation=null;
    if(from===to||!["library","settings"].includes(from)||!["library","settings"].includes(to))return;
    if(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)return;
    const page=to==="settings"?settingsView:libraryView;
    if(typeof page.animate!=="function")return;
    primaryPageAnimation=page.animate([
      {opacity:.45,transform:`translateX(${to==="settings"?14:-14}px)`},
      {opacity:1,transform:"translateX(0)"}
    ],{duration:260,easing:"cubic-bezier(.22,1,.36,1)"});
  }
  function switchTab(tab){
    if(!ALLOWED_BOTTOM_TABS.has(tab))tab="library";
    if(typeof saveNavigationPosition==="function")saveNavigationPosition();
    if(tab!=="search"){libraryOnlyPage=tab==="collection";if(libraryOnlyPage)tab="library";}
    document.body.classList.toggle("library-only-page",libraryOnlyPage);
    enforceBottomNavigation();
    const previousTab=currentTab;
    if(tab==="search"&&currentTab!=="search")searchReturnTab=libraryOnlyPage?"collection":currentTab;
    const primaryTab=tab==="search"?searchReturnTab:libraryOnlyPage?"collection":tab;
    currentTab=tab;updateTabSelection(primaryTab);
    document.querySelector(".bottom-tabs")?.setAttribute("data-active-tab",primaryTab);
    const search=tab==="search",settings=(search?searchReturnTab:tab)==="settings";
    libraryView.classList.toggle("hidden",settings);settingsView.classList.toggle("hidden",!settings);
    if(!search)dismissTitleSearchKeyboard();
    setTitleSearchSheetOpen(search);
    $("discovery-view").classList.toggle("hidden",!search);
    if(!search){
      document.querySelector(".top-nav .search-box").classList.toggle("hidden",settings);
      document.querySelector(".stats-row").classList.toggle("hidden",settings);
    }
    updateFloatingAddVisibility();
    animatePrimaryPage(previousTab,tab);
    if(search){activateTitleSearch();if(typeof recordAppNavigation==="function")recordAppNavigation();return;}
    pauseTitleSearch();
    if(settings){renderWatchStatistics();void refreshPrivateReminderHistory();}
    if(!settings){$("list-label").textContent=tab==="watchlist"?"Upcoming Premieres":tab==="history"?"Watch History":"Titles";render();}
    if(typeof recordAppNavigation==="function")recordAppNavigation();
  }
  enforceBottomNavigation();
  document.querySelectorAll(".bottom-tabs .tab-btn").forEach(b=>b.onclick=()=>{
    if(b.dataset.tab==='search'&&currentTab==='search'){discoveryInput.focus({preventScroll:true});return;}
    goToTabHome(b.dataset.tab);
  });
  pillBtns.forEach(b=>b.onclick=()=>{pillBtns.forEach(x=>x.classList.remove("active"));b.classList.add("active");if(typeof saveNavigationPosition==="function")saveNavigationPosition();activeFilter=b.dataset.filter;render();if(typeof recordAppNavigation==="function")recordAppNavigation();});
  sortMode.onchange=e=>{activeSort=e.target.value;safeWriteJSON(SORT_KEY,activeSort);render();if(typeof recordAppNavigation==="function")recordAppNavigation();};

  const mediaSearchTextCache=new WeakMap();
  let renderFrame=0;
  function mediaSearchInfo(item){
    let value=mediaSearchTextCache.get(item);
    if(value===undefined){const title=normalizeTitle(item?.title),platform=normalizeTitle(item?.platform),aliases=[item?.alternateTitles,item?.alternate_titles,item?.titleAliases,item?.otherTitles,item?.metadata?.alternateTitles,item?.aliases,item?.originalTitle,item?.original_title,item?.aka].flatMap(value=>Array.isArray(value)?value:[value]).filter(value=>typeof value==="string").map(normalizeTitle);value={title,platform,aliases,text:[title,platform,...aliases].join(" ").trim()};mediaSearchTextCache.set(item,value);}
    return value;
  }
  function librarySearchScore(item,query,queryTokens){
    if(!query)return 1;
    const {title,platform,aliases,text}=mediaSearchInfo(item);
    if(title===query)return 1200;
    if(title.startsWith(query))return 1000-Math.min(100,title.length-query.length);
    if(title.includes(query))return 820;
    if(queryTokens.length&&queryTokens.every(token=>title.includes(token)))return 700;
    if(aliases.some(alias=>alias===query))return 680;
    if(aliases.some(alias=>alias.startsWith(query)))return 640;
    if(aliases.some(alias=>alias.includes(query)))return 580;
    if(platform===query)return 620;
    if(platform.includes(query))return 520;
    if(queryTokens.length&&queryTokens.every(token=>text.includes(token)))return 440;
    const length=Math.max(title.length,query.length);
    if(query.length>=3&&Math.abs(title.length-query.length)<=Math.max(2,Math.floor(length*.25))){
      const similarity=1-levenshteinNormalized(title,query)/length;
      if(similarity>=.72)return 300+Math.round(similarity*100);
    }
    return 0;
  }
  function itemMatchesCurrentView(item,query,queryTokens,now,scoreById=null){
    if(!item?.title)return false;
    if(currentTab==="watchlist"){
      if(upcomingSortInfo(item,now).rank===0)return false;
    }else if(currentTab==="history"&&item.status!=="Watched")return false;
    if(categoryControlsVisible()&&!["All","Recent"].includes(activeFilter)&&!(activeFilter==="Planned"&&(item.status==="Planned"||item.status==="Saved"))&&item.status!==activeFilter)return false;
    const score=librarySearchScore(item,query,queryTokens);
    if(scoreById)scoreById.set(String(item.id),score);
    return score>0;
  }
  function currentVisibleMediaRows(){
    const query=normalizeTitle(searchQuery),queryTokens=query.split(" ").filter(Boolean),now=Date.now(),rows=[],scoreById=new Map();
    renderedLibrarySearch=query;
    for(const item of mediaItems)if(itemMatchesCurrentView(item,query,queryTokens,now,scoreById))rows.push(item);
    const result=sortMediaRows(rows);
    if(query&&(typeof activeFilter==='undefined'||activeFilter!=='Recent'))result.rows.sort((a,b)=>(scoreById.get(String(b.id))||0)-(scoreById.get(String(a.id))||0));
    return result;
  }
  function reminderMarkup(item,isFilm){
    const upcoming=upcomingSortInfo(item);
    if(upcoming.rank===0)return"";
    const text=upcoming.rank===2?(upcoming.dateOnly?formatLocalWeekdayDate(new Date(upcoming.time)):formatLocalDateTime(new Date(upcoming.time))):"Date TBA";
    if(isFilm&&upcoming.kind==="film")return`<div class="reminder"><span>🎬 Film Release</span><small>${esc(text)}</small></div>`;
    if(upcoming.kind==="episode"){
      const season=upcoming.season||item.nextSeasonNum||item.airingSeason||item.curSeason||"",label=`${season?`S${season} `:""}E${upcoming.number||"Next"}`;
      return`<div class="reminder"><span>📺 ${esc(label)} Next Episode</span><small>${esc(text)}</small></div>`;
    }
    if(upcoming.kind==="season")return`<div class="reminder"><span>🔔 Season ${esc(upcoming.number||"Next")} Premiere</span><small>${esc(text)}</small></div>`;
    return"";
  }
  function titleCardMarkup(item){
    const isFilm=item.type==="Film",trackable=isEpisodeTrackable(item),id=esc(item.id),title=esc(item.title);
    const icon=isFilm?`<svg viewBox="0 0 24 24"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg>`:`<svg viewBox="0 0 24 24"><path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L23 5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z"/></svg>`;
    const release=isFilm&&item.filmReleaseDate?`${new Date(/^\d{4}-\d{2}-\d{2}$/.test(item.filmReleaseDate)?`${item.filmReleaseDate}T12:00:00Z`:item.filmReleaseDate).getTime()>Date.now()?"Releases":"Released"} ${(/^\d{4}-\d{2}-\d{2}$/.test(item.filmReleaseDate)?formatLocalDate(item.filmReleaseDate):formatLocalDateTime(item.filmReleaseDate))}`:"";
    const progress=!isFilm&&Number(item.curSeason)===0?"Not started":(!isFilm&&item.curSeason?`S${item.curSeason}${item.curEp!==null&&item.curEp!==undefined&&item.curEp!==""?` E${item.curEp}`:""}`:"");
    const known=!isFilm?knownSeasonTotal(item):0,summary=!isFilm?`${item.watchedSeasons??0} of ${known} seasons fully watched`:"",season=isFilm?release:[progress,summary].filter(Boolean).join(" • ");
    const pct=isFilm?100:Math.min(100,Math.max(0,(Number(item.watchedSeasons||0)/known)*100));
    const status=item.status==="Saved"?"Planned":(item.status||"Planned"),last=trackable?lastLoggedEpisode(item):null;
    const tracking=trackable?`<div class="show-track-status${last?" marked":""}">${last?`✓ S${last.season} E${last.episode} watched · Track episodes`:"Track episodes"}</div>`:"";
    const edit=trackable?`<button type="button" class="show-edit-button" data-edit-item="${id}" title="Edit ${title}" aria-label="Edit ${title}">✎</button>`:"";
    return`<div class="title-item" data-item-id="${id}" role="button" tabindex="0" aria-label="${trackable?`Track episodes for ${title}`:`Edit ${title}`}"><div class="item-row"><div class="item-icon">${icon}</div><div class="item-main"><span class="item-name">${title}</span><div class="item-sub"><span class="item-kind">${esc(item.type||"Series")}</span>${season?`<span class="item-progress-copy">${esc(season)}</span>`:""}</div><div class="platform"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg><span>${esc(item.platform||item.type||"")}</span></div>${!isFilm?`<div class="progress"><div style="width:${pct}%"></div></div>`:""}${tracking}</div><div class="item-right"><div class="badge ${esc(status.toLowerCase())}">${esc(status)}</div><span class="item-date">${esc(formatLocalDate(item.date))}</span>${edit}</div><span class="chevron">›</span></div>${reminderMarkup(item,isFilm)}</div>`;
  }
  function render(){
    if(renderFrame){cancelAnimationFrame(renderFrame);renderFrame=0;}
    if(typeof refreshTitleSearchBadges==="function")refreshTitleSearchBadges();
    $("list-toolbar").classList.toggle("hidden",!currentUser||!categoryControlsVisible());
    if(typeof sortMode!=="undefined")sortMode.disabled=typeof libraryOnlyPage!=="undefined"&&libraryOnlyPage&&activeFilter==="Recent";
    updateCounts();updateFloatingAddVisibility();renderDashboard();
    if(!currentUser){window.WatchLogGallery?.clearArtwork?.();const features=$("library-features"),progress=$("continue-watching");if(features&&progress&&mediaList.contains(progress))features.append(progress);if(mediaList.contains(features))mediaList.before(features);mediaList.replaceChildren();mediaList._galleryMarkup=null;emptyState.classList.add("hidden");return;}
    if(currentTab!=="library"){updateEpisodeTracker();return;}
    const {rows,groups}=libraryOnlyPage?currentVisibleMediaRows():{rows:[],groups:new Map()};
    mediaList.classList.toggle("hidden",!libraryOnlyPage);
    emptyState.classList.toggle("hidden",!libraryOnlyPage||rows.length>0);
    if(currentTab==="library"&&window.WatchLogGallery){
      emptyState.classList.add("hidden");
      $("list-label").textContent="Library";
      window.WatchLogGallery.mount(mediaList,rows,{plainLibrary:libraryOnlyPage,dashboardOnly:!libraryOnlyPage,features:$("library-features"),filter:activeFilter,includes:typeof libraryScopeIncludes==="function"?libraryScopeIncludes:null,organise:typeof saveTitleOrganisation==="function"?saveTitleOrganisation:null,lists:typeof openTitleLists==="function"?openTitleLists:null,navigate:typeof recordAppNavigation==="function"?recordAppNavigation:null,manage:openBulkManage,upcoming:upcomingSortInfo,next:nextWatchEpisode,last:item=>isEpisodeTrackable(item)?lastLoggedEpisode(item):null,released:item=>releasedEpisodeMap(item),watched:item=>watchedEpisodeMap(item),toggleEpisode:toggleEpisodeWatched,toggleSeason:toggleSeasonWatched,refreshEpisodes:(item,force=false)=>{
        if(!currentUser||!navigator.onLine||!isEpisodeTrackable(item)||(!force&&!episodeMetadataNeedsRefresh(item)))return Promise.resolve(false);
        return scheduleMetadataRefresh(item).then(updated=>{if(updated){render();window.WatchLogGallery?.refreshCurrent?.();}return updated;});
      },trackerArtwork:fetchOfficialTrackerArtwork,saveNotes:saveTitleNotes,titleDetails:fetchOfficialTitleDetails,sourceLinks:titleDetailsSourceLinks,remove:async(id)=>{const i=mediaItems.findIndex(row=>String(row.id)===String(id));if(i<0)return false;const old=mediaItems[i];confirmedLibraryDeletes.add(String(id));mediaItems.splice(i,1);try{await persistLibrary(mediaItems,{background:true,precleaned:true});render();return true;}catch(error){mediaItems.splice(i,0,old);return false;}},date:formatLocalDate,dateTime:formatLocalDateTime,reminder:reminderMarkup,edit:openEdit,track:openEpisodeTracker,render,back:()=>{if(currentTab!=="library")switchTab("library");},artwork:async item=>(await pinApi("catalog_search",{query:item.imdbId||item.title,country:"gb"})).results,items:()=>mediaItems});
      if(homeSchedulesVisible())for(const root of document.querySelectorAll('#library-dashboard,#recurring-weekly-dashboard'))window.WatchLogGallery.observeScheduleArtwork?.(root,mediaItems);
      updateEpisodeTracker();return;
    }
    mediaList.classList.remove("gallery-active");
    const groupCounts=new Map();
    if(activeSort==="shows")for(const group of groups.values())groupCounts.set(group.key,(groupCounts.get(group.key)||0)+1);
    let html="",lastGroup="";
    for(const item of rows){
      if(activeSort==="shows"){
        const group=groups.get(String(item.id));
        if(group&&group.key!==lastGroup&&groupCounts.get(group.key)>1)html+=`<div class="show-group-heading">${esc(group.label)}</div>`;
        lastGroup=group?.key||"";
      }
      html+=titleCardMarkup(item);
    }
    mediaList.innerHTML=html;mediaList._galleryMarkup=null;updateEpisodeTracker();
  }
  const bulkDialog=document.createElement("dialog");bulkDialog.className="changelog-dialog bulk-dialog";bulkDialog.setAttribute("aria-labelledby","bulk-manage-title");bulkDialog.innerHTML='<header class="changelog-heading"><h2 id="bulk-manage-title">Manage titles</h2><button class="close-btn" type="button" aria-label="Close bulk actions">×</button></header><p>Select one or more titles. Existing watch progress is retained unless you mark a show watched.</p><div id="bulk-title-options" class="bulk-title-options"></div><div class="notification-actions"><button type="button" data-bulk-action="watched" class="btn btn-secondary">Mark watched</button><button type="button" data-bulk-action="planned" class="btn btn-secondary">Plan</button><button type="button" data-bulk-action="hide" class="btn btn-secondary">Hide from Weekly Releases</button><button type="button" data-bulk-action="include" class="btn btn-secondary">Re-enable Weekly Releases</button><button type="button" data-bulk-action="remove" class="btn btn-danger">Remove selected</button></div>';
  document.body.appendChild(bulkDialog);
  const bulkOptions=bulkDialog.querySelector("#bulk-title-options"),bulkStatus=document.createElement("p");
  bulkStatus.id="bulk-manage-status";bulkStatus.setAttribute("role","status");bulkStatus.setAttribute("aria-live","polite");bulkOptions.after(bulkStatus);
  function openBulkManage(ids,label="Library"){
    const scope=new Set(ids.map(String)),rows=mediaItems.filter(item=>scope.has(String(item.id)));
    if(!rows.length)return;
    bulkDialog.querySelector("#bulk-manage-title").textContent=`Manage ${label.toLowerCase()} titles`;
    bulkOptions.innerHTML=rows.map(item=>`<label><input type="checkbox" value="${esc(item.id)}"><span>${esc(item.title)}</span></label>`).join("");
    bulkStatus.textContent="";bulkDialog.showModal();
  }
  bulkDialog.querySelector(".close-btn").addEventListener("click",()=>bulkDialog.close());
  bulkDialog.addEventListener("click",async event=>{
    const action=event.target.closest("[data-bulk-action]")?.dataset.bulkAction;if(!action)return;
    const ids=[...bulkOptions.querySelectorAll("input:checked")].map(input=>input.value);if(!ids.length){document.getElementById("bulk-manage-status").textContent="Select at least one title.";return;}
    if(action==="remove"&&!confirm(`Remove ${ids.length} selected title(s)? This cannot be undone.`))return;
    const selected=new Set(ids),updatedAt=nowISO();
    if(action==="remove"){for(const id of ids)confirmedLibraryDeletes.add(id);mediaItems=mediaItems.filter(item=>!selected.has(String(item.id)));}
    else for(const item of mediaItems){if(!selected.has(String(item.id)))continue;item.updatedAt=updatedAt;if(action==="planned")item.status="Planned";if(action==="hide")item.hideFromWeeklyReleases=true;if(action==="include")item.hideFromWeeklyReleases=false;if(action==="watched"){item.status="Watched";if(isEpisodeTrackable(item)){const released=releasedEpisodeMap(item);item.watchedEpisodes=Object.fromEntries(Object.entries(released).map(([season,episodes])=>[season,[...episodes]]));const latest=Object.entries(item.watchedEpisodes).flatMap(([season,episodes])=>episodes.map(episode=>[Number(season),Number(episode)])).sort((a,b)=>b[0]-a[0]||b[1]-a[1])[0];item.curSeason=latest?.[0]||null;item.curEp=latest?.[1]||null;item.lastWatchedSeason=item.curSeason;item.lastWatchedEpisode=item.curEp;item.watchedSeasons=Object.keys(released).length;item.updatedAt=nowISO();}}}
    const buttons=[...bulkDialog.querySelectorAll('[data-bulk-action]')];buttons.forEach(button=>button.disabled=true);
    render();bulkStatus.textContent='Saving changes…';
    try{await persistLibrary(mediaItems,{background:true,precleaned:true});bulkDialog.close();showAppToast(`Updated ${ids.length} title(s) on this device. Cloud sync will complete automatically.`,"success");}
    catch(error){bulkStatus.textContent='Saving needs attention. Your changes remain open and will retry automatically.';}
    finally{buttons.forEach(button=>button.disabled=false);}
  });
  function scheduleRender(){if(renderFrame)return;renderFrame=requestAnimationFrame(()=>{renderFrame=0;render();});}
  searchInput.addEventListener('focus',()=>openTitleSearch(searchInput.value.trim()));
  searchInput.oninput=e=>openTitleSearch(e.target.value.trim());
  function openMediaRow(id,trigger=document.activeElement){
    const item=mediaItems.find(row=>String(row.id)===String(id));if(!item)return;
    const previous=typeof beginTitleNavigation==="function"?beginTitleNavigation():false;
    try{if(currentTab!=="library")switchTab("library");if(!window.WatchLogGallery?.open?.(item.id,trigger))void openEdit(item.id);}
    finally{if(typeof endTitleNavigation==="function")endTitleNavigation(previous);}
  }
  mediaList.addEventListener("click",event=>{
    const edit=event.target.closest("[data-edit-item]");if(edit){event.stopPropagation();openEdit(edit.dataset.editItem);return;}
    const row=event.target.closest(".title-item[data-item-id]");if(row)openMediaRow(row.dataset.itemId,row);
  });
  mediaList.addEventListener("keydown",event=>{
    if(event.target.closest("[data-edit-item]"))return;
    const row=event.target.closest(".title-item[data-item-id]");
    if(row&&(event.key==="Enter"||event.key===" ")){event.preventDefault();openMediaRow(row.dataset.itemId,row);}
  });
