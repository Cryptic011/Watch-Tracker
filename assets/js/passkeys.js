/* WebAuthn keys stay in the device password manager. Only public keys reach the server. */
(function(){
  const supported=Boolean(window.PublicKeyCredential&&navigator.credentials&&window.isSecureContext);
  const button=document.createElement('button');button.type='button';button.className='btn btn-secondary btn-full';button.id='passkey-sign-in';button.textContent='Sign in with a passkey';button.hidden=!supported;
  authForm.after(button);
  const section=document.createElement('section');section.className='sync-box';
  section.innerHTML='<h3>Face ID &amp; passkeys</h3><p class="small-note">Use Face ID, Touch ID or your device lock to sign in. Apple Passwords can sync your passkey through iCloud Keychain when enabled on your devices.</p><label for="passkey-current-pin">Current PIN</label><input id="passkey-current-pin" type="password" inputmode="numeric" maxlength="4" autocomplete="current-password"><button id="passkey-create" type="button" class="btn btn-secondary btn-full">Add a passkey</button><p id="passkey-status" role="status"></p><div id="passkey-list"></div>';
  document.querySelector('.library-backup').before(section);
  if(!supported){$('passkey-create').disabled=true;$('passkey-status').textContent='Passkeys are not supported in this browser. Use your email and PIN.';}
  const from64=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),char=>char.charCodeAt(0));
  const to64=value=>btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  function optionsJSON(options){
    const result={...options,challenge:from64(options.challenge)};
    if(options.user)result.user={...options.user,id:from64(options.user.id)};
    for(const name of ['allowCredentials','excludeCredentials'])if(options[name])result[name]=options[name].map(row=>({...row,id:from64(row.id)}));
    return result;
  }
  function responseJSON(credential){
    const response={};
    for(const name of ['clientDataJSON','attestationObject','authenticatorData','signature','userHandle'])if(credential.response[name])response[name]=to64(credential.response[name]);
    if(credential.response.getTransports)response.transports=credential.response.getTransports();
    return {id:credential.id,rawId:to64(credential.rawId),type:credential.type,authenticatorAttachment:credential.authenticatorAttachment,clientExtensionResults:credential.getClientExtensionResults(),response};
  }
  function message(error){return ['NotAllowedError','AbortError'].includes(error?.name)?'Passkey sign-in was cancelled. You can try again or use your PIN.':error.message||'Passkey operation could not be completed.';}
  async function list(){
    if(!currentUser||navigator.onLine===false)return;
    try{
      const {passkeys=[]}=await pinApi('passkey_list');
      $('passkey-list').replaceChildren();
      for(const row of passkeys){
        const line=document.createElement('div');line.className='notification-actions';
        const label=document.createElement('span');label.textContent=row.label+' · '+formatLocalDate(new Date(row.created_at));
        const remove=document.createElement('button');remove.type='button';remove.className='btn btn-secondary';remove.textContent='Remove';
        remove.onclick=async()=>{remove.disabled=true;try{await pinApi('passkey_remove',{id:row.id});await list();}catch(error){$('passkey-status').textContent=message(error);remove.disabled=false;}};
        line.append(label,remove);$('passkey-list').append(line);
      }
    }catch(error){$('passkey-status').textContent=message(error);}
  }
  button.onclick=async()=>{
    if(navigator.onLine===false){showMessage('Passkey sign-in needs a connection. Your saved session can reopen offline.');return;}
    button.disabled=true;hideMessage();
    try{
      const data=await pinApi('passkey_auth_options',{},'');
      const credential=await navigator.credentials.get({publicKey:optionsJSON(data.options)});
      if(!credential)return;
      const result=await pinApi('passkey_auth_verify',{challengeId:data.challengeId,response:responseJSON(credential)},'');
      await establishCloudSession(result,result.items||[],result.items||[]);
    }catch(error){showMessage(message(error));}
    finally{button.disabled=false;}
  };
  $('passkey-create').onclick=async()=>{
    const create=$('passkey-create'),pin=$('passkey-current-pin');create.disabled=true;
    try{
      const data=await pinApi('passkey_register_options',{pin:pin.value});pin.value='';
      const credential=await navigator.credentials.create({publicKey:optionsJSON(data.options)});
      if(!credential)return;
      await pinApi('passkey_register_verify',{challengeId:data.challengeId,response:responseJSON(credential)});
      $('passkey-status').textContent='Passkey added. You can use it the next time you sign in.';
      await list();
    }catch(error){$('passkey-status').textContent=message(error);}
    finally{pin.value='';create.disabled=!supported;}
  };
  document.querySelector('[data-settings-open="account"]').addEventListener('click',()=>void list());
  newPinInput.addEventListener('input',()=>{$('passkey-status').textContent='Changing or resetting your PIN also revokes existing passkeys.';});
})();
