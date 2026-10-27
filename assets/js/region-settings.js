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
