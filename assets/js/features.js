/* Library organisation, Continue Watching, offline readiness and recovery. */
let libraryScope='',featureAccount='',continueExpanded=false;
function collectionNames(){return [...new Set(mediaItems.flatMap(item=>Array.isArray(item.lists)?item.lists:[]))].filter(name=>typeof name==='string'&&name.trim()).sort((a,b)=>titleCollator.compare(a,b));}
function libraryScopeIncludes(item){
  if(libraryScope==='archived')return item.archived===true;
  if(item.archived===true)return false;
  if(libraryScope==='favourites')return item.favorite===true;
  if(libraryScope.startsWith('list:'))return (item.lists||[]).includes(libraryScope.slice(5));
  return true;
}
async function saveTitleOrganisation(id,patch){
  const index=mediaItems.findIndex(item=>String(item.id)===String(id));if(index<0)return false;
  const previous=mediaItems[index],updated={...previous,...patch,updatedAt:nowISO()};
  mediaItems[index]=updated;
  try{await persistLibrary(mediaItems,{background:true,precleaned:true});render();return true;}
  catch(error){const currentIndex=mediaItems.findIndex(item=>String(item.id)===String(id));if(currentIndex>=0&&mediaItems[currentIndex]===updated)mediaItems[currentIndex]=previous;render();showAppToast('This change could not be saved. Please retry.','warn');return false;}
}
function renderLibraryFeatures(){
  const account=String(currentUser?.id||'');
  if(featureAccount!==account){featureAccount=account;libraryScope='';continueExpanded=false;}
  const toolbar=$('library-collections'),root=$('continue-watching');if(!toolbar||!root)return;
  const visible=Boolean(currentUser&&currentTab==='library');toolbar.classList.toggle('hidden',!visible);
  root.classList.toggle('hidden',!visible||categoryControlsVisible()||Boolean(searchQuery.trim()));
  if(!visible)return;
  const options=[['','All titles'],['favourites','Favourites'],['archived','Archived'],...collectionNames().map(name=>['list:'+name,name])];
  if(!options.some(([value])=>value===libraryScope))libraryScope='';
  const select=$('library-collection-select'),markup=options.map(([value,label])=>`<option value="${esc(value)}">${esc(label)}</option>`).join('');
  if(select._options!==markup){select.innerHTML=markup;select._options=markup;}select.value=libraryScope;
  const rows=mediaItems.filter(item=>libraryScopeIncludes(item)&&item.archived!==true&&isEpisodeTrackable(item)).flatMap(item=>{
    const releases=releasedEpisodeMap(item),watched=watchedEpisodeMap(item,releases),next=nextWatchEpisode(item,releases,watched);
    return next&&(item.status==='Watching'||Object.values(watched).some(episodes=>episodes.length))?[{item,next}]:[];
  }).sort((a,b)=>toMillis(b.item.lastEpisodeWatchedAt)-toMillis(a.item.lastEpisodeWatchedAt)||titleCollator.compare(a.item.title,b.item.title));
  const shown=continueExpanded?rows:rows.slice(0,8);
  updateDashboardMarkup(root,rows.length?`<section class="dashboard-section"><h2>Continue Watching</h2><div class="continue-list">${shown.map(({item,next})=>`<article class="continue-row"><button type="button" class="continue-open" data-continue-open="${esc(item.id)}"><strong>${esc(item.title)}</strong><span>Next · S${next.season} E${next.episode}</span></button><button type="button" class="episode-quick-button" data-continue-mark="${esc(item.id)}" data-season="${next.season}" data-episode="${next.episode}"${episodeLogBusy.has(String(item.id))?' disabled':''}>${episodeLogBusy.has(String(item.id))?'Saving…':'Mark watched'}</button></article>`).join('')}</div>${rows.length>8?`<button type="button" class="btn btn-secondary" data-continue-more>${continueExpanded?'Show fewer':'Show all '+rows.length+' shows'}</button>`:''}</section>`:'');
}
$('library-collection-select').onchange=event=>{saveNavigationPosition();libraryScope=event.target.value;render();recordAppNavigation();};
$('continue-watching').addEventListener('click',event=>{
  const open=event.target.closest('[data-continue-open]');if(open){openMediaRow(open.dataset.continueOpen,open);return;}
  const mark=event.target.closest('[data-continue-mark]');if(mark){void toggleEpisodeWatched(mark.dataset.continueMark,Number(mark.dataset.season),Number(mark.dataset.episode));return;}
  if(event.target.closest('[data-continue-more]')){continueExpanded=!continueExpanded;renderLibraryFeatures();}
});
function openTitleLists(id){
  const item=mediaItems.find(row=>String(row.id)===String(id));if(!item)return;
  const dialog=$('title-lists-dialog');dialog.dataset.item=String(id);
  $('title-lists-options').innerHTML=collectionNames().map(name=>`<label class="list-choice"><input type="checkbox" value="${esc(name)}"${(item.lists||[]).includes(name)?' checked':''}><span>${esc(name)}</span></label>`).join('')||'<p>No custom lists yet. Create one below.</p>';
  $('title-new-list').value='';$('title-lists-status').textContent='';dialog.showModal();
}
$('save-title-lists').onclick=async()=>{
  const button=$('save-title-lists'),dialog=$('title-lists-dialog'),name=$('title-new-list').value.trim();
  const lists=[...new Set([...dialog.querySelectorAll('input[type="checkbox"]:checked')].map(input=>input.value).concat(name?[name]:[]))];
  if(lists.length>20||lists.some(value=>value.length>40)){ $('title-lists-status').textContent='Use up to 20 lists per title, with names up to 40 characters.';return; }
  button.disabled=true;
  try{if(await saveTitleOrganisation(dialog.dataset.item,{lists}))dialog.close();}
  finally{button.disabled=false;}
};
$('close-title-lists').onclick=()=>$('title-lists-dialog').close();

