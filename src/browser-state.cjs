const {randomUUID}=require('node:crypto');
const {readJson,writeJson}=require('./storage.cjs');
const {SITES,allowedNavigation}=require('./sites.cjs');
const bool=(key,group,title,value=false,summary='')=>({key,group,title,type:'boolean',default:value,summary});
const BROWSER_SETTINGS=[
  bool('resumeLast','Behaviour','Resume at last viewed page',false,'Each source opens its last viewed page instead of its homepage.'),
  bool('quickDownload','Behaviour','Quick download',true,'Double-click a gallery link to queue it. Turn off for normal website clicks.'),
  bool('grabPictures','Behaviour','Grab picture',false,'Double-click an image outside a gallery link to save it.'),
  bool('languageFilter','Behaviour','Language filter button',false,'Show a language button on supported Hitomi listing pages.'),
  {key:'language',group:'Behaviour',title:'Language filter',type:'text',default:'english',depends:'languageFilter',summary:'Enter the language in English.'},
  bool('lockBookmarks','Behaviour','Lock favourites panel',false,'Disable the Ctrl+B shortcut. The bookmarks button remains available.'),
  bool('augmented','Visuals','Augmented browser',true,'Remove known ad spaces on supported sources. Gallery metadata is parsed directly.'),
  bool('markDownloaded','Visuals','Mark downloaded books'),bool('markQueued','Visuals','Mark queued books'),
  bool('markBlocked','Visuals','Mark books with blocked tags',false,'Uses Downloader blocked tags and tags visible on the webpage or saved in the library.'),
  bool('forceLight','Visuals','Force light mode',false,'Ask webpages to use their light theme. Reloads the current page when changed.'),
  {key:'dns',group:'Connection',title:'DNS over HTTPS',type:'select',default:'system',choices:[['system','System default'],['cloudflare','Cloudflare'],['quad9','Quad9'],['adguard','AdGuard']].map(([value,label])=>({value,label}))},
  {key:'proxy',group:'Connection',title:'Proxy',type:'text',default:'',summary:'Leave empty for the Windows system proxy, or enter http://host:port, https://host:port or socks5://host:port. Applies to browsing and downloads.'}
];
function validateBrowser(patch,base={}){
  if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new Error('Invalid browser preferences.');
  const result={...Object.fromEntries(BROWSER_SETTINGS.map(f=>[f.key,f.default])),...base};
  for(const [key,value] of Object.entries(patch)){
    const field=BROWSER_SETTINGS.find(f=>f.key===key);
    if(!field||(field.type==='boolean'?typeof value!=='boolean':field.type==='select'?!field.choices.some(c=>c.value===value):typeof value!=='string'||value.length>500))throw new Error('Invalid browser preference: '+key);
    result[key]=typeof value==='string'?value.trim():value;
  }
  if(!/^[a-z][a-z -]{0,49}$/i.test(result.language))throw new Error('Enter a language name in English.');
  if(result.proxy){let u;try{u=new URL(result.proxy);}catch{throw new Error('Enter a valid proxy URL.');}if(!['http:','https:','socks5:'].includes(u.protocol)||!u.hostname||u.username||u.password||u.pathname!=='/'&&u.pathname!==''||u.search||u.hash)throw new Error('Use an HTTP, HTTPS or SOCKS5 proxy without credentials or a path.');}
  return result;
}
function siteFor(url){try{return SITES.find(s=>new URL(s.url).hostname===new URL(url).hostname)?.id||null;}catch{return null;}}
function validUrl(url){if(typeof url!=='string'||url.length>8192||!allowedNavigation(url)||!siteFor(url))throw new Error('Use a supported source page for this bookmark.');return new URL(url).href;}
function languageUrl(url,language){try{const u=new URL(url);if(u.hostname!=='hitomi.la'||u.search&&!['','?page=1'].includes(u.search))return null;if(u.pathname==='/'||u.pathname.endsWith('-all.html')){u.pathname=u.pathname==='/'?'/index-'+language.toLowerCase()+'.html':u.pathname.replace(/all\.html$/,language.toLowerCase()+'.html');return u.href;}}catch{}return null;}
class BrowserState{
  constructor(file){this.file=file;const data=readJson(file,{bookmarks:[],last:{},closed:null});if(!data||!Array.isArray(data.bookmarks)||!data.last)throw new Error('Invalid browser state. Your bookmarks have been preserved.');this.data=data;}
  save(){writeJson(this.file,this.data);}
  snapshot(){return structuredClone(this.data);}
  closePage(url){const entry=this.data.last[siteFor(url)];if(entry?.url===url){this.data.lastClosed={...entry};this.save();}}
  reopen(){return this.data.lastClosed||this.data.closed;}
  remember(url,title='',scroll=0){if(!siteFor(url)||!allowedNavigation(url))return;const site=siteFor(url),entry={url,title:String(title).slice(0,300),scroll:Number.isFinite(scroll)?Math.max(0,Math.min(scroll,10000000)):0};this.data.last[site]=entry;this.data.closed=entry;this.save();}
  start(site,resume){const source=SITES.find(s=>s.id===site);if(!source)throw new Error('Unknown source.');const saved=this.data.last[site];if(resume&&saved&&allowedNavigation(saved.url)&&siteFor(saved.url)===site)return saved;return {url:this.data.bookmarks.find(b=>b.site===site&&b.home)?.url||source.url,scroll:0};}
  mutate(action,input={}){
    const list=this.data.bookmarks;
    if(action==='save'){
      const url=validUrl(input.url),title=String(input.title||url).trim().slice(0,300);let item=input.id?list.find(b=>b.id===input.id):list.find(b=>b.url===url);
      if(input.id&&!item)throw new Error('Bookmark not found.');
      if(list.some(b=>b!==item&&b.url===url))throw new Error('This page is already bookmarked.');
      if(!item){if(list.length>=5000)throw new Error('Bookmark limit reached (5000).');item={id:randomUUID(),home:false};list.push(item);}
      if(item.site&&item.site!==siteFor(url))item.home=false;
      Object.assign(item,{url,title,site:siteFor(url)});
    }else if(action==='remove'){this.data.bookmarks=list.filter(b=>b.id!==input.id);}
    else if(action==='home'){const item=list.find(b=>b.id===input.id);if(!item)throw new Error('Bookmark not found.');const value=!item.home;for(const b of list)if(b.site===item.site)b.home=false;item.home=value;}
    else if(action==='move'){const i=list.findIndex(b=>b.id===input.id),j=i+input.direction;if(i<0||![-1,1].includes(input.direction))throw new Error('Invalid bookmark move.');if(j>=0&&j<list.length)[list[i],list[j]]=[list[j],list[i]];}
    else if(action==='import'){
      if(!Array.isArray(input)||input.length>5000)throw new Error('Import at most 5000 bookmarks.');
      const additions=input.map(b=>({url:validUrl(b.url),title:String(b.title||b.url).slice(0,300)}));
      const unique=new Map(list.map(b=>[b.url,b]));for(const b of additions)if(!unique.has(b.url))unique.set(b.url,{...b,id:randomUUID(),site:siteFor(b.url),home:false});
      if(unique.size>5000)throw new Error('Bookmark limit reached (5000).');this.data.bookmarks=[...unique.values()];
    }else throw new Error('Unknown bookmark action.');
    this.save();return this.snapshot();
  }
}
module.exports={BrowserState,BROWSER_SETTINGS,validateBrowser,siteFor,languageUrl};
