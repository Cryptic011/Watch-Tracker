/* Library dashboard. Uses the same released/watched episode rules as the tracker. */
function nextWatchEpisode(item){
  if(!isEpisodeTrackable(item))return null;
  const releases=releasedEpisodeMap(item),watched=watchedEpisodeMap(item,releases);
  for(const season of Object.keys(releases).map(Number).sort((a,b)=>a-b)){
    const seen=new Set(watched[season]||[]);
    for(const episode of releases[season]){
      if(!seen.has(episode))return{season,episode};
    }
  }
  return null;
}

function watchStatistics(items){
  const rows=Array.isArray(items)?items:[];
  let filmsWatched=0,episodesWatched=0,showsInProgress=0,showsCompleted=0;
  for(const item of rows){
    if(item?.type==='Film'){
      if(String(item.status||'').toLowerCase()==='watched')filmsWatched++;
      continue;
    }
    if(!isEpisodeTrackable(item))continue;
    const map=watchedEpisodeMap(item,releasedEpisodeMap(item));
    episodesWatched+=Object.values(map).reduce((sum,episodes)=>sum+(Array.isArray(episodes)?episodes.length:0),0);
    const next=nextWatchEpisode(item);
    if(next)showsInProgress++;
    else if(Object.values(map).some(episodes=>Array.isArray(episodes)&&episodes.length))showsCompleted++;
  }
  return{libraryCount:rows.length,filmsWatched,episodesWatched,showsInProgress,showsCompleted};
}

let selectedCalendarRange='week';
function calendarRange(range,now=new Date()){
  const today=new Date(now);today.setHours(0,0,0,0);
  const weekStart=new Date(today);weekStart.setDate(weekStart.getDate()-(weekStart.getDay()+6)%7);
  const priorDays=(today.getDay()+6)%7;
  const throughSunday=7-priorDays;
  if(range==='today')return{start:today,days:1,label:'Local calendar day',priorStart:weekStart,priorDays:0};
  if(range==='upcoming'){
    const end=new Date(today);end.setDate(end.getDate()+7);
    return{start:today,days:8,label:`${today.getDate()}–${end.getDate()} ${end.toLocaleDateString(undefined,{month:'short'})}`,priorStart:weekStart,priorDays:0};
  }
  return{start:today,days:throughSunday,label:`Today through Sunday`,priorStart:weekStart,priorDays};
}
function calendarEvents(items,now=new Date(),days=7){
  const start=new Date(now);start.setHours(0,0,0,0);
  const end=new Date(start);end.setDate(end.getDate()+days);
  const events=[],unknown=[],seen=new Set();
  for(const item of items){
    if(item.hideFromWeeklyReleases===true)continue;
    let candidates=[];
    if(item.type==='Film')candidates=[{raw:item.filmReleaseDate,label:'Film release'}];
    else if(isEpisodeTrackable(item)){
      candidates=(Array.isArray(item.scheduledEpisodeReleases)?item.scheduledEpisodeReleases:[]).map(ep=>({raw:ep.raw,label:`S${ep.season} E${ep.number}`,season:Number(ep.season),episode:Number(ep.number)}));
      if(item.nextEpisodeNum){
        const scheduled=(Array.isArray(item.scheduledEpisodeReleases)?item.scheduledEpisodeReleases:[]).find(ep=>Number(ep.number)===Number(item.nextEpisodeNum)&&String(ep.raw||"")===String(item.nextEpisodeDate||""));
        const activeSeason=Number(item.airingSeason||item.curSeason||0);
        const episodeSeason=Number(item.nextEpisodeNum)>1&&activeSeason?activeSeason:(item.nextSeasonNum||activeSeason||item.curSeason||0);
        const nextEpisodeSeason=Number(scheduled?.season||episodeSeason);
        candidates.push({raw:item.nextEpisodeDate,label:`S${nextEpisodeSeason||'?'} E${item.nextEpisodeNum}`,season:nextEpisodeSeason,episode:Number(item.nextEpisodeNum)});
      }
      const activeSeason=Number(item.airingSeason||item.curSeason||0);
      const activeSeasonContinues=activeSeason>0&&Number(item.nextSeasonNum)>activeSeason&&Number(item.nextEpisodeNum)>1&&(Boolean(item.nextEpisodeDate)||Boolean((releasedEpisodeMap(item)||{})[activeSeason]?.length));
      if(item.nextSeasonNum&&!activeSeasonContinues&&!candidates.some(e=>e.season===Number(item.nextSeasonNum)&&e.episode===1))candidates.push({raw:item.nextSeasonDate,label:`Season ${item.nextSeasonNum}`});
    }
    const undated=[];
    for(const candidate of candidates){
      if(!candidate.raw){undated.push(candidate);continue;}
      const dateOnly=/^\d{4}-\d{2}-\d{2}$/.test(candidate.raw);
      const date=new Date(dateOnly?`${candidate.raw}T12:00:00`:candidate.raw);
      if(!Number.isFinite(date.getTime()))continue;
      if(date<start||date>=end)continue;
      const key=`${item.id}:${candidate.label}:${localISODate(date)}`;
      if(seen.has(key))continue;seen.add(key);
      events.push({...candidate,item,date,dateOnly});
    }
    // Watch status describes the user's intent, never release availability.
    // Only an explicit unreleased episode/season or a future release year
    // supports an announcement. Missing metadata alone is not a TBA release.
    const releases=isEpisodeTrackable(item)?releasedEpisodeMap(item):{};
    const announcements=undated.filter(candidate=>{
      if(item.type==='Film')return false;
      if(candidate.episode)return !(releases[candidate.season]||[]).includes(candidate.episode);
      return !Object.keys(releases).some(season=>Number(season)>=Number(item.nextSeasonNum));
    }).map(candidate=>candidate.label);
    if(!announcements.length&&Number(item.releaseYear)>now.getFullYear()&&
      !Object.values(releases).some(episodes=>episodes.length)&&
      !(item.type==='Film'?item.filmReleaseDate:item.seriesReleaseDate)&&
      !candidates.some(candidate=>candidate.raw))announcements.push(item.type==='Film'?'Film release':'Series premiere');
    if(announcements.length)unknown.push({...item,announcement:[...new Set(announcements)].join(' / ')});
  }
  return{start,end,events:events.sort((a,b)=>a.date-b.date||a.item.title.localeCompare(b.item.title)),unknown};
}

