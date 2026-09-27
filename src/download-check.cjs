const fs=require('node:fs/promises');
const {nativeImage}=require('electron');
const {simplify,score,perceptualHash}=require('./duplicates.cjs');
const {readJson,writeJson}=require('./storage.cjs');
function createDuplicateChecker({library,queue,sources,file,getSettings}){
  const cache=readJson(file,{});let dirty=false;
  const covers=new Map(),pendingCovers=new Map();let coverBytes=0;
  function hash(data){
    // Animated GIFs are intentionally excluded like Hentoid's cover indexer.
    if(data.subarray(0,3).toString()==='GIF')return null;
    const image=nativeImage.createFromBuffer(data);if(image.isEmpty())return null;
    return perceptualHash(image.resize({width:48,height:48,quality:'good'}).toBitmap());
  }
  async function localHash(book){
    try{
      const filename=await library.call('asset',{id:book.id,page:'cover'}),stat=await fs.stat(filename),signature=`${filename}:${stat.size}:${stat.mtimeMs}`;
      if(cache[book.id]?.signature===signature)return cache[book.id].hash;
      const value=stat.size<=32*1024**2?hash(await fs.readFile(filename)):null;
      cache[book.id]={signature,hash:value};dirty=true;return value;
    }catch{return null;}
  }
  function loadCover(thumbnail,url,signal){
    if(pendingCovers.has(thumbnail))return pendingCovers.get(thumbnail);
    const request=fetchCover(thumbnail,url,signal);pendingCovers.set(thumbnail,request);request.finally(()=>pendingCovers.delete(thumbnail)).catch(()=>{});return request;
  }
  async function fetchCover(thumbnail,url,signal){
    if(!thumbnail)return null;
    if(covers.has(thumbnail))return covers.get(thumbnail);
    try{
      const response=await sources.fetchImage(thumbnail,url,signal);
      if(!response.ok){await response.body?.cancel();return null;}
      const type=(response.headers.get('content-type')||'').split(';')[0];
      if(!['image/jpeg','image/png','image/webp','image/gif','image/avif','image/bmp'].includes(type)){await response.body?.cancel();return null;}
      const reader=response.body.getReader(),chunks=[];let size=0;
      try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8*1024**2){await reader.cancel();return null;}chunks.push(Buffer.from(value));}}
      finally{reader.releaseLock();}
      const result={data:Buffer.concat(chunks),type};covers.set(thumbnail,result);coverBytes+=size;
      while(coverBytes>32*1024**2){const key=covers.keys().next().value;coverBytes-=covers.get(key).data.length;covers.delete(key);}
      return result;
    }catch(error){signal.throwIfAborted();return null;}
  }
  const check=async(gallery,metadata,signal)=>{
    const options=getSettings();if(!options.duplicateAsk)return null;
    const word=simplify(metadata.title).split(' ').sort((a,b)=>b.length-a.length)[0];if(!word||word.length<2)return null;
    const cover=options.duplicateCover?await loadCover(metadata.thumbnail,gallery.url,signal):null;
    const reference={...metadata,coverHash:cover?hash(cover.data):null};
    let best=null;
    const compare=async candidate=>{
      signal.throwIfAborted();
      if(options.duplicateCover&&reference.coverHash){
        if(candidate.queue){const cover=await loadCover(candidate.thumbnailUrl,candidate.url,signal);candidate.coverHash=cover?hash(cover.data):null;}
        else candidate.coverHash=await localHash(candidate);
      }
      const similarity=score(reference,candidate,options);
      if(similarity!==null&&(!best||similarity>best.similarity||similarity===best.similarity&&candidate.size>best.size))best={...candidate,similarity};
    };
    for(const job of queue.jobs)if(!['cancelled','complete'].includes(job.status)&&simplify(job.title).includes(word))await compare({id:job.id,title:job.title,tags:job.tags,site:job.site,thumbnailUrl:job.thumbnailUrl,url:job.url,pages:job.total||job.expectedPages,size:job.files.reduce((s,f)=>s+f.bytes,0),queue:true});
    for(let offset=0;;offset+=100){
      const candidates=await library.call('duplicateCandidates',{word,offset});
      for(const candidate of candidates)await compare(candidate);
      if(candidates.length<100)break;
      await new Promise(resolve=>setImmediate(resolve));
    }
    if(dirty){writeJson(file,cache);dirty=false;}return best;
  };
  check.loadCover=loadCover;return check;
}
module.exports={createDuplicateChecker};
