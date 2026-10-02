// Synthetic metadata/images only; all web pages and external navigation are mocked.
const {app,session,shell}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const {createApplication}=require(process.env.HENTDOWS_TEST_ASAR?path.join(process.env.HENTDOWS_TEST_ASAR,'src/main.cjs'):'../src/main.cjs');
const root=fs.mkdtempSync(path.resolve('artifacts/book-source-')),downloads=path.join(root,'downloads');fs.mkdirSync(downloads);app.setPath('userData',root);app.disableHardwareAcceleration();
const fixtures=[{title:'EH fixture',site:'ehentai',url:'https://e-hentai.org/g/1/key/'},{title:'ExH fixture',site:'exhentai',url:'/2/key/'},{title:'Hitomi fixture',site:'hitomi',url:''},{title:'External fixture',site:'other',url:'https://example.org/book/4'},{title:'Missing fixture',site:'ehentai',url:''}];
const png=fs.readFileSync(path.resolve('src/assets/missing-ehentai.png'));
for(const [i,book] of fixtures.entries()){const folder=path.join(downloads,String(i));fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'page.png'),png);fs.writeFileSync(path.join(folder,'content.json'),JSON.stringify({schemaVersion:1,status:'complete',...book,sourceId:String(i+1),tags:[],files:[0,1].map(index=>({name:'page.png',bytes:png.length,index}))}));}
fs.writeFileSync(path.join(root,'settings.json'),JSON.stringify({downloadRoot:downloads,library:{endless:false}}));
let instance;const external=[];shell.openExternal=async url=>{external.push(url);};
async function until(predicate,label){for(let i=0;i<250;i++){if(await predicate())return;await delay(25);}throw new Error('Timed out: '+label);}
app.whenReady().then(async()=>{
  session.fromPartition('persist:hentdows-sources').protocol.handle('https',()=>new Response('<!doctype html><title>Synthetic book source</title><h1>Synthetic source page</h1>',{headers:{'content-type':'text/html'}}));
  instance=await createApplication({show:false,offscreen:true,dataPath:root});const {win,browser,library}=instance,js=code=>win.webContents.executeJavaScript(code);await instance.libraryReady;
  const books=(await library.call('query',{})).books,byTitle=title=>books.find(b=>b.title===title).id;
  const click=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const returnToLibrary=async()=>{await js('hentdows.panel("library")');await until(()=>js('document.querySelectorAll(".book").length===5'),'library');await click('#library-deselect');};
  const context=id=>js(`document.querySelector('.book[data-id="${id}"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:100,clientY:160}))`);
  const select=id=>js(`document.querySelector('.book[data-id="${id}"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);
  const sourceInDialog=()=>js('[...document.querySelectorAll("#library-dialog button")].find(b=>b.textContent==="View source").click()');
  const expectBrowser=async url=>{await until(()=>instance.state().panel==='browser'&&browser.webContents.getURL()===url,'book source');assert.equal(await js('document.querySelector("#library-dialog").open'),false);assert.equal(await js('readerUI.active'),false);};
  await returnToLibrary();const eh=byTitle('EH fixture');await click(`.book[data-id="${eh}"]`);await until(()=>js('document.querySelector(".reader-stage")?.getAttribute("aria-busy")===null'),'reader');
  await click('.reader-more summary');win.setSize(390,600);await delay(100);fs.writeFileSync(path.join(root,'reader-source-menu.png'),(await win.webContents.capturePage()).toPNG());
  await sourceInDialog();await expectBrowser('https://e-hentai.org/g/1/key/');assert.equal((await library.call('get',eh)).last_page,0);
  await returnToLibrary();await context(byTitle('ExH fixture'));assert.equal(await js('document.querySelector("#book-context-menu button").dataset.action'),'delete');await click('#book-context-menu [data-action="source"]');await expectBrowser('https://exhentai.org/g/2/key/');
  await returnToLibrary();await select(byTitle('Hitomi fixture'));assert.equal(await js('document.querySelector("#library-action [value=source]").disabled'),false);await js('document.querySelector("#library-action").value="source";document.querySelector("#library-action").dispatchEvent(new Event("change"))');await expectBrowser('https://hitomi.la/galleries/3.html');
  await returnToLibrary();await click(`.book[data-id="${byTitle('External fixture')}"] .book-details`);await until(()=>js('document.querySelector("#library-dialog").open'),'details');await sourceInDialog();await until(()=>external.length===1,'external source');assert.deepEqual(external,['https://example.org/book/4']);assert.equal(instance.state().panel,'library');
  const missing=byTitle('Missing fixture');await context(missing);assert.equal(await js('document.querySelector("#book-context-menu [data-action=source]").disabled'),true);await select(eh);await context(eh);assert.equal(await js('document.querySelector("#book-context-menu [data-action=source]").disabled'),true);
  await assert.rejects(()=>js(`hentdows.library('viewSource',${missing})`),/no saved web page/);assert.equal(external.length,1);
  await js('hentdows.panel("sources")');console.log('Book source smoke passed: '+root);win.close();app.quit();
}).catch(async error=>{console.error(error);if(instance)fs.writeFileSync(path.join(root,'failure.png'),(await instance.win.webContents.capturePage()).toPNG());app.exit(1);});
