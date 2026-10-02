// Bounded, session-only caches. No generated images are written to disk.
(() => {
  const originals = new Map(), enhanced = new Map(), listeners = new Map();
  const originalLimit = 64 * 1024 ** 2, enhancedLimit = 512 * 1024 ** 2;
  let wanted = [], scale = 0, running = null, serial = 0, worker, ready = false, unavailable = '', device = '';
  const key = url => `${scale}:${url}`;
  function notify(k, value) { for (const done of listeners.get(k) || []) done(value); listeners.delete(k); }
  function trim(map, limit) {
    let bytes = [...map.values()].reduce((sum, v) => sum + (v.bytes || 0), 0);
    const rank=k=>wanted.indexOf(map===originals?k:k.slice(k.indexOf(':')+1));
    for (const [k, value] of [...map].sort(([a],[b])=>rank(b)-rank(a))) if (bytes > limit) {
      bytes -= value.bytes || 0; value.bitmap?.close(); value.cancel?.();
      map.set(k, map === enhanced ? {bytes: 0, error: 'Lookahead memory limit'} : {bytes: 0, promise: Promise.resolve(null), cancel() {}});
    }
  }
  function original(url) {
    if (originals.has(url)) return originals.get(url).promise;
    const image = new Image(), entry = {image, bytes: 0};
    entry.promise = new Promise(resolve => {
      let settled = false;
      const finish = value => {if (settled) return; settled = true; clearTimeout(timer); image.onload = image.onerror = null; resolve(value);};
      const timer = setTimeout(() => {entry.cancel();}, 15000);
      entry.cancel = () => {finish(null); image.src = '';};
      image.onload = async () => {
        try {await image.decode(); entry.bytes = image.naturalWidth * image.naturalHeight * 4; finish(image); trim(originals, originalLimit);}
        catch {finish(null);}
      };
      image.onerror = () => finish(null); image.src = url;
    });
    originals.set(url, entry); return entry.promise;
  }
  function fail(message) {
    unavailable = message; ready = false; worker?.terminate();
    if (running) {clearTimeout(running.timer); running = null;}
    for (const k of listeners.keys()) notify(k, null);
  }
  try {
    worker = new Worker('anime4k-worker.js');
    const startup = setTimeout(() => fail('GPU model startup timed out'), 30000);
    worker.onerror = () => {clearTimeout(startup); fail('GPU worker unavailable');};
    worker.onmessage = ({data}) => {
      if (data.type === 'ready') {clearTimeout(startup); ready = true; device = data.renderer; pump(); return;}
      if (data.type === 'unavailable') {clearTimeout(startup); fail(data.error); return;}
      if (!running || running.id !== data.id) {data.bitmap?.close(); return;}
      const job = running; clearTimeout(job.timer); running = null;
      if (wanted.includes(job.url) && key(job.url) === job.key) {
        const entry = {bitmap: data.bitmap, bytes: data.bitmap ? data.bitmap.width * data.bitmap.height * 4 : 0, ms: data.ms, gpuMs: data.gpuMs, error: data.error};
        enhanced.set(job.key, entry); trim(enhanced, enhancedLimit); notify(job.key, enhanced.get(job.key)?.bitmap || null);
      } else {data.bitmap?.close(); notify(job.key, null);}
      pump();
    };
  } catch {fail('GPU worker unavailable');}
  async function pump() {
    if (!ready || running || !scale) return;
    const url = wanted.find(url => !enhanced.has(key(url)));
    if (!url) return;
    const job = running = {id: ++serial, key: key(url), url, scale};
    try {
      const image = await original(url);
      if (!image || !wanted.includes(url) || key(url) !== job.key) throw new Error('Page no longer needed');
      const w = image.naturalWidth, h = image.naturalHeight;
      if (Math.max(w, h) >= 2048 || w * h * scale * scale > 40e6) throw new Error('Original retained: page exceeds scaling limit');
      const bitmap = await createImageBitmap(image);
      if (!wanted.includes(url) || key(url) !== job.key || !ready) {bitmap.close(); throw new Error('Page no longer needed');}
      job.timer = setTimeout(() => fail('GPU scaling timed out; original retained'), 15000);
      worker.postMessage({id: job.id, image: bitmap, scale: job.scale}, [bitmap]);
    } catch (error) {
      if (running !== job) return;
      running = null;
      if (wanted.includes(url) && key(url) === job.key) enhanced.set(job.key, {error: error.message, bytes: 0});
      notify(job.key, null); pump();
    }
  }
  function plan(urls, factor) {
    wanted = [...new Set(urls)].slice(0, 5); scale = factor;
    // A lookahead skipped for memory must be retried when it becomes the current page.
    if(enhanced.get(key(wanted[0]))?.error==='Lookahead memory limit')enhanced.delete(key(wanted[0]));
    for (const [url, value] of originals) if (!wanted.includes(url)) {value.cancel(); originals.delete(url);}
    for (const [k, value] of enhanced) if (!wanted.some(url => key(url) === k)) {value.bitmap?.close(); enhanced.delete(k);}
    for (const k of listeners.keys()) if (!wanted.some(url => key(url) === k)) notify(k, null);
    // Order caches by current page first, so budget eviction drops distant lookahead.
    for (const map of [originals, enhanced]) {
      const entries = wanted.map(url => [map === originals ? url : key(url), map.get(map === originals ? url : key(url))]).filter(([, v]) => v);
      map.clear(); for (const [k, v] of entries) map.set(k, v);
    }
    wanted.forEach(url => {void original(url);}); pump();
  }
  window.readerImages = {
    plan,
    clear: () => plan([], 0),
    get(url) {
      if (!scale || unavailable || !wanted.includes(url)) return Promise.resolve(null);
      const k = key(url);
      if (enhanced.has(k)) return Promise.resolve(enhanced.get(k).bitmap || null);
      return new Promise(resolve => {const list = listeners.get(k) || []; list.push(resolve); listeners.set(k, list); pump();});
    },
    get status() {return {ready, unavailable, device, running: running?.url, originals: [...originals.keys()], enhanced: [...enhanced].map(([key, v]) => ({key, width: v.bitmap?.width, height: v.bitmap?.height, ms: v.ms, gpuMs: v.gpuMs, error: v.error})), originalBytes: [...originals.values()].reduce((s, v) => s + v.bytes, 0), enhancedBytes: [...enhanced.values()].reduce((s, v) => s + v.bytes, 0)};}
  };
})();
