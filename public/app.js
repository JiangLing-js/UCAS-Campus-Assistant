import {loginPanel,initLogin,startLogin} from './login.js';
import {initCampusSync,checkCampusSync} from './campus-sync.js';
import {appearanceSettings} from './appearance.js';
import {openDeadlineDialog} from './deadlines.js';
import {deliverPageNotifications,backgroundReminderHelp,remindersPage} from './reminders.js';
import {mailSettings,bindMailSettings,renderIntegration} from './integrations.js';
const $=(q,root=document)=>root.querySelector(q);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names={chat:'对话',inbox:'校园收件箱',calendar:'我的课表',tasks:'待办与 DDL',lectures:'讲座与新闻',planner:'选课规划',activities:'校园活动',services:'校园服务',settings:'连接与设置',notifications:'消息提醒'};
const kinds={course:'课程',deadline:'DDL',reminder:'提醒',lecture:'讲座',notice:'通知',news:'新闻',note:'笔记',activity:'活动'};
let state={items:[],notifications:[],sources:[],syncs:[],conversations:[]},settings={},view='chat',conversationId=null,history=[],busy=false,filter='all',query='',weekOffset=0,toastTimer;
let editingId=null;
const dateKey=v=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));
const fmt=(v,options={month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})=>v?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',...options}).format(new Date(v)):'时间待定';
const time=v=>fmt(v,{hour:'2-digit',minute:'2-digit',hour12:false});
const today=()=>dateKey(new Date());
const openItems=()=>state.items.filter(i=>i.status==='open');
const todayItems=()=>openItems().filter(i=>i.startsAt&&dateKey(i.startsAt)===today()&&['course','reminder','deadline'].includes(i.kind));
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),4200);}
async function api(url,data,method=data?'POST':'GET'){
 const response=await fetch('/api'+url,{method,headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});
 const body=await response.json();if(!response.ok)throw new Error(body.error||'操作失败');return body;
}
initLogin({api,toast});
initCampusSync({api,toast,refresh:()=>refresh({render:true})});
function safeLink(href){try{const u=new URL(href);return ['http:','https:'].includes(u.protocol)?u.href:''}catch{return ''}}
function messageHtml(text){return escape(text).replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,(_,label,url)=>`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);}
function empty(text,symbol='◌'){return `<div class="empty"><div class="empty-symbol">${symbol}</div>${escape(text)}</div>`;}
async function refresh({render=false,background=false}={}){
 const previous=JSON.stringify([state.items,state.notifications,state.snoozes]);
 state=await api('/state');
 void deliverPageNotifications(api);
 $('#notification-count').textContent=state.notifications.filter(n=>!n.seen).length||'';
 $('#inbox-count').textContent=openItems().filter(i=>['notice','news'].includes(i.kind)).length;
 $('#conversations').innerHTML=state.conversations.slice(0,25).map(c=>`<button data-conversation="${escape(c.id)}" class="${c.id===conversationId?'selected':''}">${escape(c.title)}</button>`).join('')||'<p class="small muted">　从一个问题开始。</p>';
 renderToday();const changed=previous!==JSON.stringify([state.items,state.notifications,state.snoozes]);if(render&&(!background||changed)&&!(background&&document.activeElement?.closest('#main-content select')))renderView();
}
function renderToday(){
 $('#today-date').textContent=fmt(new Date(),{year:'numeric',month:'long',day:'numeric',weekday:'short'});
 $('#today-panel').innerHTML=`<div class="panel-head"><h3>今天的安排</h3><span>${fmt(new Date(),{weekday:'long'})}</span></div>${todayItems().map(i=>`<div class="timeline-entry"><div class="time">${time(i.startsAt)}${i.endsAt?' — '+time(i.endsAt):''}</div><h4>${escape(i.title)}</h4><p>${escape(i.location||kinds[i.kind])}</p></div>`).join('')||'<p class="small muted">今天暂时没有已同步的安排。</p>'}<div class="panel-separator"></div><div class="panel-head"><h3>已连接的校园信息</h3><span>${state.syncs.filter(s=>s.status==='ok').length} 个来源</span></div>${state.syncs.slice(0,5).map(s=>`<div class="source-mini"><span class="dot ${s.status==='ok'?'live':''}"></span>${escape(({timetable:'本周课表',lectures:'科学前沿讲座','sep.ucas.ac.cn':'SEP 通知','www.ucas.ac.cn':'校园新闻'})[s.source]||s.source)}<small>${fmt(s.synced_at,{hour:'2-digit',minute:'2-digit'})}</small></div>`).join('')}<div class="quiet-note"><strong>留一点时间，给更重要的事。</strong>课程、通知和截止日期，都可以从这里找到。课表仅包含实际同步过的周。</div>`;
}
function navigate(next){view=next;filter='all';query='';location.hash=next;renderView();}
function renderView(){
 $('#view-title').textContent=names[view]||'对话';document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
 if(['planner','services'].includes(view)){renderIntegration(view,{api,toast,main:$('#main-content'),isCurrent:v=>view===v});return;}
 if(view==='chat')renderChat();else if(view==='calendar')renderCalendar();else if(view==='settings')renderSettings();else if(view==='notifications')renderNotifications();else renderList();
}
function renderChat(){
 const weekCourses=openItems().filter(i=>i.kind==='course'&&i.startsAt&&Math.abs(Date.parse(i.startsAt)-Date.now())<7*86400000);
 const deadlines=openItems().filter(i=>['deadline','reminder'].includes(i.kind));
 const lectures=openItems().filter(i=>i.kind==='lecture'&&Date.parse(i.startsAt)>Date.now());
 $('#main-content').innerHTML=`<div class="chat-view">${history.length?'':`<section class="welcome"><div class="eyebrow">YOUR CAMPUS, IN ONE PLACE</div><h1>把校园里的琐事，<br><span>交给一个对话。</span></h1><p>从今天的课程，到下一场想听的讲座。<br>把分散的信息收在一起，安心做你手头的事。</p><div class="stats"><div class="stat"><strong>${weekCourses.length}</strong><span>门次课程</span><small>最近一周 · 已同步</small></div><div class="stat"><strong>${deadlines.length}</strong><span>项待办</span><small>你的截止日期与提醒</small></div><div class="stat"><strong>${lectures.length}</strong><span>场讲座</span><small>尚未开始 · 已同步</small></div></div><div class="suggestions"><button class="suggestion" data-prompt="我今天和明天有什么课？请列出时间和教室。"><b><span>▦</span>今天和明天有什么课？</b><small>把时间、教室一起整理好</small></button><button class="suggestion" data-prompt="请列出近期已同步的讲座、时间和地点。"><b><span>◈</span>最近有什么值得听的讲座？</b><small>从已同步讲座里找找灵感</small></button><button class="suggestion" data-prompt="帮我看看有哪些待办和快到期的 DDL。"><b><span>☑</span>有哪些事情快到截止时间了？</b><small>先做重要、紧急的那一件</small></button><button class="suggestion" data-prompt="请按适用对象梳理最近的校园通知，并附原文。"><b><span>▤</span>帮我整理校园通知</b><small>保留来源，留意适用时间</small></button></div></section>`}<div id="messages" class="messages">${history.map(m=>`<div class="message ${m.role==='user'?'user':'assistant'}">${messageHtml(m.content)}</div>`).join('')}</div><form id="chat-form" class="composer-area"><div class="composer"><textarea id="chat-input" placeholder="问问课表、看看通知，或记下一件要做的事…" rows="2" maxlength="12000" aria-label="发送消息" ${busy?'disabled':''}></textarea><div class="composer-footer"><div class="composer-tools"><button type="button" data-action="add">＋ 添加事项</button><span class="model-label">${escape(settings.model||'DeepSeek')} · ${settings.hasDeepseekKey?'已连接':'待连接'}</span></div><button class="send-button" aria-label="发送" ${busy?'disabled':''}>↑</button></div></div><p class="composer-hint">Enter 发送 · Shift + Enter 换行 · 校园信息请以学校原文为准</p></form></div>`;
 $('#chat-form').addEventListener('submit',sendChat);$('#chat-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('#chat-form').requestSubmit();}});
}
async function sendChat(event){
 event.preventDefault();const input=$('#chat-input'),text=input.value.trim();if(!text||busy)return;
 if(!settings.hasDeepseekKey){sessionStorage.setItem('draft',text);navigate('settings');toast('先在这里填写 DeepSeek API Key，消息已保留。');return;}
 try{
  if(!conversationId)conversationId=(await api('/conversations',{})).id;
  history.push({role:'user',content:text});busy=true;renderChat();const messages=$('#messages');const progress=document.createElement('div');progress.className='tool-event';progress.textContent='正在连接 DeepSeek…';messages.append(progress);$('#main-content').scrollTop=$('#main-content').scrollHeight;
  const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversationId,text})});
  if(!response.ok){const body=await response.json();throw new Error(body.error);}
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',answerReceived=false;
  while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const chunks=buffer.split('\n\n');buffer=chunks.pop();for(const chunk of chunks){if(!chunk.startsWith('data: '))continue;const evt=JSON.parse(chunk.slice(6));if(evt.type==='status')progress.textContent=evt.text;if(evt.type==='tool'&&['sync_campus','get_sync_status','cancel_sync'].includes(evt.name))void checkCampusSync();if(evt.type==='tool')progress.textContent=`${evt.status==='complete'?'✓':'◌'} ${({search_campus:'查询校园信息',get_agenda:'查阅日程',create_item:'保存本地事项',complete_item:'更新事项',list_sources:'检查来源',sync_source:'同步来源'})[evt.name]||evt.name}`;if(evt.type==='answer'){answerReceived=true;history.push({role:'assistant',content:evt.text});}if(evt.type==='error')throw new Error(evt.text);}}
  if(!answerReceived)throw new Error('连接已结束，但没有收到完整回答。');
 }catch(error){toast(error.message);sessionStorage.setItem('draft',text);}
 finally{busy=false;if(conversationId)history=await api(`/conversations/${conversationId}/messages`).catch(()=>history);await refresh();if(view==='chat'){renderChat();$('#main-content').scrollTop=$('#main-content').scrollHeight;}}
}
function itemCard(i){
 const local=['deadline','reminder','note'].includes(i.kind),url=safeLink(i.sourceUrl);
 return `<article class="item-card ${i.status==='done'?'done':''}">${local?`<button class="item-check" data-complete="${escape(i.id)}" aria-label="${i.status==='done'?'恢复':'完成'}：${escape(i.title)}">${i.status==='done'?'✓':''}</button>`:''}<div class="item-main"><span class="kind-badge ${i.kind}">${kinds[i.kind]}</span><h3>${escape(i.title)}</h3><div class="meta">${i.startsAt?`<span>${fmt(i.startsAt)}${i.endsAt?' — '+time(i.endsAt):''}</span>`:''}${i.location?`<span>⌖ ${escape(i.location)}</span>`:''}<span>${i.source==='manual'?'本地事项':'校园来源'}</span>${i.remindMinutes!=null?`<span>提前 ${i.remindMinutes} 分钟提醒</span>`:''}</div>${i.content?`<p class="description">${escape(i.content)}</p>`:''}<div class="card-actions">${url?`<a class="text-button" href="${escape(url)}" target="_blank" rel="noopener noreferrer">查看原文 ↗</a>`:''}${i.startsAt&&i.status==='open'?`<button class="text-button" data-remind="${escape(i.id)}">${i.remindMinutes==null?'提前 15 分钟提醒我':'关闭提醒'}</button>`:''}${local?`<button class="text-button" data-edit="${escape(i.id)}">编辑</button>`:''}${['notice','news','note','activity'].includes(i.kind)?`<button class="text-button" data-extract="${escape(i.id)}">识别 DDL</button>`:''}<button class="text-button" data-archive="${escape(i.id)}">归档</button></div></div></article>`;
}
function renderList(){
 const configs={inbox:{desc:'把分散的校园信息放在一起，原文链接随时可查。',kinds:['notice','news','note'],filters:['all','notice','news','note']},tasks:{desc:'给每件事一个时间，把精力留给眼前。',kinds:['deadline','reminder','note'],filters:['all','deadline','reminder','done']},lectures:{desc:'校园里的新想法，从这里开始。添加提醒不会报名。',kinds:['lecture','news'],filters:['all','lecture','news','past']}};
 configs.activities={desc:'团委二课的活动动态。下方日期为发布时间；活动预告与报名名额以原站为准。',kinds:['activity'],filters:['all','activity']};
 const config=configs[view]||configs.inbox;
 let items=state.items.filter(i=>config.kinds.includes(i.kind)&&i.status!=='archived');
 if(filter==='done')items=items.filter(i=>i.status==='done');else if(view==='tasks')items=items.filter(i=>i.status==='open');
 if(view==='lectures'&&filter!=='past')items=items.filter(i=>!i.startsAt||Date.parse(i.endsAt||i.startsAt)>Date.now());
 if(filter==='past')items=items.filter(i=>i.startsAt&&Date.parse(i.endsAt||i.startsAt)<=Date.now());else if(!['all','done'].includes(filter))items=items.filter(i=>i.kind===filter);
 if(query)items=items.filter(i=>(i.title+' '+i.content+' '+i.location).toLowerCase().includes(query.toLowerCase()));
 const focus=$('#list-search')===document.activeElement,pos=$('#list-search')?.selectionStart;
 $('#main-content').innerHTML=`<div class="page"><div class="page-heading"><div><h2>${names[view]}</h2><p>${config.desc}</p></div><div class="integration-actions">${view==='tasks'?'<button class="secondary" data-action="extract-deadlines">识别 DDL</button>':''}<button class="primary" data-action="add">＋ 添加事项</button></div></div><div class="filters">${config.filters.map(f=>`<button class="chip ${filter===f?'active':''}" data-filter="${f}">${({all:'全部',done:'已完成',past:'往期'})[f]||kinds[f]}</button>`).join('')}<input id="list-search" class="search" type="search" value="${escape(query)}" placeholder="搜索标题、地点或内容" aria-label="搜索事项"></div>${items.length?items.map(itemCard).join(''):empty('这里暂时没有事项。你可以添加一件事，或同步校园页面。')}<p class="footer-note">${items.length} 条事项 · 通知适用范围和讲座报名状态以学校原文为准。</p></div>`;
 $('#list-search').addEventListener('input',e=>{query=e.target.value;renderList();});if(focus){$('#list-search').focus();$('#list-search').setSelectionRange(pos,pos);}
}
function renderCalendar(){
 const monday=new Date(today()+'T00:00:00+08:00');const weekday=new Date(Date.now()+8*3600000).getUTCDay();monday.setUTCDate(monday.getUTCDate()-((weekday+6)%7)+weekOffset*7);
 const days=Array.from({length:7},(_,i)=>new Date(monday.getTime()+i*86400000));
 $('#main-content').innerHTML=`<div class="page"><div class="page-heading"><div><h2>我的课表</h2><p>上课的时间和地点，一眼就能找到。</p></div><a class="secondary" href="/api/calendar.ics">导出日历 ↗</a></div><div class="calendar-toolbar"><button class="secondary" data-week="-1" aria-label="上一周">←</button><strong>${fmt(days[0],{month:'numeric',day:'numeric'})} — ${fmt(days[6],{month:'numeric',day:'numeric'})}</strong><button class="secondary" data-week="1" aria-label="下一周">→</button><button class="secondary" data-week="0">本周</button><button class="secondary" data-action="add">＋ 添加</button></div><div class="calendar-scroll"><div class="calendar">${days.map(d=>{const key=dateKey(d);const items=openItems().filter(i=>i.startsAt&&dateKey(i.startsAt)===key&&['course','deadline','reminder'].includes(i.kind));return `<div class="day-column"><div class="day-head ${key===today()?'is-today':''}">${fmt(d,{weekday:'long'})}<strong>${fmt(d,{day:'numeric'}).replace('日','')}</strong></div>${items.map(i=>`<div class="course-block"><div class="time">${time(i.startsAt)}${i.endsAt?' – '+time(i.endsAt):''}</div><h4>${escape(i.title)}</h4><p>${escape(i.location||kinds[i.kind])}</p></div>`).join('')||'<p class="muted small">　暂无已同步安排</p>'}</div>`}).join('')}</div></div><p class="footer-note">只显示实际同步的日期。切换学校网页上的周次并同步，可补充其他周的课表。</p></div>`;
}
function renderNotifications(){
 $('#main-content').innerHTML=remindersPage(state,{escape,fmt,empty});
}
function renderSettings(){
 $('#main-content').innerHTML=`<div class="page"><div class="page-heading"><div><h2>连接与设置</h2><p>你的校园信息保存在本机，由你决定如何连接。</p></div></div>${loginPanel(settings)}${appearanceSettings()}${backgroundReminderHelp()}${mailSettings(settings)}<section class="settings-section"><h3>DeepSeek 对话</h3><p>对话时，相关消息和工具查到的校园内容会发送给 DeepSeek。密钥由本机后端使用，保存后不会返回页面。</p><form id="settings-form"><div class="form-grid"><label>API Key<input type="password" name="deepseekKey" autocomplete="off" placeholder="${settings.hasDeepseekKey?'已保存；留空保留原密钥':'粘贴你的 DeepSeek API Key'}"></label><label>模型<input name="model" value="${escape(settings.model||'deepseek-v4-flash')}" list="models"><datalist id="models"><option value="deepseek-v4-flash"><option value="deepseek-v4-pro"></datalist></label></div><button class="primary">保存连接</button></form><div class="status-line">${settings.hasDeepseekKey?'● 已保存密钥，可以开始对话':'○ 等待 API Key；课表、待办和提醒已经可以使用'} · Windows 本机加密</div></section><section class="settings-section"><h3>复用 Chrome 的校园登录</h3><p>在学校网页正常登录，校园桥接扩展会读取你当前打开的课表、通知和讲座页面。同步功能不读取输入框值或 Cookie；一键登录只填写你在本机主动保存的凭据。遇到验证码时，在学校页面正常完成验证即可。</p><div class="connection-code"><input id="bridge-code" type="password" readonly value="${escape(settings.bridgeToken||'')}" aria-label="校园桥接连接码"><button class="secondary" data-action="copy-bridge">复制连接码</button></div><ol class="small muted"><li>打开 Chrome 扩展程序管理页，开启开发者模式。</li><li>选择「加载已解压的扩展程序」，选择下面的文件夹。</li><li>打开「国科大校园桥接」，粘贴连接码，点击「连接并同步」。</li></ol><div class="code">${escape(settings.extensionDirectory||'extension 文件夹')}</div><p class="footer-note">自动同步仅采集已经打开的国科大页面。首次连接后，可在扩展里开启每 15 分钟同步。</p></section><section class="settings-section"><h3>校园来源</h3><p>使用扩展可同步登录后或动态加载的页面；公开新闻可以直接刷新。</p>${state.sources.map(s=>{const sync=state.syncs.find(x=>x.source===s.id||x.source===new URL(s.url).hostname);return `<div class="source-row"><div class="source-name"><strong>${escape(s.name)}</strong><small>${sync?escape(sync.status==='ok'?'最近同步 '+fmt(sync.synced_at):sync.message):'尚未直接同步'}</small></div><a class="text-button" href="${escape(s.url)}" target="_blank" rel="noopener noreferrer">打开网站 ↗</a><button class="secondary" data-sync="${s.id}">${s.type==='public'?'刷新新闻':'尝试 Cookie 同步'}</button></div>`}).join('')}<label class="inline-label"><input type="checkbox" id="auto-sync" ${settings.autoSync?'checked':''}>本地服务运行时，每 30 分钟刷新公开新闻</label></section><section class="settings-section"><h3>SEP 账号与密码</h3><p>账号、密码、Cookie 和 API Key 存在同一个 Windows 加密保险箱。点击「保存并登录 SEP」即可打开官方页面并自动填写；验证码或额外验证在学校页面完成。</p><form id="account-form"><div class="form-grid"><label>学校账号<input name="ucasAccount" autocomplete="off" placeholder="${settings.hasAccount?'已保存；留空保留':'可选'}"></label><label>学校密码<input name="ucasPassword" type="password" autocomplete="new-password" placeholder="${settings.hasPassword?'已保存；留空保留':'填写 SEP 密码'}"></label></div><div class="integration-actions"><button class="secondary" data-ext>保存到本机保险箱</button><button class="primary" data-ext data-login-save="sep">保存并登录 SEP</button></div></form><form id="cookie-form"><label>Cookie 所属站点<select name="sourceId">${state.sources.filter(s=>s.type==='session').map(s=>`<option value="${s.id}">${escape(s.name)} · ${escape(new URL(s.url).origin)}</option>`).join('')}</select></label><label>Cookie<input type="password" name="cookie" autocomplete="off" placeholder="粘贴 Cookie；留空并保存会移除此站点的 Cookie"></label><button class="secondary">保存 Cookie</button></form><p class="footer-note">已保存 Cookie 的站点：${escape(settings.cookieOrigins?.join('、')||'无')}。Cookie 仅发往对应站点，不跟随跳转。</p></section><section class="settings-section"><h3>MCP 接入</h3><p>以下配置可接入支持 stdio MCP 的客户端，与此工作台共用本地数据库。</p><pre class="code">${escape(JSON.stringify(settings.mcpConfig||{},null,2))}</pre><button class="secondary" data-action="copy-mcp">复制 MCP 配置</button><p class="footer-note">本地数据目录：${escape(settings.dataDirectory||'')}。退出本地服务后停止定时检查；下次启动会检查过去 24 小时内漏掉的提醒。</p></section></div>`;
 bindMailSettings({api,toast,reload:async()=>{settings=await api('/settings');renderSettings();}});
 $('#settings-form').addEventListener('submit',async e=>{e.preventDefault();try{await api('/settings',Object.fromEntries(new FormData(e.target)));settings=await api('/settings');toast('连接设置已保存');renderSettings();$('#connection-dot').classList.toggle('live',settings.hasDeepseekKey);if(sessionStorage.getItem('draft')){navigate('chat');$('#chat-input').value=sessionStorage.getItem('draft');sessionStorage.removeItem('draft');}}catch(err){toast(err.message);}});
 $('#account-form').addEventListener('submit',async e=>{e.preventDefault();const login=e.submitter?.dataset.loginSave;const buttons=[...e.target.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);try{await api('/settings',Object.fromEntries(new FormData(e.target)));settings=await api('/settings');renderSettings();toast('已加密保存');if(login)await startLogin(login);}catch(err){toast(err.message);}finally{buttons.forEach(b=>b.disabled=false);}});
 $('#cookie-form').addEventListener('submit',async e=>{e.preventDefault();try{await api('/cookies',Object.fromEntries(new FormData(e.target)));settings=await api('/settings');renderSettings();toast('Cookie 设置已更新');}catch(err){toast(err.message);}});
 $('#auto-sync').addEventListener('change',async e=>{try{await api('/settings',{autoSync:e.target.checked});settings.autoSync=e.target.checked;toast('自动同步设置已保存');}catch(err){toast(err.message);}});
}
const datetimeValue=value=>value?new Date(Date.parse(value)+8*3600000).toISOString().slice(0,16):'';
function addItem(item=null){
 const form=$('#item-form');form.reset();editingId=item?.id||null;
 $('#item-dialog h2').textContent=item?'编辑事项':'添加一件事';form.elements.kind.disabled=!!item;
 if(item){for(const key of ['title','kind','content','location'])form.elements[key].value=item[key]||'';form.elements.startsAt.value=datetimeValue(item.startsAt);form.elements.endsAt.value=datetimeValue(item.endsAt);form.elements.remindMinutes.value=item.remindMinutes==null?'':String(item.remindMinutes);if(form.elements.remindMinutes.value!==String(item.remindMinutes)&&item.remindMinutes!=null){const option=new Option('提前 '+item.remindMinutes+' 分钟',String(item.remindMinutes));form.elements.remindMinutes.add(option);form.elements.remindMinutes.value=option.value;}}
 else form.elements.startsAt.value=today()+'T20:00';
 $('#item-error').textContent='';$('#item-dialog').showModal();form.elements.title.focus();
}
$('#item-form').addEventListener('submit',async e=>{
 e.preventDefault();const button=e.submitter;button.disabled=true;
 try{const data=Object.fromEntries(new FormData(e.target));data.startsAt=data.startsAt?new Date(data.startsAt+':00+08:00').toISOString():null;data.endsAt=data.endsAt?new Date(data.endsAt+':00+08:00').toISOString():null;data.remindMinutes=data.remindMinutes===''?null:Number(data.remindMinutes);await api(editingId?'/items/'+editingId:'/items',data,editingId?'PATCH':'POST');$('#item-dialog').close();await refresh({render:true});toast('事项已保存');}catch(err){$('#item-error').textContent=err.message;}finally{button.disabled=false;}
});
$('#close-dialog').onclick=()=>$('#item-dialog').close();
document.addEventListener('click',async e=>{const b=e.target.closest('button,[data-view]');if(!b||b.matches('[data-font-step],[data-font-reset],[data-ext]'))return;try{
 if(b.dataset.view){navigate(b.dataset.view);return;}
 if(b.dataset.conversation){if(busy)return toast('请等当前回答完成');conversationId=b.dataset.conversation;history=await api(`/conversations/${conversationId}/messages`);navigate('chat');await refresh();return;}
 if(b.dataset.prompt){$('#chat-input').value=b.dataset.prompt;$('#chat-input').focus();return;}
 if(b.dataset.filter){filter=b.dataset.filter;renderList();return;}
 if(b.dataset.week){weekOffset=b.dataset.week==='0'?0:weekOffset+Number(b.dataset.week);renderCalendar();return;}
 if(b.dataset.complete){const i=state.items.find(i=>i.id===b.dataset.complete);await api('/items/'+i.id,{status:i.status==='done'?'open':'done'},'PATCH');await refresh({render:true});return;}
 if(b.dataset.archive){await api('/items/'+b.dataset.archive,{status:'archived'},'PATCH');await refresh({render:true});toast('已归档');return;}
 if(b.dataset.remind){const i=state.items.find(i=>i.id===b.dataset.remind);await api('/items/'+i.id,{remindMinutes:i.remindMinutes==null?15:null},'PATCH');await refresh({render:true});toast('提醒设置已更新');return;}
 if(b.dataset.read){await api('/notifications/'+b.dataset.read+'/read',{});await refresh({render:true});return;}
 if(b.dataset.sync){b.disabled=true;const result=await api('/sync/'+b.dataset.sync,{});toast(result.message||`已同步 ${result.count||0} 条`);await refresh({render:true});return;}
 if(b.dataset.edit){addItem(state.items.find(i=>i.id===b.dataset.edit));return;}
 if(b.dataset.extract||b.dataset.action==='extract-deadlines'){openDeadlineDialog({api,toast,onSaved:()=>refresh({render:true}),item:state.items.find(i=>i.id===b.dataset.extract)});return;}
 if(b.dataset.snooze){const minutes=Number(b.closest('.notification-card').querySelector('[data-snooze-minutes]').value);await api('/notifications/'+b.dataset.snooze+'/snooze',{minutes});await refresh({render:true});toast(minutes+' 分钟后再提醒，事项截止时间未改变');return;}
 if(b.dataset.action==='read-all'){await api('/notifications/read-all',{});await refresh({render:true});return;}
 if(b.dataset.action==='add')addItem();
 if(b.dataset.action==='copy-bridge'){await navigator.clipboard.writeText(settings.bridgeToken);toast('连接码已复制');}
 if(b.dataset.action==='copy-mcp'){await navigator.clipboard.writeText(JSON.stringify(settings.mcpConfig,null,2));toast('MCP 配置已复制');}
 if(b.dataset.action==='notifications'){if(!('Notification'in window))return toast('当前浏览器不支持桌面通知');const permission=await Notification.requestPermission();toast(permission==='granted'?'桌面通知已开启':'可在浏览器网站设置中允许通知');}
 }catch(err){toast(err.message);}finally{b.disabled=false;}});
async function newChat(){if(busy)return toast('请等当前回答完成');conversationId=null;history=[];navigate('chat');$('#chat-input').focus();}
$('#new-chat').onclick=newChat;$('#notify-button').onclick=()=>navigate('notifications');
document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key.toLowerCase()==='k'){e.preventDefault();newChat();}});
window.addEventListener('hashchange',()=>{const next=location.hash.slice(1);if(names[next]&&next!==view)navigate(next);});
$('#today-date').textContent=fmt(new Date(),{year:'numeric',month:'long',day:'numeric',weekday:'short'});
try{[settings]=await Promise.all([api('/settings'),refresh()]);$('#connection-dot').classList.toggle('live',settings.hasDeepseekKey);view=names[location.hash.slice(1)]?location.hash.slice(1):'chat';renderView();}catch(err){$('#main-content').innerHTML=empty(err.message);}
setInterval(()=>refresh({render:['notifications','calendar'].includes(view),background:true}).catch(()=>{}),15000);
