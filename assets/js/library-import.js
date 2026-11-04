/* Trakt exports are read locally. Importing is an explicit, previewed merge. */
(function(root){
  function csvRows(text){
    const rows=[];let row=[],field='',quoted=false;
    for(let i=0;i<text.length;i++){
      const char=text[i];
      if(char==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
      else if(!quoted&&(char===','||char==='\n')){row.push(field);field='';if(char==='\n'){rows.push(row);row=[];}}
      else if(char!=='\r')field+=char;
    }
    if(quoted)throw Error('The CSV has an unfinished quoted field.');
    if(field||row.length){row.push(field);rows.push(row);}
    const headers=(rows.shift()||[]).map(value=>value.replace(/^\uFEFF/,'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_'));
    return rows.filter(row=>row.some(Boolean)).map(row=>Object.fromEntries(headers.map((name,index)=>[name,row[index]||''])));
  }
  function rowsFrom(value,label='',depth=0){
    if(depth>8)throw Error('The export is nested too deeply.');
    if(Array.isArray(value))return value.map(row=>({row,label}));
    if(!value||typeof value!=='object')throw Error('This is not a Trakt export.');
    const rows=[];
    for(const [name,entries]of Object.entries(value)){
      if(Array.isArray(entries))rows.push(...rowsFrom(entries,label+' '+name,depth+1));
      else if(entries&&typeof entries==='object'&&!['ids','user'].includes(name)){
        try{rows.push(...rowsFrom(entries,label+' '+name,depth+1));}catch(error){if(/deeply/.test(error.message))throw error;}
      }
    }
    if(!rows.length)throw Error('No titles were found in this Trakt export.');
    return rows;
  }
  function parse(text,filename='export.json'){
    const input=/\.csv$/i.test(filename)?csvRows(text):JSON.parse(text);
    const groups=new Map();let skipped=0;
    for(const {row,label}of rowsFrom(input,filename)){
      const series=row.show&&typeof row.show==="object"?row.show:row.series&&typeof row.series==="object"?row.series:null,film=row.movie&&typeof row.movie==="object"?row.movie:null;
      const kind=series?'Series':film?'Film':/episode|show|series/i.test(row.type||row.media_type||label)?'Series':'Film';
      const titleRow=series||film||row;
      const title=String(row.show_title||(typeof row.show==='string'?row.show:'')||row.movie_title||titleRow.title||'').trim();
      const ids=titleRow.ids||{},imdb=String(ids.imdb||row.imdb_id||row.imdb||''),tvdb=Number(ids.tvdb||row.tvdb_id||0),trakt=Number(ids.trakt||row.trakt_id||0);
      const year=String(titleRow.year||row.year||'').slice(0,4);
      if(!title||title.length>300){skipped++;continue;}
      const key=kind+':'+(imdb||tvdb||trakt||title.toLowerCase()+':'+year);
      let item=groups.get(key);
      if(!item){item={id:'trakt:'+key,title,type:kind,status:'Planned',imdbId:/^tt\d{5,12}$/.test(imdb)?imdb:'',tvdbId:tvdb||null,traktId:trakt||null,releaseYear:year,createdAt:row.listed_at||row.collected_at||new Date().toISOString(),watchedEpisodes:{},episodeHistory:[],lists:[]};groups.set(key,item);}
      const date=row.watched_at||row.last_watched_at||row.completed_at||'';
      const mark=(season,episode,watchedAt)=>{
        season=Number(season);episode=Number(episode);
        if(!Number.isInteger(season)||season<1||!Number.isInteger(episode)||episode<1)return;
        const numbers=item.watchedEpisodes[season]||(item.watchedEpisodes[season]=[]);
        if(!numbers.includes(episode)){numbers.push(episode);item.episodeHistory.push({id:'trakt:'+season+':'+episode+':'+watchedAt,season,episode,kind:'mark',watchedAt:watchedAt||date||''});}
        item.status='Watching';
        if(Date.parse(watchedAt)>Date.parse(item.lastEpisodeWatchedAt||'1970-01-01'))item.lastEpisodeWatchedAt=watchedAt;
      };
      if(kind==='Series'){
        if(row.episode)mark(row.episode.season,row.episode.number,date);
        if(row.season||row.season_number)mark(row.season||row.season_number,row.episode_number||row.number||(typeof row.episode!=='object'?row.episode:0),date);
        for(const season of row.seasons||[])for(const episode of season.episodes||[])if(episode.plays===undefined||Number(episode.plays)>0)mark(season.number,episode.number,episode.last_watched_at||date);
      }else if(date||Number(row.plays)>0||/watched|history/i.test(label)){item.status='Watched';item.date=date.slice(0,10);}
      if(row.list?.name)item.lists.push(String(row.list.name).slice(0,40));
    }
    if(!groups.size)throw Error('No supported shows or films were found.');
    return {items:[...groups.values()],skipped};
  }
  async function readFiles(files){
    const exports=[];
    let expandedTotal=0;
    for(const file of files){
      if(!/\.zip$/i.test(file.name)){exports.push(file);continue;}
      const buffer=await file.arrayBuffer(),view=new DataView(buffer);
      let end=view.byteLength-22;
      while(end>=Math.max(0,view.byteLength-65557)&&view.getUint32(end,true)!==0x06054b50)end--;
      if(end<0||end<view.byteLength-65557)throw Error('This ZIP export could not be read.');
      const entries=view.getUint16(end+10,true),directory=view.getUint32(end+16,true);
      if(entries>10000)throw Error('This archive contains too many files.');
      let offset=directory;
      for(let index=0;index<entries;index++){
        if(offset+46>view.byteLength||view.getUint32(offset,true)!==0x02014b50)throw Error('This ZIP export is incomplete.');
        const flags=view.getUint16(offset+8,true),method=view.getUint16(offset+10,true),compressed=view.getUint32(offset+20,true),expanded=view.getUint32(offset+24,true),nameLength=view.getUint16(offset+28,true),extraLength=view.getUint16(offset+30,true),commentLength=view.getUint16(offset+32,true),local=view.getUint32(offset+42,true);
        const name=new TextDecoder().decode(new Uint8Array(buffer,offset+46,nameLength));
        offset+=46+nameLength+extraLength+commentLength;
        if(!/\.(json|csv)$/i.test(name)||name.includes('__MACOSX'))continue;
        if(flags&1)throw Error('Use a ZIP export without a password.');
        if(expanded>20*1024*1024||expandedTotal+expanded>50*1024*1024)throw Error('The uncompressed export is too large.');
        if(local+30>view.byteLength||view.getUint32(local,true)!==0x04034b50)throw Error('The ZIP export is incomplete.');
        const start=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true);
        if(start+compressed>view.byteLength)throw Error('The ZIP export is incomplete.');
        const bytes=new Uint8Array(buffer,start,compressed);
        let content;
        if(method===0)content=bytes;
        else if(method===8){
          if(typeof DecompressionStream==='undefined')throw Error('Unzip this export and choose its JSON or CSV files.');
          const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
          const chunks=[];let size=0;
          while(true){
            const next=await reader.read();if(next.done)break;
            size+=next.value.length;
            if(size>20*1024*1024||expandedTotal+size>50*1024*1024){await reader.cancel();throw Error('The uncompressed export is too large.');}
            chunks.push(next.value);
          }
          content=new Uint8Array(size);let cursor=0;for(const chunk of chunks){content.set(chunk,cursor);cursor+=chunk.length;}
        }else throw Error('Unzip this export and choose its JSON or CSV files.');
        if(content.length!==expanded)throw Error('This ZIP export is incomplete.');
        expandedTotal+=content.length;
        const value=new TextDecoder().decode(content).replace(/^\uFEFF/,'');
        exports.push({name,size:content.length,text:async()=>value});
      }
    }
    if(!exports.length)throw Error('No JSON or CSV files were found in this export.');
    return exports;
  }
  root.WatchLogTrakt={parse,readFiles};

  if(typeof document==='undefined')return;
  const dialog=document.createElement('dialog');dialog.className='changelog-dialog feature-dialog';dialog.dataset.blockRefresh='';dialog.setAttribute('aria-label','Import Trakt history');
  dialog.innerHTML='<header class="changelog-heading"><h2>Import Trakt history</h2><button class="close-btn" data-trakt-cancel aria-label="Cancel import">×</button></header><div class="changelog-body"><p data-trakt-summary></p><div data-trakt-preview></div><p data-trakt-status role="status"></p><button class="btn btn-primary btn-full" data-trakt-confirm>Import titles and watched history</button></div>';
  document.body.append(dialog);
  let pending=[],owner='';
  root.WatchLogTrakt.previewFiles=async files=>{
    try{
      if(files.reduce((total,file)=>total+file.size,0)>20*1024*1024)throw Error('Choose export files totalling under 20 MB.');
      pending=[];owner=String(currentUser?.id||'');
      for(const file of await readFiles(files)){
        try{pending.push(...parse(await file.text(),file.name).items);}
        catch(error){if(!/No titles|No supported|not a Trakt export/.test(error.message))throw error;}
      }
      if(!pending.length)throw Error('No supported shows or films were found in these exports.');
      if(!pending.length)return;
      pending=deduplicateLibrary(pending).items;
      dialog.querySelector('[data-trakt-summary]').textContent=pending.length+' titles found. Existing watch progress is merged, and matching titles are kept together.';
      dialog.querySelector('[data-trakt-preview]').textContent=pending.slice(0,12).map(item=>item.title+' · '+item.type).join(' • ');
      dialog.querySelector('[data-trakt-status]').textContent='';
      dialog.showModal();
    }catch(error){$('library-backup-status').textContent=error.message;}
  };
  dialog.querySelector('[data-trakt-cancel]').onclick=()=>dialog.close();
  dialog.querySelector('[data-trakt-confirm]').onclick=async event=>{
    const button=event.currentTarget;button.disabled=true;
    const before=cloneLibrarySnapshot(mediaItems);
    try{
      if(!currentUser||String(currentUser.id)!==owner)throw Error('Sign in to the account that started this import.');
      // Match identity before merging so imported rows never replace saved IDs.
      const merged=cloneLibrarySnapshot(mediaItems);
      for(const item of pending){
        const index=merged.findIndex(saved=>saved.type===item.type&&((saved.imdbId&&saved.imdbId===item.imdbId)||(saved.traktId&&saved.traktId===item.traktId)||(saved.tvdbId&&saved.tvdbId===item.tvdbId)||((!saved.imdbId||!item.imdbId||saved.imdbId===item.imdbId)&&normalizeTitle(saved.title)===normalizeTitle(item.title)&&(!saved.releaseYear||!item.releaseYear||String(saved.releaseYear)===item.releaseYear))));
        if(index<0){merged.push(item);continue;}
        const saved=merged[index],watched=mergeEpisodeSetChanges({},item.watchedEpisodes,saved.watchedEpisodes);
        merged[index]={...item,...saved,watchedEpisodes:watched,episodeHistory:mergeEpisodeHistory([],item.episodeHistory,saved.episodeHistory),status:Object.keys(watched).length?'Watching':saved.status==='Watched'||item.status==='Watched'?'Watched':saved.status};
      }
      mediaItems=deduplicateLibrary(merged).items;
      await persistLibrary(mediaItems,{background:true,precleaned:true});
      render();dialog.close();$('library-backup-status').textContent='Imported '+pending.length+' titles and merged watched history. Changes are saved on this device and queued to sync.';
      pending=[];
    }catch(error){mediaItems=before;render();dialog.querySelector('[data-trakt-status]').textContent=error.message||'Import could not be saved. Retry when storage is available.';}
    finally{button.disabled=false;}
  };
  dialog.addEventListener('close',()=>{pending=[];setTimeout(applyPendingAppUpdate,0);});
})(typeof window==='undefined'?globalThis:window);
