import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { DATA } from './paths.js';

export const db = new DatabaseSync(path.join(DATA, 'campus.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS items (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
 starts_at TEXT, ends_at TEXT, location TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'manual',
 source_url TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open',
 remind_minutes INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS items_time ON items(starts_at);
CREATE TABLE IF NOT EXISTS syncs (source TEXT PRIMARY KEY, synced_at TEXT, status TEXT, message TEXT);
CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, item_id TEXT, title TEXT, body TEXT, created_at TEXT, seen INTEGER DEFAULT 0, UNIQUE(item_id,created_at));
CREATE TABLE IF NOT EXISTS fired (key TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT, role TEXT, content TEXT, created_at TEXT);
`);
export const now = () => new Date().toISOString();
export function getSetting(key, fallback = null) { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key); return r ? JSON.parse(r.value) : fallback; }
export function setSetting(key, value) { db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
export function stableId(source, key) { return createHash('sha256').update(`${source}:${key}`).digest('hex').slice(0,24); }
export function itemView(r) { return {id:r.id,kind:r.kind,title:r.title,content:r.content,startsAt:r.starts_at,endsAt:r.ends_at,location:r.location,source:r.source,sourceUrl:r.source_url,status:r.status,remindMinutes:r.remind_minutes,updatedAt:r.updated_at}; }
export function upsertItem(item, { imported = false } = {}) {
  const id = item.id || randomUUID();
  const existing = db.prepare('SELECT * FROM items WHERE id=?').get(id);
  const time = now();
  const r = {...(existing ? itemView(existing) : {}), ...item, id};
  // A later sync must preserve the user's completed/read state and reminder choice.
  if (imported && existing) {r.status=existing.status;r.remindMinutes=existing.remind_minutes;}
  db.prepare(`INSERT INTO items VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
    kind=excluded.kind,title=excluded.title,content=excluded.content,starts_at=excluded.starts_at,
    ends_at=excluded.ends_at,location=excluded.location,source=excluded.source,source_url=excluded.source_url,
    status=excluded.status,remind_minutes=excluded.remind_minutes,updated_at=excluded.updated_at`).run(
    id,r.kind,r.title,r.content||'',r.startsAt||null,r.endsAt||null,r.location||'',r.source||'manual',r.sourceUrl||'',r.status||'open',r.remindMinutes??null,existing?.created_at||time,time);
  return itemView(db.prepare('SELECT * FROM items WHERE id=?').get(id));
}
export function listItems({kind,query,from,to,status,limit=200}={}) {
  const where=[], args=[];
  if(kind){where.push('kind=?');args.push(kind);}
  if(query){where.push('(title LIKE ? OR content LIKE ? OR location LIKE ?)');args.push(...Array(3).fill(`%${query}%`));}
  if(from){where.push('starts_at>=?');args.push(from);}
  if(to){where.push('starts_at<?');args.push(to);}
  if(status){where.push('status=?');args.push(status);}
  args.push(Math.max(1,Math.min(500,limit)));
  return db.prepare(`SELECT * FROM items ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY CASE WHEN starts_at IS NULL THEN 1 ELSE 0 END,starts_at,updated_at DESC LIMIT ?`).all(...args).map(itemView);
}
export function getItem(id) {const r=db.prepare('SELECT * FROM items WHERE id=?').get(id);return r?itemView(r):null;}
export function recordSync(source,status,message) {db.prepare('INSERT INTO syncs VALUES (?,?,?,?) ON CONFLICT(source) DO UPDATE SET synced_at=excluded.synced_at,status=excluded.status,message=excluded.message').run(source,now(),status,message);}
export function tickReminders(at = new Date()) {
  const time=at.toISOString(); const due=db.prepare("SELECT * FROM items WHERE status='open' AND starts_at IS NOT NULL AND remind_minutes IS NOT NULL").all();
  const emitted=[];
  for(const r of due){
    const alertTime=Date.parse(r.starts_at)-r.remind_minutes*60000;
    if(at.getTime()<alertTime || at.getTime()>Date.parse(r.ends_at||r.starts_at)+86400000) continue;
    const key=`${r.id}:${r.starts_at}:${r.remind_minutes}`;
    db.exec('BEGIN IMMEDIATE');
    try {
      if(db.prepare('INSERT OR IGNORE INTO fired VALUES (?)').run(key).changes){
        const n={id:randomUUID(),itemId:r.id,title:r.title,body:`${at.getTime()>Date.parse(r.starts_at)?'已到时间：':'即将开始：'}${r.location||r.kind}`,createdAt:time};
        db.prepare('INSERT INTO notifications(id,item_id,title,body,created_at) VALUES (?,?,?,?,?)').run(n.id,n.itemId,n.title,n.body,n.createdAt);emitted.push(n);
      }
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  return emitted;
}
export function notifications(){return db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100').all();}
export function createConversation(){const r={id:randomUUID(),title:'新的对话',createdAt:now()};db.prepare('INSERT INTO conversations VALUES (?,?,?)').run(r.id,r.title,r.createdAt);return r;}
export function addMessage(conversationId,role,content){const r={id:randomUUID(),conversationId,role,content,createdAt:now()};db.prepare('INSERT INTO messages VALUES (?,?,?,?,?)').run(r.id,conversationId,role,content,r.createdAt);if(role==='user')db.prepare("UPDATE conversations SET title=? WHERE id=? AND title='新的对话'").run(content.slice(0,30),conversationId);return r;}
export function messages(conversationId){return db.prepare('SELECT role,content FROM messages WHERE conversation_id=? ORDER BY rowid').all(conversationId);}
