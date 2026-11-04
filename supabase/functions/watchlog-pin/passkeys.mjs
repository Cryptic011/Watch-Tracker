import {generateRegistrationOptions,verifyRegistrationResponse,generateAuthenticationOptions,verifyAuthenticationResponse} from "npm:@simplewebauthn/server@14.0.3";

const origin="https://cryptic011.github.io",rpID="cryptic011.github.io";
const encode=bytes=>btoa(String.fromCharCode(...bytes));
const decode=value=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));
export async function passkeyAction(req,body,context){
  const {db,session,createSession,readLibrary,derivePin,unb64,safeEqual,readMaintenance,isMaintenanceAdmin}=context;
  const action=String(body.action||"");
  if(req.headers.get("Origin")!==origin)return {status:403,body:{error:"Use passkeys from the Watch Tracker website."}};
  const fail=(message="Passkey verification failed. Try again.",status=400)=>({status,body:{error:message,code:"passkey_error"}});
  const checked=async query=>{const result=await query;if(result.error)throw result.error;return result.data;};
  async function consume(kind){
    if(!/^[0-9a-f-]{36}$/.test(String(body.challengeId||"")))return null;
    return checked(db.from("watchlog_passkey_challenges").delete().eq("id",body.challengeId).eq("kind",kind).gt("expires_at",new Date().toISOString()).select("*").maybeSingle());
  }
  async function challenge(options,kind,accountId=null){
    await checked(db.from("watchlog_passkey_challenges").delete().lt("expires_at",new Date().toISOString()));
    const {count,error}=await db.from("watchlog_passkey_challenges").select("id",{count:"exact",head:true});
    if(error)throw error;
    if(count>5000)return fail("Please try passkey sign-in shortly.",429);
    const row=await checked(db.from("watchlog_passkey_challenges").insert({challenge:options.challenge,kind,account_id:accountId,expires_at:new Date(Date.now()+300000).toISOString()}).select("id").single());
    return {status:200,body:{ok:true,options,challengeId:row.id}};
  }
  if(action==="passkey_auth_options"){
    return challenge(await generateAuthenticationOptions({rpID,userVerification:"required"}),"authentication");
  }
  if(action==="passkey_auth_verify"){
    const pending=await consume("authentication");if(!pending)return fail("This passkey request expired. Try again.");
    const response=body.response;if(!response||typeof response.id!=="string"||response.id.length>2048)return fail();
    const credential=await checked(db.from("watchlog_passkeys").select("*").eq("id",response.id).maybeSingle());
    if(!credential)return fail();
    let verified;
    try{verified=await verifyAuthenticationResponse({response,expectedChallenge:pending.challenge,expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true,credential:{id:credential.id,publicKey:decode(credential.public_key),counter:Number(credential.counter),transports:credential.transports||[]}});}
    catch(_){return fail();}
    if(!verified.verified)return fail();
    const maintenance=await readMaintenance();
    if(maintenance.enabled&&!await isMaintenanceAdmin(credential.account_id))return {status:503,body:{error:maintenance.message,code:"maintenance",maintenance:true}};
    const updated=await checked(db.from("watchlog_passkeys").update({counter:verified.authenticationInfo.newCounter,last_used_at:new Date().toISOString()}).eq("id",credential.id).eq("counter",credential.counter).select("id").maybeSingle());
    if(!updated)return fail("Another passkey request completed first. Try again.");
    const account=await checked(db.from("watchlog_pin_accounts").select("id,email,display_name,preferences").eq("id",credential.account_id).single());
    const token=await createSession(account.id),library=await readLibrary(account.id);
    return {status:200,body:{ok:true,account:{id:account.id,email:account.email,displayName:account.display_name,preferences:account.preferences||{}},items:library.items||[],revision:Number(library.revision||0),sessionToken:token.token,expiresAt:token.expiresAt}};
  }
  if(!session)return fail("Sign in before managing passkeys.",401);
  if(action==="passkey_list"){
    const rows=await checked(db.from("watchlog_passkeys").select("id,label,created_at,last_used_at").eq("account_id",session.accountId).order("created_at",{ascending:false}));
    return {status:200,body:{ok:true,passkeys:rows}};
  }
  if(action==="passkey_remove"){
    await checked(db.from("watchlog_passkeys").delete().eq("id",String(body.id||"")).eq("account_id",session.accountId));
    return {status:200,body:{ok:true}};
  }
  if(action==="passkey_register_options"){
    const account=await checked(db.from("watchlog_pin_accounts").select("id,email,display_name,pin_hash,pin_salt,locked_until").eq("id",session.accountId).single());
    if(account.locked_until&&Date.parse(account.locked_until)>Date.now())return fail("Account verification is temporarily locked.",429);
    if(!/^\d{4}$/.test(String(body.pin||""))||!safeEqual(await derivePin(body.pin,unb64(account.pin_salt)),account.pin_hash)){
      await checked(db.rpc("watchlog_record_pin_failure",{p_account_id:account.id,p_max_attempts:5,p_lock_minutes:15}));
      return fail("The current PIN is incorrect.",401);
    }
    const credentials=await checked(db.from("watchlog_passkeys").select("id,transports").eq("account_id",session.accountId));
    if(credentials.length>=10)return fail("Remove an old passkey before adding another.");
    const options=await generateRegistrationOptions({rpName:"Watch Tracker",rpID,userID:new TextEncoder().encode(account.id),userName:account.email,userDisplayName:account.display_name,attestationType:"none",excludeCredentials:credentials.map(row=>({id:row.id,transports:row.transports||[]})),authenticatorSelection:{residentKey:"required",userVerification:"required"},supportedAlgorithmIDs:[-7,-257]});
    return challenge(options,"registration",account.id);
  }
  if(action==="passkey_register_verify"){
    const pending=await consume("registration");
    if(!pending||pending.account_id!==session.accountId)return fail("This passkey request expired. Try again.");
    let result;
    try{result=await verifyRegistrationResponse({response:body.response,expectedChallenge:pending.challenge,expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true});}
    catch(_){return fail();}
    if(!result.verified||!result.registrationInfo)return fail();
    const {credential,credentialDeviceType,credentialBackedUp}=result.registrationInfo;
    await checked(db.from("watchlog_passkeys").insert({id:credential.id,account_id:session.accountId,public_key:encode(credential.publicKey),counter:credential.counter,transports:credential.transports||[],device_type:credentialDeviceType,backed_up:credentialBackedUp,label:"Passkey"}));
    return {status:200,body:{ok:true}};
  }
  return fail("Unknown passkey operation.");
}
