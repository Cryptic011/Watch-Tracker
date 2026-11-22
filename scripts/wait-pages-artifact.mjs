import {setTimeout as delay} from 'node:timers/promises';

export async function waitForPagesArtifact({apiUrl,repository,runId,artifactName,artifactId,token}, {request=fetch,pause=delay}={}){
  const url=new URL(`${apiUrl}/repos/${repository}/actions/runs/${runId}/artifacts`);
  url.searchParams.set('name',artifactName);
  let result='artifact unavailable';
  for(let attempt=1;attempt<=10;attempt++){
    await pause(2000);
    try{
      const response=await request(url,{
        headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'},
        signal:AbortSignal.timeout(3000)
      });
      if(!response.ok){
        result=`GitHub returned HTTP ${response.status}`;
        continue;
      }
      const {artifacts}=await response.json();
      const matches=artifacts.filter(artifact=>artifact.name===artifactName&&!artifact.expired);
      if(matches.length===1&&String(matches[0].id)===String(artifactId))return;
      result=`expected artifact ID ${artifactId}, visible IDs ${matches.map(artifact=>artifact.id).join(', ')||'none'}`;
    }catch(error){
      result=error.message;
    }
  }
  throw new Error(`Pages artifact "${artifactName}" did not become available after 10 checks (${result}).`);
}

if(import.meta.main){
  await waitForPagesArtifact({
    apiUrl:process.env.GITHUB_API_URL,
    repository:process.env.GITHUB_REPOSITORY,
    runId:process.env.GITHUB_RUN_ID,
    artifactName:process.env.PAGES_ARTIFACT_NAME,
    artifactId:process.env.PAGES_ARTIFACT_ID,
    token:process.env.GH_TOKEN
  });
}
