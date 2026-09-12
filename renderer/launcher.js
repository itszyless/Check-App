const input = document.querySelector('#launcher-search');
const list = document.querySelector('#launcher-list');
let pins = [];
let filtered = [];
let activeIndex = 0;

function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function render(){
  const q=input.value.trim().toLowerCase();
  filtered=pins.filter(p=>`${p.name} ${p.path}`.toLowerCase().includes(q));
  if(activeIndex>=filtered.length) activeIndex=0;
  if(!filtered.length){list.innerHTML='<div class="launcher-empty">No pinned items found.</div>';return;}
  list.innerHTML=filtered.map((p,i)=>`<button class="launcher-item ${i===activeIndex?'active':''}" data-i="${i}"><div class="launcher-item-icon"><span></span></div><div><strong>${esc(p.name)}</strong><small>${esc(p.path)}</small></div></button>`).join('');
}
async function refresh(){pins=await window.check.listPins();activeIndex=0;render();}
async function launch(i){const p=filtered[i];if(p)await window.check.launchPin(p.path);}
input.addEventListener('input',()=>{activeIndex=0;render();});
list.addEventListener('click',e=>{const b=e.target.closest('.launcher-item');if(b)launch(Number(b.dataset.i));});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape') window.check.hideLauncher();
  if(e.key==='ArrowDown'&&filtered.length){e.preventDefault();activeIndex=(activeIndex+1)%filtered.length;render();}
  if(e.key==='ArrowUp'&&filtered.length){e.preventDefault();activeIndex=(activeIndex-1+filtered.length)%filtered.length;render();}
  if(e.key==='Enter') launch(activeIndex);
});
window.check.onLauncherReset(()=>{input.value='';refresh().then(()=>{input.focus();input.select();});});
refresh().then(()=>input.focus());
