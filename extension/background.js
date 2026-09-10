importScripts('login.js');
let syncing=false;
const DEFAULT_SERVER='http://127.0.0.1:3210';
function localServer(value){const u=new URL(value||DEFAULT_SERVER);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new Error('服务器必须是 http://127.0.0.1:端口');return u.origin;}
async function sync(){
 if(syncing)return {ok:false,message:'同步正在进行'};syncing=true;
 try{
  const config=await chrome.storage.local.get(['server','token']);const server=localServer(config.server);
  if(!/^[a-f0-9]{48}$/.test(config.token||''))throw new Error('请先从本地工作台复制连接码');
  const tabs=await chrome.tabs.query({url:['https://*.ucas.ac.cn/*','https://*.ucas.edu.cn/*','https://mail.cstnet.cn/*']});
  let total=0,pages=0,failed=0;const seen=new Set();
  for(const tab of tabs){
   if(tab.discarded)continue;
   let frames;try{frames=await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},files:['capture.js']});}catch{failed++;continue;}
   for(const frame of frames){
    const snapshot=frame.result;if(!snapshot?.sourceUrl)continue;
    const {capturedAt,...data}=snapshot;const key=JSON.stringify(data);if(seen.has(key))continue;seen.add(key);
    const response=await fetch(server+'/api/bridge/import',{method:'POST',headers:{'Content-Type':'application/json','X-Ucas-Token':config.token},body:JSON.stringify({snapshots:[snapshot]}),signal:AbortSignal.timeout(15000)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'同步请求失败');
    total+=result.results.reduce((n,r)=>n+r.count,0);pages++;
   }
  }
  const result={ok:true,message:pages?`已同步 ${pages} 个页面、${total} 条信息${failed?`；${failed} 个标签页无法读取`:''}`:'没有可同步的已登录页面，请先打开课表、通知或讲座列表',at:new Date().toISOString()};
  await chrome.storage.local.set({lastResult:result});return result;
 }catch(error){const result={ok:false,message:/fetch|timeout/i.test(error.message)?'无法连接本地助手，请先启动项目中的 start.cmd':error.message,at:new Date().toISOString()};await chrome.storage.local.set({lastResult:result});return result;}
 finally{syncing=false;}
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(sender.id!==chrome.runtime.id||sender.tab)return;
 if(message.type==='sync'){sync().then(respond);return true;}
 if(message.type==='configure'){
  (async()=>{const server=localServer(message.server);if(!/^[a-f0-9]{48}$/.test(message.token||''))throw new Error('连接码格式不正确');const autoRemind=message.autoRemind===undefined?(await chrome.storage.local.get('autoRemind')).autoRemind===true:message.autoRemind===true;if(autoRemind&&!await chrome.permissions.contains({permissions:['notifications']}))throw new Error('请先允许通知权限');await chrome.storage.local.set({server,token:message.token,autoSync:!!message.autoSync,autoRemind});await chrome.alarms.clear('campus-sync');if(message.autoSync)await chrome.alarms.create('campus-sync',{periodInMinutes:15});await restoreReminderAlarm();if(autoRemind)await deliverBackgroundReminders();return await sync();})().then(respond).catch(e=>respond({ok:false,message:e.message}));return true;
 }
});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='campus-sync')sync();});
chrome.runtime.onStartup.addListener(async()=>{const config=await chrome.storage.local.get('autoSync');if(config.autoSync)chrome.alarms.create('campus-sync',{periodInMinutes:15});});
importScripts('reminders.js');
