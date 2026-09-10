import { z } from 'zod';
import { db, getSetting, setSetting, stableId, upsertItem, recordSync, now } from './store.js';

db.exec(`CREATE TABLE IF NOT EXISTS campus_systems(id TEXT PRIMARY KEY,name TEXT,url TEXT,updated_at TEXT);
CREATE TABLE IF NOT EXISTS campus_mail(id TEXT PRIMARY KEY,channel TEXT,subject TEXT,sender TEXT,date_text TEXT,received_at TEXT,unread INTEGER,updated_at TEXT);`);
export const integrationKinds=['mail','network','activities','systems','learning'];
const text=z.string().trim();
const mailHeader=z.object({id:text.max(300).optional(),subject:text.max(1000).default('(无主题)'),sender:text.max(500).default(''),dateText:text.max(100).default(''),receivedAt:z.string().datetime({offset:true}).nullable().default(null),unread:z.boolean()});
export const integrationSnapshot=z.object({sourceUrl:text.max(3000),capturedAt:z.string().datetime().optional(),integration:z.enum(integrationKinds),
 mail:z.array(mailHeader).max(200).optional(),
 network:z.object({connected:z.boolean(),usedTraffic:text.max(100),duration:text.max(100),balance:text.max(100)}).optional(),
 systems:z.array(z.object({name:text.min(1).max(150),url:text.max(3000)})).max(100).optional(),
 learning:z.array(z.object({title:text.min(1).max(300),description:text.max(2000).default('')})).max(200).optional(),
 activities:z.array(z.object({title:text.min(1).max(300),organization:text.max(200).default(''),description:text.max(10000).default(''),publishedAt:text.max(100).default(''),startsAt:z.string().datetime({offset:true}).nullable().default(null),endsAt:z.string().datetime({offset:true}).nullable().default(null),location:text.max(300).default('')})).max(100).optional(),
}).superRefine((s,ctx)=>{
 let u;try{u=new URL(s.sourceUrl);}catch{ctx.addIssue({code:'custom',message:'无效来源'});return;}
 const host={mail:'mail.cstnet.cn',network:'portal.ucas.ac.cn',activities:'ek.ucas.edu.cn',systems:'sep.ucas.ac.cn',learning:'mooc.ucas.edu.cn'}[s.integration];
 if(u.protocol!=='https:'||u.hostname!==host||u.username||u.password||u.port)ctx.addIssue({code:'custom',message:'数据类型与官方站点不匹配'});
 if(s[s.integration]===undefined)ctx.addIssue({code:'custom',message:'缺少对应数据'});
 if(s.capturedAt&&Date.parse(s.capturedAt)>Date.now()+5*60000)ctx.addIssue({code:'custom',message:'采集时间不正确'});
});
const destinations={mail:'https://mail.cstnet.cn/',network:'https://portal.ucas.ac.cn/',activities:'https://ek.ucas.edu.cn/dashboard',systems:'https://sep.ucas.ac.cn/sepCard/card'};
export function saveMail(headers,channel='browser',capturedAt=now()){
 const data=z.array(mailHeader).max(200).parse(headers);
 // Each channel is a bounded snapshot. Never combine browser row IDs with IMAP UIDs.
 db.prepare('DELETE FROM campus_mail WHERE channel=?').run(channel);
 const insert=db.prepare('INSERT INTO campus_mail VALUES (?,?,?,?,?,?,?,?)');
 data.forEach((m,i)=>insert.run(stableId(channel,m.id||`${m.subject}:${m.sender}:${m.dateText}:${i}`),channel,m.subject,m.sender,m.dateText,m.receivedAt,m.unread?1:0,capturedAt));
 setSetting('mailActiveChannel',channel);setSetting('mailSnapshotAt',capturedAt);return data.length;
}
export function listMail({query='',unreadOnly=false,limit=100}={}){
 const channel=getSetting('mailActiveChannel','browser');
 return {messages:db.prepare(`SELECT id,subject,sender,date_text AS dateText,received_at AS receivedAt,unread,updated_at AS updatedAt FROM campus_mail WHERE channel=? AND (subject LIKE ? OR sender LIKE ?) ${unreadOnly?'AND unread=1':''} ORDER BY COALESCE(received_at,updated_at) DESC,rowid LIMIT ?`).all(channel,`%${query}%`,`%${query}%`,Math.min(200,limit)).map(m=>({...m,unread:!!m.unread})),channel,capturedAt:getSetting('mailSnapshotAt'),sourceUrl:destinations.mail};
}
export function queryMailForModel(args){if(!getSetting('allowMailAi',false))return {error:'邮箱对话查询尚未开启。请用户在连接与设置中启用「允许对话查询已同步邮件标题」后重试。'};return listMail(args);}
export function clearMail(){db.prepare('DELETE FROM campus_mail').run();setSetting('mailSnapshotAt',null);}
export function ingestIntegration(input,{transaction=true}={}){
 const s=integrationSnapshot.parse(input),capturedAt=s.capturedAt||now();let count=0;
 if(transaction)db.exec('BEGIN IMMEDIATE');try{
  if(s.integration==='mail')count=saveMail(s.mail,'browser',capturedAt);
  if(s.integration==='network'){setSetting('networkSnapshot',{...s.network,capturedAt,sourceUrl:destinations.network});count=1;}
  if(s.integration==='learning')for(const c of s.learning){upsertItem({id:stableId('learning',c.title+':'+c.description),kind:'course',title:c.title,content:'网络课程列表，课程时间以课表为准。\n'+c.description,source:'learning',sourceUrl:'https://mooc.ucas.edu.cn/courselist/mycourse'},{imported:true});count++;}
  if(s.integration==='systems'){
   for(const entry of s.systems){let u;try{u=new URL(entry.url);}catch{continue;}if(u.origin!=='https://sep.ucas.ac.cn'||!/^\/portal\/site\/\d+\/\d+$/.test(u.pathname)||u.username||u.password)continue;u.search='';u.hash='';db.prepare('INSERT INTO campus_systems VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,updated_at=excluded.updated_at').run(stableId('system',u.pathname),entry.name.replace(/^New\s*/i,''),u.href,capturedAt);count++;}
  }
  if(s.integration==='activities')for(const a of s.activities){
   upsertItem({id:stableId('activities',`${a.title}:${a.organization}:${a.publishedAt}`),kind:'activity',title:a.title,content:`组织：${a.organization}\n动态发布时间：${a.publishedAt||'未提供'}\n${a.description}${/测试/.test(a.organization)?'\n[来源标注为测试组织]':''}`,startsAt:a.startsAt,endsAt:a.endsAt,location:a.location,source:'activities',sourceUrl:destinations.activities},{imported:true});count++;
  }
  recordSync(s.integration,'ok',`同步 ${count} 条；采集于 ${capturedAt}`);if(transaction)db.exec('COMMIT');
 }catch(e){if(transaction)db.exec('ROLLBACK');throw e;}
 return {source:s.integration,count};
}
export function campusServices(){return {systems:db.prepare('SELECT * FROM campus_systems ORDER BY name').all(),network:getSetting('networkSnapshot'),mail:{capturedAt:getSetting('mailSnapshotAt'),channel:getSetting('mailActiveChannel','browser')}};}
