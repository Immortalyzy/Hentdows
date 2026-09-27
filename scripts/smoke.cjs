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
  let originalsRequested = 0;
  ses.protocol.handle('https', request => {
    const url = new URL(request.url);
    let body = '<a id="gallery" href="https://e-hentai.org/g/42/key/" style="display:block;padding:30px">Fixture gallery</a>';
    let type = 'text/html';
    if (url.hostname === 'ltn.gold-usergeneratedcontent.net') { body = 'var galleryinfo = {"id":99,"title":"Hitomi fixture","files":[{"hash":"abc"}],"tags":[{"tag":"fixture"}]};'; type = 'text/javascript'; }
    else if (url.hostname === 'hitomi.la' && url.pathname.startsWith('/reader/')) body = '<script>var gg = {}; function url_from_url_from_hash() { return "https://images.example.org/page.png"; }</script>';
    else if (url.pathname.startsWith('/g/')) body = fixture;
    else if (url.pathname.startsWith('/s/')) body = '<img id="img" src="https://fixture.hath.network:50443/page.png"><a href="/fullimg.php?gid=42">Original</a>';
    else if (url.pathname === '/fullimg.php') { originalsRequested++; body = png; type = 'image/png'; }
    else if (url.pathname === '/api.php') { body = JSON.stringify({ gmetadata: [{ title: 'Fixture gallery', tags: ['artist:fixture'] }] }); type = 'application/json'; }
    else if (['images.example.org', 'fixture.hath.network'].includes(url.hostname)) { body = png; type = 'image/png'; }
    return new Response(body, { headers: { 'content-type': type } });
  });
  const { win, browser, queue, navigate } = await createApplication({ show: false, offscreen: true, dataPath: root });
  const completed=[];queue.on('complete',directory=>completed.push(structuredClone(queue.jobs.find(j=>j.directory===directory))));
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
  await until(() => completed.length===1 || queue.jobs[0]?.status === 'error');
  assert.equal(completed[0]?.status, 'complete', queue.jobs[0]?.error);
  assert.equal(completed[0].completed, 2);
  assert.equal(browser.webContents.getURL(), 'https://e-hentai.org/');
  queue.enqueue('https://exhentai.org/g/43/key/', path.join(root, 'downloads'));
  queue.enqueue('https://hitomi.la/galleries/99.html', path.join(root, 'downloads'));
  await until(() => completed.length===3 || queue.jobs.some(job=>job.status==='error'));
  for (const job of [...completed,...queue.jobs]) assert.equal(job.status, 'complete', job.error);
  assert.equal(originalsRequested, 0, 'Default downloads must not request original images');
  // A single click still navigates; Esc returns to results.
  browser.webContents.sendInputEvent({ type: 'mouseDown', x: 50, y: 40, button: 'left', clickCount: 1 });
  browser.webContents.sendInputEvent({ type: 'mouseUp', x: 50, y: 40, button: 'left', clickCount: 1 });
  await until(() => browser.webContents.getURL().includes('/g/42/key/'));
  browser.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await until(() => browser.webContents.getURL() === 'https://e-hentai.org/');
  assert.equal(await win.webContents.executeJavaScript('window.hentdows.navigate("file:///C:/Windows/win.ini").then(() => false, () => true)'), true);
  await win.webContents.executeJavaScript('window.hentdows.panel("queue")');
  await until(() => win.webContents.executeJavaScript('document.querySelector(".job") === null'));
  await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }).then(image => fs.writeFileSync(path.join(root, 'queue.png'), image.toPNG()));
  await win.webContents.executeJavaScript('document.getElementById("settings").click()');
  await until(() => win.webContents.executeJavaScript('document.getElementById("settings-panel").hidden === false'));
  assert.equal(await win.webContents.executeJavaScript('document.getElementById("setting-ehOriginal").checked'), false);
  await win.webContents.executeJavaScript('document.getElementById("setting-ehOriginal").click()');
  await until(() => JSON.parse(fs.readFileSync(path.join(root, 'settings.json'))).downloads.ehOriginal === true);
  await ses.cookies.set({ url: 'https://e-hentai.org/', name: 'ipb_member_id', value: '42' });
  queue.enqueue('https://e-hentai.org/g/44/key/', path.join(root, 'downloads'));
  await until(() => completed.length===4 || queue.jobs.at(-1)?.status==='error');
  assert.equal(completed.at(-1)?.status,'complete',queue.jobs.at(-1)?.error);
  assert.ok(originalsRequested > 0);
  await win.webContents.executeJavaScript('document.getElementById("setting-ehOriginal").click()');
  await until(() => JSON.parse(fs.readFileSync(path.join(root, 'settings.json'))).downloads.ehOriginal === false);
  await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }).then(image => fs.writeFileSync(path.join(root, 'settings.png'), image.toPNG()));
  await win.webContents.executeJavaScript('document.getElementById("setting-ehOriginal").closest("label").scrollIntoView({block:"start"})');
  await delay(100);
  await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }).then(image => fs.writeFileSync(path.join(root, 'settings-quality.png'), image.toPNG()));
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await until(() => win.webContents.executeJavaScript('document.getElementById("queue-panel").hidden === false'));
  win.setSize(390, 600); await delay(100);
  assert.equal(await win.webContents.executeJavaScript('document.documentElement.scrollWidth <= innerWidth'), true);
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify({ passed: true, checks: ['source UI', 'sandbox isolation', 'trusted double-click quick download', 'single-click navigation and Esc back', 'navigation boundary', 'E-hentai and ExHentai parsing', 'H@H port download', 'original-image opt-in through settings UI', 'settings persistence and Esc return', 'Hitomi reader JavaScript resolution', 'session image fetch', 'image files and manifest', 'queue UI', 'narrow window'], screenshots: ['sources.png', 'queue.png', 'settings.png', 'settings-quality.png'] }, null, 2));
  console.log(`Smoke test passed: ${root}`);
  win.close(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
