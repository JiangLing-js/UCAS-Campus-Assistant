import {bridge,startLogin} from './login.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let api,toast,refresh,latest,dialog,busy=false,polling=false,lastWake=0,finishedId=null;
const labels={pending:'等待',running:'同步中',ok:'完成',empty:'暂无内容',login_required:'需要登录',unsupported:'待检查',error:'失败',cancelled:'已取消'};
async function wake(){
 const hello=await bridge('hello'),v=String(hello.version||'').split('.').map(Number);
 if(!(v[0]>0||v[1]>5||(v[1]===5&&v[2]>=2)))throw new Error('一键同步需要校园桥接 0.5.2。请在 Chrome 扩展管理页重新加载「国科大校园桥接」，再刷新工作台。');
 const settings=await api('/settings');await bridge('sync',{token:settings.bridgeToken});lastWake=Date.now();
}
function render(){
 const job=latest?.job,button=document.querySelector('#sync-all-button');
 button.textContent=job&&!job.done?'查看同步进度':'一键同步全部';
 if(!dialog?.isConnected)return;
 const list=dialog.querySelector('[data-sync-steps]');
 list.innerHTML=job?job.steps.map(s=>`<div class="sync-step"><strong>${esc(s.name)}</strong><span class="sync-status ${esc(s.status)}">${esc(labels[s.status])}</span><p>${esc(s.message)}</p></div>`).join(''):'<p>自动进入 SEP 通知、常用系统、课表、讲座、网络课程、二课、邮箱、校园网及新闻。</p>';
 dialog.querySelector('[data-sync-summary]').textContent=job?.message||'正在准备连接校园桥接…';
 dialog.querySelector('[data-sync-cancel]').hidden=!job||job.done;
 dialog.querySelector('[data-sync-retry]').hidden=!job?.done||!job.steps.some(s=>!['ok','empty'].includes(s.status));
 dialog.querySelector('[data-sync-login="sep"]').hidden=!job?.steps.some(s=>s.status==='login_required'&&!['mail','network'].includes(s.source));
 dialog.querySelector('[data-sync-login="mail"]').hidden=!job?.steps.some(s=>s.status==='login_required'&&s.source==='mail');
}
function openProgress(){
 if(dialog?.isConnected){render();return;}
 dialog=document.createElement('dialog');dialog.className='integration-dialog sync-dialog';
 dialog.innerHTML=`<div class="dialog-heading"><h2>一键同步校园信息</h2><button type="button" class="icon-button" data-ext data-sync-close aria-label="关闭">×</button></div><p data-sync-summary role="status"></p><p class="error" data-sync-error role="alert"></p><div data-sync-steps></div><p class="muted small">自动复用 SEP 与邮箱登录。课表采集当前显示周，网络课程采集课程列表；不会自动提交作业、报名或选课。需要额外验证时，请在保留的官方页面完成。</p><div class="integration-actions"><button class="secondary" data-ext data-sync-login="sep" hidden>登录 SEP 后重试</button><button class="secondary" data-ext data-sync-login="mail" hidden>登录邮箱后重试</button><button class="primary" data-ext data-sync-retry hidden>重试未完成项目</button><button class="secondary" data-ext data-sync-cancel hidden>取消未完成项目</button></div>`;
 document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-sync-close]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());
 dialog.querySelector('[data-sync-retry]').onclick=()=>void start(retrySources());
 dialog.querySelector('[data-sync-cancel]').onclick=async()=>{try{latest=await api('/campus-sync/'+latest.job.id+'/cancel',{});render();}catch(e){error(e.message);}};
 dialog.querySelectorAll('[data-sync-login]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const r=await startLogin(b.dataset.syncLogin);if(['success','already_signed_in'].includes(r?.state))await start(retrySources());}finally{b.disabled=false;}});
 render();
}
const retrySources=()=>latest?.job?.steps.filter(s=>!['ok','empty'].includes(s.status)).map(s=>s.source);
function error(message){if(dialog?.isConnected)dialog.querySelector('[data-sync-error]').textContent=message;}
async function start(sources){
 if(busy)return;busy=true;openProgress();error('');
 try{await wake();latest=await api('/campus-sync',sources?.length?{sources}:{});render();await wake();}
 catch(e){error(e.message);toast(e.message);}finally{busy=false;}
}
export async function checkCampusSync(){
 if(polling)return;polling=true;
 try{
  latest=await api('/campus-sync');render();
  if(latest.job&&!latest.job.done&&Date.now()-lastWake>15000)try{await wake();}catch(e){lastWake=Date.now();error(e.message);}
  if(latest.job?.done&&finishedId!==latest.job.id){const notify=finishedId!==null;finishedId=latest.job.id;await refresh();if(notify)toast(latest.job.message);}
  else if(latest.job&&!latest.job.done&&finishedId===null)finishedId='running';
 }catch{/* Local service can restart; the next poll will reconnect. */}finally{polling=false;}
}
export function initCampusSync(options){
 ({api,toast,refresh}=options);
 document.querySelector('#sync-all-button').onclick=()=>{if(latest?.job&&!latest.job.done)openProgress();else void start();};
 document.querySelector('#sync-status-button').onclick=()=>{openProgress();void checkCampusSync();};
 void checkCampusSync();setInterval(()=>void checkCampusSync(),5000);
}
