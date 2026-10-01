// All folders, metadata and pictures below are generated fixtures in a fresh profile.
const {app,dialog,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const {createApplication}=require(process.env.HENTDOWS_TEST_ASAR?path.join(process.env.HENTDOWS_TEST_ASAR,'src/main.cjs'):'../src/main.cjs');
const base=fs.mkdtempSync(path.resolve('artifacts/import-smoke-')),downloads=path.join(base,'downloads'),extra=path.join(base,'extra'),hentoid=path.join(base,'.Hentoid');
const png=fs.readFileSync(path.resolve('src/assets/missing-ehentai.png'));for(const root of [downloads,extra,hentoid])fs.mkdirSync(root);
function native(root,id){const folder=path.join(root,'ehentai',String(id));fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'1.png'),png);fs.writeFileSync(path.join(folder,'content.json'),JSON.stringify({schemaVersion:1,status:'complete',title:'Windows fixture '+id,site:'ehentai',sourceId:String(id),tags:[],files:[{name:'1.png',bytes:png.length,index:0}]}));}
native(downloads,1);native(extra,2);const sourceFiles=[];
for(const [index,filename] of ['contentV2.json','content.json','data.json'].entries()){
  const folder=path.join(hentoid,['exhentai','exhentai1','exhentai2'][index],'fixture-'+index);fs.mkdirSync(folder,{recursive:true});for(const file of ['thumb.png','0002','003.png'])fs.writeFileSync(path.join(folder,file),png);
  fs.writeFileSync(path.join(folder,'001.jfif'),nativeImage.createFromBuffer(png).toJPEG(90));
  const data=JSON.stringify({title:'Hentoid fixture '+index,site:'EXHENTAI',url:`/${10+index}/token/`,status:'DOWNLOADED',rating:5,favourite:true,reads:4,lastReadPageIndex:1,attributes:{ARTIST:[{name:'Synthetic studio',type:'ARTIST'}]},imageFiles:[{name:'thumb',isCover:true,order:0},{name:'001',isRead:true,order:1},{name:'002',favourite:true,order:2},{name:'003',order:3}],groups:[{groupingId:98,groupName:'Android shelf',order:index}]});fs.writeFileSync(path.join(folder,filename),data);sourceFiles.push({file:path.join(folder,filename),data});
}
// Incomplete parent metadata must not hide the numbered source folders below it.
fs.writeFileSync(path.join(hentoid,'content.json'),JSON.stringify({schemaVersion:1,status:'downloading'}));
app.setPath('userData',base);app.disableHardwareAcceleration();fs.writeFileSync(path.join(base,'settings.json'),JSON.stringify({downloadRoot:downloads,library:{endless:false}}));
let instance,choice=extra,cancel=false;dialog.showOpenDialog=async()=>({canceled:cancel,filePaths:[choice]});
async function until(predicate,label){for(let i=0;i<300;i++){if(await predicate())return;await delay(25);}throw new Error('Timed out: '+label);}
app.whenReady().then(async()=>{
  instance=await createApplication({show:false,offscreen:true,dataPath:base});const {win,library}=instance,js=code=>win.webContents.executeJavaScript(code),errors=[];
  win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});await instance.libraryReady;
  const webp=await js('(()=>{const canvas=document.createElement("canvas");canvas.width=8;canvas.height=8;canvas.getContext("2d").fillRect(0,0,8,8);return canvas.toDataURL("image/webp");})()');assert.ok(webp.startsWith('data:image/webp;base64,'));
  fs.writeFileSync(path.join(hentoid,'exhentai','fixture-0','0002'),Buffer.from(webp.split(',')[1],'base64'));
  await until(()=>js('document.querySelectorAll(".book").length===1'),'initial fixture');
  await js('hentdows.storage("add")');await until(()=>js('document.querySelectorAll(".book").length===2'),'combined locations');assert.equal(instance.state().downloadRoot,downloads);
  let roots=await library.call('roots');const oldRoot=roots.find(r=>r.path===downloads);
  await js(`document.querySelector('#library-location').value=${JSON.stringify(String(oldRoot.id))};document.querySelector('#library-location').dispatchEvent(new Event('change'))`);await until(()=>js('document.querySelectorAll(".book").length===1'),'location filter');
  choice=hentoid;await js('document.querySelector("#library-import-hentoid").click()');await until(async()=>(await library.call('query',{})).total===5,'Hentoid import');await until(()=>js('document.querySelectorAll(".book").length===5'),'all books after import');assert.equal(await js('document.querySelector("#library-location").value'),'0');assert.equal(instance.state().downloadRoot,downloads);
  assert.deepEqual(instance.state().libraryScan.errors,[]);
  const imported=(await library.call('query',{query:'Hentoid fixture 0'})).books[0];assert.equal(imported.rating,5);assert.equal(imported.favourite,1);assert.equal((await library.call('groups')).find(g=>g.name==='Android shelf').books,3);
  await until(()=>js('[...document.querySelectorAll(".book-cover")].every(i=>i.complete&&i.naturalWidth>0)'),'all local covers');await delay(150);fs.writeFileSync(path.join(base,'combined-library.png'),(await win.webContents.capturePage()).toPNG());
  await js(`document.querySelector('.book[data-id="${imported.id}"]').click()`);await until(()=>js('document.querySelector(".reader-image")?.naturalWidth>0'),'imported reader');assert.equal((await library.call('get',imported.id)).last_page,1);
  await js('document.querySelector(".reader-page-input").value=1;document.querySelector(".reader-page-input").dispatchEvent(new Event("change"))');await until(()=>js('document.querySelector(".reader-image")?.naturalWidth>0&&document.querySelector(".reader-image").src.endsWith("/0")'),'JFIF page');
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});await until(()=>js('!document.querySelector("#library-dialog").open'),'close reader');
  await js('hentdows.library("importHentoid")');assert.equal((await library.call('query',{})).total,5);
  for(const file of sourceFiles)assert.equal(fs.readFileSync(file.file,'utf8'),file.data);
  roots=await library.call('roots');assert.equal(roots.length,3);assert.equal((await library.call('storage')).reduce((n,r)=>n+r.books,0),5);
  await js('hentdows.panel("storage")');await until(()=>js('document.querySelectorAll(".storage-row").length===3'),'three storage places');win.setSize(390,600);await delay(180);fs.writeFileSync(path.join(base,'storage-narrow.png'),(await win.webContents.capturePage()).toPNG());assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true);
  await js('document.querySelector("#storage-show-all").click()');await until(()=>js('document.querySelectorAll(".book").length===5'),'show all button');
  cancel=true;await js('hentdows.library("importHentoid")');assert.equal((await library.call('roots')).length,3);assert.deepEqual(errors,[]);
  const broken=path.join(hentoid,'exhentai39','synthetic-long-folder-name-'.repeat(5));fs.mkdirSync(broken,{recursive:true});fs.writeFileSync(path.join(broken,'contentV2.json'),'{incomplete');
  await library.call('scan');await until(()=>js('document.querySelector("#library-scan").textContent.includes("Recopy")'),'actionable import error');assert.equal(await js('document.querySelector("#library-scan").scrollWidth<=document.querySelector("#library-scan").clientWidth'),true);
  fs.writeFileSync(path.join(base,'import-report-narrow.png'),(await win.webContents.capturePage()).toPNG());
  await js('hentdows.panel("sources")');await delay(100);console.log('Hentoid import smoke passed: '+base);win.close();app.quit();
}).catch(async error=>{console.error(error);if(instance)fs.writeFileSync(path.join(base,'failure.png'),(await instance.win.webContents.capturePage()).toPNG());app.exit(1);});
