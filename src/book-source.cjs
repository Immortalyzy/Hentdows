const {SITES,galleryFromUrl}=require('./sites.cjs');

// Resolve saved addresses only. A gallery token cannot be recovered from an EH ID.
function bookSourceUrl(book){
  let value=typeof book.url==='string'?book.url.trim():'';
  if(value.length>8192)return null;
  const site=SITES.find(s=>s.id===book.site);
  if(value&&!/^https?:\/\//i.test(value)){
    if(!site||/^[a-z][a-z0-9+.-]*:|^\/\/|\\/i.test(value))return null;
    if(site.id==='hitomi')value=site.url+'galleries/'+value.replace(/^\/?(?:galleries|reader)\//,'').replace(/^\//,'').replace(/\.html$/,'')+'.html';
    else value=site.url+(value.startsWith('/g/')?value.slice(1):'g/'+value.replace(/^\//,''));
    if(!galleryFromUrl(value))return null;
  }
  if(!value&&book.site==='hitomi'&&/^\d+$/.test(String(book.source_id||'')))value=`https://hitomi.la/galleries/${book.source_id}.html`;
  try{
    const url=new URL(value);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)return null;
    const gallery=galleryFromUrl(url.href.replace(/^http:/,'https:'));
    return gallery?.url||url.href;
  }catch{return null;}
}
module.exports={bookSourceUrl};
