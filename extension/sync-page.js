// Executed only in a fixed campus destination, in an isolated content-script world.
function campusSyncPage(source,action='inspect'){
 const origins={sep:'https://sep.ucas.ac.cn',systems:'https://sep.ucas.ac.cn',lectures:'https://xkcts.ucas.ac.cn:8443',timetable:'https://kb.mooc.ucas.edu.cn',courses:'https://mooc.ucas.edu.cn',activities:'https://ek.ucas.edu.cn',mail:'https://mail.cstnet.cn',network:'https://portal.ucas.ac.cn',news:'https://www.ucas.ac.cn'};
 const visible=el=>!!el&&el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none';
 const first=selector=>[...document.querySelectorAll(selector)].find(visible);
 const text=el=>(el?.innerText||'').trim();
 if(!Object.hasOwn(origins,source))return {state:'unsupported'};
 const sep=location.origin==='https://sep.ucas.ac.cn';
 if(location.origin!==origins[source]&&!sep)return {state:'waiting'};
 if(document.readyState!=='complete'||!document.body)return {state:'waiting'};
 if(first('input[type="password"]')||first('input[name*="captcha"],input[name*="verify"],input[name*="otp"],iframe[src*="captcha"]'))return {state:'login_required'};
 if(sep){
  if(!first('#sepTabNav'))return {state:'waiting'};
  if(source==='lectures'){
   if(action==='prepare'){
    const tab=[...document.querySelectorAll('#sepTabNav a,#sepTabNav button,[role="tab"]')].find(el=>visible(el)&&text(el)==='课程学习');if(tab){tab.click();return {state:'waiting',prepared:true};}
   }
   const heading=[...document.querySelectorAll('h4')].find(el=>visible(el)&&text(el).startsWith('科学前沿讲座'));
   let card=heading?.parentElement,button;
   for(let i=0;card&&i<5&&!button;i++,card=card.parentElement)button=[...card.querySelectorAll('button,a')].find(el=>visible(el)&&text(el)==='更多讲座');
   if(action==='open'&&button){
    // Read only the observed SEP route; never evaluate inline JavaScript or persist its SSO suffix.
    const route=/^\/portal\/site\/226\/xs\/1\/1\/[a-f0-9]{32,256}$/i;
    const handler=button.getAttribute('onclick')||'';
    const match=handler.match(/^\s*window\.open\(\s*(['"])(\/portal\/site\/226\/xs\/1\/1\/[a-f0-9]{32,256})\1\s*,\s*(['"])_blank\3\s*\)\s*;?\s*$/i);
    const destination=button.getAttribute('href')||match?.[2];
    if(destination&&route.test(destination))return {state:'navigate',url:location.origin+destination};
    return {state:'unsupported'};
   }
   return {state:button?'ready':'waiting'};
  }
  if(source==='systems'){
   const modal=document.querySelector('#myModal_cy_modal-content');
   if(visible(modal))return {state:'ready'};
   if(action==='prepare'){
    const button=[...document.querySelectorAll('button')].find(el=>visible(el)&&el.title==='常用系统');
    if(button){button.click();return {state:'waiting',prepared:true};}
   }
   return {state:'waiting'};
  }
  return {state:source==='sep'?'ready':'waiting'};
 }
 if(source==='activities'){
  const choice=[...document.querySelectorAll('[role="dialog"]')].find(el=>visible(el)&&/^选择(账号|角色|单位)$/.test(text(el.querySelector('.el-dialog__title'))));
  if(choice){
   const options=[...choice.querySelectorAll('.unit-list .unit-item')].filter(visible);
   if(options.length>1)return {state:'login_required'};
   if(options.length===1&&action==='prepare'){options[0].click();return {state:'waiting',prepared:true};}
   return {state:'waiting'};
  }
 }
 const markers={timetable:'table',lectures:'table',courses:'#courseData,#courselist',activities:'.dynamic-item',mail:'#mltree_1_a',network:'#used-flow',news:'a[href$=".html"]'};
 const root=first(markers[source]);
 if(source==='mail'&&root){
  if(action==='prepare'){root.click();return {state:'waiting',prepared:true,authenticated:true};}
  const rows=[...document.querySelectorAll('.j-mail-list .j-mail')].filter(visible);
  if(rows.length)return {state:'ready',authenticated:true};
  // Do not confuse an inbox still loading with a confirmed empty folder.
  if(/没有邮件|暂无邮件|文件夹为空|没有找到.*邮件/.test(text(document.body)))return {state:'empty',authenticated:true};
  return {state:'waiting',authenticated:true};
 }
 if(source==='courses'&&root)return {state:root.querySelector('li')?'ready':/暂无课程|没有课程/.test(text(root))?'empty':'waiting'};
 if(source==='network'&&root){if(first('#logout'))return {state:'ready'};if(first('#login'))return {state:'login_required'};return {state:'waiting'};}
 if(source==='activities'&&!root&&/暂无动态|暂无活动/.test(text(document.body)))return {state:'empty'};
 return {state:root?'ready':'waiting'};
}
