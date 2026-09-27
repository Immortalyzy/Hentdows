const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { DownloadQueue } = require('../src/queue.cjs');
const { writeJson, readJson } = require('../src/storage.cjs');
const { DEFAULT_DOWNLOADS } = require('../src/settings.cjs');

function setup(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hentdows-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const queue = new DownloadQueue({ file: path.join(root, 'queue.json'),
    resolveGallery: async () => ({ title: 'A / title', tags: ['artist:test'], pages: [0, 1] }),
    resolveImage: async n => ({ url: `https://images.example.org/${n}.png` }),
    fetchImage: async () => new Response(Buffer.from('fixture-image'), { headers: { 'content-type': 'image/png' } }), ...overrides });
  return { queue, root };
}
async function until(predicate) {
  for (let i = 0; i < 500; i++) { if (predicate()) return; await delay(10); }
  throw new Error('Timed out waiting for the queue.');
}

test('streams ordered images and manifest; deduplicates galleries', async t => {
  const { queue, root } = setup(t);
  const id = queue.enqueue('https://e-hentai.org/g/42/key/', root);
  assert.equal(queue.enqueue('https://e-hentai.org/g/42/key/?p=1', root), id);
  await until(() => !queue.active);
  const job = queue.jobs[0]; assert.equal(job.status, 'complete'); assert.equal(job.completed, 2);
  const manifest = readJson(path.join(job.directory, 'content.json'));
  assert.deepEqual(manifest.files.map(f => f.name), ['00001.png', '00002.png']);
  assert.equal(manifest.title, 'A / title'); assert.equal(manifest.status, 'complete');
  assert.equal(fs.readdirSync(job.directory).some(n => n.endsWith('.part')), false);
});

test('pause aborts an active transfer; resume keeps completed pages', async t => {
  let count = 0;
  const { queue, root } = setup(t, { fetchImage: async (_, __, signal) => {
    if (++count === 2) await delay(10000, null, { signal });
    return new Response('image', { headers: { 'content-type': 'image/jpeg' } });
  } });
  const id = queue.enqueue('https://exhentai.org/g/42/key/', root);
  await until(() => count === 2 && queue.jobs[0].completed === 1); queue.action(id, 'pause'); await until(() => !queue.active);
  assert.equal(queue.jobs[0].status, 'paused'); assert.equal(queue.jobs[0].completed, 1);
  queue.action(id, 'resume'); await until(() => !queue.active);
  assert.equal(queue.jobs[0].status, 'complete'); assert.equal(count, 3);
});

test('autostart off holds jobs and top insertion changes actual processing order', async t => {
  const order = [];
  const { queue, root } = setup(t, { getSettings: () => ({ ...DEFAULT_DOWNLOADS, autoStart: false, newPosition: 'top' }), resolveGallery: async gallery => { order.push(gallery.id); return { title: gallery.id, pages: [0] }; } });
  queue.enqueue('https://e-hentai.org/g/1/key/', root); queue.enqueue('https://e-hentai.org/g/2/key/', root);
  await delay(20); assert.equal(queue.active, null); assert.deepEqual(order, []);
  queue.startAll(); await until(() => queue.jobs.every(j => j.status === 'complete'));
  assert.deepEqual(order, ['2', '1']);
  await until(() => !queue.running);
  queue.enqueue('https://e-hentai.org/g/3/key/', root); await delay(20);
  assert.equal(queue.active, null); assert.deepEqual(order, ['2', '1']);
});

test('transfer failure waits for concurrent partial-file cleanup before reporting error', async t => {
  const { queue, root } = setup(t, { getSettings: () => ({ ...DEFAULT_DOWNLOADS, parallel: 2 }), fetchImage: async url => {
    if (url.endsWith('/0.png')) { await delay(30); return new Response(null, { status: 500 }); }
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1024)); } }), { headers: { 'content-type': 'image/png' } });
  } });
  queue.enqueue('https://e-hentai.org/g/1/key/', root); await until(() => !queue.active);
  assert.equal(queue.jobs[0].status, 'error');
  assert.equal(fs.readdirSync(queue.jobs[0].directory).some(name => name.endsWith('.part')), false);
});

test('size threshold stops oversized transfers and removes incomplete pages', async t => {
  const { queue, root } = setup(t, { getSettings: () => ({ ...DEFAULT_DOWNLOADS, skipLarge: true, maxSizeMB: 0.001 }), fetchImage: async () => new Response(new Uint8Array(10240), { headers: { 'content-type': 'image/png' } }) });
  queue.enqueue('https://e-hentai.org/g/1/key/', root); await until(() => !queue.active);
  assert.match(queue.jobs[0].error, /size threshold/); assert.equal(queue.jobs[0].completed, 0);
  assert.equal(fs.readdirSync(queue.jobs[0].directory).some(name => name.endsWith('.part')), false);
});

