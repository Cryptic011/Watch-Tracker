  function toLocalInput(v){if(!v)return"";if(/^\d{4}-\d{2}-\d{2}$/.test(String(v)))return`${v}T12:00`;const d=new Date(v);if(Number.isNaN(d.getTime()))return"";const p=n=>String(n).padStart(2,"0");return`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;}
  function storedDateFromInput(value,previous=""){
    if(!value)return"";
    if(previous&&value===toLocalInput(previous))return previous;
    const time=new Date(value).getTime();
    return Number.isFinite(time)?new Date(time).toISOString():"";
  }
  function dateOnlyInput(v){return v?`${v}T12:00`:"";}
  async function imdbVerify(title,season,premiereDate){if(!IMDB_VERIFY_ENDPOINT)return{confirmed:null};try{const u=new URL(IMDB_VERIFY_ENDPOINT,location.href);u.searchParams.set("title",title);u.searchParams.set("season",String(season));if(premiereDate)u.searchParams.set("premiereDate",premiereDate);return await fetchJSONWithTimeout(u.toString());}catch(_){return{confirmed:null};}}

  const METADATA_CACHE_TTL_MS=6*60*60*1000;
  function cachedMetadataRequest(cache,key,task){
    const existing=cache.get(key);
    if(existing&&existing.expiresAt>Date.now())return existing.promise;
    if(existing)cache.delete(key);
    const entry={expiresAt:Date.now()+METADATA_CACHE_TTL_MS,promise:null};
    entry.promise=Promise.resolve().then(task).catch(error=>{if(cache.get(key)===entry)cache.delete(key);throw error;});
    cache.set(key,entry);
    while(cache.size>60)cache.delete(cache.keys().next().value);
    return entry.promise;
  }

  function episodeAirTime(episode){
    if(!episode)return 0;
    const stamped=episode.airstamp?new Date(episode.airstamp).getTime():0;
    if(Number.isFinite(stamped)&&stamped>0)return stamped;
    const dated=episode.airdate?new Date(`${episode.airdate}T23:59:59`).getTime():0;
    return Number.isFinite(dated)?dated:0;
  }

  function episodeLocalInput(episode){
    if(!episode)return"";
    if(episode.airstamp)return toLocalInput(episode.airstamp);
    return episode.airdate?dateOnlyInput(episode.airdate):"";
  }
  function episodeReleaseTimestamp(episode){
    if(!episode)return"";
    if(episode.airstamp){const time=new Date(episode.airstamp);if(!Number.isNaN(time.getTime()))return time.toISOString();}
    return episode.airdate||"";
  }

  function weeklyReleasePattern(episodes,broadcastDays=[]){
    const unique=new Map();
    for(const row of Array.isArray(episodes)?episodes:[]){
      const season=Number(row?.season),number=Number(row?.number),raw=String(row?.raw||"");
      const date=new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw)?raw+"T12:00:00":raw);
      if(!Number.isInteger(season)||season<1||!Number.isInteger(number)||number<1||!Number.isFinite(date.getTime()))continue;
      unique.set(season+":"+number,{season,number,raw,date});
    }
    const rows=[...unique.values()].sort((left,right)=>left.date-right.date);
    if(!rows.length)return null;
    const current=rows.filter(row=>row.season===rows.at(-1).season).slice(-40),days=[];
    for(let day=0;day<7;day++){
      const matches=current.filter(row=>row.date.getDay()===day);
      if(matches.some((row,index)=>matches.slice(index+1).some(next=>next.date-row.date>=6*86400000&&next.date-row.date<=8*86400000)))days.push(day);
    }
    const officialDays=(Array.isArray(broadcastDays)?broadcastDays:[]).filter(day=>["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].includes(day));
    if(!days.length&&officialDays.length){
      const counts=new Map();
      for(const row of current)counts.set(row.date.getDay(),(counts.get(row.date.getDay())||0)+1);
      days.push(...[...counts].sort((left,right)=>right[1]-left[1]).slice(0,officialDays.length).map(([day])=>day));
    }
    return days.length?{days,episodes:rows.slice(-100).map(({season,number,raw})=>({season,number,raw}))}:null;
  }

  function analyzeTVSchedule(seasonsRaw,episodesRaw,show,now=Date.now()){
    const seasons=(Array.isArray(seasonsRaw)?seasonsRaw:[])
      .filter(s=>Number.isFinite(Number(s?.number))&&Number(s.number)>0)
      .map(s=>({...s,number:Number(s.number)})).sort((a,b)=>a.number-b.number);
    const episodes=(Array.isArray(episodesRaw)?episodesRaw:[])
      .filter(ep=>Number.isFinite(Number(ep?.season))&&Number(ep.season)>0&&Number.isFinite(Number(ep?.number)))
      .map(ep=>({...ep,season:Number(ep.season),number:Number(ep.number)}));
    const known=new Set(seasons.map(s=>s.number));
    episodes.forEach(ep=>known.add(ep.season));
    const highest=known.size?Math.max(...known):null;
    const episodeCounts={},airedEpisodeCounts={},releasedEpisodes={};
    for(const ep of episodes){
      episodeCounts[ep.season]=Math.max(episodeCounts[ep.season]||0,ep.number);
      const t=episodeAirTime(ep);
      if(t>0&&t<=now){airedEpisodeCounts[ep.season]=Math.max(airedEpisodeCounts[ep.season]||0,ep.number);(releasedEpisodes[ep.season]||(releasedEpisodes[ep.season]=[])).push(ep.number);}
    }
    const aired=episodes.filter(ep=>{const t=episodeAirTime(ep);return t>0&&t<=now;}).sort((a,b)=>episodeAirTime(a)-episodeAirTime(b));
    const future=episodes.filter(ep=>episodeAirTime(ep)>now).sort((a,b)=>episodeAirTime(a)-episodeAirTime(b)||a.season-b.season||a.number-b.number);
    const embedded=show?._embedded?.nextepisode||null;
    let nextEpisode=embedded&&episodeAirTime(embedded)>now?{...embedded,season:Number(embedded.season),number:Number(embedded.number)}:future[0]||null;
    if(nextEpisode&&(!Number.isFinite(nextEpisode.season)||!Number.isFinite(nextEpisode.number)))nextEpisode=future[0]||null;
    const latestEpisode=aired.length?aired[aired.length-1]:null;
    const latestAired=latestEpisode?Number(latestEpisode.season):null;
    let activeSeason=latestAired;
    if(nextEpisode&&aired.some(ep=>ep.season===Number(nextEpisode.season)))activeSeason=Number(nextEpisode.season);
    const activeAired=activeSeason===null?[]:aired.filter(ep=>ep.season===activeSeason);
    const currentEpisode=activeAired.length?Math.max(...activeAired.map(ep=>ep.number)):null;
    const currentEpisodeRow=currentEpisode===null?null:activeAired.filter(ep=>ep.number===currentEpisode).sort((a,b)=>episodeAirTime(b)-episodeAirTime(a))[0]||null;
    const activeNext=nextEpisode&&activeSeason!==null&&Number(nextEpisode.season)===activeSeason?nextEpisode:null;
    const airing=activeSeason!==null&&activeNext?{season:activeSeason,latestEpisode:currentEpisode,latestEpisodeTitle:currentEpisodeRow?.name||"",episodeCount:episodeCounts[activeSeason]||currentEpisode||null,nextEpisode:activeNext}:null;
    const seasonMap=new Map(seasons.map(s=>[s.number,s]));
    const completion=new Map();
    for(const n of Array.from(known).sort((a,b)=>a-b)){
      const seasonEpisodes=episodes.filter(ep=>ep.season===n);
      const hasAired=seasonEpisodes.some(ep=>{const t=episodeAirTime(ep);return t>0&&t<=now;});
      const hasFuture=seasonEpisodes.some(ep=>episodeAirTime(ep)>now);
      const endDate=seasonMap.get(n)?.endDate;
      const endPassed=endDate?new Date(`${endDate}T23:59:59`).getTime()<now:false;
      completion.set(n,Boolean(hasAired&&!hasFuture&&(n<(activeSeason||Infinity)||endPassed||String(show?.status||"").toLowerCase()==="ended")));
    }
    let completedSeasons=0;
    while(completion.get(completedSeasons+1))completedSeasons++;
    let upcomingSeason=null;
    if(nextEpisode&&Number(nextEpisode.season)>(latestAired||0)){
      upcomingSeason=seasonMap.get(Number(nextEpisode.season))||{number:Number(nextEpisode.season),premiereDate:nextEpisode.airdate||null};
    }
    if(!upcomingSeason){
      upcomingSeason=seasons.filter(s=>s.number>(latestAired||0)&&s.premiereDate&&new Date(`${s.premiereDate}T23:59:59`).getTime()>now).sort((a,b)=>a.number-b.number)[0]||null;
    }
    for(const season of Object.keys(releasedEpisodes))releasedEpisodes[season]=[...new Set(releasedEpisodes[season])].sort((a,b)=>a-b);
    return {seasons,episodes,known,highest,latestAired,currentEpisode,currentEpisodeRow,nextEpisode,airing,upcomingSeason,episodeCounts,airedEpisodeCounts,releasedEpisodes,completedSeasons};
  }

  function officialEpisodeImageMap(episodes,showImage={}){
    const images={};
    const posters=new Set([showImage?.original,showImage?.medium].filter(value=>typeof value==="string").map(url=>url.split("/").at(-1).split("?")[0]));
    for(const episode of Array.isArray(episodes)?episodes:[]){
      const season=Number(episode?.season),number=Number(episode?.number);
      const url=[episode?.image?.original,episode?.image?.medium].find(value=>typeof value==="string"&&/^https:\/\/static\.tvmaze\.com\//.test(value)&&!posters.has(value.split("/").at(-1).split("?")[0]));
      if(!Number.isInteger(season)||season<=0||!Number.isInteger(number)||number<=0||!url)continue;
      (images[season]||(images[season]={}))[number]=url;
    }
    return images;
  }

  function officialSeasonImageMap(seasons){
    const images={};
    for(const season of Array.isArray(seasons)?seasons:[]){
      const number=Number(season?.number),url=[season?.image?.original,season?.image?.medium].find(value=>typeof value==="string"&&/^https:\/\/static\.tvmaze\.com\//.test(value));
      if(Number.isInteger(number)&&number>0&&url)images[number]=url;
    }
    return images;
  }

  const trackerArtworkCache=new Map();
  function fetchOfficialTrackerArtwork(item){
    const key=JSON.stringify([item.tvmazeShowId||"",item.imdbId||"",item.title,item.releaseYear||""]);
    return cachedMetadataRequest(trackerArtworkCache,key,async()=>{
      const showId=String(item.tvmazeShowId||"").trim(),imdbId=String(item.imdbId||"").trim();
      let show=null;
      if(/^\d+$/.test(showId))show=await fetchJSONWithTimeout(`https://api.tvmaze.com/shows/${encodeURIComponent(showId)}`,{credentials:"omit"});
      else if(/^tt\d+$/.test(imdbId))show=await fetchJSONWithTimeout(`https://api.tvmaze.com/lookup/shows?imdb=${encodeURIComponent(imdbId)}`,{credentials:"omit"});
      else{
        const rows=await fetchJSONWithTimeout(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(item.title||"")}`,{credentials:"omit"});
        const matches=(Array.isArray(rows)?rows:[]).map(row=>row.show).filter(candidate=>normalizeTitle(candidate?.name)===normalizeTitle(item.title)&&(!item.releaseYear||String(candidate?.premiered||"").slice(0,4)===String(item.releaseYear)));
        if(matches.length===1)show=matches[0];
      }
      if(!show?.id||(showId&&String(show.id)!==showId)||(imdbId&&show.externals?.imdb!==imdbId))return {};
      const results=await Promise.allSettled([
        fetchJSONWithTimeout(`https://api.tvmaze.com/shows/${encodeURIComponent(show.id)}/episodes`,{credentials:"omit"}),
        fetchJSONWithTimeout(`https://api.tvmaze.com/shows/${encodeURIComponent(show.id)}/seasons`,{credentials:"omit"})
      ]);
      const artwork={details:{
        description:String(show.summary||""),premiered:show.premiered||"",genres:Array.isArray(show.genres)?show.genres:[],
        status:show.status||"",rating:Number.isFinite(show.rating?.average)?show.rating.average:null,
        runtime:show.averageRuntime||show.runtime||null,language:show.language||"",source:"TVMaze",sourceUrl:`https://www.tvmaze.com/shows/${show.id}`,sources:[{name:"TVMaze",url:`https://www.tvmaze.com/shows/${show.id}`}],ratingSource:"TVMaze"
      }};
      if(results[0].status==="fulfilled"&&Array.isArray(results[0].value))artwork.episodeImages=officialEpisodeImageMap(results[0].value,show.image);
      if(results[1].status==="fulfilled"&&Array.isArray(results[1].value)){
        artwork.seasonImages=officialSeasonImageMap(results[1].value);
        artwork.details.seasons=results[1].value.filter(season=>Number(season.number)>0).length;
      }
      if(results.some(result=>result.status==="rejected"))trackerArtworkCache.delete(key);
      return artwork;
    });
  }

  const titleDetailsCache=new Map();
  async function fetchOfficialTitleDetails(item){
    const payload={title:item.title,type:item.type||item.format,imdbId:item.imdbId||(item.source==="imdb"?item.externalId:""),tvmazeShowId:item.tvmazeShowId||item.tvmazeId,year:item.releaseYear||item.year,source:item.source,externalId:item.externalId};
    const key=JSON.stringify(payload);
    return cachedMetadataRequest(titleDetailsCache,key,async()=>{
      try{
        const response=await pinApi("catalog_details",payload);
        if(response.details?.description){return response.details;}
        titleDetailsCache.delete(key);
        if(response.details?.sources?.length)return response.details;
      }catch(_) {titleDetailsCache.delete(key);}
      // The browser can still read the exact TVMaze identity if the gateway is offline.
      if(payload.type==="Series"){
        const details=(await fetchOfficialTrackerArtwork({...item,type:"Series",tvmazeShowId:payload.tvmazeShowId,imdbId:payload.imdbId})).details||{};
        if(details.description)return {...details,imdbUrl:/^tt\d+$/.test(payload.imdbId||"")?`https://www.imdb.com/title/${payload.imdbId}/`:""};
      }
      return {state:"unavailable",sources:[],imdbUrl:/^tt\d+$/.test(payload.imdbId||"")?`https://www.imdb.com/title/${payload.imdbId}/`:""};
    });
  }
  function titleDetailsSourceLinks(details){
    const sources=[...(details.sources||[])];
    if(details.imdbUrl&&!sources.some(row=>row.url===details.imdbUrl))sources.push({name:"View on IMDb",url:details.imdbUrl});
    return sources.flatMap(row=>{
      try{const url=new URL(row.url);if(url.protocol!=="https:"||!['www.imdb.com','imdb.com','www.tvmaze.com','tvmaze.com','www.justwatch.com','itunes.apple.com','tv.apple.com'].includes(url.hostname))return [];return [`<a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(row.name)}</a>`];}catch{return [];}
    }).join(" · ");
  }

  function tvMazeShowMatchesSelection(show,title,{imdbId="",year=""}={}){
    if(!show?.name)return false;
    const candidateImdbId=String(show?.externals?.imdb||"");
    if(imdbId&&candidateImdbId)return candidateImdbId===String(imdbId);
    if(normalizeTitle(show.name)!==normalizeTitle(title))return false;
    const candidateYear=String(show?.premiered?.slice?.(0,4)||"");
    return !year||!candidateYear||candidateYear===String(year);
  }

  async function fetchTVMazeSeasonSnapshot(showId,fallbackShow={}){
    const [seasonResult,showResult,episodeResult]=await Promise.allSettled([
      fetchJSONWithTimeout(`https://api.tvmaze.com/shows/${encodeURIComponent(showId)}/seasons`,{credentials:"omit"}),
      fetchJSONWithTimeout(`https://api.tvmaze.com/shows/${encodeURIComponent(showId)}?embed=nextepisode`,{credentials:"omit"}),
      fetchJSONWithTimeout(`https://api.tvmaze.com/shows/${encodeURIComponent(showId)}/episodes`,{credentials:"omit"})
    ]);
    const seasonsRaw=seasonResult.status==="fulfilled"&&Array.isArray(seasonResult.value)?seasonResult.value:[];
    const show=showResult.status==="fulfilled"?showResult.value:fallbackShow;
    const episodes=episodeResult.status==="fulfilled"&&Array.isArray(episodeResult.value)?episodeResult.value:[];
    const seasonAvailable=seasonResult.status==="fulfilled",showAvailable=showResult.status==="fulfilled",episodeAvailable=episodeResult.status==="fulfilled"&&Array.isArray(episodeResult.value);
    return {
      tvAvailable:seasonAvailable||showAvailable||episodeAvailable,
      episodeScheduleAvailable:episodeAvailable,show,
      schedule:analyzeTVSchedule(seasonsRaw,episodes,show,Date.now())
    };
  }

  function tvMazeSeasonResult(resolvedShowId,show,schedule,{imdbId="",tvAvailable=false,episodeScheduleAvailable=false}={}){
    const ended=tvAvailable&&String(show?.status||"").toLowerCase()==="ended"&&!schedule.nextEpisode;
    const upcoming=!ended&&schedule.upcomingSeason?{
      number:Number(schedule.upcomingSeason.number),
      premiereDate:schedule.upcomingSeason.premiereDate||schedule.nextEpisode?.airdate||null,
      source:"TVMaze",
      raw:schedule.upcomingSeason
    }:null;
    return {
      highest:schedule.highest,latestAired:schedule.latestAired,currentEpisode:schedule.currentEpisode,
      latestEpisodeDate:episodeReleaseTimestamp(schedule.currentEpisodeRow),seriesReleaseDate:show?.premiered||"",
      completedSeasons:schedule.completedSeasons,upcoming,nextEpisode:schedule.nextEpisode,airing:schedule.airing,episodeImages:officialEpisodeImageMap(schedule.episodes,show?.image),episodeImagesSource:"TVMaze",seasonImages:officialSeasonImageMap(schedule.seasons),seasonImagesSource:"TVMaze",
      scheduledEpisodeReleases:schedule.episodes.filter(ep=>episodeAirTime(ep)>Date.now()-86400000).map(ep=>({season:ep.season,number:ep.number,raw:episodeReleaseTimestamp(ep)})),
      recurringWeeklySchedule:ended?null:weeklyReleasePattern(schedule.episodes.map(ep=>({season:ep.season,number:ep.number,raw:episodeReleaseTimestamp(ep)})),show?.schedule?.days),
      episodeCounts:schedule.episodeCounts,airedEpisodeCounts:schedule.airedEpisodeCounts,releasedEpisodes:schedule.releasedEpisodes,known:new Set(schedule.known),
      sources:tvAvailable?["TVMaze"]:[],tvAvailable,episodeScheduleAvailable,resolvedShowId,
      imdbId:String(imdbId||show?.externals?.imdb||""),imdbConfirmed:false,show,ended,provisional:true
    };
  }

  async function verifiedSeasonData(showId,title,{imdbId="",year="",platform="",onProgress=null}={}){
    let resolvedShowId=String(showId||""),tvAvailable=false,episodeScheduleAvailable=false,show={},schedule=analyzeTVSchedule([],[],{},Date.now());
    const suppliedShowId=Boolean(resolvedShowId);
    if(!resolvedShowId){
      try{const match=await exactTVMazeShow(title,{imdbId,year,platform});if(match){resolvedShowId=String(match.id||"");show=match;}}catch(_){}
    }
    if(resolvedShowId){
      try{
        let snapshot=await fetchTVMazeSeasonSnapshot(resolvedShowId,show);
        if(suppliedShowId&&!tvMazeShowMatchesSelection(snapshot.show,title,{imdbId,year})){
          const match=await exactTVMazeShow(title,{imdbId,year,platform});
          if(!match||!tvMazeShowMatchesSelection(match,title,{imdbId,year})){
            snapshot=null;resolvedShowId="";
          }else if(String(match.id)!==resolvedShowId){
            resolvedShowId=String(match.id);
            snapshot=await fetchTVMazeSeasonSnapshot(resolvedShowId,match);
          }else snapshot={...snapshot,show:{...snapshot.show,...match,_embedded:snapshot.show?._embedded||match?._embedded}};
        }
        if(snapshot&&!tvMazeShowMatchesSelection(snapshot.show,title,{imdbId,year})){snapshot=null;resolvedShowId="";}
        if(snapshot){({tvAvailable,episodeScheduleAvailable,show,schedule}=snapshot);}
      }catch(e){console.warn("TVMaze episode verification unavailable",e);}
    }

    const tvHighest=schedule.highest,tvLatestAired=schedule.latestAired;
    const tvImdbId=String(show?.externals?.imdb||"");
    const expectedImdbId=String(imdbId||tvImdbId||"");
    if(tvAvailable&&typeof onProgress==="function"){
      try{onProgress(tvMazeSeasonResult(resolvedShowId,show,schedule,{imdbId:expectedImdbId,tvAvailable,episodeScheduleAvailable}));}
      catch(e){console.warn("TVMaze preview could not be displayed",e);}
    }
    const tvImdbIdentityConfirmed=Boolean(imdbId&&tvImdbId&&String(imdbId)===tvImdbId);
    const imdbPromise=tvImdbIdentityConfirmed
      ? Promise.resolve({available:true,confirmed:true,imdbId:expectedImdbId,match:null})
      : imdbSeriesCrossCheck(title,{imdbId:expectedImdbId,year:year||show?.premiered?.slice?.(0,4)||""}).catch(e=>{console.warn("IMDb series cross-check unavailable",e);return{available:false,confirmed:null,imdbId:expectedImdbId,match:null};});
    const imdb=await imdbPromise;

    const tvEnded=tvAvailable&&String(show?.status||"").toLowerCase()==="ended"&&!schedule.nextEpisode;
    const highest=tvHighest||null;
    const latestAired=tvAvailable?tvLatestAired:null;
    const currentEpisode=tvAvailable?schedule.currentEpisode:null;
    const known=new Set([...schedule.known].filter(n=>!tvEnded||!tvHighest||Number(n)<=tvHighest));
    let upcoming=!tvEnded&&schedule.upcomingSeason?{number:Number(schedule.upcomingSeason.number),premiereDate:schedule.upcomingSeason.premiereDate||schedule.nextEpisode?.airdate||null,source:"TVMaze",raw:schedule.upcomingSeason}:null;
    if(upcoming&&latestAired!==null&&upcoming.number<=latestAired)upcoming=null;
    if(upcoming){
      const endpointCheck=await imdbVerify(title,upcoming.number,upcoming.premiereDate||"");
      if(endpointCheck?.confirmed===false)upcoming=null;
      if(endpointCheck?.confirmed===true&&Number.isFinite(Number(endpointCheck.seasonNumber))&&Number(endpointCheck.seasonNumber)!==upcoming?.number)upcoming=null;
    }
    const sources=[];
    if(imdb?.confirmed===true)sources.push("IMDb");
    if(tvAvailable)sources.push("TVMaze");
    const resolvedImdbId=imdb?.imdbId||expectedImdbId||"";
    return {
      highest,latestAired,currentEpisode,latestEpisodeDate:episodeReleaseTimestamp(schedule.currentEpisodeRow),seriesReleaseDate:show?.premiered||"",completedSeasons:schedule.completedSeasons,upcoming,nextEpisode:schedule.nextEpisode,airing:schedule.airing,episodeImages:officialEpisodeImageMap(schedule.episodes,show?.image),episodeImagesSource:"TVMaze",seasonImages:officialSeasonImageMap(schedule.seasons),seasonImagesSource:"TVMaze",
      scheduledEpisodeReleases:schedule.episodes.filter(ep=>episodeAirTime(ep)>Date.now()-86400000).map(ep=>({season:ep.season,number:ep.number,raw:episodeReleaseTimestamp(ep)})),
      recurringWeeklySchedule:tvEnded?null:weeklyReleasePattern(schedule.episodes.map(ep=>({season:ep.season,number:ep.number,raw:episodeReleaseTimestamp(ep)})),show?.schedule?.days),
      episodeCounts:schedule.episodeCounts,airedEpisodeCounts:schedule.airedEpisodeCounts,releasedEpisodes:schedule.releasedEpisodes,known,sources,tvAvailable,episodeScheduleAvailable,
      resolvedShowId,imdbId:resolvedImdbId,imdbConfirmed:imdb?.confirmed===true,show,ended:tvEnded,provisional:false
    };
  }

  let episodeCountsForForm={},releasedEpisodesForForm={};
  function refreshEpisodeOptions(requestedEpisode=$("cur-ep").value){
    const season=Number($("cur-season").value||0),available=season?(releasedEpisodesForForm[season]||[]):[];
    const episodeInput=$("cur-ep"),requested=Number(requestedEpisode)||0;
    episodeInput.innerHTML='<option value="0">0 — None watched</option>'+available.map(n=>`<option value="${n}">Episode ${n}</option>`).join("");
    episodeInput.value=String(available.includes(requested)?requested:0);
    episodeInput.disabled=available.length===0;
  }

  function configureProgressOptions(result,progress={season:$("cur-season").value,episode:$("cur-ep").value}){
    const verifiedEpisodes=result?.episodeScheduleAvailable===true;
    episodeCountsForForm=result?.airedEpisodeCounts||{};
    const releases=result?.releasedEpisodes;
    releasedEpisodesForForm=normalizeReleasedEpisodeMap(releases&&Object.keys(releases).length?releases:Object.fromEntries(Object.entries(episodeCountsForForm).map(([season,count])=>[season,Array.from({length:Math.max(0,Number(count)||0)},(_,i)=>i+1)])));
    // Retain saved progress while an older record's episode schedule is loading.
    const savedSeason=Number(progress.season)||0,savedEpisode=Number(progress.episode)||0;
    if(!verifiedEpisodes&&savedSeason>0&&savedEpisode>0&&!releasedEpisodesForForm[savedSeason]?.length)releasedEpisodesForForm[savedSeason]=[savedEpisode];
    const highest=Number(result?.highest||0);
    const seasons=Object.keys(releasedEpisodesForForm).map(Number).filter(n=>n>0&&releasedEpisodesForForm[n].length).sort((a,b)=>a-b);
    const latestReleased=Math.max(0,...seasons);
    const fullyReleased=verifiedEpisodes?Math.min(latestReleased,Math.max(0,Number(result?.completedSeasons||0))):highest;
    const seasonSelect=$("cur-season");
    seasonSelect.innerHTML='<option value="0">0 — Not started</option>'+seasons.map(n=>`<option value="${n}">Season ${n}</option>`).join("");
    seasonSelect.value=String(seasons.includes(savedSeason)?savedSeason:0);
    if(verifiedEpisodes){
      $("watched-seasons").max=String(fullyReleased);
    }else if(highest){
      $("watched-seasons").max=String(highest);
    }else{
      $("watched-seasons").removeAttribute("max");
    }
    refreshEpisodeOptions(savedEpisode);
    if(!progressVerifyNote)return;
    if(result?.airing){
      const a=result.airing,next=a.nextEpisode;
      progressVerifyNote.textContent=`Season ${a.season} is airing • Episodes 1–${a.latestEpisode||0} available${next?` • Next is E${next.number}`:""}. Your watched progress remains editable.`;
    }else if(result?.latestAired){
      const count=result.episodeCounts?.[result.latestAired]||result.currentEpisode||0;
      progressVerifyNote.textContent=`Latest released season: ${result.latestAired}${count?` • ${count} known episodes`:""}. Your watched progress remains editable.`;
    }else if(result?.upcoming){
      progressVerifyNote.textContent=`No episodes have been released yet. Keep Current Season and Episode at 0 until Season ${result.upcoming.number} begins.`;
    }else progressVerifyNote.textContent="Choose a show to load its released seasons and episodes. New shows start at 0 watched.";
  }

  function clearAiringFields(){
    airingSection.style.display="none";
    $("airing-season").value="";$("latest-episode").value="";$("latest-episode-num").value="";$("latest-episode-title").value="";
    $("next-episode").value="";$("next-episode-num").value="";$("next-episode-title").value="";$("next-episode-date").value="";
  }

  function updateAiringFields(result){
    const airing=result?.airing;
    if(!airing){clearAiringFields();return;}
    airingSection.style.display="flex";
    const latestNumber=airing.latestEpisode||"";
    $("airing-season").value=String(airing.season||"");
    $("latest-episode-num").value=String(latestNumber);
    $("latest-episode-title").value=airing.latestEpisodeTitle||"";
    $("latest-episode").value=latestNumber?`Episode ${latestNumber}${airing.latestEpisodeTitle?` • ${airing.latestEpisodeTitle}`:""}`:"None released yet";
    const next=airing.nextEpisode;
    $("next-episode-num").value=next?.number?String(next.number):"";
    $("next-episode-title").value=next?.name||"";
    $("next-episode").value=next?.number?`Episode ${next.number}${next.name?` • ${next.name}`:""}`:"Date TBA";
    $("next-episode-date").value=episodeLocalInput(next);
    if(result?.provisional){airingNote.textContent="TVMaze episode schedule loaded. Cross-checking the remaining sources…";return;}
    const checked=result.imdbConfirmed?"Matched to IMDb; ":"";
    airingNote.textContent=`${checked}episode dates and season information checked with TVMaze.`;
  }

  function updateSeasonVerifyNote(result){
    if(!seasonVerifyNote)return;
    if(result?.provisional){
      const date=result.upcoming?.premiereDate?` Premiere: ${formatLocalDate(result.upcoming.premiereDate)}.`:"";
      seasonVerifyNote.textContent=result.upcoming
        ? `TVMaze confirms Season ${result.upcoming.number}.${date} Cross-checking IMDb…`
        : "TVMaze schedule loaded. Cross-checking IMDb…";
      return;
    }
    const checked=result?.imdbConfirmed?"IMDb identity matched. ":"";
    if(result?.upcoming){
      const date=result.upcoming.premiereDate?` Premiere: ${formatLocalDate(result.upcoming.premiereDate)}.`:" Premiere date has not been announced.";
      seasonVerifyNote.textContent=`${checked}Season ${result.upcoming.number} is announced.${date}`;
    }else seasonVerifyNote.textContent=`${checked}No later season announcement was confirmed by the available sources.`;
  }

  function applySeasonDataResult(r,{preserveProgress=false,remember=false}={}){
    if(r.resolvedShowId)$("tvmaze-id").value=r.resolvedShowId;
    if(r.imdbId)$("imdb-id").value=r.imdbId;
    updateSeasonVerifyNote(r);
    $("total-seasons").value=r.highest??"";
    let season=Number($("cur-season").value)||0,episode=Number($("cur-ep").value)||0;
    if(!preserveProgress){
      const hasReleasedSeason=Boolean(r.airing?.season||r.latestAired);
      season=0;episode=0;
      $("watched-seasons").value="0";
      if(!hasReleasedSeason&&r.upcoming)$("status").value="Planned";
    }else if(r.episodeScheduleAvailable){
      const completedMax=Math.max(0,Number(r.completedSeasons||0)),latestMax=Math.max(0,Number(r.latestAired||0));
      const savedWatched=Math.max(0,Number($("watched-seasons").value||0));
      const correctedWatched=Math.min(savedWatched,completedMax);
      if(savedWatched!==correctedWatched)$("watched-seasons").value=String(correctedWatched);
      let savedSeason=season;
      if(savedSeason>latestMax){
        season=0;episode=0;
      }else{
        const released=(r.releasedEpisodes?.[savedSeason]||Array.from({length:Math.max(0,Number(r.airedEpisodeCounts?.[savedSeason]||0))},(_,i)=>i+1)),requested=Number($("cur-ep").value||0);
        episode=Math.max(0,...released.filter(episode=>episode<=requested));
      }
    }
    configureProgressOptions(r,{season,episode});
    updateAiringFields(r);
    if(!r.upcoming){
      $("next-season-num").value="";$("next-season-date").value="";
      if(remember)rememberEditorVerification("Series",r);
      return r;
    }
    $("next-season-num").value=String(r.upcoming.number);
    if(r.nextEpisode&&Number(r.nextEpisode.season)===r.upcoming.number)$("next-season-date").value=episodeLocalInput(r.nextEpisode);
    else $("next-season-date").value=r.upcoming.premiereDate?dateOnlyInput(r.upcoming.premiereDate):"";
    if(remember)rememberEditorVerification("Series",r);
    return r;
  }

  async function fillSeasonData(showId,title,{preserveProgress=false,imdbId="",year="",platform="",shouldApply=()=>true}={}){
    const canApply=typeof shouldApply==="function"?shouldApply:()=>true;
    if(!preserveProgress&&canApply()){
      $("watched-seasons").value="0";
      configureProgressOptions({}, {season:0,episode:0});
    }
    let pending=null;
    const promise=verifiedSeasonData(showId,title,{
      imdbId,year,platform,
      onProgress:preview=>{
        if(pending){pending.resolvedShowId=String(preview.resolvedShowId||"");pending.resolvedImdbId=String(preview.imdbId||"");}
        if(!canApply())return;
        applySeasonDataResult(preview,{preserveProgress:true,remember:false});
      }
    });
    pending={type:"Series",title:normalizeTitle(title),imdbId:String(imdbId||""),showId:String(showId||""),resolvedImdbId:"",resolvedShowId:"",year:String(year||""),platform:normalizeTitle(platform),promise};
    editorVerificationInFlight=pending;
    try{
      const result=await promise;
      pending.resolvedShowId=String(result.resolvedShowId||pending.resolvedShowId||"");pending.resolvedImdbId=String(result.imdbId||pending.resolvedImdbId||"");
      if(canApply())applySeasonDataResult(result,{preserveProgress:true,remember:true});
      return result;
    }finally{
      if(editorVerificationInFlight===pending)editorVerificationInFlight=null;
    }
  }

  async function exactTVMazeShow(title,{imdbId="",year="",platform=""}={}){
    try{
      const rows=await searchTVMaze(title),norm=normalizeTitle(title),wantedPlatform=normalizeTitle(platform);
      let shows=(Array.isArray(rows)?rows:[]).map(item=>({id:item.tvmazeId||item.externalId,name:item.title,premiered:item.year?`${item.year}-01-01`:"",externals:{imdb:item.imdbId||""},network:item.platform?{name:item.platform}:null,webChannel:null,status:item.status||"",updated:item.updated||0}));
      if(imdbId){const exact=shows.find(show=>String(show?.externals?.imdb||"")===String(imdbId));if(exact)return exact;shows=shows.filter(show=>!show?.externals?.imdb);if(!shows.length)return null;}
      const candidates=shows.map(show=>{
        const candidateTitle=normalizeTitle(show.name||""),candidateImdb=String(show?.externals?.imdb||""),candidateYear=show.premiered?.slice?.(0,4)||"";
        const candidatePlatform=normalizeTitle(show.network?.name||show.webChannel?.name||"");
        let score=0;
        if(candidateTitle===norm)score+=2400;else if(candidateTitle.includes(norm)||norm.includes(candidateTitle))score+=1100;
        const wantedTokens=titleTokens(title),got=new Set(titleTokens(show.name||""));score+=wantedTokens.filter(token=>got.has(token)).length*140;
        if(imdbId&&candidateImdb===imdbId)score+=10000;else if(imdbId&&candidateImdb&&candidateImdb!==imdbId)score-=2200;
        if(year&&candidateYear===String(year))score+=900;else if(year&&candidateYear&&candidateYear!==String(year))score-=250;
        if(wantedPlatform&&candidatePlatform===wantedPlatform)score+=900;else if(wantedPlatform&&candidatePlatform&&(candidatePlatform.includes(wantedPlatform)||wantedPlatform.includes(candidatePlatform)))score+=500;
        if(String(show.status||"").toLowerCase()==="running")score+=220;
        if(show.updated&&Date.now()/1000-Number(show.updated)<366*24*60*60)score+=90;
        return{show,score};
      }).sort((a,b)=>b.score-a.score);
      return candidates[0]?.score>=700?candidates[0].show:null;
    }catch(_){return null;}
  }
  $("cur-season").addEventListener("change",()=>refreshEpisodeOptions(0));
  function isWeakFilmRecord(item){
    if(item?.type!=="Film")return false;
    const genericPlatform=["","film","movie"].includes(normalizeTitle(item.platform||""));
    return genericPlatform&&!item.imdbId&&!item.filmReleaseDate&&!item.releaseYear;
  }
  function migratePlannedStatuses(items){
    let changed=false;
    const rows=(Array.isArray(items)?items:[]).map(item=>{
      if(!item)return item;
      let row=item;
      if(row.status==="Saved"){
        row={...row,status:"Planned"};changed=true;
      }
      if(row.type!=="Film"&&(row.tvmazeShowId||row.imdbId)){
        const verifiedNext=Number(row.nextSeasonNum||0),premiereTime=row.nextSeasonDate?new Date(row.nextSeasonDate).getTime():0;
        const futureSeason=verifiedNext>0&&((Number.isFinite(premiereTime)&&premiereTime>Date.now())||(!premiereTime&&verifiedNext>Math.max(Number(row.curSeason||0),Number(row.airingSeason||0))));
        if(futureSeason&&Number(row.watchedSeasons||0)>=verifiedNext){
          const watchedSeasons=Math.max(0,verifiedNext-1);
          const repair={...row,watchedSeasons};
          if(Number(row.curSeason||0)>=verifiedNext){
            const curSeason=Math.min(watchedSeasons,verifiedNext-1);
            repair.curSeason=curSeason;
            repair.curEp=curSeason?Number(row.airedEpisodeCounts?.[curSeason]||row.episodeCounts?.[curSeason]||0):0;
          }
          row=repair;changed=true;
        }
        const storedTotal=Number(row.totalSeasons||0);
        const progressFloor=Math.max(Number(row.watchedSeasons||0),Number(row.curSeason||0),Number(row.airingSeason||0));
        if(verifiedNext>=progressFloor&&verifiedNext>0&&storedTotal>verifiedNext+1){
          row={...row,totalSeasons:Math.max(verifiedNext,progressFloor)};changed=true;
        }
      }
      const seasonTotal=knownSeasonTotal(row);
      if(row.type!=="Film"&&seasonTotal>Number(row.totalSeasons||0)){
        row={...row,totalSeasons:seasonTotal};changed=true;
      }
      if(row.autoPlanned){
        const restoredStatus=row.statusBeforeUpcoming==="Saved"?"Planned":(row.statusBeforeUpcoming||"Planned");
        row={...row,status:restoredStatus};delete row.autoPlanned;delete row.statusBeforeUpcoming;changed=true;
      }
      if(row.upcomingStatusOverride){
        row={...row};delete row.upcomingStatusOverride;changed=true;
      }
      return row;
    });
    return{rows,changed};
  }
  function cleanShadowTitleEntries(items){
    const rows=Array.isArray(items)?items:[];
    const verifiedSeriesTitles=new Set(rows.filter(item=>item?.type!=="Film"&&item?.title&&(item.tvmazeShowId||item.imdbId||item.totalSeasons||item.curSeason===0||item.curSeason)).map(item=>normalizeTitle(item.title)));
    return rows.filter(item=>!(isWeakFilmRecord(item)&&verifiedSeriesTitles.has(normalizeTitle(item.title))));
  }

  function normalizeTitle(value){
    return String(value||"")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{M}/gu,"")
      .replace(/&/g," and ")
      .replace(/[^\p{L}\p{N}]+/gu," ")
      .trim();
  }

  function canonicalRecordJSON(value){
    const normalize=input=>{
      if(Array.isArray(input))return input.map(normalize);
      if(input&&typeof input==="object")return Object.keys(input).sort().reduce((result,key)=>{if(input[key]!==undefined)result[key]=normalize(input[key]);return result;},{});
      return input;
    };
    return JSON.stringify(normalize(value));
  }

  function sameRecordWithoutUpdateTime(a,b){
    if(!a||!b)return false;
    const left={...a},right={...b};delete left.updatedAt;delete right.updatedAt;
    return canonicalRecordJSON(left)===canonicalRecordJSON(right);
  }

  function mediaIdentityKind(item){
    const type=String(item?.type||"Series").toLowerCase();
    if(type==="film")return"film";
    if(type==="game")return"game";
    return"series";
  }

  function identityReleaseYear(item){
    const explicit=String(item?.releaseYear||"").match(/\b(19|20)\d{2}\b/)?.[0];
    return explicit||String(item?.filmReleaseDate||"").match(/^(19|20)\d{2}/)?.[0]||"";
  }

  function itemsAreDuplicate(a,b){
    if(!a?.title||!b?.title||mediaIdentityKind(a)!==mediaIdentityKind(b))return false;
    const aImdb=String(a.imdbId||"").trim().toLowerCase(),bImdb=String(b.imdbId||"").trim().toLowerCase();
    if(aImdb&&bImdb)return aImdb===bImdb;
    if(mediaIdentityKind(a)==="series"){
      const aMaze=String(a.tvmazeShowId||"").trim(),bMaze=String(b.tvmazeShowId||"").trim();
      if(aMaze&&bMaze)return aMaze===bMaze;
    }
    if(normalizeTitle(a.title)!==normalizeTitle(b.title))return false;
    const aYear=identityReleaseYear(a),bYear=identityReleaseYear(b);
    if(aYear&&bYear&&aYear!==bYear)return false;
    return true;
  }

  function findTrackedDuplicate(candidate,items=mediaItems,ignoreId=""){
    return (Array.isArray(items)?items:[]).find(item=>String(item.id)!==String(ignoreId||"")&&itemsAreDuplicate(candidate,item))||null;
  }

  function mergeEpisodeCountMaps(a,b){
    const merged={...positiveEpisodeMap(a),...positiveEpisodeMap(b)};
    for(const [season,count] of Object.entries(positiveEpisodeMap(a)))merged[season]=Math.max(Number(merged[season]||0),Number(count||0));
    for(const [season,count] of Object.entries(positiveEpisodeMap(b)))merged[season]=Math.max(Number(merged[season]||0),Number(count||0));
    return merged;
  }

  function mergeEpisodeHistories(a,b){
    const events=[...(Array.isArray(a)?a:[]),...(Array.isArray(b)?b:[])],byKey=new Map();
    for(const event of events){
      if(!event)continue;
      const key=String(event.id||`${event.kind||"mark"}:${event.season||0}:${event.episode||0}:${event.watchedAt||""}`);
      const previous=byKey.get(key);
      if(!previous||toMillis(event.watchedAt)>=toMillis(previous.watchedAt))byKey.set(key,event);
    }
    return [...byKey.values()].sort((x,y)=>toMillis(x.watchedAt)-toMillis(y.watchedAt)).slice(-500);
  }

  function duplicateRecordQuality(item){
    let score=0;
    if(item?.imdbId)score+=20;if(item?.tvmazeShowId)score+=20;if(item?.releaseYear)score+=3;
    if(item?.filmReleaseDate)score+=8;if(item?.nextEpisodeNum||item?.nextSeasonNum)score+=8;
    score+=Object.keys(positiveEpisodeMap(item?.airedEpisodeCounts)).length*2;
    score+=Math.min(8,(Array.isArray(item?.episodeHistory)?item.episodeHistory.length:0));
    return score;
  }

  function mergeDuplicateItems(a,b){
    const aTime=toMillis(a.updatedAt||a.date),bTime=toMillis(b.updatedAt||b.date),recent=aTime>=bTime?a:b;
    const primary=duplicateRecordQuality(a)>duplicateRecordQuality(b)?a:duplicateRecordQuality(b)>duplicateRecordQuality(a)?b:recent;
    const secondary=primary===a?b:a,filled=(...values)=>values.find(value=>value!==null&&value!==undefined&&String(value).trim()!=="")??"";
    const episodeCounts=mergeEpisodeCountMaps(a.episodeCounts,b.episodeCounts),airedEpisodeCounts=mergeEpisodeCountMaps(a.airedEpisodeCounts,b.airedEpisodeCounts);
    const history=mergeEpisodeHistories(a.episodeHistory,b.episodeHistory);
    const statusRank={Saved:1,Planned:1,Watching:2,Watched:3};
    const status=(statusRank[a.status]||0)>(statusRank[b.status]||0)?a.status:(statusRank[b.status]||0)>(statusRank[a.status]||0)?b.status:(recent.status||"Planned");
    const aProgress=Number(a.curSeason||0)*10000+Number(a.curEp||0),bProgress=Number(b.curSeason||0)*10000+Number(b.curEp||0),progress=aProgress>=bProgress?a:b;
    const aUpcoming=upcomingSortInfo(a),bUpcoming=upcomingSortInfo(b);
    const upcoming=aUpcoming.rank>bUpcoming.rank?a:bUpcoming.rank>aUpcoming.rank?b:(aUpcoming.time<=bUpcoming.time?a:b);
    let merged={
      ...secondary,...primary,
      id:String(primary.id||secondary.id||uuid()),title:filled(primary.title,secondary.title),type:primary.type||secondary.type||"Series",status,
      imdbId:filled(primary.imdbId,secondary.imdbId),tvmazeShowId:filled(primary.tvmazeShowId,secondary.tvmazeShowId),releaseYear:filled(primary.releaseYear,secondary.releaseYear),
      platform:filled(recent.platform,primary.platform,secondary.platform),
      totalSeasons:mediaIdentityKind(primary)==="film"?null:Math.max(Number(a.totalSeasons||0),Number(b.totalSeasons||0))||null,
      watchedSeasons:mediaIdentityKind(primary)==="film"?null:Math.max(Number(a.watchedSeasons||0),Number(b.watchedSeasons||0)),
      curSeason:mediaIdentityKind(primary)==="film"?null:(Number(progress.curSeason||0)||null),curEp:mediaIdentityKind(primary)==="film"?null:(Number(progress.curEp||0)||null),
      episodeCounts,airedEpisodeCounts,episodeHistory:history,
      createdAt:[a.createdAt,b.createdAt].filter(Boolean).sort((x,y)=>toMillis(x)-toMillis(y))[0]||primary.createdAt||nowISO(),
      updatedAt:aTime>=bTime?(a.updatedAt||a.date||nowISO()):(b.updatedAt||b.date||nowISO()),
      date:watchedSortTime(a)>=watchedSortTime(b)?(a.date||b.date):(b.date||a.date),
      latestEpisodeDate:filled(recent.latestEpisodeDate,primary.latestEpisodeDate,secondary.latestEpisodeDate),seriesReleaseDate:filled(primary.seriesReleaseDate,secondary.seriesReleaseDate),
      nextEpisodeNum:upcoming.nextEpisodeNum??null,nextEpisodeTitle:upcoming.nextEpisodeTitle||"",nextEpisodeDate:upcoming.nextEpisodeDate||"",
      nextSeasonNum:upcoming.nextSeasonNum||"",nextSeasonDate:upcoming.nextSeasonDate||"",
      filmReleaseDate:filled(recent.filmReleaseDate,primary.filmReleaseDate,secondary.filmReleaseDate),
      filmReleaseSource:filled(recent.filmReleaseSource,primary.filmReleaseSource,secondary.filmReleaseSource)
    };
    if(isEpisodeTrackable(merged)){
      const combined={};
      for(const map of [watchedEpisodeMap(a,airedEpisodeCounts),watchedEpisodeMap(b,airedEpisodeCounts)])for(const [season,episodes] of Object.entries(map||{}))combined[season]=[...new Set([...(combined[season]||[]),...(episodes||[])])].sort((x,y)=>x-y);
      merged.watchedEpisodes=normalizeWatchedEpisodeMap(combined,airedEpisodeCounts);
      const highest=highestWatchedEpisode(merged.watchedEpisodes);
      if(highest&&highest.season*10000+highest.episode>Number(merged.curSeason||0)*10000+Number(merged.curEp||0)){merged.curSeason=highest.season;merged.curEp=highest.episode;}
      merged.watchedSeasons=Math.max(Number(merged.watchedSeasons||0),fullyWatchedSeasonCount(merged,merged.watchedEpisodes,airedEpisodeCounts));
      merged.lastWatchedSeason=highest?.season??merged.lastWatchedSeason??null;merged.lastWatchedEpisode=highest?.episode??merged.lastWatchedEpisode??null;
      merged.lastEpisodeWatchedAt=[a.lastEpisodeWatchedAt,b.lastEpisodeWatchedAt].filter(Boolean).sort((x,y)=>toMillis(y)-toMillis(x))[0]||"";
    }
    return migratePlannedStatuses([merged]).rows[0];
  }

  function deduplicateLibrary(items){
    const merged=[],removedTitles=[],byImdb=new Map(),byMaze=new Map(),byTitle=new Map();
    const addIndex=(map,key,index)=>{if(!key)return;const values=map.get(key)||new Set();values.add(index);map.set(key,values);};
    const indexKeys=(item,index)=>{
      const kind=mediaIdentityKind(item),imdb=String(item?.imdbId||"").trim().toLowerCase(),maze=kind==="series"?String(item?.tvmazeShowId||"").trim():"",title=normalizeTitle(item?.title);
      addIndex(byImdb,imdb?`${kind}:${imdb}`:"",index);addIndex(byMaze,maze?`${kind}:${maze}`:"",index);addIndex(byTitle,title?`${kind}:${title}`:"",index);
    };
    for(const raw of (Array.isArray(items)?items:[])){
      if(!raw?.title)continue;
      const kind=mediaIdentityKind(raw),imdb=String(raw.imdbId||"").trim().toLowerCase(),maze=kind==="series"?String(raw.tvmazeShowId||"").trim():"",title=normalizeTitle(raw.title),candidates=new Set();
      for(const set of [byImdb.get(imdb?`${kind}:${imdb}`:""),byMaze.get(maze?`${kind}:${maze}`:""),byTitle.get(title?`${kind}:${title}`:"")])for(const index of set||[])candidates.add(index);
      const index=[...candidates].find(candidate=>itemsAreDuplicate(merged[candidate],raw));
      if(index===undefined){const next=merged.length;merged.push(raw);indexKeys(raw,next);}
      else{removedTitles.push(raw.title||merged[index].title);merged[index]=mergeDuplicateItems(merged[index],raw);indexKeys(merged[index],index);}
    }
    return{items:merged,removedCount:removedTitles.length,titles:[...new Set(removedTitles.map(String))]};
  }

