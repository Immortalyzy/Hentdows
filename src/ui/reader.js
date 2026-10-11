(() => {
  const dialog=$('library-dialog'),body=$('library-dialog-content');
  const call=(action,input)=>api.library(action,input),prefs=()=>current.viewerSettings;
  let session=null,version=0,slideTimer,wheelTotal=0,wheelAt=0,lastWheel=0,clickTimer,holdTimer;
  const url=(id,page)=>`hentdows://app/library/${id}/${page}`;
  function planImages(s){
    if(s.gallery){readerImages.clear();return;}
    const visible=prefs().direction!=='vertical'&&prefs().twoPages?2:1,count=visible+prefs().preloadPages;
    const urls=Array.from({length:Math.min(count,s.book.files.length-s.page)},(_,i)=>url(s.book.id,s.page+i));
    readerImages.plan(prefs().upscale?urls:urls.slice(visible),prefs().upscale);
  }
  function enhance(s,page,host){
    const original=host._original,display=host.firstElementChild,factor=prefs().upscale;
    if(!original||original.dataset.animated==='true'||!factor||display?.dataset.upscaled===String(factor))return;
    // Two animation frames ensure a paint with the original, including cache hits.
    requestAnimationFrame(()=>requestAnimationFrame(async()=>{
      const active=()=>session===s&&host.isConnected&&host.firstElementChild===display&&prefs().upscale===factor;
      if(!active())return;
      const bitmap=await readerImages.get(url(s.book.id,page));
      if(!bitmap||!active())return;
      try{
        const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
        canvas.naturalWidth=bitmap.width;canvas.naturalHeight=bitmap.height;canvas.className='reader-image';canvas.alt=original.alt;canvas.setAttribute('alt',original.alt);canvas.setAttribute('aria-label',original.alt);
        canvas.getContext('2d').drawImage(bitmap,0,0);
        const enhanced=processed(canvas,host,original);enhanced.dataset.upscaled=String(factor);
        // Crop and rotation use the original framing to avoid a late layout jump.
        if(active())display.replaceWith(enhanced);
      }catch{/* A lost GPU context or an evicted bitmap leaves the original visible. */}
    }));
  }
  function stopSlide(){clearInterval(slideTimer);slideTimer=null;if(session)session.sliding=false;}
  function dispose(){clearTimeout(clickTimer);clearTimeout(holdTimer);session?.observer?.disconnect();}
  function close(){version++;stopSlide();dispose();session=null;readerImages.clear();body.replaceChildren();dialog.classList.remove('reader','reader-controls-hidden');run(()=>api.readerActive(false));}
  async function open(id,page,filters,onClose){
    close();const token=version,book=await call('get',id);if(token!==version)return;
    if(!book.files.length)throw new Error('This book has no readable pages.');
    session={book,page:page??(prefs().resume&&book.last_page<book.files.length-1?book.last_page:0),filters,onClose,seen:new Set(),counted:false,zoom:1,gallery:page===undefined&&prefs().openGallery,sliding:false,galleryOffset:0};
    dialog.classList.add('reader');if(!dialog.open)dialog.showModal();
    session.neighbours=await Promise.all([-1,1].map(direction=>call('adjacent',{id,filters,direction})));
    if(token!==version)return;run(()=>api.readerActive(true));draw();
  }
  async function record(s,page){
    if(session!==s||s.gallery||s.lastRecorded===page)return;
    s.lastRecorded=page;
    s.seen.add(page);const p=prefs(),threshold=p.readThreshold===0?s.book.files.length:p.readThreshold;
    const mark=!s.counted&&p.readThreshold!==-1&&(s.seen.size>=threshold||s.book.reads>0);
    if(mark)s.counted=true;
    const complete=p.completeThreshold!==-1&&s.seen.size>=Math.max(1,Math.round(s.book.files.length*p.completeThreshold/100));
    await call('read',{id:s.book.id,page,open:mark,complete});
  }
  // Image processing is display-only. Analyze a small bitmap, then crop/rotate
  // into a bounded canvas; the download on disk is never changed.
  function processed(image,stage,reference=image){
    // Canvas processing captures one frame; leave animations in Chromium's
    // native image renderer, including when crop/rotation preferences are on.
    if(reference.dataset.animated==='true')return image;
    const p=prefs(),rotate=p.rotate!=='off'&&((image.naturalWidth>image.naturalHeight)!==(stage.clientWidth>stage.clientHeight));
    if(!p.smartCrop&&!rotate)return image;
    let x=0,y=0,w=image.naturalWidth,h=image.naturalHeight;
    if(p.smartCrop){
      const probe=document.createElement('canvas'),scale=Math.min(1,256/Math.max(w,h));probe.width=Math.max(1,Math.round(w*scale));probe.height=Math.max(1,Math.round(h*scale));
      const ctx=probe.getContext('2d',{willReadFrequently:true});ctx.drawImage(reference,0,0,probe.width,probe.height);
      const {data}=ctx.getImageData(0,0,probe.width,probe.height),W=probe.width,H=probe.height;
      const same=(i,j)=>Math.abs(data[i]-data[j])<18&&Math.abs(data[i+1]-data[j+1])<18&&Math.abs(data[i+2]-data[j+2])<18;
      const row=(r,ref)=>{for(let c=0;c<W;c++)if(!same((r*W+c)*4,ref))return false;return true;};
      const col=(c,ref)=>{for(let r=0;r<H;r++)if(!same((r*W+c)*4,ref))return false;return true;};
      let top=0,bottom=H-1,left=0,right=W-1;
      while(top<H*.4&&row(top,0))top++;
      while(bottom>H*.6&&row(bottom,(H*W-1)*4))bottom--;
      while(left<W*.4&&col(left,0))left++;
      while(right>W*.6&&col(right,(H*W-1)*4))right--;
      if(top<H*.4&&bottom>H*.6&&left<W*.4&&right>W*.6){x=left/scale;y=top/scale;w=(right-left+1)/scale;h=(bottom-top+1)/scale;}
    }
    const canvas=document.createElement('canvas'),scale=Math.min(1,4096/Math.max(w,h));
    canvas.width=Math.max(1,Math.round((rotate?h:w)*scale));canvas.height=Math.max(1,Math.round((rotate?w:h)*scale));
    const ctx=canvas.getContext('2d');ctx.translate(canvas.width/2,canvas.height/2);if(rotate)ctx.rotate(p.rotate==='left'?-Math.PI/2:Math.PI/2);ctx.drawImage(image,x,y,w,h,-w*scale/2,-h*scale/2,w*scale,h*scale);
    canvas.className=image.className;canvas.setAttribute('aria-label',image.alt);return canvas;
  }
  function pageImage(s,page,host,visible=true,recordOnLoad=true){
    const image=element('img',null,'reader-image');image.alt=`Page ${page+1}`;host.append(image);
    const animation=readerImages.isAnimated(url(s.book.id,page));
    return new Promise(resolve=>{
      const active=()=>session===s&&host.isConnected&&image.parentNode===host;
      const failed=()=>{if(active()){host.replaceChildren(element('p',`Page ${page+1} is unavailable. Check the book folder.`, 'reader-error'));host.dataset.loaded='error';}resolve(false);};
      image.onload=async()=>{
        try{
          const [,animated]=await Promise.all([image.decode(),animation]);if(!active()){resolve(false);return;}
          image.dataset.animated=String(animated);
          const display=processed(image,host);if(display!==image)image.replaceWith(display);
          if(prefs().direction==='vertical'&&!s.gallery)host.style.aspectRatio=`${display===image?image.naturalWidth:display.width} / ${display===image?image.naturalHeight:display.height}`;
          host._original=image;host.dataset.loaded='true';if(recordOnLoad){if(visible)run(()=>record(s,page));else visiblePage(s);enhance(s,page,host);}resolve(true);
        }catch{failed();}
      };
      image.onerror=failed;image.src=url(s.book.id,page);
    });
  }
  function badge(){if(!session)return;const b=body.querySelector('.reader-page-number');if(b)b.textContent=`${session.page+1} / ${session.book.files.length}`;const n=body.querySelector('.reader-page-input');if(n&&document.activeElement!==n)n.value=session.page+1;}
  function visiblePage(s){
    if(session!==s||s.gallery||prefs().direction!=='vertical')return;
    const stage=body.querySelector('.reader-stage'),rect=stage.getBoundingClientRect(),point=rect.top+Math.min(rect.height/2,150);
    for(const host of stage.querySelectorAll('.vertical-page[data-loaded="true"]')){
      const r=host.getBoundingClientRect();if(r.top<=point&&r.bottom>point){const changed=s.page!==Number(host.dataset.page);s.page=Number(host.dataset.page);if(changed){planImages(s);for(const nearby of stage.querySelectorAll('.vertical-page[data-loaded="true"]'))enhance(s,Number(nearby.dataset.page),nearby);}badge();run(()=>record(s,s.page));break;}
    }
  }
  function draw(){
    const s=session;if(!s)return;dispose();planImages(s);const drawId=s.drawId=(s.drawId||0)+1;
    const previous=!s.gallery&&prefs().direction!=='vertical'?body.querySelector('.reader-spread:not(.reader-pending)'):null;
    body.replaceChildren();dialog.classList.remove('reader-controls-hidden');s.loading=false;
    const p=prefs();const stage=element('div',null,'reader-stage');stage.tabIndex=0;stage.setAttribute('aria-label',s.book.title);
    stage.classList.toggle('vertical',p.direction==='vertical'&&!s.gallery);stage.classList.toggle('page-animate',p.pageAnimation);
    stage.classList.toggle('zoom-animate',p.zoomAnimation);stage.dataset.fit=p.fit;stage.style.setProperty('--page-gap',p.gap+'px');
    stage.style.setProperty('--filter-color',p.color);stage.style.setProperty('--filter-opacity',p.colorOpacity/100);
    const label=element('div','',`reader-page-number ${p.pageNumber}`);body.append(stage,label);
    if(s.gallery)drawGallery(s,stage);
    else if(p.direction==='vertical'){
      s.observer=new IntersectionObserver(entries=>{for(const entry of entries){const host=entry.target;
        if(entry.isIntersecting&&!host.children.length)pageImage(s,Number(host.dataset.page),host,false);
        else if(!entry.isIntersecting&&host.children.length){host.replaceChildren();delete host._original;delete host.dataset.loaded;}
      }},{root:stage,rootMargin:'900px 0px'});
      const fragment=document.createDocumentFragment();
      for(let i=0;i<s.book.files.length;i++){const host=element('div',null,'vertical-page');host.dataset.page=i;host.style.aspectRatio='0.7';fragment.append(host);s.observer.observe(host);}
      stage.append(fragment);stage.onscroll=()=>visiblePage(s);
      requestAnimationFrame(()=>{if(session===s)stage.children[s.page]?.scrollIntoView({block:'start'});});
    }else{
      const spread=element('div',null,'reader-spread reader-pending');spread.classList.toggle('rtl',p.direction==='rtl');
      if(previous)stage.append(previous);stage.append(spread);s.loading=true;stage.setAttribute('aria-busy','true');
      spread.style.width=`${s.zoom*100}%`;spread.style.height=`${s.zoom*100}%`;
      const pages=[],loads=[];
      for(let page=s.page;page<Math.min(s.book.files.length,s.page+(p.twoPages?2:1));page++){const host=element('div',null,'reader-sheet');spread.append(host);pages.push(page);loads.push(pageImage(s,page,host,true,false));}
      Promise.all(loads).then(loaded=>{
        if(session!==s||s.drawId!==drawId||!stage.isConnected)return;
        s.loading=false;stage.removeAttribute('aria-busy');
        if(loaded.every(Boolean)){
          previous?.remove();spread.classList.remove('reader-pending');zoom(s.zoom);
          for(const page of pages)run(()=>record(s,page));
          pages.forEach((page,i)=>enhance(s,page,spread.children[i]));
        }else{
          if(previous)spread.remove();else spread.classList.remove('reader-pending');
          const status=element('div',null,'reader-load-status');status.setAttribute('role','status');
          status.append(element('span','Page unavailable. Check the book folder.'),button('Retry',draw));stage.append(status);
        }
      });
    }
    controls(s);badge();
    if(!s.gallery)gestures(stage,s);
  }
  function controls(s){
    const row=element('div',null,'reader-controls');
    const action=(text,title,fn)=>{const b=button(text,fn);b.title=title;b.setAttribute('aria-label',title);row.append(b);return b;};
    action('⇤','Previous book',()=>switchBook(-1));
    action('←','Previous page',()=>step(-1));
    const number=element('input',null,'reader-page-input');number.type='number';number.min=1;number.max=s.book.files.length;number.value=s.page+1;number.setAttribute('aria-label','Page');number.onchange=()=>go(Number(number.value)-1);row.append(number);
    action('→','Next page',()=>step(1));action('⇥','Next book',()=>switchBook(1));
    action('▦','Page gallery',()=>{stopSlide();s.gallery=!s.gallery;s.galleryOffset=Math.floor(s.page/100)*100;draw();});
    action(s.sliding?'Ⅱ':'▶','Slideshow',()=>{if(s.sliding){stopSlide();draw();}else startSlide();});
    const more=element('details',null,'reader-more'),summary=element('summary','⋯');summary.title='Reader actions';more.append(summary);
    const actions=element('div',null,'reader-extra');
    const scalingStatus=element('span',null,'reader-scaling-status');actions.append(scalingStatus);
    more.ontoggle=()=>{if(!more.open)return;const status=readerImages.status;scalingStatus.textContent=!prefs().upscale?'Original images':status.unavailable?'Original images · GPU scaling unavailable':!status.ready?'Preparing Anime4K…':`Anime4K ${prefs().upscale}× · original first`;scalingStatus.title=status.unavailable||'Scaling and preloading are adjustable in Viewer settings.';};
    const sourceButton=button('View source',async()=>{stopSlide();s.onClose();await call('viewSource',s.book.id);});sourceButton.disabled=!s.book.sourceUrl;sourceButton.title=s.book.sourceUrl||'No saved web page address';actions.append(sourceButton);
    actions.append(button('Zoom +',()=>zoom(s.zoom+1)),button('Zoom −',()=>zoom(Math.max(1,s.zoom-1))),button('Reset zoom',()=>zoom(1)),button('Favourite page',async()=>{
      const old=s.book.pageState.find(p=>p.page===s.page)?.favourite;await call('read',{id:s.book.id,page:s.page,favourite:!old});s.book.pageState=s.book.pageState.filter(p=>p.page!==s.page);s.book.pageState.push({page:s.page,favourite:!old});more.open=false;
    }),button('Delete book',async()=>{
      stopSlide();const next=s.neighbours[prefs().deleteDirection<0?0:1];
      if(await call('delete',[s.book.id])){if(next)await open(next,undefined,s.filters,s.onClose);else s.onClose();}
    }),button('Viewer settings',async()=>{const done=s.onClose;done();await api.panel('settings');$('settings-section').value='viewer';renderSettings(current);}));
    more.append(actions);row.append(more);body.append(row);
  }
  function drawGallery(s,stage){
    stage.classList.add('reader-gallery');stage.style.setProperty('--gallery-columns',prefs().galleryColumns);
    for(let i=s.galleryOffset;i<Math.min(s.book.files.length,s.galleryOffset+100);i++){
      const b=button('',()=>{s.gallery=false;s.page=i;draw();});const image=element('img');image.loading='lazy';image.src=url(s.book.id,i);image.alt=`Page ${i+1}`;b.append(image,element('span',String(i+1)));stage.append(b);
    }
    const pager=element('div',null,'gallery-pager');
    if(s.galleryOffset>0)pager.append(button('Previous thumbnails',()=>{s.galleryOffset-=100;draw();}));
    if(s.galleryOffset+100<s.book.files.length)pager.append(button('Next thumbnails',()=>{s.galleryOffset+=100;draw();}));stage.append(pager);
  }
  function go(page){
    const s=session;if(!s||!Number.isInteger(page)||page<0||page>=s.book.files.length)return;
    s.page=page;if(s.gallery){s.gallery=false;draw();return;}
    if(prefs().direction==='vertical'){planImages(s);const host=body.querySelector(`.vertical-page[data-page="${page}"]`);host?.scrollIntoView({block:'start'});if(host)enhance(s,page,host);badge();return;}
    if(!prefs().keepZoom)s.zoom=1;draw();
  }
  async function step(delta){
    const s=session;if(!s)return;const page=s.page+delta*(prefs().twoPages&&prefs().direction!=='vertical'?2:1);
    if(page<0||page>=s.book.files.length){
      if(s.sliding){
        if(['book','chapter'].includes(prefs().slideLoop)){go(0);return;}
        if(prefs().slideLoop==='continuous'&&prefs().continuous){if(await switchBook(delta,true))return;go(0);return;}
        stopSlide();draw();return;
      }
      if(prefs().continuous)await switchBook(delta);return;
    }
    go(page);
  }
  async function switchBook(direction,forceBook=false){
    if(prefs().chapterNavigation&&!forceBook)return false;
    const s=session;if(!s||s.switching)return false;s.switching=true;
    try{const id=s.neighbours[direction<0?0:1];if(session!==s||!id)return false;const playing=s.sliding;await open(id,0,s.filters,s.onClose);if(playing)startSlide();return true;}finally{s.switching=false;}
  }
  function zoom(value){
    const s=session;if(!s||s.gallery)return;s.zoom=Math.max(1,Math.min(10,value));
    const spread=body.querySelector('.reader-spread');if(spread){spread.style.width=`${s.zoom*100}%`;spread.style.height=`${s.zoom*100}%`;}
    const stage=body.querySelector('.reader-stage');stage?.classList.toggle('zoomed',s.zoom>1);
    if(prefs().direction==='vertical')for(const page of stage.querySelectorAll('.vertical-page'))page.style.width=`${s.zoom*100}%`;
  }
  function tapZoom(){if(session)zoom(session.zoom>1?1:Math.min(prefs().zoomCap||10,2.5));}
  function gestures(stage,s){
    stage.addEventListener('wheel',event=>{
      if(!prefs().wheel||event.ctrlKey||prefs().direction==='vertical'||s.zoom>1)return;
      event.preventDefault();const now=performance.now();if(now-lastWheel>160)wheelTotal=0;lastWheel=now;
      wheelTotal+=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?stage.clientHeight:1);
      if(now-wheelAt<250)return;
      if(Math.abs(wheelTotal)>=50){const direction=Math.sign(wheelTotal);wheelTotal=0;wheelAt=now;run(()=>step(direction));}
    },{passive:false});
    let pointer;
    stage.onpointerdown=e=>{
      if(e.button!==0)return;pointer={x:e.clientX,y:e.clientY,time:performance.now(),left:stage.scrollLeft,top:stage.scrollTop};
      if(prefs().holdZoom)holdTimer=setTimeout(()=>{if(session===s){pointer.held=true;zoom(Math.min(prefs().zoomCap||10,2.5));}},450);
    };
    stage.onpointermove=e=>{
      if(!pointer)return;
      if(Math.hypot(e.clientX-pointer.x,e.clientY-pointer.y)>10)clearTimeout(holdTimer);
      if(s.zoom>1&&!pointer.held){stage.scrollLeft=pointer.left+pointer.x-e.clientX;stage.scrollTop=pointer.top+pointer.y-e.clientY;}
    };
    stage.onpointerup=e=>{
      clearTimeout(holdTimer);if(!pointer)return;const start=pointer;pointer=null;
      if(start.held){zoom(1);return;}
      const dx=e.clientX-start.x,dy=e.clientY-start.y;
      if(prefs().swipe&&s.zoom===1&&Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)){
        const delta=(dx<0?1:-1)*(prefs().direction==='rtl'?-1:1),fast=prefs().fling&&performance.now()-start.time<250;
        run(()=>step(delta*(fast?Math.min(5,Math.max(2,Math.floor(Math.abs(dx)/100))):1)));return;
      }
      if(Math.hypot(dx,dy)>10)return;
      clearTimeout(clickTimer);clickTimer=setTimeout(()=>{
        if(session!==s)return;const r=stage.getBoundingClientRect(),fraction=(e.clientX-r.left)/r.width,zone=prefs().largeTap?.3:.15;
        if(prefs().borderTap&&(fraction<zone||fraction>1-zone))run(()=>step((fraction<.5?-1:1)*(prefs().direction==='rtl'?-1:1)));
        else dialog.classList.toggle('reader-controls-hidden');
      },280);
    };
    stage.onpointerleave=()=>{clearTimeout(holdTimer);if(pointer?.held)zoom(1);pointer=null;};
    stage.onpointercancel=stage.onpointerleave;
    stage.ondblclick=e=>{e.preventDefault();clearTimeout(clickTimer);if(prefs().doubleZoom)tapZoom();};
  }
  function startSlide(){
    const s=session;if(!s)return;stopSlide();s.sliding=true;s.gallery=false;draw();let last=performance.now(),next=last+prefs().slideDelay,busy=false;
    slideTimer=setInterval(()=>{
      if(session!==s||document.hidden||busy)return;const now=performance.now(),elapsed=Math.min(100,now-last);last=now;
      if(prefs().direction==='vertical'){
        const stage=body.querySelector('.reader-stage');stage.scrollTop+=prefs().slideSpeed*elapsed/1000;
        if(stage.scrollTop+stage.clientHeight<stage.scrollHeight-2)return;
      }else if(s.loading){next=now+prefs().slideDelay;return;}else if(now<next)return;
      next=now+prefs().slideDelay;busy=true;run(()=>step(1)).finally(()=>busy=false);
    },40);
  }
  document.addEventListener('keydown',e=>{
    const s=session;if(!s||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)||e.ctrlKey||e.altKey||e.metaKey)return;
    const p=prefs(),key=e.key.toLowerCase();let action;
    if(key===p.previousKey.toLowerCase())action=()=>step(-1);
    if(key===p.nextKey.toLowerCase())action=()=>step(1);
    if(key===p.previousBookKey.toLowerCase())action=()=>switchBook(-1);
    if(key===p.nextBookKey.toLowerCase())action=()=>switchBook(1);
    if(p.keyboard&&['ArrowLeft','ArrowRight'].includes(e.key))action=()=>step((e.key==='ArrowRight'?1:-1)*(p.direction==='rtl'?-1:1));
    if(action){e.preventDefault();run(action);}
  });
  window.readerUI={open,close,get active(){return !!session;},back(){if(session?.gallery){session.gallery=false;draw();return true;}return false;}};
})();