test('schedule and Wi-Fi gates resume waiting jobs only when both conditions allow', async t => {
  let hour = 12, wifi = false;
  const { queue, root } = setup(t, { getSettings: () => ({ ...DEFAULT_DOWNLOADS, scheduleEnabled: true, scheduleStart: '23:00', scheduleEnd: '06:00', wifiOnly: true }), now: () => new Date(2026, 8, 27, hour), network: async () => ({ online: true, wifi }) });
  queue.enqueue('https://e-hentai.org/g/1/key/', root); await until(() => !queue.active);
  assert.match(queue.jobs[0].waitReason, /scheduled/);
  hour = 23; await queue.tick(); await until(() => !queue.active); assert.match(queue.jobs[0].waitReason, /Wi-Fi/);
  wifi = true; await queue.tick(); await until(() => !queue.active); assert.equal(queue.jobs[0].status, 'complete');
});

test('tag policies reject, queue as error, or require a second explicit request', async t => {
  let behaviour = 'reject';
  const { queue, root } = setup(t, { getSettings: () => ({ ...DEFAULT_DOWNLOADS, blockedTags: 'artist:test', blockedBehaviour: behaviour }), getMetadata: async () => ({ title: 'blocked', tags: ['artist:test'] }) });
  await assert.rejects(queue.add('https://e-hentai.org/g/1/key/', root), /was not queued/); assert.equal(queue.jobs.length, 0);
  behaviour = 'error'; await queue.add('https://e-hentai.org/g/2/key/', root); assert.equal(queue.jobs[0].status, 'error');
  behaviour = 'confirm'; await assert.rejects(queue.add('https://e-hentai.org/g/3/key/', root), /again/);
  await queue.add('https://e-hentai.org/g/3/key/', root); await until(() => !queue.active);
  assert.equal(queue.jobs[1].status, 'complete');
});

test('large-gallery page policy can be overridden on Wi-Fi', async t => {
  let wifi = false, transfers = 0;
  const { queue, root } = setup(t, { getSettings: () => ({ ...DEFAULT_DOWNLOADS, skipLarge: true, maxPages: 1, largeOnWifi: true }), network: async () => ({ online: true, wifi }), fetchImage: async () => { transfers++; return new Response('image', { headers: { 'content-type': 'image/png' } }); } });
  const id = queue.enqueue('https://e-hentai.org/g/1/key/', root); await until(() => !queue.active);
  assert.equal(transfers, 0); assert.match(queue.jobs[0].error, /Skipped large/);
  wifi = true; queue.action(id, 'resume'); await until(() => !queue.active); assert.equal(queue.jobs[0].status, 'complete');
});

test('404 policies distinguish errors, marked placeholder images, and omitted pages', async t => {
  for (const mode of ['error', 'placeholder', 'ignore']) {
    const { queue, root } = setup(t, { getSettings: () => ({ ...DEFAULT_DOWNLOADS, http404: mode }), fetchImage: async () => new Response(null, { status: 404 }) });
    queue.enqueue('https://e-hentai.org/g/1/key/', root); await until(() => !queue.active);
    const job = queue.jobs[0];
    assert.equal(job.status, mode === 'error' ? 'error' : 'complete');
    if (mode !== 'error') assert.equal(job.files.every(f => mode === 'ignore' ? f.ignored && !f.name : f.placeholder && fs.existsSync(path.join(job.directory, f.name))), true);
  }
});

test('retry preference controls retry count; quota failures are not retried', async t => {
  let attempts = 0, retry = false, status = 500;
  const { queue, root } = setup(t, { getSettings: () => ({ ...DEFAULT_DOWNLOADS, retriesEnabled: retry, retryCount: 2 }), sleep: async () => {}, resolveGallery: async () => ({ title: 'one', pages: [0] }), fetchImage: async () => { attempts++; return new Response(null, { status }); } });
  const id = queue.enqueue('https://e-hentai.org/g/1/key/', root); await until(() => !queue.active);
  assert.equal(attempts, 1);
  retry = true; queue.action(id, 'resume'); await until(() => !queue.active); assert.equal(attempts, 4);
  status = 509; queue.action(id, 'resume'); await until(() => !queue.active); assert.equal(attempts, 5);
});

test('parallel workers honor configured concurrency', async t => {
  let simultaneous = 0, peak = 0;
  const { queue, root } = setup(t, { getSettings: () => ({ ...DEFAULT_DOWNLOADS, parallel: 2 }), resolveGallery: async () => ({ title: 'many', pages: [0, 1, 2, 3, 4] }), fetchImage: async (_, __, signal) => {
    simultaneous++; peak = Math.max(peak, simultaneous); await delay(20, null, { signal }); simultaneous--;
    return new Response('image', { headers: { 'content-type': 'image/png' } });
  } });
  queue.enqueue('https://e-hentai.org/g/1/key/', root); await until(() => !queue.active); assert.equal(peak, 2); assert.equal(queue.jobs[0].completed, 5);
});

