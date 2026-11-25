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
  // Paramount+ UK uses the app's configured 08:00 UK release clock for every
  // selected series. The title catalogue is deliberately not allow-listed.
  const paramountUKRule={name:'paramountplus',weekday:null};
  function paramountUKTitle(item){
    return ['Series','Anime'].includes(item.type||item.format)?paramountUKRule:null;
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
  function dateInZone(raw,timeZone){
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(raw));
    const value={};for(const part of parts)if(part.type!=='literal')value[part.type]=part.value;
    return value.year+'-'+value.month+'-'+value.day;
  }
  function addCalendarDays(date,days){
    const [year,month,day]=date.split('-').map(Number),value=new Date(Date.UTC(year,month-1,day+days));
    return value.toISOString().slice(0,10);
  }
  function localTimeInZone(date,hour,timeZone){
    const [year,month,day]=date.split('-').map(Number);
    const target=Date.UTC(year,month-1,day,hour),formatter=new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
    let instant=target;
    for(let i=0;i<3;i++){
      const parts=formatter.formatToParts(new Date(instant)),value={};
      for(const part of parts)if(part.type!=='literal')value[part.type]=Number(part.value);
      const represented=Date.UTC(value.year,value.month-1,value.day,value.hour,value.minute,value.second);
      const correction=target-represented;
      instant+=correction;
      if(!correction)break;
    }
    return new Date(instant).toISOString();
  }
  function platformReleaseTime(raw,rule,event,item){
    if(!raw||!Number.isFinite(Date.parse(raw)))return raw;
    const sourcePlatform=platformKey(event?.broadcastPlatform||item?.broadcastPlatform||'');
    // CBS publishes the US linear airtime. Paramount+ UK is next-day, at 08:00,
    // so derive the platform calendar date from the US Eastern broadcast date,
    // never from the CBS clock or the UTC date rollover.
    const platformDate=sourcePlatform==='cbs'
      ?addCalendarDays(dateInZone(raw,'America/New_York'),1)
      :dateInZone(raw,'Europe/London');
    return localTimeInZone(platformDate,8,'Europe/London');
  }
  async function refresh(){}
  const platformKey=value=>String(value||'').toLowerCase().replace(/[^a-z0-9+]/g,'').replace(/^paramountplus$/,'paramount+');
  function officialEpisode(rule,season,episode){
    return (rule?.officialEpisodes||[]).find(row=>Number(row.season)===Number(season)&&Number(row.episode)===Number(episode))||null;
  }
  function resolvedOfficialEvent(event,official,item){
    return {...event,raw:official.streamingRaw,broadcastRaw:official.broadcastRaw,title:official.title||event.title||event.name||'',
      platform:item.platform,streamingUnconfirmed:false,releaseSourceMismatch:false,officialRelease:true,
      releaseSource:official.source,releaseDateConfirmed:official.releaseDateConfirmed===true,releaseTimeConfirmed:official.releaseTimeConfirmed===true,releaseSchedule:{key:'sheriff-country-paramount-uk-official',platform:'Paramount+',country:'GB'}};
  }
  function resolveEvent(item,event,options={}){
    const rule=streamingRule(item,options);
    const official=rule&&officialEpisode(rule,event.season,event.number);
    if(official)return resolvedOfficialEvent(event,official,item);
    const raw=event.broadcastRaw||event.raw;
    const timed=(item.type!=='Film'||Boolean(String(item.filmReleaseSource||'').trim()))&&/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}/.test(String(raw||''))&&Number.isFinite(Date.parse(raw));
    if(timed&&rule)return {...event,raw:platformReleaseTime(raw,rule),broadcastRaw:raw,platform:item.platform,streamingUnconfirmed:false,releaseSourceMismatch:false,
      releaseSchedule:{key:`${rule.name}-gb-paramount-0800`,platform:item.platform,country:'GB'}};
    // A broadcast timestamp cannot be presented as a different service's release.
    const selected=platformKey(item.platform),source=platformKey(event.broadcastPlatform||item.broadcastPlatform);
    const mismatch=item.type!=='Film'&&selected&&selected!=='other'&&selected!==source;
    return {...event,raw,platform:item.platform||item.broadcastPlatform,streamingUnconfirmed:!timed||Boolean(mismatch),releaseSourceMismatch:Boolean(mismatch),
      releaseSchedule:timed&&!mismatch?{key:'provider-airtime',platform:item.platform||item.broadcastPlatform||''}:null};
  }
  function resolve(item,options={}){
    if(!item)return item;
    const rows=[...(item.scheduledEpisodeReleases||[]),...(item.recurringWeeklySchedule?.episodes||[])].filter(Boolean);
    const original=raw=>rows.find(row=>row.raw===raw&&row.broadcastRaw)?.broadcastRaw||raw;
    const rule=streamingRule(item,options);
    if(rule){
      const project=(raw,season,episode)=>{
        const official=officialEpisode(rule,season,episode);
        if(official)return official.streamingRaw;
        const source=rows.find(row=>row.raw===raw&&row.broadcastRaw)?.broadcastRaw||raw;
        return resolveEvent(item,{raw:source,season,number:episode,broadcastPlatform:item.broadcastPlatform},options).raw;
      };
      const nextSeason=Number(item.airingSeason||item.curSeason||item.nextSeasonNum||0);
      return {...item,releaseSchedule:{key:`${rule.name}-gb-paramount-0800`,platform:item.platform,country:'GB'},
        nextEpisodeDate:project(item.nextEpisodeDate,nextSeason,item.nextEpisodeNum),
        latestEpisodeDate:project(item.latestEpisodeDate,item.airingSeason||item.curSeason,item.latestEpisodeNum),
        nextSeasonDate:project(item.nextSeasonDate,item.nextSeasonNum,1),
        scheduledEpisodeReleases:Array.isArray(item.scheduledEpisodeReleases)?item.scheduledEpisodeReleases.map(row=>resolveEvent(item,row,options)):item.scheduledEpisodeReleases,
        recurringWeeklySchedule:item.recurringWeeklySchedule?{...item.recurringWeeklySchedule,episodes:(item.recurringWeeklySchedule.episodes||[]).map(row=>resolveEvent(item,row,options))}:item.recurringWeeklySchedule};
    }
    const restore=row=>row?{...row,raw:row.broadcastRaw||row.raw,releaseSchedule:null}:row;
    if(!item.releaseSchedule&&!item.broadcastPlatform&&!rows.some(row=>row.broadcastRaw))return item;
    return {...item,platform:item.platform||item.broadcastPlatform,releaseSchedule:null,
      nextEpisodeDate:original(item.nextEpisodeDate),latestEpisodeDate:original(item.latestEpisodeDate),nextSeasonDate:original(item.nextSeasonDate),
      scheduledEpisodeReleases:Array.isArray(item.scheduledEpisodeReleases)?item.scheduledEpisodeReleases.map(restore):item.scheduledEpisodeReleases,
      recurringWeeklySchedule:item.recurringWeeklySchedule?{...item.recurringWeeklySchedule,episodes:(item.recurringWeeklySchedule.episodes||[]).map(restore)}:item.recurringWeeklySchedule};
  }
  root.WatchLogRegionalReleases={country,localTime,resolve,refresh,resolveEvent,catalogueItem};
})(globalThis);
