// All folders, metadata and pictures below are generated fixtures in a fresh profile.
const {app,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const {createApplication}=require(process.env.HENTDOWS_TEST_ASAR?path.join(process.env.HENTDOWS_TEST_ASAR,'src/main.cjs'):'../src/main.cjs');
const base=fs.mkdtempSync(path.resolve('artifacts/import-smoke-')),downloads=path.join(base,'downloads'),extra=path.join(base,'extra'),hentoid=path.join(base,'.Hentoid');
const png=fs.readFileSync(path.resolve('src/assets/missing-ehentai.png'));for(const root of [downloads,extra,hentoid])fs.mkdirSync(root);
function native(root,id){const folder=path.join(root,'ehentai',String(id));fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'1.png'),png);fs.writeFileSync(path.join(folder,'content.json'),JSON.stringify({schemaVersion:1,status:'complete',title:'Windows fixture '+id,site:'ehentai',sourceId:String(id),tags:[],files:[{name:'1.png',bytes:png.length,index:0}]}));}
native(downloads,1);native(extra,2);const sourceFiles=[];
for(const [index,filename] of ['contentV2.json','content.json','data.json'].entries()){
  const folder=path.join(hentoid,'ehentai','fixture-'+index);fs.mkdirSync(folder,{recursive:true});for(const file of ['thumb.png','001.png','002.png','003.png'])fs.writeFileSync(path.join(folder,file),png);
  const data=JSON.stringify({title:'Hentoid fixture '+index,site:'EXHENTAI',url:`/${10+index}/token/`,status:'DOWNLOADED',rating:5,favourite:true,reads:4,lastReadPageIndex:1,attributes:{ARTIST:[{name:'Synthetic studio',type:'ARTIST'}]},imageFiles:[{name:'thumb',isCover:true,order:0},{name:'001',isRead:true,order:1},{name:'002',favourite:true,order:2},{name:'003',order:3}],groups:[{groupingId:98,groupName:'Android shelf',order:index}]});fs.writeFileSync(path.join(folder,filename),data);sourceFiles.push({file:path.join(folder,filename),data});
}
app.setPath('userData',base);app.disableHardwareAcceleration();fs.writeFileSync(path.join(base,'settings.json'),JSON.stringify({downloadRoot:downloads,library:{endless:false}}));
let instance,choice=extra,cancel=false;dialog.showOpenDialog=async()=>({canceled:cancel,filePaths:[choice]});
async function until(predicate,label){for(let i=0;i<300;i++){if(await predicate())return;await delay(25);}throw new Error('Timed out: '+label);}
app.whenReady().then(async()=>{
  instance=await createApplication({show:false,offscreen:true,dataPath:base});const {win,library}=instance,js=code=>win.webContents.executeJavaScript(code),errors=[];
  win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});await instance.libraryReady;
  await until(()=>js('document.querySelectorAll(".book").length===1'),'initial fixture');
  await js('hentdows.storage("add")');await until(()=>js('document.querySelectorAll(".book").length===2'),'combined locations');assert.equal(instance.state().downloadRoot,downloads);
  let roots=await library.call('roots');const oldRoot=roots.find(r=>r.path===downloads);
  await js(`document.querySelector('#library-location').value=${JSON.stringify(String(oldRoot.id))};document.querySelector('#library-location').dispatchEvent(new Event('change'))`);await until(()=>js('document.querySelectorAll(".book").length===1'),'location filter');
  choice=hentoid;await js('document.querySelector("#library-import-hentoid").click()');await until(async()=>(await library.call('query',{})).total===5,'Hentoid import');await until(()=>js('document.querySelectorAll(".book").length===5'),'all books after import');assert.equal(await js('document.querySelector("#library-location").value'),'0');assert.equal(instance.state().downloadRoot,downloads);
  const imported=(await library.call('query',{query:'Hentoid fixture 0'})).books[0];assert.equal(imported.rating,5);assert.equal(imported.favourite,1);assert.equal((await library.call('groups')).find(g=>g.name==='Android shelf').books,3);
  await until(()=>js('[...document.querySelectorAll(".book-cover")].every(i=>i.complete&&i.naturalWidth>0)'),'all local covers');await delay(150);fs.writeFileSync(path.join(base,'combined-library.png'),(await win.webContents.capturePage()).toPNG());
  await js(`document.querySelector('.book[data-id="${imported.id}"]').click()`);await until(()=>js('document.querySelector(".reader-image")?.naturalWidth>0'),'imported reader');assert.equal((await library.call('get',imported.id)).last_page,1);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});await until(()=>js('!document.querySelector("#library-dialog").open'),'close reader');
  await js('hentdows.library("importHentoid")');assert.equal((await library.call('query',{})).total,5);
  for(const file of sourceFiles)assert.equal(fs.readFileSync(file.file,'utf8'),file.data);
  roots=await library.call('roots');assert.equal(roots.length,3);assert.equal((await library.call('storage')).reduce((n,r)=>n+r.books,0),5);
  await js('hentdows.panel("storage")');await until(()=>js('document.querySelectorAll(".storage-row").length===3'),'three storage places');win.setSize(390,600);await delay(180);fs.writeFileSync(path.join(base,'storage-narrow.png'),(await win.webContents.capturePage()).toPNG());assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true);
  await js('document.querySelector("#storage-show-all").click()');await until(()=>js('document.querySelectorAll(".book").length===5'),'show all button');
  cancel=true;await js('hentdows.library("importHentoid")');assert.equal((await library.call('roots')).length,3);assert.deepEqual(errors,[]);
  await js('hentdows.panel("sources")');await delay(100);console.log('Hentoid import smoke passed: '+base);win.close();app.quit();
}).catch(async error=>{console.error(error);if(instance)fs.writeFileSync(path.join(base,'failure.png'),(await instance.win.webContents.capturePage()).toPNG());app.exit(1);});
