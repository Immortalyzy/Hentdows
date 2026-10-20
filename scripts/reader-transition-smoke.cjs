// Generated images and an isolated profile only; never opens an existing library.
const {app,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const {createApplication}=require(process.env.HENTDOWS_TEST_ASAR?path.join(process.env.HENTDOWS_TEST_ASAR,'src/main.cjs'):'../src/main.cjs');
const root=fs.mkdtempSync(path.resolve('artifacts/reader-transition-')),downloads=path.join(root,'downloads'),folder=path.join(downloads,'fixture');
fs.mkdirSync(folder,{recursive:true});app.setPath('userData',root);app.disableHardwareAcceleration();
let instance;const gates=new Map();
function hold(page){let release;const promise=new Promise(resolve=>release=resolve);const gate={promise,release,requested:false};gates.set(page,gate);return gate;}
async function until(predicate,label){for(let i=0;i<250;i++){if(await predicate())return;await delay(25);}throw new Error('Timed out: '+label);}
app.whenReady().then(async()=>{
  const files=[];
  for(let i=0;i<6;i++){
    const pixels=Buffer.alloc(120*180*4);for(let n=0;n<pixels.length;n+=4){pixels[n]=50+i*30;pixels[n+1]=160-i*20;pixels[n+2]=190;pixels[n+3]=255;}
    const png=nativeImage.createFromBitmap(pixels,{width:120,height:180}).toPNG(),name=i+'.png';fs.writeFileSync(path.join(folder,name),png);files.push({name,bytes:png.length,index:i});
  }
  fs.writeFileSync(path.join(folder,'content.json'),JSON.stringify({schemaVersion:1,status:'complete',title:'Synthetic transition book',site:'ehentai',sourceId:'1',tags:[],files}));
  const spreadFolder=path.join(downloads,'spread-fixture');fs.mkdirSync(spreadFolder);for(const file of files)fs.copyFileSync(path.join(folder,file.name),path.join(spreadFolder,file.name));
  fs.writeFileSync(path.join(spreadFolder,'content.json'),JSON.stringify({schemaVersion:1,status:'complete',title:'Synthetic spread book',site:'ehentai',sourceId:'2',tags:[],files}));
  fs.writeFileSync(path.join(root,'settings.json'),JSON.stringify({downloadRoot:downloads,viewer:{direction:'ltr',twoPages:false,readThreshold:1,upscale:0,preloadPages:0}}));
  instance=await createApplication({show:false,offscreen:true,dataPath:root});const {win,library}=instance,js=code=>win.webContents.executeJavaScript(code);
  await instance.libraryReady;let id=(await library.call('query',{query:'Synthetic transition book'})).books[0].id;
  const originalCall=library.call.bind(library);library.call=async(method,input)=>{
    const gate=method==='asset'&&input.id===id?gates.get(input.page):null;
    if(gate){gate.requested=true;await gate.promise;if(gates.get(input.page)===gate)gates.delete(input.page);if(gate.fail)throw new Error('Synthetic unavailable page');}
    return originalCall(method,input);
  };
  const click=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const open=()=>js(`readerUI.open(${id},0,{},()=>document.getElementById('library-dialog-close').click())`);
  const visible=()=>js('[...document.querySelectorAll(".reader-spread:not(.reader-pending) .reader-image")].map(i=>i.getAttribute("alt"))');
  const ready=()=>js('document.querySelector(".reader-stage")?.getAttribute("aria-busy")!=="true"');
  await open();await until(async()=>await ready()&&(await visible())[0]==='Page 1','first page');
  await js('window.oldImage=document.querySelector(".reader-spread:not(.reader-pending) .reader-image");void 0');
  const second=hold(1);await click('[aria-label="Next page"]');await until(()=>second.requested,'delayed request');
  assert.equal(await js('document.querySelector(".reader-load-status")===null'),true,'normal page loading has no indicator');
  assert.equal(await js('oldImage.isConnected&&getComputedStyle(oldImage).visibility==="visible"'),true);assert.deepEqual(await visible(),['Page 1']);
  // Also delay decode, after the network response has completed.
  await js('window.originalDecode=HTMLImageElement.prototype.decode;HTMLImageElement.prototype.decode=async function(){await originalDecode.call(this);if(this.src.endsWith("/1")){window.waitingForDecode=true;await new Promise(resolve=>window.releaseDecode=resolve);}};void 0');
  second.release();await until(()=>js('window.waitingForDecode===true'),'decode wait');assert.deepEqual(await visible(),['Page 1']);
  fs.writeFileSync(path.join(root,'kept-previous-page.png'),(await win.webContents.capturePage()).toPNG());
  await js('window.releaseDecode();HTMLImageElement.prototype.decode=originalDecode;void 0');await until(async()=>await ready()&&(await visible())[0]==='Page 2','decoded replacement');
  const third=hold(2),fourth=hold(3);await click('[aria-label="Next page"]');await until(()=>third.requested,'third request');await click('[aria-label="Next page"]');await until(()=>fourth.requested,'fourth request');
  fourth.release();await until(async()=>await ready()&&(await visible())[0]==='Page 4','latest request wins');third.release();await delay(120);assert.deepEqual(await visible(),['Page 4']);assert.equal((await library.call('get',id)).pageState.some(p=>p.page===2&&p.read),false);
  const failure=hold(4);failure.fail=true;await click('[aria-label="Next page"]');await until(()=>failure.requested,'failed request');failure.release();await until(()=>js('document.querySelector(".reader-load-status")?.textContent.includes("Retry")'),'retry message');assert.deepEqual(await visible(),['Page 4']);
  await click('.reader-load-status button');await until(async()=>await ready()&&(await visible())[0]==='Page 5','retry page');
  await click('#library-dialog-close');id=(await library.call('query',{query:'Synthetic spread book'})).books[0].id;await js('hentdows.savePreferences("viewer",{twoPages:true})');await open();await until(async()=>await ready()&&(await visible()).length===2,'first spread');
  const left=hold(2),right=hold(3);await click('[aria-label="Next page"]');await until(()=>left.requested&&right.requested,'both spread requests');left.release();await delay(100);assert.deepEqual(await visible(),['Page 1','Page 2']);right.release();await until(async()=>await ready()&&(await visible())[0]==='Page 3','complete spread');assert.deepEqual(await visible(),['Page 3','Page 4']);
  const closeLeft=hold(4),closeRight=hold(5);await click('[aria-label="Next page"]');await until(()=>closeLeft.requested&&closeRight.requested,'closing requests');await click('#library-dialog-close');closeLeft.release();closeRight.release();await delay(120);assert.equal(await js('document.querySelector("#library-dialog").open'),false);assert.equal(await js('document.querySelector(".reader-stage")===null'),true);
  await js('hentdows.savePreferences("viewer",{zoomAnimation:false})');await open();await until(ready,'zoom fixture');
  await js('[...document.querySelectorAll(".reader-extra button")].find(b=>b.textContent==="Zoom +").click()');
  await until(()=>js('document.querySelector(".reader-stage").scrollWidth>document.querySelector(".reader-stage").clientWidth'),'zoom overflow');
  assert.equal(await js('(()=>{const stage=document.querySelector(".reader-stage");stage.scrollLeft=40;stage.scrollTop=40;return stage.scrollLeft>0&&stage.scrollTop>0;})()'),true,'zoomed pages still pan');
  await click('#library-dialog-close');
  await js('hentdows.savePreferences("viewer",{twoPages:false,zoomAnimation:false})');await open();await until(ready,'progress fixture');
  const bounds=()=>js('(()=>{const r=document.querySelector(".reader-stage").getBoundingClientRect();return [r.width,r.height,r.top];})()'),before=await bounds();
  assert.equal(await js('document.querySelector(".reader-progress").getAttribute("aria-valuetext")'),'Page 1 of 6');
  await js('document.querySelector(".reader-progress").value=5;document.querySelector(".reader-progress").dispatchEvent(new Event("input"))');
  assert.deepEqual(await visible(),['Page 1'],'drag previews without requesting intermediate pages');
  await js('document.querySelector(".reader-progress").dispatchEvent(new Event("change"))');
  await until(async()=>await ready()&&(await visible())[0]==='Page 5','progress jump');
  assert.deepEqual(await bounds(),before,'progress updates never resize the image area');
  assert.equal(await js('document.activeElement.className'),'reader-progress');
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Right'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Right'});
  await until(async()=>await ready()&&(await visible())[0]==='Page 6','keyboard progress jump');
  assert.equal(await js('document.querySelector(".reader-progress").style.getPropertyValue("--reading-progress")'),'100%');
  await click('#library-dialog-close');await js('hentdows.savePreferences("viewer",{direction:"vertical"})');await open();
  await until(()=>js('!!document.querySelector(".vertical-page[data-page=\\"0\\"][data-loaded=\\"true\\"]")'),'vertical progress fixture');
  await js('document.querySelector(".reader-progress").value=3;document.querySelector(".reader-progress").dispatchEvent(new Event("change"))');
  await until(()=>js('document.querySelector(".reader-page-number").textContent==="3 / 6"'),'vertical progress jump');
  await js(`document.querySelector('.vertical-page[data-page="4"]').scrollIntoView({block:"start"})`);
  await until(()=>js('document.querySelector(".reader-progress").value==="5"'),'scroll updates progress');
  await click('#library-dialog-close');
  console.log('Reader transition and progress smoke passed: '+root);win.close();app.quit();
}).catch(async error=>{console.error(error);for(const gate of gates.values())gate.release();if(instance)fs.writeFileSync(path.join(root,'failure.png'),(await instance.win.webContents.capturePage()).toPNG());app.exit(1);});
