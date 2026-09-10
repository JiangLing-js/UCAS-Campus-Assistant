import { z } from 'zod';
import { extractDeadlines, deadlineSource } from './deadlines.js';
import { db, stableId, getItem, upsertItem } from './store.js';
import { itemInput } from './tools.js';

const rowsInput=z.object({items:z.array(z.object({
 title:z.string().trim().min(1).max(300),startsAt:z.string().datetime({offset:true}),
 remindMinutes:z.number().int().min(0).max(43200).nullable(),
 content:z.string().max(20000).default(''),sourceUrl:z.string().max(3000).default(''),
}).strict()).min(1).max(50)}).strict();
export function importDeadlines(input){
 const rows=rowsInput.parse(input).items;const saved=[];let duplicates=0;
 db.exec('BEGIN IMMEDIATE');
 try{
  for(const row of rows){
   const data=itemInput.parse({...row,kind:'deadline'}),sourceUrl=deadlineSource(row.sourceUrl);
   const id=stableId('deadline-import',`${data.title}:${data.startsAt}:${sourceUrl}`);
   const existing=getItem(id);
   if(existing){duplicates++;saved.push(existing);continue;}
   saved.push(upsertItem({...data,id,source:'manual',sourceUrl}));
  }
  db.exec('COMMIT');return {items:saved,count:saved.length-duplicates,duplicates};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
export function deadlineRoutes(app){
 app.post('/api/deadlines/preview',(req,res)=>res.json(extractDeadlines(req.body)));
 app.post('/api/deadlines/import',(req,res)=>res.json(importDeadlines(req.body)));
}
