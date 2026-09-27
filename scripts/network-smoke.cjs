// Real Chromium networking against an offline HTTP server; no protocol mocks.
const { app, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createSessionFetch } = require('../src/session-fetch.cjs');
const { createSources } = require('../src/sources.cjs');
const { saveResponse, SpeedLimiter } = require('../src/transfer.cjs');
const root = path.resolve('artifacts', `network-smoke-${Date.now()}`);
fs.mkdirSync(root, { recursive: true });
app.setPath('userData', root);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('host-resolver-rules', 'MAP fixture.hath.network 127.0.0.1');
const payload = Buffer.alloc(512 * 1024, 73);
let imageRequests = 0, slowClosed = 0;
const server = http.createServer((req, res) => {
  if (req.url === '/headers') { res.end(JSON.stringify(req.headers)); return; }
  if (req.url.startsWith('/redirect')) {
    const location = req.url === '/redirect-file' ? 'file:///C:/Windows/win.ini'
      : req.url === '/redirect-private' ? `http://127.0.0.1:${server.address().port}/image`
      : req.url === '/redirect-loop' ? '/redirect-loop' : '/image';
    res.writeHead(302, { location }); res.end(); return;
  }
  if (req.url === '/slow' || req.url === '/wait') {
    const timer = setInterval(() => { if (req.url === '/slow') res.write(Buffer.alloc(1024)); }, 20);
    res.on('close', () => { clearInterval(timer); slowClosed++; }); return;
  }
  if (req.url === '/truncated') {
    res.writeHead(200, { 'content-length': 100000 }); res.write('partial');
    setTimeout(() => res.destroy(), 100); return;
  }
  imageRequests++;
  res.writeHead(200, { 'content-type': 'image/png', 'content-length': payload.length }); res.end(payload);
});
app.whenReady().then(async () => {
  const watchdog = setTimeout(() => { console.error('Network smoke timed out'); app.exit(1); }, 30000);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const ses = session.fromPartition('network-smoke');
  await ses.setProxy({ mode: 'direct' });
  const base = `http://fixture.hath.network:${server.address().port}`;
  const fetch = createSessionFetch(ses);
  const sources = createSources({ session: ses, fetch });
  const signal = AbortSignal.timeout(15000);
  const headers = referrer => fetch(`${base}/headers`, { referrer, signal }).then(res => res.json());
  await ses.cookies.set({ url: base, name: 'fixture', value: 'signed-in' });
  assert.equal((await headers('http://gallery.example.org/s/private-key')).referer, 'http://gallery.example.org/');
  assert.equal((await headers('https://gallery.example.org/s/private-key')).referer, undefined);
  assert.equal((await headers(`${base}/s/key#fragment`)).referer, `${base}/s/key`);
  assert.equal((await headers(base)).cookie, 'fixture=signed-in');
  console.log('Referrers and cookies passed');

  const redirect = await fetch(`${base}/redirect`, { signal });
  assert.equal(redirect.status, 302);
  assert.equal(imageRequests, 0, 'Transport must expose redirects before contacting their destination');
  const response = await sources.fetchImage(`${base}/redirect`, 'http://gallery.example.org/s/key', signal);
  const filename = path.join(root, 'stream.png');
  await saveResponse(response, filename, signal, new SpeedLimiter(() => 0));
  assert.deepEqual(fs.readFileSync(filename), payload);
  assert.equal(imageRequests, 1);
  await assert.rejects(sources.fetchImage(`${base}/redirect-file`, base, signal), /unsupported image address/);
  await assert.rejects(sources.fetchImage(`${base}/redirect-private`, base, signal), /unsupported image address/);
  await assert.rejects(sources.fetchImage(`${base}/redirect-loop`, base, signal), /too many/);
  await assert.rejects(sources.fetchImage(`${base}/redirect`, base, signal, { method: 'POST', body: '{}' }), /Unexpected API redirect/);
  assert.equal(imageRequests, 1, 'Rejected redirects must not reach image endpoint');
  console.log('Streaming and redirects passed');

  const waiting = new AbortController();
  const waitingTimer = setTimeout(() => waiting.abort(new Error('timeout')), 100);
  await assert.rejects(fetch(`${base}/wait`, { signal: waiting.signal }), /timeout/i);
  clearTimeout(waitingTimer);
  console.log('Pre-response cancellation passed');
  await assert.rejects(fetch(`${base}/wait`, { signal: AbortSignal.timeout(100) }), /timeout/i);
  await assert.rejects(fetch(`${base}/image`, { signal: AbortSignal.abort() }), /abort/i);
  const aborter = new AbortController();
  const streaming = await fetch(`${base}/slow`, { signal: aborter.signal });
  const reading = streaming.arrayBuffer();
  aborter.abort(); await assert.rejects(reading, /abort/i);
  console.log('Mid-response cancellation passed');
  const cancelable = await fetch(`${base}/slow`, { signal });
  await cancelable.body.cancel();
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(slowClosed, 4, 'Abort and body cancellation must close the server connection');
  console.log('Body cancellation passed');
  const partial = await fetch(`${base}/truncated`, { signal });
  await assert.rejects(saveResponse(partial, path.join(root, 'broken.png'), signal, new SpeedLimiter(() => 0)));
  assert.equal(fs.existsSync(path.join(root, 'broken.png.part')), false);
  console.log('Network smoke passed: referrers, cookies, redirects, streaming, cancellation, truncated responses.');
  clearTimeout(watchdog);
  server.closeAllConnections(); server.close(); app.quit();
}).catch(error => { console.error(error); server.closeAllConnections(); server.close(); app.exit(1); });
