import { randomBytes, timingSafeEqual } from 'node:crypto';

export const LOGIN_PROVIDERS = Object.freeze({
 sep: { name: 'SEP', url: 'https://sep.ucas.ac.cn/', account: 'ucasAccount', password: 'ucasPassword' },
 mail: { name: '邮箱', url: 'https://mail.cstnet.cn/', account: 'mailAccount', password: 'mailPassword' },
});
export const LOGIN_MESSAGES = Object.freeze({
 pending: '正在连接校园桥接…',
 opening: '正在打开官方登录页…',
 submitting: '已填写凭据，正在等待官方页面的登录结果…',
 success: '登录成功，已打开官方页面。',
 already_signed_in: '当前浏览器已登录，已打开官方页面。',
 manual_required: '需要验证码或额外验证，请在已打开的官方页面完成。不会重复提交密码。',
 rejected: '登录未完成，请在官方页面核对账号、密码或验证提示。',
 unsupported: '登录页面发生变化，已停止自动填写，请在官方页面登录。',
 timeout: '未能确认登录结果，请查看已打开的官方页面。',
 failed: '无法完成登录，请检查浏览器扩展和网络后重试。',
 cancelled: '已取消本次登录。',
});
const terminal = new Set(['success','already_signed_in','manual_required','rejected','unsupported','timeout','failed','cancelled']);
const failureMessages=Object.freeze({
 document_changed:'SEP 或邮箱页面在填写时发生跳转，尚未确认登录，请查看官方页面。',
 site_permission:'校园桥接没有该登录页的操作权限，请在扩展的网站访问设置中允许该站点。',
 request_timeout:'读取本机凭据或打开登录页超时，请稍后重试。',
 provider_mismatch:'登录凭据与请求的系统不匹配，已停止填写，请更新校园桥接。',
 script_type_error:'登录表单操作遇到页面兼容问题（类型错误），请保留官方页面以便检查。',
 browser_script_error:'浏览器未能执行登录表单操作，请检查校园桥接的错误提示。',
});
const error = (status, message) => Object.assign(new Error(message), { status });
const equal = (a,b) => typeof a==='string' && a.length===b.length && timingSafeEqual(Buffer.from(a),Buffer.from(b));

// Tickets live only in this process. The import connection code cannot redeem them.
export function createLoginBroker({ readSecrets, clock=Date.now, onFailure=()=>{} }={}) {
 const jobs=new Map();
 function prune(){for(const [id,j] of jobs)if(clock()-j.createdAt>5*60000)jobs.delete(id);}
 function get(id){prune();const j=jobs.get(id);if(!j)throw error(404,'登录请求不存在或已过期，请重新点击一键登录。');if(!terminal.has(j.state)&&clock()-j.createdAt>90000)j.state='timeout';return j;}
 function view(j){return {id:j.id,provider:j.provider,state:j.state,message:failureMessages[j.reason]||LOGIN_MESSAGES[j.state],done:terminal.has(j.state),url:LOGIN_PROVIDERS[j.provider].url};}
 function authorize({id,ticket,extensionId}){
  const j=get(id);
  if(!/^[a-f0-9]{64}$/.test(ticket||'')||!equal(ticket,j.ticket)||extensionId!==j.extensionId)throw error(401,'登录授权无效。');
  if(terminal.has(j.state))throw error(409,'本次登录已结束，请重新发起。');
  return j;
 }
 return {
  create({provider,extensionId}){
   prune();if(!Object.hasOwn(LOGIN_PROVIDERS,provider)||!/^[a-p]{32}$/.test(extensionId||''))throw error(400,'不支持的登录请求。');
   for(const j of jobs.values())if(j.provider===provider&&!view(get(j.id)).done)throw error(409,'该系统已有登录正在进行，请等待本次结果。');
   const p=LOGIN_PROVIDERS[provider],s=readSecrets();
   if(!s[p.account]||!s[p.password])throw error(400,`请先在连接与设置中保存完整的 ${p.name} 账号和密码。`);
   const j={id:randomBytes(12).toString('hex'),ticket:randomBytes(32).toString('hex'),provider,extensionId,createdAt:clock(),state:'pending',claimed:false};
   jobs.set(j.id,j);return {...view(j),ticket:j.ticket};
  },
  status(id){return view(get(id));},
  claim(input){
   const j=authorize(input);
   if(j.claimed||clock()-j.createdAt>45000)throw error(409,'凭据领取已使用或过期，请重新发起登录。');
   j.claimed=true;j.state='submitting';
   const p=LOGIN_PROVIDERS[j.provider],s=readSecrets();
   if(!s[p.account]||!s[p.password]){j.state='failed';throw error(400,'保存的凭据不完整。');}
   return {provider:j.provider,account:s[p.account],password:s[p.password]};
  },
  report({...input}){
   const j=authorize(input),state=input.state;
   const allowed=j.claimed?['success','manual_required','rejected','unsupported','timeout','failed']:['opening','already_signed_in','manual_required','unsupported','timeout','failed'];
   if(!allowed.includes(state))throw error(400,'无效的登录状态。');
   j.state=state;if(state==='failed'){j.reason=Object.hasOwn(failureMessages,input.reason)?input.reason:undefined;onFailure({provider:j.provider,credentialsClaimed:j.claimed,elapsedMs:clock()-j.createdAt,reason:j.reason});}return view(j);
  },
  cancel(id){const j=get(id);if(!terminal.has(j.state))j.state='cancelled';return view(j);},
 };
}

export function loginBridgeRoutes(app,broker){
 for(const action of ['claim','report'])app.post(`/api/bridge/login/${action}`,(req,res)=>{
  const extensionId=req.headers['x-ucas-extension'];
  // Extension service workers may omit Origin. The pinned ID and random ticket
  // are still required; a present browser Origin must match the same extension.
  if(!/^[a-p]{32}$/.test(extensionId||'')||(req.headers.origin&&req.headers.origin!==`chrome-extension://${extensionId}`))return res.status(403).json({error:'登录授权只供校园桥接使用。'});
  if(!req.is('application/json'))return res.status(415).json({error:'请使用 JSON 请求'});
  try{res.json(broker[action]({id:req.body.id,ticket:req.body.ticket,state:req.body.state,reason:req.body.reason,extensionId}));}
  catch(e){res.status(e.status||500).json({error:e.status?e.message:'无法读取本机登录凭据。'});}
 });
}
export function loginRoutes(app,broker){
 app.post('/api/login/jobs',(req,res)=>{try{res.json(broker.create(req.body));}catch(e){res.status(e.status||500).json({error:e.status?e.message:'无法读取本机登录凭据。'});}});
 app.get('/api/login/jobs/:id',(req,res)=>{try{res.json(broker.status(req.params.id));}catch(e){res.status(e.status||500).json({error:'登录请求已过期，请重新点击。'});}});
 app.post('/api/login/jobs/:id/cancel',(req,res)=>{try{res.json(broker.cancel(req.params.id));}catch(e){res.status(e.status||500).json({error:'登录请求已过期。'});}});
}
