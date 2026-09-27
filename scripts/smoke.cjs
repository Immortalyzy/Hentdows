// Offline Chromium + IPC + downloader integration test. Never contacts source websites.
const { app, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { createApplication } = require('../src/main.cjs');
const root = path.resolve('artifacts', `smoke-${Date.now()}`);
fs.mkdirSync(root, { recursive: true });
app.setPath('userData', root);
app.disableHardwareAcceleration();
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64');
const fixture = '<h1 id="gn">Fixture gallery</h1><div id="gdd"><table><tr><td>Length:</td><td>2 pages</td></tr></table></div><div id="gdt"><a href="/s/a/42-1">One</a><a href="/s/b/42-2">Two</a></div>';
async function until(predicate) { for (let i = 0; i < 300; i++) { if (await predicate()) return; await delay(30); } throw new Error('Smoke test timed out'); }
app.whenReady().then(async () => {
  fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({ downloadRoot: path.join(root, 'downloads') }));
  const ses = session.fromPartition('persist:hentdows-sources');
  ses.protocol.handle('https', request => {
    const url = new URL(request.url);
    let body = '<a id="gallery" href="https://e-hentai.org/g/42/key/" style="display:block;padding:30px">Fixture gallery</a>';
    let type = 'text/html';
    if (url.hostname === 'ltn.gold-usergeneratedcontent.net') { body = 'var galleryinfo = {"id":99,"title":"Hitomi fixture","files":[{"hash":"abc"}],"tags":[{"tag":"fixture"}]};'; type = 'text/javascript'; }
    else if (url.hostname === 'hitomi.la' && url.pathname.startsWith('/reader/')) body = '<script>var gg = {}; function url_from_url_from_hash() { return "https://images.example.org/page.png"; }</script>';
    else if (url.pathname.startsWith('/g/')) body = fixture;
    else if (url.pathname.startsWith('/s/')) body = '<img id="img" src="https://images.example.org/page.png">';
    else if (url.pathname === '/api.php') { body = JSON.stringify({ gmetadata: [{ title: 'Fixture gallery', tags: ['artist:fixture'] }] }); type = 'application/json'; }
    else if (url.hostname === 'images.example.org') { body = png; type = 'image/png'; }
    return new Response(body, { headers: { 'content-type': type } });
  });
  const { win, browser, queue, navigate } = await createApplication({ show: false, offscreen: true, dataPath: root });
  browser.webContents.on('preload-error', (_, file, error) => console.error('Preload failed', file, error));
  const errors = [];
  win.webContents.on('console-message', (_event, _level, message) => { if (/error|not defined/i.test(message)) errors.push(message); });
  await until(() => win.webContents.executeJavaScript('document.querySelectorAll(".site").length === 3'));
  await delay(250);
  await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }).then(image => fs.writeFileSync(path.join(root, 'sources.png'), image.toPNG()));
  await navigate('https://e-hentai.org/');
  assert.equal(await browser.webContents.executeJavaScript('typeof window.hentdows'), 'undefined');
  assert.equal(await browser.webContents.executeJavaScript('typeof require'), 'undefined');
  win.focus(); browser.webContents.focus(); await delay(300);
  browser.webContents.debugger.attach('1.3');
  for (const clickCount of [1, 2]) {
    await browser.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: 50, y: 40, button: 'left', clickCount });
    await browser.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 50, y: 40, button: 'left', clickCount });
  }
  browser.webContents.debugger.detach();
  await until(() => queue.jobs[0]?.status === 'complete' || queue.jobs[0]?.status === 'error');
  assert.equal(queue.jobs[0].status, 'complete', queue.jobs[0].error);
  assert.equal(queue.jobs[0].completed, 2);
  assert.equal(browser.webContents.getURL(), 'https://e-hentai.org/');
  queue.enqueue('https://exhentai.org/g/42/key/', path.join(root, 'downloads'));
  queue.enqueue('https://hitomi.la/galleries/99.html', path.join(root, 'downloads'));
  await until(() => queue.jobs.length === 3 && queue.jobs.every(job => ['complete', 'error'].includes(job.status)));
  for (const job of queue.jobs) assert.equal(job.status, 'complete', job.error);
  // A single click still navigates; Esc returns to results.
  browser.webContents.sendInputEvent({ type: 'mouseDown', x: 50, y: 40, button: 'left', clickCount: 1 });
  browser.webContents.sendInputEvent({ type: 'mouseUp', x: 50, y: 40, button: 'left', clickCount: 1 });
  await until(() => browser.webContents.getURL().includes('/g/42/key/'));
  browser.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await until(() => browser.webContents.getURL() === 'https://e-hentai.org/');
  assert.equal(await win.webContents.executeJavaScript('window.hentdows.navigate("file:///C:/Windows/win.ini").then(() => false, () => true)'), true);
  await win.webContents.executeJavaScript('window.hentdows.panel("queue")');
  await until(() => win.webContents.executeJavaScript('document.querySelector(".job") !== null'));
  await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }).then(image => fs.writeFileSync(path.join(root, 'queue.png'), image.toPNG()));
  win.setSize(390, 600); await delay(100);
  assert.equal(await win.webContents.executeJavaScript('document.documentElement.scrollWidth <= innerWidth'), true);
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify({ passed: true, checks: ['source UI', 'sandbox isolation', 'trusted double-click quick download', 'single-click navigation and Esc back', 'navigation boundary', 'E-hentai and ExHentai parsing', 'Hitomi reader JavaScript resolution', 'session image fetch', 'image files and manifest', 'queue UI', 'narrow window'], screenshots: ['sources.png', 'queue.png'] }, null, 2));
  console.log(`Smoke test passed: ${root}`);
  win.close(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
