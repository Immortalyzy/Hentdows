const { setTimeout: delay } = require('node:timers/promises');
const { parseEhGallery, parseEhImage, parseMpv, parseHitomiInfo } = require('./parsers.cjs');
const { imageUrl, allowedNavigation } = require('./sites.cjs');

function createSources({ session, createReader }) {
  async function request(url, referer, signal, options = {}) {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(60000)]);
    for (let redirects = 0; redirects < 8; redirects++) {
      imageUrl(url);
      const response = await session.fetch(url, { ...options, signal: deadline, redirect: 'manual', credentials: 'include',
        headers: { Referer: referer, ...options.headers } });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('The source returned an empty redirect.');
      url = new URL(location, url).href;
      // Never forward POST payloads to a different host.
      if (options.method === 'POST') throw new Error('Unexpected API redirect. Check your login.');
    }
    throw new Error('The source redirected too many times.');
  }
  async function text(url, referer, signal, options) {
    const response = await request(url, referer, signal, options);
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Source returned HTTP ${response.status}. Check access in the browser.`); }
    return response.text();
  }

  async function resolveGallery(gallery, signal) {
    if (gallery.site === 'hitomi') return resolveHitomi(gallery, signal);
    const first = parseEhGallery(await text(gallery.url, gallery.url, signal), gallery);
    let pages = first.pages.map(url => ({ kind: 'eh', url }));
    if (first.mpv && allowedNavigation(first.mpv)) {
      try {
        pages = parseMpv(await text(first.mpv, gallery.url, signal), gallery.url).map(info => ({ kind: 'mpv', ...info, referer: first.mpv }));
      } catch (error) { if (!pages.length || signal.aborted) throw error; }
    }
    if (pages[0]?.kind !== 'mpv') {
      for (let p = 1; p <= first.lastPage; p++) {
        signal.throwIfAborted();
        const page = parseEhGallery(await text(`${gallery.url}?p=${p}`, gallery.url, signal), gallery);
        pages.push(...page.pages.map(url => ({ kind: 'eh', url })));
      }
      pages = [...new Map(pages.map(p => [p.url, p])).values()];
    }
    if (first.expectedPages && pages.length !== first.expectedPages) {
      throw new Error(`Found ${pages.length} of ${first.expectedPages} pages. Check gallery access before retrying.`);
    }
    let metadata = { title: first.title, tags: first.tags };
    try {
      const raw = await text(`${new URL(gallery.url).origin}/api.php`, gallery.url, signal, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'gdata', gidlist: [[Number(gallery.id), gallery.token]], namespace: 1 })
      });
      const data = JSON.parse(raw).gmetadata?.[0];
      if (data && !data.error) metadata = { title: data.title || first.title, tags: data.tags || first.tags };
    } catch (error) { if (signal.aborted) throw error; /* HTML metadata remains usable. */ }
    return { ...metadata, pages };
  }

  async function resolveHitomi(gallery, signal) {
    const readerUrl = `https://hitomi.la/reader/${gallery.id}.html`;
    const info = parseHitomiInfo(await text(`https://ltn.gold-usergeneratedcontent.net/galleries/${gallery.id}.js`, readerUrl, signal));
    if (String(info.id) !== String(gallery.id)) throw new Error('Hitomi returned metadata for another gallery.');
    const reader = createReader();
    const close = () => { if (!reader.isDestroyed()) reader.close(); };
    signal.addEventListener('abort', close, { once: true });
    const timer = setTimeout(close, 45000);
    try {
      signal.throwIfAborted();
      await reader.loadURL(readerUrl);
      let urls;
      for (let i = 0; i < 60; i++) {
        signal.throwIfAborted();
        // Execute only in the sandboxed page. Site JavaScript never enters Node.
        urls = await reader.executeJavaScript(`(() => {
          if (typeof url_from_url_from_hash !== 'function' || typeof gg === 'undefined') return null;
          const info = ${JSON.stringify(info).replace(/</g, '\\u003c')};
          return info.files.map(file => url_from_url_from_hash(info.id, file, 'webp'));
        })()`);
        if (urls?.length) break;
        await delay(500, null, { signal });
      }
      if (!urls || urls.length !== info.files.length) throw new Error('Hitomi reader could not resolve image URLs. Open the reader in the browser and retry.');
      return { title: info.title || `Hitomi ${gallery.id}`, tags: [
        ...(info.tags || []).map(t => t.tag), ...(info.artists || []).map(a => `artist:${a.artist}`),
        ...(info.language ? [`language:${info.language}`] : [])
      ], pages: urls.map(url => ({ kind: 'direct', url: imageUrl(url), referer: readerUrl })) };
    } finally { clearTimeout(timer); signal.removeEventListener('abort', close); close(); }
  }

  async function resolveImage(page, signal, attempt = 0) {
    if (page.kind === 'direct') return page;
    if (page.kind === 'mpv') {
      const raw = await text(page.api, page.referer, signal, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'imagedispatch', gid: page.gid, page: page.page, imgkey: page.imgkey, mpvkey: page.mpvkey }) });
      const data = JSON.parse(raw);
      if (!data.i) throw new Error(data.error || 'Multipage viewer returned no image.');
      const url = imageUrl(data.i);
      if (new URL(url).pathname.endsWith('/509.gif')) throw new Error('E-hentai download limit reached. Retry later.');
      return { url, referer: page.referer };
    }
    let image = parseEhImage(await text(page.url, page.url, signal), page.url);
    if (attempt && image.backup) image = parseEhImage(await text(image.backup, page.url, signal), page.url);
    return { url: image.url, referer: page.url };
  }
  return { resolveGallery, resolveImage, fetchImage: request };
}
module.exports = { createSources };
