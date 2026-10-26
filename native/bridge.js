import {registerPlugin,Capacitor} from '@capacitor/core';
import {reminderPlan} from './reminder-plan.mjs';
import {installNativeControls} from './controls.js';

if(Capacitor.isNativePlatform()){
  const Native=registerPlugin('WatchLogNative');
  window.WatchLogNative=Native;
  installNativeControls(Native);
  let timer,tail=Promise.resolve(),lastPlan='',pendingItem=null;
  const report=(message,state='',connection='off')=>setBackgroundReminderStatus(message,state,connection);
  const preference=()=>currentUser?backgroundReminderPreference():null;
  const context=()=>({country:typeof releaseViewingCountry==='function'?releaseViewingCountry():'GB',timeZone:DEVICE_TIME_ZONE,locale:USER_LOCALE});
  function plan(){
    return reminderPlan(mediaItems,currentUser.id,{
      resolveItem:item=>window.WatchLogRegionalReleases?.resolve(item,context())||item,
      resolveEvent:(item,event)=>window.WatchLogRegionalReleases?.resolveEvent(item,event,context())||event
    });
  }
  function reconcile(force=false){
    tail=tail.catch(()=>{}).then(async()=>{
      const account=String(currentUser?.id||'');
      const settings=await Native.status();
      if(account!==String(currentUser?.id||''))return;
      if(!account||preference()!=='on'||settings.permission!=='granted'){
        if(force||lastPlan){await Native.cancelReminders();lastPlan='';}
        return;
      }
      const requests=plan(),key=JSON.stringify([account,requests]);
      if(force||key!==lastPlan){await Native.replaceReminders({requests});lastPlan=key;}
      report(`iPhone reminders on · ${requests.length} upcoming alerts scheduled. Open the app online to refresh release times.`,'ok','on');
    });
    return tail;
  }
  async function refresh(){
    if(!currentUser){report('Sign in to manage iPhone reminders.');await reconcile(true);return false;}
    const settings=await Native.status();
    if(settings.permission==='denied'){report('Notifications are blocked. Enable Watched Tracker in iPhone Settings → Notifications.','error','blocked');return false;}
    if(settings.permission==='granted'&&preference()==='on'){await reconcile();return true;}
    report('Enable iPhone reminders to schedule confirmed release times on this device.');return false;
  }
  refreshBackgroundReminderStatus=refresh;
  syncExistingBackgroundPush=refresh;
  removeBackgroundPush=async()=>{await Native.cancelReminders();lastPlan='';};
  pushSupportError=()=>'';
  enableBackgroundReminders.onclick=()=>runBackgroundReminderAction(async()=>{
    const account=String(currentUser?.id||'');if(!account)throw new Error('Sign in first.');
    const result=await Native.requestPermission();
    if(account!==String(currentUser?.id||''))return;
    if(result.permission!=='granted'){await refresh();return;}
    backgroundReminderPreference('on');await reconcile(true);
  });
  disableBackgroundReminders.onclick=()=>runBackgroundReminderAction(async()=>{
    backgroundReminderPreference('off');await reconcile(true);await Native.cancelReminders();report('iPhone reminders are off on this device.');
  });
  const oldTest=document.getElementById('test-background-reminder'),test=oldTest.cloneNode(true);oldTest.replaceWith(test);
  test.onclick=()=>runBackgroundReminderAction(async()=>{
    await Native.testReminder();report('Test reminder scheduled for this iPhone.','ok','on');
  });
  const originalRender=render;
  render=function(...args){const result=originalRender(...args);clearTimeout(timer);timer=setTimeout(()=>void reconcile().catch(error=>report(error.message,'error','repair')),600);return result;};
  const originalClear=clearUserState;
  clearUserState=async function(...args){
    clearTimeout(timer);
    const result=await originalClear(...args);
    await reconcile(true);await Native.cancelReminders();lastPlan='';return result;
  };
  const offline=document.getElementById('offline-status');
  requestOfflineStatus=()=>{offline.textContent='The app screens are included on this iPhone. Saved titles and edits remain available offline after your first sign-in. Code updates arrive through TestFlight or the App Store.';};
  requestOfflineStatus();
  document.getElementById('refresh-offline-copy').hidden=true;
  const reminderDescription=document.querySelector('.background-reminder-card .small-note');
  if(reminderDescription)reminderDescription.textContent='iPhone alerts use the latest confirmed release times saved on this device. Up to 60 upcoming alerts are kept. Open the app online to refresh dates and schedule more. These alerts are separate from website push subscriptions.';
  const oldExport=document.getElementById('export-library-backup'),exportButton=oldExport.cloneNode(true);oldExport.replaceWith(exportButton);
  exportButton.onclick=async()=>{
    try{
      if(!currentUser)throw new Error('Sign in to export your library.');
      const data={format:'watchlog-library-backup',version:1,exportedAt:new Date().toISOString(),items:cloneLibrarySnapshot(mediaItems)};
      await Native.shareBackup({text:JSON.stringify(data,null,2)});
      document.getElementById('library-backup-status').textContent='Backup sharing opened.';
    }catch(error){document.getElementById('library-backup-status').textContent=error.message||'Could not share the backup.';}
  };
  window.addEventListener('watchlog:native-active',()=>{
    window.dispatchEvent(new Event('focus'));void refresh().catch(()=>{});void takeNotification();
  });
  async function takeNotification(){const item=await Native.takeNotification();if(item.itemId){pendingItem=item;openPendingItem();}}
  window.addEventListener('watchlog:native-notification',()=>{void takeNotification();});
  function openPendingItem(){
    if(!pendingItem||!currentUser)return;
    const item=pendingItem;pendingItem=null;
    if(String(item.accountId)!==String(currentUser.id))return;
    if(mediaItems.some(row=>String(row.id)===String(item.itemId)))openMediaRow(String(item.itemId));
  }
  setInterval(openPendingItem,1500);
  void takeNotification();
  void refresh().catch(error=>report(error.message,'error','repair'));
}