function strictWatchedEpisodeMap(value,counts){
  const result={};
  for(const [seasonValue,episodeValue] of Object.entries(value||{})){
    const season=Number(seasonValue),maximum=Math.max(0,Number(counts?.[season]||0));
    if(!Number.isInteger(season)||season<=0||maximum<=0)continue;
    const source=Array.isArray(episodeValue)?episodeValue:Object.entries(episodeValue||{}).filter(([,watched])=>Boolean(watched)).map(([episode])=>episode);
    const episodes=[...new Set(source.map(Number).filter(episode=>Number.isInteger(episode)&&episode>0&&episode<=maximum))].sort((a,b)=>a-b);
    if(episodes.length)result[season]=episodes;
  }
  return result;
}

function progressWatchedEpisodeMap(releases,watchedSeasons,curSeason,curEp){
  const result={};
  for(const [seasonValue,available] of Object.entries(normalizeReleasedEpisodeMap(releases))){
    const season=Number(seasonValue),episodes=season<=watchedSeasons?available:(season===curSeason?available.filter(episode=>episode<=curEp):[]);
    if(episodes.length)result[season]=episodes;
  }
  return result;
}

function sanitizeUnreleasedEpisodeProgress(item){
  if(!isEpisodeTrackable(item)||!item)return item;
  const aired=positiveEpisodeMap(item.airedEpisodeCounts),releases=releasedEpisodeMap(item);
  if(item.episodeScheduleVerified!==true)return item;
  const watchedEpisodes=normalizeWatchedEpisodeMap(Object.prototype.hasOwnProperty.call(item,"watchedEpisodes")?item.watchedEpisodes:legacyWatchedEpisodeMap({...item,episodeScheduleVerified:true},releases),releases);
  const highest=highestWatchedEpisode(watchedEpisodes);
  let curSeason=Math.max(0,Number(item.curSeason||0)),curEp=Math.max(0,Number(item.curEp||0));
  const currentAvailable=releases[curSeason]||[];
  if(curSeason>0&&currentAvailable.length)curEp=Math.max(0,...currentAvailable.filter(episode=>episode<=curEp));
  else if(curSeason>0){curSeason=highest?.season||0;curEp=highest?.episode||0;}
  if(curSeason===0)curEp=0;
  const episodeHistory=(Array.isArray(item.episodeHistory)?item.episodeHistory:[]).filter(event=>{
    const season=Number(event?.season),episode=Number(event?.episode);
    return Number.isInteger(season)&&season>0&&Number.isInteger(episode)&&episode>0&&(releases[season]||[]).includes(episode);
  });
  const completedCap=Number.isFinite(Number(item.verifiedCompletedSeasons))?Math.max(0,Number(item.verifiedCompletedSeasons)):Math.max(0,...Object.keys(aired).map(Number));
  const watchedSeasons=Math.min(Math.max(0,Number(item.watchedSeasons||0)),completedCap);
  return {...item,watchedEpisodes,episodeHistory,watchedSeasons,curSeason:curSeason||null,curEp:curEp||null,currentSeasonEpisodeCount:curSeason?(Number(aired[curSeason]||0)||null):null,lastWatchedSeason:highest?.season||null,lastWatchedEpisode:highest?.episode||null,lastEpisodeWatchedAt:highest?(item.lastEpisodeWatchedAt||""):""};
}