function updateDashboardMarkup(root,markup){
  // Keep focus and expanded sections when a save/metadata refresh changes nothing.
  if(root._dashboardMarkup===markup)return;
  const expanded=new Set([...root.querySelectorAll('details[data-dashboard-section][open]')].map(node=>node.dataset.dashboardSection));
  root.innerHTML=markup;root._dashboardMarkup=markup;
  for(const node of root.querySelectorAll('details[data-dashboard-section]'))node.open=expanded.has(node.dataset.dashboardSection);
}

let recurringWeeklyTimer=null;
function recurringWeeklyShows(items,now=new Date()){
  const result=[];
  for(const item of Array.isArray(items)?items:[]){
    if(!isEpisodeTrackable(item)||item.hideFromWeeklyReleases===true)continue;
    const stored=item.recurringWeeklySchedule;
    const scheduled=Array.isArray(item.scheduledEpisodeReleases)?item.scheduledEpisodeReleases:[];
    const activeSeason=Number(item.airingSeason||item.curSeason||0);
    const nextMatch=scheduled.find(row=>Number(row.number)===Number(item.nextEpisodeNum)&&row.raw===item.nextEpisodeDate);
    const nextSeason=Number(nextMatch?.season||(Number(item.nextEpisodeNum)===1?item.nextSeasonNum:activeSeason)||activeSeason);
    const rows=[...(Array.isArray(stored?.episodes)?stored.episodes:[]),...scheduled,
      {season:activeSeason,number:item.latestEpisodeNum,raw:item.latestEpisodeDate},
      {season:nextSeason,number:item.nextEpisodeNum,raw:item.nextEpisodeDate}];
    const pattern=weeklyReleasePattern(rows);
    const days=[...new Set((Array.isArray(stored?.days)?stored.days:pattern?.days||[]).filter(day=>Number.isInteger(day)&&day>=0&&day<7))];
    const episodes=[...new Map((pattern?.episodes||rows).filter(row=>row&&Number.isInteger(Number(row.season))&&Number(row.season)>0&&Number.isInteger(Number(row.number))&&Number(row.number)>0).map(row=>[row.season+":"+row.number,row])).values()];
    for(const day of days){
      const releases=episodes.map(row=>({...row,date:new Date(/^\d{4}-\d{2}-\d{2}$/.test(row.raw)?row.raw+"T12:00:00":row.raw)}))
        .filter(row=>row.date.getDay()===day).sort((left,right)=>left.date-right.date);
      const next=releases.find(row=>row.date.getTime()+86400000>now.getTime());
      const batch=next?releases.filter(row=>row.date.getTime()===next.date.getTime()):[];
      result.push({item,day,date:next?.date||null,episodes:batch,state:next?(next.date>now?"upcoming":"released"):"tba"});
    }
  }
  return result.sort((left,right)=>(left.day+6)%7-(right.day+6)%7||(left.date?.getTime()||Infinity)-(right.date?.getTime()||Infinity)||String(left.item.title).localeCompare(String(right.item.title)));
}
function renderRecurringWeeklySchedule(){
  clearTimeout(recurringWeeklyTimer);recurringWeeklyTimer=null;
  let root=document.getElementById("recurring-weekly-dashboard");
  if(!root){
    const calendar=document.getElementById("library-dashboard");if(!calendar)return;
    root=document.createElement("div");root.id="recurring-weekly-dashboard";calendar.after(root);
    root.addEventListener("click",event=>{
      const button=event.target.closest("[data-recurring-open]");if(button)openMediaRow(button.dataset.recurringOpen);
    });
  }
  const visible=Boolean(currentUser&&currentTab==="library");
  root.classList.toggle("hidden",!visible);
  if(!visible){root.replaceChildren();root._dashboardMarkup=null;return;}
  const now=new Date(),rows=recurringWeeklyShows(mediaItems,now),total=new Set(rows.map(row=>String(row.item.id))).size;
  const days=Array.from({length:7},(_,index)=>{
    const day=(index+1)%7,label=new Date(2026,0,5+index).toLocaleDateString(USER_LOCALE,{weekday:"long"}),shows=rows.filter(row=>row.day===day);
    return `<section class="release-day recurring-weekday" data-recurring-day="${day}" aria-label="${esc(label)}"><header class="release-day-heading"><span class="release-day-name">${esc(label)}</span><span class="release-day-count">${shows.length} ${shows.length===1?"show":"shows"}</span></header>${shows.length?shows.map(row=>{
      const episode=row.episodes.length?row.episodes.map(ep=>`S${ep.season} E${ep.number}`).join(" · "):"Next episode TBA";
      const date=row.date?row.date.toLocaleDateString(USER_LOCALE,{day:"numeric",month:"short"}):"Date TBA";
      const time=row.date&&!/^\d{4}-\d{2}-\d{2}$/.test(row.episodes[0].raw)?row.date.toLocaleTimeString(USER_LOCALE,{hour:"2-digit",minute:"2-digit"}):"Time TBA";
      return `<button type="button" class="release-card recurring-release-card" data-recurring-open="${esc(row.item.id)}"><span class="release-time">${esc(time)}</span><span class="release-card-copy"><strong>${esc(row.item.title)}</strong><span class="release-episode">${esc(episode)} · ${esc(date)}</span><span class="release-state-badge" data-release-state="${row.state}">${row.state==="released"?"Released · last 24 hours":row.state==="upcoming"?"Upcoming":"Awaiting next episode"}</span><span class="release-platform">${esc(row.item.platform||"Platform not saved")}</span></span><span class="release-chevron" aria-hidden="true">›</span></button>`;
    }).join(""):'<p class="release-empty">No recurring shows</p>'}</section>`;
  }).join("");
  updateDashboardMarkup(root,`<section class="dashboard-section weekly-releases recurring-weekly-releases" aria-labelledby="recurring-weekly-title"><header class="weekly-releases-heading"><div><span class="weekly-eyebrow">MONDAY–SUNDAY</span><h2 id="recurring-weekly-title">Recurring weekly shows</h2><p class="dashboard-note">Independent of Library filters · device timezone (${esc(DEVICE_TIME_ZONE||Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC")})</p></div><span class="weekly-total">${total}<small>shows</small></span></header><div class="release-week-list">${days}</div><p class="weekly-footnote">Shows stay listed. Episodes remain for 24 hours after airing, then advance to the next confirmed episode. Unannounced dates stay TBA; no dates or episode numbers are guessed.</p></section>`);
  if(document.visibilityState==="visible"){
    const deadlines=rows.filter(row=>row.date).map(row=>row.date.getTime()+86400000-now.getTime()).filter(delay=>delay>0);
    recurringWeeklyTimer=setTimeout(renderRecurringWeeklySchedule,Math.max(1,Math.min(60000,...deadlines)));
  }
}
document.addEventListener("visibilitychange",renderRecurringWeeklySchedule);

