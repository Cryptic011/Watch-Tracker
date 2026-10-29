import '../assets/js/deployment-channel.js';
const {config}=globalThis.WatchLogDeployment;
const sha=process.env.WATCHLOG_SOURCE_SHA;
const page=process.env.WATCHLOG_PAGE_URL||'';
let status=String(process.env.WATCHLOG_STATUS||'success');
let healthCheckFailed=false;
const runNumber=String(process.env.WATCHLOG_SOURCE_RUN_NUMBER||'');
const runId=String(process.env.WATCHLOG_SOURCE_RUN_ID||'');
const runAttempt=String(process.env.WATCHLOG_SOURCE_RUN_ATTEMPT||'1');
let failureSummary=String(process.env.WATCHLOG_FAILURE_SUMMARY||'').slice(0,1200);
if(!/^[a-f0-9]{40}$/.test(sha||''))throw Error('Source deployment SHA is required');
if(!/^\d+$/.test(runId)||!/^\d+$/.test(runNumber)||!/^\d+$/.test(runAttempt))throw Error('Source run ID, run number and run attempt are required');
if(page){const site=new URL(page);if(site.protocol!=='https:')throw Error('Expected HTTPS deployment URL');}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
if(status==='success'&&page){
  const site=new URL(page);let ready=false,lastError='';
  for(let attempt=0;attempt<12;attempt++){
    try{
      const urls=[new URL(site),new URL('build-info.js',site)];
      const sources=await Promise.all(urls.map(async url=>{url.searchParams.set('deployment',`${sha}-${attempt}`);const result=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!result.ok)throw Error(`Pages returned ${result.status}`);return result.text();}));
      ready=sources.every(source=>source.includes(`"sha":"${sha}"`));if(ready)break;
      lastError='Deployed page/build-info SHA does not match this workflow run.';
    }catch(error){lastError=error.message;console.log(`Waiting for deployed content: ${lastError}`);}
    await sleep(5000);
  }
  if(!ready){healthCheckFailed=true;status='failure';failureSummary=`Post-deployment health check failed: ${lastError||'Pages did not serve the expected commit.'}. Restore the previous Pages artifact or rerun deployment after checking Pages status.`.slice(0,1200);}
}
async function broadcast(event,payload){
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetch(`${config.url}/realtime/v1/api/broadcast`,{
        method:'POST',headers:{apikey:config.key,Authorization:`Bearer ${config.key}`,'Content-Type':'application/json'},
        body:JSON.stringify({messages:[{topic:config.topic,event,payload,private:false}]}),
        signal:AbortSignal.timeout(10000),
      });
      if(!response.ok)throw Error(`Broadcast returned ${response.status}`);
      return true;
    }catch(error){if(attempt===2)throw error;await sleep(2000);}
  }
}
try{
const identityUrl=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL||'');
if(identityUrl.protocol!=='https:'||!identityUrl.hostname.endsWith('.actions.githubusercontent.com')||!process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)throw Error('GitHub workflow identity is unavailable');
identityUrl.searchParams.set('audience','watchlog-deployments');
const identityResponse=await fetch(identityUrl,{headers:{Authorization:`Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`},signal:AbortSignal.timeout(10000)});
if(!identityResponse.ok)throw Error('GitHub workflow identity request failed');
const identity=await identityResponse.json();
if(typeof identity.value!=='string'||!identity.value)throw Error('GitHub workflow identity was incomplete');
const response=await fetch(`${config.url}/functions/v1/watchlog-reminders`,{
  method:'POST',
  headers:{apikey:config.key,Authorization:`Bearer ${config.key}`,'Content-Type':'application/json','X-WatchLog-Deployment':identity.value},
  body:JSON.stringify({action:'deployment_status',runId,runNumber,runAttempt,failureSummary,sha,status,commitUrl:`https://github.com/Cryptic011/Watched-Tracker/commit/${sha}`}),
  signal:AbortSignal.timeout(15000),
});
if(!response.ok){
  const detail=(await response.text()).slice(0,1000);
  console.warn(`Private run-status notification unavailable (${response.status}): ${detail}`);
}else{
  const delivery=await response.json();
  const delivered=Number(delivery.delivered||0), failed=Number(delivery.failed||0);
  console.log(`Private run-status notification processed: ${status}; delivered ${delivered}; failed ${failed}`);
  if(!delivery.ok||(!delivery.duplicate&&delivered<1)||failed>0)console.warn(`Private run-status notification was not fully delivered: ${JSON.stringify({ok:delivery.ok,delivered,failed,reason:delivery.reason||null})}`);
}
}catch(_){console.warn('Private run-status notification unavailable: signed workflow identity or notification service could not be verified.');}

if(status!=='success'||!page){console.log(`Deployment status sent: ${status} for ${sha}`);if(healthCheckFailed)process.exit(1);process.exit(0);}
await broadcast(config.event,{sha});
console.log(`Deployment signal sent for ${sha}`);
