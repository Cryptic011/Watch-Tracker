/* Library dashboard. Uses the same released/watched episode rules as the tracker. */
function nextWatchEpisode(item,releases=releasedEpisodeMap(item),watched=watchedEpisodeMap(item,releases)){
  if(!isEpisodeTrackable(item))return null;
  for(const season of Object.keys(releases).map(Number).sort((a,b)=>a-b)){
    const seen=new Set(watched[season]||[]);
    for(const episode of releases[season]){
      if(!seen.has(episode))return{season,episode};
    }
  }
  return null;
}

function scheduleEpisodeAirTimes(item,releases=releasedEpisodeMap(item)){
  if(typeof regionalScheduleItem==="function")item=regionalScheduleItem(item);
  const times=new Map(),latestSeason=Number(item.airingSeason)||Math.max(0,...Object.keys(releases).map(Number));
  const rows=[
    {season:latestSeason,number:item.latestEpisodeNum,raw:item.latestEpisodeDate},
    ...(Array.isArray(item.recurringWeeklySchedule?.episodes)?item.recurringWeeklySchedule.episodes:[]),
    ...(Array.isArray(item.scheduledEpisodeReleases)?item.scheduledEpisodeReleases:[])
  ];
  for(const originalRow of rows){
    const row=typeof regionalScheduleEvent==="function"?regionalScheduleEvent(item,originalRow):originalRow;
    const season=Number(row?.season),episode=Number(row?.number),raw=typeof row?.raw==="string"?row.raw:"";
    if(!Number.isInteger(season)||season<1||!Number.isInteger(episode)||episode<1||!raw)continue;
    const time=new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw)?raw+"T12:00:00Z":raw).getTime();
    if(Number.isFinite(time))times.set(season+":"+episode,time);
  }
  return times;
}

function scheduleBehindLevel(item,now=new Date()){
  if(!isEpisodeTrackable(item))return "";
  const releases=releasedEpisodeMap(item),watched=watchedEpisodeMap(item,releases);
  if(item.episodeScheduleVerified!==true&&!Object.keys(releases).length)return "";
  const times=scheduleEpisodeAirTimes(item,releases);
  let behind=0;
  for(const [season,episodes] of Object.entries(releases)){
    const seen=new Set(watched[season]||[]);
    for(const episode of episodes){
      if(seen.has(episode))continue;
      const airTime=times.get(season+":"+episode);
      if(airTime!==undefined&&airTime+86400000>now.getTime())continue;
      if(++behind>2)return "red";
    }
  }
  return behind?"amber":"green";
}

function scheduleProgressMarker(item,markers=new Map()){
  if(markers.has(item.id))return markers.get(item.id);
  const level=scheduleBehindLevel(item);
  const marker=level?`<span class="release-progress-dot" data-behind-level="${level}" role="img" aria-label="${level==="green"?"Up to date":level==="red"?"More than two released episodes behind":"One or two released episodes behind"}"></span>`:"";
  markers.set(item.id,marker);return marker;
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
    const releases=releasedEpisodeMap(item),map=watchedEpisodeMap(item,releases);
    episodesWatched+=Object.values(map).reduce((sum,episodes)=>sum+(Array.isArray(episodes)?episodes.length:0),0);
    const next=nextWatchEpisode(item,releases,map);
    if(next)showsInProgress++;
    else if(Object.values(map).some(episodes=>Array.isArray(episodes)&&episodes.length))showsCompleted++;
  }
  return{libraryCount:rows.length,filmsWatched,episodesWatched,showsInProgress,showsCompleted};
}

