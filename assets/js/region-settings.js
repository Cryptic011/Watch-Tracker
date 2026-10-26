/* Device viewing region can differ from interface language and current timezone. */
function releaseViewingCountry(){
  let saved='';try{saved=localStorage.getItem('watchlog_release_country_'+(currentUser?.id||''))||'';}catch(_){}
  return WatchLogRegionalReleases.country({country:saved,timeZone:DEVICE_TIME_ZONE,locale:navigator.language||USER_LOCALE});
}
function regionalScheduleItem(item){
  return globalThis.WatchLogRegionalReleases?.resolve(item,{country:releaseViewingCountry()})||item;
}
function reminderViewingLocale(){
  const region=releaseViewingCountry();return region?(USER_LOCALE.split('-')[0]+'-'+region):USER_LOCALE;
}
const releaseCountryNames=new Intl.DisplayNames([USER_LOCALE],{type:'region'});
const releaseCountries='AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ').map(code=>[code,releaseCountryNames.of(code)]).sort((a,b)=>a[1].localeCompare(b[1]));
const regionSetting=document.createElement('div');regionSetting.className='form-group';
regionSetting.innerHTML='<label for="release-viewing-region">Viewing region</label><select id="release-viewing-region"><option value="">Automatic (device region)</option>'+releaseCountries.map(([code,name])=>`<option value="${code}">${name}</option>`).join('')+'</select><p class="small-note">Used for streaming release times and reminder delivery. Your device timezone controls how times are displayed. Regional times are shown only where a matching schedule has been checked.</p>';
document.querySelector('.appearance-card').prepend?.(regionSetting);
function updateReleaseRegionControl(){let value='';try{value=localStorage.getItem('watchlog_release_country_'+(currentUser?.id||''))||'';}catch(_){}document.getElementById('release-viewing-region').value=value;}
document.getElementById('release-viewing-region').onchange=async event=>{
  try{localStorage.setItem('watchlog_release_country_'+(currentUser?.id||''),event.target.value);}catch(_){}
  render();if(currentUser)await syncExistingBackgroundPush();
};
updateReleaseRegionControl();

let regionalRefreshAt=0,regionalRefreshCountry='';
function refreshRegionalReleaseSources(){
  if(!currentUser||!navigator.onLine)return;
  const country=releaseViewingCountry(),now=Date.now(),signature=country+':'+mediaItems.map(item=>item.tvmazeShowId+':'+item.nextEpisodeDate).sort().join('|');
  if(signature===regionalRefreshCountry&&now-regionalRefreshAt<6*3600000)return;
  regionalRefreshCountry=signature;regionalRefreshAt=now;
  void WatchLogRegionalReleases.refresh(mediaItems,{country,timeZone:DEVICE_TIME_ZONE}).then(()=>{if(currentUser&&country===releaseViewingCountry())render();});
}
function regionalScheduleEvent(item,event){const resolved=WatchLogRegionalReleases.resolveEvent(item,event,{country:releaseViewingCountry()});return {...resolved,streamingUnconfirmed:resolved.streamingUnconfirmed===true||(!resolved.releaseSchedule&&!item.releaseSchedule)};}
