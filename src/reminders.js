import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from './store.js';

db.exec(`CREATE TABLE IF NOT EXISTS notification_deliveries (
 notification_id TEXT PRIMARY KEY, token TEXT NOT NULL, lease_until TEXT NOT NULL, delivered_at TEXT
);
CREATE TABLE IF NOT EXISTS notification_snoozes (
 notification_id TEXT PRIMARY KEY, item_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, due_at TEXT NOT NULL
);`);

// A lease coordinates the open workbench and the extension. A failed delivery can be retried.
export function claimNotifications(at=new Date()){
 const now=at.toISOString(),cutoff=new Date(at.getTime()-86400000).toISOString();
 db.exec('BEGIN IMMEDIATE');
 try{
  const rows=db.prepare(`SELECT n.id,n.title,n.body,n.created_at FROM notifications n
   JOIN items i ON i.id=n.item_id LEFT JOIN notification_deliveries d ON d.notification_id=n.id
   WHERE n.seen=0 AND i.status='open' AND n.created_at>=? AND n.created_at<=?
   AND d.delivered_at IS NULL AND (d.lease_until IS NULL OR d.lease_until<=?)
   ORDER BY n.created_at LIMIT 10`).all(cutoff,now,now);
  const token=randomUUID(),lease=new Date(at.getTime()+60000).toISOString();
  for(const r of rows)db.prepare(`INSERT INTO notification_deliveries VALUES (?,?,?,NULL)
   ON CONFLICT(notification_id) DO UPDATE SET token=excluded.token,lease_until=excluded.lease_until`).run(r.id,token,lease);
  db.exec('COMMIT');return {notifications:rows,deliveryToken:token};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
const ackInput=z.object({ids:z.array(z.string().uuid()).max(10),deliveryToken:z.string().uuid()}).strict();
export function acknowledgeNotifications(input,at=new Date()){
 const {ids,deliveryToken}=ackInput.parse(input);let count=0;
 for(const id of ids)count+=db.prepare('UPDATE notification_deliveries SET delivered_at=? WHERE notification_id=? AND token=? AND delivered_at IS NULL').run(at.toISOString(),id,deliveryToken).changes;
 return {ok:true,count};
}
export function snoozeNotification(id,minutes,at=new Date()){
 z.number().refine(v=>[10,30,60].includes(v),'请选择 10、30 或 60 分钟').parse(minutes);
 const n=db.prepare("SELECT n.* FROM notifications n JOIN items i ON i.id=n.item_id WHERE n.id=? AND i.status='open'").get(id);
 if(!n)throw new Error('提醒对应的事项已经完成、归档或不存在。');
 const dueAt=new Date(at.getTime()+minutes*60000).toISOString();
 db.exec('BEGIN IMMEDIATE');
 try{
  db.prepare(`INSERT INTO notification_snoozes VALUES (?,?,?,?,?) ON CONFLICT(notification_id) DO UPDATE SET due_at=excluded.due_at`).run(n.id,n.item_id,n.title,n.body,dueAt);
  db.prepare('UPDATE notifications SET seen=1 WHERE id=?').run(n.id);
  db.exec('COMMIT');return {ok:true,dueAt};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
export function tickSnoozes(at=new Date()){
 const emitted=[];db.exec('BEGIN IMMEDIATE');
 try{
  const rows=db.prepare('SELECT s.*,i.status FROM notification_snoozes s LEFT JOIN items i ON i.id=s.item_id WHERE due_at<=?').all(at.toISOString());
  for(const r of rows){
   if(r.status==='open'&&at.getTime()-Date.parse(r.due_at)<=86400000){
    const n={id:randomUUID(),itemId:r.item_id,title:r.title,body:'稍后提醒：'+r.body.replace(/^稍后提醒：/,''),createdAt:at.toISOString()};
    db.prepare('INSERT INTO notifications(id,item_id,title,body,created_at) VALUES (?,?,?,?,?)').run(n.id,n.itemId,n.title,n.body,n.createdAt);emitted.push(n);
   }
   db.prepare('DELETE FROM notification_snoozes WHERE notification_id=?').run(r.notification_id);
  }
  db.exec('COMMIT');return emitted;
 }catch(e){db.exec('ROLLBACK');throw e;}
}
export function scheduledSnoozes(){return db.prepare("SELECT s.notification_id AS notificationId,s.due_at AS dueAt FROM notification_snoozes s JOIN items i ON i.id=s.item_id WHERE i.status='open'").all();}
