const path=require('node:path');
const {createHash}=require('node:crypto');
const {galleryFromUrl}=require('./sites.cjs');
const MANIFESTS=['contentv2.json','content.json','data.json'];
const imageName=name=>typeof name==='string'&&name===path.basename(name)&&!/[\\/:\x00-\x1f]/.test(name)&&/\.(jpe?g|png|webp|avif|gif|bmp)$/i.test(name);
const bare=name=>name.replace(/\.[^.]+$/,'').toLowerCase();
const thumbnail=name=>/^(thumb|ext-thumb)/i.test(bare(name));
const number=(value,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(value)?Math.max(min,Math.min(max,value)):min;
const names=['fakku','pururin','hitomi','nhentai','tsumino','hentaicafe','asmhentai','asmhentai_comics','ehentai','fakku2','nexus','muses','doujins','luscious','exhentai','porncomix','hbrowse','hentai2read','hentaifox','mrm','manhwa','imhentai','toonily','allporncomic','pixiv','manhwa18','multporn','simply','hdporncomics','edoujin','ksk','anchira','deviantart','mangago','hiperdex','novelcrow','tmo','kemono','eromanga','yiffer','pawchive','lrr'];
const attributeNames=['artist','publisher','language','tag','translator','series','uploader','circle','character','category'];
function source(data){
  const raw=data.site??'none';const site=(typeof raw==='number'?names[raw]||'none':String(raw).toLowerCase().replace('e-hentai','ehentai')).replace(/[^a-z0-9_]/g,'').slice(0,50)||'none';
  const address=typeof data.url==='string'?data.url.slice(0,8192):'';let url='';
  if(['ehentai','exhentai'].includes(site)){
    const base=site==='ehentai'?'https://e-hentai.org':'https://exhentai.org';
    url=/^https?:\/\//i.test(address)?address:base+(address.startsWith('/g/')?address:'/g/'+address.replace(/^\//,''));
  }else if(site==='hitomi')url=/^https?:\/\//i.test(address)?address:'https://hitomi.la/galleries/'+address.replace(/^\/?galleries\//,'').replace(/^\//,'').replace(/\.html$/,'')+'.html';
  else if(/^https?:\/\//i.test(address))url=address;
  try{const u=new URL(url);if(u.username||u.password||!['http:','https:'].includes(u.protocol))url='';}catch{url='';}
  const gallery=galleryFromUrl(url.replace(/^http:/,'https:'));
  return {site,sourceId:gallery?.id||String(data.uniqueSiteId||address||'').slice(0,500),url:gallery?.url||url};
}
function tagsFrom(data){
  const tags=[];
  const add=(value,kind)=>{if(!value)return;const text=typeof value==='string'?value:value.name??value.description;if(typeof text!=='string'||!text.trim())return;let type=value.type??kind;type=typeof type==='number'?attributeNames[type]:String(type||'tag').toLowerCase();if(['serie','series','parody'].includes(type))type='series';if(type==='group')type='circle';if(!attributeNames.includes(type))type='tag';tags.push((type==='tag'&&text.includes(':')?text:type+':'+text).slice(0,200));};
  if(data.attributes&&typeof data.attributes==='object')for(const [kind,values] of Object.entries(data.attributes))for(const value of Array.isArray(values)?values:[values])add(value,kind);
  for(const [key,kind] of Object.entries({artists:'artist',artist:'artist',publishers:'publisher',translators:'translator',translator:'translator',tags:'tag',lstTags:'tag',serie:'series',language:'language',user:'uploader'}))for(const value of Array.isArray(data[key])?data[key]:[data[key]])add(value,kind);
  return [...new Set(tags)].slice(0,500);
}
// Receives only metadata and a directory's local image names/stat sizes. Never follows Android URIs or remote URLs.
function parseHentoid(data,images){
  if(!data||typeof data!=='object'||typeof data.title!=='string'||!Object.hasOwn(data,'site')&&!Array.isArray(data.imageFiles)&&!Object.hasOwn(data,'urlImageTitle')||data.imageFiles!=null&&!Array.isArray(data.imageFiles))throw new Error('Unsupported Hentoid metadata format.');
  if(data.site==null)data={...data,site:'FAKKU'};
  if((data.imageFiles?.length||0)>100000||images.length>100000)throw new Error('Book exceeds 100000 images.');
  const collator=new Intl.Collator('en',{numeric:true,sensitivity:'base'}),local=images.filter(f=>imageName(f.name)&&Number.isSafeInteger(f.bytes)&&f.bytes>0).sort((a,b)=>collator.compare(a.name,b.name));
  const exact=new Map(local.map(f=>[f.name.toLowerCase(),f])),stems=new Map();for(const file of local){const key=bare(file.name);if(stems.has(key))stems.set(key,null);else stems.set(key,file);}
  const metadata=new Map();let missing=0;
  for(const img of data.imageFiles||[]){
    if(!img||typeof img!=='object')throw new Error('Invalid Hentoid image entry.');
    const name=String(img.name||'');if(/[\\/:\x00-\x1f]/.test(name)||name==='..'||name==='.')throw new Error('Unsafe image name in Hentoid metadata.');
    const file=exact.get(name.toLowerCase())||stems.get(name.toLowerCase())||stems.get(bare(name));
    if(file&&!metadata.has(file.name))metadata.set(file.name,img);else if(name&&!file&&!thumbnail(name))missing++;
  }
  const pages=local.filter(f=>!thumbnail(f.name));
  pages.sort((a,b)=>{const aa=metadata.get(a.name)?.order,bb=metadata.get(b.name)?.order;const orderA=Number.isSafeInteger(aa)?aa:Infinity,orderB=Number.isSafeInteger(bb)?bb:Infinity;return orderA===orderB?collator.compare(a.name,b.name):orderA<orderB?-1:1;});
  if(!pages.length)throw new Error('No local image pages found. Copy the book images too; archive-only and online-only books are not supported.');
  const files=pages.map((f,index)=>({...f,index}));
  const pageState=pages.map((f,page)=>({page,read:metadata.get(f.name)?.isRead===true||metadata.get(f.name)?.read===true,favourite:metadata.get(f.name)?.favourite===true})).filter(s=>s.read||s.favourite);
  const previous=(data.imageFiles||[]).filter(i=>!thumbnail(String(i.name||''))).sort((a,b)=>(a.order||0)-(b.order||0))[number(data.lastReadPageIndex)];
  const previousFile=previous&&(exact.get(String(previous.name).toLowerCase())||stems.get(String(previous.name).toLowerCase())||stems.get(bare(String(previous.name))));
  const lastPage=previousFile?Math.max(0,pages.findIndex(f=>f.name===previousFile.name)):number(data.lastReadPageIndex,0,pages.length-1);
  const groups=(Array.isArray(data.groups)?data.groups:[]).filter(g=>g?.groupingId===98&&typeof g.groupName==='string'&&g.groupName.trim()).slice(0,100).map(g=>({name:g.groupName.trim().slice(0,120),position:number(g.order)}));
  return {...source(data),title:data.title.trim().slice(0,2000)||'Untitled',tags:tagsFrom(data),files,cover:local.find(f=>thumbnail(f.name))?.name||local.find(f=>metadata.get(f.name)?.isCover)?.name||files[0].name,
    downloaded:number(data.downloadDate),finished:number(data.downloadCompletionDate||data.downloadDate),uploaded:number(data.uploadDate),
    imported:{favourite:data.favourite===true,rating:number(data.rating,0,5),completed:data.completed===true,reads:number(data.reads),lastRead:number(data.lastReadDate),lastPage,pageState,groups},
    warnings:missing?[`${missing} referenced page(s) are missing; imported ${files.length} local pages.`]:[]};
}
function imageSignature(images){const hash=createHash('sha256');for(const image of [...images].sort((a,b)=>a.name.localeCompare(b.name)))hash.update(JSON.stringify([image.name,image.bytes,image.mtimeMs]));return hash.digest('hex');}
module.exports={MANIFESTS,imageName,parseHentoid,imageSignature};
