import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../extension/background.js',import.meta.url),'utf8');
function background(initial={},tabs=[],frames=[],options={}){
 const stored={...initial},requests=[],alarms=[],notices=[],alarmListeners=[];let listener;
 const noop={addListener:()=>{}};
 const chrome={storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,stored[k]])),set:async value=>Object.assign(stored,value)}},tabs:{query:async()=>tabs,create:async()=>{}},scripting:{executeScript:async()=>frames},runtime:{id:'test-extension',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener:fn=>listener=fn},onStartup:noop,onInstalled:noop},alarms:{clear:async()=>{},create:async(name,settings)=>alarms.push({name,settings}),onAlarm:{addListener:fn=>alarmListeners.push(fn)}},permissions:{contains:async()=>options.permission!==false,onAdded:noop,onRemoved:noop},notifications:{getPermissionLevel:async()=>options.permission===false?'denied':'granted',onClicked:noop,create:async(id,value)=>{if(options.failNotice)throw new Error('disabled');notices.push({id,value});return id;}}};
 const context=vm.createContext({chrome,URL,Date,JSON,Set,AbortSignal,fetch:async(url,request)=>{requests.push({url,options:request});return options.fetcher?options.fetcher(url,request):{ok:true,json:async()=>({results:[{count:1}],notifications:[],deliveryToken:'test'})};}});
 context.importScripts=file=>{if(file==='reminders.js')vm.runInContext(fs.readFileSync(new URL('../extension/reminders.js',import.meta.url),'utf8'),context);};
 vm.runInContext(source,context);
 return {stored,requests,alarms,notices,deliver:()=>vm.runInContext('deliverBackgroundReminders()',context),restore:()=>vm.runInContext('restoreReminderAlarm()',context),send:message=>new Promise(resolve=>listener(message,{id:'test-extension'},resolve))};
}
test('extension refuses remote, credential-bearing, and non-HTTP sync destinations before saving',async()=>{
 for(const server of ['https://evil.test','http://127.0.0.1.evil.test','http://u:p@127.0.0.1','file:///C:/secret','http://127.0.0.1:3210/other']){const bg=background();const r=await bg.send({type:'configure',server,token:'a'.repeat(48)});assert.equal(r.ok,false);assert.equal(bg.requests.length,0);assert.equal(bg.stored.token,undefined);}
});
test('extension syncs a rendered campus snapshot only to loopback with its import token',async()=>{
 const snapshot={sourceUrl:'https://sep.ucas.ac.cn/sepCard/card',title:'SEP',tables:[],links:[{text:'关于测试通知',href:''}]};
 const bg=background({},[{id:1}],[{result:snapshot}]);const r=await bg.send({type:'configure',server:'http://127.0.0.1:3210',token:'a'.repeat(48),autoSync:true});
 assert.equal(r.ok,true);assert.equal(bg.requests.length,1);assert.equal(bg.requests[0].url,'http://127.0.0.1:3210/api/bridge/import');assert.equal(bg.requests[0].options.headers['X-Ucas-Token'],'a'.repeat(48));assert.equal(JSON.parse(bg.requests[0].options.body).snapshots[0].title,'SEP');assert.equal(bg.alarms[0].settings.periodInMinutes,15);
});
test('extension deduplicates identical snapshots in multiple frames and skips discarded tabs',async()=>{
 const s={sourceUrl:'https://sep.ucas.ac.cn/sepCard/card',tables:[],links:[]};const bg=background({server:'http://127.0.0.1:3210',token:'b'.repeat(48)},[{id:1},{id:2},{id:3,discarded:true}],[{result:s},{result:s}]);const r=await bg.send({type:'sync'});assert.equal(r.ok,true);assert.equal(bg.requests.length,1);
});

test('background reminders need opt-in and permission and work without any workbench tabs',async()=>{
 const id='12345678-1234-4234-8234-123456789abc';let acked=false;
 const fetcher=async(url,options)=>{if(url.endsWith('/ack')){acked=true;assert.deepEqual(JSON.parse(options.body).ids,[id]);}return {ok:true,json:async()=>({notifications:acked?[]:[{id,title:'测试提醒',body:'测试地点'}],deliveryToken:id})};};
 const bg=background({token:'a'.repeat(48),autoRemind:true},[],[],{fetcher});await bg.restore();assert.equal(bg.alarms[0].name,'campus-reminders');assert.equal(bg.alarms[0].settings.periodInMinutes,1);
 await bg.deliver();assert.equal(bg.notices.length,1);assert.equal(acked,true);assert.equal(bg.requests[0].options.redirect,'error');assert.equal(bg.requests[0].options.headers['X-Ucas-Token'],'a'.repeat(48));
 await background({token:'a'.repeat(48),autoRemind:true},[],[],{fetcher}).deliver();assert.equal(bg.notices.length,1);
 for(const [autoRemind,permission] of [[false,true],[true,false]]){const disabled=background({token:'a'.repeat(48),autoRemind},[],[],{permission});await disabled.deliver();assert.equal(disabled.requests.length,0);}
});
test('failed system delivery does not acknowledge; malicious destinations never receive a notification token',async()=>{
 const fetcher=async()=>({ok:true,json:async()=>({notifications:[{id:'12345678-1234-4234-8234-123456789abc',title:'测试',body:'测试'}],deliveryToken:'12345678-1234-4234-8234-123456789abc'})});
 const failed=background({token:'a'.repeat(48),autoRemind:true},[],[],{failNotice:true,fetcher});await failed.deliver();assert.equal(failed.requests.length,1);assert.equal(failed.stored.lastReminderResult.ok,false);
 const remote=background({server:'http://127.0.0.1.evil.test',token:'a'.repeat(48),autoRemind:true});await remote.deliver();assert.equal(remote.requests.length,0);
});
