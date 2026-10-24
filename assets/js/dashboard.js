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
  const times=new Map(),latestSeason=Number(item.airingSeason)||Math.max(0,...Object.keys(releases).map(Number));
  const rows=[
    {season:latestSeason,number:item.latestEpisodeNum,raw:item.latestEpisodeDate},
    ...(Array.isArray(item.recurringWeeklySchedule?.episodes)?item.recurringWeeklySchedule.episodes:[]),
    ...(Array.isArray(item.scheduledEpisodeReleases)?item.scheduledEpisodeReleases:[])
  ];
  for(const row of rows){
    const season=Number(row?.season),episode=Number(row?.number),raw=typeof row?.raw==="string"?row.raw:"";
    if(!Number.isInteger(season)||season<1||!Number.isInteger(episode)||episode<1||!raw)continue;
    const time=new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw)?raw+"T12:00:00":raw).getTime();
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

const DASHBOARD_WEEKDAY_FORMATTER=new Intl.DateTimeFormat(USER_LOCALE,{weekday:"long"});
const DASHBOARD_DATE_FORMATTER=new Intl.DateTimeFormat(USER_LOCALE,{day:"numeric",month:"short"});
const DASHBOARD_TIME_FORMATTER=new Intl.DateTimeFormat(USER_LOCALE,{hour:"2-digit",minute:"2-digit"});
const DASHBOARD_PRIOR_DATE_FORMATTER=new Intl.DateTimeFormat(USER_LOCALE,{weekday:"short",day:"numeric",month:"short"});
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
      // Cross-device duplicates should never produce two identical release
      // cards while their records are being reconciled.
      const key=[String(item.title||"").toLowerCase().trim(),String(item.platform||"").toLowerCase().trim(),
        candidate.label,localISODate(date),date.getTime()].join("|");
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
    const dated=episodes.map(row=>({...row,date:new Date(/^\d{4}-\d{2}-\d{2}$/.test(row.raw)?row.raw+"T12:00:00":row.raw)}))
      .filter(row=>Number.isFinite(row.date.getTime())).sort((left,right)=>left.date-right.date);
    for(const day of days){
      const releases=dated.filter(row=>row.date.getDay()===day);
      const next=releases.find(row=>row.date.getTime()+86400000>now.getTime());
      // A previous broadcast weekday never establishes an unannounced return.
      // Without a confirmed dated release, this show does not occupy a day.
      if(!next)continue;
      const batch=releases.filter(row=>row.date.getTime()===next.date.getTime());
      result.push({item,day,date:next.date,episodes:batch,state:next.date>now?"upcoming":"released"});
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
    ?row.date.getHours()*60+row.date.getMinutes():Infinity;
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
    root=document.createElement("div");root.id="recurring-weekly-dashboard";library.prepend(root);
    root.addEventListener("click",event=>{
      const button=event.target.closest("[data-recurring-open]");if(button)openMediaRow(button.dataset.recurringOpen,button);
    });
  }
  const visible=Boolean(currentUser&&currentTab==="library"&&!categoryControlsVisible());
  root.classList.toggle("hidden",!visible);
  if(!visible){if(!currentUser){root.replaceChildren();root._dashboardMarkup=null;}return;}
  const now=new Date(),rows=recurringWeeklyShows(mediaItems,now),total=new Set(rows.map(row=>String(row.item.id))).size;
  const progressMarkers=new Map();
  const days=Array.from({length:7},(_,index)=>{
    const day=(index+1)%7,label=DASHBOARD_WEEKDAY_FORMATTER.format(new Date(2026,0,5+index)),shows=rows.filter(row=>row.day===day);
    return `<section class="release-day recurring-weekday" data-recurring-day="${day}" aria-label="${esc(label)}"><header class="release-day-heading"><span class="release-day-name">${esc(label)}</span><span class="release-day-count">${shows.length} ${shows.length===1?"show":"shows"}</span></header>${shows.length?shows.map(row=>{
      const episode=row.episodes.length?row.episodes.map(ep=>`S${ep.season} E${ep.number}`).join(" · "):"Next episode TBA";
      const date=row.date?DASHBOARD_DATE_FORMATTER.format(row.date):"Date TBA";
      const time=row.date&&!/^\d{4}-\d{2}-\d{2}$/.test(row.episodes[0].raw)?DASHBOARD_TIME_FORMATTER.format(row.date):"Time TBA";
      return `<button type="button" class="release-card recurring-release-card" data-recurring-open="${esc(row.item.id)}"><span class="release-time">${esc(time)}</span><span class="release-card-copy"><strong class="release-show-title"><span>${esc(row.item.title)}</span>${scheduleProgressMarker(row.item,progressMarkers)}</strong><span class="release-episode">${esc(episode)} · ${esc(date)}</span><span class="release-state-badge" data-release-state="${row.state}">${row.state==="released"?"Released · last 24 hours":row.state==="upcoming"?"Upcoming":"Awaiting next episode"}</span><span class="release-platform">${esc(row.item.platform||"Platform not saved")}</span></span><span class="release-chevron" aria-hidden="true">›</span></button>`;
    }).join(""):'<p class="release-empty">No recurring shows</p>'}</section>`;
  }).join("");
  updateDashboardMarkup(root,`<details class="dashboard-section weekly-releases recurring-weekly-releases" data-dashboard-section="recurring" aria-labelledby="recurring-weekly-title"><summary class="weekly-releases-heading"><div class="recurring-summary-copy"><span class="weekly-eyebrow">MONDAY–SUNDAY</span><h2 id="recurring-weekly-title">Recurring weekly shows</h2><p class="dashboard-note">Tap to expand · device timezone (${esc(DEVICE_TIME_ZONE||Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC")})</p></div><span class="weekly-total">${total}<small>shows</small></span><span class="recurring-dropdown-chevron" aria-hidden="true">⌄</span></summary><div class="release-week-list">${days}</div><p class="weekly-footnote">Only confirmed dated releases appear here. Episodes remain for 24 hours after airing. Historical broadcast weekdays do not confirm a future episode.</p></details>`);
  if(document.visibilityState==="visible"){
    recurringWeeklyTimer=setTimeout(renderDashboard,recurringScheduleDelay(rows,now,mediaItems));
  }
}
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible")renderDashboard();
  else{clearTimeout(recurringWeeklyTimer);recurringWeeklyTimer=null;}
});

