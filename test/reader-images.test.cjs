const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../src/ui/reader-images.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(animation = async () => false){
  let worker;
  const metadataRequests=[];
  const fetch=async url=>{metadataRequests.push(url);return {ok:true,json:async()=>({animated:await animation(url)})};};
  class Image{naturalWidth=1280;naturalHeight=1810;set src(value){this.url=value;if(value)queueMicrotask(()=>this.onload?.());}async decode(){}}
  class Worker{
    requests=[];constructor(){worker=this;queueMicrotask(()=>this.onmessage({data:{type:'ready',renderer:'Synthetic GPU'}}));}
    postMessage(data){this.requests.push(data);}terminate(){}
    finish(){const job=this.requests.shift(),bitmap={width:1280*job.scale,height:1810*job.scale,closed:false,close(){this.closed=true;}};this.onmessage({data:{type:'result',id:job.id,bitmap}});return bitmap;}
  }
  const window={};vm.runInNewContext(source,{window,Image,Worker,fetch,AbortSignal,queueMicrotask,createImageBitmap:async()=>({close(){}}),setTimeout,clearTimeout,Map,Set,Promise});
  return {cache:window.readerImages,metadataRequests,get worker(){return worker;}};
}
test('lookahead prioritizes the latest page, discards stale results and retains the model on close',async()=>{
  const f=fixture();await tick();f.cache.plan(['a','b','c','d'],2);await tick();assert.equal(f.worker.requests.length,1);
  const old=f.cache.get('a');f.cache.plan(['z','y'],2);assert.equal(await old,null);
  assert.equal(f.worker.finish().closed,true);await tick();const fresh=f.cache.get('z'),bitmap=f.worker.finish();assert.equal(await fresh,bitmap);await tick();f.worker.finish();
  f.cache.clear();assert.equal(bitmap.closed,true);assert.equal(f.cache.status.enhancedBytes,0);assert.equal(f.cache.status.ready,true);assert.equal(f.cache.status.originals.length,0);
});
test('4x lookahead respects its budget and retries an evicted page when it becomes current',async()=>{
  const f=fixture();await tick();f.cache.plan(['a','b','c','d'],4);
  for(let i=0;i<4;i++){await tick();f.worker.finish();}
  assert.ok(f.cache.status.enhancedBytes<=512*1024**2);assert.equal(await f.cache.get('d'),null);
  f.cache.plan(['d'],4);await tick();const pending=f.cache.get('d');f.worker.finish();assert.ok(await pending);f.cache.clear();
});
test('unavailable GPU resolves all waiters and preserves original preloading',async()=>{
  const f=fixture();await tick();f.cache.plan(['a','b'],2);await tick();const pending=f.cache.get('a');f.worker.onerror();
  assert.equal(await pending,null);assert.equal(f.cache.status.ready,false);assert.ok(f.cache.status.unavailable);assert.equal(f.cache.status.originals.length,2);f.cache.clear();
});

test('animated current/lookahead images bypass the GPU at 2x and 4x without blocking still pages',async()=>{
  const f=fixture(async url=>url.startsWith('animated'));await tick();
  for(const scale of [2,4]){
    f.cache.plan(['animated-current','still','animated-next'],scale);
    assert.equal(await f.cache.isAnimated('animated-current'),true);
    assert.equal(await f.cache.get('animated-current'),null);await tick();
    assert.equal(f.worker.requests.length,1);
    const still=f.cache.get('still');f.worker.finish();assert.ok(await still);
    assert.equal(await f.cache.get('animated-next'),null);
    assert.equal(f.worker.requests.length,0);
    assert.equal(f.cache.status.originals.length,3,'animated originals remain preloaded');
  }
  assert.equal(f.metadataRequests.length,3,'metadata shared across reader, lookahead and scaling changes');
  f.cache.clear();assert.equal(f.cache.status.ready,true);
});

test('failed animation detection keeps native images and stale metadata cannot enqueue old pages',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve);
  const f=fixture(async url=>{if(url.startsWith('old'))return gate;throw new Error('Synthetic unavailable header');});await tick();
  f.cache.plan(['old'],2);await tick();const old=f.cache.get('old');
  f.cache.plan(['new'],2);assert.equal(await old,null);release(false);
  assert.equal(await f.cache.get('new'),null);assert.equal(f.worker.requests.length,0);f.cache.clear();
});
