let delivering=false;
export function remindersPage(state,{escape,fmt,empty}){
 return `<div class="page"><div class="page-heading"><div><h2>消息提醒</h2><p>到时间的事项会出现在这里。</p></div><div class="integration-actions"><button class="secondary" data-action="read-all">全部标记已读</button><button class="secondary" data-action="notifications">开启页面通知</button></div></div>${state.notifications.map(n=>{
 const scheduled=state.snoozes?.find(s=>s.notificationId===n.id);
 return `<article class="notification-card ${n.seen?'seen':''}"><strong>${escape(n.title)}</strong><p>${escape(n.body)} · ${fmt(n.created_at)}</p>${scheduled?`<p class="snooze-time">将在 ${fmt(scheduled.dueAt)} 再次提醒</p>`:''}${!n.seen?`<div class="reminder-actions"><button class="text-button" data-read="${escape(n.id)}">标记已读</button><select data-snooze-minutes aria-label="稍后提醒间隔"><option value="10">10 分钟</option><option value="30">30 分钟</option><option value="60">1 小时</option></select><button class="text-button" data-snooze="${escape(n.id)}">稍后再提醒</button></div>`:''}</article>`;
 }).join('')||empty('还没有到时间的提醒。')}${backgroundReminderHelp()}</div>`;
}
export async function deliverPageNotifications(api){
 if(delivering||!('Notification'in window)||Notification.permission!=='granted')return;
 delivering=true;
 try{
  const batch=await api('/notifications/claim',{}),ids=[];
  for(const n of batch.notifications){
   try{const toast=new Notification(n.title,{body:n.body,icon:'/icon.svg',tag:n.id});toast.onclick=()=>{window.focus();location.hash='notifications';toast.close();};ids.push(n.id);}catch{break;}
  }
  if(ids.length)await api('/notifications/ack',{ids,deliveryToken:batch.deliveryToken});
 }catch{/* The lease expires so a temporarily unavailable page can retry. */}
 finally{delivering=false;}
}
export function backgroundReminderHelp(){return `<section class="settings-section"><h3>关闭工作台后的提醒</h3><p>校园桥接 0.4 可在工作台关闭后继续提醒。打开 Chrome 工具栏的「国科大校园桥接」，勾选「工作台关闭后也提醒」，允许通知后保存。</p><p class="footer-note">需要 Chrome 和本地服务运行，每分钟检查一次。电脑休眠或 Chrome 完全退出期间不会弹出提醒，恢复后会检查过去 24 小时内的未读提醒。工作台与扩展共用送达记录，避免重复弹窗。</p></section>`;}
