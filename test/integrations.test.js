import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ucas-expanded-test-'));process.env.UCAS_DATA_DIR=temp;
const catalog=await import('../src/catalog.js');
const {db,getSetting,setSetting,listItems}=await import('../src/store.js');
const integrations=await import('../src/integrations.js');
const {syncMailbox}=await import('../src/mail.js');
test('real XLSX import finds non-first-row Chinese headers across semesters and preserves unknown times',()=>{
 const b=XLSX.utils.book_new();for(const semester of ['秋季','春季'])XLSX.utils.book_append_sheet(b,XLSX.utils.aoa_to_sheet([['官方课程计划'],['课程编号','课程名称','主讲教师','学分','上课时间','周次'],['A001','数学','某教师','3','周一第1-2节','1-16'],['A002','待排课课程','某教师','2','','']]),semester);
 const parsed=catalog.parseDataset(XLSX.write(b,{type:'buffer',bookType:'xlsx'}),'plan.xlsx');assert.equal(parsed.courses.length,4);assert.equal(parsed.courses[0].semester,'秋季');assert.equal(parsed.courses[0].credits,3);assert.equal(parsed.courses[0].sessions[0].weeks.length,16);assert.equal(parsed.courses[1].sessions.length,0);assert.match(parsed.warnings.join(''),/2 门/);
 const result=catalog.importDataset({name:'真实表头结构测试',courses:parsed.courses});assert.equal(result.count,4);assert.equal(catalog.importDataset({name:'真实表头结构测试',courses:parsed.courses}).id,result.id);assert.equal(catalog.searchCatalog({datasetId:result.id,semester:'秋季'}).total,2);
});
test('period/week intersections distinguish conflicts, odd/even weeks, semester separation and unknown schedules',()=>{
 const c=(id,schedule,semester='秋季')=>({...catalog.normalizeCourse({name:id,schedule,semester}),id});
 assert.deepEqual(catalog.parseWeeks('1-8周(单)'),[1,3,5,7]);
 assert.equal(catalog.conflicts([c('a','周一第1-2节(1-8周单)'),c('b','周一第2-3节(1-8周双)')]).pairs.length,0);
 assert.equal(catalog.conflicts([c('a','周一第1-2节(1-8周)'),c('b','周一第2-3节(8-16周)')]).pairs.length,1);
 assert.equal(catalog.conflicts([c('a','周一第1-2节(1-8周)'),c('b','周一第1-2节(1-8周)','春季')]).pairs.length,0);
 const partial=catalog.conflicts([c('a',''),c('b','周一第1-2节')]);assert.equal(partial.uncertain.length,1);assert.equal(partial.incomplete.length,2);
});
test('UCAS combined credits and weekday-period columns merge repeated course rows without double-counting credits',()=>{
 const b=XLSX.utils.book_new();const s=XLSX.utils.aoa_to_sheet([['序号','课程编码','课程名称','课时/学分','开课周','星期节次','主讲教师'],['1','UC001','同一课程','60/3','1-8','周一(1-2)','教师甲'],['1','UC001','同一课程','60/3','9-16','周四（3-4）','教师乙']]);XLSX.utils.book_append_sheet(b,s,'秋季');const p=catalog.parseDataset(XLSX.write(b,{type:'buffer',bookType:'xlsx'}),'official-format.xlsx');assert.equal(p.courses.length,1);assert.equal(p.courses[0].credits,3);assert.equal(p.courses[0].sessions.length,2);assert.equal(p.courses[0].sessions[1].weekday,4);assert.deepEqual(p.courses[0].sessions[1].weeks,[9,10,11,12,13,14,15,16]);const dataset=catalog.importDataset({name:'官方列格式',courses:p.courses});assert.equal(catalog.searchCatalog({datasetId:dataset.id}).courses[0].sessions.length,2);
});
test('plans persist alternatives without counting their credits and reject cross-dataset writes',()=>{
 const a=catalog.importDataset({name:'A',courses:[{name:'甲',credits:3},{name:'乙',credits:2}]}),b=catalog.importDataset({name:'B',courses:[{name:'丙',credits:5}]});
 const plan=catalog.createPlan('我的方案',a.id),courses=catalog.searchCatalog({datasetId:a.id}).courses;
 catalog.setPlanCourse(plan.id,courses[0].id,'selected');let result=catalog.setPlanCourse(plan.id,courses[1].id,'alternative');assert.equal(result.credits,3);assert.equal(result.courses.length,2);
 assert.throws(()=>catalog.setPlanCourse(plan.id,catalog.searchCatalog({datasetId:b.id}).courses[0].id,'selected'),/不一致/);
 result=catalog.setPlanCourse(plan.id,courses[0].id,'remove');assert.equal(result.credits,0);
});
test('typed snapshots enforce source origin and strip session URLs and unrelated account fields',()=>{
 assert.throws(()=>integrations.ingestIntegration({sourceUrl:'https://sep.ucas.ac.cn/',integration:'mail',mail:[]}));
 assert.throws(()=>integrations.ingestIntegration({sourceUrl:'https://mail.cstnet.cn.evil.test/',integration:'mail',mail:[]}));
 integrations.ingestIntegration({sourceUrl:'https://portal.ucas.ac.cn/?token=secret',integration:'network',network:{connected:true,usedTraffic:'12 GB',duration:'3小时',balance:'0',account:'private',ip:'private'}});
 const n=integrations.campusServices().network;assert.equal(n.usedTraffic,'12 GB');assert.equal(n.account,undefined);assert.equal(n.ip,undefined);assert.ok(!JSON.stringify(n).includes('secret'));
 integrations.ingestIntegration({sourceUrl:'https://sep.ucas.ac.cn/',integration:'systems',systems:[{name:'团委二课',url:'https://sep.ucas.ac.cn/portal/site/567/2531?token=secret'},{name:'个人票据',url:'https://sep.ucas.ac.cn/portal/site/226/xs/1/secret'}]});assert.equal(integrations.campusServices().systems.length,1);assert.ok(!JSON.stringify(integrations.campusServices()).includes('secret'));
});
test('mail never enters generic items; model access is opt-in and snapshot refresh removes absent rows',()=>{
 integrations.ingestIntegration({sourceUrl:'https://mail.cstnet.cn/coremail/?sid=secret',integration:'mail',mail:[{subject:'学术讲座邮件',sender:'教务',dateText:'今天',unread:true,body:'private'}]});
 assert.equal(listItems({query:'学术讲座邮件'}).length,0);assert.match(integrations.queryMailForModel({}).error,/尚未开启/);
 setSetting('allowMailAi',true);const r=integrations.queryMailForModel({unreadOnly:true});assert.equal(r.messages.length,1);assert.equal(r.messages[0].body,undefined);assert.equal(r.sourceUrl,'https://mail.cstnet.cn/');
 integrations.ingestIntegration({sourceUrl:'https://mail.cstnet.cn/',integration:'mail',mail:[]});assert.equal(integrations.listMail().messages.length,0);
});
test('activity publication time is not a calendar event time',()=>{
 integrations.ingestIntegration({sourceUrl:'https://ek.ucas.edu.cn/dashboard',integration:'activities',activities:[{title:'合唱团演出动态',publishedAt:'2026-09-05 15:00:00',organization:'合唱团',description:'活动介绍'}]});const item=listItems({kind:'activity'})[0];assert.equal(item.startsAt,null);assert.match(item.content,/动态发布时间/);
});
test('IMAP connector requests read-only INBOX and bounded headers without setting flags, bodies or exposing credentials',async()=>{
 let options,lockOptions,range,query,released=false,loggedOut=false;
 const r=await syncMailbox({secrets:{mailAccount:'test@example.test',mailPassword:'secret'},createClient:o=>{options=o;return {on(){},async connect(){},mailbox:{exists:250,uidValidity:1n},async getMailboxLock(name,opts){assert.equal(name,'INBOX');lockOptions=opts;return {release(){released=true;}}},async fetchAll(r,q){range=r;query=q;return [{uid:250,envelope:{subject:'Test',from:[{address:'sender@example.test'}]},flags:new Set(),internalDate:new Date('2026-09-09T00:00:00Z')}]},async logout(){loggedOut=true;}}}});
 assert.equal(r.ok,true);assert.equal(options.host,'mail.cstnet.cn');assert.equal(options.port,993);assert.equal(options.secure,true);assert.equal(options.logger,false);assert.deepEqual(lockOptions,{readOnly:true});assert.equal(range,'151:250');assert.deepEqual(Object.keys(query).sort(),['envelope','flags','internalDate','uid']);assert.ok(released&&loggedOut);assert.ok(!JSON.stringify(r).includes('secret'));assert.equal(integrations.listMail().channel,'imap');
 const fail=await syncMailbox({secrets:{mailAccount:'a',mailPassword:'secret'},createClient:()=>({on(){},async connect(){throw Object.assign(new Error('secret'),{authenticationFailed:true});},async logout(){}})});assert.equal(fail.ok,false);assert.ok(!JSON.stringify(fail).includes('secret'));
});
after(()=>{db.close();fs.rmSync(temp,{recursive:true,force:true});});
