// Hentoid preferences.xml: interface/library and viewer screens. Values use
// explicit units instead of Android's resource-array indexes.
const select=(key,group,title,value,choices,summary)=>({key,group,title,type:'select',default:value,choices:choices.map(c=>({value:c[0],label:c[1]})),summary});
const bool=(key,group,title,value=true,summary)=>({key,group,title,type:'boolean',default:value,summary});
const number=(key,group,title,value,min,max)=>({key,group,title,type:'number',default:value,min,max});
const LIBRARY_SETTINGS=[
  bool('nostalgia','Library','Nostalgia mode',false,'Show source shortcuts above the library.'),
  select('display','Library','Display type','list',[['list','List'],['grid','Grid']]),
  bool('endless','Library','Endless Scroll',true,'Load books as you scroll. Only nearby rows stay rendered.'),
  {...select('pageSize','Library','Quantity Per Page',20,[20,40,60,80,100].map(n=>[n,String(n)])),disabledWhen:'endless'},
  bool('topButton','Library','Go to Top button'),
  ...[['gridTitle','Title'],['gridLanguage','Language'],['gridFavourite','Set favourite'],['gridRating','Set rating'],['gridSource','View source'],['gridStorage','Storage information']].map(([k,t])=>bool(k,'Library grid',t)),
  select('groupFigure','Library grid','Group figure','count',[['count','Number of books'],['size','Total size']]),
  select('cardWidth','Library grid','Book display width',150,[[100,'S'],[150,'M'],[200,'L'],[300,'XL'],[400,'XXL']]),
  select('searchDelay','Library search','Input delay threshold (general)',250,[[250,'250 ms'],[500,'500 ms'],[1000,'1 second'],[-1,'Search on Enter']]),
  select('numberDelay','Library search','Input delay threshold (number, URL)',1500,[[1000,'1 second'],[1500,'1.5 seconds'],[3000,'3 seconds'],[-1,'Search on Enter']]),
  select('attributeSort','Advanced search','Sorting order of displayed metadata','count',[['title','Alphabetical'],['count','Item count (most used first)']]),
  bool('attributeCount','Advanced search','Count available books')
];
const VIEWER_SETTINGS=[
  select('direction','Controls','Browse mode','ltr',[['ltr','Left to Right'],['rtl','Right to Left'],['vertical','Top to Bottom']]),
  bool('swipe','Page turn','Swipe / drag'),bool('fling','Page turn','Swipe to fling',false),
  bool('borderTap','Page turn','Border tap'),bool('largeTap','Page turn','Larger tap zone',false),
  bool('keyboard','Page turn','Keyboard left/right'),bool('wheel','Page turn','Mouse wheel / touchpad'),
  bool('doubleZoom','Zoom','Double-click to zoom'),bool('holdZoom','Zoom','Temporary zoom while holding',false),
  select('zoomCap','Zoom','Cap double-click and hold zoom',0,[[0,'No capping'],[2,'2×'],[4,'4×'],[6,'6×']]),
  ...[['previousKey','Previous page','PageUp'],['nextKey','Next page','PageDown'],['previousBookKey','Previous book','['],['nextBookKey','Next book',']']].map(([key,title,value])=>({key,group:'Additional keybindings',title,type:'key',default:value,summary:'Focus this field and press a key. Escape is reserved for Back.'})),
  bool('keepAwake','Visuals','Keep screen on'),bool('pageAnimation','Visuals','Enable page turn animation'),bool('zoomAnimation','Visuals','Enable zoom animation'),
  select('pageNumber','Visuals','Page number display','off',[['off','Disabled'],['bottom','Bottom center'],['top','Top center']]),
  select('rotate','Visuals','Auto-rotate pictures','off',[['off','Off'],['left','Auto-rotate left'],['right','Auto-rotate right']]),
  {key:'color',group:'Color filter',title:'Color filter',type:'color',default:'#ffffff'},
  number('colorOpacity','Color filter','Filter opacity (%)',0,0,100),
  bool('smartCrop','Rendering','Smart cropping',false,'Automatically remove solid borders. Original files are preserved.'),
  select('upscale','Rendering','Anime4K upscaling',2,[[0,'Off'],[2,'2× (fast)'],[4,'4× (two passes)']],'Shows the original first, then enhances pages smaller than 2048 pixels on the longest side. The GPU model stays loaded while the app runs. Originals remain unchanged.'),
  select('preloadPages','Rendering','Preload next pages',3,[[0,'Off'],[2,'2 pages'],[3,'3 pages']],'Loads originals and prepares upscaled pages ahead of you, within a bounded memory cache.'),
  select('fit','Horizontal reader','Display mode','fit',[['fit','Fit to screen'],['fill','Fill screen (proportionate)'],['stretch','Fill screen (stretch)']]),
  bool('keepZoom','Horizontal reader','Maintain zoom level between pages',false),bool('twoPages','Horizontal reader','Two pages (book) mode',false),
  select('gap','Vertical reader','Separating bars',0,[[0,'Off'],[8,'Small'],[20,'Medium'],[40,'Large']]),
  select('galleryColumns','Gallery','Number of columns for gallery',4,[2,3,4,5].map(n=>[n,String(n)])),
  bool('resume','Navigation & behaviour','Resume reading when reopening books',true,'Resume the last page, except after reaching the end.'),
  bool('openGallery','Navigation & behaviour','Always open in gallery mode',false),
  bool('chapterNavigation','Navigation & behaviour','Chaptered navigation',false,'Hentdows downloads have one chapter per book; chapter controls stay within that book.'),
  bool('continuous','Navigation & behaviour','Continuous reading',false,'Next page at the end opens the next book in the current library order.'),
  select('readThreshold','Navigation & behaviour','Mark book as read after N pages',1,[[-1,'Disabled'],[1,'1 page'],[2,'2 pages'],[5,'5 pages'],[0,'All pages']]),
  select('completeThreshold','Navigation & behaviour','Mark book as completed after N% pages',-1,[[-1,'Disabled'],...[10,25,33,50,75,100].map(n=>[n,`${n}%`])]),
  select('deleteDirection','Navigation & behaviour','Load direction after deleting book',1,[[1,'Next book'],[-1,'Previous book']]),
  select('slideDelay','Slideshow','Delay between pages (horizontal)',2000,[500,1000,2000,4000,8000,16000,30000].map(n=>[n,`${n/1000} seconds`])),
  select('slideSpeed','Slideshow','Scrolling speed (vertical)',50,[[5,'Geological'],[15,'Super slow'],[30,'Slow'],[50,'Normal'],[90,'Quick'],[150,'Fast'],[250,'Super fast']]),
  select('slideLoop','Slideshow','Loop','off',[['off','Stop at the end'],['chapter','Loop through current chapter'],['book','Loop through current book'],['continuous','Loop through current book; follow continuous mode']])
];
function defaults(schema){return Object.fromEntries(schema.map(s=>[s.key,s.default]));}
function validatePreferences(section,patch,base={}) {
  const schema=section==='library'?LIBRARY_SETTINGS:section==='viewer'?VIEWER_SETTINGS:null;
  if(!schema||!patch||typeof patch!=='object'||Array.isArray(patch))throw new Error('Invalid preferences.');
  const result={...defaults(schema),...base};
  for(const [key,value] of Object.entries(patch)){
    const f=schema.find(f=>f.key===key);
    const valid=f&&(f.type==='boolean'?typeof value==='boolean':f.type==='select'?f.choices.some(c=>c.value===value):f.type==='number'?Number.isInteger(value)&&value>=f.min&&value<=f.max:f.type==='color'?/^#[0-9a-f]{6}$/i.test(value):typeof value==='string'&&/^(?:[a-zA-Z0-9\[\],.;/\\'=\-]|PageUp|PageDown|Home|End|F[1-9]|F1[0-2])$/.test(value));
    if(!valid)throw new Error(`Invalid value for ${f?.title||key}.`);
    result[key]=value;
  }
  if(section==='viewer'){
    const keys=['previousKey','nextKey','previousBookKey','nextBookKey'].map(k=>result[k].toLowerCase());
    if(new Set(keys).size!==keys.length)throw new Error('Each reader shortcut must use a different key.');
  }
  return result;
}
module.exports={LIBRARY_SETTINGS,VIEWER_SETTINGS,validatePreferences};
