const SITES = Object.freeze([
  { id: 'ehentai', name: 'E-hentai', url: 'https://e-hentai.org/' },
  { id: 'exhentai', name: 'ExHentai', url: 'https://exhentai.org/' },
  { id: 'hitomi', name: 'Hitomi', url: 'https://hitomi.la/' }
]);

function galleryFromUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const site = SITES.find(s => new URL(s.url).hostname === url.hostname);
    if (!site) return null;
    if (site.id !== 'hitomi') {
      const match = url.pathname.match(/^\/g\/(\d+)\/([\w-]+)\/?$/);
      return match ? { site: site.id, id: match[1], token: match[2], key: `${site.id}:${match[1]}`, url: `${site.url}g/${match[1]}/${match[2]}/` } : null;
    }
    const match = url.pathname.match(/^\/(?:galleries|reader)\/(\d+)\.html$/)
      || url.pathname.match(/^\/(?:manga|doujinshi|gamecg|cg|imageset|anime)\/[^/]+-(\d+)\.html$/);
    return match ? { site: site.id, id: match[1], key: `hitomi:${match[1]}`, url: `${site.url}galleries/${match[1]}.html` } : null;
  } catch { return null; }
}

function allowedNavigation(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port
      && ['e-hentai.org', 'exhentai.org', 'hitomi.la', 'forums.e-hentai.org', 'ehtracker.org'].includes(u.hostname);
  } catch { return false; }
}

function imageUrl(value) {
  const u = new URL(value);
  const h = u.hostname.toLowerCase();
  // E-H images can live on public H@H hosts, so an exact CDN allowlist is not possible.
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.port
      || !h.includes('.') || h.endsWith('.local') || h.endsWith('.localhost')
      || h === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':')) {
    throw new Error('The source returned an unsupported image address.');
  }
  return u.href;
}

module.exports = { SITES, galleryFromUrl, allowedNavigation, imageUrl };
