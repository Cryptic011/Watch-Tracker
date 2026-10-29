/* Release schedules use UK availability and GMT on every device. */
function releaseViewingCountry(){return "GB";}
function regionalScheduleItem(item){
  return globalThis.WatchLogRegionalReleases?.resolve(item,{country:"GB",timeZone:"UTC"})||item;
}
function reminderViewingLocale(){return "en-GB";}

let regionalRefreshAt=0,regionalRefreshCountry='',regionalRefreshController=null;
function refreshRegionalReleaseSources(){
  if(!currentUser||!navigator.onLine||document.visibilityState==='hidden'||currentTab!=='library'||!selectedScheduleView){pauseRegionalReleaseSources();return;}
  if(regionalRefreshController?.signal.aborted)regionalRefreshAt=0;
  const country=releaseViewingCountry(),now=Date.now(),signature=country+':'+mediaItems.map(item=>item.tvmazeShowId+':'+item.nextEpisodeDate).sort().join('|');
  if(signature===regionalRefreshCountry&&now-regionalRefreshAt<3600000)return;
  regionalRefreshCountry=signature;regionalRefreshAt=now;
  regionalRefreshController?.abort();
  const controller=new AbortController(),account=String(currentUser.id);regionalRefreshController=controller;
  void WatchLogRegionalReleases.refresh(mediaItems,{country,timeZone:DEVICE_TIME_ZONE,signal:controller.signal}).then(()=>{
    if(controller.signal.aborted){if(regionalRefreshController===controller)regionalRefreshAt=0;return;}
    if(String(currentUser?.id)===account&&document.visibilityState!=='hidden'&&currentTab==='library'&&selectedScheduleView&&country===releaseViewingCountry())render();
  }).finally(()=>{if(regionalRefreshController===controller)regionalRefreshController=null;});
}
function pauseRegionalReleaseSources(){regionalRefreshController?.abort();}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')pauseRegionalReleaseSources();});
window.addEventListener('pagehide',pauseRegionalReleaseSources);
function regionalScheduleEvent(item,event){const resolved=WatchLogRegionalReleases.resolveEvent(item,event,{country:releaseViewingCountry()});return {...resolved,streamingUnconfirmed:resolved.streamingUnconfirmed===true||(!resolved.releaseSchedule&&!item.releaseSchedule)};}

// A display-only projection. Keep provider timestamps intact in saved records.
const releaseClockItems=new WeakSet();
function releaseTimelineItem(original){
  if(!original||releaseClockItems.has(original))return original;
  const item=regionalScheduleItem(original);
  const rows=Array.isArray(item.scheduledEpisodeReleases)?item.scheduledEpisodeReleases:[];
  const event=(raw,kind,season,number)=>regionalScheduleEvent(item,{raw,kind,season,number}).raw;
  const episodeSeason=(raw,number)=>Number(rows.find(row=>String(row.raw||'')===String(raw||'')&&Number(row.number)===Number(number))?.season||item.airingSeason||item.curSeason||item.nextSeasonNum)||null;
  const result={...item,
    nextEpisodeDate:event(item.nextEpisodeDate,'episode',episodeSeason(item.nextEpisodeDate,item.nextEpisodeNum),item.nextEpisodeNum),
    latestEpisodeDate:event(item.latestEpisodeDate,'episode',episodeSeason(item.latestEpisodeDate,item.latestEpisodeNum),item.latestEpisodeNum),
    nextSeasonDate:event(item.nextSeasonDate,'season',item.nextSeasonNum,item.nextSeasonNum),
    seriesReleaseDate:event(item.seriesReleaseDate,'episode',1,1),
    scheduledEpisodeReleases:rows.map(row=>regionalScheduleEvent(item,{...row,kind:'episode'}))};
  releaseClockItems.add(result);
  return result;
}

function releaseAvailableEpisodeMap(item,map,now=Date.now()){
  const timeline=releaseTimelineItem(item),pending=new Set();
  for(const row of timeline.scheduledEpisodeReleases||[]){
    if(Date.parse(row.raw)>now)pending.add(Number(row.season)+':'+Number(row.number));
  }
  for(const prefix of ['latest','next']){
    if(Date.parse(timeline[prefix+'EpisodeDate'])>now){
      const number=Number(item[prefix+'EpisodeNum']);
      const row=(item.scheduledEpisodeReleases||[]).find(row=>Number(row.number)===number&&row.raw===item[prefix+'EpisodeDate']);
      pending.add(Number(row?.season||item.airingSeason||item.curSeason||item.nextSeasonNum)+':'+number);
    }
  }
  // Release corrections must never erase a person's existing watch history.
  const watched=(season,number)=>(Array.isArray(item.watchedEpisodes?.[season])?item.watchedEpisodes[season].includes(number):Boolean(item.watchedEpisodes?.[season]?.[number]))||
    (Number(item.curSeason)===season&&number<=Number(item.curEp))||
    (item.episodeHistory||[]).some(event=>event.kind==='mark'&&Number(event.season)===season&&Number(event.episode)===number);
  return Object.fromEntries(Object.entries(map).map(([season,numbers])=>[season,numbers.filter(number=>!pending.has(Number(season)+':'+number)||watched(Number(season),number))]).filter(([,numbers])=>numbers.length));
}
