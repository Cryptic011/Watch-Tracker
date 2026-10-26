  function clearReminderBadge(){
    if(document.visibilityState!=="hidden")Promise.resolve(navigator.clearAppBadge?.()).catch(()=>{});
  }
  document.addEventListener("visibilitychange",clearReminderBadge);
  window.addEventListener("focus",clearReminderBadge);
  clearReminderBadge();

  function isStandaloneWebApp(){
    return window.matchMedia?.("(display-mode: standalone)")?.matches||navigator.standalone===true;
  }
  let backgroundReminderBusy=false,backgroundReminderGeneration=0,backgroundReminderRefresh=null;
  let backgroundReminderConnection="off";
  function setBackgroundReminderStatus(message,state="",connection="off"){
    backgroundReminderConnection=connection;
    if(!backgroundReminderStatus)return;
    backgroundReminderStatus.textContent=message;
    backgroundReminderStatus.dataset.state=state||connection;
    backgroundReminderStatus.style.color=state==="error"?"#fca5a5":state==="ok"?"var(--green)":"var(--muted)";
    const enabled=connection==="on"||connection==="pending",blocked=connection==="blocked"||connection==="checking";
    enableBackgroundReminders?.classList.toggle("hidden",enabled);
    disableBackgroundReminders?.classList.toggle("hidden",!enabled);
    if(enableBackgroundReminders){enableBackgroundReminders.textContent=connection==="repair"?"Reconnect Reminders":"Enable Background Reminders";enableBackgroundReminders.disabled=backgroundReminderBusy||blocked;}
    if(disableBackgroundReminders)disableBackgroundReminders.disabled=backgroundReminderBusy;
    const test=document.getElementById("test-background-reminder");
    if(test)test.disabled=backgroundReminderBusy||connection!=="on";
    const quick=document.getElementById("quick-reminder-status");
    const quickLabel=quick?.querySelector?.("span");
    if(quick&&quickLabel){const attention=state==="error";quick.dataset.state=attention?"attention":enabled?"ok":"idle";quickLabel.textContent=attention?"Reminder issue":connection==="pending"?"Reminders · awaiting connection":enabled?"Reminders on":connection==="checking"?"Checking reminders":"Reminders off";}
  }
  function pushSupportError(){
    if(!("Notification" in window)||!("serviceWorker" in navigator)||!("PushManager" in window))return"Background notifications are not supported in this browser.";
    if(/iPhone|iPad|iPod/i.test(navigator.userAgent)&&!isStandaloneWebApp())return"Add Watched Logger to your Home Screen, then open it from the icon to enable iPhone background reminders.";
    if(Notification.permission==="denied")return"Notifications are blocked. Enable Watched Logger in iPhone Settings → Notifications.";
    return"";
  }
  function urlBase64ToUint8Array(value){
    const padding="=".repeat((4-value.length%4)%4),base64=(value+padding).replace(/-/g,"+").replace(/_/g,"/");
    const raw=atob(base64);return Uint8Array.from(raw,char=>char.charCodeAt(0));
  }
  async function reminderApi(action,payload={},token=cloudSessionToken){
    const headers={"Content-Type":"application/json"};
    if(token)headers["X-WatchLog-Session"]=token;
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),CLOUD_REQUEST_TIMEOUT_MS);
    try{
      const response=await fetch(REMINDER_API,{method:"POST",headers,body:JSON.stringify({action,...payload}),signal:controller.signal});
      let data={};try{data=await response.json();}catch(error){if(response.ok||controller.signal.aborted)throw error;}
      if(!response.ok){const error=new Error(data.error||`Reminder service error (${response.status})`);error.code=data.code||"reminder_error";error.status=response.status;throw error;}
      if(data?.ok!==true)throw new Error("The reminder service returned an incomplete response.");
      return data;
    }catch(error){
      if(error?.code)throw error;
      const wrapped=new Error(error?.name==="AbortError"?"The reminder service took too long to respond.":"Could not reach the Watched Logger reminder service.");wrapped.code=error?.name==="AbortError"?"timeout":"network";throw wrapped;
    }finally{clearTimeout(timeout);}
  }
  async function notificationWorker(){
    // App updates own worker registration. Reuse the active worker so a
    // temporary update/download failure cannot hide an existing subscription.
    const registration=await navigator.serviceWorker.getRegistration("./");
    if(registration?.active)return registration;
    if(!registration)await navigator.serviceWorker.register("./sw.js",{scope:"./",updateViaCache:"none"});
    let timer;
    try{return await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Notifications are still starting. Try reconnecting in a moment.")),12000);})]);}
    finally{clearTimeout(timer);}
  }
  async function currentPushSubscription(){
    if(typeof Notification==="undefined"||(pushSupportError()&&Notification.permission!=="granted"))return null;
    return(await notificationWorker()).pushManager.getSubscription();
  }
  let backgroundPushPrepared=null,backgroundPushPreparing=null;
  async function prepareBackgroundPush(){
    if(backgroundPushPrepared)return backgroundPushPrepared;
    if(backgroundPushPreparing)return backgroundPushPreparing;
    backgroundPushPreparing=(async()=>{
      const registration=await notificationWorker();
      const result=await reminderApi("public_key",{},"");
      if(!result.publicKey)throw new Error("The reminder service did not return a push key.");
      return backgroundPushPrepared={registration,key:urlBase64ToUint8Array(result.publicKey)};
    })();
    try{return await backgroundPushPreparing;}finally{backgroundPushPreparing=null;}
  }
  async function ensureBackgroundPush({askPermission=false,renew=false,token=cloudSessionToken,subscriptionPromise=null}={}){
    if(!token)throw new Error("Sign in to enable background reminders.");
    const supportError=pushSupportError();
    if(supportError)throw new Error(supportError);
    if(!subscriptionPromise&&Notification.permission!=="granted"){
      if(!askPermission)throw new Error("Background reminders are not enabled on this device.");
      const permission=await Notification.requestPermission();
      if(permission!=="granted")throw new Error("Notification permission was not allowed.");
    }
    const {registration,key}=await prepareBackgroundPush();
    let subscription=subscriptionPromise?await subscriptionPromise:await registration.pushManager.getSubscription();
    const oldKey=subscription?.options?.applicationServerKey;
    const keyChanged=oldKey&&(new Uint8Array(oldKey).length!==key.length||new Uint8Array(oldKey).some((value,index)=>value!==key[index]));
    if(subscription&&(renew||keyChanged||(subscription.expirationTime&&subscription.expirationTime<=Date.now()))){
      if(!await subscription.unsubscribe())throw new Error("This device could not renew notifications. Try reconnecting again.");
      subscription=null;
    }
    if(!subscription){
      subscription=await registration.pushManager.subscribe({
        userVisibleOnly:true,
        applicationServerKey:key
      });
    }
    if(token!==cloudSessionToken)throw new Error("Sign in again to connect reminders.");
    const confirmed=await registration.pushManager.getSubscription();
    if(!confirmed||confirmed.endpoint!==subscription.endpoint)throw new Error("iPhone did not retain the notification connection. Tap Reconnect Reminders to try again.");
    await reminderApi("subscribe",{
      subscription:subscription.toJSON(),
      timeZone:DEVICE_TIME_ZONE||"UTC",
      locale:typeof reminderViewingLocale==="function"?reminderViewingLocale():USER_LOCALE
    },token);
    if(token!==cloudSessionToken)throw new Error("Sign in again to connect reminders.");
    return subscription;
  }
  function backgroundReminderPreference(value){
    const key=`watchlog_background_reminders_${currentUser?.id||""}`;
    try{if(value!==undefined)localStorage.setItem(key,value);return localStorage.getItem(key);}catch(_){return null;}
  }
  async function refreshBackgroundReminderStatus({reconnect=false}={}){
    if(backgroundReminderBusy)return false;
    if(backgroundReminderRefresh)return backgroundReminderRefresh;
    const generation=++backgroundReminderGeneration,token=cloudSessionToken;
    const report=(message,state="",connection="off")=>{if(generation===backgroundReminderGeneration&&token===cloudSessionToken)setBackgroundReminderStatus(message,state,connection);};
    const task=(async()=>{
    if(!token){report("Sign in to manage background reminders.");return false;}
    const supportError=pushSupportError();
    if(supportError){
      report(supportError,"error","blocked");
      return false;
    }
    if(Notification.permission!=="granted"){
      if(navigator.onLine!==false)try{await prepareBackgroundPush();}catch(_){}
      report("Not enabled on this device. Enable reminders to receive release alerts while the app is closed.");
      return false;
    }
    let subscription;
    try{
    subscription=await currentPushSubscription();
    if(backgroundReminderPreference()==="off"){
      report("Background reminders are off on this device.");return false;
    }
    if(navigator.onLine===false){
      report(subscription?"This device's reminder connection is saved. It will be checked automatically when online.":"Go online to connect reminders on this device.","",subscription?"pending":"checking");return false;
    }
    // Prepare the permission-sensitive Safari tap without making the key
    // service a prerequisite for checking an already registered endpoint.
    void prepareBackgroundPush().catch(()=>{});
    if(!subscription){
      await prepareBackgroundPush();
      const off=backgroundReminderPreference()==="off";
      report(off?"Background reminders are off on this device.":"Notifications are allowed, but this device needs reconnecting.","",off?"off":"repair");
      return false;
    }
      if(subscription.expirationTime&&subscription.expirationTime<=Date.now()){report("This device's notification connection expired. Reconnect reminders.","","repair");return false;}
      const result=await reminderApi("status",{endpoint:subscription.endpoint},token);
      if((!result.enabled||reconnect)&&backgroundReminderPreference()!=="off"&&generation===backgroundReminderGeneration&&token===cloudSessionToken){
        await reminderApi("subscribe",{subscription:subscription.toJSON(),timeZone:DEVICE_TIME_ZONE||"UTC",locale:typeof reminderViewingLocale==="function"?reminderViewingLocale():USER_LOCALE},token);
      }
    }catch(error){
      if(error.code==="network"||error.code==="timeout"||error.status>=500||error.status===429){
        report(subscription?"Reminder connection saved. Temporarily unable to check the service; retrying automatically.":"Unable to reach the reminder service. Retrying when connected.","",subscription?"pending":"checking");
      }else report(error.status===401?"Your reminder session expired. Sign in again.":error.message||"Could not check reminders.","error",error.status===401?"blocked":"repair");
      return false;
    }
    if(generation===backgroundReminderGeneration&&token===cloudSessionToken)backgroundReminderPreference("on");
    report("Enabled — alerts can arrive when Watched Logger is closed.","ok","on");
    return true;
    })();
    backgroundReminderRefresh=task;
    try{return await task;}finally{if(backgroundReminderRefresh===task)backgroundReminderRefresh=null;}
  }
  async function syncExistingBackgroundPush(){
    return refreshBackgroundReminderStatus({reconnect:true});
  }
  async function removeBackgroundPush(){
    const token=cloudSessionToken;
    ++backgroundReminderGeneration;
    if(backgroundReminderRefresh)await backgroundReminderRefresh.catch(()=>{});
    const subscription=await currentPushSubscription();
    if(subscription){
      const results=await Promise.allSettled([token?reminderApi("unsubscribe",{endpoint:subscription.endpoint},token):Promise.reject(new Error("Sign in again.")),subscription.unsubscribe().then(value=>{if(!value)throw new Error("Could not disconnect notifications on this device.");})]);
      if(results.every(result=>result.status==="rejected"))throw new Error("Could not turn reminders off. Check your connection and try again.");
    }
    if(token!==cloudSessionToken)return;
    backgroundReminderPreference("off");
    setBackgroundReminderStatus("Background reminders are off on this device.");
  }
  async function runBackgroundReminderAction(action){
    if(backgroundReminderBusy)return;
    backgroundReminderBusy=true;++backgroundReminderGeneration;
    const token=cloudSessionToken;
    try{
      // Start permission requests in the click's user gesture, before any await.
      await action(token);
    }catch(error){if(token===cloudSessionToken)setBackgroundReminderStatus(error.message||"Could not connect reminders. Try reconnecting.","error",pushSupportError()?"blocked":"repair");}
    finally{backgroundReminderBusy=false;if(token===cloudSessionToken){enableBackgroundReminders.disabled=backgroundReminderConnection==="blocked";disableBackgroundReminders.disabled=false;const test=document.getElementById("test-background-reminder");if(test)test.disabled=backgroundReminderConnection!=="on";}}
  }
  enableBackgroundReminders.onclick=()=>runBackgroundReminderAction(async token=>{
    // Safari requires subscribe() in the tap itself, before network/worker
    // awaits. Reusing a valid subscription also avoids needless revocation.
    const prepared=backgroundPushPrepared;
    const subscriptionPromise=prepared?prepared.registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:prepared.key}):null;
    setBackgroundReminderStatus("Connecting this device…","","checking");
    await ensureBackgroundPush({askPermission:true,token,subscriptionPromise});
    if(token!==cloudSessionToken)return;
    backgroundReminderPreference("on");
    setBackgroundReminderStatus("Enabled — alerts can arrive when Watched Logger is closed.","ok","on");
  });
  disableBackgroundReminders.onclick=()=>runBackgroundReminderAction(async()=>{
    setBackgroundReminderStatus("Turning reminders off…","","on");
    await removeBackgroundPush();
  });
  document.getElementById("test-background-reminder")?.addEventListener("click",()=>runBackgroundReminderAction(async token=>{
    setBackgroundReminderStatus("Sending test reminder…","","on");
    // A delivery test is independent of library saves. Repair a missing local
    // subscription or missing server record before submitting the test.
    let subscription=await ensureBackgroundPush({token});
    const requestId=crypto.randomUUID();
    let result;
    try{result=await reminderApi("test_reminder",{endpoint:subscription.endpoint,requestId},token);}
    catch(error){if(error.code!=="push_subscription_expired"||token!==cloudSessionToken)throw error;subscription=await ensureBackgroundPush({renew:true,token});result=await reminderApi("test_reminder",{endpoint:subscription.endpoint,requestId},token);}
    if(token!==cloudSessionToken)return;
    backgroundReminderPreference("on");
    setBackgroundReminderStatus(result.duplicate?"Test reminder was already sent.":"Test reminder accepted by the push service.","ok","on");
  }));
  let lastReminderReturnCheck=0;
  function refreshRemindersOnReturn(event){
    if(!currentUser||!cloudSessionToken||document.visibilityState==="hidden")return;
    const now=Date.now();
    if(event?.type!=="online"&&now-lastReminderReturnCheck<60000)return;
    lastReminderReturnCheck=now;void refreshBackgroundReminderStatus();
  }
  // A transient failure recovers even if the device never emits online again.
  setInterval(()=>{if(backgroundReminderConnection==="pending")refreshRemindersOnReturn();},60000);
  window.addEventListener("focus",refreshRemindersOnReturn);
  window.addEventListener("online",refreshRemindersOnReturn);
  document.addEventListener("visibilitychange",refreshRemindersOnReturn);
  document.querySelectorAll('[data-settings-open="reminders"]').forEach(button=>button.addEventListener("click",refreshRemindersOnReturn));
  setBackgroundReminderStatus("Sign in to manage background reminders.");

  async function pinApi(action,payload={},token=cloudSessionToken,preparedBody="",externalSignal=null){
    const headers={"Content-Type":"application/json"};
    if(token)headers["X-WatchLog-Session"]=token;
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),["uk_availability","catalog_details"].includes(action)?20000:CLOUD_REQUEST_TIMEOUT_MS);
    const abortFromExternal=()=>controller.abort();
    if(externalSignal){if(externalSignal.aborted)controller.abort();else externalSignal.addEventListener("abort",abortFromExternal,{once:true});}
    try{
      const response=await fetch(PIN_API,{method:"POST",headers,body:preparedBody||JSON.stringify({action,...payload}),signal:controller.signal});
      let data={};
      try{data=await response.json();}
      catch(error){
        if(error?.name==="AbortError"||response.ok)throw error;
      }
      if(!data||typeof data!=="object"||Array.isArray(data))throw new Error("Invalid cloud response.");
      if(!response.ok){
        const err=new Error(data.error||`Watched Logger cloud error (${response.status})`);err.code=data.code||"api_error";err.status=response.status;err.retryAfter=data.retryAfter;err.maintenance=data.maintenance===true;
        Object.assign(err,{items:data.items,revision:data.revision,updatedAt:data.updatedAt});
        if(err.maintenance){
          publicMaintenance={enabled:true,message:err.message||publicMaintenance.message};maintenanceOwnerAccess=false;
          updateAuthMode();showAuth();
        }
        throw err;
      }
      const unchangedLoad=action==="load"&&data.unchanged===true&&Number.isSafeInteger(payload.knownRevision)&&data.revision===payload.knownRevision;
      if(data.ok!==true||(["load","login"].includes(action)&&((!Array.isArray(data.items)&&!unchangedLoad)||!data.account?.id))||(["save","load","login","register"].includes(action)&&(!Number.isSafeInteger(data.revision)||data.revision<0))){
        const error=new Error("The cloud returned an incomplete response. Your local changes are still available.");error.code="invalid_response";throw error;
      }
      return data;
    }catch(e){
      if(e?.code)throw e;
      const externalAbort=externalSignal?.aborted===true;
      const err=new Error(externalAbort?"Search cancelled.":e?.name==="AbortError"?"Watched Logger cloud took too long to respond. Your change remains saved on this device.":"Could not reach Watched Logger cloud. Check your connection.");err.code=externalAbort?"cancelled":e?.name==="AbortError"?"timeout":"network";throw err;
    }finally{
      clearTimeout(timeout);
      externalSignal?.removeEventListener?.("abort",abortFromExternal);
    }
  }

  async function fetchJSONWithTimeout(url,options={},timeoutMs=EXTERNAL_REQUEST_TIMEOUT_MS){
    const controller=new AbortController(),externalSignal=options.signal||null;
    const abortFromExternal=()=>controller.abort();
    if(externalSignal){if(externalSignal.aborted)controller.abort();else externalSignal.addEventListener("abort",abortFromExternal,{once:true});}
    const timeout=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetch(url,{...options,signal:controller.signal});
      const data=await response.json();
      if(!response.ok){const error=new Error(`Request failed (${response.status})`);error.status=response.status;throw error;}
      return data;
    }finally{
      clearTimeout(timeout);
      externalSignal?.removeEventListener?.("abort",abortFromExternal);
    }
  }

  function renderAuthMaintenance(){
    renderLibraryMaintenance();
    const enabled=publicMaintenance.enabled===true;
    if(!enabled)maintenanceOwnerAccess=false;
    maintenanceBanner.classList.toggle("hidden",!enabled);
    maintenanceBannerMessage.textContent=enabled?publicMaintenance.message:"";
    maintenanceOwnerAccessButton.classList.toggle("hidden",!enabled||maintenanceOwnerAccess);
    authForm.classList.toggle("hidden",enabled&&!maintenanceOwnerAccess);
    authToggle.classList.toggle("hidden",enabled);
    if(enabled){authTitle.textContent="Under Maintenance";authSub.textContent=maintenanceOwnerAccess?"Owner sign-in remains available.":"Watched Logger will be back shortly.";}
  }
  maintenanceOwnerAccessButton.onclick=()=>{maintenanceOwnerAccess=true;isSignUp=false;authPin.value="";updateAuthMode();authEmail.focus();};
  async function refreshPublicMaintenance(){
    try{
      const result=await pinApi("app_status",{},"");
      publicMaintenance={enabled:result.maintenance===true,message:String(result.message||publicMaintenance.message)};
      updateAuthMode();
      return publicMaintenance;
    }catch(error){
      console.warn("Maintenance status check skipped",error);
      return publicMaintenance;
    }
  }
  async function refreshMaintenanceAdmin(){
    maintenanceAdminSection.classList.add("hidden");
    maintenanceAdminSection.dataset.authorized="false";
    $("maintenance-settings-button")?.classList.add("hidden");
    if(document.querySelector('#settings-view [data-settings-panel="maintenance"]:not(.hidden)'))showSettingsMenu();
    if(!cloudSessionToken)return false;
    try{
      const result=await pinApi("maintenance_admin_status");
      if(result.canManage!==true)return false;
      maintenanceEnabled.checked=result.maintenance===true;
      maintenanceMessage.value=String(result.message||publicMaintenance.message);
      publicMaintenance={enabled:result.maintenance===true,message:maintenanceMessage.value};
      renderLibraryMaintenance();
      maintenanceAdminStatus.textContent=result.maintenance?"Maintenance is ON. New logins are blocked.":"Maintenance is OFF. Logins are open.";
      maintenanceAdminSection.dataset.authorized="true";
      $("maintenance-settings-button")?.classList.remove("hidden");
      return true;
    }catch(error){
      if(error.status!==403)console.warn("Maintenance controls unavailable",error);
      return false;
    }
  }
  saveMaintenance.onclick=async()=>{
    const message=maintenanceMessage.value.trim();
    if(message.length<8){maintenanceAdminStatus.textContent="Enter a maintenance message of at least 8 characters.";return;}
    saveMaintenance.disabled=true;maintenanceAdminStatus.textContent="Saving…";
    try{
      const result=await pinApi("set_maintenance",{enabled:maintenanceEnabled.checked,message});
      publicMaintenance={enabled:result.maintenance===true,message:String(result.message||message)};
      renderLibraryMaintenance();
      maintenanceEnabled.checked=publicMaintenance.enabled;maintenanceMessage.value=publicMaintenance.message;
      maintenanceAdminStatus.textContent=publicMaintenance.enabled?"Maintenance is ON. New logins are blocked.":"Maintenance is OFF. Logins are open.";
      showAppToast(publicMaintenance.enabled?"Maintenance mode enabled.":"Maintenance mode disabled.",publicMaintenance.enabled?"warn":"success");
    }catch(error){maintenanceAdminStatus.textContent=error.message||"Could not update maintenance mode.";}
    finally{saveMaintenance.disabled=false;}
  };

  let latestLocalSnapshot=null;
  function cacheName(userIdHash){return `WatchLogLocal_${userIdHash.slice(0,48)}`;}
  async function openCache(userId){
    if(cacheDB){try{cacheDB.close();}catch(_){}}
    const h=await sha256(`watchlog-local:${userId}`);
    return new Promise((resolve,reject)=>{
      const r=indexedDB.open(cacheName(h),1);
      r.onupgradeneeded=e=>{const db=e.target.result;if(!db.objectStoreNames.contains("data"))db.createObjectStore("data",{keyPath:"key"});};
      r.onsuccess=()=>{cacheDB=r.result;resolve(cacheDB);};
      r.onerror=()=>reject(r.error);
    });
  }
  function cachePut(value,db=cacheDB){return new Promise((resolve,reject)=>{if(!db)return resolve(false);const tx=db.transaction("data","readwrite");tx.objectStore("data").put(value);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error("On-device save was interrupted."));});}
  function cacheGet(key,db=cacheDB){return new Promise((resolve,reject)=>{if(!db)return resolve(null);const tx=db.transaction("data","readonly");const r=tx.objectStore("data").get(key);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);tx.onabort=()=>reject(tx.error||new Error("On-device read was interrupted."));});}
  function activePersistenceContext(snapshot){return Boolean(snapshot&&String(currentUser?.id||"")===snapshot.accountId&&cloudSessionToken===snapshot.token&&persistenceGeneration===snapshot.generation);}
  function setCloudBaseline(items,revision,accountId=String(currentUser?.id||"")){
    if(!accountId||String(currentUser?.id||"")!==accountId)return;
    cloudBaseItems=cloneLibrarySnapshot(items);
    cloudRevision=Math.max(0,Number(revision)||0);
    lastCloudLibraryJSON=JSON.stringify(cloudBaseItems);
    lastCloudAccountId=accountId;
  }
  async function saveCache(items,serialized="",{dirty=false,baseItems=cloudBaseItems,baseRevision=cloudRevision,sequence=localSaveSequence,accountId=String(currentUser?.id||""),db=cacheDB}={}){
    if(!accountId||!db)return false;
    const json=serialized||JSON.stringify(items);
    await cachePut({key:"library",userId:accountId,items,json,dirty,cloudItems:baseItems,cloudRevision:Math.max(0,Number(baseRevision)||0),localSequence:sequence,updatedAt:nowISO()},db);
    if(String(currentUser?.id||"")===accountId&&cacheDB===db){lastLocalLibraryJSON=json;lastLocalAccountId=accountId;}
    return true;
  }
  async function loadCacheRecord(){if(!currentUser)return null;const r=await cacheGet("library");return r?.userId===currentUser.id?r:null;}
  async function loadCache(){const r=await loadCacheRecord();return Array.isArray(r?.items)?r.items:[];}
  async function saveProfile(profile){if(!currentUser)return;await cachePut({key:"profile",userId:currentUser.id,profile,updatedAt:nowISO()});}
  async function loadProfile(){if(!currentUser)return null;const r=await cacheGet("profile");return r?.userId===currentUser.id?r.profile||null:null;}
  function pendingKey(accountId=String(currentUser?.id||"")){return accountId?`watchlog_pin_pending_${accountId}`:"";}
  function markPending(value,accountId=String(currentUser?.id||"")){const key=pendingKey(accountId);if(!key)return;if(value)pendingCloudAccounts.add(accountId);else pendingCloudAccounts.delete(accountId);try{if(value)localStorage.setItem(key,"1");else localStorage.removeItem(key);}catch(_){/* IndexedDB remains the durable queue. */}}
  function hasPending(accountId=String(currentUser?.id||"")){if(pendingCloudAccounts.has(accountId))return true;try{const key=pendingKey(accountId);return !!key&&localStorage.getItem(key)==="1";}catch(_){return false;}}