const DASHBOARD_WEEKDAY_FORMATTER=new Intl.DateTimeFormat(USER_LOCALE,{timeZone:"UTC",weekday:"long"});
const DASHBOARD_DATE_FORMATTER=new Intl.DateTimeFormat(USER_LOCALE,{timeZone:"UTC",day:"numeric",month:"short"});
const DASHBOARD_TIME_FORMATTER=new Intl.DateTimeFormat(USER_LOCALE,{timeZone:"UTC",hour:"2-digit",minute:"2-digit"});
const DASHBOARD_PRIOR_DATE_FORMATTER=new Intl.DateTimeFormat(USER_LOCALE,{timeZone:"UTC",weekday:"short",day:"numeric",month:"short"});
let selectedCalendarRange='upcoming',selectedScheduleView='';
function homeSchedulesVisible(){
  return Boolean(currentUser&&currentTab==='library'&&!(typeof libraryOnlyPage!=='undefined'&&libraryOnlyPage));
}
function openScheduleView(view){
  if(!['recurring','calendar'].includes(view))return;
  if(typeof libraryOnlyPage!=='undefined'&&libraryOnlyPage)goToTabHome('library');
  selectedScheduleView='';render();
  const panel=document.querySelector('[data-home-section="'+view+'"]');
  if(panel){panel.open=true;panel.querySelector('summary')?.focus({preventScroll:true});}
}
function closeScheduleView(){goToTabHome('library');}
function renderScheduleNavigation(){
  let root=document.getElementById('library-schedule-navigation');
  if(!root){
    root=document.createElement('div');root.id='library-schedule-navigation';
    root.className='home-schedules';
    document.getElementById('library-view').prepend(root);
    for(const [key,label] of [['calendar','Calendar'],['recurring','Recurring shows']]){
      const panel=document.createElement('details');panel.className='home-schedule-panel';panel.dataset.homeSection=key;panel.open=true;
      const summary=document.createElement('summary');summary.innerHTML='<h2>'+label+'</h2><span class="home-section-chevron" aria-hidden="true">⌄</span>';
      panel.append(summary);root.append(panel);
      panel.addEventListener('toggle',()=>{if(homeSchedulesVisible())renderDashboard();});
    }
  }
  const account=String(currentUser?.id||'');
  if(root._account!==account){root._account=account;for(const panel of root.querySelectorAll('[data-home-section]'))panel.open=true;}
  const visible=homeSchedulesVisible();root.classList.toggle('hidden',!visible);
  const calendar=document.getElementById('library-dashboard');
  const calendarPanel=root.querySelector('[data-home-section="calendar"]');
  if(calendar&&calendar.parentElement!==calendarPanel)calendarPanel.append(calendar);
  if(typeof refreshRegionalReleaseSources==='function')refreshRegionalReleaseSources();
}
function calendarRange(range,now=new Date()){
  const today=new Date(now);today.setUTCHours(0,0,0,0);
  const weekStart=new Date(today);weekStart.setUTCDate(weekStart.getUTCDate()-(weekStart.getUTCDay()+6)%7);
  const priorDays=(today.getUTCDay()+6)%7;
  const throughSunday=7-priorDays;
  if(range==='today')return{start:today,days:1,label:'Local calendar day',priorStart:weekStart,priorDays:0};
  if(range==='upcoming')return{start:today,days:14,label:'Next 14 days',priorStart:weekStart,priorDays};
  return{start:today,days:throughSunday,label:`Today through Sunday`,priorStart:weekStart,priorDays};
}
function calendarWindowEvents(items,range='upcoming',now=new Date()){
  const window=calendarRange(range,now),result=calendarEvents(items,window.start,window.days);
  const midnight=window.start.getTime();
  const prior=calendarEvents(items,window.priorStart,Math.round((midnight-window.priorStart.getTime())/86400000)+1).events;
  const unconfirmedTimes=[...new Map([...prior,...result.events].filter(event=>event.dateOnly).map(event=>[event.item.id+'|'+event.label+'|'+event.raw,event])).values()];
  return {...window,...result,events:result.events.filter(event=>!event.dateOnly&&event.date>=now),
    priorEvents:prior.filter(event=>!event.dateOnly&&event.date<now),unconfirmedTimes};
}
function calendarEvents(items,now=new Date(),days=7){
  const start=new Date(now);start.setUTCHours(0,0,0,0);
  const end=new Date(start);end.setUTCDate(end.getUTCDate()+days);
  const events=[],unknown=[],seen=new Set();
  for(const original of items){
    const item=typeof regionalScheduleItem==="function"?regionalScheduleItem(original):original;
    if(item.hideFromWeeklyReleases===true)continue;
    let candidates=[];
    if(item.type==='Film')candidates=[{raw:item.filmReleaseDate,label:'Film release'}];
    else if(isEpisodeTrackable(item)){
      candidates=[...(Array.isArray(item.scheduledEpisodeReleases)?item.scheduledEpisodeReleases:[]),...(Array.isArray(item.recurringWeeklySchedule?.episodes)?item.recurringWeeklySchedule.episodes:[]),{season:item.airingSeason,number:item.latestEpisodeNum,raw:item.latestEpisodeDate}].filter(ep=>ep.season&&ep.number).map(ep=>({raw:ep.raw,label:`S${ep.season} E${ep.number}`,title:ep.title||ep.name||'',season:Number(ep.season),episode:Number(ep.number)}));
      if(item.nextEpisodeNum){
        const scheduled=(Array.isArray(item.scheduledEpisodeReleases)?item.scheduledEpisodeReleases:[]).find(ep=>Number(ep.number)===Number(item.nextEpisodeNum)&&String(ep.raw||"")===String(item.nextEpisodeDate||""));
        const activeSeason=Number(item.airingSeason||item.curSeason||0);
        const episodeSeason=Number(item.nextEpisodeNum)>1&&activeSeason?activeSeason:(item.nextSeasonNum||activeSeason||item.curSeason||0);
        const nextEpisodeSeason=Number(scheduled?.season||episodeSeason);
        candidates.push({raw:item.nextEpisodeDate,label:`S${nextEpisodeSeason||'?'} E${item.nextEpisodeNum}`,season:nextEpisodeSeason,episode:Number(item.nextEpisodeNum)});
      }
      const activeSeason=Number(item.airingSeason||item.curSeason||0);
      const activeSeasonContinues=activeSeason>0&&Number(item.nextSeasonNum)>activeSeason&&Number(item.nextEpisodeNum)>1&&(Boolean(item.nextEpisodeDate)||Boolean((releasedEpisodeMap(item)||{})[activeSeason]?.length));
      if(item.nextSeasonNum&&!activeSeasonContinues&&!candidates.some(e=>e.season===Number(item.nextSeasonNum)&&e.episode===1))candidates.push({raw:item.nextSeasonDate,label:`Season ${item.nextSeasonNum}`,kind:'season',season:Number(item.nextSeasonNum),number:Number(item.nextSeasonNum)});
    }
    const undated=[];let streamingUnconfirmed=false;
    for(const originalCandidate of candidates){
      const candidate=typeof regionalScheduleEvent==='function'?regionalScheduleEvent(item,originalCandidate):originalCandidate;
      if(!candidate.raw){undated.push(candidate);continue;}
      const dateOnly=/^\d{4}-\d{2}-\d{2}$/.test(candidate.raw);
      const date=new Date(dateOnly?`${candidate.raw}T12:00:00Z`:candidate.raw);
      if(!Number.isFinite(date.getTime()))continue;
      if(date<start||date>=end)continue;
      if(candidate.streamingUnconfirmed){streamingUnconfirmed=true;continue;}
      // Cross-device duplicates should never produce two identical release
      // cards while their records are being reconciled.
      const key=[String(item.title||"").toLowerCase().trim(),String(item.platform||"").toLowerCase().trim(),
        candidate.label,localISODate(date),date.getTime()].join("|");
      if(seen.has(key))continue;seen.add(key);
      events.push({...candidate,item:candidate.releaseSchedule?{...item,platform:candidate.platform,releaseSchedule:candidate.releaseSchedule}:item,date,dateOnly});
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
    if(!announcements.length&&Number(item.releaseYear)>now.getUTCFullYear()&&
      !Object.values(releases).some(episodes=>episodes.length)&&
      !(item.type==='Film'?item.filmReleaseDate:item.seriesReleaseDate)&&
      !candidates.some(candidate=>candidate.raw))announcements.push(item.type==='Film'?'Film release':'Series premiere');
    if(streamingUnconfirmed)announcements.push('Streaming availability to be confirmed');
    if(announcements.length)unknown.push({...item,streamingPending:streamingUnconfirmed,announcement:[...new Set(announcements)].join(' / ')});
  }
  return{start,end,events:events.sort((a,b)=>a.date-b.date||a.item.title.localeCompare(b.item.title)),unknown};
}

function pendingStreamingMarkup(items,attribute){
  if(!items.length)return '';
  return `<section class="release-pending" aria-label="Streaming dates awaiting confirmation"><h3>Streaming dates awaiting confirmation <span>${items.length}</span></h3><p>These shows have upcoming episode listings. Their availability in your viewing region is still being checked.</p><div class="release-tba-list">${items.map(item=>`<button type="button" class="release-tba-item" ${attribute}="${esc(item.id)}"><strong>${esc(item.title)}</strong><span>${esc(item.platform||'Streaming service to be confirmed')} · Date and time unconfirmed</span><span class="release-chevron" aria-hidden="true">›</span></button>`).join('')}</div></section>`;
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
  const result=[],horizon=now.getTime()+14*86400000;
  for(const original of Array.isArray(items)?items:[]){
    const item=typeof regionalScheduleItem==="function"?regionalScheduleItem(original):original;
    if(!isEpisodeTrackable(item)||item.hideFromWeeklyReleases===true)continue;
    const stored=item.recurringWeeklySchedule;
    const scheduled=Array.isArray(item.scheduledEpisodeReleases)?item.scheduledEpisodeReleases:[];
    const activeSeason=Number(item.airingSeason||item.curSeason||0);
    const nextMatch=scheduled.find(row=>Number(row.number)===Number(item.nextEpisodeNum)&&row.raw===item.nextEpisodeDate);
    const nextSeason=Number(nextMatch?.season||(Number(item.nextEpisodeNum)===1?item.nextSeasonNum:activeSeason)||activeSeason);
    const rows=[...(Array.isArray(stored?.episodes)?stored.episodes:[]),...scheduled,
      {season:activeSeason,number:item.latestEpisodeNum,raw:item.latestEpisodeDate},
      {season:nextSeason,number:item.nextEpisodeNum,raw:item.nextEpisodeDate},
      {season:Number(item.nextSeasonNum),number:1,raw:item.nextSeasonDate}];
    const pattern=weeklyReleasePattern(rows);
    const days=[...new Set((Array.isArray(stored?.days)?stored.days:pattern?.days||[]).filter(day=>Number.isInteger(day)&&day>=0&&day<7))];
    const episodes=[...new Map((pattern?.episodes||rows).filter(row=>row&&Number.isInteger(Number(row.season))&&Number(row.season)>0&&Number.isInteger(Number(row.number))&&Number(row.number)>0).map(row=>[row.season+":"+row.number,row])).values()];
    const regionalEpisodes=episodes.map(row=>typeof regionalScheduleEvent==='function'?regionalScheduleEvent(item,row):row).filter(row=>!row.streamingUnconfirmed);
    const dated=regionalEpisodes.map(row=>({...row,date:new Date(/^\d{4}-\d{2}-\d{2}$/.test(row.raw)?row.raw+"T12:00:00Z":row.raw)}))
      .filter(row=>Number.isFinite(row.date.getTime())).sort((left,right)=>left.date-right.date);
    // A dated announcement is enough; a second weekly occurrence is not required.
    days.splice(0,days.length,...new Set(dated.map(row=>row.date.getUTCDay())));
    for(const day of days){
      const releases=dated.filter(row=>row.date.getUTCDay()===day);
      const next=releases.find(row=>row.date.getTime()+86400000>now.getTime());
      // A previous broadcast weekday never establishes an unannounced return.
      // Only confirmed releases within the next two weeks occupy a day.
      if(!next||next.date.getTime()>horizon)continue;
      const batch=releases.filter(row=>row.date.getTime()===next.date.getTime());
      result.push({item:next.releaseSchedule?{...item,platform:next.platform,releaseSchedule:next.releaseSchedule}:item,day,date:next.date,episodes:batch,state:next.date>now?"upcoming":"released"});
    }
  }
  // Suppress duplicate schedule cards even before asynchronous cloud cleanup
  // finishes. Keep the entry with the stronger provider metadata.
  const unique=new Map();
  const quality=item=>Number(Boolean(item.tvmazeShowId))*5+Number(Boolean(item.imdbId))*3+
    Object.values(item.releasedEpisodes||{}).reduce((total,episodes)=>total+(Array.isArray(episodes)?episodes.length:0),0);
  for(const row of result){
    const key=[String(row.item.title||"").toLowerCase().trim(),String(row.item.platform||"").toLowerCase().trim(),
      row.day,row.date?.getTime()||"tba",row.episodes.map(ep=>`${ep.season}:${ep.number}`).sort().join(",")].join("|");
    const existing=unique.get(key);
    if(!existing||quality(row.item)>quality(existing.item))unique.set(key,row);
  }
  // Sort each weekday by the displayed local broadcast clock (01:00 before
  // 17:00), not by which future week has the first known episode. A date-only
  // announcement has no broadcast time and belongs after timed releases.
  const clockMinutes=row=>row.date&&row.episodes.length&&!/^\d{4}-\d{2}-\d{2}$/.test(String(row.episodes[0].raw||""))
    ?row.date.getUTCHours()*60+row.date.getUTCMinutes():Infinity;
  return [...unique.values()].sort((left,right)=>(left.day+6)%7-(right.day+6)%7||
    clockMinutes(left)-clockMinutes(right)||
    left.date.getTime()-right.date.getTime()||
    String(left.item.title).localeCompare(String(right.item.title)));
}
function renderRecurringWeeklySchedule(){
  clearTimeout(recurringWeeklyTimer);recurringWeeklyTimer=null;
  if(document.visibilityState==="hidden")return;
  let root=document.getElementById("recurring-weekly-dashboard");
  if(!root){
    const library=document.getElementById("library-view");if(!library)return;
    root=document.createElement("div");root.id="recurring-weekly-dashboard";
    document.querySelector('[data-home-section="recurring"]').append(root);
    root.addEventListener("click",event=>{
      const button=event.target.closest("[data-recurring-open]");if(button)openMediaRow(button.dataset.recurringOpen,button);
    });
  }
  const available=homeSchedulesVisible();
  root.classList.toggle("hidden",!available);
  if(!available){if(!currentUser){root.replaceChildren();root._dashboardMarkup=null;}return;}
  const now=new Date(),rows=recurringWeeklyShows(mediaItems,now),pending=calendarEvents(mediaItems,now,14).unknown.filter(item=>item.streamingPending&&isEpisodeTrackable(item)),total=new Set([...rows.map(row=>String(row.item.id)),...pending.map(item=>String(item.id))]).size;
  const progressMarkers=new Map();
  const days=Array.from({length:7},(_,index)=>{
    const day=(index+1)%7,label=DASHBOARD_WEEKDAY_FORMATTER.format(new Date(2026,0,5+index)),shows=rows.filter(row=>row.day===day);
    return `<section class="release-day recurring-weekday" data-recurring-day="${day}" aria-label="${esc(label)}"><header class="release-day-heading"><span class="release-day-name">${esc(label)}</span><span class="release-day-count">${shows.length} ${shows.length===1?"show":"shows"}</span></header>${shows.length?shows.map(row=>{
      const episode=row.episodes.length?row.episodes.map(ep=>`S${ep.season} E${ep.number}`).join(" · "):"Next episode TBA";
      const date=row.date?DASHBOARD_DATE_FORMATTER.format(row.date):"Date TBA";
      const time=row.date&&!/^\d{4}-\d{2}-\d{2}$/.test(row.episodes[0].raw)?DASHBOARD_TIME_FORMATTER.format(row.date):"Time TBA";
      return `<button type="button" class="release-card recurring-release-card" data-recurring-open="${esc(row.item.id)}"><span class="release-time">${esc(time)}</span><span class="release-card-copy"><strong class="release-show-title"><span>${esc(row.item.title)}</span>${scheduleProgressMarker(row.item,progressMarkers)}</strong><span class="release-episode">${esc(episode)} · ${esc(date)}</span><span class="release-state-badge" data-release-state="${row.state}">${row.state==="released"?"Released · last 24 hours":row.state==="upcoming"?"Upcoming":"Awaiting next episode"}</span><span class="release-platform">${esc(row.item.platform||"Platform not saved")}${row.item.releaseSchedule&&!row.item.releaseSchedule.estimated?` · ${esc(row.item.releaseSchedule.country)} streaming`:""}</span></span><span class="release-chevron" aria-hidden="true">›</span></button>`;
    }).join(""):'<p class="release-empty">No recurring shows</p>'}</section>`;
  }).join("");
  updateDashboardMarkup(root,`<section class="dashboard-section weekly-releases recurring-weekly-releases" aria-labelledby="recurring-weekly-title"><header class="weekly-releases-heading"><div class="recurring-summary-copy"><span class="weekly-eyebrow">MONDAY–SUNDAY</span><h2 id="recurring-weekly-title">Recurring shows</h2><p class="dashboard-note">Next 14 days · GMT</p></div><span class="weekly-total">${total}<small>shows</small></span></header><div class="release-week-list">${days}</div>${pendingStreamingMarkup(pending,"data-recurring-open")}<p class="weekly-footnote">Releases within the next 14 days appear here. Episodes remain for 24 hours after release. Unconfirmed streaming releases are listed separately above.</p></section>`);
  if(document.visibilityState==="visible"){
    recurringWeeklyTimer=setTimeout(renderDashboard,recurringScheduleDelay(rows,now,mediaItems));
  }
}
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible")renderDashboard();
  else{clearTimeout(recurringWeeklyTimer);recurringWeeklyTimer=null;}
});

