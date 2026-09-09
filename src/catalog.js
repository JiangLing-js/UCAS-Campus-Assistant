import * as XLSX from 'xlsx';
import { z } from 'zod';
import { db, stableId, now } from './store.js';

db.exec(`CREATE TABLE IF NOT EXISTS course_datasets(id TEXT PRIMARY KEY,name TEXT,semester TEXT,source_url TEXT,created_at TEXT);
CREATE TABLE IF NOT EXISTS catalog_courses(id TEXT PRIMARY KEY,dataset_id TEXT,data TEXT);
CREATE INDEX IF NOT EXISTS catalog_dataset ON catalog_courses(dataset_id);
CREATE TABLE IF NOT EXISTS course_plans(id TEXT PRIMARY KEY,name TEXT,dataset_id TEXT,created_at TEXT);
CREATE TABLE IF NOT EXISTS plan_courses(plan_id TEXT,course_id TEXT,status TEXT,PRIMARY KEY(plan_id,course_id));`);
const str=z.string().trim();
const sessionInput=z.object({weekday:z.number().int().min(1).max(7),periods:z.array(z.number().int().min(1).max(20)).min(1).max(20),weeks:z.array(z.number().int().min(1).max(60)).max(60)});
export const courseInput=z.object({code:str.max(150).default(''),name:str.min(1).max(300),teacher:str.max(500).default(''),credits:z.number().min(0).max(100).nullable().default(null),hours:str.max(100).default(''),category:str.max(200).default(''),department:str.max(300).default(''),exam:str.max(200).default(''),campus:str.max(100).default(''),schedule:str.max(3000).default(''),weeks:str.max(500).default(''),location:str.max(500).default(''),semester:str.max(100).default(''),timeUncertain:z.boolean().optional(),sessions:z.array(sessionInput).max(100).optional()});
const aliases={code:['课程编码','课程编号','课程代码','课号','code'],name:['课程名称','课程名','名称','name'],teacher:['主讲教师','首席教授','授课教师','任课教师','教师','teacher'],credits:['学分','credits'],hours:['课时','学时','总学时','hours'],category:['课程属性','课程性质','课程类别','课程类型','类别','category'],department:['开课院系','开课单位','开课学院','院系','学院','department'],exam:['考试方式','考核方式','exam'],campus:['开课校区','校区','campus'],schedule:['星期节次','上课时间','授课时间','时间安排','排课信息','时间','schedule'],weeks:['开课周','上课周次','授课周次','周次','weeks'],location:['上课地点','教室','地点','location'],semester:['开课学期','学期','semester']};
const normalize=v=>String(v??'').replace(/\s|[（(].*?[）)]/g,'').trim().toLowerCase();
function headerMap(row){const result={};for(const [key,names] of Object.entries(aliases)){const idx=row.findIndex(v=>names.some(n=>normalize(v)===normalize(n)));if(idx>=0)result[key]=idx;}return result;}
export function parseWeeks(text){
 const t=String(text||'').replace(/[—–~～至]/g,'-');const numbers=new Set();
 for(const m of t.matchAll(/(\d{1,2})(?:\s*-\s*(\d{1,2}))?/g)){const start=+m[1],end=+(m[2]||m[1]);if(start<1||end>60||start>end)return [];for(let n=start;n<=end;n++)if((!t.includes('单')||n%2===1)&&(!t.includes('双')||n%2===0))numbers.add(n);}
 return [...numbers].sort((a,b)=>a-b);
}
export function parseSessions(schedule,weeks=''){
 const text=String(schedule).replace(/[—–~～至]/g,'-').replace(/星期|礼拜/g,'周');const sessions=[];
 const matches=[...text.matchAll(/周\s*([一二三四五六日天1-7])/g)];
 for(let i=0;i<matches.length;i++){
  const m=matches[i],chunk=text.slice(m.index+m[0].length,matches[i+1]?.index??text.length);
  const period=chunk.match(/(?:第\s*)?(\d{1,2}(?:\s*[-,，、]\s*\d{1,2})*)\s*节/)||chunk.match(/^\s*[（(]\s*(\d{1,2}(?:\s*[-,，、]\s*\d{1,2})*)\s*[）)]/);
  if(!period)continue;
  const periods=parseWeeks(period[1]);if(!periods.length||periods.some(n=>n>20))continue;
  const weekText=chunk.match(/(?:第\s*)?(\d{1,2}(?:\s*[-,，、]\s*\d{1,2})*)\s*周\s*(?:[（(]?([单双])[）)]?)?/);
  const weekList=parseWeeks(weekText?weekText[1]+(weekText[2]||''):weeks);
  sessions.push({weekday:'一二三四五六日'.indexOf(m[1].replace('天','日'))+1||+m[1],periods,weeks:weekList});
 }
 return sessions;
}
export function normalizeCourse(input){const c=courseInput.parse(input);const sessions=c.sessions??parseSessions(c.schedule,c.weeks);const dayCount=[...c.schedule.matchAll(/(?:周|星期|礼拜)\s*[一二三四五六日天1-7]/g)].length;return {...c,sessions,timeUncertain:!!c.timeUncertain||!sessions.length||(!c.sessions&&dayCount>sessions.length)};}
function fromRows(rows,sheetName){
 let h=-1,map;for(let i=0;i<Math.min(rows.length,30);i++){const m=headerMap(rows[i]);if(m.name!==undefined&&Object.keys(m).length>=2){h=i;map=m;break;}}
 if(h<0)return {courses:[],warning:`工作表「${sheetName}」未找到课程表头，已跳过`};
 const courses=[],groups=new Map();let skipped=0;
 const combinedIndex=rows[h].findIndex(v=>/^(课时|学时)[/／]学分$/.test(String(v??'').replace(/\s/g,'')));
 const serialIndex=rows[h].findIndex(v=>String(v??'').trim()==='序号');
 for(const row of rows.slice(h+1)){
  if(!row.some(v=>String(v??'').trim()))continue;
  const obj=Object.fromEntries(Object.entries(map).map(([k,i])=>[k,String(row[i]??'').trim()]));
  if(!obj.name||normalize(obj.name)==='课程名称'){skipped++;continue;}
  if(combinedIndex>=0){const parts=String(row[combinedIndex]||'').split(/[/／]/);obj.hours=parts[0]?.trim()||'';obj.credits=parts[1]?.trim()||'';}
  if(obj.credits!==undefined)obj.credits=obj.credits===''?null:Number(obj.credits);
  if(!obj.semester&&/[秋春夏]/.test(sheetName))obj.semester=sheetName;
  try{
   const c=normalizeCourse(obj),key=c.code?`${serialIndex>=0?row[serialIndex]:''}:${c.code}:${c.name}:${c.semester}`:null;
   const previous=key&&groups.get(key);
   if(previous){
    previous.sessions.push(...c.sessions);previous.timeUncertain ||= c.timeUncertain;
    for(const field of ['schedule','weeks','teacher','location'])if(c[field]&&!previous[field].split('\n').includes(c[field]))previous[field]=[previous[field],c[field]].filter(Boolean).join('\n');
   }else{courses.push(c);if(key)groups.set(key,c);}
  }catch{skipped++;}
 }
 return {courses,warning:skipped?`「${sheetName}」跳过 ${skipped} 行空名称、说明或无效数据`:null};
}
export function parseDataset(buffer,filename){
 if(!buffer.length||buffer.length>8*1024*1024)throw new Error('文件应为 1 字节至 8 MB');
 if(!/\.(xlsx|xls|csv|json)$/i.test(filename))throw new Error('支持 xlsx、xls、csv、json');
 const warnings=[];let courses=[];
 if(/\.json$/i.test(filename)){const json=JSON.parse(buffer.toString('utf8'));courses=z.array(courseInput).min(1).max(10000).parse(Array.isArray(json)?json:json.courses).map(normalizeCourse);}
 else{
  let source=buffer,type='buffer';
  if(/\.csv$/i.test(filename)){type='string';try{source=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{source=new TextDecoder('gb18030').decode(buffer);}}
  const book=XLSX.read(source,{type,cellFormula:false,cellHTML:false,sheetRows:10002});
  if(book.SheetNames.length>30)throw new Error('工作表数量超过 30');
  for(const name of book.SheetNames){const sheet=book.Sheets[name];const range=XLSX.utils.decode_range(sheet['!fullref']||sheet['!ref']||'A1');if(range.e.r>10001||range.e.c>100)throw new Error('表格过大：每张表最多 10000 行、100 列');
   for(const merge of sheet['!merges']||[]){if(merge.e.r>10001||merge.e.c>100)throw new Error('合并单元格超出限制');const cell=sheet[XLSX.utils.encode_cell(merge.s)];if(!cell)continue;for(let r=merge.s.r;r<=merge.e.r;r++)for(let c=merge.s.c;c<=merge.e.c;c++){const key=XLSX.utils.encode_cell({r,c});if(!sheet[key])sheet[key]={...cell};}}
   const parsed=fromRows(XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:false}),name);courses.push(...parsed.courses);if(parsed.warning)warnings.push(parsed.warning);
  }
 }
 if(!courses.length)throw new Error('未识别到课程。请使用包含「课程名称、课程编号、学分、上课时间」的表头，或手动添加。');
 if(courses.length>10000)throw new Error('每个数据集最多 10000 门课程');
 courses=[...new Map(courses.map(c=>[JSON.stringify(c),c])).values()];
 const unknown=courses.filter(c=>c.timeUncertain||!c.sessions.length||c.sessions.some(s=>!s.weeks.length)).length;
 if(unknown)warnings.push(`${unknown} 门课程缺少完整时间或周次，冲突检查会提示待核对`);
 return {courses,warnings,sheets:courses.length};
}
const safeSource=v=>{try{const u=new URL(v);if(u.protocol!=='https:'||!/(^|\.)ucas\.(ac|edu)\.cn$/.test(u.hostname)||u.username||u.password)return '';u.search='';u.hash='';return u.href;}catch{return '';}};
export function importDataset({name,semester='',sourceUrl='',courses}){
 const meta=z.object({name:str.min(1).max(250),semester:str.max(100),sourceUrl:str.max(3000)}).parse({name,semester,sourceUrl});
 const normalized=z.array(courseInput).min(1).max(10000).parse(courses).map(normalizeCourse);
 const id=stableId('dataset',JSON.stringify([meta.name,meta.semester,normalized]));
 db.exec('BEGIN IMMEDIATE');try{
  db.prepare('INSERT OR IGNORE INTO course_datasets VALUES (?,?,?,?,?)').run(id,meta.name,meta.semester,safeSource(sourceUrl),now());
  const insert=db.prepare('INSERT OR IGNORE INTO catalog_courses VALUES (?,?,?)');
  for(const c of normalized){const cid=stableId(id,JSON.stringify(c));insert.run(cid,id,JSON.stringify({...c,id:cid,datasetId:id}));}
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
 return {id,count:normalized.length};
}
export function datasets(){return db.prepare('SELECT d.*,COUNT(c.id) AS count FROM course_datasets d LEFT JOIN catalog_courses c ON c.dataset_id=d.id GROUP BY d.id ORDER BY d.created_at DESC').all();}
export function searchCatalog({datasetId,query='',semester='',category='',campus='',limit=100,offset=0}={}){
 let rows=db.prepare(`SELECT data FROM catalog_courses ${datasetId?'WHERE dataset_id=?':''}`).all(...(datasetId?[datasetId]:[])).map(r=>JSON.parse(r.data));
 rows=rows.filter(c=>(!query||[c.code,c.name,c.teacher,c.department].join(' ').toLowerCase().includes(query.toLowerCase()))&&(!semester||c.semester.includes(semester))&&(!category||c.category.includes(category))&&(!campus||c.campus.includes(campus)));
 return {total:rows.length,courses:rows.slice(offset,offset+Math.min(200,limit)),datasets:datasets()};
}
export function addCourse(datasetId,input){if(!db.prepare('SELECT id FROM course_datasets WHERE id=?').get(datasetId))throw new Error('数据集不存在');const c=normalizeCourse(input),id=stableId(datasetId,JSON.stringify(c));db.prepare('INSERT OR REPLACE INTO catalog_courses VALUES (?,?,?)').run(id,datasetId,JSON.stringify({...c,id,datasetId}));return {id};}
export function createPlan(name,datasetId){if(!db.prepare('SELECT id FROM course_datasets WHERE id=?').get(datasetId))throw new Error('请先选择数据集');const id=stableId('plan',`${name}:${now()}:${Math.random()}`);db.prepare('INSERT INTO course_plans VALUES (?,?,?,?)').run(id,name,datasetId,now());return {id};}
export const plans=()=>db.prepare('SELECT * FROM course_plans ORDER BY created_at DESC').all();
export function setPlanCourse(planId,courseId,status){
 const p=db.prepare('SELECT * FROM course_plans WHERE id=?').get(planId),c=db.prepare('SELECT * FROM catalog_courses WHERE id=?').get(courseId);
 if(!p||!c||p.dataset_id!==c.dataset_id)throw new Error('课程与方案数据集不一致');
 if(status==='remove')db.prepare('DELETE FROM plan_courses WHERE plan_id=? AND course_id=?').run(planId,courseId);
 else db.prepare('INSERT INTO plan_courses VALUES (?,?,?) ON CONFLICT(plan_id,course_id) DO UPDATE SET status=excluded.status').run(planId,courseId,z.enum(['selected','alternative']).parse(status));
 return getPlan(planId);
}
export function conflicts(courses){
 const pairs=[],uncertain=[];
 for(let i=0;i<courses.length;i++)for(let j=i+1;j<courses.length;j++){
  const a=courses[i],b=courses[j];
  const season=c=>{const s=c.semester?.match(/秋|春|夏|fall|spring|summer/i)?.[0]?.toLowerCase();return ({fall:'秋',spring:'春',summer:'夏'})[s]||s;};
  if(season(a)&&season(b)&&season(a)!==season(b))continue;
  let clash=false,unknown=!!a.timeUncertain||!!b.timeUncertain||!a.sessions.length||!b.sessions.length;
  for(const x of a.sessions)for(const y of b.sessions){if(x.weekday!==y.weekday||!x.periods.some(n=>y.periods.includes(n)))continue;if(!x.weeks.length||!y.weeks.length)unknown=true;else if(x.weeks.some(n=>y.weeks.includes(n)))clash=true;}
  if(clash)pairs.push({a:a.id,b:b.id,names:[a.name,b.name]});else if(unknown)uncertain.push({a:a.id,b:b.id,names:[a.name,b.name]});
 }
 return {pairs,uncertain,incomplete:courses.filter(c=>c.timeUncertain||!c.sessions.length||c.sessions.some(s=>!s.weeks.length)).map(c=>({id:c.id,name:c.name}))};
}
export function getPlan(id){const p=db.prepare('SELECT * FROM course_plans WHERE id=?').get(id);if(!p)throw new Error('方案不存在');const courses=db.prepare('SELECT c.data,p.status FROM plan_courses p JOIN catalog_courses c ON c.id=p.course_id WHERE p.plan_id=?').all(id).map(r=>({...JSON.parse(r.data),planStatus:r.status}));const selected=courses.filter(c=>c.planStatus==='selected');return {...p,courses,credits:selected.reduce((n,c)=>n+(c.credits||0),0),unknownCredits:selected.filter(c=>c.credits===null).length,conflicts:conflicts(selected)};}
