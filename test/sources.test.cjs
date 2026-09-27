const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSources } = require('../src/sources.cjs');
const { galleryFromUrl } = require('../src/sites.cjs');

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
