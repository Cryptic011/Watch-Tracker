/* Project provider timestamps onto the selected platform's release schedule. */
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
  // The user-specified UK streaming clock applies to these Paramount+ titles.
  // Provider dates remain intact in storage and supply the actual episode list.
  const paramountUKReleases = [
    {name:'marshals',aliases:['marshals','the marshals'],showId:'84526',imdbId:'tt36849871',weekday:1},
    {name:'sheriff-country',aliases:['sheriff country'],showId:'76568',imdbId:'tt32268630',weekday:6}
  ];
  function paramountUKTitle(item){
    if(!['Series','Anime'].includes(item.type||item.format))return null;
    const showId=item.tvmazeShowId||item.tvmazeId||(item.source==='tvmaze'?item.externalId:'');
    const imdbId=item.imdbId||(item.source==='imdb'?item.externalId:'');
    const title=String(item.title||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
    return paramountUKReleases.find(rule=>{
      if(showId&&String(showId)!==rule.showId)return false;
      if(imdbId&&String(imdbId)!==rule.imdbId)return false;
      return Boolean(showId||imdbId)||rule.aliases.includes(title);
    })||null;
  }
  function streamingRule(item,options){
    if((country(options)||'GB')!=='GB')return null;
    const platform=String(item.platform||'').toLowerCase().replace(/[^a-z0-9+]/g,'');
    return ['paramount+','paramountplus'].includes(platform)?paramountUKTitle(item):null;
  }
  function catalogueItem(item,options={}){
    if(!item||(country(options)||'GB')!=='GB')return item;
    const platform=String(item.platform||'').trim().toLowerCase();
    if(!['','cbs'].includes(platform)||!paramountUKTitle(item))return item;
    return {...item,platform:'Paramount+',broadcastPlatform:item.broadcastPlatform||item.platform||'CBS'};
  }
  function platformReleaseTime(raw,rule){
    const source=new Date(raw),release=new Date(source);
    release.setUTCDate(release.getUTCDate()+(rule.weekday-release.getUTCDay()+7)%7);
    release.setUTCHours(8,0,0,0);
    // A later source timestamp is stronger than an approximate platform clock.
    return release<source?source.toISOString():release.toISOString();
  }
  async function refresh(){}
  function resolveEvent(item,event,options={}){
    const raw=event.broadcastRaw||event.raw;
    const timed=(item.type!=='Film'||Boolean(String(item.filmReleaseSource||'').trim()))&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(raw||''))&&Number.isFinite(Date.parse(raw));
    const rule=timed?streamingRule(item,options):null;
    if(rule)return {...event,raw:platformReleaseTime(raw,rule),broadcastRaw:raw,platform:item.platform,streamingUnconfirmed:false,
      releaseSchedule:{key:`${rule.name}-gb-paramount-0800`,platform:item.platform,country:'GB'}};
    return {...event,raw,platform:item.broadcastPlatform||item.platform,streamingUnconfirmed:!timed,
      releaseSchedule:timed?{key:'provider-airtime',platform:item.broadcastPlatform||item.platform||''}:null};
  }
  function resolve(item,options={}){
    if(!item)return item;
    const rows=[...(item.scheduledEpisodeReleases||[]),...(item.recurringWeeklySchedule?.episodes||[])].filter(Boolean);
    const original=raw=>rows.find(row=>row.raw===raw&&row.broadcastRaw)?.broadcastRaw||raw;
    const rule=streamingRule(item,options);
    if(rule){
      const project=raw=>resolveEvent(item,{raw:original(raw)},options).raw;
      return {...item,releaseSchedule:{key:`${rule.name}-gb-paramount-0800`,platform:item.platform,country:'GB'},
        nextEpisodeDate:project(item.nextEpisodeDate),latestEpisodeDate:project(item.latestEpisodeDate),nextSeasonDate:project(item.nextSeasonDate),
        scheduledEpisodeReleases:Array.isArray(item.scheduledEpisodeReleases)?item.scheduledEpisodeReleases.map(row=>resolveEvent(item,row,options)):item.scheduledEpisodeReleases,
        recurringWeeklySchedule:item.recurringWeeklySchedule?{...item.recurringWeeklySchedule,episodes:(item.recurringWeeklySchedule.episodes||[]).map(row=>resolveEvent(item,row,options))}:item.recurringWeeklySchedule};
    }
    const restore=row=>row?{...row,raw:row.broadcastRaw||row.raw,releaseSchedule:null}:row;
    if(!item.releaseSchedule&&!item.broadcastPlatform&&!rows.some(row=>row.broadcastRaw))return item;
    return {...item,platform:item.broadcastPlatform||item.platform,releaseSchedule:null,
      nextEpisodeDate:original(item.nextEpisodeDate),latestEpisodeDate:original(item.latestEpisodeDate),nextSeasonDate:original(item.nextSeasonDate),
      scheduledEpisodeReleases:Array.isArray(item.scheduledEpisodeReleases)?item.scheduledEpisodeReleases.map(restore):item.scheduledEpisodeReleases,
      recurringWeeklySchedule:item.recurringWeeklySchedule?{...item.recurringWeeklySchedule,episodes:(item.recurringWeeklySchedule.episodes||[]).map(restore)}:item.recurringWeeklySchedule};
  }
  root.WatchLogRegionalReleases={country,localTime,resolve,refresh,resolveEvent,catalogueItem};
})(globalThis);
