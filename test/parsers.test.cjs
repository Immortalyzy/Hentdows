const { test } = require('node:test');
const assert = require('node:assert/strict');
const { galleryFromUrl, allowedNavigation, imageUrl } = require('../src/sites.cjs');
const { parseEhGallery, parseEhImage, parseMpv, parseHitomiInfo } = require('../src/parsers.cjs');

test('canonical gallery identities include source and ignore pagination/fragments', () => {
  assert.equal(galleryFromUrl('https://e-hentai.org/g/123/token/?p=2').key, 'ehentai:123');
  assert.equal(galleryFromUrl('https://exhentai.org/g/123/token/').key, 'exhentai:123');
  for (const path of ['/galleries/123.html', '/reader/123.html#4', '/manga/fixture-123.html']) {
    assert.equal(galleryFromUrl(`https://hitomi.la${path}`).url, 'https://hitomi.la/galleries/123.html');
  }
  for (const url of ['https://e-hentai.org.evil.test/g/1/a/', 'file:///g/1/a/', 'https://user@e-hentai.org/g/1/a/', 'https://hitomi.la/search.html']) assert.equal(galleryFromUrl(url), null);
  assert.equal(allowedNavigation('https://forums.e-hentai.org/index.php?act=Login'), true);
  assert.equal(allowedNavigation('javascript:alert(1)'), false);
  assert.throws(() => imageUrl('http://127.0.0.1/x'));
});

test('classic galleries retain order, deduplicate thumbnails, and discover pagination', () => {
  const gallery = galleryFromUrl('https://e-hentai.org/g/123/token/');
  const parsed = parseEhGallery(`<h1 id="gn">Test &amp; title</h1><div id="gdd"><table><tr><td>Length:</td><td>2 pages</td></tr></table></div>
    <div id="gdt"><a href="/s/abc/123-1"></a><a href="/s/abc/123-1"></a><a href="/s/def/123-2"></a></div>
    <table class="ptt"><tr><td><a href="?p=0">1</a><a href="?p=2">3</a><a href="https://evil.test/?p=9000">x</a></td></tr></table>`, gallery);
  assert.equal(parsed.title, 'Test & title'); assert.equal(parsed.expectedPages, 2); assert.equal(parsed.lastPage, 2);
  assert.deepEqual(parsed.pages, ['https://e-hentai.org/s/abc/123-1', 'https://e-hentai.org/s/def/123-2']);
  assert.throws(() => parseEhGallery('<h1>Please log in</h1>', gallery), /Check login/);
});

test('image parser preserves URL case, detects limits, and supplies the fallback page', () => {
  const page = 'https://exhentai.org/s/abc/1-1';
  const parsed = parseEhImage(`<img id="img" src="https://images.example.org/AbC.jpg?Token=Hi"><a id="loadfail" onclick="return nl('backup')"></a>`, page);
  assert.equal(parsed.url, 'https://images.example.org/AbC.jpg?Token=Hi');
  assert.equal(parsed.backup, `${page}?nl=backup`);
  assert.throws(() => parseEhImage('<img id="img" src="https://images.example.org/509.gif">', page), /limit reached/);
});

test('MPV and Hitomi metadata are parsed as data, without executing source code', () => {
  const pages = parseMpv('<script>var gid = 42; var mpvkey = "key"; var api_url = "/api.php"; var imagelist = [{"k":"a","n":"1"}];</script>', 'https://exhentai.org/');
  assert.equal(pages[0].imgkey, 'a'); assert.equal(pages[0].page, 1);
  assert.equal(parseHitomiInfo('var galleryinfo = {"id":42,"files":[{"hash":"abc"}]};').id, 42);
  assert.throws(() => parseHitomiInfo('var galleryinfo = {"id":42,"files":process.exit()};'));
});
