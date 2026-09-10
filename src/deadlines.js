import { z } from 'zod';

const dayMs=86400000;
const pad=n=>String(n).padStart(2,'0');
const dayKey=at=>new Date(at.getTime()+8*3600000).toISOString().slice(0,10);
export const deadlineTextInput=z.object({
 text:z.string().trim().min(1).max(50000),
 title:z.string().trim().max(300).default(''),
 sourceUrl:z.string().max(3000).default(''),
 referenceTime:z.string().datetime({offset:true}).optional(),
}).strict();
export function deadlineSource(value){
 if(!value)return '';
 try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return '';u.search='';u.hash='';return u.href;}catch{return '';}
}
const datePattern=/(?:\d{4}[-年/.])?\d{1,2}[-月/.]\d{1,2}日?|今天|明天|后天/g;
const cue=/(?:截止(?:日期|时间)?|截至|最晚|\bDDL\b|\bdeadline\b|\bdue(?: date)?\b)/i;
const action=/(?:提交|上交|交作业|完成|报名)/;

// Local, deterministic extraction. Ambiguous times remain editable candidates, never automatic tasks.
export function extractDeadlines(input,{now=new Date()}={}){
 const s=deadlineTextInput.parse(input),reference=new Date(s.referenceTime||now);
 const referenceDate=dayKey(reference),year=Number(referenceDate.slice(0,4));
 const lines=s.text.replace(/\r/g,'').replace(/：/g,':').split(/[\n；;。]+/).map(v=>v.trim()).filter(Boolean);
 const candidates=[];let previous='';
 for(const line of lines){
  const label=line.match(cue),matches=[...line.matchAll(datePattern)];
  if(!matches.length||(!label&&!action.test(line))){previous=line;continue;}
  // A publication/start date preceding an explicit deadline label is not the due date.
  const afterLabel=label?matches.filter(m=>m.index>=label.index+label[0].length):[];
  const selected=afterLabel.length?afterLabel:matches;
  const m=selected[0],warnings=[];
  if(selected.length>1)warnings.push('同一段出现多个日期，请核对实际截止日期。');
  let date,validDate=true;
  if(['今天','明天','后天'].includes(m[0])){
   date=dayKey(new Date(reference.getTime()+['今天','明天','后天'].indexOf(m[0])*dayMs));
   warnings.push(`“${m[0]}”按参考日期 ${referenceDate} 解释，请确认原文发布时间。`);
  }else{
   const parts=m[0].match(/^(?:(\d{4})[-年/.])?(\d{1,2})[-月/.](\d{1,2})日?$/);
   date=`${parts[1]||year}-${pad(parts[2])}-${pad(parts[3])}`;
   if(!parts[1])warnings.push(`原文未写年份，暂按 ${year} 年识别，请核对。`);
   const parsed=new Date(date+'T00:00:00+08:00');
   validDate=Number.isFinite(parsed.getTime())&&dayKey(parsed)===date;
   if(!validDate)warnings.push('原文日期无效，请手动填写正确日期。');
  }
  const tail=line.slice(m.index+m[0].length);
  const clock=tail.match(/^\s*(?:[（(][^）)]{0,8}[）)]\s*)?(凌晨|早上|上午|中午|下午|晚上)?\s*(\d{1,2})(?::(\d{2})(?::(\d{2}))?|点(?:(\d{1,2})分?)?)/);
  let startsAt=null;
  if(clock){
   let hour=Number(clock[2]);const minute=Number(clock[3]||clock[5]||0),second=Number(clock[4]||0);
   if(['下午','晚上'].includes(clock[1])&&hour<12)hour+=12;
   if(clock[1]==='中午'&&hour<11)hour+=12;
   if(clock[1]==='凌晨'&&hour===12)hour=0;
   if(validDate&&hour<=23&&minute<=59&&second<=59)startsAt=new Date(`${date}T${pad(hour)}:${pad(minute)}:${pad(second)}+08:00`).toISOString();
   else warnings.push('原文时间无效，请手动填写。');
  }else warnings.push('原文没有明确时刻，请补全截止时间后保存。');
  if(startsAt&&Date.parse(startsAt)<reference.getTime())warnings.push('识别出的截止时间已经过去，请核对年份及通知是否仍适用。');
  const prefix=line.slice(0,label?.index??m.index).replace(/^[\s\d、.)）-]+/,'').replace(/[，,:\s]+$/,'');
  let title=prefix.replace(/(?:作业)?(?:提交|上交|完成)?(?:时间|日期)\s*$/,'').trim();
  if(!title||/^(请|请于|于|务必|请在)$/.test(title))title=s.title||previous||line;
  candidates.push({title:title.slice(0,300),startsAt,date:validDate?date:'',sourceUrl:deadlineSource(s.sourceUrl),evidence:line.slice(0,2000),warnings});
  previous=line;
  if(candidates.length===50)break;
 }
 return {candidates:[...new Map(candidates.map(c=>[`${c.title}:${c.startsAt||c.date}:${c.evidence}`,c])).values()],referenceTime:reference.toISOString(),timezone:'Asia/Shanghai',message:candidates.length?'请核对标题、时间和适用对象后保存。':'没有识别到同时包含截止/提交要求和明确日期的文字。可手动添加事项。'};
}
