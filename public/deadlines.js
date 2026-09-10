const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const localValue=value=>value?new Date(Date.parse(value)+8*3600000).toISOString().slice(0,16):'';
export function openDeadlineDialog({api,toast,onSaved,item}){
 const d=document.createElement('dialog');d.className='integration-dialog deadline-dialog';
 const source=item?.sourceUrl||'';
 d.innerHTML=`<div class="dialog-heading"><h2>从文字识别 DDL</h2><button type="button" data-close data-ext class="icon-button" aria-label="关闭">×</button></div>
 <p class="muted small">粘贴作业要求或通知，先核对预览，再保存。识别在本机完成，不调用 DeepSeek。</p>
 <form id="deadline-preview-form"><label>作业或通知原文<textarea name="text" rows="7" maxlength="50000" required placeholder="例如：课程作业，截止时间：2026年9月18日 23:59">${esc(item?[item.title,item.content].filter(Boolean).join('\n'):'')}</textarea></label>
 <label>原文参考日期（包含“明天”等相对日期时请核对）<input name="referenceDate" type="date" required value="${localValue(new Date().toISOString()).slice(0,10)}"></label>
 <button type="submit" data-ext class="secondary">识别并预览</button></form>
 <p class="error" role="alert"></p><form id="deadline-save-form" hidden><div id="deadline-candidates"></div><button type="submit" data-ext class="primary">保存选中的 DDL</button></form>`;
 document.body.append(d);d.querySelector('[data-close]').onclick=()=>d.close();d.addEventListener('close',()=>d.remove());d.showModal();
 const error=d.querySelector('.error'),previewForm=d.querySelector('#deadline-preview-form'),saveForm=d.querySelector('#deadline-save-form');let candidates=[],version=0;
 previewForm.oninput=()=>{version++;candidates=[];saveForm.hidden=true;};
 previewForm.onsubmit=async e=>{
  e.preventDefault();const current=++version,button=e.submitter;button.disabled=true;error.textContent='';saveForm.hidden=true;
  try{
   const result=await api('/deadlines/preview',{text:previewForm.elements.text.value,title:item?.title||'',sourceUrl:source,referenceTime:previewForm.elements.referenceDate.value+'T12:00:00+08:00'});
   if(!d.isConnected||current!==version)return;candidates=result.candidates;
   d.querySelector('#deadline-candidates').innerHTML=`<p>${esc(result.message)}</p>${candidates.map((c,i)=>`<fieldset class="deadline-candidate" data-index="${i}"><legend><label class="inline-label"><input name="chosen" type="checkbox" ${c.startsAt?'checked':''}>候选事项 ${i+1}</label></legend><label>事项标题<input name="title" maxlength="300" value="${esc(c.title)}"></label><div class="form-grid"><label>截止时间（北京时间）<input name="startsAt" type="datetime-local" value="${localValue(c.startsAt)}"></label><label>提前提醒<select name="remindMinutes"><option value="60">1 小时</option><option value="1440">1 天</option><option value="15">15 分钟</option><option value="0">准时</option><option value="">不提醒</option></select></label></div><blockquote>${esc(c.evidence)}</blockquote>${c.warnings.map(w=>`<p class="warning-text">${esc(w)}</p>`).join('')}</fieldset>`).join('')}`;
   saveForm.hidden=false;saveForm.querySelector('button').disabled=!candidates.length;
  }catch(e){if(current===version)error.textContent=e.message;}finally{button.disabled=false;}
 };
 saveForm.onsubmit=async e=>{
  e.preventDefault();const button=e.submitter;button.disabled=true;error.textContent='';
  try{
   const items=[...d.querySelectorAll('.deadline-candidate')].filter(f=>f.querySelector('[name="chosen"]').checked).map(f=>{
    const c=candidates[Number(f.dataset.index)],title=f.querySelector('[name="title"]').value.trim(),when=f.querySelector('[name="startsAt"]').value,remind=f.querySelector('[name="remindMinutes"]').value;
    if(!title||!when)throw new Error('请为选中的每一项填写标题和明确的截止时间。');
    return {title,startsAt:new Date(when+':00+08:00').toISOString(),remindMinutes:remind===''?null:Number(remind),sourceUrl:c.sourceUrl,content:'原文：'+c.evidence};
   });
   if(!items.length)throw new Error('请至少选择一项。');
   const result=await api('/deadlines/import',{items});d.close();await onSaved();toast(`已新增 ${result.count} 条 DDL${result.duplicates?`，跳过 ${result.duplicates} 条重复事项`:''}`);
  }catch(e){error.textContent=e.message;button.disabled=false;}
 };
}
