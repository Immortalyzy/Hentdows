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

let pending, requestSequence=0, toast,options={quickDownload:true},scanTimer,positionTimer,restoring=false;
const markers=new Map();let adStyle;
function scanLinks(){
  scanTimer=null;if(!options.markDownloaded&&!options.markQueued&&!options.markBlocked){for(const node of markers.values())node.remove();markers.clear();return;}
  const links=new Map();
  for(const a of document.querySelectorAll('a[href]')){const url=galleryLink(a);if(!url||links.has(url))continue;
    const row=a.closest('.gallery-content,.gallery,.gl1t,tr')||a.parentElement;
    const tags=[...row.querySelectorAll('[title],a[href*="/tag/"]')].slice(0,100).map(n=>n.getAttribute('title')||n.textContent).filter(t=>t&&t.length<=200);
    links.set(url,{url,tags});if(links.size>=300)break;
  }
  ipcRenderer.send('browser:mark-links',location.href,[...links.values()]);
}
function scheduleScan(){if(!scanTimer)scanTimer=setTimeout(scanLinks,450);}
ipcRenderer.on('browser:options',(_,value)=>{
  options=value;if(!options.quickDownload)clearTimeout(pending);
  if(!adStyle){adStyle=document.createElement('style');document.documentElement.append(adStyle);}
  const css=options.augmented?'iframe[src*="exoclick"],iframe[src*="trafficjunky"],.ad-container,.adbox,#adtop,#adbottom,ins.adsbygoogle{display:none!important}':'';
  if(adStyle.textContent!==css)adStyle.textContent=css;
  scheduleScan();
});
ipcRenderer.on('browser:marks',(_,result)=>{
  if(result.url!==location.href)return;
  for(const mark of result.marks){
    const label=[options.markDownloaded&&mark.downloaded?'✓ Downloaded':'',options.markQueued&&mark.queued?'⇩ Queued':'',options.markBlocked&&mark.blocked?'⊘ Blocked tags':''].filter(Boolean).join(' · ');
    let node=markers.get(mark.url);
    if(!label){node?.remove();markers.delete(mark.url);continue;}
    if(!node?.isConnected){const anchor=[...document.querySelectorAll('a[href]')].find(a=>a.href===mark.url);if(!anchor)continue;node=document.createElement('span');Object.assign(node.style,{display:'inline-block',background:mark.blocked?'#7d3434':'#28513d',color:'#fff',font:'11px Segoe UI,sans-serif',padding:'3px 5px',margin:'3px',borderRadius:'3px'});anchor.after(node);markers.set(mark.url,node);}
    if(node.textContent!==label)node.textContent=label;
  }
});
ipcRenderer.on('browser:restore-scroll',(_,scroll)=>{
  if(!Number.isFinite(scroll))return;restoring=true;clearTimeout(positionTimer);
  let attempts=0;const restore=()=>{window.scrollTo(0,scroll);if(++attempts<8&&scrollY<scroll&&document.readyState!=='complete')setTimeout(restore,150);else {restoring=false;ipcRenderer.send('browser:position',location.href,scrollY);}};setTimeout(restore,100);
});
window.addEventListener('scroll',()=>{if(restoring)return;clearTimeout(positionTimer);positionTimer=setTimeout(()=>ipcRenderer.send('browser:position',location.href,scrollY),250);},{passive:true});
window.addEventListener('pagehide',()=>{if(!restoring)ipcRenderer.send('browser:position',location.href,scrollY);});
window.addEventListener('DOMContentLoaded',()=>new MutationObserver(scheduleScan).observe(document.documentElement,{childList:true,subtree:true}));
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
  if(!options.quickDownload)return;
  if (!event.isTrusted || event.button !== 0 || event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
  const url = galleryLink(event.target);
  if(!url)return;
  event.preventDefault(); event.stopImmediatePropagation();
  clearTimeout(pending);
  if (event.detail > 1) return;
  // Hold gallery navigation briefly so a double click can queue without leaving results.
  pending = setTimeout(() => ipcRenderer.send('browser:open-link', url), 550);
}, true);
window.addEventListener('dblclick', event => {
  if (!event.isTrusted || event.button !== 0 || event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
  const url = galleryLink(event.target);
  if(!url||!options.quickDownload){
    const img=event.target.closest?.('img');if(options.grabPictures&&img&&!url){event.preventDefault();event.stopImmediatePropagation();ipcRenderer.send('browser:grab-picture',img.currentSrc||img.src);}return;
  }
  clearTimeout(pending);
  event.preventDefault(); event.stopImmediatePropagation();
  const requestId=++requestSequence,point={x:event.clientX,y:event.clientY};requests.set(requestId,point);
  feedback('Checking gallery…','checking',point);
  ipcRenderer.send('browser:download-link', url, requestId);
}, true);
