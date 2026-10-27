/* Release schedules use UK availability and GMT on every device. */
function releaseViewingCountry(){return "GB";}
function regionalScheduleItem(item){
  return globalThis.WatchLogRegionalReleases?.resolve(item,{country:"GB",timeZone:"UTC"})||item;
}
function reminderViewingLocale(){return "en-GB";}

let regionalRefreshAt=0,regionalRefreshCountry='';
function refreshRegionalReleaseSources(){
  if(!currentUser||!navigator.onLine)return;
  const country=releaseViewingCountry(),now=Date.now(),signature=country+':'+mediaItems.map(item=>item.tvmazeShowId+':'+item.nextEpisodeDate).sort().join('|');
  if(signature===regionalRefreshCountry&&now-regionalRefreshAt<3600000)return;
  regionalRefreshCountry=signature;regionalRefreshAt=now;
  void WatchLogRegionalReleases.refresh(mediaItems,{country,timeZone:DEVICE_TIME_ZONE}).then(()=>{if(currentUser&&country===releaseViewingCountry())render();});
}
function regionalScheduleEvent(item,event){const resolved=WatchLogRegionalReleases.resolveEvent(item,event,{country:releaseViewingCountry()});return {...resolved,streamingUnconfirmed:resolved.streamingUnconfirmed===true||(!resolved.releaseSchedule&&!item.releaseSchedule)};}
