import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ucas-http-test-'));let child,origin,cookie,port;
const env={...process.env,UCAS_DATA_DIR:temp,DEEPSEEK_API_KEY:''};
before(async()=>{
 const reservation=net.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));origin=`http://127.0.0.1:${port}`;
 child=spawn(process.execPath,['src/server.js'],{cwd:path.resolve('.'),env:{...env,PORT:String(port)},stdio:['ignore','pipe','pipe'],windowsHide:true});
 let startupError='';child.stderr.on('data',chunk=>{startupError=(startupError+chunk.toString()).slice(-1500);});
 await Promise.race([new Promise((resolve,reject)=>{child.stdout.on('data',chunk=>{if(chunk.toString().includes('UCAS Companion:'))resolve();});child.once('exit',code=>reject(new Error('Server exited '+code+' '+startupError)));}),new Promise((_,reject)=>{const t=setTimeout(()=>reject(new Error('Server startup timeout '+startupError)),30000);t.unref();})]);
 const page=await fetch(origin);cookie=page.headers.get('set-cookie').split(';')[0];assert.equal(page.status,200);
});
const request=(url,body,extra={})=>fetch(origin+url,{method:body?'POST':'GET',headers:{cookie,...(body?{'Content-Type':'application/json'}:{}),...extra.headers},body:body?JSON.stringify(body):undefined,...(extra.method?{method:extra.method}:{})});

