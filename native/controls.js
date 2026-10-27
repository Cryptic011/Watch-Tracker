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
    const state={visible:Boolean(currentUser&&authScreen.classList.contains('hidden')&&!overlay&&!document.documentElement.classList.contains('search-keyboard-open')),tab:document.querySelector('.bottom-tabs')?.dataset.activeTab||'library',searchVisible:currentTab==='library'&&!hidden(document.getElementById('add-btn')),dark:document.documentElement.dataset.theme==='dark'};
    const key=JSON.stringify(state);if(key===last)return;
    last=key;const request=++generation;
    try{
      const result=await Native.updateControls(state);
      if(request===generation)document.documentElement.classList.toggle('watchlog-native-controls',result.ready===true);
    }catch(_){if(request===generation){last='';document.documentElement.classList.remove('watchlog-native-controls');}}
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(sync);}
  const observer=new MutationObserver(schedule);
  for(const element of [document.documentElement,authScreen,document.getElementById('add-btn'),document.getElementById('modal'),document.getElementById('episode-tracker-modal'),document.querySelector('.bottom-tabs')]){
    if(element)observer.observe(element,{attributes:true,attributeFilter:['class','hidden','data-theme','data-active-tab']});
  }
  document.addEventListener('toggle',event=>{if(event.target.tagName==='DIALOG')schedule();},true);
  window.addEventListener('watchlog:native-control',event=>{
    if(event.detail==='search'||event.detail==='add')openSearch();
    else if(['library','settings'].includes(event.detail))document.querySelector(`.bottom-tabs [data-tab="${event.detail}"]`)?.click();
  });
  schedule();
}
