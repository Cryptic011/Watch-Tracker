/* Regional availability is separate from the original broadcaster's schedule. */
(function(root){
  const UK_SOURCE='https://www.intl.paramountplus.com/gb/shows/marshals/';
  const EPISODE_SOURCE='https://www.tvmaze.com/shows/84526/marshals/episodes';
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
  function localTime(date,hour,timeZone){
    const [y,m,d]=date.split('-').map(Number),wanted=Date.UTC(y,m-1,d,hour),formatter=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
    let guess=wanted;
    for(let pass=0;pass<4;pass++){
      const p=Object.fromEntries(formatter.formatToParts(new Date(guess)).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
      const delta=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)-wanted;
      if(!delta)break;guess-=delta;
    }
    return new Date(guess).toISOString();
  }
  function marshals(item){
    const imdb=String(item.imdbId||''),tv=String(item.tvmazeShowId||'');
    if(imdb&&imdb!=='tt36849871'||tv&&tv!=='84526')return false;
    return imdb==='tt36849871'||tv==='84526'||(!imdb&&!tv&&String(item.releaseYear)==='2026'&&/^(?:y[: ]+)?marshals(?:[ :]+a yellowstone story)?$/i.test(String(item.title||'').trim()));
  }
  function ukMarshalsTime(raw){
    if(!raw)return'';
    let date=String(raw).slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date)))return raw;
    if(/[zZ]$|[+-]\d\d:?\d\d$/.test(raw)){
      const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(raw)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
      date=`${p.year}-${p.month}-${p.day}`;
    }
    const day=new Date(date+'T12:00:00Z');
    // Move the confirmed US Sunday episode to its UK Monday; never invent
    // episodes for a hiatus or infer dates from a historical weekday alone.
    if(day.getUTCDay()!==0)return raw;
    day.setUTCDate(day.getUTCDate()+1);
    return localTime(day.toISOString().slice(0,10),8,'Europe/London');
  }
  const listings=new Map(),requests=new Map();
  async function refresh(items,viewer={},fetcher=root.fetch,now=Date.now()){
    const region=country(viewer);if(!region||!fetcher)return;
    const tracked=new Map(items.filter(item=>['Series','Anime'].includes(item.type)&&item.tvmazeShowId).map(item=>[String(item.tvmazeShowId),item]));
    if(!tracked.size)return;
    const zone=viewer.timeZone||({'GB':'Europe/London','US':'America/New_York','CA':'America/Toronto','AU':'Australia/Sydney','NZ':'Pacific/Auckland'}[region])||'UTC';
    const dateAt=time=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(time)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}`;};
    const dates=[...new Set([dateAt(now-86400000),dateAt(now),dateAt(now+86400000)])];
    const upcoming=items.map(item=>String(item.nextEpisodeDate||'').slice(0,10)).filter(date=>/^\d{4}-\d{2}-\d{2}$/.test(date)&&Date.parse(date)>=now&&Date.parse(date)<now+14*86400000).sort()[0];
    if(upcoming&&!dates.includes(upcoming))dates.push(upcoming);
    await Promise.all(dates.flatMap(date=>[region,''].map(feed=>{
      const key=region+':'+feed+':'+date+':'+[...tracked.keys()].sort().join(','),existing=requests.get(key);if(existing&&existing.expires>now)return existing.promise;
      const url='https://api.tvmaze.com/schedule/web?country='+encodeURIComponent(feed)+'&date='+date;
      const promise=(async()=>{try{
        const response=await fetcher(url,{signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('Regional listing unavailable');
        const rows=await response.json();if(!Array.isArray(rows))throw Error('Invalid regional listing');
        for(const ep of rows){
          const show=ep?._embedded?.show||ep?.show,item=tracked.get(String(show?.id)),channel=show?.webChannel;
          if(!item||!channel?.name||Number(ep.season)<1||Number(ep.number)<1)continue;
          if(item.imdbId&&show.externals?.imdb&&item.imdbId!==show.externals.imdb)continue;
          if(feed&&channel.country?.code!==region)continue;
          if(feed===''&&channel.country!==null)continue;
          const raw=ep.airtime&&ep.airstamp?ep.airstamp:ep.airdate;
          if(!raw||!Number.isFinite(Date.parse(raw)))continue;
          listings.set(region+':'+show.id+':'+ep.season+':'+ep.number,{raw,platform:channel.name,country:region,source:url,expires:now+3600000});
        }
      }catch(_){requests.delete(key);}})();requests.set(key,{expires:now+3600000,promise});return promise;
    })));
  }
  function resolveEvent(item,event,viewer={},now=Date.now()){
    if(item.releaseSchedule?.key==='marshals-gb-paramount-8')return item.releaseSchedule.confirmedTimes?.includes(event.raw)?{...event,releaseSchedule:item.releaseSchedule,platform:item.releaseSchedule.platform}:{...event,streamingUnconfirmed:true};
    const hit=listings.get(country(viewer)+':'+item.tvmazeShowId+':'+(event.season||(event.kind==='season'?event.number:''))+':'+(event.kind==='season'?1:(event.number??event.episode)));
    if(!hit||hit.expires<=now)return event;
    return {...event,broadcastRaw:event.raw,raw:hit.raw,platform:hit.platform,releaseSchedule:{country:hit.country,platform:hit.platform,sources:[hit.source],note:'TVMaze regional streaming listing'}};
  }
  function resolve(item,viewer={}){
    if(!item||!['Series','Anime'].includes(item.type)||country(viewer)!=='GB'||!marshals(item))return item;
    if(item.releaseSchedule?.key==='marshals-gb-paramount-8')return item;
    const convert=raw=>ukMarshalsTime(String(raw||''));
    const originals=[item.nextEpisodeDate,item.latestEpisodeDate,item.nextSeasonDate,...(item.scheduledEpisodeReleases||[]).filter(Boolean).map(ep=>ep.raw),...(item.recurringWeeklySchedule?.episodes||[]).filter(Boolean).map(ep=>ep.raw)].filter(Boolean);
    const confirmedTimes=[...new Set(originals.map(convert).filter((raw,index)=>raw!==originals[index]))];
    const mapRows=rows=>Array.isArray(rows)?rows.map(ep=>ep?{...ep,broadcastRaw:ep.raw,raw:convert(ep.raw)}:ep):rows;
    const recurring=item.recurringWeeklySchedule;
    return {...item,platform:'Paramount+',broadcastPlatform:item.platform,
      nextEpisodeDate:convert(item.nextEpisodeDate),latestEpisodeDate:convert(item.latestEpisodeDate),nextSeasonDate:convert(item.nextSeasonDate),
      scheduledEpisodeReleases:mapRows(item.scheduledEpisodeReleases),
      recurringWeeklySchedule:recurring?{...recurring,days:[1],episodes:mapRows(recurring.episodes)}:recurring,
      releaseSchedule:{key:'marshals-gb-paramount-8',confirmedTimes,country:'GB',platform:'Paramount+',timeZone:'Europe/London',time:'08:00',weekday:1,timeSource:'User-confirmed',checkedAt:'2026-10-26',sources:[UK_SOURCE,EPISODE_SOURCE],note:'UK streaming · Monday 08:00 · time confirmed by you'}};
  }
  root.WatchLogRegionalReleases={country,localTime,resolve,refresh,resolveEvent};
})(globalThis);
