let loginApi,loginToast;
const active=new Set();
const messages=new Map();
const labels={sep:'SEP',mail:'邮箱'};
export function loginPanel(settings){
 return `<section class="settings-section login-panel"><div class="page-heading"><div><h3>一键登录</h3><p>使用本机加密保存的账号和密码，直接打开官方系统。</p></div><span class="local-badge">本机保险箱</span></div><div class="login-grid">${['sep','mail'].map(p=>`<div class="login-card"><div><strong>${p==='sep'?'SEP 教育业务接入平台':'中国科学院邮箱'}</strong><p class="footer-note">${settings?(p==='sep'?settings.hasAccount&&settings.hasPassword:settings.hasMailAccount&&settings.hasMailPassword)?'● 已保存完整凭据':'○ 请先在下方保存账号和密码':'使用「连接与设置」中保存的凭据'}</p></div><button class="primary" type="button" data-ext data-login="${p}" ${active.has(p)?'disabled':''}>一键登录 ${labels[p]}</button><p class="login-status" data-login-status="${p}" role="status"></p></div>`).join('')}</div><p class="footer-note">需要 Chrome「国科大校园桥接」0.3 或以上版本。已登录时直接打开；验证码或额外验证在官方页面完成。</p></section>`;
}
function status(provider,text){messages.set(provider,text);for(const el of document.querySelectorAll('[data-login-status]'))if(el.dataset.loginStatus===provider)el.textContent=text;}
function disable(provider,value){for(const el of document.querySelectorAll('[data-login]'))if(el.dataset.login===provider)el.disabled=value;}
function bridge(action,data={}){
 return new Promise((resolve,reject)=>{
  const requestId=crypto.randomUUID();
  const timer=setTimeout(()=>{window.removeEventListener('message',listener);reject(new Error('未连接到新版校园桥接。请在 Chrome 扩展管理页重新加载「国科大校园桥接」，然后刷新工作台。'));},5000);
  function listener(event){const r=event.data;if(event.source!==window||event.origin!==location.origin||r?.channel!=='ucas-login-response'||r.requestId!==requestId)return;clearTimeout(timer);window.removeEventListener('message',listener);r.ok?resolve(r):reject(new Error('校园桥接未能启动登录，请刷新工作台后重试。'));}
  window.addEventListener('message',listener);window.postMessage({channel:'ucas-login-request',action,requestId,...data},location.origin);
 });
}
export async function startLogin(provider){
 if(!labels[provider]||active.has(provider))return;
 active.add(provider);disable(provider,true);let job,started=false;
 try{
  status(provider,'正在连接浏览器…');
  const connection=await bridge('hello');
  const version=String(connection.version||'').split('.').map(Number);
  if(provider==='sep'&&!(version[0]>0||version[1]>3||version[1]===3&&version[2]>=1))throw new Error(`SEP 登录需要校园桥接 0.3.1 或以上，当前连接的是 ${connection.version||'未知版本'}。请重新加载扩展，再刷新工作台。`);
  job=await loginApi('/login/jobs',{provider,extensionId:connection.extensionId});
  status(provider,job.message);
  await bridge('start',{provider,id:job.id,ticket:job.ticket});started=true;delete job.ticket;
  for(let i=0;i<95;i++){
   const result=await loginApi('/login/jobs/'+job.id);status(provider,result.message);
   if(result.done){loginToast(`${labels[provider]}：${result.message}`);return;}
   await new Promise(resolve=>setTimeout(resolve,1000));
  }
  status(provider,'登录等待已结束，请查看官方页面的结果。');
 }catch(e){
  if(job&&!started)await loginApi('/login/jobs/'+job.id+'/cancel',{}).catch(()=>{});
  status(provider,e.message);loginToast(e.message);
 }finally{if(job)delete job.ticket;active.delete(provider);disable(provider,false);}
}
export function initLogin({api,toast}){
 loginApi=api;loginToast=toast;
 document.addEventListener('click',e=>{const button=e.target.closest('button[data-login]');if(button){e.preventDefault();void startLogin(button.dataset.login);}});
 // Preserve progress when navigating between settings and campus services.
 new MutationObserver(()=>{for(const [p,text] of messages){for(const el of document.querySelectorAll('[data-login-status]'))if(el.dataset.loginStatus===p&&el.textContent!==text)el.textContent=text;disable(p,active.has(p));}}).observe(document.querySelector('#main-content'),{childList:true,subtree:true});
}
