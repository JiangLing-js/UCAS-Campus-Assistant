// The workbench receives status only. Secrets never cross this page channel.
(() => {
 if(window.top!==window||location.hostname!=='127.0.0.1'||location.pathname!=='/')return;
 window.addEventListener('message',event=>{
  const m=event.data;
  if(event.source!==window||event.origin!==location.origin||m?.channel!=='ucas-login-request'||typeof m.requestId!=='string'||m.requestId.length>80)return;
  if(!['hello','start','sync'].includes(m.action))return;
  const send=value=>window.postMessage({channel:'ucas-login-response',requestId:m.requestId,...value},location.origin);
  const message=m.action==='hello'?{type:'login-hello'}:m.action==='sync'?{type:'sync-wake',token:m.token}:{type:'login-start',provider:m.provider,id:m.id,ticket:m.ticket};
  chrome.runtime.sendMessage(message).then(r=>send({ok:r?.ok===true,...(m.action==='hello'&&r?.ok?{extensionId:r.extensionId,version:r.version}:{})})).catch(()=>send({ok:false}));
 });
})();
