const {app,session,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const {createApplication}=require(process.env.HENTDOWS_TEST_ASAR?path.join(process.env.HENTDOWS_TEST_ASAR,'src/main.cjs'):'../src/main.cjs');
const root=path.resolve('artifacts',`queue-smoke-${Date.now()}`),downloads=path.join(root,'downloads');
fs.mkdirSync(downloads,{recursive:true});app.setPath('userData',root);app.disableHardwareAcceleration();
const png=fs.readFileSync(path.resolve('src/assets/missing-ehentai.png'));let fail=true,answer=0,questions=[],instance;
dialog.showMessageBox=async(_win,options)=>{questions.push(options);return {response:answer};};
async function until(predicate,label){for(let i=0;i<300;i++){if(await predicate())return;await delay(25);}throw new Error('Timed out: '+label);}
app.whenReady().then(async()=>{
  fs.writeFileSync(path.join(root,'settings.json'),JSON.stringify({downloadRoot:downloads,downloads:{autoStart:false}}));
  session.fromPartition('persist:hentdows-sources').protocol.handle('https',()=>new Response('<a href="https://e-hentai.org/g/1/key/" style="display:block;padding:30px">Winter Garden</a>',{headers:{'content-type':'text/html'}}));
  const metadata=g=>({title:Number(g.id)<=3?'Winter Garden':`Fixture ${g.id}`,tags:['artist:Fixture','language:english'],expectedPages:2,thumbnail:'https://images.example.org/cover.png'});
  instance=await createApplication({show:false,offscreen:true,dataPath:root,sourceFactory:()=>({
    getMetadata:async(g,signal)=>{await delay(50,null,{signal});return metadata(g);},
    resolveGallery:async(g,signal)=>{await delay(40,null,{signal});if(g.sourceId==='9'&&fail)throw new Error('Fixture HTTP 503');return {...metadata(g),pages:[0,1]};},
    resolveImage:async()=>({url:'https://images.example.org/page.png'}),fetchImage:async(_url,_ref,signal)=>{await delay(40,null,{signal});return new Response(png,{headers:{'content-type':'image/png'}});}
  })});
  const {win,browser,queue,library}=instance,js=code=>win.webContents.executeJavaScript(code),errors=[];
  win.webContents.on('console-message',(_e,_l,message)=>{if(/error|not defined|refused/i.test(message))errors.push(message);});
  const click=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const capture=async name=>{await delay(180);fs.writeFileSync(path.join(root,name+'.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());};
  await instance.libraryReady;await instance.navigate('https://e-hentai.org/');
  const feedback=[],send=browser.webContents.send.bind(browser.webContents);browser.webContents.send=(channel,...args)=>{if(channel==='browser:download-result')feedback.push(args[0]);return send(channel,...args);};
  const gesture=async()=>{win.focus();browser.webContents.focus();await delay(200);browser.webContents.debugger.attach('1.3');for(const clickCount of [1,2])for(const type of ['mousePressed','mouseReleased'])await browser.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type,x:50,y:40,button:'left',clickCount});browser.webContents.debugger.detach();};
  await gesture();await until(()=>feedback.length===1,'download acknowledgement');assert.equal(feedback[0].status,'queued');assert.equal(queue.jobs.length,1);assert.equal(queue.jobs[0].title,'Winter Garden');
  await delay(200);fs.writeFileSync(path.join(root,'queued-animation.png'),(await browser.webContents.capturePage()).toPNG());
  await gesture();await until(()=>feedback.length===2,'duplicate acknowledgement');assert.equal(feedback[1].status,'duplicate');assert.equal(queue.jobs.length,1);
  await js('hentdows.panel("queue")');await until(()=>js('document.querySelectorAll(".job").length===1'),'queue row');
  await capture('queue');
  await js('document.querySelector(".job").dispatchEvent(new MouseEvent("dblclick",{bubbles:true}))');await until(()=>js('!document.querySelector("#queue-selection").hidden'),'selection');
  await js('document.querySelector("#queue-action").value="freeze";document.querySelector("#queue-action").dispatchEvent(new Event("change"))');await until(()=>queue.jobs[0].status==='frozen','freeze');
  await click('#start-all');await delay(100);assert.equal(queue.jobs[0].status,'frozen');
  await js('hentdows.queueBulk("unfreeze",'+JSON.stringify([queue.jobs[0].id])+')');await click('#start-all');
  await until(async()=>(await library.call('query',{})).total===1&&queue.jobs.length===0,'finished auto archive');
  await until(()=>js('document.querySelectorAll(".job").length===0'),'finished hidden');
  await instance.navigate('https://exhentai.org/g/1/key/');const exact=await js('hentdows.enqueue()');assert.equal(exact.status,'duplicate');assert.equal(queue.jobs.length,0);
  await instance.navigate('https://e-hentai.org/g/2/key/');const cancelled=await js('hentdows.enqueue()');assert.equal(cancelled.status,'cancelled');assert.ok(questions.at(-1).detail.includes('Similarity: 100%'));assert.equal(queue.jobs.length,0);
  assert.ok(fs.existsSync(path.join(root,'cover-hashes.json')));
  answer=1;const kept=await js('hentdows.enqueue()');assert.equal(kept.status,'queued');assert.equal(queue.jobs.length,1);
  await js('hentdows.saveSettings({duplicateAsk:false})');
  const imported=await js('hentdows.queueImport("https://e-hentai.org/g/8/key/\\nhttps://e-hentai.org/g/9/key/")');assert.equal(imported.filter(r=>r.status==='queued').length,2);
  await js('hentdows.panel("queue")');await until(()=>js('document.querySelectorAll(".job").length===3'),'imported rows');
  await click('#queue-menu-button');await click('#queue-reverse');await until(()=>queue.jobs[0].sourceId==='9','reverse');
  await click('#start-all');await until(()=>queue.jobs.some(j=>j.status==='error'),'error');await until(async()=>(await library.call('query',{})).total===3,'other jobs finish');
  await click('#queue-errors-tab');await until(()=>js('document.querySelectorAll(".job").length===1'),'error tab');await capture('errors');
  await click('#queue-error-stats');assert.equal(await js('document.querySelector("#queue-dialog-content").textContent.includes("503")'),true);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});await until(()=>js('!document.querySelector("#queue-dialog").open'),'queue dialog back');assert.equal(instance.state().panel,'queue');
  fail=false;await click('#queue-retry-all');await until(async()=>(await library.call('query',{})).total===4&&queue.jobs.length===0,'retry');
  await click('#queue-pending-tab');await click('#queue-limit');await js('document.querySelector("#queue-dialog input").value=10;[...document.querySelectorAll("#queue-dialog button")].find(b=>b.textContent==="Set limit").click()');await until(()=>queue.dataLimit===10*1024**2,'data limit');
  win.setSize(390,600);await delay(100);assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true);await capture('narrow');
  assert.deepEqual(errors,[]);console.log('Queue smoke passed: '+root);win.close();app.quit();
}).catch(async error=>{console.error(error);if(instance){console.error(instance.state().error);fs.writeFileSync(path.join(root,'failure.png'),(await instance.win.webContents.capturePage()).toPNG());}app.exit(1);});
