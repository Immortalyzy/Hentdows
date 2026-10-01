const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {parseHentoid}=require('../src/hentoid-import.cjs');
const {Library}=require('../src/library.cjs');
const images=['thumb.jpg','001.png','002.png','010.png'].map(name=>({name,bytes:12}));
function metadata(extra={}){return {title:'Synthetic Hentoid book',site:'EHENTAI',url:'/123/token/',status:'DOWNLOADED',downloadDate:1700000000000,downloadCompletionDate:1700000000100,uploadDate:1699999999999,favourite:true,rating:4,completed:true,reads:3,lastReadDate:1700000000200,lastReadPageIndex:1,attributes:{ARTIST:[{name:'Fixture artist',type:'ARTIST'}],SERIE:[{name:'Fixture series',type:'SERIE'}],LANGUAGE:[{name:'english',type:'LANGUAGE'}],TAG:[{name:'female:glasses',type:'TAG'}]},imageFiles:[{name:'thumb',order:0,isCover:true},{name:'002',order:2,favourite:true,isRead:true},{name:'001',order:1,isRead:true},{name:'010',order:3}],groups:[{groupingId:98,groupName:'Imported shelf',order:7}],...extra};}
test('Hentoid V2 preserves source, image order, tags, ratings, page state and custom groups',()=>{
  const book=parseHentoid(metadata(),images);assert.equal(book.url,'https://e-hentai.org/g/123/token/');assert.equal(book.sourceId,'123');assert.deepEqual(book.files.map(f=>f.name),['001.png','002.png','010.png']);assert.equal(book.cover,'thumb.jpg');
  assert.ok(book.tags.includes('artist:Fixture artist'));assert.ok(book.tags.includes('series:Fixture series'));assert.ok(book.tags.includes('female:glasses'));assert.equal(book.imported.rating,4);assert.equal(book.imported.lastPage,1);assert.equal(book.imported.pageState[1].favourite,true);assert.equal(book.imported.groups[0].position,7);
  const firstCover=parseHentoid(metadata({imageFiles:[{name:'001',order:1,isCover:true}]}),images.slice(1));assert.equal(firstCover.files.length,3);assert.equal(firstCover.cover,'001.png');
});
test('legacy Hentoid data imports without an image list and supports numeric sources and old attributes',()=>{
  const data={title:'Legacy fixture',site:14,url:'/456/token/',artists:[{name:'Old artist'}],language:{name:'japanese'},serie:{name:'Old series'},tags:[{name:'adventure'}]};
  const book=parseHentoid(data,images);assert.equal(book.site,'exhentai');assert.equal(book.sourceId,'456');assert.equal(book.files.length,3);assert.ok(book.tags.includes('artist:Old artist'));assert.ok(book.tags.includes('language:japanese'));assert.equal(book.imported.rating,0);
  assert.equal(parseHentoid({...data,site:'HITOMI',url:'/77.html'},images).url,'https://hitomi.la/galleries/77.html');
  assert.equal(parseHentoid({...data,site:'NHENTAI',url:'/88/'},images).site,'nhentai');
  const legacy=parseHentoid({title:'Oldest format',url:'https://www.fakku.net/manga/fixture',urlImageTitle:'https://example.org/cover.png',artist:{description:'Original artist'},lstTags:[{description:'adventure'}]},images);assert.equal(legacy.site,'fakku');assert.ok(legacy.tags.includes('artist:Original artist'));assert.ok(legacy.tags.includes('tag:adventure'));
});
test('Hentoid import rejects unsafe paths, bounds ratings, and reports missing local pages',()=>{
  for(const name of ['../outside','C:\\outside','https://host/file','..'])assert.throws(()=>parseHentoid(metadata({imageFiles:[{name}]}),images),/Unsafe/);
  assert.throws(()=>parseHentoid(metadata(),[]),/No local image/);assert.throws(()=>parseHentoid({title:'Unknown'},images),/Unsupported/);
  const partial=parseHentoid(metadata({rating:9}),images.slice(0,2));assert.equal(partial.imported.rating,5);assert.equal(partial.files.length,1);assert.match(partial.warnings[0],/2 metadata page/);
});

