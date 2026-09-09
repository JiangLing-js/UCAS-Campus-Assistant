import { load } from 'cheerio';
import { cleanUrl, ingestSnapshot } from './ingest.js';
import { readSecrets } from './vault.js';
import { recordSync } from './store.js';

export const SOURCES=[
 {id:'sep',name:'SEP 个人工作台',url:'https://sep.ucas.ac.cn/sepCard/card',type:'session',description:'通知公告、校园事务'},
 {id:'lectures',name:'科学前沿讲座',url:'https://xkcts.ucas.ac.cn:8443/subject/lecture',type:'session',description:'讲座时间、地点、报名入口'},
 {id:'courses',name:'网络教学平台',url:'https://i.mooc.ucas.edu.cn/space/index',type:'session',description:'课程、作业与通知'},
 {id:'timetable',name:'我的课表',url:'https://kb.mooc.ucas.edu.cn/res/pc/curriculum/schedule.html',type:'session',description:'当前显示周的课程安排'},
 {id:'news',name:'国科大首页',url:'https://www.ucas.ac.cn/',type:'public',description:'校园新闻与公开通知'},
];
export function htmlSnapshot(html,url){
 const $=load(html);$('script,style,input,textarea,select,nav,header,footer').remove();
 return {sourceUrl:cleanUrl(url),title:$('title').text().trim(),capturedAt:new Date().toISOString(),text:$('body').text().replace(/\s{3,}/g,'\n').slice(0,150000),
  tables:$('table').slice(0,20).map((i,t)=>({id:$(t).attr('id')||'',rows:$(t).find('tr').slice(0,500).map((j,r)=>({cells:$(r).children('td,th').slice(0,50).map((k,c)=>({text:$(c).text().trim().slice(0,10000),rowSpan:Number($(c).attr('rowspan'))||1,colSpan:Number($(c).attr('colspan'))||1})).get(),links:$(r).find('a[href]').slice(0,30).map((k,a)=>({text:$(a).text().trim(),href:new URL($(a).attr('href'),url).href})).get()})).get()})).get(),
  links:$('a[href]').slice(0,500).map((i,a)=>({text:$(a).text().trim().slice(0,1000),href:$(a).attr('href')?.startsWith('javascript:')?'':new URL($(a).attr('href'),url).href})).get()};
}
export async function syncSource(id){
 const source=SOURCES.find(s=>s.id===id);if(!source)throw new Error('未知来源');
 const secrets=readSecrets();const origin=new URL(source.url).origin;const cookie=secrets.cookies?.[origin];
 if(source.type==='session'&&!cookie)return {source:id,status:'browser_required',message:'请用校园桥接扩展同步已登录页面，或在设置中为此站点保存 Cookie。'};
 try{
  const headers={'User-Agent':'UCAS-Companion/0.1 (personal local assistant)'};if(cookie)headers.Cookie=cookie;
  // Credentials never follow a redirect to another host or enter model context.
  const response=await fetch(source.url,{headers,redirect:'manual',signal:AbortSignal.timeout(18000)});
  if(response.status>=300&&response.status<400)throw new Error('页面要求跳转或重新登录，请使用浏览器扩展同步。');
  if(!response.ok)throw new Error(`来源返回 HTTP ${response.status}`);
  const reader=response.body.getReader();const chunks=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>3_000_000){await reader.cancel();throw new Error('页面超过读取大小限制');}chunks.push(value);}
  const html=Buffer.concat(chunks).toString('utf8');
  if(/<input[^>]*type=["']password/i.test(html))throw new Error('登录状态已过期，请重新登录。');
  const result=ingestSnapshot(htmlSnapshot(html,source.url));return {...result,status:'ok'};
 }catch(error){const message=/fetch failed|timeout|abort/i.test(error.message)?'网络连接失败或超时，请检查校园网连接。':error.message;recordSync(id,'error',message);return {source:id,status:'error',message};}
}
