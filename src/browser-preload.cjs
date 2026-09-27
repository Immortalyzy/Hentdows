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

let pending;
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
  ipcRenderer.send('browser:download-link', url);
}, true);
