importScripts('sync-page.js');
const campusSyncEntries=Object.freeze({
 sep:'https://sep.ucas.ac.cn/sepCard/card',systems:'https://sep.ucas.ac.cn/sepCard/card',
 timetable:'https://sep.ucas.ac.cn/portal/siteToUrl/441/001?toUrl=https://kb.mooc.ucas.edu.cn/res/pc/curriculum/schedule.html',
 lectures:'https://sep.ucas.ac.cn/sepCard/card',
 courses:'https://sep.ucas.ac.cn/portal/siteToUrl/441/001?toUrl=https://mooc.ucas.edu.cn/courselist/mycourse',
 activities:'https://sep.ucas.ac.cn/portal/site/567/2531',mail:'https://mail.cstnet.cn/',network:'https://portal.ucas.ac.cn/',news:'https://www.ucas.ac.cn/'
});
const campusSyncOrigins={sep:'https://sep.ucas.ac.cn',systems:'https://sep.ucas.ac.cn',timetable:'https://kb.mooc.ucas.edu.cn',lectures:'https://xkcts.ucas.ac.cn:8443',courses:'https://mooc.ucas.edu.cn',activities:'https://ek.ucas.edu.cn',mail:'https://mail.cstnet.cn',network:'https://portal.ucas.ac.cn',news:'https://www.ucas.ac.cn'};
let campusSyncBusy=false;
async function campusSyncRequest(action,body={}){
 const c=await chrome.storage.local.get(['server','token']),server=localServer(c.server);
 if(!/^[a-f0-9]{48}$/.test(c.token||''))throw new Error('not_paired');
 const r=await fetch(server+'/api/bridge/sync/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Ucas-Token':c.token},body:JSON.stringify(body),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw new Error('local_request_failed');return r.json();
}
async function restoreSyncQueueAlarm(){
 const c=await chrome.storage.local.get(['token','autoFullSync']);
 if(/^[a-f0-9]{48}$/.test(c.token||''))await chrome.alarms.create('campus-sync-queue',{periodInMinutes:1});
 else await chrome.alarms.clear('campus-sync-queue');
 if(c.autoFullSync)await chrome.alarms.create('campus-sync-all-auto',{periodInMinutes:15});else await chrome.alarms.clear('campus-sync-all-auto');
}
async function campusSyncOne(step){
 const source=step.source;if(!Object.hasOwn(campusSyncEntries,source))throw new Error('unknown_source');
 const owned=new Set(),targetOrigin=campusSyncOrigins[source];
 const delay=()=>new Promise(r=>setTimeout(r,1000));
 const inspect=async(id,action='inspect')=>{
  const frames=await chrome.scripting.executeScript({target:{tabId:id,frameIds:[0]},func:campusSyncPage,args:[source,action]});return frames[0]?.result;
 };
 let tab,result,keep=false;
 try{
  let entry=campusSyncEntries[source];
  if(source==='mail'){
   // Coremail keeps its current session in the signed-in tab URL. Reuse it only in memory,
   // on the exact official index page; never navigate a user's open mailbox or persist the SID.
   const candidates=(await chrome.tabs.query({url:'https://mail.cstnet.cn/coremail/XT5/*'})).filter(t=>!t.discarded).sort((a,b)=>(b.lastAccessed||0)-(a.lastAccessed||0)).slice(0,10);
   for(const candidate of candidates){
    let url;try{url=new URL(candidate.url);}catch{continue;}
    if(url.origin!==targetOrigin||url.pathname!=='/coremail/XT5/index.jsp'||url.username||url.password||url.search.length>2048||[...url.searchParams.keys()].some(k=>k!=='sid'))continue;
    try{if((await inspect(candidate.id))?.authenticated){url.hash='';entry=url.href;break;}}catch{}
   }
  }
  // Always use an owned tab: existing user tabs are never navigated or closed.
  tab=await chrome.tabs.create({url:entry,active:false});owned.add(tab.id);
  await chrome.storage.local.set({syncOwnedTabs:[...owned]});
  let prepared=false,opened=false,elapsed=0;
  while(elapsed++<55){
   const t=await chrome.tabs.get(tab.id);let u;try{u=new URL(t.url||'');}catch{}
   // Only inspect the expected campus host or SEP during SSO; never follow arbitrary page suggestions.
   if(u&&![targetOrigin,'https://sep.ucas.ac.cn'].includes(u.origin)){await delay();continue;}
   try{result=await inspect(tab.id);}catch{result=null;}
   if(result?.state==='login_required'){keep=true;return {status:'login_required',reason:'login'};}
   if(result?.state==='empty')return {status:'empty',reason:'empty'};
   if(source==='systems'&&!prepared&&u?.origin==='https://sep.ucas.ac.cn'){
    try{prepared=!!(await inspect(tab.id,'prepare'))?.prepared;}catch{};
   }
   if(source==='mail'&&!prepared&&u?.origin===targetOrigin){try{prepared=!!(await inspect(tab.id,'prepare'))?.prepared;}catch{};if(prepared){await delay();continue;}}
   if(source==='activities'&&result?.state==='waiting'&&u?.origin===targetOrigin){try{await inspect(tab.id,'prepare');}catch{}}
   if(source==='lectures'&&u?.origin==='https://sep.ucas.ac.cn'){
    if(!prepared){try{prepared=!!(await inspect(tab.id,'prepare'))?.prepared;}catch{}}
    if(result?.state==='ready'&&!opened){
     const navigation=await inspect(tab.id,'open');let destination;try{destination=new URL(navigation?.url);}catch{}
     if(navigation?.state!=='navigate'||destination?.origin!=='https://sep.ucas.ac.cn'||destination.username||destination.password||destination.search||destination.hash||!/^\/portal\/site\/226\/xs\/1\/1\/[a-f0-9]{32,256}$/i.test(destination.pathname)){
      keep=true;return {status:'unsupported',reason:'changed'};
     }
     // Navigate our own tab instead of relying on window.open, which can be blocked in background tabs.
     await chrome.tabs.update(tab.id,{url:destination.href});opened=true;
    }
    await delay();continue;
   }
   if(result?.state==='ready'&&u?.origin===targetOrigin){
    const frames=await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},files:['capture.js']});
    const snapshots=frames.map(f=>f.result).filter(s=>s?.sourceUrl&&new URL(s.sourceUrl).origin===targetOrigin);
    if(snapshots.length)return {status:'ok',snapshots};
   }
   await delay();
  }
  keep=true;return {status:'unsupported',reason:'changed'};
 }catch{keep=true;return {status:'error',reason:'network'};}
 finally{
  // Failed/login tabs remain visible for the user to finish verification; successful owned tabs are tidied up.
  if(!keep)for(const id of owned)await chrome.tabs.remove(id).catch(()=>{});
  await chrome.storage.local.remove('syncOwnedTabs');
 }
}
async function runCampusSyncQueue(){
 if(campusSyncBusy)return;campusSyncBusy=true;const started=Date.now();
 try{
  while(Date.now()-started<180000){
   const {step}=await campusSyncRequest('claim',{version:chrome.runtime.getManifest().version});if(!step)break;
   const result=await campusSyncOne(step);
   const status=await campusSyncRequest('report',{...step,...result});
   await chrome.storage.local.set({lastFullSyncResult:{message:status.job.message,at:new Date().toISOString()}});
  }
 }catch{await chrome.storage.local.set({lastFullSyncResult:{message:'等待连接本地工作台；未完成任务可在连接恢复后继续。',at:new Date().toISOString()}});}
 finally{campusSyncBusy=false;}
}
async function startFullCampusSync(){const r=await campusSyncRequest('start',{});void runCampusSyncQueue();return {ok:true,message:r.job.message};}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(message?.type==='sync-all'&&sender.id===chrome.runtime.id&&!sender.tab){startFullCampusSync().then(respond).catch(()=>respond({ok:false,message:'请先保存本地连接。'}));return true;}
 if(message?.type!=='sync-wake')return;
 const server=campusLoginSender(sender);if(!server||!/^[a-f0-9]{48}$/.test(message.token||''))return;
 (async()=>{await chrome.storage.local.set({server:localServer(server),token:message.token});await restoreSyncQueueAlarm();respond({ok:true});void runCampusSyncQueue();})().catch(()=>respond({ok:false}));return true;
});
chrome.alarms.onAlarm.addListener(a=>{if(a.name==='campus-sync-queue')void runCampusSyncQueue();if(a.name==='campus-sync-all-auto')void startFullCampusSync().catch(()=>{});});
chrome.runtime.onInstalled.addListener(()=>{void restoreSyncQueueAlarm().then(runCampusSyncQueue).catch(()=>{});});
chrome.runtime.onStartup.addListener(()=>{void restoreSyncQueueAlarm().then(runCampusSyncQueue).catch(()=>{});});
