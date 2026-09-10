import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {JSDOM} from 'jsdom';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ucas-full-sync-tests-'));process.env.UCAS_DATA_DIR=temp;
const store=await import('../src/store.js');
const sync=await import('../src/campus-sync.js');
const at=new Date('2032-01-01T00:00:00Z');
const clear=()=>store.db.exec('DELETE FROM campus_sync_steps;DELETE FROM campus_sync_jobs;');
const snapshot={sourceUrl:'https://www.ucas.ac.cn/',title:'校园新闻',tables:[],links:[{text:'关于一项虚构校园测试活动的新闻',href:'https://www.ucas.ac.cn/news/test.html'}]};

test('one-click jobs validate destinations, reuse active work, and expose only bounded progress',()=>{
 clear();assert.throws(()=>sync.requestCampusSync({sources:['https://evil.test']}));assert.throws(()=>sync.requestCampusSync({sources:['news'],url:'https://evil.test'}));
 const {job}=sync.requestCampusSync({}, {at});assert.equal(job.steps.length,9);assert.equal(job.done,false);
 const reused=sync.requestCampusSync({sources:['mail']},{at});assert.equal(reused.reused,true);assert.equal(reused.job.id,job.id);
 const step=sync.claimSyncStep({version:'0.5.0'},at).step;assert.equal(step.source,'sep');assert.equal(sync.claimSyncStep({version:'0.5.0'},at).step,null);
 assert.doesNotMatch(JSON.stringify(sync.syncStatus(job.id,at)),/leaseToken|lease_token|ticket|password/);
 sync.cancelCampusSync(job.id);assert.equal(sync.syncStatus(job.id,at).job.status,'cancelled');
 assert.throws(()=>sync.reportSyncStep({...step,status:'empty'},at));
});

test('interrupted sync resumes with a new lease and reports only verified imports, atomically',()=>{
 clear();const {job}=sync.requestCampusSync({sources:['news']},{at}),a=sync.claimSyncStep({version:'0.5.0'},at).step;
 const later=new Date(at.getTime()+91000),b=sync.claimSyncStep({version:'0.5.0'},later).step;assert.notEqual(a.leaseToken,b.leaseToken);
 assert.throws(()=>sync.reportSyncStep({...a,status:'ok',snapshots:[snapshot]},later));
 assert.throws(()=>sync.reportSyncStep({...b,status:'ok',snapshots:[{...snapshot,sourceUrl:'https://mail.cstnet.cn/'}]},later));
 const before=store.listItems().length;
 assert.throws(()=>sync.reportSyncStep({...b,status:'ok',snapshots:[snapshot,{...snapshot,links:'malformed'}]},later));assert.equal(store.listItems().length,before);
 const result=sync.reportSyncStep({...b,status:'ok',snapshots:[snapshot]},later);assert.equal(result.job.status,'completed');assert.equal(result.job.steps[0].count,1);
 const child=spawnSync(process.execPath,['--input-type=module','-e',`import {syncStatus} from './src/campus-sync.js';import {db} from './src/store.js';console.log(syncStatus('${job.id}').job.status);db.close();`],{cwd:path.resolve('.'),env:process.env,encoding:'utf8',windowsHide:true});assert.equal(child.status,0);assert.equal(child.stdout.trim(),'completed');
});

test('requests during an active sync add missing sources instead of silently dropping them',()=>{
 clear();const first=sync.requestCampusSync({sources:['lectures']},{at});sync.claimSyncStep({version:'0.5.2'},at);
 const expanded=sync.requestCampusSync({}, {at});assert.equal(expanded.job.id,first.job.id);assert.equal(expanded.job.steps.length,9);assert.equal(expanded.job.steps[0].status,'running');
 sync.requestCampusSync({sources:['mail','mail']},{at});assert.equal(sync.syncStatus(first.job.id,at).job.steps.length,9);sync.cancelCampusSync(first.job.id);
});

test('zero extracted rows and expired jobs are never reported as complete',()=>{
 clear();const {job}=sync.requestCampusSync({sources:['news','mail']},{at}),step=sync.claimSyncStep({version:'0.5.0'},at).step;
 const partial=sync.reportSyncStep({...step,status:'ok',snapshots:[{...snapshot,links:[]}]},at);assert.equal(partial.job.steps[0].status,'unsupported');
 const expired=sync.syncStatus(job.id,new Date(at.getTime()+16*60000));assert.equal(expired.job.status,'partial');assert.equal(expired.job.steps[1].reason,'expired');
});

