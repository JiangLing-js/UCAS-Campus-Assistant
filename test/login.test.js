import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {createLoginBroker} from '../src/login.js';

const extensionId='a'.repeat(32),secrets={ucasAccount:'sep-user@example.test',ucasPassword:'dummy-sep-secret',mailAccount:'mail-user@example.test',mailPassword:'dummy-mail-secret',deepseekKey:'never-release-model-key',cookies:{private:'never-release-cookie'}};
const source=fs.readFileSync(new URL('../extension/login.js',import.meta.url),'utf8');
const fixtures={
 sep:'<form id="sepform" method="post" action="/slogin"><input id="userName" type="hidden"><input id="pwd" type="hidden"></form><form><input id="userName1"><input id="pwd1" type="password"><button id="sb1" type="button">登录</button></form><form method="post" action="https://mail.cstnet.cn/coremail/index.jsp"><input id="uid"><input id="password" type="password"></form>',
 mail:'<form action="/coremail/index.jsp?cus=1&sid=fixture-only" method="post"><input id="uid" name="uid"><input id="password" name="password" type="password"><button type="button" class="j-submit">登录</button><div hidden><input name="smsaddr"><input name="verifyCode" placeholder="验证码"><input name="verifyCellCode"></div></form>',
};
function page(provider,html=fixtures[provider],url=provider==='sep'?'https://sep.ucas.ac.cn/':'https://mail.cstnet.cn/'){
 const dom=new JSDOM(html,{url,runScripts:'outside-only'}),w=dom.window;
 Object.defineProperty(w.document,'readyState',{value:'complete',configurable:true});
 // jsdom has no layout. Simulate rects only, leaving DOM setters and events real.
 w.HTMLElement.prototype.getClientRects=function(){for(let el=this;el;el=el.parentElement)if(el.hidden||el.style.display==='none'||el.type==='hidden')return [];return [{}];};
 w.chrome={runtime:{onMessage:{addListener:()=>{}}}};
 w.eval(source);return {w,run:(action,credentials)=>w.campusLoginPage(provider,action,credentials)};
}
test('login broker releases only provider credentials, only once, and never in job status',()=>{
 const broker=createLoginBroker({readSecrets:()=>secrets});
 for(const provider of ['sep','mail']){
  const job=broker.create({provider,extensionId}),input={id:job.id,ticket:job.ticket,extensionId};
  assert.equal(job.password,undefined);assert.equal(broker.status(job.id).ticket,undefined);
  assert.throws(()=>broker.claim({...input,extensionId:'b'.repeat(32)}),e=>e.status===401);
  assert.throws(()=>broker.claim({...input,ticket:'é'.repeat(64)}),e=>e.status===401);
  const credentials=broker.claim(input);assert.deepEqual(Object.keys(credentials).sort(),['account','password','provider']);
  assert.equal(credentials.password,secrets[provider==='sep'?'ucasPassword':'mailPassword']);
  assert.throws(()=>broker.claim(input),e=>e.status===409);
  const status=broker.report({...input,state:'success'});assert.equal(status.done,true);assert.equal(status.password,undefined);
 }
});
test('login broker enforces expiry, concurrency, cancellation and honest state transitions',()=>{
 let time=0;const broker=createLoginBroker({readSecrets:()=>secrets,clock:()=>time});
 const job=broker.create({provider:'sep',extensionId}),input={id:job.id,ticket:job.ticket,extensionId};
 assert.throws(()=>broker.create({provider:'sep',extensionId}),e=>e.status===409);
 assert.throws(()=>broker.report({...input,state:'success'}),e=>e.status===400);
 time=46000;assert.throws(()=>broker.claim(input),e=>e.status===409);
 time=91000;assert.equal(broker.status(job.id).state,'timeout');
 const next=broker.create({provider:'sep',extensionId});broker.cancel(next.id);assert.throws(()=>broker.claim({id:next.id,ticket:next.ticket,extensionId}),e=>e.status===409);
 assert.throws(()=>createLoginBroker({readSecrets:()=>({})}).create({provider:'mail',extensionId}),e=>e.status===400);
 assert.throws(()=>broker.create({provider:'__proto__',extensionId}),e=>e.status===400);
});
test('SEP adapter fills the visible SEP inputs and clicks the official button once, leaving hidden and mail forms untouched',()=>{
 const {w,run}=page('sep');let clicks=0,inputs=0;
 w.document.querySelector('#sb1').onclick=()=>clicks++;
 w.document.querySelector('#pwd1').oninput=()=>inputs++;
 assert.equal(run('inspect').state,'ready');assert.equal(run('fill',{account:secrets.ucasAccount,password:secrets.ucasPassword}).state,'submitted');
 assert.equal(w.document.querySelector('#userName1').value,secrets.ucasAccount);assert.equal(w.document.querySelector('#pwd1').value,secrets.ucasPassword);
 for(const id of ['userName','pwd','uid','password'])assert.equal(w.document.getElementById(id).value,'');
 assert.equal(clicks,1);assert.equal(inputs,1);run('observe');assert.equal(clicks,1);w.close();
});
test('Coremail adapter ignores hidden verification inputs, preserves native action, and never returns passwords',()=>{
 const {w,run}=page('mail');let clicks=0;w.document.querySelector('.j-submit').onclick=()=>clicks++;
 assert.equal(run('inspect').state,'ready');const result=run('fill',{account:secrets.mailAccount,password:secrets.mailPassword});
 assert.deepEqual(JSON.parse(JSON.stringify(result)),{state:'submitted'});assert.equal(clicks,1);
 assert.equal(w.document.querySelector('#uid').value,secrets.mailAccount);assert.match(w.document.querySelector('form').action,/sid=fixture-only/);w.close();
});
test('current official SEP markup waits for loading, then submits its visible form exactly once',()=>{
 const html=fs.readFileSync(new URL('./fixtures/sep-login.html',import.meta.url),'utf8');
 const {w,run}=page('sep',html);let clicks=0;
 w.document.querySelector('#sb1').onclick=()=>clicks++;
 Object.defineProperty(w.document,'readyState',{value:'interactive',configurable:true});
 assert.equal(run('fill',{account:'fixture-account',password:'fixture-password'}).state,'loading');assert.equal(clicks,0);assert.equal(w.document.querySelector('#pwd1').value,'');
 Object.defineProperty(w.document,'readyState',{value:'complete',configurable:true});
 assert.equal(run('inspect').state,'ready');assert.equal(run('fill',{account:'fixture-account',password:'fixture-password'}).state,'submitted');assert.equal(clicks,1);w.close();
});
test('adapters hand visible CAPTCHA/2FA to the user, including challenges revealed by input events',()=>{
 for(const provider of ['sep','mail']){
  const {w,run}=page(provider,fixtures[provider]+'<input name="verifyCode" placeholder="验证码">');
  assert.equal(run('fill',{account:'fake',password:'fake'}).state,'manual_required');assert.equal(w.document.querySelector('input[type=password]').value,'');w.close();
 }
 const {w,run}=page('mail');let clicks=0;w.document.querySelector('.j-submit').onclick=()=>clicks++;
 w.document.querySelector('#password').oninput=()=>w.document.querySelector('[hidden]').hidden=false;
 assert.equal(run('fill',{account:'fake',password:'fake'}).state,'manual_required');assert.equal(clicks,0);w.close();
});
test('adapters reject lookalike origins, altered form actions, and navigation without writing secrets',()=>{
 for(const url of ['http://mail.cstnet.cn/','https://mail.cstnet.cn.evil.test/']){const {w,run}=page('mail',fixtures.mail,url);assert.equal(run('fill',{account:'fake',password:'fake'}).state,'unsupported');assert.equal(w.document.querySelector('#password').value,'');w.close();}
 const {w,run}=page('mail');w.document.querySelector('form').action='https://evil.test/login';assert.equal(run('fill',{account:'fake',password:'fake'}).state,'unsupported');assert.equal(w.document.querySelector('#password').value,'');w.close();
 const changed=page('sep');let clicks=0;changed.w.document.querySelector('#sb1').onclick=()=>clicks++;changed.w.document.querySelector('#pwd1').onchange=()=>changed.w.document.querySelector('#sepform').action='https://evil.test/';assert.equal(changed.run('fill',{account:'fake',password:'fake'}).state,'unsupported');assert.equal(clicks,0);changed.w.close();
});
test('success requires visible signed-in landmarks, not a successful button click',()=>{
 const mail=page('mail','<a id="mltree_1_a">收件箱</a>','https://mail.cstnet.cn/coremail/XT5/index.jsp');assert.equal(mail.run('observe').state,'authenticated');mail.w.close();
 const sep=page('sep','<nav id="sepTabNav">工作台</nav>','https://sep.ucas.ac.cn/sepCard/card');assert.equal(sep.run('inspect').state,'authenticated');sep.w.close();
 const login=page('mail',fixtures.mail+'<p role="alert">账号或密码错误</p>');assert.equal(login.run('observe').state,'rejected');login.w.close();
});
function worker({alreadySignedIn=false,navigated=false,submittedNavigation=false}={}){
 const requests=[],scripts=[],responses=[];let listener,resolveDone,filled=false,claimed=false;
 const done=new Promise(resolve=>resolveDone=resolve);
 const context={URL,Set,AbortSignal,setTimeout:fn=>setTimeout(fn,0),chrome:{runtime:{id:extensionId,getManifest:()=>({version:'0.3.1'}),onMessage:{addListener:fn=>listener=fn}},tabs:{query:async()=>alreadySignedIn?[{id:10,windowId:1}]:[],create:async()=>({id:20}),update:async()=>{}},windows:{update:async()=>{}},scripting:{executeScript:async args=>{scripts.push(args);const action=args.args[1];if(action==='fill'){if(navigated)throw new Error('No document with id fixture');filled=true;if(submittedNavigation)throw new Error('No frame with id 0');return [{result:{state:'submitted'}}];}return [{frameId:0,documentId:claimed?'checked-document':'old-document',result:{state:alreadySignedIn||filled?'authenticated':'ready'}}];}}},fetch:async(url,options)=>{const data=JSON.parse(options.body);requests.push({url,data});const claim=url.endsWith('/claim');if(claim)claimed=true;if(!claim&&['success','already_signed_in','failed'].includes(data.state))resolveDone();return {ok:true,json:async()=>claim?{provider:'sep',account:'fake-user',password:'fake-password'}:{ok:true}};}};
 vm.runInNewContext(source,context);
 return {requests,scripts,responses,done,send:(sender={id:extensionId,frameId:0,tab:{id:1},url:'http://127.0.0.1:3210/'})=>listener({type:'login-start',provider:'sep',id:'a'.repeat(24),ticket:'a'.repeat(64)},sender,r=>responses.push(r))};
}
test('worker pins the checked document, submits once, and never sends credentials back to the workbench',async()=>{
 const w=worker();w.send();await w.done;
 const fills=w.scripts.filter(s=>s.args[1]==='fill');assert.equal(fills.length,1);assert.deepEqual([...fills[0].target.documentIds],['checked-document']);
 assert.equal(w.requests.filter(r=>r.url.endsWith('/claim')).length,1);assert.equal(w.requests.at(-1).data.state,'success');
 assert.doesNotMatch(JSON.stringify(w.responses)+JSON.stringify(w.requests),/fake-password|fake-user/);
});
test('worker reuses logged-in tabs without claiming credentials and stops on document navigation',async()=>{
 const signed=worker({alreadySignedIn:true});signed.send();await signed.done;assert.equal(signed.requests.filter(r=>r.url.endsWith('/claim')).length,0);assert.equal(signed.requests.at(-1).data.state,'already_signed_in');
 const changed=worker({navigated:true});changed.send();await changed.done;assert.equal(changed.requests.at(-1).data.state,'failed');assert.equal(changed.scripts.filter(s=>s.args[1]==='fill').length,1);
 const foreign=worker();foreign.send({id:extensionId,frameId:0,tab:{id:1},url:'https://evil.test/'});assert.equal(foreign.requests.length,0);assert.equal(foreign.responses.length,0);
});
test('worker observes the destination after submit destroys the document, without submitting again',async()=>{
 const w=worker({submittedNavigation:true});w.send();await w.done;assert.equal(w.requests.at(-1).data.state,'success');assert.equal(w.scripts.filter(s=>s.args[1]==='fill').length,1);
});
test('failure diagnostics only accept fixed codes, never arbitrary extension error strings',()=>{
 const events=[],broker=createLoginBroker({readSecrets:()=>secrets,onFailure:event=>events.push(event)});
 const job=broker.create({provider:'sep',extensionId}),input={id:job.id,ticket:job.ticket,extensionId};broker.claim(input);
 const result=broker.report({...input,state:'failed',reason:'secret=do-not-log'});
 assert.doesNotMatch(JSON.stringify(events)+JSON.stringify(result),/do-not-log/);assert.equal(events[0].credentialsClaimed,true);
});
