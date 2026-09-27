const {test}=require('node:test'),assert=require('node:assert/strict');
const {identity,simplify,cosine,score,perceptualHash,hashSimilarity}=require('../src/duplicates.cjs');
const {DEFAULT_DOWNLOADS}=require('../src/settings.cjs');
test('duplicate identity joins E-hentai and ExHentai but keeps Hitomi independent',()=>{
  assert.equal(identity('ehentai',42),identity('exhentai',42));assert.notEqual(identity('hitomi',42),identity('ehentai',42));
});
test('duplicate similarity removes title annotations and distinguishes artists, language and chapters',()=>{
  const reference={title:'[Circle] Winter Garden [English]',tags:['artist:Alice Smith','language:english']};
  const options={...DEFAULT_DOWNLOADS,duplicateCover:false};
  assert.equal(simplify(reference.title),'winter garden');assert.equal(cosine('winter garden','winter garden'),1);
  assert.equal(score(reference,{title:'Winter Garden',tags:['artist:Smith Alice']},options),1);
  assert.equal(score(reference,{title:'Winter Garden',tags:['artist:Bob']},options),null);
  assert.equal(score(reference,{title:'Winter Garden',tags:['language:japanese']},{...options,duplicateLanguage:true}),null);
  assert.equal(score({title:'A Long Winter Garden Chapter 01'},{title:'A Long Winter Garden Chapter 02'},options),null);
  assert.equal(score(reference,{title:'Totally unrelated'},options),null);
});
test('perceptual cover hashes tolerate brightness changes and reject unrelated structure',()=>{
  const bitmap=Buffer.alloc(48*48*4,255),brighter=Buffer.from(bitmap),other=Buffer.from(bitmap);
  for(let y=0;y<48;y++)for(let x=0;x<48;x++)for(let c=0;c<3;c++){
    bitmap[(y*48+x)*4+c]=x<24?20:200;brighter[(y*48+x)*4+c]=x<24?30:230;other[(y*48+x)*4+c]=y<24?200:20;
  }
  const a=perceptualHash(bitmap),b=perceptualHash(brighter),c=perceptualHash(other);
  assert.ok(hashSimilarity(a,b)>.9);assert.ok(hashSimilarity(a,c)<.9);assert.equal(hashSimilarity(a,a),1);
  assert.equal(hashSimilarity(a,null),null);
});
