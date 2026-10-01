(()=>{
  let state,data={bookmarks:[]},revision=-1,page=0,storageKey='',storageLoading=false;
  const dialog=$('browser-dialog'),content=$('browser-dialog-content');
  const close=()=>dialog.close();$('browser-dialog-close').onclick=close;
  function edit(book){
    content.replaceChildren(element('h3','Edit bookmark'));
    const title=element('input'),url=element('input');title.value=book.title;url.value=book.url;title.maxLength=300;url.maxLength=8192;
    for(const [text,input] of [['Title',title],['Address',url]]){const label=element('label',text);label.append(input);content.append(label);}
    const error=element('p');error.id='browser-dialog-error';content.append(error,button('Save',async()=>{try{await api.browser('save',{id:book.id,title:title.value,url:url.value});close();}catch(e){error.textContent=e.message;}}));dialog.showModal();
  }
  function remove(book){content.replaceChildren(element('h3','Remove bookmark?'),element('p',book.title),button('Remove',async()=>{await api.browser('remove',{id:book.id});close();}));dialog.showModal();}
  function renderBookmarks(){
    const term=$('bookmark-search').value.toLowerCase(),site=$('bookmark-site').value;
    const list=data.bookmarks.filter(b=>(!site||b.site===site)&&(!term||(b.title+' '+b.url).toLowerCase().includes(term)));
    const pages=Math.max(1,Math.ceil(list.length/60));page=Math.min(page,pages-1);$('bookmark-list').replaceChildren();
    for(const book of list.slice(page*60,(page+1)*60)){
      const row=element('article',null,'bookmark-row'),open=button((book.home?'⌂ ':'')+book.title,()=>api.navigate(book.url));open.className='bookmark-open';
      const actions=element('div',null,'browser-actions');actions.append(button('Edit',()=>edit(book)),button(book.home?'Reset home':'Home',()=>api.browser('home',{id:book.id})),button('↑',()=>api.browser('move',{id:book.id,direction:-1})),button('↓',()=>api.browser('move',{id:book.id,direction:1})),button('Remove',()=>remove(book)));
      row.append(open,element('small',book.url),actions);$('bookmark-list').append(row);
    }
    if(!list.length)$('bookmark-list').append(element('p','No bookmarks yet. Open a source page, then choose Bookmark this page.','empty'));
    $('bookmark-page').textContent=`${list.length} bookmarks · ${page+1} / ${pages}`;$('bookmark-prev').disabled=page===0;$('bookmark-next').disabled=page+1>=pages;
  }
  async function storage(){
    if(storageLoading)return;storageLoading=true;
    try{
      const result=await api.storage('list');$('storage-list').replaceChildren();
      for(const root of result.locations){
        const row=element('article',null,'storage-row'),active=result.defaultPath.toLowerCase()===root.path.toLowerCase()||result.defaultPath.toLowerCase().startsWith(root.path.toLowerCase()+'\\');
        row.append(element('h3',root.path),element('strong',active?'● Default for new downloads':root.online?'Available':'Offline',active?'storage-default':root.online?'':'storage-offline'));
        row.append(element('small',`${root.books.toLocaleString()} books · ${(root.bytes/1024**3).toFixed(2)} GiB indexed · ${root.online?(root.free/1024**3).toFixed(1)+' GiB free':'Connect the drive to access files'}`));
        const actions=element('div',null,'browser-actions');
        for(const [label,action,disabled] of [['Use for downloads','default',active||!root.online],['Open folder','open',!root.online],['Reconnect…','reconnect',false],['Remove…','remove',active]]){const b=button(label,async()=>{await api.storage(action,root.id);storageKey='';await storage();});b.disabled=disabled;actions.append(b);}
        row.append(actions);$('storage-list').append(row);
      }
      if(!result.locations.length)$('storage-list').append(element('p','Add your first storage location.'));
    }finally{storageLoading=false;}
  }
  window.browserUI={render(value){
    state=value;$('bookmarks-panel').hidden=state.panel!=='bookmarks';$('storage-panel').hidden=state.panel!=='storage';
    $('bookmarks').hidden=!['browser','sources','bookmarks'].includes(state.panel);$('bookmarks').textContent=state.bookmarked?'★':'☆';
    $('language-filter').hidden=state.panel!=='browser'||!state.languageUrl;
    $('bookmark-current').disabled=!state.url||!state.sites.some(s=>new URL(s.url).hostname===new URL(state.url).hostname);$('browser-reopen').disabled=!state.canReopen;$('browser-close').disabled=!state.url;
    if(['bookmarks','storage'].includes(state.panel)){$('heading').textContent=state.panel==='bookmarks'?'Bookmarks':'Storage';}
    if($('bookmark-site').options.length===1)for(const site of state.sites){const option=element('option',site.name);option.value=site.id;$('bookmark-site').append(option);}
    if(state.panel==='bookmarks'&&revision!==state.browserRevision){revision=state.browserRevision;run(async()=>{data=await api.browser('list');renderBookmarks();});}
    if(state.panel==='storage'){const key=state.libraryRevision+':'+state.downloadRoot+':'+state.libraryScan.running;if(key!==storageKey&&!storageLoading){storageKey=key;run(storage);}}else storageKey='';
  }};
  $('bookmarks').onclick=()=>run(()=>api.panel(state.panel==='bookmarks'?'browser':'bookmarks'));
  $('bookmark-current').onclick=()=>run(()=>api.browser('add-current'));
  $('browser-reopen').onclick=()=>run(()=>api.browser('reopen'));$('browser-close').onclick=()=>run(()=>api.browser('close'));
  $('bookmark-search').oninput=$('bookmark-site').onchange=()=>{page=0;renderBookmarks();};
  $('bookmark-prev').onclick=()=>{page--;renderBookmarks();};$('bookmark-next').onclick=()=>{page++;renderBookmarks();};
  for(const action of ['import','export'])$('bookmark-'+action).onclick=()=>run(()=>api.browser(action));
  for(const id of ['storage-manage','settings-storage'])$(id).onclick=()=>run(()=>api.panel('storage'));
  const storageMenu=button('Storage locations',()=>api.panel('storage'));storageMenu.id='library-storage';$('library-menu').append(storageMenu);
  $('storage-add').onclick=()=>run(async()=>{await api.storage('add');await storage();});$('storage-refresh').onclick=()=>run(async()=>{await api.library('scan');await storage();});
  $('language-filter').onclick=()=>run(()=>api.navigate(state.languageUrl));
  api.onBrowserBack?.(()=>{if(dialog.open)close();else run(()=>api.command('browser-back'));});
})();