test('one-click HTTP queue requires authentication and a source-bound, expiring bridge lease',async()=>{
 assert.equal((await fetch(origin+'/api/campus-sync')).status,401);
 assert.equal((await request('/api/bridge/sync/claim',{version:'0.5.0'})).status,401);
 const settings=await(await request('/api/settings')).json(),headers={'X-Ucas-Token':settings.bridgeToken,Origin:'chrome-extension://'+'a'.repeat(32)};
 const created=await(await request('/api/campus-sync',{sources:['news']})).json();assert.equal(created.job.done,false);
 const claimed=await(await request('/api/bridge/sync/claim',{version:'0.5.0'},{headers})).json();assert.equal(claimed.step.source,'news');
 const wrong=await request('/api/bridge/sync/report',{...claimed.step,status:'ok',snapshots:[{sourceUrl:'https://mail.cstnet.cn/',integration:'mail',mail:[]}]},{headers});assert.equal(wrong.status,500);
 const report=await(await request('/api/bridge/sync/report',{...claimed.step,status:'ok',snapshots:[{sourceUrl:'https://www.ucas.ac.cn/',title:'校园新闻',tables:[],links:[{text:'关于虚构测试活动的校园通知',href:'https://www.ucas.ac.cn/test.html'}]}]},{headers})).json();assert.equal(report.job.status,'completed');assert.equal(report.job.steps[0].count,1);
 assert.equal((await request('/api/bridge/sync/report',{...claimed.step,status:'empty'},{headers})).status,500);
 const status=await(await request('/api/campus-sync/'+created.job.id)).json();assert.equal(status.bridge.version,'0.5.0');assert.doesNotMatch(JSON.stringify(status),/lease_token|leaseToken|ticket/);
});
test('loopback API refuses unauthenticated calls, foreign Origin, and DNS rebinding Host',async()=>{
 assert.equal((await fetch(origin+'/api/state')).status,401);
 assert.equal((await request('/api/items',{kind:'note',title:'bad'},{headers:{Origin:'https://evil.test'}})).status,403);
 const reboundStatus=await new Promise((resolve,reject)=>{http.get(origin+'/api/health',{headers:{Host:'evil.test:'+port}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject);});assert.equal(reboundStatus,403);
 const response=await fetch(origin);assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
});
test('HTTP creates, lists, normalizes updates, and completes a real local deadline',async()=>{
 const created=await (await request('/api/items',{kind:'deadline',title:'集成测试事项',startsAt:'2030-01-02T20:00:00+08:00',remindMinutes:15})).json();assert.equal(created.startsAt,'2030-01-02T12:00:00.000Z');
 const patched=await(await request('/api/items/'+created.id,{startsAt:'2030-01-03T20:00:00+08:00'},{method:'PATCH'})).json();assert.equal(patched.startsAt,'2030-01-03T12:00:00.000Z');
 assert.equal((await request('/api/items/'+created.id,{endsAt:'2029-01-01T00:00:00Z'},{method:'PATCH'})).status,400);
 assert.equal((await request('/api/items/'+created.id,{status:'done'},{method:'PATCH'})).status,200);
 const state=await(await request('/api/state')).json();assert.equal(state.items.find(i=>i.id===created.id).status,'done');
});
test('bridge requires its own token and validates UCAS-only import; handles Unicode bad tokens safely',async()=>{
 const settings=await(await request('/api/settings')).json();assert.equal(settings.hasDeepseekKey,false);assert.ok(!('deepseekKey'in settings));
 const data={snapshots:[{sourceUrl:'https://sep.ucas.ac.cn/sepCard/card',title:'SEP',links:[{text:'关于集成测试的一条通知',href:''}]}]};
 const headers={'Content-Type':'application/json',Origin:'chrome-extension://'+'a'.repeat(32)};
 assert.equal((await fetch(origin+'/api/bridge/import',{method:'POST',headers:{...headers,'X-Ucas-Token':'é'.repeat(48)},body:JSON.stringify(data)})).status,401);
 const imported=await fetch(origin+'/api/bridge/import',{method:'POST',headers:{...headers,'X-Ucas-Token':settings.bridgeToken},body:JSON.stringify(data)});assert.equal(imported.status,200);assert.equal((await imported.json()).results[0].count,1);
 data.snapshots[0].sourceUrl='https://evil.test/';assert.equal((await fetch(origin+'/api/bridge/import',{method:'POST',headers:{...headers,'X-Ucas-Token':settings.bridgeToken},body:JSON.stringify(data)})).status,400);
});
test('real stdio MCP handshake exposes and calls all expected campus tools',async()=>{
 const client=new Client({name:'integration-test',version:'1.0.0'});const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('src/mcp.js')],env,stderr:'pipe'});
 try{
  await client.connect(transport);const result=await client.listTools();assert.equal(result.tools.length,18);const created=await client.callTool({name:'create_item',arguments:{kind:'note',title:'MCP 实际握手测试'}});assert.ok(!created.isError);const found=await client.callTool({name:'search_campus',arguments:{query:'MCP 实际握手测试'}});assert.match(found.content[0].text,/MCP 实际握手测试/);const sources=await client.callTool({name:'list_sources',arguments:{}});assert.match(sources.content[0].text,/SEP/);
  const queued=await client.callTool({name:'sync_campus',arguments:{sources:['news','lectures']}});assert.ok(!queued.isError);
  const job=JSON.parse(queued.content[0].text).job;assert.equal(job.status,'queued');
  const web=await(await request('/api/campus-sync/'+job.id)).json();assert.equal(web.job.steps.length,2);assert.equal(web.job.id,job.id);
  const stopped=await client.callTool({name:'cancel_sync',arguments:{id:job.id}});assert.equal(JSON.parse(stopped.content[0].text).job.status,'cancelled');
 }finally{await client.close();}
});
test('dataset preview/import/planning endpoints work and new private routes require the local session',async()=>{
 for(const route of ['/api/services','/api/mail','/api/datasets','/api/plans'])assert.equal((await fetch(origin+route)).status,401);
 const preview=await request('/api/datasets/preview',{filename:'courses.csv',base64:Buffer.from('课程编号,课程名称,学分,星期节次,开课周\nA1,接口测试课程,3,周一(1-2),1-16').toString('base64')});assert.equal(preview.status,200);const parsed=await preview.json();assert.equal(parsed.courses[0].credits,3);
 const dataset=await(await request('/api/datasets',{name:'导入接口测试',courses:parsed.courses})).json();const courseList=await(await request('/api/catalog?datasetId='+dataset.id)).json();assert.equal(courseList.total,1);
 const plan=await(await request('/api/plans',{name:'测试方案',datasetId:dataset.id})).json();const changed=await(await request('/api/plans/'+plan.id+'/courses',{courseId:courseList.courses[0].id,status:'selected'})).json();assert.equal(changed.credits,3);
 const settings=await(await request('/api/settings')).json();assert.equal(settings.hasMailPassword,false);assert.equal(settings.allowMailAi,false);assert.equal(settings.mailPassword,undefined);
 const missing=await(await request('/api/mail/sync',{})).json();assert.equal(missing.ok,false);assert.match(missing.message,/本地设置/);
 assert.equal((await request('/api/settings',{mailAccount:'other@example.test'})).status,400);
});
test('one-click HTTP broker requires a local session and a pinned, single-use extension ticket',async()=>{
 const extensionId='a'.repeat(32),input={provider:'sep',extensionId};
 assert.equal((await fetch(origin+'/api/login/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})).status,401);
 assert.equal((await request('/api/login/jobs',input,{headers:{Origin:'https://evil.test'}})).status,403);
 assert.equal((await request('/api/login/jobs',input)).status,400);
 assert.equal((await request('/api/settings',{ucasAccount:'login-test@example.test',ucasPassword:'dummy-sep-login-password',mailAccount:'mail-test@example.test',mailPassword:'dummy-mail-login-password',deepseekKey:'dummy-key-never-returned'})).status,200);
 const settings=await(await request('/api/settings')).json();assert.equal(settings.hasPassword,true);assert.doesNotMatch(JSON.stringify(settings),/dummy-/);
 const job=await(await request('/api/login/jobs',input)).json();assert.equal(job.state,'pending');assert.equal(job.password,undefined);
 const bridge=(action,body,headers={})=>fetch(origin+'/api/bridge/login/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Ucas-Extension':extensionId,Origin:'chrome-extension://'+extensionId,...headers},body:JSON.stringify(body)});
 assert.equal((await bridge('claim',{id:job.id,ticket:settings.bridgeToken},{'X-Ucas-Token':settings.bridgeToken})).status,401);
 assert.equal((await bridge('claim',{id:job.id,ticket:job.ticket},{Origin:'chrome-extension://'+'b'.repeat(32),'X-Ucas-Extension':'b'.repeat(32)})).status,401);
 assert.equal((await bridge('claim',{id:job.id,ticket:job.ticket},{Origin:'chrome-extension://'+'b'.repeat(32)})).status,403);
 assert.equal((await request('/api/bridge/login/claim',{id:job.id,ticket:job.ticket})).status,403);
 const credentials=await(await bridge('claim',{id:job.id,ticket:job.ticket})).json();assert.deepEqual(credentials,{provider:'sep',account:'login-test@example.test',password:'dummy-sep-login-password'});
 assert.equal((await bridge('claim',{id:job.id,ticket:job.ticket})).status,409);
 assert.equal((await bridge('report',{id:job.id,ticket:job.ticket,state:'success'})).status,200);
 const status=await(await request('/api/login/jobs/'+job.id)).json();assert.equal(status.state,'success');assert.equal(status.done,true);assert.equal(status.ticket,undefined);assert.doesNotMatch(JSON.stringify(status),/dummy-/);
 assert.equal((await fetch(origin+'/api/login/jobs/'+job.id)).status,401);
 assert.equal((await request('/api/settings',{ucasAccount:'different@example.test'})).status,400);
 const mailJob=await(await request('/api/login/jobs',{provider:'mail',extensionId})).json();
 const originless=await fetch(origin+'/api/bridge/login/claim',{method:'POST',headers:{'Content-Type':'application/json','X-Ucas-Extension':extensionId},body:JSON.stringify({id:mailJob.id,ticket:mailJob.ticket})});
 assert.equal(originless.status,200);assert.equal((await originless.json()).password,'dummy-mail-login-password');
});

test('deadline and reminder HTTP routes protect data and coordinate browser/extension claims',async()=>{
 for(const route of ['/api/deadlines/preview','/api/deadlines/import','/api/notifications/claim','/api/notifications/ack'])assert.equal((await fetch(origin+route,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
 const draft=await(await request('/api/deadlines/preview',{text:'作业截止：2031年4月5日23:59',referenceTime:'2031-04-01T00:00:00Z'})).json();assert.equal(draft.candidates[0].startsAt,'2031-04-05T15:59:00.000Z');
 const input={items:[{title:'API 导入作业',startsAt:draft.candidates[0].startsAt,remindMinutes:60}]};
 assert.equal((await(await request('/api/deadlines/import',input)).json()).count,1);assert.equal((await(await request('/api/deadlines/import',input)).json()).duplicates,1);
 const due=await(await request('/api/items',{kind:'reminder',title:'API 提醒测试',startsAt:new Date().toISOString(),remindMinutes:0})).json();
 const settings=await(await request('/api/settings')).json();
 const bridgeHeaders={'Content-Type':'application/json',Origin:'chrome-extension://'+'a'.repeat(32)};
 assert.equal((await fetch(origin+'/api/bridge/notifications/claim',{method:'POST',headers:bridgeHeaders,body:'{}'})).status,401);
 const pageClaim=await(await request('/api/notifications/claim',{})).json();const n=pageClaim.notifications.find(n=>n.title==='API 提醒测试');assert.ok(n);
 const bridgeClaim=await(await fetch(origin+'/api/bridge/notifications/claim',{method:'POST',headers:{...bridgeHeaders,'X-Ucas-Token':settings.bridgeToken},body:'{}'})).json();assert.equal(bridgeClaim.notifications.length,0);
 const ack=await(await request('/api/notifications/ack',{ids:[n.id],deliveryToken:pageClaim.deliveryToken})).json();assert.equal(ack.count,1);
 assert.equal((await request('/api/notifications/'+n.id+'/snooze',{minutes:30})).status,200);
 const state=await(await request('/api/state')).json();assert.equal(state.items.find(i=>i.id===due.id).startsAt,due.startsAt);assert.ok(state.snoozes.some(s=>s.notificationId===n.id));
 assert.equal((await request('/api/notifications/'+n.id+'/snooze',{minutes:-1})).status,400);
});

after(async()=>{if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}fs.rmSync(temp,{recursive:true,force:true});});
