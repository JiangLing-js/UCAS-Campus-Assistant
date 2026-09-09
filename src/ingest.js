import { z } from 'zod';
import { stableId, upsertItem, recordSync, db } from './store.js';
import { ingestIntegration } from './integrations.js';

export const allowedHost = host => host==='ucas.ac.cn'||host.endsWith('.ucas.ac.cn')||host==='ucas.edu.cn'||host.endsWith('.ucas.edu.cn');
export function cleanUrl(input) {
  try {const u=new URL(input);if(!['https:','http:'].includes(u.protocol)||!allowedHost(u.hostname)||u.username||u.password)return '';u.search='';u.hash='';return u.href;}catch{return '';}
}
const cell=z.object({text:z.string().max(10000),rowSpan:z.number().int().min(1).max(100).default(1),colSpan:z.number().int().min(1).max(100).default(1)});
const link=z.object({text:z.string().max(1000),href:z.string().max(3000)});
export const snapshotSchema=z.object({
  sourceUrl:z.string().max(3000).refine(v=>!!cleanUrl(v),'只支持国科大站点'),title:z.string().max(500),
  capturedAt:z.string().datetime().optional(),text:z.string().max(150000).default(''),
  tables:z.array(z.object({id:z.string().max(200).default(''),rows:z.array(z.object({cells:z.array(cell).max(50),links:z.array(link).max(30).default([])})).max(500)})).max(20).default([]),
  links:z.array(link).max(500).default([]),
});
export const chinaTime=(date,time='00:00')=>new Date(`${date}T${time}:00+08:00`).toISOString();
function item(source,kind,title,extra={}) {return {id:stableId(source,`${kind}:${title}:${extra.startsAt||''}`),source,kind,title,...extra};}
export function parseSnapshot(input) {
  const s=snapshotSchema.parse(input);s.sourceUrl=cleanUrl(s.sourceUrl);
  const results=[];const host=new URL(s.sourceUrl).hostname;
  // UCAS lecture table layout; rows are converted to local items.
  for(const table of s.tables)for(const row of table.rows){
    const c=row.cells.map(c=>c.text.trim());
    const time=c[4]?.match(/(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})\s*[-—~至]\s*(\d{1,2}:\d{2})/);
    if(c.length>=8 && time && /subject/.test(s.sourceUrl)){
      results.push(item('lectures','lecture',c[1],{startsAt:chinaTime(time[1],time[2].padStart(5,'0')),endsAt:chinaTime(time[1],time[3].padStart(5,'0')),location:c[3],content:`专题：${c[0]}\n主讲人：${c[6]||'未提供'}\n面向：${c[5]}\n院系：${c[7]}\n${c[8]||''}`,sourceUrl:cleanUrl(row.links.find(l=>/详情/.test(l.text))?.href)||s.sourceUrl}));
    }
  }
  const schedule=s.tables.find(t=>t.id==='scheduleTable');
  const head=s.tables.find(t=>t.id==='scheduleHead');
  if(schedule && head){
    const dates=head.rows.flatMap(r=>r.cells).map(c=>c.text.match(/(\d{2})-(\d{2})/)).filter(Boolean);
    const captured=new Date(s.capturedAt||Date.now());const year=captured.getFullYear();
    const grid=[];const slots=schedule.rows.map(r=>r.cells[0]?.text.match(/(\d{2}:\d{2})[\s\S]*?(\d{2}:\d{2})/));
    schedule.rows.forEach((row,r)=>{
      let column=0;grid[r] ||= [];
      for(const cell of row.cells){
        while(grid[r][column]) column++;
        const col=column;
        for(let rr=r;rr<r+cell.rowSpan;rr++){grid[rr] ||= [];for(let cc=col;cc<col+cell.colSpan;cc++)grid[rr][cc]=true;}
        if(col>0 && dates[col-1] && cell.text.trim() && slots[r]){
          const [,month,day]=dates[col-1];let date=`${year}-${month}-${day}`;
          const delta=Date.parse(date)-captured.getTime();if(delta>183*86400000)date=`${year-1}-${month}-${day}`;else if(delta< -183*86400000)date=`${year+1}-${month}-${day}`;
          const parts=cell.text.trim().split(/\n\s*@|\s+@/);const title=parts[0].replace(/\n+/g,' ').trim();
          results.push(item('timetable','course',title,{startsAt:chinaTime(date,slots[r][1]),endsAt:chinaTime(date,slots[Math.min(r+cell.rowSpan-1,slots.length-1)][2]),location:parts.slice(1).join(' ').trim(),sourceUrl:s.sourceUrl,content:'仅记录课表页面已显示的日期；其他周次需另行同步。',remindMinutes:15}));
        }
        column+=cell.colSpan;
      }
    });
  }
  if(!schedule && !results.length){
    const kind=/news|新闻网/.test(s.sourceUrl+' '+s.title)||host==='www.ucas.ac.cn'?'news':/notice|通知|sepCard/.test(s.sourceUrl+' '+s.title)?'notice':'note';
    for(const l of s.links){
      const title=l.text.split(/\n+/).map(t=>t.trim()).find(Boolean)?.replace(/\s+/g,' ')||'';const href=cleanUrl(l.href);
      if(kind==='news'&&(!href||!/\.s?html?$/i.test(new URL(href).pathname)))continue;
      if(title.length<9||title.length>250||/退出|注销|登录|密码|个人信息|隐私|版权所有/.test(title))continue;
      if(!/通知|公告|讲座|截止|报名|新闻|关于|报告|作业|考试|安排/.test(title)&&kind!=='news')continue;
      results.push(item(host,kind,title.replace(/^\s*[^\u4e00-\u9fffA-Za-z0-9]+/,''),{sourceUrl:href||s.sourceUrl,content:'此条目来自校园列表；完整内容和适用要求请查看原文。'}));
    }
    if(!results.length && s.text.trim().length>40){
      const text=s.text.replace(/\b1[3-9]\d{9}\b/g,'[手机号码已隐藏]').slice(0,18000);
      results.push(item(host,'note',s.title,{sourceUrl:s.sourceUrl,content:text}));
    }
  }
  return {source:results[0]?.source||host,sourceUrl:s.sourceUrl,items:[...new Map(results.map(i=>[i.id,i])).values()]};
}
export function ingestSnapshot(snapshot){
  if(snapshot?.integration)return ingestIntegration(snapshot);
  const parsed=parseSnapshot(snapshot);db.exec('BEGIN IMMEDIATE');
  try{for(const r of parsed.items)upsertItem(r,{imported:true});recordSync(parsed.source,'ok',`同步 ${parsed.items.length} 条；来源：${parsed.sourceUrl}`);db.exec('COMMIT');}
  catch(e){db.exec('ROLLBACK');throw e;}
  return {source:parsed.source,count:parsed.items.length};
}
