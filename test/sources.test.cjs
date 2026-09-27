const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSources } = require('../src/sources.cjs');
const { galleryFromUrl } = require('../src/sites.cjs');
const { DEFAULT_DOWNLOADS } = require('../src/settings.cjs');

test('source adapter reads all thumbnail pages and retains namespaced API tags', async () => {
  const calls = [];
  const session = { fetch: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/api.php')) return new Response(JSON.stringify({ gmetadata: [{ title: 'API title', tags: ['language:english'] }] }));
    const page = new URL(url).searchParams.get('p') === '1' ? 2 : 1;
    return new Response(`<h1 id="gn">HTML title</h1><div id="gdd"><table><tr><td>Length:</td><td>2 pages</td></tr></table></div><div id="gdt"><a href="/s/key/42-${page}">page</a></div><table class="ptt"><tr><td><a href="?p=1">2</a></td></tr></table>`);
  } };
  const sources = createSources({ session });
  const result = await sources.resolveGallery(galleryFromUrl('https://e-hentai.org/g/42/token/'), new AbortController().signal);
  assert.equal(result.pages.length, 2); assert.equal(result.title, 'API title');
  assert.deepEqual(result.tags, ['language:english']);
  assert.equal(calls.every(c => c.options.credentials === 'include'), true);
  assert.deepEqual(JSON.parse(calls.at(-1).options.body).gidlist, [[42, 'token']]);
});

test('displayed-image default accepts H@H ports and never selects the original URL', async () => {
  const sources = createSources({ session: { fetch: async () => new Response('<img id="img" src="https://fixture.hath.network:50443/AbC.jpg"><a href="/fullimg.php?gid=42">Original</a>'), cookies: { get: async () => [{ name: 'ipb_member_id', value: '42' }] } } });
  const page = { kind: 'eh', url: 'https://e-hentai.org/s/a/42-1' }, signal = new AbortController().signal;
  const normal = await sources.resolveImage(page, signal);
  assert.equal(normal.url, 'https://fixture.hath.network:50443/AbC.jpg');
  const original = await sources.resolveImage(page, signal, 0, { ...DEFAULT_DOWNLOADS, ehOriginal: true });
  assert.equal(original.url, 'https://e-hentai.org/fullimg.php?gid=42');
});

test('original MPV images require login and use the original link only when enabled', async () => {
  let loggedIn = false;
  const sources = createSources({ session: { fetch: async () => new Response(JSON.stringify({ i: 'https://fixture.hath.network:10443/page.jpg', lf: '/fullimg.php?gid=42' })), cookies: { get: async () => loggedIn ? [{ name: 'ipb_member_id', value: '42' }] : [] } } });
  const page = { kind: 'mpv', api: 'https://e-hentai.org/api.php', referer: 'https://e-hentai.org/mpv/42/key' }, signal = new AbortController().signal;
  assert.match((await sources.resolveImage(page, signal)).url, /hath.network:10443/);
  await assert.rejects(sources.resolveImage(page, signal, 0, { ...DEFAULT_DOWNLOADS, ehOriginal: true }), /Sign in/);
  loggedIn = true;
  assert.match((await sources.resolveImage(page, signal, 0, { ...DEFAULT_DOWNLOADS, ehOriginal: true })).url, /fullimg/);
});

test('source fallback does not fetch the original page again', async () => {
  const calls = [];
  const sources = createSources({ session: { fetch: async url => { calls.push(url); return new Response('<img id="img" src="https://images.example.org/page.jpg"><a id="loadfail" onclick="return nl(\'backup\')"></a>'); } } });
  const page = { kind: 'eh', url: 'https://e-hentai.org/s/a/42-1' }, signal = new AbortController().signal;
  await sources.resolveImage(page, signal); await sources.resolveImage(page, signal, 1);
  assert.deepEqual(calls, [page.url, `${page.url}?nl=backup`]);
});

test('Hitomi AVIF preference uses AVIF only on files that provide it', async () => {
  const script = 'var galleryinfo = {"id":42,"files":[{"hasavif":1},{"hasavif":0}]};';
  const sources = createSources({ session: { fetch: async () => new Response(script) }, createReader: () => ({
    loadURL: async () => {}, isDestroyed: () => false, close: () => {},
    executeJavaScript: async code => structuredClone(require('node:vm').runInNewContext(code, { gg: {}, url_from_url_from_hash: (_, file, type) => `https://images.example.org/${file.hasavif}.${type}` }))
  }) });
  const gallery = galleryFromUrl('https://hitomi.la/galleries/42.html'), signal = new AbortController().signal;
  const normal = await sources.resolveGallery(gallery, signal);
  assert.equal(normal.pages.every(p => p.url.endsWith('.webp')), true);
  const avif = await sources.resolveGallery(gallery, signal, { ...DEFAULT_DOWNLOADS, hitomiAvif: true });
  assert.deepEqual(avif.pages.map(p => p.url.split('.').at(-1)), ['avif', 'webp']);
});

test('HTTP 429 waits for the configured delay before retrying', async () => {
  const waits = []; let calls = 0;
  const sources = createSources({ getSettings: () => ({ ...DEFAULT_DOWNLOADS, http429Delay: 10 }), sleep: async ms => waits.push(ms),
    session: { fetch: async () => ++calls === 1 ? new Response(null, { status: 429, headers: { 'retry-after': '20' } }) : new Response('ok') } });
  const response = await sources.fetchImage('https://images.example.org/page', 'https://e-hentai.org/', new AbortController().signal);
  assert.equal(response.status, 200); assert.equal(calls, 2); assert.ok(waits[0] > 19000 && waits[0] <= 20000);
});

test('incomplete galleries fail instead of producing partial completed books', async () => {
  const sources = createSources({ session: { fetch: async () => new Response('<h1 id="gn">Incomplete</h1><div id="gdd"><table><tr><td>Length:</td><td>20 pages</td></tr></table></div><div id="gdt"><a href="/s/a/42-1">page</a></div>') } });
  await assert.rejects(sources.resolveGallery(galleryFromUrl('https://exhentai.org/g/42/token/'), new AbortController().signal), /Found 1 of 20/);
});

test('image redirects cannot switch to local files or loop indefinitely', async () => {
  const sources = createSources({ session: { fetch: async () => new Response(null, { status: 302, headers: { location: 'file:///C:/Windows/win.ini' } }) } });
  await assert.rejects(sources.fetchImage('https://images.example.org/page', 'https://e-hentai.org/', new AbortController().signal), /unsupported image address/);
  let count = 0;
  const looping = createSources({ session: { fetch: async () => { count++; return new Response(null, { status: 302, headers: { location: '/again' } }); } } });
  await assert.rejects(looping.fetchImage('https://images.example.org/page', 'https://e-hentai.org/', new AbortController().signal), /too many/);
  assert.equal(count, 8);
});
