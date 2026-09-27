const { app, BrowserWindow, WebContentsView, session, ipcMain, dialog, shell, Menu, protocol, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const { SITES, galleryFromUrl, allowedNavigation } = require('./sites.cjs');
const { readJson, writeJson } = require('./storage.cjs');
const { DownloadQueue } = require('./queue.cjs');
const { createSources } = require('./sources.cjs');
const { createSessionFetch } = require('./session-fetch.cjs');
const { SETTINGS, validateDownloads } = require('./settings.cjs');
const { createNetworkProbe } = require('./network.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'hentdows', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

async function createApplication({ show = true, offscreen = false, dataPath = app.getPath('userData'), sourceFactory = createSources, networkProbe } = {}) {
  fs.mkdirSync(dataPath, { recursive: true });
  const settingsFile = path.join(dataPath, 'settings.json');
  const settings = readJson(settingsFile, { downloadRoot: path.join(app.getPath('downloads'), 'Hentdows') });
  settings.downloads = validateDownloads(settings.downloads || {});
  const getSettings = () => settings.downloads;
  if (!(await protocol.isProtocolHandled('hentdows'))) {
    protocol.handle('hentdows', request => {
      const url = new URL(request.url);
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (url.hostname !== 'app' || !['index.html', 'style.css', 'renderer.js'].includes(name)) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(path.join(__dirname, 'ui', name)).href);
    });
  }
  const win = new BrowserWindow({ width: 520, height: 940, minWidth: 380, minHeight: 560, show,
    title: 'Hentdows', backgroundColor: '#212121', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, offscreen } });
  Menu.setApplicationMenu(null);
  const browserSession = session.fromPartition('persist:hentdows-sources');
  browserSession.setPermissionRequestHandler((_, __, callback) => callback(false));
  browserSession.setPermissionCheckHandler(() => false);
  browserSession.on('will-download', event => event.preventDefault());
  for (const site of SITES.filter(s => s.id !== 'hitomi')) {
    for (const [name, value] of [['sl', 'dm_2'], ['nw', '1']]) {
      if (!(await browserSession.cookies.get({ url: site.url, name })).length) {
        await browserSession.cookies.set({ url: site.url, name, value, expirationDate: Date.now() / 1000 + 31536000 });
      }
    }
  }
  const remotePreferences = { session: browserSession, sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen };
  const browser = new WebContentsView({ webPreferences: { ...remotePreferences, preload: path.join(__dirname, 'browser-preload.cjs') } });
  win.contentView.addChildView(browser);
  let panel = 'sources', settingsReturnPanel = 'sources', error = '', notice = '', quitting = false;
  const sources = sourceFactory({ session: browserSession, fetch: createSessionFetch(browserSession), getSettings, createReader: () => {
    const view = new WebContentsView({ webPreferences: remotePreferences });
    guard(view.webContents); return view.webContents;
  } });
  const probe = networkProbe || createNetworkProbe(() => net.isOnline());
  const queue = new DownloadQueue({ file: path.join(dataPath, 'queue.json'), ...sources, getSettings,
    network: needWifi => needWifi ? probe() : Promise.resolve({ online: offscreen || net.isOnline(), wifi: null }) });
  const policyTimer = setInterval(() => queue.tick().catch(e => { error = e.message; publish(); }), 15000);
  const wc = browser.webContents;
  function guard(contents) {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    for (const name of ['will-navigate', 'will-redirect']) contents.on(name, (event, url) => {
      if (!allowedNavigation(url)) event.preventDefault();
    });
  }
  guard(wc);
  wc.setWindowOpenHandler(({ url }) => {
    if (allowedNavigation(url)) void navigate(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  function layout() {
    const [width, height] = win.getContentSize();
    browser.setBounds({ x: 0, y: 100, width, height: Math.max(0, height - 154) });
    browser.setVisible(panel === 'browser');
  }
  function state() {
    const url = wc.isDestroyed() ? '' : wc.getURL();
    return { sites: SITES, panel, url, gallery: galleryFromUrl(url), downloadRoot: settings.downloadRoot,
      downloadSettings: settings.downloads, settingsSchema: SETTINGS, queueRunning: queue.running,
      jobs: queue.snapshot(), error, notice, loading: !wc.isDestroyed() && wc.isLoading(),
      canBack: !wc.isDestroyed() && wc.navigationHistory.canGoBack(), canForward: !wc.isDestroyed() && wc.navigationHistory.canGoForward() };
  }
  function publish() { if (!win.isDestroyed()) win.webContents.send('app:changed', state()); }
  async function navigate(url) {
    if (typeof url !== 'string' || !allowedNavigation(url)) throw new Error('Use an HTTPS address from a supported source or its login forum.');
    panel = 'browser'; error = ''; notice = ''; layout(); publish();
    try { await wc.loadURL(url); } catch (e) { if (e.code !== 'ERR_ABORTED') { error = e.message; publish(); } }
  }
  function back() {
    if (panel === 'settings') panel = settingsReturnPanel;
    else if (panel !== 'browser') panel = wc.getURL() ? 'browser' : 'sources';
    else if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else panel = 'sources';
    layout(); publish();
  }
  async function enqueue(url) {
    let position = settings.downloads.newPosition;
    if (position === 'ask') {
      const result = await dialog.showMessageBox(win, { type: 'question', title: 'New downloads position', message: 'Where should this gallery be added?', buttons: ['Top', 'Bottom', 'Cancel'], defaultId: 1, cancelId: 2 });
      if (result.response === 2) return null;
      position = result.response === 0 ? 'top' : 'bottom';
    }
    const id = await queue.add(url, settings.downloadRoot, position);
    notice = 'Gallery is in the download queue.'; error = ''; publish(); return id;
  }
  for (const contents of [wc, win.webContents]) contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'Escape' || (input.alt && input.key === 'ArrowLeft')) { event.preventDefault(); back(); }
  });
  wc.on('did-fail-load', (_, code, description, url, mainFrame) => { if (mainFrame && code !== -3) { error = `${description}. Check your connection or login.`; publish(); } });
  for (const event of ['did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading', 'page-title-updated']) wc.on(event, publish);
  queue.on('change', publish);
  queue.on('problem', message => { error = message; publish(); });
  win.on('resize', layout);
  const handlers = {
    'app:state': () => state(),
    'app:navigate': (_, url) => navigate(url),
    'app:panel': (_, value) => {
      if (!['sources', 'browser', 'queue', 'settings'].includes(value)) throw new Error('Unknown panel.');
      if (value === 'settings' && panel !== 'settings') settingsReturnPanel = panel;
      panel = value === 'browser' && !wc.getURL() ? 'sources' : value; layout(); publish();
    },
    'app:save-settings': async (_, patch) => {
      const updated = validateDownloads(patch, settings.downloads);
      writeJson(settingsFile, { ...settings, downloads: updated });
      settings.downloads = updated; notice = 'Download settings saved.'; error = ''; publish();
      await queue.tick(); return updated;
    },
    'app:command': (_, command) => {
      if (command === 'back') back();
      else if (command === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
      else if (command === 'reload') wc.reload();
      else if (command === 'pause-all') queue.pauseAll();
      else if (command === 'start-all') queue.startAll();
      else if (command === 'login') return navigate('https://forums.e-hentai.org/index.php?act=Login&CODE=00');
    },
    'app:enqueue': () => enqueue(wc.getURL()),
    'app:queue-action': (_, id, action) => {
      if (!['pause', 'resume', 'cancel'].includes(action) || typeof id !== 'string') throw new Error('Invalid download action.');
      queue.action(id, action);
    },
    'app:choose-folder': async () => {
      const result = await dialog.showOpenDialog(win, { defaultPath: settings.downloadRoot, properties: ['openDirectory', 'createDirectory'] });
      if (!result.canceled) { settings.downloadRoot = result.filePaths[0]; writeJson(settingsFile, settings); publish(); }
    },
    'app:open-folder': async (_, id) => {
      const job = queue.jobs.find(j => j.id === id);
      if (!job || !fs.existsSync(job.directory)) throw new Error('No files have been saved for this download yet.');
      const result = await shell.openPath(job.directory); if (result) throw new Error(result);
    }
  };
  for (const [name, handler] of Object.entries(handlers)) ipcMain.handle(name, (event, ...args) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || !event.senderFrame.url.startsWith('hentdows://app/')) throw new Error('Untrusted request.');
    return handler(event, ...args);
  });
  const remoteHandlers = [];
  for (const [name, action] of [['browser:open-link', navigate], ['browser:download-link', enqueue]]) {
    const handler = (event, url) => {
      if (event.sender !== wc || event.senderFrame !== wc.mainFrame || !allowedNavigation(event.senderFrame.url) || !galleryFromUrl(url)) return;
      Promise.resolve().then(() => action(url)).catch(e => { error = e.message; publish(); });
    };
    ipcMain.on(name, handler); remoteHandlers.push([name, handler]);
  }
  win.on('close', () => {
    if (quitting) return; quitting = true;
    clearInterval(policyTimer); queue.close();
    for (const name of Object.keys(handlers)) ipcMain.removeHandler(name);
    for (const [name, handler] of remoteHandlers) ipcMain.removeListener(name, handler);
    if (!wc.isDestroyed()) wc.close();
  });
  await win.loadURL('hentdows://app/');
  layout(); publish();
  return { win, browser, queue, state, navigate };
}

if (require.main === module) {
  if (!app.requestSingleInstanceLock()) app.quit();
  else {
    let mainWindow;
    app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
    app.whenReady().then(() => createApplication()).then(({ win }) => { mainWindow = win; }).catch(error => { dialog.showErrorBox('Hentdows could not start', error.message); app.quit(); });
    app.on('window-all-closed', () => app.quit());
  }
}
module.exports = { createApplication };
