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
  function localTime(date,hour){
    const [y,m,d]=date.split('-').map(Number);
    return new Date(Date.UTC(y,m-1,d,hour)).toISOString();
  }
  function marshals(item){
    const imdb=String(item.imdbId||''),tv=String(item.tvmazeShowId||'');
    if(imdb&&imdb!=='tt36849871'||tv&&tv!=='84526')return false;
    return imdb==='tt36849871'||tv==='84526'||(!imdb&&!tv&&String(item.releaseYear)==='2026'&&/^(?:y[: ]+)?marshals(?:[ :]+a yellowstone story)?$/i.test(String(item.title||'').trim()));
  }
  function ukMarshalsTime(raw){
    if(!raw)return'';
    const text=String(raw),time=Date.parse(text);
    if(!Number.isFinite(time))return'';
    const date=/[zZ]$|[+-]\d\d:?\d\d$/.test(text)?new Date(time).toISOString().slice(0,10):text.slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return'';
    const day=new Date(date+'T12:00:00Z');
    // Both source broadcasts and saved Monday listings use Monday 08:00 GMT.
    // Existing dates establish the episode; never invent releases during a hiatus.
    if(![0,1].includes(day.getUTCDay()))return'';
    if(day.getUTCDay()===0)day.setUTCDate(day.getUTCDate()+1);
    return localTime(day.toISOString().slice(0,10),8);
  }
  const listings=new Map(),requests=new Map();
  let nextRequestAt=0;
  async function refresh(items,viewer={},fetcher=root.fetch,now=Date.now()){
    const stopped=()=>viewer.signal?.aborted||root.document?.visibilityState==='hidden';
    if(stopped())return;
    const region=country(viewer);if(!region||!fetcher)return;
    const tracked=new Map(items.filter(item=>['Series','Anime'].includes(item.type)&&item.tvmazeShowId).map(item=>[String(item.tvmazeShowId),item]));
    if(!tracked.size)return;
    const zone='UTC';
    const dateAt=time=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(time)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}`;};
    // Check the complete displayed window, not just today and one title's
    // nearest episode. Otherwise a missing feed date silently removes shows.
    const dates=[...new Set(Array.from({length:15},(_,index)=>dateAt(now+(index-1)*86400000)))];
    const jobs=dates.flatMap(date=>[region,''].map(feed=>({date,feed})));
    let cursor=0;
    const run=async()=>{while(cursor<jobs.length){
      if(stopped())return;
      const {date,feed}=jobs[cursor++];
      const key=region+':'+feed+':'+date+':'+[...tracked.keys()].sort().join(','),existing=requests.get(key);if(existing&&existing.expires>now){await existing.promise;continue;}
      // Space requests across workers and regions to stay below the public API rate limit.
      if(fetcher===root.fetch){
        const delay=Math.max(0,nextRequestAt-Date.now());nextRequestAt=Math.max(Date.now(),nextRequestAt)+650;
        if(delay&&root.setTimeout)await new Promise(resolve=>{
          let timer;
          const finish=()=>{root.clearTimeout?.(timer);viewer.signal?.removeEventListener('abort',finish);resolve();};
          timer=root.setTimeout(finish,delay);viewer.signal?.addEventListener('abort',finish,{once:true});
          if(stopped())finish();
        });
      }
      if(stopped())return;
      const url='https://api.tvmaze.com/schedule/web?country='+encodeURIComponent(feed)+'&date='+date;
      const promise=(async()=>{try{
        const timeout=AbortSignal.timeout(5000),signal=viewer.signal?AbortSignal.any([viewer.signal,timeout]):timeout;
        const response=await fetcher(url,{signal});if(!response.ok)throw Error('Regional listing unavailable');
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
      }catch(_){requests.delete(key);}})();requests.set(key,{expires:now+3600000,promise});await promise;
    }};
    await Promise.all(Array.from({length:3},run));
  }
  function resolveEvent(item,event,viewer={},now=Date.now()){
    if(item.releaseSchedule?.key==='marshals-gb-paramount-8')return item.releaseSchedule.confirmedTimes?.includes(event.raw)?{...event,releaseSchedule:item.releaseSchedule,platform:item.releaseSchedule.platform}:{...event,streamingUnconfirmed:true};
    const hit=listings.get(country(viewer)+':'+item.tvmazeShowId+':'+(event.season||(event.kind==='season'?event.number:''))+':'+(event.kind==='season'?1:(event.number??event.episode)));
    if(hit&&hit.expires>now)return {...event,broadcastRaw:event.broadcastRaw||event.raw,raw:hit.raw,platform:hit.platform,releaseSchedule:{country:hit.country,platform:hit.platform,sources:[hit.source],note:'TVMaze regional streaming listing'}};
    // Apply the user's four-hour availability rule to existing records too.
    // Always start from the original timestamp so rerenders never add it twice.
    const original=event.broadcastRaw||event.raw,time=Date.parse(original);
    if(!['Series','Anime'].includes(item.type)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(String(original||''))||!Number.isFinite(time))return event;
    if(event.releaseSchedule&&!event.releaseSchedule.estimated)return event;
    const platform=item.platform||'Saved service';
    return {...event,broadcastRaw:original,raw:new Date(time+4*3600000).toISOString(),platform,streamingUnconfirmed:false,
      releaseSchedule:{key:'broadcast-plus-four-hours',estimated:true,country:country(viewer),platform,timeSource:'User rule',sources:[],note:'Release time follows your saved availability rule'}};
  }
  function resolve(item,viewer={}){
    if(!item||!['Series','Anime'].includes(item.type)||country(viewer)!=='GB'||!marshals(item))return item;
    if(item.releaseSchedule?.key==='marshals-gb-paramount-8'&&item.releaseSchedule.version===2)return item;
    const convert=raw=>ukMarshalsTime(String(raw||''))||raw||'';
    const originals=[item.nextEpisodeDate,item.latestEpisodeDate,item.nextSeasonDate,...(item.scheduledEpisodeReleases||[]).filter(Boolean).map(ep=>ep.raw),...(item.recurringWeeklySchedule?.episodes||[]).filter(Boolean).map(ep=>ep.raw)].filter(Boolean);
    const confirmedTimes=[...new Set(originals.map(raw=>ukMarshalsTime(raw)).filter(Boolean))];
    const mapRows=rows=>Array.isArray(rows)?rows.map(ep=>ep?{...ep,broadcastRaw:ep.raw,raw:convert(ep.raw)}:ep):rows;
    const recurring=item.recurringWeeklySchedule;
    return {...item,platform:'Paramount+',broadcastPlatform:item.platform,
      nextEpisodeDate:convert(item.nextEpisodeDate),latestEpisodeDate:convert(item.latestEpisodeDate),nextSeasonDate:convert(item.nextSeasonDate),
      scheduledEpisodeReleases:mapRows(item.scheduledEpisodeReleases),
      recurringWeeklySchedule:recurring?{...recurring,days:[1],episodes:mapRows(recurring.episodes)}:recurring,
      releaseSchedule:{key:'marshals-gb-paramount-8',version:2,confirmedTimes,country:'GB',platform:'Paramount+',timeZone:'UTC',time:'08:00',weekday:1,timeSource:'User-confirmed',checkedAt:'2026-10-26',sources:[UK_SOURCE,EPISODE_SOURCE],note:'Monday 08:00 GMT · time confirmed by you'}};
  }
  root.WatchLogRegionalReleases={country,localTime,resolve,refresh,resolveEvent};
})(globalThis);