test('thumbnail preference stores a separate file or references page one', async t => {
  for (const separateThumbnail of [true, false]) {
    const { queue, root } = setup(t, { getSettings: () => ({ ...DEFAULT_DOWNLOADS, separateThumbnail }) });
    queue.enqueue('https://e-hentai.org/g/1/key/', root); await until(() => !queue.active);
    const job = queue.jobs[0], manifest = readJson(path.join(job.directory, 'content.json'));
    assert.equal(manifest.thumbnail, separateThumbnail ? 'thumbnail.png' : '00001.png');
    assert.ok(fs.existsSync(path.join(job.directory, manifest.thumbnail)));
  }
});

test('HTTP failures remain retryable and do not create complete books', async t => {
  const { queue, root } = setup(t, { fetchImage: async () => new Response('limited', { status: 429 }) });
  queue.enqueue('https://e-hentai.org/g/42/key/', root); await until(() => !queue.active);
  assert.equal(queue.jobs[0].status, 'error'); assert.match(queue.jobs[0].error, /429/); assert.equal(queue.jobs[0].completed, 0);
});

test('restart pauses unfinished work and refuses corrupt queue data', t => {
  const { queue } = setup(t);
  writeJson(queue.file, [{ status: 'downloading' }, { status: 'queued' }, { status: 'complete' }]);
  const restored = new DownloadQueue({ file: queue.file });
  assert.deepEqual(restored.jobs.map(j => j.status), ['paused', 'paused', 'complete']);
  fs.writeFileSync(queue.file, 'corrupted'); assert.throws(() => new DownloadQueue({ file: queue.file }), /preserved/);
});

test('queue reorder, freeze, resume and completed archival preserve processing rules',async t=>{
  const order=[];const {queue,root}=setup(t,{getSettings:()=>({...DEFAULT_DOWNLOADS,autoStart:false}),resolveGallery:async g=>{order.push(g.sourceId);return {title:g.sourceId,pages:[0]};}});
  const ids=[1,2,3].map(i=>queue.enqueue('https://e-hentai.org/g/'+i+'/key/',root));
  assert.equal(queue.enqueue('https://exhentai.org/g/1/key/',root),ids[0]);
  await queue.bulk('order',[ids[2],ids[0],ids[1]]);assert.deepEqual(queue.jobs.map(j=>j.id),[ids[2],ids[0],ids[1]]);
  await queue.bulk('freeze',[ids[2]]);queue.startAll();await until(()=>queue.jobs.filter(j=>j.status==='complete').length===2);
  assert.deepEqual(order,['1','2']);assert.equal(queue.jobs[0].status,'frozen');
  queue.archiveCompleted(queue.jobs.filter(j=>j.status==='complete').map(j=>j.directory));assert.equal(queue.jobs.length,1);
  await queue.bulk('unfreeze',[ids[2]]);queue.startAll();await until(()=>queue.jobs[0].status==='complete');assert.deepEqual(order,['1','2','3']);
  queue.close();
});
test('removing active downloads settles writers and retains completed files',async t=>{
  let count=0;const {queue,root}=setup(t,{getSettings:()=>({...DEFAULT_DOWNLOADS,parallel:2}),fetchImage:async(_,__,signal)=>{if(++count===2)await delay(10000,null,{signal});return new Response('image',{headers:{'content-type':'image/png'}});}});
  const id=queue.enqueue('https://e-hentai.org/g/42/key/',root);await until(()=>queue.jobs[0].completed===1);const directory=queue.jobs[0].directory;
  await queue.bulk('remove',[id]);assert.equal(queue.jobs.length,0);assert.equal(queue.active,null);assert.ok(fs.existsSync(path.join(directory,'00001.png')));assert.ok(!fs.readdirSync(directory).some(n=>n.endsWith('.part')));queue.close();
});
test('data limit pauses transfers without reporting errors and can be reset',async t=>{
  const {queue,root}=setup(t,{getSettings:()=>({...DEFAULT_DOWNLOADS,parallel:2}),fetchImage:async()=>new Response(Buffer.alloc(2*1024**2),{headers:{'content-type':'image/png'}})});
  queue.setLimit(1);queue.enqueue('https://e-hentai.org/g/42/key/',root);await until(()=>queue.jobs[0].status==='waiting'&&!queue.active);
  assert.equal(queue.jobs[0].error,null);assert.ok(queue.transferred>=1024**2);
  queue.setLimit(0);await queue.tick();await until(()=>queue.jobs[0].status==='complete');queue.close();
});
