// Offline tag-action page: no real galleries, account, votes or library content.
const {app,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const {createApplication}=require(process.env.HENTDOWS_TEST_ASAR?path.join(process.env.HENTDOWS_TEST_ASAR,'src/main.cjs'):'../src/main.cjs');
const root=fs.mkdtempSync(path.resolve('artifacts/browser-tags-')),downloads=path.join(root,'downloads');
fs.mkdirSync(downloads);app.setPath('userData',root);app.disableHardwareAcceleration();
fs.writeFileSync(path.join(root,'settings.json'),JSON.stringify({downloadRoot:downloads,downloads:{autoStart:false,duplicateAsk:false},browser:{quickDownload:true}}));
const fixture=`<!doctype html><meta charset="utf-8"><title>Synthetic tag actions</title>
<style>a{display:block;padding:10px}body{margin:0}</style>
<div id="tagmenu_act">
<a id="vote" href="#" onclick="event.preventDefault();fetch('/api.php',{method:'POST',body:'synthetic vote'}).then(()=>document.body.dataset.voted='yes')"><span>Vote Up</span></a>
<a id="down" href="" onclick="event.preventDefault();document.body.dataset.down='yes'">Vote Down</a>
<a id="tagged" href="#" onclick="event.preventDefault();window.open('/tag/artist:fixture','_blank')">Show Tagged Galleries</a>
<a id="fragment" href="#details">Gallery details</a>
<a id="self" href="/g/42/key/?p=1" onclick="event.preventDefault();document.body.dataset.self='yes'">Gallery action</a>
</div>
<a id="gallery" href="/g/43/other/">Other gallery</a><div id="details">Details</div>`;
async function until(fn,label){for(let i=0;i<200;i++){if(await fn())return;await delay(25);}throw new Error('Timed out: '+label);}
app.whenReady().then(async()=>{
  let votes=0,requests=0;
  session.fromPartition('persist:hentdows-sources').protocol.handle('https',request=>{
    requests++;const u=new URL(request.url);
    if(u.pathname==='/api.php'){votes++;return new Response('{}',{headers:{'content-type':'application/json'}});}
    return new Response(fixture,{headers:{'content-type':'text/html'}});
  });
  const instance=await createApplication({show:false,offscreen:true,dataPath:root,sourceFactory:()=>({getMetadata:async()=>({title:'Synthetic gallery',tags:[],expectedPages:1})})});
  const {win,browser,queue}=instance,wc=browser.webContents,remote=code=>wc.executeJavaScript(code);
  await instance.libraryReady;
  async function click(selector,count=1){
    win.focus();wc.focus();await delay(100);
    const point=await remote(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    wc.debugger.attach('1.3');
    try{for(let n=1;n<=count;n++)for(const type of ['mousePressed','mouseReleased'])await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:n});}finally{wc.debugger.detach();}
  }
  for(const host of ['exhentai.org','e-hentai.org']){
    const gallery=`https://${host}/g/42/key/`;await instance.navigate(gallery);await delay(100);
    const before=votes;await click('#vote span');await until(()=>remote('document.body.dataset.voted==="yes"'),'native vote handler');assert.equal(votes,before+1);
    await click('#down');await until(()=>remote('document.body.dataset.down==="yes"'),'empty-href handler');
    await click('#self');await until(()=>remote('document.body.dataset.self==="yes"'),'same-gallery action');
    await click('#fragment');await until(()=>wc.getURL()===gallery+'#details','native fragment navigation');
    await delay(600);assert.equal(queue.jobs.length,0,'tag actions do not queue a gallery');
    await click('#tagged');await until(()=>wc.getURL()===`https://${host}/tag/artist:fixture`,'tagged galleries opens');
    await click('#gallery',2);await until(()=>queue.jobs.some(job=>job.url===`https://${host}/g/43/other/`),'real gallery quick download');
    assert.equal(wc.getURL(),`https://${host}/tag/artist:fixture`,'double click stays on results');
    assert.equal(await remote('typeof require+":"+typeof window.hentdows'),'undefined:undefined');
    await click('#gallery');await until(()=>wc.getURL()===`https://${host}/g/43/other/`,'real gallery single click');
    await win.webContents.executeJavaScript(`hentdows.queueBulk('remove',${JSON.stringify(queue.jobs.map(job=>job.id))})`);
  }
  assert.equal(votes,2);assert.ok(requests>2);
  console.log('Browser tag actions smoke passed: '+root);win.close();app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
