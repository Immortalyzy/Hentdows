const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {LibraryStore,SORTS}=require('../src/library-store.cjs');
const {Library}=require('../src/library.cjs');
function fixture(t){const directory=fs.mkdtempSync(path.resolve('artifacts','library-test-'));const store=new LibraryStore(path.join(directory,'library.sqlite'));const root=store.addRoot(directory);t.after(()=>store.close());return {store,directory,root};}
function book(root,id,extra={}){return {path:path.join(root.path,String(id)),root:root.id,signature:'1',title:`Book ${id}`,site:'ehentai',sourceId:String(id),url:`https://e-hentai.org/g/${id}/key/`,pages:2,size:200,downloaded:id*1000,finished:id*1000+1,uploaded:id*1000-1,files:[{name:'1.png',index:0,bytes:100},{name:'2.png',index:1,bytes:100}],cover:'1.png',tags:[],seen:1,...extra};}
test('storage reconnection retains book identity and reading metadata; removal only affects its index',t=>{
  const {store,directory,root}=fixture(t),other=store.addRoot(path.join(directory,'other')),id=store.index(book(root,7)),otherId=store.index(book(other,8));
  store.update({ids:[id],patch:{favourite:true,rating:5}});store.read({id,page:1});
  const changed=path.join(directory,'relocated');store.relocateRoot(root.id,changed);
  const saved=store.get(id);assert.equal(saved.path,path.join(changed,'7'));assert.equal(saved.rating,5);assert.equal(saved.favourite,1);assert.equal(saved.last_page,1);
  assert.equal(store.rootStats().find(r=>r.id===root.id).books,1);
  const marks=store.browserMarks([{site:'exhentai',sourceId:'7',url:'https://exhentai.org/g/7/key/'}]);assert.equal(marks[0].downloaded,true);
  store.removeRoot(root.id);assert.equal(store.query({}).total,1);assert.equal(store.get(otherId).source_id,'8');assert.equal(store.query({query:'Book 7'}).total,0);
});
test('library universal search matches literal title substrings, exact IDs and comma-separated attributes',t=>{
  const {store,root}=fixture(t);
  store.index(book(root,42,{title:'A 100% Winter Tale',tags:['artist:Alice','language:english','female:glasses']}));
  store.index(book(root,420,{title:'夏の物語',tags:['artist:Bob','language:english']}));
  store.index(book(root,3,{title:'Other',tags:['artist:Alice','language:japanese']}));
  const ids=query=>store.query({query,sort:'title'}).books.map(b=>b.source_id);
  assert.deepEqual(ids('WINTER'),['42']);assert.deepEqual(ids('100%'),['42']);assert.deepEqual(ids('42'),['42']);assert.deepEqual(ids('https://e-hentai.org/g/42/key/?p=1'),['42']);
  assert.deepEqual(ids('alice,english'),['42']);assert.deepEqual(ids('alice,missing'),[]);assert.deepEqual(ids('夏の'),['420']);
  assert.deepEqual(ids('" OR 1=1 --'),[]);assert.deepEqual(ids('glasses'),['42']);
});
test('advanced search implements AND/OR exclusions, missing attribute types and exact rating',t=>{
  const {store,root}=fixture(t),a=store.index(book(root,1,{tags:['artist:A','language:english']})),b=store.index(book(root,2,{tags:['language:english']})),c=store.index(book(root,3,{tags:['artist:B']}));
  store.update({ids:[a],patch:{favourite:true,rating:4,completed:true}});store.update({ids:[b],patch:{rating:5}});
  const search=f=>store.query({...f,sort:'downloaded',desc:false}).books.map(b=>b.id);
  assert.deepEqual(search({attrs:[{kind:'artist',name:'a'},{kind:'language',name:'english'}]}),[a]);
  assert.deepEqual(search({attrs:[{kind:'artist',name:'b'},{kind:'language',name:'english'}],combination:'or'}),[a,b,c]);
  assert.deepEqual(search({attrs:[{kind:'artist',name:'a',excluded:true}]}),[b,c]);
  assert.deepEqual(search({excludedTypes:['artist']}),[b]);assert.deepEqual(search({rating:4}),[a]);assert.deepEqual(search({favourite:0,completed:0}),[b,c]);
});
test('minimum star filter includes the threshold and survives dynamic groups and reader navigation',t=>{
  const {store,root}=fixture(t),ids=[];
  for(let rating=0;rating<=5;rating++){const id=store.index(book(root,rating+1));store.update({ids:[id],patch:{rating,favourite:rating===5}});ids.push(id);}
  const filters={rating:3,ratingAtLeast:true,sort:'downloaded',desc:false};
  assert.deepEqual(store.query(filters).books.map(b=>b.rating),[3,4,5]);
  assert.deepEqual(store.query({...filters,ratingAtLeast:false}).books.map(b=>b.rating),[3]);
  assert.deepEqual(store.query({rating:3}).books.map(b=>b.rating),[3]);
  assert.deepEqual(store.query({...filters,ratingAtLeast:'true'}).books.map(b=>b.rating),[3]);
  assert.equal(store.query({...filters,rating:0}).total,6);
  assert.equal(store.query({...filters,rating:5}).total,1);
  assert.equal(store.query({...filters,rating:-1}).total,6);
  assert.deepEqual(store.query({...filters,favourite:1}).books.map(b=>b.rating),[5]);
  assert.deepEqual(store.query({...filters,offset:1,limit:1}).books.map(b=>b.rating),[4]);
  assert.equal(store.adjacent({id:ids[3],filters,direction:1}),ids[4]);
  const group=store.group({action:'save',name:'Three stars and up',filters});
  assert.equal(store.query({group}).total,3);
  store.update({ids:[ids[2]],patch:{rating:3}});assert.equal(store.query({group}).total,4);
});