function recurringScheduleDelay(rows,now=new Date(),items=[]){
  const midnight=new Date(now);midnight.setUTCHours(24,0,0,0);
  let deadline=midnight.getTime();
  for(const row of rows){
    if(!row.date)continue;
    for(const time of [row.date.getTime(),row.date.getTime()+86400000]){
      if(time>now.getTime())deadline=Math.min(deadline,time);
    }
  }
  for(const original of items){
    const item=typeof releaseTimelineItem==='function'?releaseTimelineItem(original):original;
    if(!isEpisodeTrackable(item))continue;
    const airTimes=[...scheduleEpisodeAirTimes(original).values()];
    if(item.nextEpisodeDate)airTimes.push(new Date(/^\d{4}-\d{2}-\d{2}$/.test(item.nextEpisodeDate)?item.nextEpisodeDate+"T12:00:00Z":item.nextEpisodeDate).getTime());
    for(const airTime of airTimes){
      // Hidden releases enter the two-week window without requiring a reload.
      for(const time of [airTime-14*86400000,airTime,airTime+86400000])if(time>now.getTime())deadline=Math.min(deadline,time);
    }
  }
  return Math.max(1,deadline-now.getTime());
}

function renderWatchStatistics(){
  if(!currentUser||currentTab!=="settings")return;
  const stats=watchStatistics(mediaItems);
  let statsTarget=document.getElementById('settings-watch-statistics');
  if(!statsTarget){const settings=document.getElementById('settings-view'),accountCard=settings?.querySelector('.profile-card');if(settings&&accountCard){statsTarget=document.createElement('div');statsTarget.id='settings-watch-statistics';accountCard.before(statsTarget);}}
  if(statsTarget)updateDashboardMarkup(statsTarget,`<section class="dashboard-section watch-statistics" aria-labelledby="watch-statistics-title"><header class="watch-statistics-heading"><div><h2 id="watch-statistics-title">Your watch statistics</h2><p class="dashboard-note">Based on progress saved in your library</p></div></header><div class="watch-statistics-grid"><div class="watch-stat"><strong>${stats.libraryCount}</strong><span>Library items</span></div><div class="watch-stat"><strong>${stats.episodesWatched}</strong><span>Episodes logged</span></div><div class="watch-stat"><strong>${stats.filmsWatched}</strong><span>Films watched</span></div><div class="watch-stat"><strong>${stats.showsInProgress}</strong><span>Shows in progress</span></div><div class="watch-stat"><strong>${stats.showsCompleted}</strong><span>Shows completed</span></div></div></section>`);
}

