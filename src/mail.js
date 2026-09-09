import { ImapFlow } from 'imapflow';
import { readSecrets } from './vault.js';
import { db, recordSync } from './store.js';
import { saveMail } from './integrations.js';

let busy=false;
export async function syncMailbox({secrets=readSecrets(),createClient=options=>new ImapFlow(options)}={}){
 if(busy)return {ok:false,message:'邮箱同步正在进行'};
 if(!secrets.mailAccount||!secrets.mailPassword)return {ok:false,message:'请先在本地设置保存邮箱账号和密码（或客户端专用密码）。浏览器登录不会自动提供密码。'};
 busy=true;let client,lock;
 try{
  client=createClient({host:'mail.cstnet.cn',port:993,secure:true,auth:{user:secrets.mailAccount,pass:secrets.mailPassword},logger:false,logRaw:false,disableAutoIdle:true,connectionTimeout:15000,greetingTimeout:15000,socketTimeout:20000});
  client.on('error',()=>{});await client.connect();lock=await client.getMailboxLock('INBOX',{readOnly:true});
  const total=client.mailbox.exists;const messages=total?await client.fetchAll(`${Math.max(1,total-99)}:${total}`,{uid:true,envelope:true,flags:true,internalDate:true}):[];
  const headers=messages.map(m=>({id:`${client.mailbox.uidValidity}:${m.uid}`,subject:(m.envelope?.subject||'(无主题)').slice(0,1000),sender:(m.envelope?.from||[]).map(a=>a.name?`${a.name} <${a.address||''}>`:a.address||'').join(', ').slice(0,500),dateText:'',receivedAt:m.internalDate?new Date(m.internalDate).toISOString():null,unread:!m.flags.has('\\Seen')}));
  db.exec('BEGIN IMMEDIATE');try{saveMail(headers,'imap');recordSync('mail','ok',`IMAP 已同步最近 ${headers.length} 封（收件箱共 ${total} 封）`);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  return {ok:true,count:headers.length,total,message:`已同步最近 ${headers.length} 封邮件标题`};
 }catch(error){
  const auth=error.authenticationFailed||/AUTH|LOGIN/i.test(String(error.responseStatus||error.code||''));
  const message=auth?'邮箱登录失败，请检查账号、密码及 IMAP 是否启用；如邮箱要求客户端专用密码，请使用专用密码。':'暂时无法连接邮件服务器，请检查网络和邮箱 IMAP 服务设置后重试。';
  recordSync('mail','error',message);return {ok:false,message};
 }finally{lock?.release();if(client)try{await client.logout();}catch{client.close();}busy=false;}
}