function renderDashboard(){
  renderRecurringWeeklySchedule();
  const root=document.getElementById('library-dashboard');if(!root)return;
  const stats=watchStatistics(mediaItems);
  let statsTarget=document.getElementById('settings-watch-statistics');
  if(!statsTarget){const settings=document.getElementById('settings-view'),accountCard=settings?.querySelector('.profile-card');if(settings&&accountCard){statsTarget=document.createElement('div');statsTarget.id='settings-watch-statistics';accountCard.before(statsTarget);}}
  if(statsTarget)statsTarget.innerHTML=`<section class="dashboard-section watch-statistics" aria-labelledby="watch-statistics-title"><header class="watch-statistics-heading"><div><h2 id="watch-statistics-title">Your watch statistics</h2><p class="dashboard-note">Based on progress saved in your library</p></div></header><div class="watch-statistics-grid"><div class="watch-stat"><strong>${stats.libraryCount}</strong><span>Library items</span></div><div class="watch-stat"><strong>${stats.episodesWatched}</strong><span>Episodes logged</span></div><div class="watch-stat"><strong>${stats.filmsWatched}</strong><span>Films watched</span></div><div class="watch-stat"><strong>${stats.showsInProgress}</strong><span>Shows in progress</span></div><div class="watch-stat"><strong>${stats.showsCompleted}</strong><span>Shows completed</span></div></div></section>`;
  const visible=Boolean(currentUser&&currentTab==='library'&&!categoryControlsVisible()&&!searchQuery.trim());
  root.classList.toggle('hidden',!visible);if(!visible){root.replaceChildren();root._dashboardMarkup=null;return;}
  const {start,days:daysToShow,label:rangeLabel,priorStart,priorDays}=calendarRange(selectedCalendarRange,new Date());
  const {events,unknown}=calendarEvents(mediaItems,start,daysToShow);
  const priorEvents=selectedCalendarRange==='week'&&priorDays?calendarEvents(mediaItems,priorStart,priorDays).events:[];
  const eventsByDay=new Map();
  for(const event of events){const key=localISODate(event.date);if(!eventsByDay.has(key))eventsByDay.set(key,[]);eventsByDay.get(key).push(event);}
  let days='';
  for(let offset=0;offset<daysToShow;offset++){
    const date=new Date(start);date.setDate(date.getDate()+offset);
    const key=localISODate(date),rows=eventsByDay.get(key)||[];
    const isToday=localISODate(date)===localISODate(new Date());
    const dayLabel=selectedCalendarRange==='today'?'Today':date.toLocaleDateString(USER_LOCALE,{weekday:'long'});
    const dateLabel=date.toLocaleDateString(USER_LOCALE,{day:'numeric',month:'short'});
    // Group episodes of the same title airing at the same time into one compact card.
    const grouped=[];
    for(const event of rows){
      const time=event.dateOnly?'Time TBA':event.date.toLocaleTimeString(USER_LOCALE,{hour:'2-digit',minute:'2-digit'});
      const groupKey=[event.item.id,time,event.item.platform||'',event.dateOnly?'date':'time'].join('|');
      let group=grouped.find(row=>row.key===groupKey);
      if(!group){group={key:groupKey,item:event.item,time,dateOnly:event.dateOnly,events:[]};grouped.push(group);}
      if(!group.events.some(existing=>existing.label===event.label))group.events.push(event);
    }
    days+=`<section class="release-day${rows.length?' has-releases':' is-empty'}${isToday?' is-today':''}" aria-label="${esc(dayLabel)}, ${esc(dateLabel)}">
      <header class="release-day-heading"><div><span class="release-day-name">${esc(dayLabel)}${isToday?'<span class="today-marker">TODAY</span>':''}</span><span class="release-day-date">${esc(dateLabel)}</span></div><span class="release-day-count">${rows.length} ${rows.length===1?'release':'releases'}</span></header>
      ${grouped.length?grouped.map(group=>{
        const labels=group.events.map(event=>event.label);
        const episodeLabel=labels.length>1&&labels.every(label=>/^S\d+ E\d+$/.test(label))
          ?labels[0].match(/^S(\d+) E/)[0].replace(' E','')+' E'+labels.map(label=>Number(label.match(/E(\d+)/)[1])).join(', ')
          :labels.join(' · ');
        const platform=group.item.platform?esc(group.item.platform):'Platform not saved';
        const releaseState=group.events.some(event=>event.date.toDateString()===new Date().toDateString())?'Today':group.events.some(event=>event.date>new Date())?'Upcoming':'Released';
        return `<button type="button" class="release-card" data-dashboard-open="${esc(group.item.id)}">
          <span class="release-time">${esc(group.time)}</span>
          <span class="release-card-copy"><strong>${esc(group.item.title)}</strong><span class="release-episode">${esc(episodeLabel)} · ${group.dateOnly?'Date only':'Scheduled'}</span><span class="release-state-badge" data-release-state="${releaseState.toLowerCase()}">${releaseState}</span><span class="release-platform"><span class="release-platform-dot" aria-hidden="true"></span>${platform}</span></span>
          <span class="release-chevron" aria-hidden="true">›</span>
        </button>`;
      }).join(''):'<p class="release-empty">Nothing listed for this day</p>'}
    </section>`;
  }
  const excluded=mediaItems.filter(item=>item.hideFromWeeklyReleases===true);
  const priorMarkup=priorEvents.length?`<details class="release-tba prior-releases" data-dashboard-section="prior"><summary><span>Prior Releases</span><span class="release-tba-count">${priorEvents.length}</span></summary><div class="release-tba-list">${priorEvents.map(event=>`<button type="button" class="release-tba-item" data-dashboard-open="${esc(event.item.id)}"><strong>${esc(event.item.title)}</strong><span>${esc(event.label)} · ${esc(event.date.toLocaleDateString(USER_LOCALE,{weekday:'short',day:'numeric',month:'short'}))}${event.dateOnly?' · Date only':' · '+esc(event.date.toLocaleTimeString(USER_LOCALE,{hour:'2-digit',minute:'2-digit'}))}</span></button>`).join('')}</div></details>`:'';
  const controls=`<div class="filter-pills calendar-range" role="group" aria-label="Filter release calendar">${[['today','Today'],['week','This week'],['upcoming','Upcoming']].map(([key,label])=>`<button type="button" class="pill-btn${selectedCalendarRange===key?' active':''}" data-calendar-range="${key}" aria-pressed="${selectedCalendarRange===key}">${label}</button>`).join('')}</div>`;
  updateDashboardMarkup(root,`<section class="dashboard-section weekly-releases" aria-labelledby="weekly-releases-title">
    <header class="weekly-releases-heading"><div><span class="weekly-eyebrow">YOUR SCHEDULE</span><h2 id="weekly-releases-title">${selectedCalendarRange==='upcoming'?'Upcoming releases':selectedCalendarRange==='today'?"Today’s releases":"This week’s releases"}</h2><p class="dashboard-note">${rangeLabel} · device timezone (${esc(DEVICE_TIME_ZONE||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC')})</p></div><span class="weekly-total">${events.length}<small>releases</small></span></header>
    ${controls}
    <div class="release-week-list">${days}</div>
    ${priorMarkup}
    ${unknown.length?`<details class="release-tba" data-dashboard-section="unknown"><summary><span>Dates to be announced</span><span class="release-tba-count">${unknown.length}</span></summary><div class="release-tba-list">${unknown.map(item=>`<button type="button" class="release-tba-item" data-dashboard-open="${esc(item.id)}"><strong>${esc(item.title)}</strong><span>${esc(item.announcement)} · Date TBA</span><span class="release-chevron" aria-hidden="true">›</span></button>`).join('')}</div></details>`:''}
    ${excluded.length?`<details class="release-tba" data-dashboard-section="excluded"><summary><span>Excluded from Weekly Releases</span><span class="release-tba-count">${excluded.length}</span></summary><div class="release-tba-list">${excluded.map(item=>`<div class="dashboard-row excluded-release-row"><div><strong>${esc(item.title)}</strong><span class="release-state-badge" data-release-state="excluded">Excluded</span></div><button type="button" class="btn btn-secondary" data-calendar-include="${esc(item.id)}">Re-enable</button></div>`).join('')}</div></details>`:''}
    <p class="weekly-footnote">Broadcast and listed film dates may differ from UK streaming availability. Date-only releases use noon in the device timezone.</p>
  </section>`);
}
document.getElementById('library-dashboard').addEventListener('click',event=>{
  const range=event.target.closest('[data-calendar-range]');if(range){selectedCalendarRange=range.dataset.calendarRange;document.getElementById('library-dashboard')._dashboardMarkup=null;renderDashboard();return;}
  const include=event.target.closest('[data-calendar-include]');if(include){const item=mediaItems.find(row=>String(row.id)===include.dataset.calendarInclude);if(item){item.hideFromWeeklyReleases=false;render();void persistLibrary(mediaItems,{background:true,precleaned:true});}return;}
  const watch=event.target.closest('[data-dashboard-watch]');
  if(watch){
    const item=mediaItems.find(row=>String(row.id)===watch.dataset.dashboardWatch),next=item&&nextWatchEpisode(item);
    if(next&&next.season===Number(watch.dataset.season)&&next.episode===Number(watch.dataset.episode))void toggleEpisodeWatched(item.id,next.season,next.episode);
    return;
  }
  const open=event.target.closest('[data-dashboard-open]');if(open)openMediaRow(open.dataset.dashboardOpen);
});

