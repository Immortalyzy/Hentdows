const { setTimeout: delay } = require('node:timers/promises');
const { parseEhGallery, parseEhImage, parseMpv, parseHitomiInfo } = require('./parsers.cjs');
const { imageUrl, allowedNavigation } = require('./sites.cjs');
const { DEFAULT_DOWNLOADS } = require('./settings.cjs');
const { HttpError, retryAfterSeconds } = require('./http.cjs');

function createSources({ session, fetch = session.fetch.bind(session), createReader, getSettings = () => DEFAULT_DOWNLOADS, sleep = delay }) {
  let cooldownUntil = 0;
  async function request(url, referer, signal, options = {}) {
    let rateRetries = 0;
    for (let redirects = 0; redirects < 8; redirects++) {
      imageUrl(url);
      if (Date.now() < cooldownUntil) await sleep(cooldownUntil - Date.now(), null, { signal });
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(600000)]);
      const response = await fetch(url, { ...options, signal: deadline, redirect: 'manual', credentials: 'include', referrer: referer });
      if (response.status === 429 && rateRetries++ < 1) {
        const seconds = Math.max(getSettings().http429Delay, retryAfterSeconds(response.headers.get('retry-after')));
        if (!Number.isFinite(seconds) || seconds > 86400) {
          await response.body?.cancel(); throw new HttpError(429, url, response.headers.get('retry-after'));
        }
        cooldownUntil = Date.now() + seconds * 1000;
        await response.body?.cancel();
        redirects--; continue;
      }
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
    if (!response.ok) { await response.body?.cancel(); throw new HttpError(response.status, url, response.headers.get('retry-after')); }
    return response.text();
  }

  async function resolveGallery(gallery, signal, options = getSettings()) {
    if (gallery.site === 'hitomi') return resolveHitomi(gallery, signal, options);
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
    return { ...await ehMetadata(gallery, first, signal), pages };
  }

  async function ehMetadata(gallery, first, signal) {
    let metadata = { title: first.title, tags: first.tags, sizeBytes: first.sizeBytes, expectedPages: first.expectedPages };
    try {
      const raw = await text(`${new URL(gallery.url).origin}/api.php`, gallery.url, signal, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'gdata', gidlist: [[Number(gallery.id), gallery.token]], namespace: 1 })
      });
      const data = JSON.parse(raw).gmetadata?.[0];
      if (data && !data.error) metadata = { ...metadata, title: data.title || first.title, tags: data.tags || first.tags,
        thumbnail: data.thumb || null, uploadedAt: Number(data.posted) * 1000 || 0, sizeBytes: Number(data.filesize) || first.sizeBytes, expectedPages: Number(data.filecount) || first.expectedPages };
    } catch (error) { if (signal.aborted) throw error; /* HTML metadata remains usable. */ }
    return metadata;
  }

  function hitomiMetadata(info) {
    return { title: info.title || `Hitomi ${info.id}`, uploadedAt: Date.parse(info.date) || 0, expectedPages: info.files.length,
      tags: [...(info.tags || []).map(t => t.tag), ...(info.artists || []).map(a => `artist:${a.artist}`),
        ...(info.language ? [`language:${info.language}`] : [])] };
  }
  async function getMetadata(gallery, signal) {
    if (gallery.site === 'hitomi') {
      const info = parseHitomiInfo(await text(`https://ltn.gold-usergeneratedcontent.net/galleries/${gallery.id}.js`, gallery.url, signal));
      return hitomiMetadata(info);
    }
    return ehMetadata(gallery, parseEhGallery(await text(gallery.url, gallery.url, signal), gallery), signal);
  }

  async function resolveHitomi(gallery, signal, options) {
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
          return info.files.map(file => url_from_url_from_hash(info.id, file, ${options.hitomiAvif ? 'true' : 'false'} && Number(file.hasavif) === 1 ? 'avif' : 'webp'));
        })()`);
        if (urls?.length) break;
        await delay(500, null, { signal });
      }
      if (!urls || urls.length !== info.files.length) throw new Error('Hitomi reader could not resolve image URLs. Open the reader in the browser and retry.');
      return { ...hitomiMetadata(info), pages: urls.map(url => ({ kind: 'direct', url: imageUrl(url), referer: readerUrl })) };
    } finally { clearTimeout(timer); signal.removeEventListener('abort', close); close(); }
  }

  async function requireEhLogin(url) {
    const cookies = await session.cookies.get({ url });
    if (!cookies.some(c => c.name === 'ipb_member_id' && c.value !== '0')) throw new Error('Sign in before downloading E-hentai / ExHentai original images, or turn off Download hi-res pictures.');
  }
  async function resolveImage(page, signal, attempt = 0, options = getSettings()) {
    if (page.kind === 'direct') return page;
    if (page.kind === 'mpv') {
      if (options.ehOriginal) await requireEhLogin(page.referer);
      const raw = await text(page.api, page.referer, signal, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'imagedispatch', gid: page.gid, page: page.page, imgkey: page.imgkey, mpvkey: page.mpvkey }) });
      const data = JSON.parse(raw);
      if (!data.i) throw new Error(data.error || 'Multipage viewer returned no image.');
      const full = data.fullUrlRelative || data.lf;
      const url = imageUrl(options.ehOriginal && full ? new URL(full, page.referer).href : data.i);
      if (new URL(url).pathname.endsWith('/509.gif')) throw new Error('E-hentai download limit reached. Retry later.');
      return { url, referer: page.referer };
    }
    if (options.ehOriginal) await requireEhLogin(page.url);
    // Cache only within a gallery run so retries can use the fallback without
    // fetching the same expiring image page (and spending view quota) again.
    let image = page.resolved;
    if (!image) image = parseEhImage(await text(page.url, page.url, signal), page.url);
    if (attempt && image.backup) image = parseEhImage(await text(image.backup, page.url, signal), page.url);
    else if (attempt) image = parseEhImage(await text(page.url, page.url, signal), page.url);
    page.resolved = image;
    return { url: options.ehOriginal && image.original ? image.original : image.url, referer: page.url, hasBackup: Boolean(image.backup) };
  }
  return { getMetadata, resolveGallery, resolveImage, fetchImage: request };
}
module.exports = { createSources };
