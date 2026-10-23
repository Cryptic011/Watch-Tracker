"use strict";

const NAVIGATION_CACHE="watchlog-navigation-v4";
const SHELL_BUILD="__WATCHLOG_BUILD__";
const SHELL_CACHE="watchlog-shell-"+SHELL_BUILD;
function shellAsset(url){
  const scope=new URL(self.registration.scope);
  return url.origin===scope.origin&&url.pathname.startsWith(scope.pathname)&&
    !url.searchParams.has("update")&&/\.(?:js|css|png|svg|webmanifest)$/.test(url.pathname)&&!url.pathname.endsWith('/build-info.js')&&!url.pathname.endsWith('/sw.js');
}
async function installShell(){
  const response=await fetch(new URL("asset-manifest.json",self.registration.scope),{cache:"no-store"});
  if(!response.ok)throw Error("Offline manifest unavailable");
  const manifest=await response.json();
  if(manifest.version!==SHELL_BUILD||!Array.isArray(manifest.assets)||!manifest.assets.includes("index.html"))throw Error("Offline manifest does not match this build");
  const assets=manifest.assets.map(path=>new URL(path,self.registration.scope));
  if(assets.some(url=>!shellAsset(url)&&url.href!==new URL("index.html",self.registration.scope).href))throw Error("Invalid offline asset");
  const cache=await caches.open(SHELL_CACHE);
  // addAll rejects the install if any asset fails; the previous complete
  // worker and its cache remain active until the new shell is complete.
  await cache.addAll(assets.map(url=>new Request(url.href,{cache:"reload"})));
  await self.skipWaiting();
}
self.addEventListener("install",event=>event.waitUntil(installShell()));
self.addEventListener("activate",event=>event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(key=>key.startsWith("watchlog-shell-")&&key!==SHELL_CACHE).map(key=>caches.delete(key)));
  await self.clients.claim();
})()));
self.addEventListener("message",event=>{
  if(event.data?.type!=="offline-status")return;
  event.waitUntil((async()=>{
    const cache=await caches.open(SHELL_CACHE),ready=Boolean(await cache.match(new URL("index.html",self.registration.scope).href));
    event.source?.postMessage({type:"offline-status",ready,build:SHELL_BUILD});
  })());
});
self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET")return;
  if(request.mode==="navigate"){
    event.respondWith((async()=>{
      const fallback=new Request(new URL("./index.html",self.registration.scope).href);
      try{
        const response=await fetch(request,{cache:"no-store"});
        if(response.ok){const cache=await caches.open(NAVIGATION_CACHE);await cache.put(fallback,response.clone());}
        return response;
      }catch(_){
        // Navigation cache and shell versions can differ during deployment;
        // static requests retain the exact versioned URLs embedded in HTML.
        const navigation=await caches.open(NAVIGATION_CACHE),shell=await caches.open(SHELL_CACHE);
        return (await shell.match(fallback))||(await navigation.match(request))||(await navigation.match(fallback))||Response.error();
      }
    })());return;
  }
  const url=new URL(request.url);
  if(!shellAsset(url))return;
  event.respondWith((async()=>{
    const cache=await caches.open(SHELL_CACHE),cached=await cache.match(request);
    if(cached)return cached;
    const response=await fetch(request);
    if(response.ok)await cache.put(request,response.clone());
    return response;
  })());
});

self.addEventListener("push",event=>{
  let payload={
    title:"Watched Logger",
    body:"A Watched Logger reminder is ready.",
    tag:"watchlog-reminder",
    data:{url:"./"}
  };
  try{
    if(event.data)payload={...payload,...event.data.json()};
  }catch(_){
    if(event.data)payload.body=event.data.text()||payload.body;
  }

  event.waitUntil((async()=>{
    await self.registration.showNotification("Watch Logger Reminder",{
      body:payload.body||"A reminder is ready.",
      tag:payload.tag||"watchlog-reminder",
      renotify:true,
      data:payload.data||{url:"./"}
    });
    if(!payload.data?.test&&(payload.data?.kind==="reminder"||payload.data?.eventKey)){
      try{
        const windows=await self.clients.matchAll({type:"window"});
        if(!windows.some(client=>client.visibilityState==="visible"))await self.navigator?.setAppBadge?.();
      }catch(_){}
    }
  })());
});

function notificationUrlWithinScope(value){
  const scopeUrl=new URL(self.registration.scope);
  try{
    const requestedUrl=new URL(value||"./",scopeUrl);
    const scopePath=scopeUrl.pathname.endsWith("/")?scopeUrl.pathname:scopeUrl.pathname+"/";
    const scopeRoot=scopePath.slice(0,-1);
    const insideScope=requestedUrl.origin===scopeUrl.origin&&(
      scopePath==="/"||requestedUrl.pathname===scopeRoot||requestedUrl.pathname.startsWith(scopePath)
    );
    return insideScope?requestedUrl.href:scopeUrl.href;
  }catch(_){
    return scopeUrl.href;
  }
}

self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const appUrl=notificationUrlWithinScope(event.notification.data?.url);
  event.waitUntil(
    (async()=>{
      const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
      const existing=windows.find(client=>client.url.startsWith(self.registration.scope));
      if(existing){
        try{
          const target="navigate" in existing?(await existing.navigate(appUrl)||existing):existing;
          return await target.focus();
        }catch(_){}
      }
      return self.clients.openWindow?self.clients.openWindow(appUrl):undefined;
    })()
  );
});
