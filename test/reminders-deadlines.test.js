import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {extractDeadlines} from '../src/deadlines.js';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ucas-reminder-tests-'));process.env.UCAS_DATA_DIR=temp;
const store=await import('../src/store.js');
const reminders=await import('../src/reminders.js');
const {importDeadlines}=await import('../src/deadline-routes.js');
const {callTool}=await import('../src/tools.js');
const ref='2030-12-31T16:10:00Z';

test('deadline preview resolves Beijing relative dates and labels uncertain dates without storing anything',()=>{
 const before=store.listItems().length;
 const r=extractDeadlines({text:'课程作业，截止：2031年1月3日 下午3点30分\n阅读报告，明天23:59前提交\n报名截止：1月9日',referenceTime:ref});
 assert.equal(r.candidates.length,3);assert.equal(r.candidates[0].startsAt,'2031-01-03T07:30:00.000Z');
 assert.equal(r.candidates[1].startsAt,'2031-01-02T15:59:00.000Z');assert.match(r.candidates[1].warnings.join(''),/2031-01-01/);
 assert.equal(r.candidates[2].startsAt,null);assert.equal(r.candidates[2].date,'2031-01-09');assert.match(r.candidates[2].warnings.join(''),/未写年份/);
 assert.equal(store.listItems().length,before);
});
test('deadline parsing rejects overflowing dates/times and distinguishes publication from deadline dates',()=>{
 const r=extractDeadlines({text:'发布时间 2031-01-01 08:00，作业截止时间 2031-01-05 20:00\n作业截止2031年2月30日23:59\n报告截止2031年1月9日25:10',referenceTime:ref});
 assert.equal(r.candidates[0].startsAt,'2031-01-05T12:00:00.000Z');assert.equal(r.candidates[1].startsAt,null);assert.match(r.candidates[1].warnings.join(''),/日期无效/);assert.equal(r.candidates[2].startsAt,null);
 assert.equal(extractDeadlines({text:'网站运行时间2031年1月1日23:00',referenceTime:ref}).candidates.length,0);
});
test('confirmed imports deduplicate and preserve edits/completion; malformed batches do not partially import',()=>{
 const row={title:'导入测试',startsAt:'2031-01-05T20:00:00+08:00',remindMinutes:60,sourceUrl:'https://sep.ucas.ac.cn/notice?ticket=private#secret',content:'原文片段'};
 const first=importDeadlines({items:[row]});assert.equal(first.count,1);assert.equal(first.items[0].sourceUrl,'https://sep.ucas.ac.cn/notice');
 store.upsertItem({...first.items[0],status:'done',remindMinutes:null});
 const second=importDeadlines({items:[row]});assert.equal(second.count,0);assert.equal(second.duplicates,1);assert.equal(second.items[0].status,'done');assert.equal(second.items[0].remindMinutes,null);
 assert.throws(()=>importDeadlines({items:[{...row,title:'不应部分写入'},{...row,startsAt:'unknown'}]}));assert.equal(store.listItems({query:'不应部分写入'}).length,0);
});
function due(title,at){return store.upsertItem({kind:'deadline',title,startsAt:at.toISOString(),remindMinutes:0});}
test('page and extension delivery share leases; expired failed attempts retry and acknowledged messages survive restart',()=>{
 store.db.exec("UPDATE items SET status='archived'");const at=new Date('2031-02-01T00:00:00Z');due('送达去重测试',at);const [n]=store.tickReminders(at);
 const a=reminders.claimNotifications(at);assert.equal(a.notifications.length,1);assert.equal(reminders.claimNotifications(at).notifications.length,0);
 const later=new Date(at.getTime()+61000),b=reminders.claimNotifications(later);assert.equal(b.notifications.length,1);assert.notEqual(a.deliveryToken,b.deliveryToken);
 assert.equal(reminders.acknowledgeNotifications({ids:[n.id],deliveryToken:a.deliveryToken},later).count,0);
 assert.equal(reminders.acknowledgeNotifications({ids:[n.id],deliveryToken:b.deliveryToken},later).count,1);
 const child=spawnSync(process.execPath,['--input-type=module','-e',"import {claimNotifications} from './src/reminders.js';import {db} from './src/store.js';console.log(claimNotifications(new Date('2031-02-01T00:05:00Z')).notifications.length);db.close();"],{cwd:path.resolve('.'),env:process.env,encoding:'utf8',windowsHide:true});assert.equal(child.status,0);assert.equal(child.stdout.trim(),'0');
});
test('snoozing does not alter a deadline and persists until due; completion cancels future delivery',()=>{
 store.db.exec("UPDATE items SET status='archived'");const at=new Date('2031-02-02T00:00:00Z'),item=due('稍后提醒测试',at),[n]=store.tickReminders(at);
 reminders.snoozeNotification(n.id,10,at);reminders.snoozeNotification(n.id,30,at);
 assert.equal(store.getItem(item.id).startsAt,item.startsAt);assert.equal(reminders.tickSnoozes(new Date(at.getTime()+600000)).length,0);
 const [again]=reminders.tickSnoozes(new Date(at.getTime()+1800000));assert.equal(again.itemId,item.id);assert.equal(reminders.tickSnoozes(new Date(at.getTime()+1801000)).length,0);
 reminders.snoozeNotification(again.id,10,new Date(at.getTime()+1800000));store.upsertItem({...item,status:'done'});
 assert.equal(reminders.tickSnoozes(new Date(at.getTime()+2400000)).length,0);
 assert.throws(()=>reminders.snoozeNotification(n.id,-1,at));
});
test('MCP edits validate times and never replace a campus source with caller-supplied data',async()=>{
 const item=store.upsertItem({kind:'deadline',title:'可编辑事项',startsAt:'2031-02-03T12:00:00Z',endsAt:'2031-02-03T13:00:00Z',source:'timetable',sourceUrl:'https://kb.mooc.ucas.edu.cn/'});
 const changed=await callTool('update_item',{id:item.id,changes:{title:'已修改标题',location:'测试教室'}});assert.equal(changed.source,item.source);assert.equal(changed.location,'测试教室');
 await assert.rejects(()=>callTool('update_item',{id:item.id,changes:{startsAt:'2031-02-04T00:00:00Z'}}));
 await assert.rejects(()=>callTool('update_item',{id:item.id,changes:{source:'evil'}}));
});
after(()=>{store.db.close();fs.rmSync(temp,{recursive:true,force:true});});