test('mail synchronization results disclose counts without enabling model access to mail',async()=>{
 clear();sync.requestCampusSync({sources:['mail']},{at});const step=sync.claimSyncStep({version:'0.5.0'},at).step;
 const result=sync.reportSyncStep({...step,status:'ok',snapshots:[{sourceUrl:'https://mail.cstnet.cn/',integration:'mail',mail:[{subject:'虚构邮件主题',sender:'sender@example.test',dateText:'2032-01-01',unread:true}]}]},at);
 assert.equal(result.job.steps[0].count,1);assert.doesNotMatch(JSON.stringify(result),/虚构邮件主题|sender@example/);
 const {queryMailForModel}=await import('../src/integrations.js');assert.ok(queryMailForModel({}).error);
 sync.requestCampusSync({sources:['mail']},{at});const next=sync.claimSyncStep({version:'0.5.1'},at).step;
 sync.reportSyncStep({...next,status:'empty',reason:'empty'},at);assert.equal(store.db.prepare("SELECT count(*) AS n FROM campus_mail WHERE channel='browser'").get().n,0);
});

const pageSource=fs.readFileSync(new URL('../extension/sync-page.js',import.meta.url),'utf8');
function page(html,url){
 const dom=new JSDOM(html,{url,runScripts:'outside-only'}),w=dom.window;
 Object.defineProperty(w.document,'readyState',{value:'complete',configurable:true});
 Object.defineProperty(w.HTMLElement.prototype,'innerText',{get(){return this.textContent;},configurable:true});
 w.HTMLElement.prototype.getClientRects=function(){return this.hidden?[]:[{}];};w.eval(pageSource);
 return {w,run:(source,action)=>w.campusSyncPage(source,action)};
}
test('page adapter reads the allowed lecture SSO route without executing inline handlers',()=>{
 const loggedOut=page('<input type="password">','https://sep.ucas.ac.cn/');assert.equal(loggedOut.run('timetable').state,'login_required');loggedOut.w.close();
 const p=page('<nav id="sepTabNav"><button>课程学习</button></nav><section><header><h4>科学前沿讲座</h4></header><button id="more">更多讲座</button><button id="signup">报名</button></section>','https://sep.ucas.ac.cn/sepCard/card');let course=0,more=0,signup=0;
 p.w.document.querySelector('nav button').onclick=()=>course++;p.w.document.querySelector('#more').onclick=()=>more++;p.w.document.querySelector('#signup').onclick=()=>signup++;
 const route='/portal/site/226/xs/1/1/'+'a'.repeat(32);
 p.w.document.querySelector('#more').setAttribute('onclick',`window.open('${route}','_blank')`);
 assert.equal(p.run('lectures','prepare').prepared,true);assert.equal(p.run('lectures','open').url,'https://sep.ucas.ac.cn'+route);assert.deepEqual([course,more,signup],[1,0,0]);
 p.w.document.querySelector('#more').setAttribute('onclick',"window.open('https://evil.test/','_blank')");assert.equal(p.run('lectures','open').state,'unsupported');
 p.w.document.querySelector('#more').setAttribute('onclick',`window.open('${route}','_blank'); steal()`);assert.equal(p.run('lectures','open').state,'unsupported');p.w.close();
 const foreign=page('<table></table>','https://kb.mooc.ucas.edu.cn.evil.test/');assert.equal(foreign.run('timetable').state,'waiting');foreign.w.close();
});

test('second-class SSO chooses only an unambiguous account and pauses for multiple choices',()=>{
 const p=page('<div role="dialog"><span class="el-dialog__title">选择账号</span><div class="unit-list"><div class="unit-item account">fixture-account</div></div></div>','https://ek.ucas.edu.cn/sso');let clicks=0;
 p.w.document.querySelector('.account').onclick=()=>clicks++;
 assert.equal(p.run('activities','prepare').prepared,true);assert.equal(clicks,1);
 p.w.document.querySelector('.unit-list').insertAdjacentHTML('beforeend','<div class="unit-item account">another-fixture</div>');
 assert.equal(p.run('activities','prepare').state,'login_required');assert.equal(clicks,1);p.w.close();
});

test('legacy single-source model tool queues browser sync without requiring exported cookies',async()=>{
 clear();const {callTool}=await import('../src/tools.js');
 const result=await callTool('sync_source',{id:'lectures'});assert.equal(result.job.status,'queued');assert.equal(result.job.steps[0].source,'lectures');
 const status=await callTool('get_sync_status',{id:result.job.id});assert.equal(status.job.id,result.job.id);sync.cancelCampusSync(result.job.id);
});

test('course capture takes titles and descriptions, never per-user launch tokens',()=>{
 const p=page('<ul id="courselist"><li><a href="/courselist/opencourse?token=fixture-only">打开</a><dl><dt>虚构课程</dt><dd>课程编号：TEST</dd></dl><input value="private-input"></li></ul>','https://mooc.ucas.edu.cn/courselist/mycourse');
 Object.defineProperty(p.w.HTMLElement.prototype,'innerText',{get(){return this.textContent;}});
 const result=p.w.eval(fs.readFileSync(new URL('../extension/capture.js',import.meta.url),'utf8'));
 assert.equal(result.integration,'learning');assert.equal(result.learning[0].title,'虚构课程');assert.doesNotMatch(JSON.stringify(result),/token=|fixture-only|private-input/);p.w.close();
});

