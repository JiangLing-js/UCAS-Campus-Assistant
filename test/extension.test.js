import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../extension/background.js',import.meta.url),'utf8');
function background(initial={},tabs=[],frames=[]){
 const stored={...initial},requests=[];let listener;const alarms=[];
 const chrome={storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,stored[k]])),set:async value=>Object.assign(stored,value)}},tabs:{query:async()=>tabs},scripting:{executeScript:async()=>frames},runtime:{id:'test-extension',onMessage:{addListener:fn=>listener=fn},onStartup:{addListener:()=>{}}},alarms:{clear:async()=>{},create:async(name,settings)=>alarms.push({name,settings}),onAlarm:{addListener:()=>{}}}};
 vm.runInNewContext(source,{importScripts:()=>{},chrome,URL,Date,JSON,Set,AbortSignal,fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({results:[{count:1}]})};}});
 return {stored,requests,alarms,send:message=>new Promise(resolve=>listener(message,{id:'test-extension'},resolve))};
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
