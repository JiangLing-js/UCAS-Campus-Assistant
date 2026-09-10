// Runs in an isolated content-script world. Collect rendered campus information only.
// Never read cookies, input values, localStorage, or application/session variables.
(() => {
 const host=location.hostname;
 if(host!=='mail.cstnet.cn'&&!['ucas.ac.cn','ucas.edu.cn'].some(domain=>host===domain||host.endsWith('.'+domain)))return null;
 const clean=value=>{try{const u=new URL(value,document.URL);if(!/^https?:$/.test(u.protocol)||!['ucas.ac.cn','ucas.edu.cn'].some(d=>u.hostname===d||u.hostname.endsWith('.'+d)))return '';u.search='';u.hash='';return u.href;}catch{return '';}};
 const visible=el=>!!(el.getClientRects().length)&&getComputedStyle(el).visibility!=='hidden';
 if(!document.body||Array.from(document.querySelectorAll('input[type="password"]')).some(visible))return null;
 const text=(root,selector,max=1000)=>root.querySelector(selector)?.innerText?.trim().slice(0,max)||'';
 const base={title:document.title.slice(0,500),capturedAt:new Date().toISOString()};
 if(host==='mooc.ucas.edu.cn'&&location.pathname==='/courselist/mycourse'){
  const rows=[...document.querySelectorAll('#courselist li')].filter(visible).slice(0,200);
  const learning=rows.map(r=>({title:(r.querySelector('dt')?.innerText||'').trim().slice(0,300),description:(r.querySelector('dd')?.innerText||'').trim().slice(0,2000)})).filter(c=>c.title);
  if(!learning.length)return null;
  return {...base,sourceUrl:'https://mooc.ucas.edu.cn/courselist/mycourse',integration:'learning',learning};
 }
 if(host==='mail.cstnet.cn'){
  const rows=Array.from(document.querySelectorAll('.j-mail-list .j-mail')).filter(visible).slice(0,200);
  if(!rows.length)return null;
  return {...base,sourceUrl:'https://mail.cstnet.cn/',integration:'mail',mail:rows.map((r,i)=>({id:String(i),subject:text(r,'.subject')||'(无主题)',sender:text(r,'.j-from',500),dateText:text(r,'.desc-time',100),unread:r.classList.contains('unread')}))};
 }
 if(host==='portal.ucas.ac.cn'){
  const used=document.querySelector('#used-flow');if(!used||!visible(used))return null;
  return {...base,sourceUrl:'https://portal.ucas.ac.cn/',integration:'network',network:{connected:!!document.querySelector('#logout')&&visible(document.querySelector('#logout')),usedTraffic:text(document,'#used-flow',100),duration:text(document,'#used-time',100),balance:text(document,'#balance',100)}};
 }
 if(host==='ek.ucas.edu.cn'){
  const rows=Array.from(document.querySelectorAll('.dynamic-item')).filter(visible).slice(0,100);if(!rows.length)return null;
  return {...base,sourceUrl:'https://ek.ucas.edu.cn/dashboard',integration:'activities',activities:rows.map(r=>({title:text(r,'.topic-tag',300).replace(/^#/,'').trim()||'校园活动动态',organization:text(r,'.username',200),description:text(r,'.content',10000),publishedAt:text(r,'.time',100)}))};
 }
 if(host==='sep.ucas.ac.cn'){
  const modal=document.querySelector('#myModal_cy_modal-content');
  if(modal&&visible(modal)){const systems=Array.from(modal.querySelectorAll('a')).filter(visible).map(a=>({name:(a.innerText?.trim()||a.getAttribute('title')||a.querySelector('img')?.alt||a.parentElement?.innerText||'').trim().replace(/^New\s*/i,'').slice(0,150),url:clean(a.href)})).filter(s=>s.name&&/\/portal\/site\/\d+\/\d+$/.test(s.url));if(systems.length)return {...base,sourceUrl:'https://sep.ucas.ac.cn/sepCard/card',integration:'systems',systems};}
 }
 const anchors=root=>Array.from(root.querySelectorAll('a')).filter(visible).map(a=>({text:a.innerText.trim().slice(0,1000),href:clean(a.getAttribute('href')||'')})).filter(a=>a.text).slice(0,500);
 const tables=Array.from(document.querySelectorAll('table')).filter(visible).slice(0,20).map(t=>({id:t.id,rows:Array.from(t.rows).filter(visible).slice(0,500).map(r=>({cells:Array.from(r.cells).slice(0,50).map(c=>({text:c.innerText.slice(0,10000),rowSpan:Math.min(100,Math.max(1,c.rowSpan)),colSpan:Math.min(100,Math.max(1,c.colSpan))})),links:anchors(r).slice(0,30)}))}));
 const links=anchors(document.body);
 if(!tables.length&&!links.length)return null;
 return {sourceUrl:clean(document.URL),title:document.title.slice(0,500),capturedAt:new Date().toISOString(),text:'',tables,links};
})();
