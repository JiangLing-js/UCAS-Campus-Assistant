// Serialized into an isolated world. Keep all page logic inside this function.
function campusLoginPage(provider, action='inspect', credentials=null) {
 const spec={sep:{origin:'https://sep.ucas.ac.cn',user:'#userName1',password:'#pwd1',button:'#sb1'},mail:{origin:'https://mail.cstnet.cn',user:'#uid',password:'#password',button:'button.j-submit'}}[provider];
 if(!spec||location.origin!==spec.origin||window.top!==window)return {state:'unsupported'};
 const visible=el=>!!el&&el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none';
 const first=selector=>[...document.querySelectorAll(selector)].find(visible);
 if(provider==='sep'&&location.pathname==='/sepCard/card'&&first('#sepTabNav'))return {state:'authenticated'};
 if(provider==='mail'&&location.pathname.startsWith('/coremail/XT5/')&&first('#mltree_1_a'))return {state:'authenticated'};
 if(action!=='observe'&&document.readyState!=='complete')return {state:'loading'};
 const challenge=()=>[...document.querySelectorAll('input:not([type="hidden"]),iframe')].some(el=>visible(el)&&/captcha|verify|otp|sms|two.?factor|验证码|动态密码|短信|手机号码/i.test([el.name,el.id,el.getAttribute('placeholder'),el.getAttribute('title'),el.getAttribute('src')].filter(Boolean).join(' ')))||!!first('[class*="captcha"], [id*="captcha"], [class*="geetest"], [class*="verify-slider"]')||[...document.querySelectorAll('[role="dialog"],.modal,.dialog')].some(el=>visible(el)&&/二次验证|两步验证|身份验证|扫码验证|安全验证|动态口令/.test(el.textContent));
 if(challenge())return {state:'manual_required'};
 if(action==='observe') {
  const alert=first('[role="alert"],.error,.error-msg,.errMsg,.j-error,.login-error,.u-error');
  if(alert?.textContent.trim())return {state:'rejected'};
  return {state:'waiting'};
 }
 const user=first(spec.user),password=first(spec.password),button=first(spec.button);
 if(!user||!password||!button||user.disabled||password.disabled||password.type!=='password'||button.disabled)return {state:'unsupported'};
 const form=provider==='sep'?document.querySelector('form#sepform'):user.closest('form');
 if(!form||form.method.toLowerCase()!=='post'||(provider==='mail'&&(password.form!==form||button.form!==form)))return {state:'unsupported'};
 const target=new URL(form.getAttribute('action')||'',location.href);
 if(target.origin!==spec.origin||target.username||target.password||target.pathname!==(provider==='sep'?'/slogin':'/coremail/index.jsp'))return {state:'unsupported'};
 if(action!=='fill')return {state:'ready'};
 if(typeof credentials?.account!=='string'||typeof credentials?.password!=='string'||!credentials.account||!credentials.password)return {state:'unsupported'};
 const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
 for(const [el,value] of [[user,credentials.account],[password,credentials.password]]){
  setter.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
 }
 if(challenge())return {state:'manual_required'};
 const currentTarget=new URL(form.getAttribute('action')||'',location.href);
 if(currentTarget.origin!==target.origin||currentTarget.pathname!==target.pathname||currentTarget.username||currentTarget.password||!visible(button)||button.disabled)return {state:'unsupported'};
 // Let the official button perform encryption, validation and submission itself.
 button.click();return {state:'submitted'};
}