function cleanLibraryRecords(items){
  const rows=Array.isArray(items)?items:[],shadowCleaned=cleanShadowTitleEntries(rows),shadowRemoved=rows.filter(item=>!shadowCleaned.includes(item)).map(item=>item?.title).filter(Boolean);
  const deduplicated=deduplicateLibrary(shadowCleaned),sanitized=deduplicated.items.map(sanitizeUnreleasedEpisodeProgress);
  let repairedCount=0;
  for(let i=0;i<sanitized.length;i++)if(JSON.stringify(sanitized[i])!==JSON.stringify(deduplicated.items[i]))repairedCount++;
  return{items:sanitized,removedCount:shadowRemoved.length+deduplicated.removedCount,repairedCount,titles:[...new Set([...shadowRemoved,...deduplicated.titles])]};
}

function duplicateCleanupMessage(cleanup){
    if(!cleanup?.removedCount)return"";
    const names=cleanup.titles.slice(0,3).map(title=>`“${title}”`).join(", "),more=cleanup.titles.length>3?` and ${cleanup.titles.length-3} more`:"";
    return cleanup.removedCount===1?`Removed a duplicate copy of ${names}. Your tracked details were kept.`:`Removed ${cleanup.removedCount} duplicate entries${names?` for ${names}${more}`:""}. Their tracked details were merged.`;
  }

  const TITLE_SEARCH_STOP_WORDS=new Set(["the","a","an","and","of","for","to","in","on","with"]);
  const TITLE_SEARCH_CURRENT_YEAR=new Date().getFullYear();

  function titleTokens(value){
    return normalizeTitle(value).split(" ").filter(Boolean);
  }

  function levenshteinNormalized(a,b){
    if(a===b)return 0;
    if(!a.length)return b.length;
    if(!b.length)return a.length;
    const prev=Array.from({length:b.length+1},(_,i)=>i),cur=new Array(b.length+1);
    for(let i=1;i<=a.length;i++){
      cur[0]=i;
      for(let j=1;j<=b.length;j++){
        const cost=a[i-1]===b[j-1]?0:1;
        cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+cost);
      }
      for(let j=0;j<=b.length;j++)prev[j]=cur[j];
    }
    return prev[b.length];
  }

  function suggestionScore(item,query){
    const q=normalizeTitle(query),t=normalizeTitle(item.title);
    if(!q||!t)return 0;
    let score=0;
    if(t===q)score+=1600;
    else if(t.startsWith(q))score+=1100;
    else if(t.includes(q))score+=900;
    else if(q.includes(t))score+=650;

    const qTokens=q.split(" ").filter(Boolean),tTokens=t.split(" ").filter(Boolean),tSet=new Set(tTokens);
    const matched=qTokens.filter(token=>tSet.has(token)).length;
    score+=matched*120;
    if(qTokens.length&&matched===qTokens.length)score+=260;

    const meaningful=qTokens.filter(x=>!TITLE_SEARCH_STOP_WORDS.has(x));
    const meaningfulMatched=meaningful.filter(token=>tSet.has(token)).length;
    score+=meaningfulMatched*85;
    if(meaningful.length&&meaningfulMatched===meaningful.length)score+=220;

    const maxLen=Math.max(q.length,t.length);
    /* A length gap larger than 45% cannot reach the lowest similarity bonus,
       so avoid allocating the edit-distance matrix in that case. */
    if(maxLen&&1-Math.abs(q.length-t.length)/maxLen>=.55){
      const distance=levenshteinNormalized(q,t);
      const similarity=1-(distance/maxLen);
      if(similarity>=.85)score+=500;
      else if(similarity>=.7)score+=260;
      else if(similarity>=.55)score+=100;
    }

    const year=Number(item.year||0);
    if(year===TITLE_SEARCH_CURRENT_YEAR)score+=140;
    else if(year===TITLE_SEARCH_CURRENT_YEAR-1||year===TITLE_SEARCH_CURRENT_YEAR+1)score+=80;

    /* Apple is the authoritative film catalogue in this build. */
    if(item.source==="apple")score+=item.format==="Film"?260:60;
    if(item.source==="imdb")score+=110;
    if(item.source==="tvmaze")score+=item.format==="Series"?150:20;
    if(item.format==="Series"&&String(item.status||"").toLowerCase()==="running")score+=220;
    if(item.imdbId)score+=70;
    if(item.updated&&Date.now()/1000-Number(item.updated)<366*24*60*60)score+=80;
    return score;
  }

  const titleSearchCache=new Map();
  const titleSearchInFlight=new Map();
  const titleSourceSearchInFlight=new Map();
  const TITLE_SEARCH_CACHE_TTL_MS=10*60*1000;
  const TITLE_SEARCH_EMPTY_TTL_MS=60*1000;
  function cacheGetSearch(key){
    const v=titleSearchCache.get(key);
    if(!v)return null;
    if(Date.now()-v.time>(v.ttl||TITLE_SEARCH_CACHE_TTL_MS)){titleSearchCache.delete(key);return null;}
    titleSearchCache.delete(key);titleSearchCache.set(key,v);
    return v.value;
  }
  function cacheSetSearch(key,value,ttl=TITLE_SEARCH_CACHE_TTL_MS){
    titleSearchCache.delete(key);titleSearchCache.set(key,{time:Date.now(),ttl,value});
    if(titleSearchCache.size>80){
      const first=titleSearchCache.keys().next().value;
      titleSearchCache.delete(first);
    }
    return value;
  }
  function cancelledTitleSearch(){
    const error=new Error("Search cancelled");error.name="AbortError";error.code="cancelled";return error;
  }
  function checkTitleSearchSignal(signal){
    if(signal?.aborted)throw cancelledTitleSearch();
  }
  function runSharedTitleSearch(inFlight,key,task,signal=null,onProgress=null){
    if(signal?.aborted)return Promise.reject(cancelledTitleSearch());
    let entry=inFlight.get(key);
    if(!entry||entry.controller.signal.aborted){
      entry={controller:new AbortController(),consumers:new Set(),latest:null,promise:null};
      const current=entry;
      current.remove=()=>{if(inFlight.get(key)===current)inFlight.delete(key);};
      const publish=items=>{
        if(current.controller.signal.aborted||!items.length)return;
        current.latest=items;
        for(const consumer of current.consumers)try{consumer.onProgress?.(items);}catch(_){}
      };
      current.promise=Promise.resolve().then(()=>{
        checkTitleSearchSignal(current.controller.signal);
        return task(current.controller.signal,publish);
      }).finally(current.remove);
      inFlight.set(key,current);
    }
    const current=entry;
    return new Promise((resolve,reject)=>{
      const consumer={onProgress};let settled=false;
      const finish=(complete,value)=>{
        if(settled)return;settled=true;
        signal?.removeEventListener("abort",cancel);current.consumers.delete(consumer);complete(value);
      };
      const cancel=()=>{
        finish(reject,cancelledTitleSearch());
        if(!current.consumers.size){current.controller.abort();current.remove();}
      };
      current.consumers.add(consumer);
      signal?.addEventListener("abort",cancel,{once:true});
      current.promise.then(value=>finish(resolve,value),error=>finish(reject,error));
      if(current.latest)try{onProgress?.(current.latest);}catch(_){}
    });
  }
  function runSourceTitleSearch(key,task,signal=null){
    return runSharedTitleSearch(titleSourceSearchInFlight,key,task,signal);
  }

  function searchCatalogBatch(query,country="gb",signal=null){
    checkTitleSearchSignal(signal);
    const normalized=normalizeTitle(query),region=String(country||"gb").toLowerCase();
    const key=`catalog:${region}:${normalized}`;
    const cached=cacheGetSearch(key);if(cached)return cached;
    if(normalized.length<2)return[];
    return runSourceTitleSearch(key,async requestSignal=>{
      const result=await pinApi("catalog_search",{query:String(query||"").trim(),country:region},cloudSessionToken,"",requestSignal);
      checkTitleSearchSignal(requestSignal);
      const rows=Array.isArray(result?.results)?result.results:[];
      return cacheSetSearch(key,rows,rows.length?TITLE_SEARCH_CACHE_TTL_MS:TITLE_SEARCH_EMPTY_TTL_MS);
    },signal);
  }

  function searchTVMaze(query,signal=null){
    checkTitleSearchSignal(signal);
    const key=`tvmaze:${normalizeTitle(query)}`;
    const cached=cacheGetSearch(key);if(cached)return cached;
    return runSourceTitleSearch(key,async requestSignal=>{
      const rows=await searchCatalogBatch(query,"gb",requestSignal);
      checkTitleSearchSignal(requestSignal);
      const matches=(Array.isArray(rows)?rows:[]).filter(item=>item?.source==="tvmaze"&&item.title);
      return cacheSetSearch(key,matches,matches.length?TITLE_SEARCH_CACHE_TTL_MS:TITLE_SEARCH_EMPTY_TTL_MS);
    },signal);
  }

  function searchAppleMoviesOne(query,country,signal=null){
    checkTitleSearchSignal(signal);
    const normalized=normalizeTitle(query);
    const key=`apple:${country}:${normalized}`;
    const cached=cacheGetSearch(key);if(cached)return cached;
    if(normalized.length<2)return[];
    return runSourceTitleSearch(key,async requestSignal=>{
      const rows=await searchCatalogBatch(query,country,requestSignal);
      checkTitleSearchSignal(requestSignal);
      const matches=(Array.isArray(rows)?rows:[]).filter(item=>item?.source==="apple"&&item.title);
      return cacheSetSearch(key,matches,matches.length?TITLE_SEARCH_CACHE_TTL_MS:TITLE_SEARCH_EMPTY_TTL_MS);
    },signal);
  }

  function correctedCatalogueQuery(query){
    let q=normalizeTitle(query);
    q=q.replace(/\bmandolorian\b/g,"mandalorian");
    if(/\bmandalorian\b/.test(q))q=q.replace(/\bgorge\b/g,"grogu");
    q=q.replace(/\bsuper girl\b/g,"supergirl");
    if(/\bmandalorian\b|\bstar wars\b/.test(q))q=q.replace(/\b(gorge|gorgu|grogoo|grogou)\b/g,"grogu");
    return q;
  }

  function movieQueryVariants(query){
    const corrected=correctedCatalogueQuery(query);
    const tokens=titleTokens(corrected);
    const stop=new Set(["the","a","an","and","of","for","to","in","on","with"]);
    const strong=tokens.filter(t=>!stop.has(t)&&t.length>=3).join(" ");
    const variants=[corrected];
    if(strong&&strong!==corrected)variants.push(strong);

    /* Franchise-aware expansion. This is query expansion only: returned titles
       still have to come from one of the external catalogues. */
    if(tokens.includes("mandalorian")||tokens.includes("grogu")){
      variants.unshift("Star Wars The Mandalorian and Grogu");
      variants.push("The Mandalorian and Grogu");
      variants.push("Mandalorian Grogu");
      variants.push("Grogu");
    }
    return Array.from(new Set(variants.map(v=>String(v||"").trim()).filter(v=>v.length>=2))).slice(0,6);
  }

  function hasStrongMovieMatch(items,query){
    const q=normalizeTitle(query);
    const qTokens=titleTokens(q).filter(t=>!["the","a","an","and","of","for","to","in","on","with"].includes(t));
    return items.some(item=>{
      if(item.format!=="Film")return false;
      const t=normalizeTitle(item.title),set=new Set(titleTokens(t));
      if(t===q||t.includes(q)||q.includes(t))return true;
      if(qTokens.length&&qTokens.every(token=>set.has(token)))return true;
      return suggestionScore(item,q)>=1150;
    });
  }

  async function searchAppleMovies(query){
    const variants=movieQueryVariants(query);
    const exact=variants[0]||query,merged=[];
    merged.push(...await searchAppleMoviesOne(exact,"gb"));
    if(hasStrongMovieMatch(merged,query))return merged;
    const expanded=await Promise.allSettled([
      searchAppleMoviesOne(exact,"us"),
      ...(variants[1]?[searchAppleMoviesOne(variants[1],"gb")]:[])
    ]);
    merged.push(...expanded.flatMap(r=>r.status==="fulfilled"?r.value:[]));
    return merged;
  }

  function searchIMDbOne(query,signal=null){
    checkTitleSearchSignal(signal);
    const normalized=normalizeTitle(query);
    const key=`imdb:${normalized}`;
    const cached=cacheGetSearch(key);if(cached)return cached;
    if(normalized.length<2)return[];
    return runSourceTitleSearch(key,async requestSignal=>{
      const rows=await searchCatalogBatch(query,"gb",requestSignal);
      checkTitleSearchSignal(requestSignal);
      const matches=(Array.isArray(rows)?rows:[]).filter(item=>item?.source==="imdb"&&item.title);
      return cacheSetSearch(key,matches,matches.length?TITLE_SEARCH_CACHE_TTL_MS:TITLE_SEARCH_EMPTY_TTL_MS);
    },signal);
  }

  async function searchIMDbTitles(query){
    const variants=movieQueryVariants(query);
    const first=await searchIMDbOne(variants[0]||query);
    if(hasStrongMovieMatch(first,query))return first;
    const searches=await Promise.allSettled(variants.slice(1,2).map(variant=>searchIMDbOne(variant)));
    return first.concat(searches.flatMap(r=>r.status==="fulfilled"?r.value:[]));
  }
  function bestIMDbSeriesMatch(rows,title,{imdbId="",year=""}={}){
    const series=(rows||[]).filter(item=>item?.format==="Series"&&item.title);
    if(!series.length)return null;
    if(imdbId){const byId=series.find(item=>item.imdbId===imdbId||item.externalId===imdbId);if(byId)return byId;}
    const normalized=normalizeTitle(title);
    const exact=series.filter(item=>normalizeTitle(item.title)===normalized);
    const pool=exact.length?exact:series;
    return pool.sort((a,b)=>{
      let as=suggestionScore(a,title),bs=suggestionScore(b,title);
      if(year&&String(a.year)===String(year))as+=600;
      if(year&&String(b.year)===String(year))bs+=600;
      return bs-as;
    })[0]||null;
  }

  async function imdbSeriesCrossCheck(title,{imdbId="",year=""}={}){
    const rows=await searchIMDbOne(title);
    const match=bestIMDbSeriesMatch(rows,title,{imdbId,year});
    if(!match)return{available:Boolean(rows.length),confirmed:null,imdbId:imdbId||"",match:null};
    const matchedId=match.imdbId||match.externalId||"";
    const exactTitle=normalizeTitle(match.title)===normalizeTitle(title);
    const yearMatches=!year||!match.year||String(match.year)===String(year);
    const confirmed=imdbId?matchedId===imdbId:(exactTitle&&yearMatches);
    return{available:true,confirmed:confirmed?true:null,imdbId:confirmed?matchedId:(imdbId||matchedId),match};
  }

  function isFutureDateOnly(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||"")))return false;
    const t=new Date(`${value}T23:59:59`).getTime();
    return Number.isFinite(t)&&t>Date.now();
  }

  function bestIMDbFilmMatch(rows,title,imdbId=""){
    const films=(rows||[]).filter(x=>x?.format==="Film"&&x.title);
    if(imdbId){const byId=films.find(x=>x.externalId===imdbId);if(byId)return byId;}
    const exact=films.filter(x=>normalizeTitle(x.title)===normalizeTitle(title));
    const pool=exact.length?exact:films;
    return pool.sort((a,b)=>suggestionScore(b,title)-suggestionScore(a,title)||Number(b.year||0)-Number(a.year||0))[0]||null;
  }

  function bestAppleFilmMatch(rows,title,expectedYear=""){
    const films=(rows||[]).filter(x=>x?.format==="Film"&&x.title);
    const exact=films.filter(x=>normalizeTitle(x.title)===normalizeTitle(title));
    const pool=exact.length?exact:films;
    pool.sort((a,b)=>{
      let as=suggestionScore(a,title),bs=suggestionScore(b,title);
      if(expectedYear&&String(a.year)===String(expectedYear))as+=500;
      if(expectedYear&&String(b.year)===String(expectedYear))bs+=500;
      if(a.country==="GB")as+=30;if(b.country==="GB")bs+=30;
      return bs-as;
    });
    return pool[0]||null;
  }

  async function verifiedFilmReleaseData(title,{imdbId="",seedDate="",seedSource=""}={}){
    const [imdbResult,appleResult]=await Promise.allSettled([searchIMDbTitles(title),searchAppleMovies(title)]);
    const imdbRows=imdbResult.status==="fulfilled"?imdbResult.value:[];
    const appleRows=appleResult.status==="fulfilled"?appleResult.value:[];
    const imdbMatch=bestIMDbFilmMatch(imdbRows,title,imdbId);
    const resolvedImdbId=imdbId||imdbMatch?.externalId||"";
    const expectedYear=imdbMatch?.year||"";
    const appleMatch=bestAppleFilmMatch(appleRows,title,expectedYear);

    const appleDate=isFutureDateOnly(appleMatch?.releaseDate)?appleMatch.releaseDate:"";
    const seedFuture=isFutureDateOnly(seedDate)?seedDate:"";
    const sources=[];
    if(imdbMatch)sources.push("IMDb");
    if(appleMatch)sources.push("Apple Movies");

    const records=[
      appleDate?{date:appleDate,source:"Apple Movies",priority:30}:null,
      seedFuture?{date:seedFuture,source:seedSource||"Film catalogue",priority:10}:null
    ].filter(Boolean);
    const grouped=new Map();
    for(const record of records){
      const group=grouped.get(record.date)||{date:record.date,records:[],priority:0};
      group.records.push(record);
      group.priority=Math.max(group.priority,record.priority);
      grouped.set(record.date,group);
    }
    const ranked=Array.from(grouped.values()).sort((a,b)=>b.records.length-a.records.length||b.priority-a.priority||a.date.localeCompare(b.date));
    const winner=ranked[0];
    const date=winner?.date||"";
    let source=winner?Array.from(new Set(winner.records.map(record=>record.source))).join(" + "):"";
    const conflict=ranked.length>1;

    return {
      date,
      source,
      sources:Array.from(new Set(sources)),
      imdbId:resolvedImdbId||"",
      year:expectedYear,
      conflict,
      appleDate
    };
  }

