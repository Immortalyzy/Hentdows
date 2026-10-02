const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {deleteBookFolder}=require('../src/delete-book.cjs');
async function fixture(manifest='content.json'){
  const directory=await fs.mkdtemp(path.resolve('artifacts/delete-unit-')),base=path.join(directory,'library'),bookPath=path.join(base,'book');
  await fs.mkdir(bookPath,{recursive:true});if(manifest)await fs.writeFile(path.join(bookPath,manifest),'{}');
  await fs.writeFile(path.join(bookPath,'synthetic.txt'),'Synthetic fixture');
  return {directory,base,bookPath,book:{root:1,path:bookPath},root:{id:1,path:base}};
}
test('tries recycling first and permanently removes a validated book when recycling is unavailable',async()=>{
  for(const manifest of ['content.json','contentV2.json','data.json']){
    const f=await fixture(manifest);let attempts=0;
    assert.equal(await deleteBookFolder(f.book,f.root,async target=>{attempts++;assert.equal(target,f.bookPath);throw new Error('Recycle Bin unavailable');}),'deleted');
    assert.equal(attempts,1);await assert.rejects(fs.stat(f.bookPath),{code:'ENOENT'});assert.ok((await fs.stat(f.base)).isDirectory());
  }
});
test('a successful recycle does not permanently remove the destination',async()=>{
  const f=await fixture(),recycled=path.join(f.directory,'recycled');
  assert.equal(await deleteBookFolder(f.book,f.root,target=>fs.rename(target,recycled)),'recycled');
  assert.ok((await fs.stat(path.join(recycled,'synthetic.txt'))).isFile());
});
test('rejects roots, outside folders, linked folders and unrecognized metadata before trying trash',async()=>{
  const f=await fixture();let attempts=0;const trash=async()=>{attempts++;};
  await assert.rejects(deleteBookFolder({...f.book,path:f.base},f.root,trash),/Cannot delete/);
  await assert.rejects(deleteBookFolder(f.book,{id:1,path:f.bookPath},trash),/Cannot delete/);
  const unknown=await fixture(null);await assert.rejects(deleteBookFolder(unknown.book,unknown.root,trash),/metadata/);
  const link=path.join(f.base,'linked');await fs.symlink(f.bookPath,link,'junction');
  await assert.rejects(deleteBookFolder({...f.book,path:link},f.root,trash),/linked folder/);
  assert.equal(attempts,0);assert.ok((await fs.stat(f.bookPath)).isDirectory());
});
test('revalidates after a failed recycle and refuses a replaced directory junction',async()=>{
  const f=await fixture(),moved=path.join(f.directory,'moved');
  await assert.rejects(deleteBookFolder(f.book,f.root,async()=>{
    await fs.rename(f.bookPath,moved);await fs.symlink(moved,f.bookPath,'junction');throw new Error('Recycle failed');
  }),/linked folder/);
  assert.ok((await fs.stat(path.join(moved,'synthetic.txt'))).isFile());
});
