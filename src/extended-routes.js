import { z } from 'zod';
import { parseDataset,importDataset,datasets,searchCatalog,addCourse,courseInput,createPlan,plans,getPlan,setPlanCourse } from './catalog.js';
import { campusServices,listMail,clearMail } from './integrations.js';
import { syncMailbox } from './mail.js';
import { saveSecrets } from './vault.js';
import { setSetting } from './store.js';

export function extendedRoutes(app){
 app.get('/api/services',(_,res)=>res.json(campusServices()));
 app.get('/api/mail',(req,res)=>res.json(listMail(z.object({query:z.string().max(200).default(''),unreadOnly:z.enum(['true','false']).optional().transform(v=>v==='true')}).parse(req.query))));
 app.post('/api/mail/sync',async(_,res)=>res.json(await syncMailbox()));
 app.post('/api/mail/disconnect',(_,res)=>{saveSecrets({mailAccount:null,mailPassword:null});clearMail();setSetting('autoMail',false);setSetting('allowMailAi',false);res.json({ok:true});});
 app.get('/api/catalog',(req,res)=>res.json(searchCatalog(z.object({datasetId:z.string().optional(),query:z.string().max(200).default(''),semester:z.string().max(100).default(''),category:z.string().max(100).default(''),campus:z.string().max(100).default(''),limit:z.coerce.number().int().min(1).max(200).default(100),offset:z.coerce.number().int().min(0).max(10000).default(0)}).parse(req.query))));
 app.get('/api/datasets',(_,res)=>res.json(datasets()));
 app.post('/api/datasets/preview',(req,res)=>{
  const input=z.object({filename:z.string().max(300),base64:z.string().min(1).max(12*1024*1024).regex(/^[A-Za-z0-9+/]*={0,2}$/)}).parse(req.body);
  try{res.json(parseDataset(Buffer.from(input.base64,'base64'),input.filename));}catch(e){res.status(400).json({error:e instanceof z.ZodError?'课程数据格式不正确':e.message});}
 });
 app.post('/api/datasets',(req,res)=>res.json(importDataset(z.object({name:z.string().trim().min(1).max(250),semester:z.string().max(100).default(''),sourceUrl:z.string().max(3000).default(''),courses:z.array(courseInput).min(1).max(10000)}).parse(req.body))));
 app.post('/api/datasets/:id/courses',(req,res)=>res.json(addCourse(req.params.id,courseInput.parse(req.body))));
 app.get('/api/plans',(_,res)=>res.json(plans()));
 app.get('/api/plans/:id',(req,res)=>res.json(getPlan(req.params.id)));
 app.post('/api/plans',(req,res)=>{const p=z.object({name:z.string().trim().min(1).max(100),datasetId:z.string().min(1)}).parse(req.body);res.json(createPlan(p.name,p.datasetId));});
 app.post('/api/plans/:id/courses',(req,res)=>{const p=z.object({courseId:z.string(),status:z.enum(['selected','alternative','remove'])}).parse(req.body);res.json(setPlanCourse(req.params.id,p.courseId,p.status));});
}
