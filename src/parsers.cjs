// Ported from Hentoid's EHentaiParser and HitomiParser (Apache-2.0); see NOTICE.
const { load } = require('cheerio');
const { galleryFromUrl, imageUrl } = require('./sites.cjs');

function parseEhGallery(html, gallery) {
  const $ = load(html);
  const title = $('#gn').text().trim() || $('#gj').text().trim();
  if (!title) throw new Error('Gallery unavailable. Check login, access restrictions, or the site challenge in the browser.');
  const pages = [];
  $('#gdt a[href], .gdtm a[href], .gdtl a[href]').each((_, el) => {
    const url = new URL($(el).attr('href'), gallery.url);
    if (url.origin === new URL(gallery.url).origin && /^\/s\/[\w-]+\/\d+-\d+$/.test(url.pathname)) pages.push(url.href);
  });
  let lastPage = 0;
  $('table.ptt a[href]').each((_, el) => {
    const u = new URL($(el).attr('href'), gallery.url);
    if (galleryFromUrl(u.href)?.key === gallery.key) lastPage = Math.max(lastPage, Number(u.searchParams.get('p')) || 0);
  });
  if (lastPage > 5000) throw new Error('Gallery pagination exceeds the supported limit.');
  const length = $('#gdd tr').filter((_, el) => $(el).text().includes('Length:')).text().match(/(\d+)\s+pages/);
  const tags = $('#taglist a').map((_, el) => $(el).text().trim()).get();
  const mpv = $('#gmid a[href*="/mpv/"]').attr('href');
  return { title, tags, expectedPages: length ? Number(length[1]) : null, pages: [...new Set(pages)], lastPage,
    mpv: mpv ? new URL(mpv, gallery.url).href : null };
}

function parseEhImage(html, pageUrl) {
  const $ = load(html);
  const source = $('img#img, #i3.img, #i3 img').first().attr('src');
  if (!source) throw new Error('Image unavailable. Check login or the site challenge in the browser.');
  const url = imageUrl(new URL(source, pageUrl).href);
  if (new URL(url).pathname.endsWith('/509.gif')) throw new Error('E-hentai download limit reached. Pause and retry after your points regenerate.');
  const token = ($('#loadfail').attr('onclick') || '').match(/nl\(['"]([^'"]+)['"]\)/)?.[1];
  const backup = new URL(pageUrl);
  if (token) backup.searchParams.set('nl', token);
  return { url, backup: token ? backup.href : null };
}

function parseMpv(html, baseUrl) {
  const $ = load(html);
  const scripts = $('script').map((_, e) => $(e).html()).get().join('\n');
  const read = name => scripts.match(new RegExp(`(?:var|let|const)\\s+${name}\\s*=\\s*([^;]+);`))?.[1];
  try {
    const gid = Number(read('gid'));
    const key = JSON.parse(read('mpvkey'));
    const images = JSON.parse(read('imagelist'));
    const api = new URL(JSON.parse(read('api_url')), baseUrl).href;
    if (!gid || !key || !Array.isArray(images) || new URL(api).origin !== new URL(baseUrl).origin) throw Error();
    return images.map((img, index) => ({ api, gid, imgkey: img.k, mpvkey: key, page: index + 1 }));
  } catch { throw new Error('Could not read the multipage viewer. Switch to the classic gallery view and retry.'); }
}

function parseHitomiInfo(script) {
  const first = script.indexOf('{'), last = script.lastIndexOf('}');
  if (first < 0 || last < first) throw new Error('Hitomi returned no gallery metadata.');
  const info = JSON.parse(script.slice(first, last + 1));
  if (!info.id || !Array.isArray(info.files) || !info.files.length) throw new Error('Hitomi returned an empty gallery.');
  return info;
}

module.exports = { parseEhGallery, parseEhImage, parseMpv, parseHitomiInfo };
