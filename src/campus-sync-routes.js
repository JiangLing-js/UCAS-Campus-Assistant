import {z} from 'zod';
import {SYNC_TARGETS,requestCampusSync,syncStatus,cancelCampusSync,claimSyncStep,reportSyncStep} from './campus-sync.js';
export function campusSyncBridgeRoutes(app,authorize){
 const actions={start:requestCampusSync,claim:claimSyncStep,report:reportSyncStep};
 for(const [action,run] of Object.entries(actions))app.post('/api/bridge/sync/'+action,(req,res)=>{
  if(!authorize(req.headers['x-ucas-token']))return res.status(401).json({error:'校园桥接连接码不正确。'});
  if(!req.is('application/json'))return res.sendStatus(415);
  res.json(run(req.body));
 });
}
export function campusSyncRoutes(app){
 app.get('/api/campus-sync',(_,res)=>res.json({...syncStatus(),targets:SYNC_TARGETS}));
 app.post('/api/campus-sync',(req,res)=>res.json(requestCampusSync(req.body)));
 app.get('/api/campus-sync/:id',(req,res)=>res.json(syncStatus(z.string().uuid().parse(req.params.id))));
 app.post('/api/campus-sync/:id/cancel',(req,res)=>res.json(cancelCampusSync(req.params.id)));
}