let displayedRecoveryCode='';
function showRecoveryCode(code){
  displayedRecoveryCode=String(code||'');$('recovery-code-output').textContent=displayedRecoveryCode;
  $('recovery-code-saved').checked=false;$('close-recovery-code').disabled=true;$('recovery-copy-status').textContent='';$('recovery-code-dialog').showModal();
}
$('generate-recovery-code').onclick=async()=>{
  const button=$('generate-recovery-code'),input=$('recovery-current-pin'),status=$('recovery-status');
  if(navigator.onLine===false){status.textContent='Connect to the internet to create a recovery code.';return;}
  if(!/^\d{4}$/.test(input.value)){status.textContent='Enter your current 4-digit PIN.';return;}
  button.disabled=true;status.textContent='Creating recovery code…';
  try{const result=await pinApi('recovery_generate',{pin:input.value});input.value='';status.textContent='Recovery code created. Creating another replaces the previous code.';showRecoveryCode(result.recoveryCode);}
  catch(error){status.textContent=error.message||'Recovery code could not be created.';}
  finally{input.value='';button.disabled=false;}
};
$('recovery-code-saved').onchange=event=>{$('close-recovery-code').disabled=!event.target.checked;};
$('copy-recovery-code').onclick=async()=>{
  try{await navigator.clipboard.writeText(displayedRecoveryCode);$('recovery-copy-status').textContent='Copied. Store this somewhere safe outside Watch Logger.';}
  catch(_){$('recovery-copy-status').textContent='Select and copy the code above.';}
};
$('close-recovery-code').onclick=()=>$('recovery-code-dialog').close();
$('recovery-code-dialog').addEventListener('cancel',event=>{if(!$('recovery-code-saved').checked)event.preventDefault();});
$('recovery-code-dialog').addEventListener('close',()=>{displayedRecoveryCode='';$('recovery-code-output').textContent='';setTimeout(applyPendingAppUpdate,0);});
$('forgot-pin').onclick=()=>{$('recover-email').value=authEmail.value;$('recover-status').textContent='';$('recover-code').value='';$('recover-pin').value='';$('recover-account-dialog').showModal();};
$('close-recover-account').onclick=()=>$('recover-account-dialog').close();
$('recover-account-form').onsubmit=async event=>{
  event.preventDefault();const button=$('recover-submit'),status=$('recover-status');
  if(navigator.onLine===false){status.textContent='Account recovery needs an internet connection.';return;}
  button.disabled=true;status.textContent='Checking recovery code…';
  try{
    const result=await pinApi('recover',{email:$('recover-email').value.trim(),code:$('recover-code').value,pin:$('recover-pin').value},'');
    authEmail.value=$('recover-email').value.trim();authPin.value='';$('recover-account-dialog').close();
    showMessage('PIN reset. Sign in with your new PIN. Your old sessions and recovery code have been replaced.','success');showRecoveryCode(result.recoveryCode);
  }catch(error){status.textContent=error.message||'Account could not be recovered.';}
  finally{button.disabled=false;$('recover-code').value='';$('recover-pin').value='';}
};
$('recover-account-dialog').addEventListener('close',()=>{$('recover-code').value='';$('recover-pin').value='';});

function requestOfflineStatus(){
  const status=$('offline-status');
  if(!('serviceWorker' in navigator)){status.textContent='Offline installation is not supported in this browser.';return;}
  navigator.serviceWorker.ready.then(registration=>{(navigator.serviceWorker.controller||registration.active)?.postMessage({type:'offline-status'});}).catch(()=>{status.textContent='Offline copy is not ready yet. Open the app while online to finish setup.';});
}
if(navigator.serviceWorker){
  navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).then(requestOfflineStatus).catch(()=>{$('offline-status').textContent='Offline copy is not ready yet. Try updating it while connected.';});
  navigator.serviceWorker.addEventListener('message',event=>{if(event.data?.type==='offline-status')$('offline-status').textContent=event.data.ready&&event.data.build===window.WATCHLOG_BUILD?.sha?'Ready for offline use on this device. Changes save locally and sync when connected.':event.data.ready?'A previous offline copy is ready. Update the offline copy to save this version.':'Preparing the offline copy. Keep the app open while connected.';});
  navigator.serviceWorker.addEventListener('controllerchange',requestOfflineStatus);requestOfflineStatus();
}
$('refresh-offline-copy').onclick=async()=>{
  try{const registration=await navigator.serviceWorker?.getRegistration();if(registration)await registration.update();requestOfflineStatus();}
  catch(_){$('offline-status').textContent='Could not update the offline copy. Try again when connected.';}
};

document.querySelectorAll('dialog[data-block-refresh]').forEach(dialog=>dialog.addEventListener('close',()=>setTimeout(applyPendingAppUpdate,0)));
