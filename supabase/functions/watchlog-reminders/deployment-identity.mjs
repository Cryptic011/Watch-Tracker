export const ACTIONS_ISSUER='https://token.actions.githubusercontent.com';
export const ACTIONS_AUDIENCE='watchlog-deployment-status';
const REPOSITORY='Cryptic011/Watched-Tracker';
const REPOSITORY_ID='1346271034';
const OWNER_ID='321054300';
const WORKFLOW_REF=REPOSITORY+'/.github/workflows/pages.yml@refs/heads/main';
const SUBJECTS=new Set([
  'repo:'+REPOSITORY+':environment:github-pages',
  'repo:Cryptic011@'+OWNER_ID+'/Watched-Tracker@'+REPOSITORY_ID+':environment:github-pages',
]);

// verifyToken must verify the signature against GitHub's fixed JWKS endpoint.
// Never authorize decoded claims before that verification has completed.
export async function authenticateDeploymentRequest(request,expected,verifyToken){
  const authorization=request.headers.get('authorization')||'';
  const match=authorization.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i);
  if(!match||match[1].length>20000)throw Error('Workflow identity required');
  const {payload}=await verifyToken(match[1],{
    issuer:ACTIONS_ISSUER,audience:ACTIONS_AUDIENCE,algorithms:['RS256'],
    requiredClaims:['sub','exp','iat','nbf','repository','repository_id','repository_owner_id','ref','sha','workflow_ref','environment','run_id','run_number','run_attempt','event_name'],
    maxTokenAge:'10m',clockTolerance:15,
  });
  if(payload.repository!==REPOSITORY||payload.repository_id!==REPOSITORY_ID||
    payload.repository_owner_id!==OWNER_ID||payload.ref!=='refs/heads/main'||
    payload.workflow_ref!==WORKFLOW_REF||payload.environment!=='github-pages'||
    !SUBJECTS.has(payload.sub)||!['push','workflow_dispatch'].includes(payload.event_name)||
    payload.sha!==expected.sha||payload.run_id!==expected.runId||
    payload.run_number!==expected.runNumber||payload.run_attempt!==expected.runAttempt){
    throw Error('Workflow identity does not match this deployment');
  }
  return payload;
}
