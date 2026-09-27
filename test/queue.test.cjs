const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { DownloadQueue } = require('../src/queue.cjs');
const { writeJson, readJson } = require('../src/storage.cjs');

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
  await until(() => count === 2); queue.action(id, 'pause'); await until(() => !queue.active);
  assert.equal(queue.jobs[0].status, 'paused'); assert.equal(queue.jobs[0].completed, 1);
  queue.action(id, 'resume'); await until(() => !queue.active);
  assert.equal(queue.jobs[0].status, 'complete'); assert.equal(count, 3);
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
