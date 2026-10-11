// Hardware GPU + animation playback, using generated colors in an isolated profile.
const {app}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const {animated,still}=require('../test/helpers/webp-fixtures.cjs');
const {createApplication}=require(process.env.HENTDOWS_TEST_ASAR?path.join(process.env.HENTDOWS_TEST_ASAR,'src/main.cjs'):'../src/main.cjs');
const root=fs.mkdtempSync(path.resolve('artifacts/animated-webp-')),downloads=path.join(root,'downloads'),folder=path.join(downloads,'fixture');
fs.mkdirSync(folder,{recursive:true});app.setPath('userData',root);
let instance;
async function until(fn,label){for(let i=0;i<400;i++){if(await fn())return;await delay(25);}throw new Error('Timed out: '+label);}
app.whenReady().then(async()=>{
  const files=['animated.webp','still.webp','extensionless','second.webp'].map((name,index)=>{
    const data=index===1?still:animated;fs.writeFileSync(path.join(folder,name),data);return {name,index,bytes:data.length};
  });
  fs.writeFileSync(path.join(folder,'content.json'),JSON.stringify({schemaVersion:1,status:'complete',title:'Synthetic WebP animation',sourceId:'1',site:'ehentai',tags:[],files}));
  fs.writeFileSync(path.join(root,'settings.json'),JSON.stringify({downloadRoot:downloads,viewer:{upscale:2,preloadPages:3,smartCrop:true,rotate:'left',direction:'ltr',twoPages:false,pageAnimation:false}}));
  instance=await createApplication({show:false,offscreen:true,dataPath:root});
  const {win,library}=instance,js=code=>win.webContents.executeJavaScript(code);
  win.setSize(940,620);win.webContents.setBackgroundThrottling(false);
  await instance.libraryReady;
  await until(()=>js('!!window.readerImages && (readerImages.status.ready || !!readerImages.status.unavailable)'),'GPU startup');
  assert.equal((await js('readerImages.status')).unavailable,'','hardware GPU required');
  const id=(await library.call('query',{})).books[0].id;
  const open=page=>js(`readerUI.open(${id},${page}, {},()=>document.getElementById('library-dialog-close').click())`);
  const close=()=>js('readerUI.close();void 0');
  const click=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const visible='.reader-spread:not(.reader-pending)';
  async function playing(selector,label){
    console.log('Checking playback:',label);
    await until(()=>js(`!!document.querySelector(${JSON.stringify(selector)})?.complete`),label+' decoded');
    const colors=new Set();
    // Sample actual compositor output; drawing an animated <img> into a canvas
    // can return its first frame and would not prove visible playback.
    for(let i=0;i<24&&colors.size<2;i++){
      const rect=await js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(),s=document.querySelector('.reader-stage').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round((Math.max(r.top,s.top)+Math.min(r.bottom,s.bottom))/2),width:1,height:1};})()`);
      const pixel=(await win.webContents.capturePage(rect)).toBitmap();
      if(pixel[2]>pixel[0]+100)colors.add('red');if(pixel[0]>pixel[2]+100)colors.add('blue');
      await delay(70);
    }
    assert.equal(colors.size,2,label+' visibly advances through both frames');
  }
  await open(0);
  await until(()=>js('readerImages.status.enhanced.length===4 && !readerImages.status.running'),'2x lookahead complete');
  const cached=await js('readerImages.status');
  assert.equal(cached.enhanced.filter(x=>x.width).length,1,'only the still WebP is enhanced');
  assert.equal(cached.enhanced.filter(x=>x.error==='Original retained: animated image').length,3);
  assert.equal(cached.originals.length,4,'animations still preload');
  await playing(visible+' img[data-animated="true"]','2x animated WebP with crop/rotation enabled');
  await click('[aria-label="Next page"]');
  await until(()=>js(`!!document.querySelector('${visible} [data-upscaled="2"]')`),'static WebP still enhanced');
  await click('[aria-label="Next page"]');
  await playing(visible+' img[data-animated="true"]','extensionless animated WebP');
  await close();await js('hentdows.savePreferences("viewer",{upscale:4,twoPages:true})');await open(2);
  await until(()=>js(`document.querySelectorAll('${visible} img[data-animated="true"]').length===2`),'animated spread');
  await playing(visible+' .reader-sheet:last-child img','4x animated spread');
  assert.equal(await js(`document.querySelector('${visible} canvas')===null`),true);
  await close();await js('hentdows.savePreferences("viewer",{direction:"vertical",twoPages:false})');await open(0);
  await playing('.vertical-page[data-page="0"] img[data-animated="true"]','vertical animation');
  await js('document.querySelector(".reader-page-input").value=3;document.querySelector(".reader-page-input").dispatchEvent(new Event("change"))');
  await playing('.vertical-page[data-page="2"] img[data-animated="true"]','vertical extensionless animation');
  await close();await js('hentdows.savePreferences("viewer",{upscale:0,direction:"ltr"})');await open(0);
  await playing(visible+' img[data-animated="true"]','upscaling off with crop/rotation enabled');
  await close();assert.equal((await js('readerImages.status')).ready,true,'model remains loaded');
  console.log('Animated WebP smoke passed: '+root);win.close();app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
