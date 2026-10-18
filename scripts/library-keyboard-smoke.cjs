// Synthetic books in a fresh profile only. Never opens the user's library.
const {app,dialog,shell}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const {createApplication}=require(process.env.HENTDOWS_TEST_ASAR?path.join(process.env.HENTDOWS_TEST_ASAR,'src/main.cjs'):'../src/main.cjs');
const root=fs.mkdtempSync(path.resolve('artifacts/library-keyboard-')),downloads=path.join(root,'downloads');
fs.mkdirSync(downloads);app.setPath('userData',root);app.disableHardwareAcceleration();
const png=fs.readFileSync(path.resolve('src/assets/missing-ehentai.png'));
for(let i=0;i<145;i++){
  const folder=path.join(downloads,String(i));fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'1.png'),png);
  fs.writeFileSync(path.join(folder,'content.json'),JSON.stringify({schemaVersion:1,status:'complete',title:`Synthetic Book ${String(i).padStart(3,'0')}`,sourceId:String(i),site:'ehentai',tags:[],files:[{name:'1.png',index:0,bytes:png.length}]}));
}
fs.writeFileSync(path.join(root,'settings.json'),JSON.stringify({downloadRoot:downloads,library:{endless:false,pageSize:20},viewer:{upscale:0,preloadPages:0}}));
async function until(fn,label){for(let i=0;i<400;i++){if(await fn())return;await delay(20);}throw new Error('Timed out: '+label);}
app.whenReady().then(async()=>{
  let prompt,answer,confirmCount=0;
  dialog.showMessageBox=async(_win,options)=>{prompt=options;confirmCount++;return new Promise(resolve=>answer=response=>resolve({response}));};
  shell.trashItem=async folder=>{assert.equal(path.dirname(folder),downloads);fs.rmSync(folder,{recursive:true});};
  const instance=await createApplication({show:false,offscreen:true,dataPath:root}),{win,library}=instance;
  const js=code=>win.webContents.executeJavaScript(code);
  const key=async keyCode=>{win.webContents.sendInputEvent({type:'keyDown',keyCode});win.webContents.sendInputEvent({type:'keyUp',keyCode});await delay(30);};
  const focused=()=>js('Number(document.activeElement?.dataset.id)||null');
  const expectFocus=async id=>{try{await until(async()=>await focused()===id,'focus '+id);}catch(error){console.log(await js('({focus:document.activeElement.outerHTML.slice(0,200),books:[...document.querySelectorAll(".book")].map(b=>b.dataset.id)})'));throw error;}};
  const focus=id=>js(`document.querySelector('.book[data-id="${id}"]').focus()`);
  await instance.libraryReady;await until(()=>js('document.querySelectorAll(".book").length===20'),'initial books');
  let ids=(await library.call('query',{limit:200})).books.map(b=>b.id);
  await expectFocus(ids[0]);await key('Down');await expectFocus(ids[1]);await key('Right');await expectFocus(ids[2]);await key('Up');await expectFocus(ids[1]);await key('Left');await expectFocus(ids[0]);
  await focus(ids[19]);await key('Down');await expectFocus(ids[20]);await key('Up');await expectFocus(ids[19]);
  await key('Enter');await until(()=>js('readerUI.active && !!document.querySelector(".reader-spread:not(.reader-pending)")'),'reader open');
  await key('Escape');await expectFocus(ids[19]);
  await key('Delete');await until(()=>!!answer,'delete prompt');assert.equal(prompt.defaultId,1);assert.equal(prompt.cancelId,0);
  await key('Delete');assert.equal(confirmCount,1,'only one confirmation while pending');answer(0);answer=null;await expectFocus(ids[19]);await delay(100);
  assert.equal((await library.call('query',{})).total,145,'cancel keeps the book');
  await key('Delete');await until(()=>!!answer,'second delete prompt');answer(prompt.defaultId);answer=null;
  await until(async()=>(await library.call('query',{})).total===144,'confirmed delete');await expectFocus(ids[20]);
  ids=ids.filter((_,i)=>i!==19);
  await js('document.getElementById("library-view").value="grid3";document.getElementById("library-view").dispatchEvent(new Event("change"))');
  await until(()=>js('document.querySelector("#library-books").classList.contains("grid3")'),'grid view');await focus(ids[0]);
  await key('Down');await expectFocus(ids[3]);await key('Right');await expectFocus(ids[4]);await key('Up');await expectFocus(ids[1]);
  await js('document.getElementById("book-search").focus()');await key('Right');assert.equal(await js('document.activeElement.id'),'book-search');await key('Delete');assert.equal(confirmCount,2,'typing does not delete books');
  await js('hentdows.savePreferences("library",{endless:true})');
  await until(()=>js('document.querySelector("#library-books").classList.contains("virtual")'),'endless grid');
  await focus(ids[0]);
  for(let i=1;i<=25;i++){await key('Down');await expectFocus(ids[i*3]);}
  assert.ok(await js('document.querySelector("main").scrollTop>0'));
  await key('Enter');await until(()=>js('readerUI.active'),'endless reader');await key('Escape');await expectFocus(ids[75]);
  // Reading changes last-read ordering; return must locate the original ID.
  await js('document.getElementById("library-filters").click()');
  await js(`(()=>{const s=document.querySelector('#library-dialog-content select');s.value='readDate';s.dispatchEvent(new Event('change'));[...document.querySelectorAll('#library-dialog-content button')].find(b=>b.textContent==='Apply').click();})()`);
  await until(()=>js('!document.getElementById("library-dialog").open'),'filter applied');await delay(150);
  const ordered=(await library.call('query',{sort:'readDate',desc:true,limit:200})).books.map(b=>b.id),target=ordered[8];
  await focus(target);await key('Enter');await until(async()=>(await library.call('get',target)).last_read>0,'read recorded');await key('Escape');await expectFocus(target);
  assert.equal(await library.call('position',{id:target,filters:{sort:'readDate',desc:true}}),0);
  console.log('Library keyboard smoke passed: '+root);win.close();app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