const campusLoginActive=new Set();
function campusLoginFailure(error){
 const message=String(error?.message||'');
 if(/No (document|frame)|frame.*removed|document.*(removed|unloaded)|context.*invalidated|navigation/i.test(message))return 'document_changed';
 if(/Cannot access|permission|not allowed/i.test(message))return 'site_permission';
 if(/timeout|timed out|aborted/i.test(message))return 'request_timeout';
 if(/credentials_provider/.test(message))return 'provider_mismatch';
 if(error?.name==='TypeError')return 'script_type_error';
 return 'browser_script_error';
}
function campusLoginSender(sender){
 if(sender.id!==chrome.runtime.id||sender.frameId!==0||!sender.tab?.id)return null;
 try{const u=new URL(sender.url);return u.protocol==='http:'&&u.hostname==='127.0.0.1'&&!u.username&&!u.password&&u.pathname==='/'?u.origin:null;}catch{return null;}
}
async function campusLoginRun(server,job){
 const spec={sep:{url:'https://sep.ucas.ac.cn/',pattern:'https://sep.ucas.ac.cn/*'},mail:{url:'https://mail.cstnet.cn/',pattern:'https://mail.cstnet.cn/*'}}[job.provider];
 const request=async(action,data={})=>{
  const response=await fetch(server+'/api/bridge/login/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Ucas-Extension':chrome.runtime.id},body:JSON.stringify({id:job.id,ticket:job.ticket,...data}),credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new Error('login_request_failed');return response.json();
 };
 const report=(state,reason)=>request('report',{state,...(reason?{reason}:{})});
 const inspect=async(tabId,action='inspect')=>{
  const frames=await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},func:campusLoginPage,args:[job.provider,action]});
  return frames.find(f=>f.frameId===0);
 };
 const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 try {
  await report('opening');
  // Reuse a confirmed signed-in page without touching its credentials or session.
  for(const t of (await chrome.tabs.query({url:spec.pattern})).slice(-12)){
   if(t.discarded)continue;
   let f;try{f=await inspect(t.id);}catch{continue;}
   if(f?.result?.state==='authenticated'){await chrome.tabs.update(t.id,{active:true});await chrome.windows.update(t.windowId,{focused:true});await report('already_signed_in');return;}
  }
  const tab=await chrome.tabs.create({url:spec.url,active:true});
  let page;
  for(let attempt=0;attempt<20;attempt++){
   try{page=await inspect(tab.id);}catch{page=null;}
   if(['ready','authenticated','manual_required'].includes(page?.result?.state))break;
   await delay(700);
  }
  if(page?.result?.state==='authenticated'){await report('already_signed_in');return;}
  if(page?.result?.state==='manual_required'){await report('manual_required');return;}
  if(page?.result?.state!=='ready'||!page.documentId){await report('unsupported');return;}
  let credentials=await request('claim');
  let result,fillError;
  try{
   if(credentials.provider!==job.provider)throw new Error('credentials_provider');
   // Credential decryption can take time. Check the current, fully loaded page
   // again, then pin that document. Never retry a credential write or submit.
   page=await inspect(tab.id);
   if(page?.result?.state==='authenticated'){await report('success');return;}
   if(page?.result?.state==='manual_required'){await report('manual_required');return;}
   if(page?.result?.state!=='ready'||!page.documentId){await report('unsupported');return;}
   // documentId pins the checked document; navigating the tab invalidates this call.
   const frames=await chrome.scripting.executeScript({target:{tabId:tab.id,documentIds:[page.documentId]},func:campusLoginPage,args:[job.provider,'fill',{account:credentials.account,password:credentials.password}]});
   result=frames[0]?.result;
  }catch(error){fillError=campusLoginFailure(error);
  }finally{credentials.account='';credentials.password='';credentials=null;}
  if(result?.state==='authenticated'){await report('success');return;}
  if(result?.state==='manual_required'){await report('manual_required');return;}
  if(!fillError&&result?.state!=='submitted'){await report('unsupported');return;}
  if(fillError&&fillError!=='document_changed'){await report('failed',fillError);return;}
  // A single submit per click; all following calls only inspect visible page state.
  for(let attempt=0;attempt<30;attempt++){
   await delay(1000);
   let f;try{f=await inspect(tab.id,'observe');}catch{continue;}
   const state=f?.result?.state;
   if(state==='authenticated'){await report('success');return;}
   if(['manual_required','rejected','unsupported'].includes(state)){await report(state);return;}
  }
  await report(fillError?'failed':'timeout',fillError);
 }catch(error){await report('failed',campusLoginFailure(error)).catch(()=>{});}
 finally{campusLoginActive.delete(job.provider);job.ticket='';}
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(!['login-hello','login-start'].includes(message?.type))return;
 const server=campusLoginSender(sender);if(!server)return;
 if(message.type==='login-hello'){respond({ok:true,extensionId:chrome.runtime.id,version:chrome.runtime.getManifest().version});return;}
 if(!['sep','mail'].includes(message.provider)||!/^[a-f0-9]{24}$/.test(message.id||'')||!/^[a-f0-9]{64}$/.test(message.ticket||'')){respond({ok:false});return;}
 if(campusLoginActive.has(message.provider)){respond({ok:false});return;}
 campusLoginActive.add(message.provider);
 respond({ok:true});
 void campusLoginRun(server,{provider:message.provider,id:message.id,ticket:message.ticket});
});
