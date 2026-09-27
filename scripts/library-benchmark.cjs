// Synthetic metadata only: no network or real image files are read.
const fs=require('node:fs'),path=require('node:path');
const assert=require('node:assert/strict');
const {LibraryStore}=require('../src/library-store.cjs');
const rootPath=fs.mkdtempSync(path.resolve('artifacts','library-benchmark-'));
const store=new LibraryStore(path.join(rootPath,'library.sqlite')),root=store.addRoot(rootPath);
const started=performance.now();
for(let batch=0;batch<100;batch++)store.transaction(()=>{for(let n=0;n<1000;n++){
  const i=batch*1000+n;
  store.index({path:path.join(rootPath,String(i)),root:root.id,signature:'fixture',title:`Synthetic collection ${i} ${i%101===0?'winter':''}`,site:i%2?'ehentai':'hitomi',sourceId:String(i),url:'',pages:100,size:4*1024**2,downloaded:i*1000,finished:i*1000+100,uploaded:0,files:[{name:'1.png',index:0,bytes:4*1024**2}],cover:'1.png',tags:[`artist:Artist ${i%1000}`,`language:${i%2?'english':'japanese'}`,`series:Series ${i%200}`,'tag:common'],seen:1});
}});
const indexingMs=Math.round(performance.now()-started),results=[];
for(const [name,query] of [['First page',{}],['Last page',{offset:99960}],['Title substring',{query:'winter'}],['Tags with AND',{query:'artist 42,english'}],['Attribute filter',{attrs:[{kind:'artist',name:'artist 42'}]}],['Average page size',{sort:'average'}],['Read progress',{sort:'progress'}],['Stable random',{sort:'random'}]]){
  const start=performance.now(),result=store.query(query);results.push({name,ms:Math.round(performance.now()-start),total:result.total,returned:result.books.length});assert.ok(result.books.length<=60);
}
assert.equal(store.query({}).total,100000);
store.close();const report={books:100000,indexingMs,queries:results,databaseMiB:Math.round(fs.statSync(path.join(rootPath,'library.sqlite')).size/1024**2),rssMiB:Math.round(process.memoryUsage().rss/1024**2)};
fs.writeFileSync(path.join(rootPath,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
