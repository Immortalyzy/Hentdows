const { ipcRenderer } = require('electron');

// Nothing is exposed to the remote page. Only trusted mouse gestures reach IPC.
function galleryLink(target) {
  const link = target.closest?.('a[href]');
  if (!link) return null;
  try {
    const u = new URL(link.href);
    const eh = ['e-hentai.org', 'exhentai.org'].includes(u.hostname) && /^\/g\/\d+\/[\w-]+\/?$/.test(u.pathname);
    const hitomi = u.hostname === 'hitomi.la' && (/^\/(galleries|reader)\/\d+\.html$/.test(u.pathname)
      || /^\/(manga|doujinshi|gamecg|cg|imageset|anime)\/[^/]+-\d+\.html$/.test(u.pathname));
    return u.protocol === 'https:' && (eh || hitomi) ? link.href : null;
  } catch { return null; }
}

let pending, requestSequence=0, toast;
const requests=new Map();
function feedback(message,status,point){
  toast?.remove();const host=document.createElement('div');toast=host;
  Object.assign(host.style,{position:'fixed',zIndex:'2147483647',left:`${Math.max(8,Math.min(innerWidth-290,point.x-60))}px`,top:`${Math.max(8,Math.min(innerHeight-80,point.y+15))}px`,pointerEvents:'none'});
  const shadow=host.attachShadow({mode:'closed'}),label=document.createElement('div');
  label.textContent=(status==='queued'?'✓ ':status==='checking'?'… ':'! ')+message;
  Object.assign(label.style,{font:'14px Segoe UI,sans-serif',lineHeight:'1.4',padding:'12px 16px',maxWidth:'280px',color:'#fff',background:status==='queued'?'#276a46':status==='error'?'#973d3d':'#463838',borderRadius:'10px',boxShadow:'0 4px 20px #0007'});
  shadow.append(label);document.documentElement.append(host);
  host.animate([{opacity:0,transform:'translateY(8px) scale(.92)'},{opacity:1,transform:'translateY(0) scale(1)'}],{duration:180,fill:'forwards'});
  if(status!=='checking')setTimeout(()=>{host.animate([{opacity:1},{opacity:0}],{duration:250,fill:'forwards'}).finished.then(()=>host.remove());},status==='error'?4500:1700);
}
ipcRenderer.on('browser:download-result',(_,result)=>{
  const point=requests.get(result.requestId);if(!point)return;requests.delete(result.requestId);
  feedback(result.message||'Download request finished.',result.status,point);
});
window.addEventListener('click', event => {
  if (!event.isTrusted || event.button !== 0 || event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
  const url = galleryLink(event.target);
  if (!url) return;
  event.preventDefault(); event.stopImmediatePropagation();
  clearTimeout(pending);
  if (event.detail > 1) return;
  // Hold gallery navigation briefly so a double click can queue without leaving results.
  pending = setTimeout(() => ipcRenderer.send('browser:open-link', url), 550);
}, true);
window.addEventListener('dblclick', event => {
  if (!event.isTrusted || event.button !== 0 || event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
  const url = galleryLink(event.target);
  if (!url) return;
  clearTimeout(pending);
  event.preventDefault(); event.stopImmediatePropagation();
  const requestId=++requestSequence,point={x:event.clientX,y:event.clientY};requests.set(requestId,point);
  feedback('Checking gallery…','checking',point);
  ipcRenderer.send('browser:download-link', url, requestId);
}, true);
