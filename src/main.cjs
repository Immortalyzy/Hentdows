const { app, BrowserWindow, WebContentsView, session, ipcMain, dialog, shell, Menu, protocol, net, powerSaveBlocker, nativeTheme } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const { SITES, galleryFromUrl, allowedNavigation } = require('./sites.cjs');
const { readJson, writeJson } = require('./storage.cjs');
const { DownloadQueue } = require('./queue.cjs');
const { createSources } = require('./sources.cjs');
const { createSessionFetch } = require('./session-fetch.cjs');
const { SETTINGS, validateDownloads, blockedTags } = require('./settings.cjs');
const {BrowserState,BROWSER_SETTINGS,validateBrowser,siteFor,languageUrl}=require('./browser-state.cjs');
const {saveResponse,imageExtension}=require('./transfer.cjs');
const { createNetworkProbe } = require('./network.cjs');
const { LIBRARY_SETTINGS, VIEWER_SETTINGS, validatePreferences } = require('./reading-settings.cjs');
const { createDuplicateChecker } = require('./download-check.cjs');
const { identity } = require('./duplicates.cjs');
const { Library } = require('./library.cjs');
const { deleteBookFolder } = require('./delete-book.cjs');
const { imageAnimation } = require('./image-animation.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'hentdows', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

async function createApplication({ show = true, offscreen = false, dataPath = app.getPath('userData'), sourceFactory = createSources, networkProbe } = {}) {
  fs.mkdirSync(dataPath, { recursive: true });
  const settingsFile = path.join(dataPath, 'settings.json');
  const settings = readJson(settingsFile, { downloadRoot: path.join(app.getPath('downloads'), 'Hentdows') });
  settings.downloads = validateDownloads(settings.downloads || {});
  settings.library = validatePreferences('library', settings.library || {});
  settings.viewer = validatePreferences('viewer', settings.viewer || {});
  settings.browser=validateBrowser(settings.browser||{});
  const browsing=new BrowserState(path.join(dataPath,'browser.json'));let browserRevision=0,restoreScroll=null;
  let awakeId;
  const stopAwake = () => { if (awakeId !== undefined) powerSaveBlocker.stop(awakeId); awakeId = undefined; };
  const getSettings = () => settings.downloads;
  const library = new Library(path.join(dataPath, 'library.sqlite'));
  let libraryRevision = 0, libraryScan = { running: false, checked: 0, added: 0, errors: [] };
  if (!(await protocol.isProtocolHandled('hentdows'))) {
    protocol.handle('hentdows', async request => {
      const url = new URL(request.url);
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (url.hostname !== 'app') return new Response('Not found', { status: 404 });
      const queueAsset=/^queue\/([a-f0-9-]+)\/cover$/.exec(name);
      if(queueAsset){
        const job=queue.jobs.find(j=>j.id===queueAsset[1]);if(!job||!SITES.some(site=>site.id===job.site))return new Response('Not found',{status:404});
        const first=job.files.find(f=>!f.ignored&&f.name&&path.basename(f.name)===f.name);
        if(first){try{const base=fs.realpathSync(job.directory),file=fs.realpathSync(path.join(base,first.name));if(path.dirname(file)===base)return net.fetch(pathToFileURL(file).href);}catch{}}
        if(job.thumbnailUrl){try{const cover=await checkDuplicate.loadCover(job.thumbnailUrl,job.url,AbortSignal.timeout(15000));if(cover)return new Response(cover.data,{headers:{'content-type':cover.type}});}catch{}}
        return net.fetch(pathToFileURL(path.join(__dirname,'assets','missing-'+job.site+'.png')).href);
      }
      const asset = /^library\/(\d+)\/(cover|\d+)$/.exec(name);
      if (asset) {
        try {
          const file = await library.call('asset', { id: Number(asset[1]), page: asset[2] === 'cover' ? 'cover' : Number(asset[2]) });
          if (url.searchParams.get('animation') === '1') return Response.json(await imageAnimation(file));
          return net.fetch(pathToFileURL(file).href);
        }
        catch { return new Response('Image unavailable', { status: 404 }); }
      }
      if (!['index.html', 'style.css', 'renderer.js', 'library-ui.js', 'library.css', 'reader.js', 'reader.css', 'reader-images.js', 'anime4k-worker.js', 'vendor/Anime4K_Upscale_CNN_x2_S.glsl', 'virtual-list.js', 'queue-ui.js', 'queue.css','browser-ui.js','browser.css'].includes(name)) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(path.join(__dirname, 'ui', name)).href);
    });
  }
  const win = new BrowserWindow({ width: 520, height: 940, minWidth: 380, minHeight: 560, show,
    title: 'Hentdows', backgroundColor: '#212121', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, offscreen } });
  win.webContents.on('render-process-gone', stopAwake);
  Menu.setApplicationMenu(null);
  const browserSession = session.fromPartition('persist:hentdows-sources');
  browserSession.setPermissionRequestHandler((_, __, callback) => callback(false));
  browserSession.setPermissionCheckHandler(() => false);
  browserSession.on('will-download', event => event.preventDefault());
  async function configureBrowser(value){
    const servers={cloudflare:'https://cloudflare-dns.com/dns-query',quad9:'https://dns.quad9.net/dns-query',adguard:'https://dns.adguard-dns.com/dns-query'};
    app.configureHostResolver(value.dns==='system'?{enableBuiltInResolver:false,secureDnsMode:'automatic',secureDnsServers:[]}:{enableBuiltInResolver:true,secureDnsMode:'secure',secureDnsServers:[servers[value.dns]]});
    await browserSession.setProxy(value.proxy?{mode:'fixed_servers',proxyRules:value.proxy}:{mode:'system'});
    nativeTheme.themeSource=value.forceLight?'light':'dark';
  }
  await configureBrowser(settings.browser);
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
  let panel = 'library', settingsReturnPanel = 'library', error = '', notice = '', quitting = false;
  const sources = sourceFactory({ session: browserSession, fetch: createSessionFetch(browserSession), getSettings, createReader: () => {
    const view = new WebContentsView({ webPreferences: remotePreferences });
    guard(view.webContents); return view.webContents;
  } });
  const probe = networkProbe || createNetworkProbe(() => net.isOnline());
  const queue = new DownloadQueue({ file: path.join(dataPath, 'queue.json'), ...sources, getSettings,
    network: needWifi => needWifi ? probe() : Promise.resolve({ online: offscreen || net.isOnline(), wifi: null }) });
  const checkDuplicate=createDuplicateChecker({library,queue,sources,file:path.join(dataPath,'cover-hashes.json'),getSettings});
  let addChain=Promise.resolve(),browserSaveChain=Promise.resolve();const pendingEnqueues=new Map();
  const policyTimer = setInterval(() => queue.tick().catch(e => { error = e.message; publish(); }), 15000);
  const wc = browser.webContents;
  browserSession.webRequest.onBeforeRequest({urls:['https://*/*']},(details,callback)=>{
    // Hentoid's explicit Hitomi script blacklist; never intercept image transfers or hidden source readers.
    const blocked=settings.browser.augmented&&details.webContentsId===wc.id&&details.resourceType==='script'&&siteFor(wc.getURL())==='hitomi'&&/(?:hitomi-horizontal|hitomi-vertical|invoke)\.js$|\/ion\.sound(?:\.min)?\.js$/.test(new URL(details.url).pathname);
    callback({cancel:blocked});
  });
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
    const url = wc.isDestroyed()||!allowedNavigation(wc.getURL()) ? '' : wc.getURL();
    return { sites: SITES, panel, url, gallery: galleryFromUrl(url), downloadRoot: settings.downloadRoot,
      browserSettings:{...settings.downloads,...settings.browser},browserSchema:[...BROWSER_SETTINGS,...SETTINGS.filter(f=>f.key.startsWith('duplicate'))],browserRevision,
      bookmarked:browsing.data.bookmarks.some(b=>b.url===url),canReopen:Boolean(browsing.reopen()),languageUrl:settings.browser.languageFilter?languageUrl(url,settings.browser.language):null,
      librarySettings: settings.library, viewerSettings: settings.viewer, librarySchema: LIBRARY_SETTINGS, viewerSchema: VIEWER_SETTINGS,
      downloadSettings: settings.downloads, settingsSchema: SETTINGS, queueRunning: queue.running,
      jobs: queue.jobs.filter(j=>!['complete','cancelled'].includes(j.status)).map(({files,...job})=>({...job,bytes:files.reduce((s,f)=>s+f.bytes,0)})), queueStats:queue.stats(), error, notice, loading: !wc.isDestroyed() && wc.isLoading(),
      libraryRevision, libraryScan,
      canBack: !wc.isDestroyed() && wc.navigationHistory.canGoBack(), canForward: !wc.isDestroyed() && wc.navigationHistory.canGoForward() };
  }
  function publish() { if (!win.isDestroyed()) win.webContents.send('app:changed', state()); }
  async function navigate(url,scroll=null) {
    if (typeof url !== 'string' || !allowedNavigation(url)) throw new Error('Use an HTTPS address from a supported source or its login forum.');
    restoreScroll=scroll;panel = 'browser'; error = ''; notice = ''; layout(); publish();
    try { await wc.loadURL(url); } catch (e) { if (e.code !== 'ERR_ABORTED') { error = e.message; publish(); } }
  }
  function back() {
    if(panel==='bookmarks'||panel==='storage'){win.webContents.send('browser:back');return;}
    if (panel === 'queue') { win.webContents.send('queue:back'); return; }
    if (panel === 'library') { win.webContents.send('library:back'); return; }
    if (panel === 'settings') panel = settingsReturnPanel;
    else if (panel !== 'browser') panel = allowedNavigation(wc.getURL()) ? 'browser' : 'sources';
    else if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else panel = 'sources';
    layout(); publish();
  }
  function enqueue(url) {
    const gallery=galleryFromUrl(url);if(!gallery)return Promise.reject(new Error('Open a supported gallery before downloading.'));
    const key=identity(gallery.site,gallery.id);if(pendingEnqueues.has(key))return pendingEnqueues.get(key);
    const request=addChain.then(()=>prepareDownload(gallery));addChain=request.catch(()=>{});
    pendingEnqueues.set(key,request);request.finally(()=>pendingEnqueues.delete(key)).catch(()=>{});return request;
  }
  async function prepareDownload(gallery) {
    if(queue.closed)throw new Error('The download queue is closing.');
    const existing=queue.jobs.find(j=>identity(j.site,j.sourceId)===identity(gallery.site,gallery.id)&&j.status!=='cancelled');
    const feedback=(status,message,id)=>{notice=message;error='';publish();win.webContents.send('app:download-feedback',{status,message});return {status,message,id};};
    if(existing)return feedback('duplicate',existing.status==='complete'?'Already downloaded.':'Already in the download queue.',existing.id);
    const stored=await library.call('findSource',{site:gallery.site,sourceId:gallery.id});
    if(stored&&fs.existsSync(stored.path))return feedback('duplicate','This book is already in your library.',stored.id);
    const controller=new AbortController();queue.pendingAdds.add(controller);
    try{
      const metadata=await sources.getMetadata(gallery,controller.signal);controller.signal.throwIfAborted();
      const duplicate=await checkDuplicate(gallery,metadata,controller.signal);controller.signal.throwIfAborted();
      if(duplicate){
        const result=await dialog.showMessageBox(win,{type:'question',title:'Possible duplicate',message:'A similar book is already '+(duplicate.queue?'in the queue.':'in your library.'),detail:duplicate.title+'\n'+duplicate.pages+' saved pages · '+(metadata.expectedPages||'?')+' online pages\nSimilarity: '+Math.round(duplicate.similarity*100)+'%\nDownload this gallery as a separate book?',buttons:['Cancel','Download anyway',duplicate.queue?'Show queue':'Show existing book'],defaultId:0,cancelId:0});
        if(result.response===2){panel=duplicate.queue?'queue':'library';layout();publish();if(!duplicate.queue)win.webContents.send('library:open',duplicate.id);return feedback('duplicate','Showing the existing book.');}
        if(result.response!==1)return feedback('cancelled','Download cancelled.');
      }
      let position=settings.downloads.newPosition;
      if(position==='ask'){
        const result=await dialog.showMessageBox(win,{type:'question',title:'New downloads position',message:'Where should this gallery be added?',buttons:['Top','Bottom','Cancel'],defaultId:1,cancelId:2});
        if(result.response===2)return feedback('cancelled','Download cancelled.');position=result.response===0?'top':'bottom';
      }
      controller.signal.throwIfAborted();
      const id=await queue.add(gallery.url,settings.downloadRoot,position,metadata);
      const queued=queue.jobs.find(j=>j.id===id);
      return feedback(queued?.status==='error'?'error':'queued',queued?.status==='error'?'Added to Errors: '+queued.error:'Added to the download queue.',id);
    }finally{queue.pendingAdds.delete(controller);}
  }
  for (const contents of [wc, win.webContents]) contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if(input.control&&input.key.toLowerCase()==='b'&&!settings.browser.lockBookmarks){event.preventDefault();panel=panel==='bookmarks'?(allowedNavigation(wc.getURL())?'browser':'sources'):'bookmarks';layout();publish();return;}
    if (input.key === 'Escape' || (input.alt && input.key === 'ArrowLeft')) { event.preventDefault(); back(); }
  });
  wc.on('did-fail-load', (_, code, description, url, mainFrame) => { if (mainFrame && code !== -3) { error = `${description}. Check your connection or login.`; publish(); } });
  for (const event of ['did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading', 'page-title-updated']) wc.on(event, publish);
  function rememberPage(){const url=wc.getURL();const previous=browsing.data.last[siteFor(url)];browsing.remember(url,wc.getTitle(),previous?.url===url?previous.scroll:0);browserRevision++;publish();}
  function sendBrowserOptions(){if(!wc.isDestroyed())wc.send('browser:options',{...settings.browser,blockedTags:settings.downloads.blockedTags});}
  wc.on('did-navigate',rememberPage);wc.on('did-navigate-in-page',rememberPage);wc.on('page-title-updated',rememberPage);
  wc.on('dom-ready',()=>{sendBrowserOptions();if(restoreScroll!==null){wc.send('browser:restore-scroll',restoreScroll);restoreScroll=null;}});
  queue.on('change', ()=>{publish();sendBrowserOptions();});
  queue.on('problem', message => { error = message; publish(); });
  const libraryChanged = () => { libraryRevision++; publish();sendBrowserOptions(); };
  library.on('problem', message => { error = message; publish(); });
  library.on('scan', scan => { libraryScan = scan; if (!scan.running) libraryRevision++; publish(); });
  queue.on('complete', directory => {
    library.call('addRoot', path.dirname(path.dirname(directory))).then(() => library.call('index', directory)).then(async () => {
      libraryChanged(); queue.archiveCompleted(await library.call('indexed', queue.jobs.filter(j => j.status === 'complete').map(j => j.directory)));
    }).catch(e => { error = `Library: ${e.message}`; publish(); });
  });
  win.on('resize', layout);
  function showAllBooks(){panel='library';layout();publish();win.webContents.send('library:all');}
  async function attachLibraryFolder(hentoid=false){
    if(libraryScan.running)throw new Error('Wait for the current library refresh to finish before importing.');
    const result=await dialog.showOpenDialog(win,{title:hentoid?'Import a Hentoid .Hentoid folder':'Add a Hentdows or Hentoid library location',properties:['openDirectory','createDirectory']});
    if(result.canceled)return;
    if(libraryScan.running)throw new Error('Wait for the current library refresh to finish before importing.');
    await library.call('addRoot',result.filePaths[0]);const scan=await library.call('scan');
    notice=`Library refreshed: ${scan.added} added or updated, ${scan.skipped} unchanged or skipped${scan.errors.length?', '+scan.errors.length+' issue(s) — see the library refresh report':''}.`;
    if(!scan.checked&&!scan.errors.length)notice='No supported books found. Select the .Hentoid folder containing book folders with JSON metadata and image files.';
    libraryChanged();showAllBooks();return scan;
  }
  const handlers = {
    'app:state': () => state(),
    'app:navigate': (_, url) => navigate(url),
    'app:panel': (_, value) => {
      if (!['sources', 'browser', 'queue', 'settings', 'library','bookmarks','storage'].includes(value)) throw new Error('Unknown panel.');
      if (value === 'settings' && panel !== 'settings') settingsReturnPanel = panel;
      panel = value === 'browser' && !allowedNavigation(wc.getURL()) ? 'sources' : value; layout(); publish();
    },
    'app:save-preferences': (_, section, patch) => {
      const updated = validatePreferences(section, patch, settings[section]);
      writeJson(settingsFile, { ...settings, [section]: updated }); settings[section] = updated;
      if (section === 'viewer' && !updated.keepAwake) stopAwake();
      notice = 'Preferences saved.'; error = ''; publish(); return updated;
    },
    'app:save-browser':(_,patch)=>{
      const save=browserSaveChain.then(async()=>{
      const updated=validateBrowser(patch,settings.browser),previous=settings.browser;
      try{if(updated.proxy!==previous.proxy||updated.dns!==previous.dns||updated.forceLight!==previous.forceLight)await configureBrowser(updated);writeJson(settingsFile,{...settings,browser:updated});}
      catch(e){await configureBrowser(previous);throw e;}
      settings.browser=updated;sendBrowserOptions();if(updated.forceLight!==previous.forceLight&&allowedNavigation(wc.getURL()))wc.reload();notice='Browser preferences saved.';error='';publish();return updated;
      });browserSaveChain=save.catch(()=>{});return save;
    },
    'app:browser':async(_,action,input)=>{
      if(action==='list')return browsing.snapshot();
      if(action==='source'){const entry=browsing.start(input,settings.browser.resumeLast);return navigate(entry.url,entry.scroll);}
      if(action==='reopen'){const entry=browsing.reopen();if(entry)return navigate(entry.url,entry.scroll);return;}
      if(action==='close'){rememberPage();browsing.closePage(wc.getURL());await wc.loadURL('about:blank');panel='sources';layout();publish();return;}
      if(action==='add-current'){if(!siteFor(wc.getURL()))throw new Error('Open a source page first.');input={url:wc.getURL(),title:wc.getTitle()};action='save';}
      if(action==='export'){
        const result=await dialog.showSaveDialog(win,{title:'Export bookmarks',defaultPath:'hentdows-bookmarks.json',filters:[{name:'Bookmarks',extensions:['json']}]});
        if(!result.canceled)writeJson(result.filePath,{schemaVersion:1,bookmarks:browsing.data.bookmarks});return;
      }
      if(action==='import'){
        const result=await dialog.showOpenDialog(win,{title:'Import Hentdows bookmarks',properties:['openFile'],filters:[{name:'Bookmarks',extensions:['json']}]});if(result.canceled)return;
        const file=result.filePaths[0];if(fs.statSync(file).size>10*1024**2)throw new Error('Bookmark file is too large.');const data=readJson(file,{});input=Array.isArray(data)?data:data.bookmarks;
      }
      if(action==='clear-cookies'||action==='clear-cache'){
        const choice=await dialog.showMessageBox(win,{type:'question',message:action==='clear-cookies'?'Clear browser cookies and sign out of all sources?':'Clear cached browser images and files?',detail:action==='clear-cookies'?'Bookmarks, downloads and library data are kept.':'Cookies and logins are kept.',buttons:['Cancel','Clear'],defaultId:0,cancelId:0});if(choice.response!==1)return;
        if(action==='clear-cookies')await browserSession.clearStorageData({storages:['cookies']});else await browserSession.clearCache();notice='Browser '+(action==='clear-cookies'?'cookies':'cache')+' cleared.';publish();return;
      }
      const result=browsing.mutate(action,input);browserRevision++;publish();return result;
    },
    'app:storage':async(_,action,id)=>{
      if(action==='list')return {defaultPath:settings.downloadRoot,locations:await library.call('storage')};
      if(action==='add'||action==='import-hentoid')return attachLibraryFolder(action==='import-hentoid');
      if(action==='show-all'){showAllBooks();return;}
      const root=(await library.call('roots')).find(r=>r.id===id);if(!root)throw new Error('Storage location not found.');
      const contains=directory=>{const rel=path.relative(root.path,path.resolve(directory));return !rel||rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);};
      if(action==='default'){
        fs.accessSync(root.path,fs.constants.W_OK);settings.downloadRoot=root.path;writeJson(settingsFile,settings);notice='New downloads will use this location. Existing jobs keep their destination.';publish();return;
      }
      if(action==='open'){const result=await shell.openPath(root.path);if(result)throw new Error(result);return;}
      if(!['remove','reconnect'].includes(action))throw new Error('Unknown storage action.');
      if(queue.jobs.some(j=>j.status!=='cancelled'&&contains(j.directory)))throw new Error('Finish or remove this location’s queued downloads first.');
      if(action==='remove'){
        if(contains(settings.downloadRoot))throw new Error('Choose another default download location first.');
        const result=await dialog.showMessageBox(win,{type:'warning',message:'Remove this location from the library?',detail:root.path+'\nImage files are kept. Indexed metadata, ratings and reading progress for its books will be removed. You can back up metadata from the Library menu first.',buttons:['Cancel','Remove location'],defaultId:0,cancelId:0});if(result.response!==1)return;
        await library.call('removeRoot',id);
      }else{
        const selected=await dialog.showOpenDialog(win,{title:'Reconnect the same library folder at its new location',properties:['openDirectory']});if(selected.canceled)return;
        const result=await dialog.showMessageBox(win,{type:'question',message:'Reconnect this library location?',detail:root.path+'\n→ '+selected.filePaths[0]+'\nChoose the same folder on its new drive. Files are not moved. Book metadata and reading progress are retained.',buttons:['Cancel','Reconnect'],defaultId:0,cancelId:0});if(result.response!==1)return;
        const wasDefault=contains(settings.downloadRoot),relative=path.relative(root.path,settings.downloadRoot);
        const updated=await library.call('relocateRoot',{id,directory:selected.filePaths[0]});if(wasDefault){settings.downloadRoot=path.join(updated,relative);writeJson(settingsFile,settings);}await library.call('scan');
      }
      libraryChanged();
    },
    'app:reader-active': (_, active) => {
      if (typeof active !== 'boolean') throw new Error('Invalid reader state.');
      stopAwake(); if (active && settings.viewer.keepAwake) awakeId = powerSaveBlocker.start('prevent-display-sleep');
    },
    'app:save-settings': async (_, patch) => {
      const updated = validateDownloads(patch, settings.downloads);
      writeJson(settingsFile, { ...settings, downloads: updated });
      settings.downloads = updated; notice = 'Download settings saved.'; error = ''; publish();sendBrowserOptions();
      await queue.tick(); return updated;
    },
    'app:command': (_, command) => {
      if (command === 'leave-queue'||command==='browser-back') { panel=allowedNavigation(wc.getURL())?'browser':'sources';layout();publish(); }
      else if (command === 'back') back();
      else if (command === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
      else if (command === 'reload') wc.reload();
      else if (command === 'pause-all') queue.pauseAll();
      else if (command === 'start-all') queue.startAll();
      else if (command === 'login') return navigate('https://forums.e-hentai.org/index.php?act=Login&CODE=00');
    },
    'app:enqueue': () => enqueue(wc.getURL()),
    'app:queue-action': (_, id, action) => {
      if (!['pause', 'resume', 'cancel', 'freeze', 'unfreeze'].includes(action) || typeof id !== 'string') throw new Error('Invalid download action.');
      queue.action(id, action);
    },
    'app:queue-bulk': async (_, action, ids) => {
      if(action==='limit'){queue.setLimit(ids);await queue.tick();return;}
      if(action==='restart'){
        const choice=await dialog.showMessageBox(win,{type:'warning',message:'Download selected books from the beginning?',detail:'Their downloaded pages will be replaced as the download progresses.',buttons:['Cancel','Restart downloads'],defaultId:0,cancelId:0});if(choice.response!==1)return;
      }
      return queue.bulk(action,ids);
    },
    'app:queue-import': async (_, text) => {
      if(typeof text!=='string'||text.length>200000)throw new Error('Paste up to 1000 gallery URLs.');
      const urls=[...new Set(text.split(/\s+/).filter(Boolean))];if(urls.length>1000||urls.some(url=>!galleryFromUrl(url)))throw new Error('Use one supported gallery URL per line (maximum 1000).');
      const results=[];for(const url of urls){try{results.push(await enqueue(url));}catch(e){results.push({status:'error',message:e.message});}}return results;
    },
    'app:choose-folder': async () => {
      const result = await dialog.showOpenDialog(win, { defaultPath: settings.downloadRoot, properties: ['openDirectory', 'createDirectory'] });
      if (!result.canceled) { settings.downloadRoot = result.filePaths[0]; writeJson(settingsFile, settings); await library.call('addRoot', settings.downloadRoot); publish(); }
    },
    'app:library': async (_, action, input) => {
      if (['query','get','suggestions','groups','roots','facets','adjacent','position'].includes(action)) return library.call(action, input);
      if (['update','group','read','shuffle','restoreDetached'].includes(action)) { const result = await library.call(action, input); libraryChanged(); return result; }
      if (action === 'scan' || action === 'cancel') return library.call(action);
      if (action === 'import'||action==='importHentoid') return attachLibraryFolder(action==='importHentoid');
      if(action==='viewSource'){
        const book=await library.call('get',input);if(!book.sourceUrl)throw new Error('This book has no saved web page address.');
        if(allowedNavigation(book.sourceUrl))await navigate(book.sourceUrl);
        else await shell.openExternal(book.sourceUrl);
        return;
      }
      if (action === 'openFolder') {
        const book = await library.call('get', input);
        const result = await shell.openPath(book.path); if (result) throw new Error(result); return;
      }
      if (action === 'detach' || action === 'delete') {
        if (!Array.isArray(input) || !input.length || input.length > 1000) throw new Error('Select between 1 and 1000 books.');
        const books = await Promise.all(input.map(id => library.call('get', id)));
        const message = action === 'delete' ? `Delete ${books.length} book folder(s)?` : `Remove ${books.length} book(s) from the library? Files will be kept.`;
        const detail = action === 'delete' ? 'Use the Recycle Bin when possible. If this fails (for example on a USB or network drive), the book folders and their contents will be permanently deleted. Permanent deletion cannot be undone.' : '';
        const result = await dialog.showMessageBox(win, { type: 'warning', title: 'Library', message, detail, buttons: ['Cancel', action === 'delete' ? 'Delete books' : 'Remove from library'], defaultId: action === 'delete' ? 1 : 0, cancelId: 0 });
        if (result.response !== 1) return false;
        try { for (const book of books) {
          if (action === 'delete') {
            if (queue.jobs.some(j => path.resolve(j.directory) === book.path && ['queued','waiting','resolving','downloading'].includes(j.status))) throw new Error('Pause this book’s download before deleting it.');
            const roots = await library.call('roots');
            await deleteBookFolder(book, roots.find(r => r.id === book.root), directory=>shell.trashItem(directory));
          }
          await library.call('detach', [book.id]);
        } } finally { libraryChanged(); }
        return true;
      }
      if (action === 'backup') {
        const result = await dialog.showSaveDialog(win, { title: 'Back up library metadata', defaultPath: 'Hentdows-library.sqlite', filters: [{ name: 'SQLite library backup', extensions: ['sqlite'] }] });
        if (result.canceled) return;
        const temporary = `${result.filePath}.${Date.now()}.tmp`;
        await library.call('export', { file: temporary }); fs.renameSync(temporary, result.filePath);
        notice = 'Library metadata backed up. Image files remain in their book folders.'; publish(); return;
      }
      if (action === 'restoreBackup') {
        const selected = await dialog.showOpenDialog(win, { title: 'Restore library metadata', properties: ['openFile'], filters: [{ name: 'Hentdows library backup', extensions: ['sqlite'] }] });
        if (selected.canceled) return;
        const confirm = await dialog.showMessageBox(win, { type: 'warning', title: 'Restore library', message: 'Replace the current library metadata with this backup? Image files will be kept. Back up current metadata first if you want to retain newer edits.', buttons: ['Cancel', 'Restore'], defaultId: 0, cancelId: 0 });
        if (confirm.response !== 1) return;
        await library.call('restore', selected.filePaths[0]); libraryChanged(); return;
      }
      throw new Error('Unknown library action.');
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
  function remote(name,handler){const guarded=(event,...args)=>{if(event.sender!==wc||event.senderFrame!==wc.mainFrame||!allowedNavigation(event.senderFrame.url))return;Promise.resolve().then(()=>handler(...args)).catch(e=>{error=e.message;publish();});};ipcMain.on(name,guarded);remoteHandlers.push([name,guarded]);}
  remote('browser:position',(url,scroll)=>{if(url===wc.getURL()&&Number.isFinite(scroll)&&scroll>=0&&scroll<=10000000)browsing.remember(url,wc.getTitle(),scroll);});
  let lastMarkRequest=0;
  remote('browser:mark-links',async(url,links)=>{
    if(url!==wc.getURL()||!Array.isArray(links)||links.length>300||Date.now()-lastMarkRequest<300)return;lastMarkRequest=Date.now();
    const valid=links.filter(l=>l&&typeof l.url==='string'&&Array.isArray(l.tags)&&l.tags.length<=100).map(l=>({...galleryFromUrl(l.url),url:l.url,tags:l.tags.filter(t=>typeof t==='string'&&t.length<=200)})).filter(g=>g.site);
    const marks=await library.call('browserMarks',valid.map(g=>({...g,sourceId:g.id})));
    for(let i=0;i<marks.length;i++){const g=valid[i];marks[i].queued=queue.jobs.some(j=>identity(j.site,j.sourceId)===identity(g.site,g.id)&&!['complete','cancelled'].includes(j.status));marks[i].blocked=blockedTags([...marks[i].tags,...g.tags],settings.downloads.blockedTags).length>0;delete marks[i].tags;}
    if(url===wc.getURL())wc.send('browser:marks',{url,marks});
  });
  let savingPicture=false;
  remote('browser:grab-picture',async(url)=>{
    if(!settings.browser.grabPictures||savingPicture||typeof url!=='string'||url.length>8192)return;savingPicture=true;
    const controller=new AbortController();queue.pendingAdds.add(controller);let staging;
    try{
      const response=await sources.fetchImage(url,wc.getURL(),AbortSignal.any([controller.signal,AbortSignal.timeout(60000)])),ext=await imageExtension(response,url);
      const choice=await dialog.showSaveDialog(win,{title:'Save picture',defaultPath:path.join(app.getPath('pictures'),'picture.'+ext),filters:[{name:'Image',extensions:[ext]}]});
      if(choice.canceled){await response.body?.cancel();return;}
      staging=choice.filePath+'.hentdows-'+require('node:crypto').randomUUID();let size=0;
      await saveResponse(response,staging,controller.signal,queue.limiter,bytes=>{size+=bytes;if(size>128*1024**2)throw new Error('Picture exceeds the 128 MiB limit.');});fs.renameSync(staging,choice.filePath);notice='Picture saved.';publish();
    }finally{savingPicture=false;queue.pendingAdds.delete(controller);if(staging&&fs.existsSync(staging))fs.unlinkSync(staging);}
  });
  for (const [name, action] of [['browser:open-link', navigate], ['browser:download-link', enqueue]]) {
    const handler = (event, url, requestId) => {
      if (event.sender !== wc || event.senderFrame !== wc.mainFrame || !allowedNavigation(event.senderFrame.url) || !galleryFromUrl(url)) return;
      if(name==='browser:download-link'&&!settings.browser.quickDownload)return;
      Promise.resolve().then(() => action(url)).then(result=>{if(name==='browser:download-link'&&!wc.isDestroyed())wc.send('browser:download-result',{requestId,...result});}).catch(e => { error = e.message; publish();if(name==='browser:download-link'&&!wc.isDestroyed())wc.send('browser:download-result',{requestId,status:'error',message:e.message}); });
    };
    ipcMain.on(name, handler); remoteHandlers.push([name, handler]);
  }
  win.on('close', () => {
    if (quitting) return; quitting = true;
    if(!wc.isDestroyed())browsing.closePage(wc.getURL());
    stopAwake(); clearInterval(policyTimer); queue.close(); void library.close();
    for (const name of Object.keys(handlers)) ipcMain.removeHandler(name);
    for (const [name, handler] of remoteHandlers) ipcMain.removeListener(name, handler);
    if (!wc.isDestroyed()) wc.close();
    browserSession.webRequest.onBeforeRequest(null);
  });
  await win.loadURL('hentdows://app/');
  layout(); publish();
  const libraryReady = (async () => {
    const roots = new Set([settings.downloadRoot, ...queue.jobs.map(j => path.dirname(path.dirname(j.directory)))]);
    for (const root of roots) if (fs.existsSync(root)) await library.call('addRoot', root);
    const result = await library.call('scan');
    queue.archiveCompleted(await library.call('indexed', queue.jobs.filter(j => j.status === 'complete').map(j => j.directory)));
    return result;
  })().catch(e => { error = `Library: ${e.message}`; publish(); });
  return { win, browser, queue, library, libraryReady, state, navigate };
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