function worker(outcome='ready'){
 const tabs=[],removed=[],calls=[],state={token:'a'.repeat(48)},listeners=[];let next=10;
 const noop={addListener:()=>{}};
 const chrome={runtime:{id:'a'.repeat(32),getManifest:()=>({version:'0.5.0'}),onMessage:{addListener:f=>listeners.push(f)},onInstalled:noop,onStartup:noop},storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,state[k]])),set:async v=>Object.assign(state,v),remove:async k=>delete state[k]}},tabs:{create:async config=>{const t={id:next++,url:config.url,...config};tabs.push(t);return t;},get:async id=>tabs.find(t=>t.id===id),remove:async id=>removed.push(id),query:async()=>[{id:1,url:'https://www.ucas.ac.cn/'}]},scripting:{executeScript:async args=>{calls.push(args);return args.files?[{result:snapshot}]:[{result:{state:outcome}}];}},alarms:{create:async()=>{},clear:async()=>{},onAlarm:noop}};
 const context=vm.createContext({chrome,URL,AbortSignal,Set,Date,setTimeout:f=>setTimeout(f,0),localServer:()=> 'http://127.0.0.1:3210',campusLoginSender:()=>null});
 context.importScripts=()=>vm.runInContext(pageSource,context);vm.runInContext(fs.readFileSync(new URL('../extension/sync-all.js',import.meta.url),'utf8'),context);
 return {tabs,removed,calls,context,run:source=>vm.runInContext(`campusSyncOne({source:${JSON.stringify(source)}})`,context)};
}
test('sync worker opens fixed destinations and tidies only its own successful tabs',async()=>{
 const w=worker();const r=await w.run('news');assert.equal(r.status,'ok');assert.equal(w.tabs[0].active,false);assert.deepEqual(w.removed,[10]);assert.ok(w.calls.some(c=>c.files?.includes('capture.js')));
 await assert.rejects(()=>w.run('https://evil.test'));assert.equal(w.tabs.length,1);
 const login=worker('login_required');assert.equal((await login.run('mail')).status,'login_required');assert.equal(login.removed.length,0);
});

test('lecture worker uses its owned tab for a validated SSO route and refuses foreign navigation',async()=>{
 const run=async destination=>{
  const w=worker(),updates=[];
  w.context.chrome.tabs.update=async(id,config)=>{updates.push({id,...config});w.tabs.find(t=>t.id===id).url='https://xkcts.ucas.ac.cn:8443/subject/lecture';};
  w.context.chrome.scripting.executeScript=async args=>args.files?[{result:{...snapshot,sourceUrl:'https://xkcts.ucas.ac.cn:8443/subject/lecture'}}]:[{result:args.args[1]==='open'?{state:'navigate',url:destination}:args.args[1]==='prepare'?{state:'waiting',prepared:true}:{state:'ready'}}];
  return {w,updates,result:await w.run('lectures')};
 };
 const allowed=await run('https://sep.ucas.ac.cn/portal/site/226/xs/1/1/'+'a'.repeat(32));assert.equal(allowed.result.status,'ok');assert.equal(allowed.updates[0].id,10);assert.deepEqual(allowed.w.removed,[10]);
 const refused=await run('https://evil.test/portal/site/226/xs/1/1/'+'a'.repeat(32));assert.equal(refused.result.status,'unsupported');assert.equal(refused.updates.length,0);assert.equal(refused.w.removed.length,0);
});

test('mail sync reuses only a verified official session in an owned tab and never reports its SID',async()=>{
 const w=worker(),sessionUrl='https://mail.cstnet.cn/coremail/XT5/index.jsp?sid=synthetic-session';
 w.context.chrome.tabs.query=async()=>[{id:1,url:sessionUrl}];
 w.context.chrome.scripting.executeScript=async args=>args.files?[{result:{sourceUrl:'https://mail.cstnet.cn/',integration:'mail',mail:[{subject:'虚构邮件',unread:true}]}}]:[{result:args.args[1]==='prepare'?{state:'waiting',prepared:true,authenticated:true}:{state:'ready',authenticated:true}}];
 const result=await w.run('mail');assert.equal(result.status,'ok');assert.equal(w.tabs[0].url,sessionUrl);assert.deepEqual(w.removed,[10]);assert.doesNotMatch(JSON.stringify(result),/synthetic-session|sid=/);
 const foreign=worker('login_required');foreign.context.chrome.tabs.query=async()=>[{id:1,url:'https://evil.test/coremail/XT5/index.jsp?sid=synthetic-session'}];
 await foreign.run('mail');assert.equal(foreign.tabs[0].url,'https://mail.cstnet.cn/');
});
after(()=>{store.db.close();const base=path.resolve(os.tmpdir());assert.equal(path.dirname(path.resolve(temp)),base);fs.rmSync(temp,{recursive:true,force:true});});
