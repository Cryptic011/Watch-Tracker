// Keep app navigation outside the web view's scrolling/compositing layers.
export function installNativeControls(Native){
  let frame=0,last='',generation=0;
  const hidden=element=>!element||element.hidden||element.classList.contains('hidden');
  function openSearch(query=''){
    openTitleSearch(query);
  }
  async function sync(){
    frame=0;
    const overlay=Boolean(document.querySelector('dialog[open]'))||['modal','episode-tracker-modal'].some(id=>!hidden(document.getElementById(id)));
    const state={visible:Boolean(currentUser&&authScreen.classList.contains('hidden')&&!overlay),tab:['settings','search'].includes(currentTab)?currentTab:'library',searchVisible:currentTab==='library'&&!hidden(document.getElementById('add-btn')),dark:document.documentElement.dataset.theme==='dark'};
    const key=JSON.stringify(state);if(key===last)return;
    last=key;const request=++generation;
    try{
      const result=await Native.updateControls(state);
      if(request===generation)document.documentElement.classList.toggle('watchlog-native-controls',result.ready===true);
    }catch(_){if(request===generation){last='';document.documentElement.classList.remove('watchlog-native-controls');}}
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(sync);}
  new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden','open','data-theme','data-active-tab']});
  window.addEventListener('watchlog:native-control',event=>{
    if(event.detail==='search'||event.detail==='add')openSearch();
    else if(['library','settings'].includes(event.detail))document.querySelector(`.bottom-tabs [data-tab="${event.detail}"]`)?.click();
  });
  schedule();
}
