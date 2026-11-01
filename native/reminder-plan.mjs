// Local iOS reminders use confirmed times only, matching the web reminder rules.
export function reminderEvents(item){
  // Archive controls library visibility; the explicit reminder opt-out wins.
  if(item.hideFromWeeklyReleases===true)return [];
  if(item.type==='Film')return item.filmReleaseDate?[{kind:'film',raw:item.filmReleaseDate}]:[];
  if(!['Series','Anime'].includes(String(item.type)))return [];
  const active=Number(item.airingSeason||item.curSeason||0);
  const scheduled=Array.isArray(item.scheduledEpisodeReleases)?item.scheduledEpisodeReleases:[];
  const cached=Array.isArray(item.recurringWeeklySchedule?.episodes)?item.recurringWeeklySchedule.episodes:[];
  const match=[...scheduled,...cached].find(ep=>Number(ep?.number)===Number(item.nextEpisodeNum)&&ep?.raw===item.nextEpisodeDate);
  const nextSeason=Number(match?.season||(Number(item.nextEpisodeNum)===1?item.nextSeasonNum||active:active));
  const byEpisode=new Map();
  for(const ep of [...cached,{season:active,number:item.latestEpisodeNum,raw:item.latestEpisodeDate},{season:nextSeason,number:item.nextEpisodeNum,raw:item.nextEpisodeDate},...scheduled]){
    const number=Number(ep?.number),season=Number(ep?.season||0),raw=String(ep?.raw||'').trim();
    if(raw&&Number.isInteger(number)&&number>0&&Number.isInteger(season)&&season>=0)byEpisode.set(`${season}:${number}`,{kind:'episode',number,season,raw});
  }
  const events=[...byEpisode.values()];
  if(item.nextSeasonDate&&!events.some(ep=>ep.season===Number(item.nextSeasonNum)&&ep.number===1))events.push({kind:'season',raw:item.nextSeasonDate,number:item.nextSeasonNum});
  return events;
}

export function reminderPlan(items,accountId,{now=Date.now(),resolveItem=item=>item,resolveEvent=(_item,event)=>event,limit=60}={}){
  const requests=[],seen=new Set();
  for(const original of items){
    const item=resolveItem(original);
    for(const source of reminderEvents(item)){
      const event=resolveEvent(item,source);
      if(!event||event.streamingUnconfirmed||!item.releaseSchedule&&!event.releaseSchedule)continue;
      const raw=String(event.raw||'');
      // Date-only listings and local times without an offset aren't confirmed instants.
      if(!/T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw))continue;
      const time=Date.parse(raw);if(!Number.isFinite(time)||time<=now)continue;
      if(!['Planned','Saved'].includes(item.status)&&event.kind!=='episode')continue;
      const label=event.kind==='episode'?`${item.title} · S${event.season||item.curSeason||1} E${event.number}`:event.kind==='season'?`${item.title} · Season ${event.number||'next'}`:String(item.title);
      for(const lead of [24,6,0]){
        const at=time-lead*3600000;if(at<=now+1000)continue;
        const key=JSON.stringify([String(item.id),event.kind,event.season||0,event.number||0,raw,lead]);
        if(seen.has(key))continue;seen.add(key);
        requests.push({id:key,itemId:String(item.id),accountId:String(accountId),at,title:'Watch Logger Reminder',body:lead===0?`${label} out now`:`${label} out in ${lead===24?'1 day':`${lead} hours`}`});
      }
    }
  }
  return requests.sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id)).slice(0,Math.max(0,Math.min(60,limit)));
}
