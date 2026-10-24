  // Catalogue discovery shares the existing search and editor; it never writes
  // a library record until the user saves through the normal editor.
  let discoveryRows=[],discoveryFilter="All",discoveryQuery="",discoveryOwner="";
  let discoveryRequest=0,discoveryController=null,discoveryTimer=null,discoveryLoading=false,discoveryError=false;
  let discoveryDetailItem=null,discoveryReturnFocus=null;
  const discoveryInput=$("discovery-query"),discoveryResults=$("discovery-results"),discoveryStatus=$("discovery-status"),discoveryDialog=$("discovery-detail");

  function discoveryImage(value){
    try{const url=new URL(value);return url.protocol==="https:"&&(/^(?:static\.tvmaze\.com|m\.media-amazon\.com|images-na\.ssl-images-amazon\.com)$/.test(url.hostname)||/^[a-z0-9.-]+\.mzstatic\.com$/.test(url.hostname))?url.href:"";}catch(_){return"";}
  }
  function discoveryDescription(item){
    const entities={amp:"&",quot:'"',apos:"'",lt:"<",gt:">",nbsp:" "};
    return String(item.description||"").replace(/<[^>]*>/g," ").replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|quot|apos|lt|gt|nbsp));/gi,(whole,decimal,hex,name)=>{
      if(name)return entities[name.toLowerCase()];
      const code=parseInt(decimal||hex,decimal?10:16);return code>0&&code<=0x10ffff?String.fromCodePoint(code):whole;
    }).replace(/\s+/g," ").trim();
  }
  function discoveryDuplicate(item){
    return findTrackedDuplicate({title:item.title,type:item.format,imdbId:item.imdbId||(item.source==="imdb"?item.externalId:""),tvmazeShowId:item.tvmazeId||(item.source==="tvmaze"?item.externalId:""),releaseYear:item.year});
  }
  function discoveryAttribution(item){
    if(typeof titleDetailsSourceLinks==="function"){
      const details=item.verifiedDetails||{sources:item.source==="tvmaze"&&item.tvmazeId?[{name:"TVMaze",url:`https://www.tvmaze.com/shows/${item.tvmazeId}`}]:item.source==="apple"&&item.storeUrl?[{name:"Apple TV",url:item.storeUrl}]:[]};
      const links=titleDetailsSourceLinks(details);if(links)return `<span class="discovery-source">Sources: ${links}</span>`;
    }
    return "";
  }
  function discoveryPoster(item){
    const image=discoveryImage(item.posterUrl),initials=String(item.title||"?").split(/\s+/).slice(0,2).map(word=>word[0]).join("");
    return `<span class="discovery-poster"><span aria-hidden="true">${esc(initials)}</span>${image?`<img src="${esc(image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:""}</span>`;
  }
  function discoveryDescriptionMarkup(item){
    const description=discoveryDescription(item);
    return description?`<details class="discovery-description"><summary aria-label="Description of ${esc(item.title)}"><span class="discovery-preview">${esc(description)}</span><span class="discovery-more" aria-hidden="true"></span></summary><p>${esc(description)}</p>${discoveryAttribution(item)}</details>`:'<p class="discovery-unavailable">Description unavailable.</p>';
  }
  function discoveryCard(item,index){
    const duplicate=discoveryDuplicate(item),meta=[item.year,item.format,item.detail&&!/^(?:film|series|tv series|tvseries)$/i.test(item.detail)?item.detail:""].filter(Boolean).join(" · ");
    return `<article class="discovery-card" data-discovery-row="${index}"><button type="button" class="discovery-poster-button" data-discovery-open="${index}" aria-label="Details for ${esc(item.title)}">${discoveryPoster(item)}</button><div class="discovery-copy"><button type="button" class="discovery-title" data-discovery-open="${index}">${esc(item.title)}</button><p class="discovery-meta">${esc(meta)}</p>${discoveryDescriptionMarkup(item)}<div class="discovery-actions"><span class="discovery-added${duplicate?"":" hidden"}" data-discovery-badge="${index}">✓ Already added</span><button type="button" data-discovery-add="${index}">${duplicate?"View in library":"+ Add"}</button></div></div></article>`;
  }
  function wireDiscoveryImages(root){
    root.querySelectorAll(".discovery-poster img").forEach(img=>img.addEventListener("error",()=>{img.hidden=true;},{once:true}));
  }
  function renderTitleSearch(){
    $("discovery-browse")?.classList.toggle("hidden",discoveryQuery.length>=2);
    const expanded=new Set([...discoveryResults.querySelectorAll("[data-discovery-row]")].filter(row=>row.querySelector("details")?.open).map(row=>row.dataset.discoveryRow));
    const visible=discoveryRows.map((item,index)=>({item,index})).filter(({item})=>["Film","Series"].includes(item.format)&&(discoveryFilter==="All"||item.format===discoveryFilter));
    const markup=visible.map(({item,index})=>discoveryCard(item,index)).join("");
    if(discoveryResults._discoveryMarkup!==markup){
      discoveryResults.innerHTML=markup;discoveryResults._discoveryMarkup=markup;
      discoveryResults.querySelectorAll("[data-discovery-row]").forEach(row=>{if(expanded.has(row.dataset.discoveryRow)&&row.querySelector("details"))row.querySelector("details").open=true;});
      wireDiscoveryImages(discoveryResults);
    }
    discoveryResults.setAttribute("aria-busy",String(discoveryLoading));
    $("discovery-retry").classList.toggle("hidden",!discoveryError);
    document.querySelectorAll("[data-discovery-filter]").forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.discoveryFilter===discoveryFilter)));
    discoveryStatus.textContent=discoveryLoading?"Searching shows and films…":discoveryError?"Search is unavailable right now. Please try again.":discoveryQuery.length<2?"Enter at least two characters to search.":visible.length?`${visible.length} result${visible.length===1?"":"s"} for “${discoveryQuery}”`:"No matching titles. Try another spelling or choose All.";
  }
  function pauseTitleSearch(){
    clearTimeout(discoveryTimer);discoveryTimer=null;discoveryController?.abort();discoveryController=null;discoveryRequest++;discoveryLoading=false;
    if(discoveryDialog.open)discoveryDialog.close();
  }
  function resetTitleSearch(){
    pauseTitleSearch();discoveryRows=[];discoveryQuery="";discoveryOwner=String(currentUser?.id||"");discoveryInput.value="";discoveryFilter="All";discoveryError=false;discoveryDetailItem=null;
    discoveryResults.replaceChildren();discoveryResults._discoveryMarkup=null;$("discovery-detail-body").replaceChildren();
  }
  function activateTitleSearch(){
    if(discoveryOwner!==String(currentUser?.id||""))resetTitleSearch();
    renderTitleSearch();
    if(discoveryInput.value.trim().length>=2&&!discoveryRows.length)void runTitleSearch();
  }
  function openTitleSearch(){
    switchTab("search");discoveryInput.focus();
  }
  async function runTitleSearch(){
    clearTimeout(discoveryTimer);discoveryController?.abort();
    const query=discoveryInput.value.trim(),request=++discoveryRequest,owner=String(currentUser?.id||"");
    discoveryQuery=query;discoveryError=false;
    if(!currentUser||query.length<2){discoveryRows=[];discoveryLoading=false;renderTitleSearch();return;}
    const controller=new AbortController();discoveryController=controller;discoveryLoading=true;renderTitleSearch();
    if(typeof recordAppNavigation==="function")recordAppNavigation();
    const isCurrent=()=>request===discoveryRequest&&currentTab==="search"&&String(currentUser?.id||"")===owner&&discoveryInput.value.trim()===query;
    try{
      const rows=await searchAllTitles(query,{signal:controller.signal,isCurrent,onProgress:partial=>{
        if(isCurrent()){discoveryRows=partial;renderTitleSearch();}
      }});
      if(isCurrent()){
        discoveryRows=rows;discoveryLoading=false;renderTitleSearch();
        await enrichDiscoveryDescriptions(controller.signal,isCurrent);
      }
    }catch(error){
      if(isCurrent()&&!controller.signal.aborted){discoveryLoading=false;discoveryError=true;renderTitleSearch();}
    }finally{if(discoveryController===controller)discoveryController=null;}
  }
  async function fetchDiscoveryDescription(item,signal){
    if(signal?.aborted||typeof fetchOfficialTitleDetails!=="function")return "";
    const details=await fetchOfficialTitleDetails({...item,type:item.format});
    if(details.description&&!signal?.aborted){item.verifiedDetails=details;return details.description;}
    return "";
  }
  async function enrichDiscoveryDescriptions(signal,isCurrent){
    const queue=discoveryRows.filter(item=>item.format==="Film"&&!discoveryDescription(item)).slice(0,6);
    await Promise.all([0,1].map(async()=>{
      while(queue.length&&isCurrent()&&!signal.aborted){
        const item=queue.shift();
        try{
          const description=await fetchDiscoveryDescription(item,signal);
          if(description&&isCurrent()){
            item.description=description;item.descriptionSource=item.verifiedDetails?.descriptionSource||item.verifiedDetails?.source||"";
            const index=discoveryRows.indexOf(item),row=discoveryResults.querySelector(`[data-discovery-row="${index}"]`);
            const placeholder=row?.querySelector('.discovery-unavailable');
            if(placeholder){placeholder.outerHTML=discoveryDescriptionMarkup(item);discoveryResults._discoveryMarkup=null;}
            if(discoveryDialog.open&&discoveryDetailItem===item){
              const paragraph=$("discovery-detail-body").querySelector(".discovery-full-description");if(paragraph){paragraph.textContent=description;const citation=$("discovery-detail-body").querySelector('[data-discovery-detail-source]');if(citation)citation.innerHTML=discoveryAttribution(item);}
            }
          }
        }catch(_){} // Missing metadata must not prevent selecting or adding.
      }
    }));
  }
  function refreshTitleSearchBadges(){
    if(discoveryOwner!==String(currentUser?.id||"")){resetTitleSearch();return;}
    if(currentTab!=="search")return;
    discoveryResults.querySelectorAll("[data-discovery-row]").forEach(row=>{
      const item=discoveryRows[Number(row.dataset.discoveryRow)];if(!item)return;
      const duplicate=discoveryDuplicate(item);
      const badge=row.querySelector("[data-discovery-badge]"),button=row.querySelector("[data-discovery-add]");
      const label=duplicate?"View in library":"+ Add";
      if(badge.classList.contains("hidden")===Boolean(duplicate)||button.textContent!==label){
        badge.classList.toggle("hidden",!duplicate);button.textContent=label;discoveryResults._discoveryMarkup=null;
      }
    });
  }
  function addDiscoveryTitle(item){
    if(!item||!currentUser)return;
    if(discoveryDialog.open)discoveryDialog.close();
    const duplicate=discoveryDuplicate(item);
    if(duplicate){openMediaRow(duplicate.id);return;}
    openAdd();void selectSuggestion(item);
  }
  function showDiscoveryDetail(item,trigger){
    if(!item)return;discoveryDetailItem=item;discoveryReturnFocus=trigger;
    $("discovery-detail-title").textContent=item.title;
    $("discovery-detail-body").innerHTML=`<div class="discovery-detail-intro">${discoveryPoster(item)}<div><p class="discovery-meta">${esc([item.year,item.format,item.detail].filter(Boolean).join(" · "))}</p>${discoveryDuplicate(item)?'<p class="discovery-added">✓ Already added</p>':""}</div></div><p class="discovery-full-description">${esc(discoveryDescription(item)||"Checking verified sources…")}</p><p data-discovery-detail-source>${discoveryAttribution(item)}</p><button type="button" class="btn btn-primary btn-full" id="discovery-detail-add">${discoveryDuplicate(item)?"View in library":"Add to library"}</button>`;
    wireDiscoveryImages($("discovery-detail-body"));
    $("discovery-detail-add").onclick=()=>addDiscoveryTitle(discoveryDetailItem);
    discoveryDialog.showModal();
    if(typeof fetchOfficialTitleDetails==="function")void fetchOfficialTitleDetails({...item,type:item.format}).then(details=>{
      if(!discoveryDialog.open||discoveryDetailItem!==item)return;
      if(details.description){item.description=details.description;item.verifiedDetails=details;}
      const body=$("discovery-detail-body");body.querySelector('.discovery-full-description').textContent=discoveryDescription(item)||"A verified description is temporarily unavailable.";
      body.querySelector('[data-discovery-detail-source]').innerHTML=discoveryAttribution(item);
    }).catch(()=>{});
  }
  discoveryInput.addEventListener("input",()=>{
    clearTimeout(discoveryTimer);discoveryController?.abort();discoveryRequest++;discoveryRows=[];discoveryQuery=discoveryInput.value.trim();discoveryError=false;
    discoveryLoading=discoveryQuery.length>=2;renderTitleSearch();
    if(discoveryLoading)discoveryTimer=setTimeout(()=>void runTitleSearch(),280);
  });
  $("discovery-form").addEventListener("submit",event=>{event.preventDefault();void runTitleSearch();});
  $("discovery-retry").onclick=()=>void runTitleSearch();
  document.querySelectorAll("[data-browse-format]").forEach(button=>button.onclick=()=>{discoveryFilter=button.dataset.browseFormat;renderTitleSearch();discoveryInput.placeholder=discoveryFilter==="Film"?"Search movies":"Search series";discoveryInput.focus();});
  $("discovery-manual").onclick=()=>{if(!currentUser)return;openAdd();titleInput.value=discoveryInput.value.trim();titleInput.focus();};
  document.querySelectorAll("[data-discovery-filter]").forEach(button=>button.onclick=()=>{discoveryFilter=button.dataset.discoveryFilter;renderTitleSearch();if(typeof recordAppNavigation==="function")recordAppNavigation();});
  discoveryResults.addEventListener("click",event=>{
    const add=event.target.closest("[data-discovery-add]");if(add){addDiscoveryTitle(discoveryRows[Number(add.dataset.discoveryAdd)]);return;}
    const open=event.target.closest("[data-discovery-open]");if(open)showDiscoveryDetail(discoveryRows[Number(open.dataset.discoveryOpen)],open);
  });
  $("discovery-close").onclick=()=>discoveryDialog.close();
  discoveryDialog.addEventListener("click",event=>{if(event.target===discoveryDialog)discoveryDialog.close();});
  discoveryDialog.addEventListener("close",()=>{if(discoveryReturnFocus?.isConnected)discoveryReturnFocus.focus();discoveryReturnFocus=null;});