test('all book sorts are paged deterministically; custom order, stable shuffle and dynamic groups work',t=>{
  const {store,root}=fixture(t),ids=[];
  for(let i=1;i<=5;i++)ids.push(store.index(book(root,i,{title:`Title ${6-i}`,tags:[`artist:${6-i}`],pages:i,size:i*i*100})));
  for(const sort of Object.keys(SORTS)){const all=store.query({sort,limit:5}).books.map(b=>b.id),pages=[...store.query({sort,limit:2}).books,...store.query({sort,offset:2,limit:2}).books,...store.query({sort,offset:4,limit:2}).books].map(b=>b.id);assert.deepEqual(pages,all,sort);assert.equal(new Set(all).size,5);}
  assert.equal(store.query({sort:'title',desc:false}).books[0].source_id,'5');assert.equal(store.query({sort:'average',desc:false}).books[0].source_id,'1');
  const group=store.group({action:'save',name:'Shelf'});store.group({action:'assign',id:group,ids});store.group({action:'move',id:group,ids:[ids[1]],direction:-1});
  assert.deepEqual(store.query({group,sort:'custom',desc:false}).books.map(b=>b.id),[ids[1],ids[0],...ids.slice(2)]);
  const dynamic=store.group({action:'save',name:'Favourites',filters:{favourite:1}});assert.equal(store.query({group:dynamic}).total,0);store.update({ids:[ids[0]],patch:{favourite:true}});assert.equal(store.query({group:dynamic}).total,1);
  store.group({action:'delete',id:group});assert.equal(store.query({ungrouped:true}).total,5);
  store.update({ids:[ids[0]],patch:{tags:['artist:Shared']}});store.update({ids:[ids[1]],patch:{tags:['artist:Shared']}});
  store.group({action:'move',ids:[ids[1]],direction:-1,filters:{attrs:[{kind:'artist',name:'shared'}]}});
  assert.deepEqual(store.query({attrs:[{kind:'artist',name:'shared'}],sort:'custom',desc:false}).books.map(b=>b.id),[ids[1],ids[0]]);
});
test('refresh preserves edits and reading state; invalid bulk edits roll back',t=>{
  const {store,root}=fixture(t),input=book(root,1),id=store.index(input);
  store.update({ids:[id],patch:{title:'Edited',tags:['artist:Edited'],rating:3}});store.read({id,page:1,open:true});store.read({id,page:1,favourite:true});
  store.index({...input,title:'Remote title',signature:'2'});let b=store.get(id);assert.equal(b.title,'Edited');assert.equal(b.author,'Edited');assert.equal(b.progress,.5);assert.equal(b.last_page,1);assert.equal(b.reads,1);assert.equal(store.query({pageFavourite:true}).total,1);
  assert.throws(()=>store.update({ids:[id,999],patch:{rating:5}}));assert.equal(store.get(id).rating,3);
  store.update({ids:[id],patch:{resetRead:true}});b=store.get(id);assert.equal(b.reads,0);assert.equal(b.progress,0);assert.equal(store.query({pageFavourite:true}).total,1);
});
test('worker indexes completed manifests, restores detached books, preserves offline records and rejects traversal',async t=>{
  const directory=fs.mkdtempSync(path.resolve('artifacts','library-worker-test-')),downloads=path.join(directory,'downloads'),folder=path.join(downloads,'ehentai','42');fs.mkdirSync(folder,{recursive:true});
  const manifest={schemaVersion:1,status:'complete',title:'Fixture',site:'ehentai',sourceId:'42',tags:['artist:A'],files:[{name:'1.png',index:0,bytes:4}]};fs.writeFileSync(path.join(folder,'1.png'),'test');fs.writeFileSync(path.join(folder,'content.json'),JSON.stringify(manifest));
  const library=new Library(path.join(directory,'library.sqlite'));t.after(()=>library.close());await library.call('addRoot',downloads);await library.call('scan');let data=await library.call('query',{});assert.equal(data.total,1);const id=data.books[0].id;
  assert.equal(await library.call('asset',{id,page:0}),path.join(folder,'1.png'));await assert.rejects(library.call('asset',{id,page:'../1.png'}),/Image not found/);
  await library.call('update',{ids:[id],patch:{favourite:true}});assert.equal((await library.call('scan')).added,0);
  const moved=path.join(directory,'away');fs.renameSync(folder,moved);await library.call('scan');assert.equal((await library.call('get',id)).missing,1);assert.equal((await library.call('get',id)).favourite,1);fs.renameSync(moved,folder);
  await library.call('detach',[id]);await library.call('scan');assert.equal((await library.call('query',{attrs:[{kind:'artist',name:'a'}]})).total,0);
  await library.call('restoreDetached');await library.call('scan');assert.equal((await library.call('query',{})).total,1);
  const bad=path.join(downloads,'bad');fs.mkdirSync(bad);fs.writeFileSync(path.join(bad,'content.json'),JSON.stringify({...manifest,files:[{name:'../secret.png',index:0,bytes:4}]}));assert.equal((await library.call('scan')).errors.length,1);
  const restoredId=(await library.call('query',{})).books[0].id,backup=path.join(directory,'backup.sqlite');
  await library.call('export',{file:backup});await library.call('update',{ids:[restoredId],patch:{title:'Changed after backup'}});await library.call('restore',backup);
  assert.equal((await library.call('get',restoredId)).title,'Fixture');
  const invalid=path.join(directory,'invalid.sqlite');fs.writeFileSync(invalid,'invalid');await assert.rejects(library.call('restore',invalid));assert.equal((await library.call('get',restoredId)).title,'Fixture');
});
test('artist and series grouping remain paged beyond one hundred groups',t=>{
  const {store,root}=fixture(t);store.transaction(()=>{for(let i=1;i<=130;i++)store.index(book(root,i,{tags:[`artist:Studio ${String(i).padStart(3,'0')}`]}));});
  const first=store.facets({kind:'artist',limit:60}),last=store.facets({kind:'artist',offset:120,limit:60});assert.equal(first.total,130);assert.equal(first.entries.length,60);assert.equal(last.entries.length,10);assert.equal(last.entries[0].name,'Studio 121');
});
test('library metadata, searches and custom order survive reopening the database',()=>{
  const directory=fs.mkdtempSync(path.resolve('artifacts','library-restart-')),file=path.join(directory,'library.sqlite');let store=new LibraryStore(file);const root=store.addRoot(directory),id=store.index(book(root,7));store.update({ids:[id],patch:{title:'Saved title',favourite:true,rating:5}});const group=store.group({action:'save',name:'Saved shelf'});store.group({action:'assign',id:group,ids:[id]});store.read({id,page:0,open:true});store.close();
  store=new LibraryStore(file);try{assert.equal(store.get(id).reads,1);assert.equal(store.get(id).rating,5);assert.equal(store.query({group,query:'Saved title',favourite:1,sort:'custom'}).total,1);}finally{store.close();}
});

