const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validatePreferences,LIBRARY_SETTINGS,VIEWER_SETTINGS}=require('../src/reading-settings.cjs');
test('library and viewer preferences migrate independently and reject invalid IPC values',()=>{
  const library=validatePreferences('library',{}),viewer=validatePreferences('viewer',{});
  assert.equal(library.endless,true);assert.equal(library.pageSize,20);assert.equal(viewer.resume,true);assert.equal(viewer.readThreshold,1);
  assert.equal(validatePreferences('viewer',{twoPages:true},viewer).wheel,true);
  for(const [section,patch] of [['library',{pageSize:100000}],['library',{endless:1}],['viewer',{color:'url(file:///x)'}],['viewer',{nextKey:'Escape'}],['viewer',{nextKey:'PageUp'}],['viewer',{colorOpacity:101}],['viewer',{fit:'injection'}],['other',{}]])assert.throws(()=>validatePreferences(section,patch));
  for(const [section,schema] of [['library',LIBRARY_SETTINGS],['viewer',VIEWER_SETTINGS]])for(const field of schema){
    assert.equal(validatePreferences(section,{[field.key]:field.default})[field.key],field.default);
    if(field.type==='select')for(const c of field.choices)assert.equal(validatePreferences(section,{[field.key]:c.value})[field.key],c.value);
  }
});
