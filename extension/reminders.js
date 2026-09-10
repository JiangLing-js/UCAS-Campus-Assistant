let deliveringReminders=false;
async function restoreReminderAlarm(){
 const {autoRemind}=await chrome.storage.local.get('autoRemind');
 await chrome.alarms.clear('campus-reminders');
 if(autoRemind&&await chrome.permissions.contains({permissions:['notifications']}))await chrome.alarms.create('campus-reminders',{delayInMinutes:1,periodInMinutes:1});
}
async function deliverBackgroundReminders(){
 if(deliveringReminders)return;deliveringReminders=true;
 try{
  const config=await chrome.storage.local.get(['server','token','autoRemind']);
  if(!config.autoRemind||!await chrome.permissions.contains({permissions:['notifications']}))return;
  if(await chrome.notifications.getPermissionLevel()!=='granted')return;
  const server=localServer(config.server);
  if(!/^[a-f0-9]{48}$/.test(config.token||''))return;
  const request=async(action,body)=>{
   const r=await fetch(server+'/api/bridge/notifications/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Ucas-Token':config.token},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});
   if(!r.ok)throw new Error('连接失败');return r.json();
  };
  const batch=await request('claim',{}),ids=[];
  try{
   for(const n of batch.notifications){
    await chrome.notifications.create('ucas-'+n.id,{type:'basic',iconUrl:chrome.runtime.getURL('icon.png'),title:String(n.title).slice(0,300),message:String(n.body).slice(0,1000),contextMessage:'国科大校园助手'});
    ids.push(n.id);
   }
  }finally{if(ids.length)await request('ack',{ids,deliveryToken:batch.deliveryToken});}
  const result={ok:true,message:'后台提醒已连接；每分钟检查一次',at:new Date().toISOString()};await chrome.storage.local.set({lastReminderResult:result});return result;
 }catch{
  const result={ok:false,message:'后台提醒暂未送达，请确认本地服务运行、连接码正确并已允许通知。',at:new Date().toISOString()};await chrome.storage.local.set({lastReminderResult:result});return result;
 }finally{deliveringReminders=false;}
}
let reminderClicksRegistered=false;
function registerReminderClicks(){
 if(reminderClicksRegistered||!chrome.notifications)return;
 reminderClicksRegistered=true;
 chrome.notifications.onClicked.addListener(id=>{
 if(!/^ucas-[a-f0-9-]{36}$/.test(id))return;
 void chrome.storage.local.get('server').then(c=>chrome.tabs.create({url:localServer(c.server)+'/#notifications'}));
 });
}
registerReminderClicks();
chrome.permissions.onAdded.addListener(()=>{registerReminderClicks();void restoreReminderAlarm();});
chrome.permissions.onRemoved.addListener(()=>{void restoreReminderAlarm();});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='campus-reminders')void deliverBackgroundReminders();});
chrome.runtime.onStartup.addListener(()=>{void restoreReminderAlarm().then(deliverBackgroundReminders);});
chrome.runtime.onInstalled.addListener(()=>{void restoreReminderAlarm().then(deliverBackgroundReminders);});
