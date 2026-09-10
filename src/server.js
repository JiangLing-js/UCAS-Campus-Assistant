import express from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ROOT, DATA } from './paths.js';
import { db,getSetting,setSetting,listItems,getItem,upsertItem,tickReminders,notifications,createConversation,messages } from './store.js';
import { readSecrets,saveSecrets } from './vault.js';
import { ingestSnapshot,cleanUrl } from './ingest.js';
import { SOURCES,syncSource } from './sources.js';
import { itemInput,updateItem } from './tools.js';
import { deadlineRoutes } from './deadline-routes.js';
import { claimNotifications,acknowledgeNotifications,snoozeNotification,tickSnoozes,scheduledSnoozes } from './reminders.js';
import { chat } from './deepseek.js';
import { calendar } from './calendar.js';
import { extendedRoutes } from './extended-routes.js';
import { syncMailbox } from './mail.js';
import { createLoginBroker,loginBridgeRoutes,loginRoutes } from './login.js';
import {campusSyncBridgeRoutes,campusSyncRoutes} from './campus-sync-routes.js';

const app=express();const port=Number(process.env.PORT||3210);const origin=`http://127.0.0.1:${port}`;
const session=randomBytes(32).toString('hex');
const loginBroker=createLoginBroker({readSecrets,onFailure:event=>console.warn('UCAS login: '+JSON.stringify(event))});
if(!getSetting('bridgeToken'))setSetting('bridgeToken',randomBytes(24).toString('hex'));
const sameToken=(a,b)=>typeof a==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
app.disable('x-powered-by');
app.use((req,res,next)=>{
 if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host))return res.status(403).json({error:'不允许的访问主机'});
 res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
 const caller=req.headers.origin;
 if(['/api/bridge/import','/api/bridge/login/claim','/api/bridge/login/report','/api/bridge/notifications/claim','/api/bridge/notifications/ack','/api/bridge/sync/start','/api/bridge/sync/claim','/api/bridge/sync/report'].includes(req.path)&&caller?.match(/^chrome-extension:\/\/[a-p]{32}$/)){
  res.set({'Access-Control-Allow-Origin':caller,'Access-Control-Allow-Headers':'Content-Type, X-Ucas-Token, X-Ucas-Extension','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'});
  if(req.method==='OPTIONS')return res.sendStatus(204);
 }else if(caller&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(caller))return res.status(403).json({error:'不允许跨站访问本地服务'});
 next();
});
app.use(express.json({limit:'16mb'}));
app.get('/api/health',(_,res)=>res.json({ok:true,service:'ucas-companion'}));
app.post('/api/bridge/import',(req,res)=>{
 if(!sameToken(req.headers['x-ucas-token'],getSetting('bridgeToken')))return res.status(401).json({error:'连接码不正确，请在本地设置页重新复制。'});
 const snapshots=z.array(z.unknown()).min(1).max(20).parse(req.body.snapshots);
 const results=snapshots.map(s=>ingestSnapshot(s));res.json({ok:true,results});
});
loginBridgeRoutes(app,loginBroker);
campusSyncBridgeRoutes(app,token=>sameToken(token,getSetting('bridgeToken')));
for(const [action,run] of Object.entries({claim:()=>claimNotifications(),ack:acknowledgeNotifications}))app.post('/api/bridge/notifications/'+action,(req,res)=>{
 if(!sameToken(req.headers['x-ucas-token'],getSetting('bridgeToken')))return res.status(401).json({error:'连接码不正确。'});
 res.json(run(req.body));
});
app.use('/api',(req,res,next)=>{
 const cookie=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('ucas_session='))?.slice(13);
 if(!sameToken(cookie,session))return res.status(401).json({error:'请重新打开本地工作台。'});
 if(!['GET','HEAD'].includes(req.method)&&!req.is('application/json'))return res.status(415).json({error:'请使用 JSON 请求'});
 next();
});
extendedRoutes(app);
deadlineRoutes(app);
loginRoutes(app,loginBroker);
campusSyncRoutes(app);
app.get('/api/state',(_,res)=>res.json({items:listItems({limit:500}),notifications:notifications(),snoozes:scheduledSnoozes(),sources:SOURCES,syncs:db.prepare('SELECT * FROM syncs').all(),conversations:db.prepare('SELECT * FROM conversations ORDER BY created_at DESC').all(),serverTime:new Date().toISOString()}));
app.get('/api/settings',(_,res)=>{
 const secrets=readSecrets();res.json({model:getSetting('model','deepseek-v4-flash'),hasDeepseekKey:!!(secrets.deepseekKey||process.env.DEEPSEEK_API_KEY),hasAccount:!!secrets.ucasAccount,hasPassword:!!secrets.ucasPassword,hasMailAccount:!!secrets.mailAccount,hasMailPassword:!!secrets.mailPassword,autoMail:getSetting('autoMail',false),allowMailAi:getSetting('allowMailAi',false),cookieOrigins:Object.keys(secrets.cookies||{}),bridgeToken:getSetting('bridgeToken'),autoSync:getSetting('autoSync',false),vault:'Windows DPAPI · 当前 Windows 用户',dataDirectory:DATA,extensionDirectory:path.join(ROOT,'extension'),mcpConfig:{mcpServers:{ucas:{command:process.execPath,args:[path.join(ROOT,'src/mcp.js')],env:{UCAS_DATA_DIR:DATA}}}}});
});
app.post('/api/settings',(req,res)=>{
 const input=z.object({model:z.string().trim().min(1).max(100).optional(),deepseekKey:z.string().trim().max(500).optional(),ucasAccount:z.string().trim().max(200).optional(),ucasPassword:z.string().max(500).optional(),mailAccount:z.union([z.literal(''),z.email().max(200)]).optional(),mailPassword:z.string().max(500).optional(),autoMail:z.boolean().optional(),allowMailAi:z.boolean().optional(),autoSync:z.boolean().optional()}).strict().parse(req.body);
 const update={};for(const key of ['deepseekKey','ucasAccount','ucasPassword','mailAccount','mailPassword'])if(input[key])update[key]=input[key];
 if(input.ucasAccount&&input.ucasAccount!==readSecrets().ucasAccount&&!input.ucasPassword)return res.status(400).json({error:'更换 SEP 账号时，请同时填写该账号的密码。'});
 if(input.mailAccount&&input.mailAccount!==readSecrets().mailAccount&&!input.mailPassword)return res.status(400).json({error:'更换邮箱账号时，请同时填写该账号的密码。'});
 if(Object.keys(update).length)saveSecrets(update);
 for(const key of ['autoMail','allowMailAi'])if(input[key]!==undefined)setSetting(key,input[key]);
 if(input.model)setSetting('model',input.model);if(input.autoSync!==undefined)setSetting('autoSync',input.autoSync);res.json({ok:true});
});
app.post('/api/cookies',(req,res)=>{
 const input=z.object({sourceId:z.string(),cookie:z.string().trim().max(20000)}).parse(req.body);const source=SOURCES.find(s=>s.id===input.sourceId);if(!source)return res.status(400).json({error:'未知来源'});
 if(/[\r\n]/.test(input.cookie))return res.status(400).json({error:'Cookie 不能包含换行'});
 const secrets=readSecrets();const cookies={...secrets.cookies};const host=new URL(source.url).origin;
 if(input.cookie)cookies[host]=input.cookie;else delete cookies[host];saveSecrets({cookies});res.json({ok:true});
});
app.post('/api/items',(req,res)=>{const r=upsertItem(itemInput.parse(req.body));tickReminders();res.json(r);});
app.patch('/api/items/:id',(req,res)=>{
 const existing=getItem(req.params.id);if(!existing)return res.status(404).json({error:'事项不存在'});
 const result=updateItem(req.params.id,req.body);tickReminders();res.json(result);
});
app.post('/api/import',(req,res)=>res.json(ingestSnapshot(req.body)));
app.post('/api/sync/:id',async(req,res)=>res.json(await syncSource(req.params.id)));
app.post('/api/notifications/:id/read',(req,res)=>{db.prepare('UPDATE notifications SET seen=1 WHERE id=?').run(req.params.id);res.json({ok:true});});
app.post('/api/notifications/read-all',(_,res)=>{db.prepare('UPDATE notifications SET seen=1 WHERE seen=0').run();res.json({ok:true});});
app.post('/api/notifications/claim',(_,res)=>res.json(claimNotifications()));
app.post('/api/notifications/ack',(req,res)=>res.json(acknowledgeNotifications(req.body)));
app.post('/api/notifications/:id/snooze',(req,res)=>res.json(snoozeNotification(req.params.id,z.object({minutes:z.number()}).strict().parse(req.body).minutes)));
app.post('/api/conversations',(_,res)=>res.json(createConversation()));
app.post('/api/shutdown',(_,res)=>{res.json({ok:true});setTimeout(()=>process.emit('SIGTERM'),100);});
app.get('/api/conversations/:id/messages',(req,res)=>res.json(messages(req.params.id)));
const activeChats=new Set();
app.post('/api/chat',async(req,res)=>{
 const input=z.object({conversationId:z.string(),text:z.string().trim().min(1).max(12000)}).parse(req.body);
 if(!db.prepare('SELECT id FROM conversations WHERE id=?').get(input.conversationId))return res.status(404).json({error:'对话不存在'});
 if(activeChats.has(input.conversationId))return res.status(409).json({error:'此对话正在生成回答。'});
 activeChats.add(input.conversationId);const controller=new AbortController();res.on('close',()=>controller.abort());
 res.set({'Content-Type':'text/event-stream; charset=utf-8','Connection':'keep-alive'});res.flushHeaders();
 const send=event=>{if(!res.writableEnded&&!res.destroyed)res.write(`data: ${JSON.stringify(event)}\n\n`);};
 const pulse=setInterval(()=>send({type:'ping'}),15000);
 try{await chat({...input,signal:controller.signal,onEvent:send});send({type:'done'});}
 catch(e){if(!controller.signal.aborted)send({type:'error',text:e.message});}
 finally{clearInterval(pulse);activeChats.delete(input.conversationId);res.end();}
});
app.get('/api/calendar.ics',(_,res)=>res.set({'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':'attachment; filename=ucas-calendar.ics'}).send(calendar(listItems({status:'open',limit:500}))));
app.get('/',(req,res)=>{res.cookie('ucas_session',session,{httpOnly:true,sameSite:'strict',path:'/'});res.sendFile(path.join(ROOT,'public/index.html'));});
app.use(express.static(path.join(ROOT,'public'),{index:false}));
app.use((err,req,res,next)=>{if(res.headersSent)return next(err);res.status(err instanceof z.ZodError?400:500).json({error:err instanceof z.ZodError?err.issues.map(i=>i.message).join('；'):'操作失败，请检查数据格式或稍后重试。'});});
const bootstrap=path.join(DATA,'bootstrap-snapshots.json');if(fs.existsSync(bootstrap)&&!getSetting('bootstrapImported')){for(const snapshot of JSON.parse(fs.readFileSync(bootstrap,'utf8')))ingestSnapshot(snapshot);setSetting('bootstrapImported',true);}
function checkReminders(){tickReminders();tickSnoozes();}
checkReminders();const reminders=setInterval(checkReminders,15000);let syncing=false;
const auto=setInterval(async()=>{if(!getSetting('autoSync',false)||syncing)return;syncing=true;try{await syncSource('news');}finally{syncing=false;}},30*60000);
const mailAuto=setInterval(()=>{if(getSetting('autoMail',false))syncMailbox().catch(()=>{});},15*60000);
const httpServer=app.listen(port,'127.0.0.1',()=>console.log(`UCAS Companion: ${origin}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{clearInterval(reminders);clearInterval(auto);clearInterval(mailAuto);httpServer.close(()=>{db.close();process.exit(0);});});
