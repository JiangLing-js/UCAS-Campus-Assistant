const $=id=>document.getElementById(id);
chrome.storage.local.get(['server','token','autoSync','autoRemind','lastResult','lastReminderResult']).then(c=>{
 if(c.server)$('server').value=c.server;if(c.token)$('token').value=c.token;
 $('auto').checked=!!c.autoSync;$('reminders').checked=!!c.autoRemind;
 if(c.lastResult)$('status').textContent=c.lastResult.message;
 if(c.lastReminderResult)$('reminder-status').textContent=c.lastReminderResult.message;
});
$('pair').addEventListener('submit',async e=>{
 e.preventDefault();$('save').disabled=true;$('status').textContent='正在保存连接…';
 try{
  if($('reminders').checked&&!await chrome.permissions.request({permissions:['notifications']}))throw new Error('没有获得通知权限；可取消勾选后台提醒，继续使用同步功能。');
  const r=await chrome.runtime.sendMessage({type:'configure',server:$('server').value.trim(),token:$('token').value.trim(),autoSync:$('auto').checked,autoRemind:$('reminders').checked});
  $('status').textContent=r.message;
  const c=await chrome.storage.local.get(['lastReminderResult','autoRemind']);$('reminder-status').textContent=c.autoRemind?(c.lastReminderResult?.message||'后台提醒已启用'):'后台提醒已关闭';
 }catch(e){$('status').textContent=e.message||'扩展暂时无法连接，请重新打开。';}
 finally{$('save').disabled=false;}
});