test('reader adjacency follows every sort and filtered custom order across page boundaries',t=>{
  const {store,root}=fixture(t),ids=[];
  for(let i=0;i<80;i++)ids.push(store.index(book(root,i,{tags:['artist:Shared',i%2?'language:english':'language:japanese']})));
  const filters={attrs:[{kind:'artist',name:'shared'}]};store.group({action:'move',ids:[ids[1]],direction:-1,filters});
  for(const sort of Object.keys(SORTS))for(const desc of [true,false]){
    const f={...filters,sort,desc,limit:100},all=store.query(f).books;
    for(const at of [0,19,59,79])assert.equal(store.position({id:all[at].id,filters:f}),at,sort+' position');
    for(const at of [0,19,59,78])assert.equal(store.adjacent({id:all[at].id,filters:f,direction:1}),all[at+1].id,sort);
    assert.equal(store.adjacent({id:all.at(-1).id,filters:f,direction:1}),null);
    assert.equal(store.adjacent({id:all[1].id,filters:f,direction:-1}),all[0].id);
  }
  assert.equal(store.facets({kind:'artist'}).entries[0].size,16000);
  assert.equal(store.position({id:ids[0],filters:{query:'nonexistent'}}),null);
  assert.equal(store.position({id:999999,filters:{}}),null);
  assert.deepEqual(store.suggestions({kind:'language',sort:'title'}).map(a=>a.name),['english','japanese']);
});
