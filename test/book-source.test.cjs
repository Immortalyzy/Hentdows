const {test}=require('node:test');
const assert=require('node:assert/strict');
const {bookSourceUrl}=require('../src/book-source.cjs');

test('book source links resolve saved galleries, relative Hentoid addresses and Hitomi IDs',()=>{
  assert.equal(bookSourceUrl({site:'ehentai',url:'http://e-hentai.org/g/123/token/?p=3'}),'https://e-hentai.org/g/123/token/');
  assert.equal(bookSourceUrl({site:'exhentai',url:'/123/token/'}),'https://exhentai.org/g/123/token/');
  assert.equal(bookSourceUrl({site:'ehentai',url:'/g/123/token/'}),'https://e-hentai.org/g/123/token/');
  assert.equal(bookSourceUrl({site:'hitomi',url:'/123.html'}),'https://hitomi.la/galleries/123.html');
  assert.equal(bookSourceUrl({site:'hitomi',source_id:'123',url:''}),'https://hitomi.la/galleries/123.html');
  assert.equal(bookSourceUrl({site:'other',url:'https://example.org/book/123#page'}),'https://example.org/book/123#page');
});

test('book source links reject missing addresses, invalid relative URLs and non-web schemes',()=>{
  for(const url of ['javascript:alert(1)','file:///C:/Windows/test.exe','data:text/html,x','https://user:secret@example.org/book','//example.org/book','\\\\host\\file','/123/','https://'])assert.equal(bookSourceUrl({site:'ehentai',url}),null,url);
  assert.equal(bookSourceUrl({site:'ehentai',source_id:'123',url:''}),null);
  assert.equal(bookSourceUrl({site:'other',url:'/123/'}),null);
});