test('Hentoid image matching ignores numeric padding and accepts JFIF without losing page state',()=>{
  const book=parseHentoid(metadata({lastReadPageIndex:1,imageFiles:[{name:'0002',order:1,isRead:true},{name:'1.jpg',order:2,favourite:true}]}),[{name:'002.jfif',bytes:12},{name:'0001.JPG',bytes:12}]);
  assert.deepEqual(book.warnings,[]);assert.deepEqual(book.files.map(f=>f.name),['002.jfif','0001.JPG']);assert.equal(book.imported.lastPage,1);assert.deepEqual(book.imported.pageState,[{page:0,read:true,favourite:false},{page:1,read:false,favourite:true}]);
  const ambiguous=parseHentoid(metadata({imageFiles:[{name:'01',order:1}]}),[{name:'1.png',bytes:12},{name:'001.png',bytes:12}]);assert.equal(ambiguous.warnings.length,1);
});
test('combined roots import Hentdows and Hentoid in place and preserve local edits on repeat scans',async t=>{
  const base=fs.mkdtempSync(path.resolve('artifacts/hentoid-import-test-')),native=path.join(base,'downloads'),foreign=path.join(base,'.Hentoid');fs.mkdirSync(native);fs.mkdirSync(foreign);
  const local=path.join(native,'ehentai','1');fs.mkdirSync(local,{recursive:true});fs.writeFileSync(path.join(local,'1.png'),'synthetic');fs.writeFileSync(path.join(local,'content.json'),JSON.stringify({schemaVersion:1,status:'complete',title:'Local book',site:'ehentai',sourceId:'1',tags:[],files:[{name:'1.png',bytes:9,index:0}]}));
  const sourceFiles=[];
  for(const [index,name] of ['contentV2.json','content.json','data.json'].entries()){
    const folder=path.join(foreign,'source','book'+index);fs.mkdirSync(folder,{recursive:true});for(const image of images)fs.writeFileSync(path.join(folder,image.name),'synthetic');
    const filename=path.join(folder,name),data=JSON.stringify(metadata({title:'Imported '+index,url:`/${index+10}/token/`}));fs.writeFileSync(filename,data);sourceFiles.push({folder,filename,data});
  }
  const library=new Library(path.join(base,'index.sqlite'));t.after(()=>library.close());await library.call('addRoot',native);const root=await library.call('addRoot',foreign);let report=await library.call('scan');assert.equal(report.added,4);assert.deepEqual(report.errors,[]);assert.equal((await library.call('query',{})).total,4);assert.equal((await library.call('query',{root:root.id})).total,3);
  const imported=(await library.call('query',{query:'Imported 0'})).books[0],book=await library.call('get',imported.id);assert.equal(book.rating,4);assert.equal(book.reads,3);assert.equal(book.progress,2/3);assert.equal(book.pageState[1].favourite,1);assert.equal((await library.call('groups'))[0].books,3);
  assert.equal(await library.call('asset',{id:book.id,page:1}),path.join(sourceFiles[0].folder,'002.png'));
  await library.call('update',{ids:[book.id],patch:{rating:2,title:'Local edit',resetRead:true}});await library.call('group',{action:'remove',id:book.groups[0],ids:[book.id]});
  report=await library.call('scan');assert.equal(report.added,0);assert.equal((await library.call('query',{})).total,4);
  for(const entry of sourceFiles)assert.equal(fs.readFileSync(entry.filename,'utf8'),entry.data);
  fs.writeFileSync(sourceFiles[0].filename,JSON.stringify(metadata({title:'Changed on Android'})));await library.call('scan');const edited=await library.call('get',book.id);assert.equal(edited.title,'Local edit');assert.equal(edited.rating,2);assert.equal(edited.reads,0);assert.equal(edited.groups.length,0);
  await assert.rejects(()=>library.call('addRoot',base),/contains an existing/);assert.equal((await library.call('addRoot',sourceFiles[0].folder)).id,root.id);
  fs.renameSync(foreign,path.join(base,'offline'));report=await library.call('scan');assert.ok(report.errors.length);assert.equal((await library.call('query',{})).total,4);
});
test('malformed Hentoid metadata reports errors while healthy books still import',async t=>{
  const base=fs.mkdtempSync(path.resolve('artifacts/hentoid-import-test-')),good=path.join(base,'good'),bad=path.join(base,'bad');fs.mkdirSync(good);fs.mkdirSync(bad);fs.writeFileSync(path.join(good,'contentV2.json'),JSON.stringify(metadata({imageFiles:[]})));fs.writeFileSync(path.join(good,'1.png'),'synthetic');fs.writeFileSync(path.join(bad,'contentV2.json'),'{bad');
  const library=new Library(path.join(base,'index.sqlite'));t.after(()=>library.close());await library.call('addRoot',base);const result=await library.call('scan');assert.equal(result.added,1);assert.equal(result.errors.length,1);assert.match(result.errors[0],/Cannot parse contentV2.json.*Recopy/);assert.equal((await library.call('query',{})).total,1);
});

