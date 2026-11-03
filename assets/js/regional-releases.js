/* Keep the provider airtime unchanged in every release surface. */
(function(root){
  function country({country='',timeZone='',locale=''}={}){
    if(/^[A-Z]{2}$/.test(String(country).toUpperCase()))return String(country).toUpperCase()==='UK'?'GB':String(country).toUpperCase();
    const zones={'Europe/London':'GB','Europe/Belfast':'GB','Europe/Guernsey':'GB','Europe/Jersey':'GB','Europe/Isle_of_Man':'GB','Europe/Dublin':'IE','Europe/Paris':'FR','Europe/Berlin':'DE','Europe/Madrid':'ES','Europe/Rome':'IT','Europe/Amsterdam':'NL','Asia/Tokyo':'JP','Asia/Kolkata':'IN','Asia/Singapore':'SG','Asia/Dubai':'AE','Asia/Hong_Kong':'HK','Asia/Seoul':'KR','Africa/Johannesburg':'ZA','Europe/Lisbon':'PT','Europe/Brussels':'BE','Europe/Stockholm':'SE','Europe/Oslo':'NO','Europe/Copenhagen':'DK','Europe/Helsinki':'FI','Europe/Warsaw':'PL','Europe/Zurich':'CH','Europe/Vienna':'AT','Europe/Athens':'GR','America/Sao_Paulo':'BR','America/Mexico_City':'MX'};
    if(zones[timeZone])return zones[timeZone];
    if(timeZone.startsWith('Australia/'))return'AU';
    if(['Pacific/Auckland','Pacific/Chatham'].includes(timeZone))return'NZ';
    if(/^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina)$/.test(timeZone))return'CA';
    if(/^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage)|^Pacific\/Honolulu$/.test(timeZone))return'US';
    try{return new Intl.Locale(locale).region||'';}catch{return'';}
  }
  function localTime(date,hour){
    const [y,m,d]=date.split('-').map(Number);
    return new Date(Date.UTC(y,m-1,d,hour)).toISOString();
  }
  // Airtimes are supplied by the episode provider. Do not replace them with
  // regional streaming listings, fixed clock overrides or availability delays.
  async function refresh(){}
  function resolveEvent(item,event){
    const raw=event.broadcastRaw||event.raw;
    const timed=(item.type!=='Film'||Boolean(String(item.filmReleaseSource||'').trim()))&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(raw||''))&&Number.isFinite(Date.parse(raw));
    return {...event,raw,platform:item.broadcastPlatform||item.platform,streamingUnconfirmed:!timed,
      releaseSchedule:timed?{key:'provider-airtime',platform:item.broadcastPlatform||item.platform||''}:null};
  }
  function resolve(item){
    if(!item)return item;
    const rows=[...(item.scheduledEpisodeReleases||[]),...(item.recurringWeeklySchedule?.episodes||[])].filter(Boolean);
    const original=raw=>rows.find(row=>row.raw===raw&&row.broadcastRaw)?.broadcastRaw||raw;
    const restore=row=>row?{...row,raw:row.broadcastRaw||row.raw,releaseSchedule:null}:row;
    if(!item.releaseSchedule&&!item.broadcastPlatform&&!rows.some(row=>row.broadcastRaw))return item;
    return {...item,platform:item.broadcastPlatform||item.platform,releaseSchedule:null,
      nextEpisodeDate:original(item.nextEpisodeDate),latestEpisodeDate:original(item.latestEpisodeDate),nextSeasonDate:original(item.nextSeasonDate),
      scheduledEpisodeReleases:Array.isArray(item.scheduledEpisodeReleases)?item.scheduledEpisodeReleases.map(restore):item.scheduledEpisodeReleases,
      recurringWeeklySchedule:item.recurringWeeklySchedule?{...item.recurringWeeklySchedule,episodes:(item.recurringWeeklySchedule.episodes||[]).map(restore)}:item.recurringWeeklySchedule};
  }
  root.WatchLogRegionalReleases={country,localTime,resolve,refresh,resolveEvent};
})(globalThis);