function renderDashboard(){
  if(typeof renderLibraryFeatures==="function")renderLibraryFeatures();
  renderScheduleNavigation();
  renderRecurringWeeklySchedule();
  const root=document.getElementById('library-dashboard');if(!root)return;
  renderWatchStatistics();
  const visible=homeSchedulesVisible();
  root.classList.toggle('hidden',!visible);if(!visible){if(!currentUser){root.replaceChildren();root._dashboardMarkup=null;}return;}
  const progressMarkers=new Map();
  const {start,days:daysToShow,label:rangeLabel,events,priorEvents,unconfirmedTimes,unknown:unresolved}=calendarWindowEvents(mediaItems,selectedCalendarRange,new Date());
  const pending=unresolved.filter(item=>item.streamingPending),unknown=unresolved.filter(item=>!item.streamingPending);
  const eventsByDay=new Map();
  for(const event of events){const key=localISODate(event.date);if(!eventsByDay.has(key))eventsByDay.set(key,[]);eventsByDay.get(key).push(event);}
  let days='';
  for(let offset=0;offset<daysToShow;offset++){
    const date=new Date(start);date.setUTCDate(date.getUTCDate()+offset);
    const key=localISODate(date),rows=eventsByDay.get(key)||[];
    if(!rows.length)continue;
    const isToday=localISODate(date)===localISODate(new Date());
    const dayLabel=new Intl.DateTimeFormat(USER_LOCALE,{timeZone:'UTC',weekday:'long',day:'numeric',month:'short',year:'numeric'}).format(date);
    const dateLabel=DASHBOARD_DATE_FORMATTER.format(date);
    // Group episodes of the same title airing at the same time into one compact card.
    const grouped=[],groupsByKey=new Map();
    for(const event of rows){
      const time=event.dateOnly?'Time TBA':DASHBOARD_TIME_FORMATTER.format(event.date);
      const groupKey=[event.item.id,time,event.item.platform||'',event.dateOnly?'date':'time'].join('|');
      let group=groupsByKey.get(groupKey);
      if(!group){group={key:groupKey,item:event.item,time,dateOnly:event.dateOnly,events:[],labels:new Set()};groupsByKey.set(groupKey,group);grouped.push(group);}
      if(!group.labels.has(event.label)){group.labels.add(event.label);group.events.push(event);}
    }
    days+=`<section class="release-day${rows.length?' has-releases':' is-empty'}${isToday?' is-today':''}" aria-label="${esc(dayLabel)}, ${esc(dateLabel)}">
      <header class="release-day-heading"><div><span class="release-day-name">${esc(dayLabel)}${isToday?'<span class="today-marker">TODAY</span>':''}</span></div><span class="release-day-count">${rows.length} ${rows.length===1?'release':'releases'}</span></header>
      ${grouped.length?grouped.map(group=>{
        const labels=group.events.map(event=>event.label);
        const episodeLabel=labels.length>1&&labels.every(label=>/^S\d+ E\d+$/.test(label))
          ?labels[0].match(/^S(\d+) E/)[0].replace(' E','')+' E'+labels.map(label=>Number(label.match(/E(\d+)/)[1])).join(', ')
          :labels.join(' · ');
        const platform=(group.item.platform?esc(group.item.platform):'Platform not saved')+(group.item.releaseSchedule&&!group.item.releaseSchedule.estimated?' · '+esc(group.item.releaseSchedule.country)+' streaming':'');
        const releaseState=group.events.some(event=>event.date.toDateString()===new Date().toDateString())?'Today':group.events.some(event=>event.date>new Date())?'Upcoming':'Released';
        return `<button type="button" class="release-card" data-dashboard-open="${esc(group.item.id)}">
          <span class="calendar-poster"><span class="calendar-poster-fallback" aria-hidden="true">${esc(group.item.title.slice(0,1))}</span><img hidden alt="" data-art="${esc(`${group.item.type}:${group.item.imdbId||group.item.tvmazeShowId||group.item.id}`)}" decoding="async" loading="lazy"></span>
          <span class="release-card-copy"><strong class="release-show-title"><span>${esc(group.item.title)}</span>${scheduleProgressMarker(group.item,progressMarkers)}</strong><span class="release-episode">${esc(episodeLabel)}${group.events.length===1&&group.events[0].title?' · '+esc(group.events[0].title):''}</span><span class="release-time">${esc(group.time)}${group.item.platform?' on '+platform:''}</span></span>
          <span class="release-chevron" aria-hidden="true">›</span>
        </button>`;
      }).join(''):'<p class="release-empty">Nothing listed for this day</p>'}
    </section>`;
  }
  const excluded=mediaItems.filter(item=>item.hideFromWeeklyReleases===true);
  const priorMarkup=`<details class="release-tba prior-releases" data-dashboard-section="prior"><summary><span>Prior Releases</span><span class="release-tba-count">${priorEvents.length}</span></summary><div class="release-tba-list">${priorEvents.map(event=>`<button type="button" class="release-tba-item" data-dashboard-open="${esc(event.item.id)}"><strong class="release-show-title"><span>${esc(event.item.title)}</span>${scheduleProgressMarker(event.item,progressMarkers)}</strong><span>${esc(event.label)} · ${esc(DASHBOARD_PRIOR_DATE_FORMATTER.format(event.date))}${event.dateOnly?' · Date only':' · '+esc(DASHBOARD_TIME_FORMATTER.format(event.date))}</span></button>`).join('')}${!priorEvents.length?'<p class="release-empty">No releases earlier this week</p>':''}</div></details>`;
  const controls=`<div class="filter-pills calendar-range" role="group" aria-label="Filter release calendar">${[['today','Today'],['week','This week'],['upcoming','Next 14 days']].map(([key,label])=>`<button type="button" class="pill-btn${selectedCalendarRange===key?' active':''}" data-calendar-range="${key}" aria-pressed="${selectedCalendarRange===key}">${label}</button>`).join('')}</div>`;
  updateDashboardMarkup(root,`<section class="dashboard-section weekly-releases calendar-agenda" aria-labelledby="weekly-releases-title">
    <header class="weekly-releases-heading"><div class="recurring-summary-copy"><span class="weekly-eyebrow">RELEASE CALENDAR</span><h2 id="weekly-releases-title">Your calendar</h2><p class="dashboard-note">${rangeLabel} · GMT</p></div><span class="weekly-total">${events.length}<small>releases</small></span></header>
    ${controls}
    <div class="release-week-list">${days||'<p class="release-empty">No releases in this date range</p>'}</div>
    ${pendingStreamingMarkup(pending,"data-dashboard-open")}
    ${unknown.length?`<details class="release-tba" data-dashboard-section="unknown"><summary><span>Dates to be announced</span><span class="release-tba-count">${unknown.length}</span></summary><div class="release-tba-list">${unknown.map(item=>`<button type="button" class="release-tba-item" data-dashboard-open="${esc(item.id)}"><strong class="release-show-title"><span>${esc(item.title)}</span>${scheduleProgressMarker(item,progressMarkers)}</strong><span>${esc(item.announcement)} · Date TBA</span><span class="release-chevron" aria-hidden="true">›</span></button>`).join('')}</div></details>`:''}
    ${excluded.length?`<details class="release-tba" data-dashboard-section="excluded"><summary><span>Excluded from Weekly Releases</span><span class="release-tba-count">${excluded.length}</span></summary><div class="release-tba-list">${excluded.map(item=>`<div class="dashboard-row excluded-release-row"><div><strong>${esc(item.title)}</strong><span class="release-state-badge" data-release-state="excluded">Excluded</span></div><button type="button" class="btn btn-secondary" data-calendar-include="${esc(item.id)}">Re-enable</button></div>`).join('')}</div></details>`:''}
    ${unconfirmedTimes.length?`<details class="release-tba" data-dashboard-section="unconfirmed-times"><summary><span>Release times to be confirmed</span><span class="release-tba-count">${unconfirmedTimes.length}</span></summary><div class="release-tba-list">${unconfirmedTimes.map(event=>`<button type="button" class="release-tba-item" data-dashboard-open="${esc(event.item.id)}"><strong>${esc(event.item.title)}</strong><span>${esc(event.label)} · ${esc(DASHBOARD_PRIOR_DATE_FORMATTER.format(event.date))} · Time to be confirmed</span></button>`).join('')}</div></details>`:''}
    ${priorMarkup}
    <p class="weekly-footnote">All times are GMT. Only confirmed release timestamps appear in the dated list and Prior Releases.</p>
  </section>`);
  window.WatchLogGallery?.observeScheduleArtwork?.(root,mediaItems);
}
document.getElementById('library-dashboard').addEventListener('click',event=>{
  const range=event.target.closest('[data-calendar-range]');if(range){saveNavigationPosition();selectedCalendarRange=range.dataset.calendarRange;renderDashboard();recordAppNavigation(true);return;}
  const include=event.target.closest('[data-calendar-include]');if(include){const item=mediaItems.find(row=>String(row.id)===include.dataset.calendarInclude);if(item){item.hideFromWeeklyReleases=false;render();void persistLibrary(mediaItems,{background:true,precleaned:true});}return;}
  const watch=event.target.closest('[data-dashboard-watch]');
  if(watch){
    const item=mediaItems.find(row=>String(row.id)===watch.dataset.dashboardWatch),next=item&&nextWatchEpisode(item);
    if(next&&next.season===Number(watch.dataset.season)&&next.episode===Number(watch.dataset.episode))void toggleEpisodeWatched(item.id,next.season,next.episode);
    return;
  }
  const open=event.target.closest('[data-dashboard-open]');if(open)openMediaRow(open.dataset.dashboardOpen,open);
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
