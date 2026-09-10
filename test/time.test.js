import test from 'node:test';
import assert from 'node:assert/strict';
import {campusTimeContext} from '../src/time.js';

test('Beijing clock resolves midnight, year boundaries and leap days before model inference',()=>{
 for(const [utc,local,weekday,yesterday,today,tomorrow] of [
  ['2030-12-31T15:59:59Z','2030-12-31T23:59:59+08:00','星期二','2030-12-30','2030-12-31','2031-01-01'],
  ['2030-12-31T16:17:00Z','2031-01-01T00:17:00+08:00','星期三','2030-12-31','2031-01-01','2031-01-02'],
  ['2032-02-28T16:00:00Z','2032-02-29T00:00:00+08:00','星期日','2032-02-28','2032-02-29','2032-03-01'],
  ['2032-02-29T16:00:00Z','2032-03-01T00:00:00+08:00','星期一','2032-02-29','2032-03-01','2032-03-02'],
 ]){
  const context=campusTimeContext(new Date(utc));
  for(const expected of [local,weekday,`昨天=${yesterday}`,`今天=${today}`,`明天=${tomorrow}`])assert.ok(context.includes(expected),expected);
  assert.ok(!context.includes(utc));
 }
});

test('Beijing model context does not depend on the machine timezone',()=>{
 const previous=process.env.TZ;
 try{
  for(const zone of ['UTC','America/Los_Angeles','Asia/Shanghai']){
   process.env.TZ=zone;
   assert.match(campusTimeContext(new Date('2030-12-31T16:17:00Z')),/2031-01-01T00:17:00\+08:00/);
  }
 }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});
