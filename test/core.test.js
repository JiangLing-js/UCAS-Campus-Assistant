import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ucas-core-test-'));
process.env.UCAS_DATA_DIR=temp;delete process.env.DEEPSEEK_API_KEY;
const store=await import('../src/store.js');
const {parseSnapshot,ingestSnapshot,cleanUrl}=await import('../src/ingest.js');
const {itemInput,callTool,modelTools}=await import('../src/tools.js');
const {calendar,foldLine}=await import('../src/calendar.js');
const {chat}=await import('../src/deepseek.js');
const cell=(text='',rowSpan=1,colSpan=1)=>({text,rowSpan,colSpan});
const fixture={sourceUrl:'https://kb.mooc.ucas.edu.cn/res/pc/curriculum/schedule.html?s=do-not-save',title:'课表',capturedAt:'2026-09-09T03:00:00.000Z',tables:[
 {id:'scheduleHead',rows:[{cells:[cell(),...['07','08','09','10','11','12','13'].map(d=>cell('周 '+`09-${d}`))]}]},
 {id:'scheduleTable',rows:[{cells:[cell('1\n08:30\n09:15'),cell(),cell('测试课程甲\n@测试礼堂',3),cell(),cell(),cell(),cell(),cell()]},{cells:[cell('2\n09:20\n10:05'),cell(),cell(),cell('测试课程乙\n@测试教室',2),cell(),cell(),cell()]},{cells:[cell('3\n10:25\n11:10'),cell(),cell(),cell(),cell(),cell()]}]}
]};
test('rowspan preserves weekday columns and exact class ending time; strips session query',()=>{
 const parsed=parseSnapshot(fixture);assert.equal(parsed.items.length,2);
 assert.equal(parsed.items[0].startsAt,'2026-09-08T00:30:00.000Z');assert.equal(parsed.items[0].endsAt,'2026-09-08T03:10:00.000Z');
 assert.equal(parsed.items[1].startsAt,'2026-09-10T01:20:00.000Z');assert.equal(parsed.items[1].location,'测试教室');assert.ok(!JSON.stringify(parsed).includes('do-not-save'));
});
test('same snapshot is idempotent and preserves personal completed state/reminder preference',()=>{
 ingestSnapshot(fixture);const id=parseSnapshot(fixture).items[0].id;store.upsertItem({...store.getItem(id),status:'done',remindMinutes:60});ingestSnapshot(fixture);
 assert.equal(store.listItems({kind:'course'}).length,2);assert.equal(store.getItem(id).status,'done');assert.equal(store.getItem(id).remindMinutes,60);
});
test('source trust boundaries reject foreign URLs and credential-bearing URLs',()=>{
 for(const url of ['https://ucas.ac.cn.evil.test/','https://localhost/','file:///C:/secret','https://u:p@sep.ucas.ac.cn/']){assert.equal(cleanUrl(url),'');assert.throws(()=>parseSnapshot({...fixture,sourceUrl:url}));}
 assert.equal(cleanUrl('https://xkcts.ucas.ac.cn:8443/subject/lecture?token=private#secret'),'https://xkcts.ucas.ac.cn:8443/subject/lecture');
});
test('lecture parsing includes audience and never treats signup as a submitted action',()=>{
 const s={sourceUrl:'https://xkcts.ucas.ac.cn:8443/subject/lecture',title:'讲座',tables:[{rows:[{cells:['数学','一场测试讲座','2','测试教室','2026-09-11 13:30-15:05','全体学生','测试讲者','测试院系','报名'].map(t=>cell(t)),links:[{text:'详情',href:'https://xkcts.ucas.ac.cn:8443/subject/123/view?ticket=hidden'}]}]}]};
 const i=parseSnapshot(s).items[0];assert.equal(i.startsAt,'2026-09-11T05:30:00.000Z');assert.equal(i.endsAt,'2026-09-11T07:05:00.000Z');assert.equal(i.sourceUrl,'https://xkcts.ucas.ac.cn:8443/subject/123/view');assert.equal(i.remindMinutes,undefined);assert.match(i.content,/全体学生/);
});
test('time validation normalizes offsets and rejects incomplete or backwards reminders',()=>{
 const r=itemInput.parse({kind:'deadline',title:'测试',startsAt:'2026-09-11T20:00:00+08:00',remindMinutes:15});assert.equal(r.startsAt,'2026-09-11T12:00:00.000Z');
 assert.throws(()=>itemInput.parse({kind:'reminder',title:'未定时间',remindMinutes:15}));
 assert.throws(()=>itemInput.parse({...r,endsAt:'2026-09-11T10:00:00.000Z'}));
});
test('reminders emit at their threshold, not before, and do not repeat after a process restart',()=>{
 store.db.exec("UPDATE items SET status='archived'");const i=store.upsertItem({kind:'deadline',title:'提醒测试',startsAt:'2026-09-11T12:00:00.000Z',remindMinutes:15});
 assert.equal(store.tickReminders(new Date('2026-09-11T11:44:59Z')).length,0);
 assert.equal(store.tickReminders(new Date('2026-09-11T11:45:00Z')).length,1);assert.equal(store.tickReminders(new Date('2026-09-11T11:46:00Z')).length,0);
 const result=spawnSync(process.execPath,['--input-type=module','-e',"import {tickReminders,db} from './src/store.js';process.stdout.write(String(tickReminders(new Date('2026-09-11T11:50:00Z')).length));db.close();"],{cwd:path.resolve('.'),env:process.env,encoding:'utf8',windowsHide:true});assert.equal(result.status,0);assert.equal(result.stdout,'0');
 store.upsertItem({...i,status:'done'});assert.equal(store.tickReminders(new Date('2026-09-12T11:45:00Z')).length,0);
});
test('calendar uses UTC, escapes fields, folds UTF-8 at 75 octets, and includes alarms',()=>{
 const title='测试一条比较长的中文课程名称'.repeat(8);const ics=calendar([{id:'test',kind:'course',title,startsAt:'2026-09-11T20:00:00+08:00',location:'一楼,教室;A',content:'第一行\n第二行',remindMinutes:15}]);
 assert.match(ics,/DTSTART:20260911T120000Z/);assert.match(ics,/TRIGGER:-PT15M/);assert.match(ics,/LOCATION:一楼\\,教室\\;A/);for(const line of ics.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75);assert.ok(ics.replace(/\r\n /g,'').includes(title));assert.equal(foldLine('a'.repeat(76)).split('\r\n')[0].length,75);
});
test('model tool schemas compile; unknown tool and invalid arguments are rejected',async()=>{
 assert.equal(modelTools().length,13);for(const t of modelTools())assert.equal(t.function.parameters.type,'object');await assert.rejects(()=>callTool('get_password',{}));await assert.rejects(()=>callTool('create_item',{kind:'reminder',title:''}));
});
test('DeepSeek tool loop executes a real read and persists its final answer without exposing secrets',async()=>{
 const c=store.createConversation();let calls=0;const events=[];
 const fetcher=async(url,options)=>{calls++;assert.equal(url,'https://api.deepseek.com/chat/completions');const body=JSON.parse(options.body);assert.equal(options.headers.Authorization,'Bearer mock-test-key');assert.ok(!JSON.stringify(body.messages).includes('mock-test-key'));if(calls===1)return Response.json({choices:[{message:{role:'assistant',tool_calls:[{id:'read1',type:'function',function:{name:'search_campus',arguments:'{"query":"提醒测试"}'}}]}}]});assert.equal(body.messages.at(-1).role,'tool');assert.match(body.messages.at(-1).content,/提醒测试/);return Response.json({choices:[{message:{role:'assistant',content:'已查询到测试事项。'}}]});};
 await chat({conversationId:c.id,text:'查询测试事项',fetcher,secrets:{deepseekKey:'mock-test-key'},onEvent:e=>events.push(e)});
 assert.equal(calls,2);assert.equal(store.messages(c.id).at(-1).content,'已查询到测试事项。');assert.ok(events.some(e=>e.type==='tool'));assert.ok(!JSON.stringify(events).includes('mock-test-key'));
});
test('absent DeepSeek key fails clearly before persisting a user message',async()=>{
 const c=store.createConversation();await assert.rejects(()=>chat({conversationId:c.id,text:'测试',secrets:{}}),/API Key/);assert.equal(store.messages(c.id).length,0);
});
test('DPAPI credential vault encrypts and round-trips isolated dummy credentials', {skip:process.platform!=='win32'}, async()=>{
 const {saveSecrets,readSecrets}=await import('../src/vault.js');saveSecrets({deepseekKey:'dummy-vault-test-key',ucasPassword:'dummy-password'});const bytes=fs.readFileSync(path.join(temp,'credentials.dpapi'));assert.ok(!bytes.includes(Buffer.from('dummy-password')));assert.equal(readSecrets().deepseekKey,'dummy-vault-test-key');saveSecrets({deepseekKey:'',ucasPassword:null});assert.equal(readSecrets().deepseekKey,'dummy-vault-test-key');assert.equal(readSecrets().ucasPassword,undefined);
});
after(()=>{store.db.close();fs.rmSync(temp,{recursive:true,force:true});});
