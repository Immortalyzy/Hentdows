// Synthetic folders only. Shell recycling is simulated; fallback uses real fs.rm.
const {app,dialog,shell}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createApplication}=require(process.env.HENTDOWS_TEST_ASAR?path.join(process.env.HENTDOWS_TEST_ASAR,'src/main.cjs'):'../src/main.cjs');
const root=fs.mkdtempSync(path.resolve('artifacts/delete-smoke-')),downloads=path.join(root,'downloads');
fs.mkdirSync(downloads);app.setPath('userData',root);app.disableHardwareAcceleration();
for(let i=0;i<4;i++){
  const folder=path.join(downloads,String(i));fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'1.png'),'synthetic placeholder');
  fs.writeFileSync(path.join(folder,i===1?'contentV2.json':'content.json'),JSON.stringify({schemaVersion:1,status:'complete',title:`Deletion ${i}`,sourceId:String(i),site:'ehentai',tags:[],files:[{name:'1.png',bytes:21,index:0}]}));
}
fs.writeFileSync(path.join(root,'settings.json'),JSON.stringify({downloadRoot:downloads}));
app.whenReady().then(async()=>{
  let response=0,attempts=0,prompt;dialog.showMessageBox=async(_win,options)=>{prompt=options;return {response};};
  shell.trashItem=async target=>{attempts++;if(path.basename(target)==='0')await fs.promises.rename(target,path.join(root,'recycled'));else throw new Error('Simulated USB/remote Recycle Bin failure');};
  const instance=await createApplication({show:false,offscreen:true,dataPath:root});await instance.libraryReady;
  const {win,library}=instance,books=await Promise.all((await library.call('query',{sort:'title',desc:false})).books.map(book=>library.call('get',book.id)));
  const remove=ids=>win.webContents.executeJavaScript(`hentdows.library('delete',${JSON.stringify(ids)})`);
  assert.equal(await remove([books[0].id]),false);assert.equal(attempts,0);assert.ok(fs.existsSync(books[0].path));
  assert.match(prompt.detail,/permanently deleted/);response=1;
  assert.equal(await remove([books[0].id,books[1].id]),true);
  assert.ok(fs.existsSync(path.join(root,'recycled','1.png')));assert.equal(fs.existsSync(books[1].path),false);assert.equal((await library.call('query',{})).total,2);
  // A fallback failure must leave its book indexed, while earlier successful
  // deletions in the same batch remain removed and are published to the UI.
  const originalRm=fs.promises.rm;fs.promises.rm=async(target,options)=>{
    if(target===books[3].path)throw Object.assign(new Error('Synthetic permission denied'),{code:'EACCES'});
    return originalRm(target,options);
  };
  try{await assert.rejects(remove([books[2].id,books[3].id]),/Synthetic permission denied/);}finally{fs.promises.rm=originalRm;}
  assert.equal(fs.existsSync(books[2].path),false);assert.ok(fs.existsSync(books[3].path));assert.equal((await library.call('query',{})).total,1);
  assert.equal((await library.call('get',books[3].id)).id,books[3].id);
  console.log('Book deletion smoke passed: '+root);win.close();app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
