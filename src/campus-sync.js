import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {db,getSetting,setSetting} from './store.js';
import {ingestSnapshot} from './ingest.js';

export const SYNC_TARGETS=Object.freeze({sep:'SEP 通知',systems:'常用系统',timetable:'本周课表',lectures:'科学前沿讲座',courses:'网络课程列表',activities:'团委二课',mail:'邮箱收件箱',network:'校园网用量',news:'校园新闻'});
const keys=Object.keys(SYNC_TARGETS);
export const syncRequest=z.object({sources:z.array(z.enum(keys)).min(1).max(keys.length).default(keys)}).strict();
const reasons={login:'请在官方页面完成登录或验证，再重试未完成项目。',timeout:'页面加载超时，可单独重试。',changed:'页面结构暂不支持，未把空采集当成成功。',network:'页面或本地连接失败，可稍后重试。',expired:'等待浏览器执行超时，请确认 Chrome 和校园桥接运行。',cancelled:'已取消。',empty:'已确认页面没有可同步内容。'};
const terminal=['ok','empty','login_required','unsupported','error','cancelled'];
db.exec(`CREATE TABLE IF NOT EXISTS campus_sync_jobs(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS campus_sync_steps(job_id TEXT NOT NULL,source TEXT NOT NULL,position INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',count INTEGER NOT NULL DEFAULT 0,reason TEXT NOT NULL DEFAULT '',attempts INTEGER NOT NULL DEFAULT 0,lease_token TEXT,lease_until TEXT,PRIMARY KEY(job_id,source));`);
function prune(at=new Date()){
 db.prepare("UPDATE campus_sync_steps SET status='error',reason='expired',lease_token=NULL WHERE status IN ('pending','running') AND job_id IN (SELECT id FROM campus_sync_jobs WHERE expires_at<=?)").run(at.toISOString());
}
export function syncStatus(id,at=new Date()){
 prune(at);const j=id?db.prepare('SELECT * FROM campus_sync_jobs WHERE id=?').get(id):db.prepare('SELECT * FROM campus_sync_jobs ORDER BY created_at DESC,rowid DESC LIMIT 1').get();
 const last=getSetting('syncBridgeHeartbeat'),bridge={connected:!!last&&at.getTime()-Date.parse(last.at)<90000,version:last?.version||null};
 if(!j)return {job:null,bridge};
 const steps=db.prepare('SELECT source,status,count,reason FROM campus_sync_steps WHERE job_id=? ORDER BY position').all(j.id).map(s=>({...s,name:SYNC_TARGETS[s.source],message:reasons[s.reason]||({pending:'等待执行',running:'正在同步',ok:`已同步 ${s.count} 条`}[s.status]||s.status)}));
 const done=steps.every(s=>terminal.includes(s.status)),complete=steps.every(s=>['ok','empty'].includes(s.status));
 const status=done?(complete?'completed':steps.every(s=>s.status==='cancelled')?'cancelled':'partial'):steps.some(s=>s.status==='running')?'running':'queued';
 return {job:{id:j.id,status,done,createdAt:j.created_at,updatedAt:j.updated_at,steps,message:done?(complete?'所有选定系统已同步。':'部分系统需要处理，请查看逐项结果。'):'同步任务已创建，尚未完成。'},bridge};
}
export function requestCampusSync(input={},{at=new Date()}={}){
 const {sources}=syncRequest.parse(input);prune(at);db.exec('BEGIN IMMEDIATE');
 try{
  const active=db.prepare("SELECT job_id FROM campus_sync_steps WHERE status IN ('pending','running') LIMIT 1").get();
  if(active){
   const existing=db.prepare('SELECT source,position FROM campus_sync_steps WHERE job_id=?').all(active.job_id),known=new Set(existing.map(s=>s.source));let position=Math.max(...existing.map(s=>s.position))+1,added=0;
   for(const source of new Set(sources))if(!known.has(source)){db.prepare('INSERT INTO campus_sync_steps(job_id,source,position) VALUES (?,?,?)').run(active.job_id,source,position++);added++;}
   if(added)db.prepare('UPDATE campus_sync_jobs SET updated_at=?,expires_at=? WHERE id=?').run(at.toISOString(),new Date(at.getTime()+15*60000).toISOString(),active.job_id);
   const result=syncStatus(active.job_id,at);db.exec('COMMIT');return {...result,reused:true};
  }
  const id=randomUUID(),stamp=at.toISOString();
  db.prepare('INSERT INTO campus_sync_jobs VALUES (?,?,?,?)').run(id,stamp,stamp,new Date(at.getTime()+15*60000).toISOString());
  [...new Set(sources)].forEach((s,i)=>db.prepare('INSERT INTO campus_sync_steps(job_id,source,position) VALUES (?,?,?)').run(id,s,i));
  db.exec('COMMIT');return {...syncStatus(id,at),reused:false};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
export function cancelCampusSync(id){
 z.string().uuid().parse(id);db.prepare("UPDATE campus_sync_steps SET status='cancelled',reason='cancelled',lease_token=NULL WHERE job_id=? AND status IN ('pending','running')").run(id);return syncStatus(id);
}
export function claimSyncStep(input,at=new Date()){
 const {version}=z.object({version:z.string().regex(/^\d+\.\d+\.\d+$/)}).strict().parse(input);
 setSetting('syncBridgeHeartbeat',{at:at.toISOString(),version});prune(at);db.exec('BEGIN IMMEDIATE');
 try{
  const stamp=at.toISOString();
  db.prepare("UPDATE campus_sync_steps SET status='error',reason='timeout',lease_token=NULL WHERE status='running' AND lease_until<=? AND attempts>=3").run(stamp);
  // One step at a time across extension instances; interrupted workers resume after their lease expires.
  if(db.prepare("SELECT 1 FROM campus_sync_steps WHERE status='running' AND lease_until>? LIMIT 1").get(stamp)){db.exec('COMMIT');return {step:null};}
  const s=db.prepare("SELECT s.job_id,s.source FROM campus_sync_steps s JOIN campus_sync_jobs j ON j.id=s.job_id WHERE s.status='pending' OR (s.status='running' AND s.lease_until<=?) ORDER BY j.created_at,s.position LIMIT 1").get(stamp);
  if(!s){db.exec('COMMIT');return {step:null};}
  const leaseToken=randomUUID();db.prepare("UPDATE campus_sync_steps SET status='running',attempts=attempts+1,lease_token=?,lease_until=? WHERE job_id=? AND source=?").run(leaseToken,new Date(at.getTime()+90000).toISOString(),s.job_id,s.source);
  db.prepare('UPDATE campus_sync_jobs SET updated_at=? WHERE id=?').run(stamp,s.job_id);db.exec('COMMIT');
  return {step:{jobId:s.job_id,source:s.source,leaseToken}};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
const expected={sep:['https://sep.ucas.ac.cn',null],systems:['https://sep.ucas.ac.cn','systems'],timetable:['https://kb.mooc.ucas.edu.cn',null],lectures:['https://xkcts.ucas.ac.cn:8443',null],courses:['https://mooc.ucas.edu.cn','learning'],activities:['https://ek.ucas.edu.cn','activities'],mail:['https://mail.cstnet.cn','mail'],network:['https://portal.ucas.ac.cn','network'],news:['https://www.ucas.ac.cn',null]};
export function reportSyncStep(input,at=new Date()){
 const r=z.object({jobId:z.string().uuid(),source:z.enum(keys),leaseToken:z.string().uuid(),status:z.enum(['ok','empty','login_required','unsupported','error']),reason:z.enum(Object.keys(reasons)).optional(),snapshots:z.array(z.unknown()).max(20).default([])}).strict().parse(input);
 if(r.status==='ok'&&!r.snapshots.length)throw new Error('同步成功必须有采集结果。');
 if(r.status!=='ok'&&r.snapshots.length)throw new Error('非成功结果不能写入采集数据。');
 for(const s of r.snapshots){const [origin,kind]=expected[r.source],u=new URL(s?.sourceUrl);if(u.origin!==origin||u.username||u.password||(s.integration||null)!==kind)throw new Error('采集结果与指定系统不符。');}
 db.exec('BEGIN IMMEDIATE');
 try{
  const s=db.prepare('SELECT * FROM campus_sync_steps WHERE job_id=? AND source=?').get(r.jobId,r.source);
  if(!s||s.status!=='running'||s.lease_token!==r.leaseToken||s.lease_until<=at.toISOString())throw new Error('同步授权已过期或取消。');
  let count=0;for(const snapshot of r.snapshots)count+=ingestSnapshot(snapshot,{transaction:false}).count;
  // An explicitly empty inbox replaces the previous browser snapshot; a failed login does not.
  if(r.status==='empty'&&r.source==='mail')ingestSnapshot({sourceUrl:'https://mail.cstnet.cn/',integration:'mail',mail:[]},{transaction:false});
  const status=r.status==='ok'&&count===0?'unsupported':r.status,reason=status==='unsupported'?'changed':r.reason||'';
  db.prepare('UPDATE campus_sync_steps SET status=?,count=?,reason=?,lease_token=NULL,lease_until=NULL WHERE job_id=? AND source=?').run(status,count,reason,r.jobId,r.source);
  db.prepare('UPDATE campus_sync_jobs SET updated_at=? WHERE id=?').run(at.toISOString(),r.jobId);db.exec('COMMIT');return syncStatus(r.jobId,at);
 }catch(e){db.exec('ROLLBACK');throw e;}
}