test('extensionless images are detected by headers and partial warnings persist until the image arrives',async t=>{
  const base=fs.mkdtempSync(path.resolve('artifacts/hentoid-import-test-')),root=path.join(base,'book');fs.mkdirSync(root);
  const png=fs.readFileSync(path.resolve('src/assets/missing-ehentai.png'));
  fs.writeFileSync(path.join(root,'001'),png);fs.writeFileSync(path.join(root,'README'),'Not an image');fs.writeFileSync(path.join(root,'contentV2.json'),JSON.stringify(metadata({imageFiles:[{name:'001',order:1},{name:'002',order:2}]})));
  const library=new Library(path.join(base,'index.sqlite'));t.after(()=>library.close());await library.call('addRoot',root);
  for(let i=0;i<2;i++){const report=await library.call('scan');assert.equal(report.errors.length,1);assert.match(report.errors[0],/Unmatched names: "002"/);assert.equal((await library.call('query',{})).books[0].pages,1);}
  fs.writeFileSync(path.join(root,'0002'),png);assert.deepEqual((await library.call('scan')).errors,[]);const book=(await library.call('query',{})).books[0];assert.equal(book.pages,2);assert.equal(await library.call('asset',{id:book.id,page:1}),path.join(root,'0002'));assert.equal((await library.call('scan')).added,0);
});

test('a complete Hentoid root includes every source and numbered source folder beyond 250 books',async t=>{
  const base=fs.mkdtempSync(path.resolve('artifacts/hentoid-import-test-')),root=path.join(base,'.Hentoid');fs.mkdirSync(root);
  const buckets=[['ehentai',3],['exhentai',250],['exhentai1',250],['exhentai2',4],['exhentai10',2],['hitomi',3]];
  const expected=buckets.reduce((count,[,size])=>count+size,0);
  for(const [source,count] of buckets)for(let i=0;i<count;i++){
    const folder=path.join(root,source,'book-'+i);fs.mkdirSync(folder,{recursive:true});
    fs.writeFileSync(path.join(folder,'001.png'),'synthetic');
    fs.writeFileSync(path.join(folder,'contentV2.json'),JSON.stringify(metadata({title:`${source} fixture ${i}`,site:source.startsWith('exhentai')?'EXHENTAI':source.toUpperCase(),url:`/${i+1}/token/`,imageFiles:[{name:'001',order:1}]})));
  }
  const library=new Library(path.join(base,'index.sqlite'));t.after(()=>library.close());await library.call('addRoot',root);
  const report=await library.call('scan');assert.equal(report.added,expected);assert.deepEqual(report.errors,[]);
  // Check all pages of results, not just the first UI-sized batch.
  const ids=new Set();for(let offset=0;offset<expected;offset+=60){const page=await library.call('query',{offset,limit:60});assert.equal(page.total,expected);for(const book of page.books)ids.add(book.id);}assert.equal(ids.size,expected);
  for(const [source,count] of buckets)assert.equal((await library.call('query',{query:`${source} fixture`})).total,count);
  const repeat=await library.call('scan');assert.equal(repeat.added,0);assert.equal(repeat.skipped,expected);assert.equal((await library.call('query',{})).total,expected);
});

test('parent metadata and manifest-named directories never hide descendant books',async t=>{
  const base=fs.mkdtempSync(path.resolve('artifacts/hentoid-import-test-')),root=path.join(base,'.Hentoid');fs.mkdirSync(root);
  fs.writeFileSync(path.join(root,'content.json'),'{malformed parent metadata');
  for(const source of ['exhentai','exhentai1','exhentai2','hitomi']){
    const parent=path.join(root,source),child=path.join(parent,'book');fs.mkdirSync(child,{recursive:true});
    // A valid book with children, unsupported metadata, a directory named like a
    // manifest, and a plain source folder must all permit continued traversal.
    if(source==='exhentai'){fs.writeFileSync(path.join(parent,'001.png'),'synthetic');fs.writeFileSync(path.join(parent,'contentV2.json'),JSON.stringify(metadata({imageFiles:[]})));}
    if(source==='exhentai1')fs.writeFileSync(path.join(parent,'data.json'),'{}');
    if(source==='exhentai2')fs.mkdirSync(path.join(parent,'contentV2.json'));
    fs.writeFileSync(path.join(child,'001.png'),'synthetic');fs.writeFileSync(path.join(child,'contentV2.json'),JSON.stringify(metadata({title:source+' child',imageFiles:[]})));
  }
  const library=new Library(path.join(base,'index.sqlite'));t.after(()=>library.close());await library.call('addRoot',root);
  let report=await library.call('scan');assert.equal(report.added,5);assert.equal(report.errors.length,2);assert.equal((await library.call('query',{})).total,5);
  report=await library.call('scan');assert.equal(report.added,0);assert.equal(report.skipped,5);assert.equal((await library.call('query',{})).total,5);
});
