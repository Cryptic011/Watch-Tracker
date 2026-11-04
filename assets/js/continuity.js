/* Account preferences use per-field patches and a persistent local retry queue. */
let preferenceRequest=null,preferenceRetryTimer=null;
function preferenceKeys(){return currentUser?{pending:'watchlog_preferences_pending_'+currentUser.id,saved:'watchlog_preferences_'+currentUser.id}:null;}
function applyAccountPreferences(preferences){
  const keys=preferenceKeys();if(!keys)return;
  safeWriteJSON(keys.saved,preferences);
  if(preferences.appearance){safeWriteJSON(APPEARANCE_KEY,preferences.appearance);applyAppearance(preferences.appearance);}
  if(preferences.sort&&activeFilter!=='Recent'){activeSort=preferences.sort;sortMode.value=activeSort;}
}
async function syncAccountPreferences(){
  const keys=preferenceKeys();if(!keys||navigator.onLine===false||!cloudSessionToken||preferenceRequest)return;
  const account=String(currentUser.id),token=cloudSessionToken;
  const pending=safeReadJSON(keys.pending,{});
  preferenceRequest=(async()=>{
    const result=await pinApi('preferences',Object.keys(pending).length?{patch:pending}:{},token);
    if(String(currentUser?.id)!==account)return;
    const latest=safeReadJSON(keys.pending,{});
    for(const key of Object.keys(pending))if(latest[key]===pending[key])delete latest[key];
    safeWriteJSON(keys.pending,latest);
    applyAccountPreferences({...result.preferences,...latest});
  })().catch(()=>{}).finally(()=>{
    preferenceRequest=null;
    clearTimeout(preferenceRetryTimer);
    const current=preferenceKeys();
    if(current&&Object.keys(safeReadJSON(current.pending,{})).length&&navigator.onLine!==false)preferenceRetryTimer=setTimeout(()=>void syncAccountPreferences(),15000);
  });
  await preferenceRequest;
}
function queuePreference(patch){
  const keys=preferenceKeys();if(!keys)return;
  safeWriteJSON(keys.pending,{...safeReadJSON(keys.pending,{}),...patch});
  void syncAccountPreferences();
}
$('appearance-mode').addEventListener('change',event=>queuePreference({appearance:event.target.value}));
sortMode.addEventListener('change',event=>queuePreference({sort:event.target.value}));
window.addEventListener('online',()=>void syncAccountPreferences());
window.addEventListener('storage',event=>{
  if(event.key===PIN_SESSION_KEY){
    const session=safeReadJSON(PIN_SESSION_KEY,null);
    if(!session?.token&&currentUser&&!hasPending()){
      void clearUserState().then(showAuth);return;
    }
  }
  if(currentUser){scheduleCloudSync(0);void syncAccountPreferences();}
});
window.addEventListener('pageshow',()=>{if(currentUser)void syncAccountPreferences();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&currentUser)void syncAccountPreferences();});
const persistentButton=document.createElement('button');
persistentButton.type='button';persistentButton.className='btn btn-secondary btn-full';persistentButton.textContent='Keep offline data on this device';
$('refresh-offline-copy').after(persistentButton);
persistentButton.onclick=async()=>{
  persistentButton.disabled=true;
  try{
    const kept=await navigator.storage?.persist?.();
    $('offline-status').textContent=kept?'Offline data is protected from automatic storage cleanup on this device.':'Offline data is saved. This browser manages how long it is retained.';
  }catch(_){$('offline-status').textContent='This browser manages offline storage automatically.';}
  finally{persistentButton.disabled=false;}
};
