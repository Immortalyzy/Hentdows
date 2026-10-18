const { parentPort,workerData }=require('node:worker_threads');
const fs=require('node:fs');
const path=require('node:path');
const {LibraryStore}=require('./library-store.cjs');
const {MANIFESTS,imageName,hasImageHeader,parseHentoid,imageSignature}=require('./hentoid-import.cjs');
const store=new LibraryStore(workerData.file);
let scanning=false,cancelScan=false,scanToken=0;
const inside=(root,target)=>{const relative=path.relative(root,target);return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);};
const isManifest=entry=>(entry.isFile()||entry.isSymbolicLink())&&MANIFESTS.includes(entry.name.toLowerCase());
function indexDirectory(directory,root,seen=Date.now(),entries=fs.readdirSync(directory,{withFileTypes:true}),warn=()=>{}) {
  if(store.isDetached(directory)) return false;
  const manifest=MANIFESTS.map(name=>entries.find(e=>isManifest(e)&&e.name.toLowerCase()===name)).find(Boolean);
  if(!manifest)throw new Error('No supported book metadata found.');
  const filename=path.join(directory,manifest.name), stat=fs.lstatSync(filename);
  if(stat.isSymbolicLink()||stat.size>32*1024*1024) throw new Error('Invalid book manifest.');
  const signature=`2:${manifest.name}:${stat.size}:${stat.mtimeMs}:${fs.statSync(directory).mtimeMs}:${imageSignature(entries.filter(e=>imageName(e.name)).map(e=>({name:e.name})))}`,old=store.byPath(directory);
  if(old?.signature===signature) {store.markSeen(old.id,seen);return false;}
  let data;try{data=JSON.parse(fs.readFileSync(filename,'utf8').replace(/^\uFEFF/,''));}
  catch(error){if(error instanceof SyntaxError)throw new Error(`Cannot parse ${manifest.name}; this book was skipped. The JSON may be incomplete or damaged. Recopy it from Hentoid or regenerate its metadata in Hentoid, then refresh.`);throw error;}
  if(data.schemaVersion!==1){
    const images=[];
    for(const entry of entries.filter(e=>imageName(e.name))){
      if(entry.isSymbolicLink())throw new Error('Linked images cannot be imported.');
      if(entry.isFile()){
        const filename=path.join(directory,entry.name),fileStat=fs.lstatSync(filename);if(!fileStat.isFile()||fileStat.isSymbolicLink())continue;
        if(!entry.name.includes('.')){
          // Only sniff a small header for extensionless files; unrelated files
          // such as README are not pages, and image bodies stay on disk.
          const fd=fs.openSync(filename,'r');let header;
          try{const bytes=Buffer.alloc(64);header=bytes.subarray(0,fs.readSync(fd,bytes,0,bytes.length,0));}finally{fs.closeSync(fd);}
          if(!hasImageHeader(header))continue;
        }
        images.push({name:entry.name,bytes:fileStat.size});
      }
    }
    const book=parseHentoid(data,images);store.index({...book,path:directory,root:root.id,signature:book.warnings.length?'partial:'+signature:signature,pages:book.files.length,size:book.files.reduce((sum,f)=>sum+f.bytes,0),downloaded:book.downloaded||stat.birthtimeMs,finished:book.finished||stat.mtimeMs,seen});
    for(const warning of book.warnings)warn(warning);return true;
  }
  if(data.status!=='complete') return false;
  if(!Array.isArray(data.files)||!Array.isArray(data.tags)||data.files.length>100000) throw new Error('Invalid book manifest.');
  const files=data.files.filter(f=>!f.ignored).sort((a,b)=>a.index-b.index);
  if(!files.length||files.some(f=>!imageName(f.name)||!Number.isSafeInteger(f.bytes)||f.bytes<0)) throw new Error('Invalid image list.');
  store.index({path:directory,root:root.id,signature,title:String(data.title||data.sourceId||'Untitled').slice(0,2000),site:String(data.site||''),sourceId:String(data.sourceId||''),url:String(data.url||''),
    tags:data.tags.filter(t=>typeof t==='string').slice(0,500),pages:files.length,size:files.reduce((sum,f)=>sum+f.bytes,0),files,cover:imageName(data.thumbnail)?data.thumbnail:files[0].name,
    downloaded:Date.parse(data.createdAt)||stat.birthtimeMs,finished:Date.parse(data.completedAt)||stat.mtimeMs,uploaded:Number(data.uploadedAt)||0,seen});
  return true;
}
async function scan() {
  if(scanning) return {alreadyRunning:true};
  scanning=true;cancelScan=false;scanToken=Date.now();
  let checked=0,added=0,skipped=0;const errors=[];
  const progress=()=>parentPort.postMessage({event:'scan',state:{running:true,checked,added,skipped,errors:errors.slice(-5)}});
  progress();
  try {
    for(const root of store.roots()) {
      const pending=[root.path];let complete=true;
      while(pending.length&&!cancelScan) {
        const directory=pending.pop();
        let entries;
        try {entries=await fs.promises.readdir(directory,{withFileTypes:true});}
        catch(e) {complete=false;errors.push(`${directory}: ${e.message}`);continue;}
        if(entries.some(isManifest)) {
          try {if(indexDirectory(directory,root,scanToken,entries,message=>errors.push(`${directory}: ${message}`))) added++;else skipped++;}
          catch(e) {complete=false;errors.push(`${directory}: ${e.message}`);}
          checked++;
        }
        // Metadata is not a traversal boundary: a container or book can itself
        // contain book folders. Visit every source/bucket regardless of its name.
        for(const entry of entries) if(entry.isDirectory()&&!entry.isSymbolicLink()) pending.push(path.join(directory,entry.name));
        if(checked%50===0) {progress();await new Promise(resolve=>setImmediate(resolve));}
      }
      if(!cancelScan&&complete) store.finishScan(root.id,scanToken);
      if(cancelScan) break;
    }
    return {checked,added,skipped,cancelled:cancelScan,errors:errors.slice(-20)};
  } finally {scanning=false;parentPort.postMessage({event:'scan',state:{running:false,checked,added,skipped,cancelled:cancelScan,errors:errors.slice(-20)}});}
}
const methods={
  browserMarks:input=>store.browserMarks(input),
  storage:async()=>Promise.all(store.rootStats().map(async root=>{try{const stat=await fs.promises.stat(root.path);if(!stat.isDirectory())throw new Error('Not a folder');const space=await fs.promises.statfs(root.path);return {...root,online:true,free:space.bavail*space.bsize};}catch{return {...root,online:false,free:null};}})),
  removeRoot:id=>{if(scanning)throw new Error('Stop library refresh before removing a location.');return store.removeRoot(id);},
  relocateRoot:({id,directory})=>{
    if(scanning)throw new Error('Stop library refresh before reconnecting a location.');
    const real=fs.realpathSync(directory);if(!fs.statSync(real).isDirectory())throw new Error('Choose a folder.');
    if(store.roots().some(r=>r.id!==id&&(r.path.toLowerCase()===real.toLowerCase()||inside(r.path,real)||inside(real,r.path))))throw new Error('Storage locations must not overlap.');
    store.relocateRoot(id,real);return real;
  },
  duplicateCandidates:input=>store.duplicateCandidates(input),adjacent:input=>store.adjacent(input),query:input=>store.query(input),get:id=>store.get(id),suggestions:input=>store.suggestions(input),roots:()=>store.roots(),groups:()=>store.groups(),
  position:input=>store.position(input),facets:input=>store.facets(input),findSource:input=>store.findSource(input),indexed:paths=>store.indexed(paths),
  update:input=>store.update(input),group:input=>store.group(input),read:input=>store.read(input),detach:ids=>store.detach(ids),shuffle:()=>store.shuffle(),
  restoreDetached:()=>store.restoreDetached(),scan,cancel:()=>{cancelScan=true;},
  addRoot:directory=>{
    const real=fs.realpathSync(directory);if(!fs.statSync(real).isDirectory()) throw new Error('Choose a library folder.');
    const existing=store.roots().find(r=>r.path.toLowerCase()===real.toLowerCase()||inside(r.path,real));
    if(!existing&&store.roots().some(r=>inside(real,r.path)))throw new Error('This folder contains an existing storage location. Choose separate folders.');
    return existing||store.addRoot(real);
  },
  index:directory=>{
    const real=fs.realpathSync(directory),root=store.roots().find(r=>r.path===real||inside(r.path,real));
    if(!root) throw new Error('Book is outside the library folders.');
    return indexDirectory(real,root,scanning?scanToken:Date.now());
  },
  asset:({id,page})=>{
    const book=store.get(id),name=page==='cover'?book.cover:book.files[page]?.name;
    if(!imageName(name)) throw new Error('Image not found.');
    const root=store.roots().find(r=>r.id===book.root);
    const directory=fs.realpathSync(book.path),file=fs.realpathSync(path.join(directory,name));
    if(!root||!(root.path===directory||inside(root.path,directory))||!inside(directory,file)||!fs.statSync(file).isFile()) throw new Error('Image is outside its book folder.');
    return file;
  },
  export:({file})=>{store.db.exec(`VACUUM INTO '${String(file).replaceAll("'","''")}'`);},
  restore:file=>{if(scanning)throw new Error('Stop library refresh before restoring a backup.');store.restore(file);},
  close:()=>{cancelScan=true;if(scanning) throw new Error('Indexing is still stopping.');store.close();}
};
parentPort.on('message',async({id,method,input})=>{
  try {if(!Object.hasOwn(methods,method)) throw new Error('Unknown library operation.'); const value=await methods[method](input);parentPort.postMessage({id,value});}
  catch(error) {parentPort.postMessage({id,error:error.message});}
});
