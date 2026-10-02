// Hardware GPU smoke, using generated geometric images in a fresh profile only.
const {app,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const {createApplication}=require(process.env.HENTDOWS_TEST_ASAR?path.join(process.env.HENTDOWS_TEST_ASAR,'src/main.cjs'):'../src/main.cjs');
const root=fs.mkdtempSync(path.resolve('artifacts/upscale-smoke-')),downloads=path.join(root,'downloads'),folder=path.join(downloads,'fixture');
fs.mkdirSync(folder,{recursive:true});app.setPath('userData',root);
let instance;
async function until(fn,label){for(let i=0;i<600;i++){if(await fn())return;await delay(25);}throw new Error('Timed out: '+label);}
app.whenReady().then(async()=>{
  const width=1280,height=1810,pixels=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const n=(y*width+x)*4; pixels[n]=y<height/2?20:220; pixels[n+1]=(x%100<50&&y%100<50)?180:40; pixels[n+2]=y<height/2?220:20; pixels[n+3]=255;
  }
  const png=nativeImage.createFromBitmap(pixels,{width,height}).toPNG(),files=[];
  for(let i=0;i<8;i++){const name=`${i}.png`;fs.writeFileSync(path.join(folder,name),png);files.push({name,index:i,bytes:png.length});}
  fs.writeFileSync(path.join(folder,'content.json'),JSON.stringify({schemaVersion:1,status:'complete',title:'Synthetic GPU fixture',sourceId:'100',site:'ehentai',tags:[],files}));
  fs.writeFileSync(path.join(root,'settings.json'),JSON.stringify({downloadRoot:downloads}));
  instance=await createApplication({show:false,offscreen:true,dataPath:root});
  const {win,library}=instance,js=code=>win.webContents.executeJavaScript(code);
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message',(_e,_l,message)=>{if(/error|failed|refused/i.test(message))console.log(message);});
  await instance.libraryReady;
  await until(()=>js('!!window.readerImages && (readerImages.status.ready || !!readerImages.status.unavailable)'),'model startup');
  const startup=await js('readerImages.status');console.log('GPU startup:',startup);assert.equal(startup.unavailable,'');assert.equal(startup.ready,true);
  const tiny=Array.from({length:8*12*4},(_,i)=>i%4===3?255:(i*73+Math.floor(i/32)*19)%256);
  const expected=require('../test/helpers/anime4k-reference.cjs')(fs.readFileSync(path.resolve('src/ui/vendor/Anime4K_Upscale_CNN_x2_S.glsl'),'utf8'),8,12,tiny);
  const actual=await js(`new Promise((resolve,reject)=>{
    const worker=new Worker('anime4k-worker.js');const timer=setTimeout(()=>{worker.terminate();reject(new Error('Parity timeout'));},10000);
    worker.onmessage=async({data})=>{
      if(data.type==='ready'){const image=await createImageBitmap(new ImageData(new Uint8ClampedArray(${JSON.stringify(tiny)}),8,12));worker.postMessage({id:1,image,scale:2},[image]);}
      else{clearTimeout(timer);worker.terminate();if(data.error){reject(new Error(data.error));return;}const canvas=new OffscreenCanvas(16,24),ctx=canvas.getContext('2d');ctx.drawImage(data.bitmap,0,0);data.bitmap.close();resolve([...ctx.getImageData(0,0,16,24).data]);}
    };
  })`);
  const maxDifference=Math.max(...actual.map((v,i)=>Math.abs(v-expected[i])));assert.ok(maxDifference<=3,'GPU agrees with independent CPU network within FP16 rounding: '+maxDifference);console.log('CPU/GPU parity max difference:',maxDifference);
  const id=(await library.call('query',{})).books[0].id;
  const reads=new Map(),originalCall=library.call.bind(library);
  library.call=(method,input)=>{if(method==='asset'&&input.id===id)reads.set(input.page,(reads.get(input.page)||0)+1);return originalCall(method,input);};
  await js(`window.originalPaints=0;window.enhancedPaints=0;window.tracking=true;window.readerFrames=[];
    function track(){if(!tracking)return;const image=document.querySelector('.reader-spread:not(.reader-pending) .reader-image'),stage=document.querySelector('.reader-stage');if(image){if(image.dataset.upscaled)enhancedPaints++;else originalPaints++;const r=image.getBoundingClientRect();readerFrames.push({w:stage.clientWidth,h:stage.clientHeight,sw:stage.scrollWidth,sh:stage.scrollHeight,top:r.top,left:r.left,iw:r.width,ih:r.height,upscaled:!!image.dataset.upscaled});}requestAnimationFrame(track);}requestAnimationFrame(track);
    readerUI.open(${id},0,{},()=>document.getElementById('library-dialog-close').click())`);
  await until(()=>js(`!!document.querySelector('[data-upscaled="2"]')`),'2x replacement');
  assert.ok(await js('originalPaints')>0,'original received a paint before enhancement');
  await until(()=>js('readerImages.status.enhanced.filter(x=>x.width===2560).length===4'),'three lookahead pages');
  const first=await js('readerImages.status');console.log('2x:',first);
  const frames=await js('readerFrames');console.log('Reader image area:',[...new Set(frames.map(f=>`${f.w}x${f.h}`))]);
  assert.ok(frames.every(f=>f.sw<=f.w&&f.sh<=f.h),'unzoomed page must not produce transient scrollbars');
  assert.equal(new Set(frames.map(f=>`${f.w}:${f.h}:${f.top}:${f.iw}:${f.ih}`)).size,1,'image loading and upscaling must keep reader geometry stable');
  assert.equal((await library.call('get',id)).pageState.some(p=>p.page>0&&p.read),false,'prefetch does not mark pages read');
  const color=await js(`(()=>{const c=document.querySelector('[data-upscaled]'),ctx=c.getContext('2d');return {top:[...ctx.getImageData(40,40,1,1).data],bottom:[...ctx.getImageData(40,c.height-40,1,1).data],width:c.width,height:c.height};})()`);
  assert.deepEqual([color.width,color.height],[2560,3620]);assert.ok(color.top[0]>color.top[2]+100,'top stays red');assert.ok(color.bottom[2]>color.bottom[0]+100,'bottom stays blue');
  const nextReads=reads.get(1);assert.ok(nextReads>0);
  await js(`document.querySelector('[aria-label="Next page"]').click()`);
  await until(()=>js('document.querySelector("[data-upscaled]")?.getAttribute("alt")==="Page 2"'),'cached next page');
  assert.equal(reads.get(1),nextReads,'preloaded original requires no new drive read');
  // Rapid navigation must never install an old page's enhancement.
  await js(`for(let i=0;i<4;i++)document.querySelector('[aria-label="Next page"]').click()`);
  await until(()=>js('document.querySelector(".reader-spread:not(.reader-pending) [data-upscaled]")?.getAttribute("alt")==="Page 6"'),'latest page wins');
  await js('readerUI.close();void 0');assert.equal((await js('readerImages.status')).ready,true,'model remains resident on close');
  assert.equal((await js('readerImages.status')).enhancedBytes,0,'page cache cleared on close');
  await js('hentdows.savePreferences("viewer",{upscale:4})');
  await js(`readerUI.open(${id},0,{},()=>document.getElementById('library-dialog-close').click())`);
  await until(()=>js(`!!document.querySelector('[data-upscaled="4"]')`),'4x replacement');
  await until(()=>js('!readerImages.status.running && readerImages.status.enhanced.length===4'),'bounded 4x lookahead');
  const four=await js('readerImages.status');console.log('4x:',four);assert.ok(four.enhancedBytes<=512*1024**2);assert.ok(four.originalBytes<=64*1024**2);
  assert.deepEqual([four.enhanced[0].width,four.enhanced[0].height],[5120,7240]);
  const pageFrames=await js('readerFrames');
  assert.ok(pageFrames.every(f=>f.sw<=f.w&&f.sh<=f.h),'page changes and 4x swaps must not create scrollbars');
  assert.equal(new Set(pageFrames.map(f=>`${f.w}:${f.h}:${f.top}:${f.iw}:${f.ih}`)).size,1,'page changes retain the same image area');
  await js('readerUI.close();void 0');
  await js('hentdows.savePreferences("viewer",{upscale:2,direction:"vertical"})');
  await js(`readerUI.open(${id},0,{},()=>document.getElementById('library-dialog-close').click())`);
  await until(()=>js(`!!document.querySelector('.vertical-page[data-page="0"] [data-upscaled]')`),'vertical enhancement');
  await js(`document.querySelector('.reader-page-input').value=6;document.querySelector('.reader-page-input').dispatchEvent(new Event('change'))`);
  await until(()=>js(`!!document.querySelector('.vertical-page[data-page="5"] [data-upscaled]')`),'vertical distant enhancement');
  // Stop pending work, but retain the worker/model for the next book.
  await js('readerUI.close();window.tracking=false;void 0');await delay(100);
  assert.equal((await js('readerImages.status')).enhancedBytes,0);
  fs.writeFileSync(path.join(root,'measurements.json'),JSON.stringify({device:first.device,two:first.enhanced,four:four.enhanced},null,2));
  console.log('Upscaling smoke passed: '+root);win.close();app.quit();
}).catch(async error=>{console.error(error);if(instance)console.log(await instance.win.webContents.executeJavaScript('window.readerImages?.status'));app.exit(1);});
