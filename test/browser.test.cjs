const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {BrowserState,validateBrowser,languageUrl}=require('../src/browser-state.cjs');
test('bookmarks persist order, edits, homes and per-source reading positions',()=>{
  const file=path.join(fs.mkdtempSync(path.resolve('artifacts/browser-test-')),'browser.json'),state=new BrowserState(file);
  state.mutate('save',{url:'https://e-hentai.org/?f_search=books',title:'Books'});state.mutate('save',{url:'https://hitomi.la/index-english.html',title:'English'});
  const id=state.data.bookmarks[0].id;state.mutate('home',{id});state.remember('https://e-hentai.org/?page=8','Page eight',734);
  assert.equal(state.start('ehentai',false).url,'https://e-hentai.org/?f_search=books');assert.equal(state.start('ehentai',true).scroll,734);
  state.closePage('https://e-hentai.org/?page=8');state.remember('https://hitomi.la/?page=3','Three',100);assert.equal(state.reopen().url,'https://e-hentai.org/?page=8');
  state.mutate('save',{id,url:'https://e-hentai.org/?f_search=books',title:'New title'});state.mutate('move',{id,direction:1});
  const loaded=new BrowserState(file);assert.equal(loaded.data.bookmarks[1].title,'New title');assert.equal(loaded.reopen().url,'https://e-hentai.org/?page=8');assert.equal(loaded.start('hitomi',true).url,'https://hitomi.la/?page=3');
  loaded.mutate('home',{id});assert.equal(loaded.start('ehentai',false).url,'https://e-hentai.org/');loaded.mutate('remove',{id});assert.equal(loaded.data.bookmarks.length,1);
});
test('bookmark imports validate the whole batch, deduplicate URLs and reject unsafe navigation',()=>{
  const file=path.join(fs.mkdtempSync(path.resolve('artifacts/browser-test-')),'browser.json'),state=new BrowserState(file);
  state.mutate('import',[{url:'https://exhentai.org/?page=2',title:'Two'},{url:'https://exhentai.org/?page=2',title:'Same'}]);assert.equal(state.data.bookmarks.length,1);
  for(const url of ['file:///C:/secret','https://example.org/','javascript:alert(1)','https://e-hentai.org:444/','https://user:secret@exhentai.org/'])assert.throws(()=>state.mutate('import',[{url:'https://hitomi.la/'},{url}]));
  assert.equal(new BrowserState(file).data.bookmarks.length,1);state.remember('https://forums.e-hentai.org/index.php?act=Login','Login');assert.equal(state.data.closed,null);
});
test('browser preferences validate connection settings and Hitomi language URLs',()=>{
  const settings=validateBrowser({resumeLast:true,proxy:'socks5://localhost:9050'});assert.equal(settings.quickDownload,true);assert.equal(settings.resumeLast,true);
  for(const patch of [{resumeLast:'true'},{unknown:true},{proxy:'http://user:password@host:1234'},{proxy:'file:///C:/'},{proxy:'https://host/path'},{dns:'invalid'},{language:'../secret'}])assert.throws(()=>validateBrowser(patch));
  assert.equal(languageUrl('https://hitomi.la/?page=1','english'),'https://hitomi.la/index-english.html?page=1');assert.equal(languageUrl('https://hitomi.la/artist/test-all.html','chinese'),'https://hitomi.la/artist/test-chinese.html');assert.equal(languageUrl('https://hitomi.la/?page=2','english'),null);assert.equal(languageUrl('https://exhentai.org/','english'),null);
});
