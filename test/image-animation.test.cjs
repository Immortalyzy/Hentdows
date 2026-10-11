const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {animatedWebP,imageAnimation}=require('../src/image-animation.cjs');
const {animated,still}=require('./helpers/webp-fixtures.cjs');

test('WebP animation uses the VP8X animation flag, not transparency or filename',async t=>{
  assert.equal(animatedWebP(animated),true);
  assert.equal(animatedWebP(still),false);
  assert.equal(animatedWebP(animated.subarray(0,29)),false);
  const alphaOnly=Buffer.from(animated);alphaOnly[20]=0x10;
  assert.equal(animatedWebP(alphaOnly),false);
  const invalid=Buffer.from(animated);invalid.write('WAVE',8);
  assert.equal(animatedWebP(invalid),false);
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hentdows-webp-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  for(const name of ['animated.webp','extensionless','misnamed.jpg']){
    const file=path.join(root,name);await fs.writeFile(file,animated);
    assert.deepEqual(await imageAnimation(file),{animated:true});
  }
  const file=path.join(root,'still.webp');await fs.writeFile(file,still);
  assert.deepEqual(await imageAnimation(file),{animated:false});
  await assert.rejects(imageAnimation(path.join(root,'missing.webp')),/ENOENT/);
});