async function refreshPrivateReminderHistory(){
  const panel=document.getElementById('private-reminder-history'),body=document.getElementById('reminder-history-body');
  const token=cloudSessionToken,accountId=currentUser?.id;
  if(!token||!accountId){panel.classList.add('hidden');return;}
  if(token!==cloudSessionToken||accountId!==currentUser?.id){panel.classList.add('hidden');return;}
  panel.classList.remove('hidden');
  try{
    const result=await reminderApi('private_history',{},token);
    if(token!==cloudSessionToken||accountId!==currentUser?.id)return;
    const status=row=>row.status==='sent'?'Accepted by push service':['retry','expired'].includes(row.status)&&row.attempts>=5?'Failed — retries exhausted':({retry:'Retry pending',pending:'Pending',expired:'Expired',failed:'Failed'}[row.status]||row.status);
    const history=(result.history||[]).map(row=>`<div class="dashboard-row"><div><strong>${esc(row.title||'Removed title')}</strong><small>${esc(row.label||'Reminder')} · ${esc(status(row))}</small><small>${esc(formatLocalDateTime(row.sent_at||row.scheduled_for))} · ${Number(row.attempts)||0} attempt(s)</small>${row.last_error?`<small>${esc(row.last_error)}</small>`:''}</div></div>`).join('');
    const upcoming=(result.upcoming||[]).map(row=>`<div class="dashboard-row"><div><strong>${esc(row.title)}</strong><small>${esc(row.label)} · ${esc(formatLocalDateTime(row.scheduled_for))}</small></div></div>`).join('');
    const suppressed=(result.suppressed||[]).map(row=>`<div class="dashboard-row"><div><strong>${esc(row.title)}</strong><small>${esc(row.label)} · Suppressed</small></div></div>`).join('');
    body.innerHTML=`<p class="dashboard-note">${result.enabledDevices} enabled device(s). A successful send means the push service accepted it; phone delivery is not confirmed.</p><h3>Upcoming reminders · Scheduled</h3>${upcoming||'<p>No scheduled reminders for enabled devices in the next seven days.</p>'}<h3>Suppressed</h3>${suppressed||'<p>No reminders suppressed.</p>'}<h3>Recent activity</h3>${history||'<p>No reminder attempts recorded yet.</p>'}`;
  }catch(error){if(token===cloudSessionToken&&accountId===currentUser?.id)body.textContent=error.message||'Could not load reminder history.';}
}
document.getElementById('refresh-reminder-history').onclick=async()=>{const dialog=document.getElementById('reminder-history-dialog'),body=document.getElementById('reminder-history-body');body.textContent='Loading reminders…';dialog.showModal();await refreshPrivateReminderHistory();};
document.getElementById('close-reminder-history').onclick=()=>document.getElementById('reminder-history-dialog').close();