function recurringScheduleDelay(rows,now=new Date(),items=[]){
  const midnight=new Date(now);midnight.setHours(24,0,0,0);
  let deadline=midnight.getTime();
  for(const row of rows){
    if(!row.date)continue;
    for(const time of [row.date.getTime(),row.date.getTime()+86400000]){
      if(time>now.getTime())deadline=Math.min(deadline,time);
    }
  }
  for(const item of items){
    if(!isEpisodeTrackable(item))continue;
    for(const airTime of scheduleEpisodeAirTimes(item).values()){
      for(const time of [airTime,airTime+86400000])if(time>now.getTime())deadline=Math.min(deadline,time);
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
  renderRecurringWeeklySchedule();
  const root=document.getElementById('library-dashboard');if(!root)return;
  renderWatchStatistics();
  const visible=Boolean(currentUser&&currentTab==='library'&&!categoryControlsVisible()&&!searchQuery.trim());
  root.classList.toggle('hidden',!visible);if(!visible){if(!currentUser){root.replaceChildren();root._dashboardMarkup=null;}return;}
  const progressMarkers=new Map();
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
    const dayLabel=selectedCalendarRange==='today'?'Today':DASHBOARD_WEEKDAY_FORMATTER.format(date);
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
          <span class="release-card-copy"><strong class="release-show-title"><span>${esc(group.item.title)}</span>${scheduleProgressMarker(group.item,progressMarkers)}</strong><span class="release-episode">${esc(episodeLabel)} · ${group.dateOnly?'Date only':'Scheduled'}</span><span class="release-state-badge" data-release-state="${releaseState.toLowerCase()}">${releaseState}</span><span class="release-platform"><span class="release-platform-dot" aria-hidden="true"></span>${platform}</span></span>
          <span class="release-chevron" aria-hidden="true">›</span>
        </button>`;
      }).join(''):'<p class="release-empty">Nothing listed for this day</p>'}
    </section>`;
  }
  const excluded=mediaItems.filter(item=>item.hideFromWeeklyReleases===true);
  const priorMarkup=priorEvents.length?`<details class="release-tba prior-releases" data-dashboard-section="prior"><summary><span>Prior Releases</span><span class="release-tba-count">${priorEvents.length}</span></summary><div class="release-tba-list">${priorEvents.map(event=>`<button type="button" class="release-tba-item" data-dashboard-open="${esc(event.item.id)}"><strong class="release-show-title"><span>${esc(event.item.title)}</span>${scheduleProgressMarker(event.item,progressMarkers)}</strong><span>${esc(event.label)} · ${esc(DASHBOARD_PRIOR_DATE_FORMATTER.format(event.date))}${event.dateOnly?' · Date only':' · '+esc(DASHBOARD_TIME_FORMATTER.format(event.date))}</span></button>`).join('')}</div></details>`:'';
  const controls=`<div class="filter-pills calendar-range" role="group" aria-label="Filter release calendar">${[['today','Today'],['week','This week'],['upcoming','Upcoming']].map(([key,label])=>`<button type="button" class="pill-btn${selectedCalendarRange===key?' active':''}" data-calendar-range="${key}" aria-pressed="${selectedCalendarRange===key}">${label}</button>`).join('')}</div>`;
  updateDashboardMarkup(root,`<details class="dashboard-section weekly-releases" data-dashboard-section="calendar" aria-labelledby="weekly-releases-title">
    <summary class="weekly-releases-heading"><div class="recurring-summary-copy"><span class="weekly-eyebrow">RELEASE CALENDAR</span><h2 id="weekly-releases-title">Your schedule</h2><p class="dashboard-note">${rangeLabel} · device timezone (${esc(DEVICE_TIME_ZONE||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC')})</p></div><span class="weekly-total">${events.length}<small>releases</small></span><span class="recurring-dropdown-chevron" aria-hidden="true">⌄</span></summary>
    ${controls}
    <div class="release-week-list">${days}</div>
    ${priorMarkup}
    ${unknown.length?`<details class="release-tba" data-dashboard-section="unknown"><summary><span>Dates to be announced</span><span class="release-tba-count">${unknown.length}</span></summary><div class="release-tba-list">${unknown.map(item=>`<button type="button" class="release-tba-item" data-dashboard-open="${esc(item.id)}"><strong class="release-show-title"><span>${esc(item.title)}</span>${scheduleProgressMarker(item,progressMarkers)}</strong><span>${esc(item.announcement)} · Date TBA</span><span class="release-chevron" aria-hidden="true">›</span></button>`).join('')}</div></details>`:''}
    ${excluded.length?`<details class="release-tba" data-dashboard-section="excluded"><summary><span>Excluded from Weekly Releases</span><span class="release-tba-count">${excluded.length}</span></summary><div class="release-tba-list">${excluded.map(item=>`<div class="dashboard-row excluded-release-row"><div><strong>${esc(item.title)}</strong><span class="release-state-badge" data-release-state="excluded">Excluded</span></div><button type="button" class="btn btn-secondary" data-calendar-include="${esc(item.id)}">Re-enable</button></div>`).join('')}</div></details>`:''}
    <p class="weekly-footnote">Broadcast and listed film dates may differ from UK streaming availability. Date-only releases use noon in the device timezone.</p>
  </details>`);
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
