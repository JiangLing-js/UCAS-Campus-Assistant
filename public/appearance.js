const storageKey='ucas.fontScale';
const normalize=value=>{const number=Number(value);return Number.isFinite(number)&&number>0?Math.min(160,Math.max(90,Math.round(number/10)*10)):100;};
let fontScale=100;
try{fontScale=normalize(localStorage.getItem(storageKey));}catch{/* Appearance still works when browser storage is unavailable. */}

function applyFontScale(value,persist=true){
 fontScale=normalize(value);
 document.documentElement.dataset.fontScale=String(fontScale);
 document.querySelectorAll('[data-font-scale-value]').forEach(el=>el.textContent=`${fontScale}%`);
 document.querySelectorAll('[data-font-step]').forEach(el=>{el.disabled=Number(el.dataset.fontStep)<0?fontScale===90:fontScale===160;});
 const slider=document.getElementById('font-size-range');
 if(slider){slider.value=String(fontScale);slider.setAttribute('aria-valuetext',`${fontScale}%`);}
 if(persist)try{localStorage.setItem(storageKey,String(fontScale));}catch{/* Keep this tab's preference without interrupting the adjustment. */}
}

export function appearanceSettings(){
 return `<section class="settings-section appearance-settings"><h3>显示与字体</h3><p>调整整个工作台的字体大小，立即生效，并在当前浏览器中记住你的选择。</p><div class="font-setting-heading"><label for="font-size-range">字体大小</label><output for="font-size-range" data-font-scale-value>${fontScale}%</output><button type="button" class="secondary" data-font-reset>恢复默认</button></div><input id="font-size-range" type="range" min="90" max="160" step="10" value="${fontScale}" aria-valuetext="${fontScale}%"><div class="font-range-labels"><span>较小 · 90%</span><span>较大 · 160%</span></div><div class="font-preview"><strong>文字预览</strong><p>今天的课程、待办和校园通知，清楚一点，轻松一点。</p></div></section>`;
}

document.addEventListener('click',event=>{
 const button=event.target.closest('[data-font-step],[data-font-reset]');if(!button)return;
 applyFontScale(button.hasAttribute('data-font-reset')?100:fontScale+Number(button.dataset.fontStep));
});
document.addEventListener('input',event=>{if(event.target.id==='font-size-range')applyFontScale(event.target.value);});
window.addEventListener('storage',event=>{if(event.key===storageKey||event.key===null)applyFontScale(event.newValue,false);});
applyFontScale(fontScale,false);
