(() => {
  const call=(action,input)=>api.library(action,input), dialog=$('library-dialog'), body=$('library-dialog-content');
  const defaults={query:'',sort:'downloaded',desc:true,offset:0,limit:60,favourite:-1,completed:-1,rating:-1,attrs:[],excludedTypes:[],combination:'and',group:0,root:0,day:'',ungrouped:false};
  let filters={...defaults},view='list',grouping='flat',groupLabel='',groupSort='title',groupDesc=false,selected=new Set(),result,revision=-1,generation=0,active=false,groups=[],reader=null,searchTimer;
  try { const saved=JSON.parse(localStorage.getItem('library-view')||'{}');filters={...defaults,...saved.filters,offset:0};view=saved.view||'list'; }catch{}
  const prefs=()=>current.librarySettings;
  const virtual=new VirtualLibrary($('library-books'),document.querySelector('main'),()=>{if(active&&!dialog.open)run(load);});
  const resetScroll=()=>{document.querySelector('main').scrollTop=0;filters.offset=0;};
  let settingsSignature='',virtualRange;
  const save=()=>localStorage.setItem('library-view',JSON.stringify({filters,view}));
  const bytes=n=>n>=1024**3?`${(n/1024**3).toFixed(1)} GiB`:`${(n/1024**2).toFixed(1)} MiB`;
  const source=id=>({ehentai:'E-hentai',exhentai:'ExHentai',hitomi:'Hitomi'}[id]||id);
  const cover=id=>`hentdows://app/library/${id}/cover`;
  const date=n=>n?new Date(n).toLocaleDateString():'Unknown';
  function selectControl(label,options,value,onchange) {
    const row=element('label',label),input=element('select');
    for(const [key,text] of options){const option=element('option',text);option.value=key;input.append(option);}
    input.value=String(value);input.onchange=()=>onchange(input.value);row.append(input);return row;
  }
  function inputControl(label,value,onchange,type='text') {const row=element('label',label),input=element('input');input.type=type;input.value=value;input.oninput=()=>onchange(input.value);row.append(input);return row;}
  function openDialog(title) {window.readerUI?.close();reader=null;dialog.classList.remove('reader');body.replaceChildren(element('h2',title));if(!dialog.open)dialog.showModal();}
  function closeDialog() {window.readerUI?.close();reader=null;dialog.close();if(active)run(load);}
  $('library-dialog-close').onclick=closeDialog;
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog();});
  function selection() {$('library-selection').hidden=!selected.size;$('library-selected').textContent=`${selected.size} selected`;for(const el of $('library-books').querySelectorAll('.book'))el.classList.toggle('selected',selected.has(Number(el.dataset.id)));}
  function toggle(id) {selected.has(id)?selected.delete(id):selected.add(id);selection();}
  async function load() {
    if(!active)return;
    const stamp=++generation;
    virtual.configure(prefs().endless,view,prefs().cardWidth,grouping!=='flat'&&!groupLabel);
    filters.limit=prefs().pageSize;
    if(prefs().endless){virtualRange=virtual.range();Object.assign(filters,virtualRange);}
    const shortcuts=$('library-sources');shortcuts.hidden=!prefs().nostalgia;
    if(!shortcuts.children.length)for(const site of current.sites)shortcuts.append(button(site.name,()=>api.navigate(site.url)));
    $('library-ungrouped').hidden=!(grouping==='custom'&&!groupLabel&&prefs().endless);
    $('library-top').hidden=!prefs().topButton;
    document.querySelector('.library-pager').hidden=prefs().endless;
    $('library-books').style.setProperty('--card-width',prefs().cardWidth+'px');
    save();
    groups=await call('groups');
    if(grouping!=='flat'&&!groupLabel) {await loadGroups(stamp);return;}
    const data=await call('query',filters);if(stamp!==generation)return;result=data;
    if(data.offset>=data.total&&data.offset>0){if(prefs().endless){resetScroll();return load();}filters.offset=Math.max(0,Math.ceil(data.total/data.limit)-1)*data.limit;return load();}
    $('library-books').className=view==='list'?'':`grid ${view==='grid'?'auto-grid':view}`;$('library-books').replaceChildren();
    $('library-total').textContent=`${groupLabel?groupLabel+' · ':''}${data.total.toLocaleString()} books · ${bytes(data.bytes)}`;
    $('library-up').hidden=!groupLabel;$('library-prev').disabled=!data.offset;$('library-next').disabled=data.offset+data.limit>=data.total;
    $('library-page').textContent=data.total?`${Math.floor(data.offset/data.limit)+1} / ${Math.ceil(data.total/data.limit)}`:'0 / 0';
    if(!data.books.length){const empty=element('div',null,'library-empty');empty.append(element('h2','No books to display'),element('p',filters.query||filters.attrs.length?'Try clearing the search or filters.':'Completed downloads appear here automatically. Add a Hentdows download folder to find existing books.'),button('Add folder',()=>call('import')));$('library-books').append(empty);}
    for(const book of data.books){
      const row=element('article',null,'book');row.dataset.id=book.id;row.tabIndex=0;row.setAttribute('aria-label',book.title);
      const img=element('img',null,'book-cover');img.src=cover(book.id);img.alt='';img.loading='lazy';img.onerror=()=>{img.removeAttribute('src');img.alt='Cover unavailable';};
      const info=element('div',null,'book-info');info.append(element('h3',book.title),element('div',book.author||'Unknown artist','book-author'),element('div',`${source(book.site)} · ${book.pages} pages · ${bytes(book.size)}`,'book-meta'),element('div',book.tags.join(' · '),'book-tags'));
      const progress=element('progress');progress.max=1;progress.value=book.progress;progress.title=`${Math.round(book.progress*100)}% read`;info.append(progress);
      const bottom=element('div',null,'book-bottom');bottom.append(element('span',`${book.completed?'✓ Completed':book.reads?`${book.reads} reads`:'Unread'}${book.missing?' · Missing files':''}`));
      const fav=button(book.favourite?'♥':'♡',()=>call('update',{ids:[book.id],patch:{favourite:!book.favourite}}));fav.title='Toggle favourite';fav.onclick=event=>{event.stopPropagation();run(()=>call('update',{ids:[book.id],patch:{favourite:!book.favourite}}));};fav.className='book-favourite';bottom.append(fav);
      const details=button('⋯',()=>showBook(book.id));details.className='book-details';details.title='Book details and actions';details.setAttribute('aria-label','Book details and actions');bottom.append(details);
      const rating=button(book.rating?'★'.repeat(book.rating):'☆',()=>{selected=new Set([book.id]);selection();return selectionAction('rate');});rating.className='book-rating';rating.title='Set rating';bottom.prepend(rating);
      const language=element('span',book.language,'book-language');info.append(language);
      if(view!=='list'){
        info.querySelector('h3').hidden=!prefs().gridTitle;
        language.hidden=!prefs().gridLanguage;fav.hidden=!prefs().gridFavourite;rating.hidden=!prefs().gridRating;
        info.querySelector('.book-meta').textContent=[prefs().gridSource?source(book.site):'',prefs().gridStorage?bytes(book.size):''].filter(Boolean).join(' · ');
        if(prefs().gridSource&&book.source_id){const src=button('↗',async()=>{const full=await call('get',book.id);return api.navigate(full.url);});src.title='View source';bottom.append(src);}
      }else language.hidden=true;
      info.append(bottom);row.append(img,info);
      let clickTimer;row.onclick=event=>{if(event.target.closest('button'))return;if(selected.size){toggle(book.id);return;}clearTimeout(clickTimer);clickTimer=setTimeout(()=>run(()=>startReader(book.id)),400);};
      row.ondblclick=event=>{if(event.target.closest('button'))return;clearTimeout(clickTimer);selected.add(book.id);selection();};
      row.onkeydown=event=>{if(event.target.closest('button'))return;if(event.key==='Enter')run(()=>startReader(book.id));if(event.key===' '){event.preventDefault();toggle(book.id);}};
      $('library-books').append(row);
    }
    virtual.decorate(data.total,data.books.length,virtualRange);selection();
  }
  async function loadGroups(stamp) {
    const data=await call('facets',{kind:grouping,query:filters.query,offset:filters.offset,limit:filters.limit,sort:groupSort,desc:groupDesc});
    let entries=data.entries.map(a=>({name:a.name,count:prefs().groupFigure==='size'?bytes(a.size):`${a.count} books`,filters:['custom','dynamic'].includes(grouping)?{group:a.id}:grouping==='folders'?{root:a.id}:grouping==='date'?{day:a.name}:{attrs:[{kind:grouping,name:a.name}]}}));
    if(grouping==='custom'&&!prefs().endless&&!filters.offset)entries.unshift({name:'Ungrouped',count:'Books without a custom group',filters:{ungrouped:true}});
    if(stamp!==generation)return;
    $('library-books').className='';$('library-books').replaceChildren();$('library-up').hidden=true;
    $('library-total').textContent=`${data.total} groups`;$('library-page').textContent=data.total?`${Math.floor(filters.offset/filters.limit)+1} / ${Math.ceil(data.total/filters.limit)}`:'';$('library-prev').disabled=!filters.offset;$('library-next').disabled=filters.offset+filters.limit>=data.total;
    for(const entry of entries){const row=button('',()=>{filters={...defaults,...entry.filters};groupLabel=entry.name;resetScroll();return load();});row.className='library-group';row.append(element('strong',entry.name),element('span',entry.count));$('library-books').append(row);}
    virtual.decorate(data.total,entries.length,virtualRange);
    if(!entries.length)$('library-books').append(element('p','No groups yet. Use the library menu to create a custom group or save a dynamic search.','library-empty'));
  }
  function clear(){resetScroll();filters={...defaults,attrs:[],excludedTypes:[]};groupLabel='';grouping='flat';selected.clear();$('book-search').value='';$('library-grouping').value='flat';return load();}
  async function showBook(id){
    const book=await call('get',id);openDialog(book.title);
    const img=element('img',null,'book-detail-cover');img.src=cover(id);img.alt='';body.append(img,element('p',`${book.author||'Unknown artist'} · ${source(book.site)} · ${book.pages} pages · ${bytes(book.size)}`),element('p',`Downloaded ${date(book.downloaded)}\nFinished ${date(book.finished)} · Uploaded ${date(book.uploaded)}\n${book.reads} reads · ${Math.round(book.progress*100)}% read${book.missing?'\nFiles are unavailable. Reconnect the drive and refresh.':''}`,'detail-stats'));
    const actions=element('div',null,'dialog-actions');actions.append(button(book.reads?'Continue reading':'Read',()=>startReader(id)),button('Read from beginning',()=>startReader(id,0)),button('Edit',()=>editBook(id)),button('Show files',()=>call('openFolder',id)),button('Select',()=>{selected.add(id);closeDialog();selection();}));
    if(book.url)actions.append(button('View source',async()=>{closeDialog();await api.navigate(book.url);}));body.append(actions);
    const tags=element('div',null,'book-detail-tags');for(const tag of book.tags)tags.append(button(tag,()=>{closeDialog();filters.query=tag.includes(':')?tag.slice(tag.indexOf(':')+1):tag;$('book-search').value=filters.query;filters.offset=0;return load();}));body.append(tags);
  }
  async function editBook(id){const book=await call('get',id);openDialog('Edit metadata');let title=book.title,tags=book.tags.join('\n');body.append(inputControl('Title',title,v=>title=v));const label=element('label','Tags · one per line (for example artist:name)'),input=element('textarea');input.value=tags;input.oninput=()=>tags=input.value;label.append(input);body.append(label,button('Save',async()=>{await call('update',{ids:[id],patch:{title,tags:tags.split('\n').map(t=>t.trim()).filter(Boolean)}});closeDialog();}));}
  async function startReader(id,page){
    reader=true;
    await window.readerUI.open(id,page,structuredClone(filters),()=>{reader=null;closeDialog();});
  }
  function showFilters(){
    openDialog('Sort & filter');const draft=structuredClone(filters);
    if(grouping!=='flat'&&!groupLabel){body.append(selectControl('Group sort',[['title','Title'],['pages','Number of books'],['downloaded','Download date'],['custom','Custom']],groupSort,v=>groupSort=v),selectControl('Direction',[['asc','Ascending'],['desc','Descending']],groupDesc?'desc':'asc',v=>groupDesc=v==='desc'),button('Apply',()=>{filters.offset=0;dialog.close();return load();}));return;}
    const sorts=[['title','Title'],['artist','Artist'],['pages','Pages'],['downloaded','Download date'],['finished','Download completion date'],['uploaded','Upload date'],['readDate','Last read date'],['reads','Reads'],['size','Size'],['progress','Reading progress'],['average','Average page size'],['custom','Custom order'],['random','Random']];
    const canOrder=groups.some(g=>g.id===draft.group&&!g.filters)||(!draft.group&&draft.attrs.some(a=>!a.excluded&&['artist','series'].includes(a.kind)));
    body.append(selectControl('Sort by',sorts.filter(([key])=>key!=='custom'||canOrder),draft.sort,v=>draft.sort=v),selectControl('Direction',[['desc','Descending'],['asc','Ascending']],draft.desc?'desc':'asc',v=>draft.desc=v==='desc'));
    const row=element('div',null,'filter-row');row.append(selectControl('Favourites',[[-1,'All'],[1,'Favourites'],[0,'Non-favourites']],draft.favourite,v=>draft.favourite=Number(v)),selectControl('Completion',[[-1,'All'],[1,'Completed'],[0,'Not completed']],draft.completed,v=>draft.completed=Number(v)));body.append(row);
    body.append(selectControl('Rating',[[-1,'Any rating'],[0,'Unrated'],...Array.from({length:5},(_,i)=>[i+1,'★'.repeat(i+1)])],draft.rating,v=>draft.rating=Number(v)));
    for(const [key,text] of [['pageFavourite','With favourite pages'],['missing','Missing files only']]){const label=element('label',text,'check'),check=element('input');check.type='checkbox';check.checked=!!draft[key];check.onchange=()=>draft[key]=check.checked;label.prepend(check);body.append(label);}
    body.append(element('h3','Advanced search'),selectControl('Combine selected attributes',[['and','AND · all conditions'],['or','OR · any condition']],draft.combination,v=>draft.combination=v));
    const chips=element('div');body.append(chips);
    const drawChips=()=>{chips.replaceChildren();draft.attrs.forEach((attr,index)=>{const chip=element('div',null,'filter-chip');chip.append(element('span',`${attr.excluded?'Exclude ':''}${attr.kind}: ${attr.name}`),button('×',()=>{draft.attrs.splice(index,1);drawChips();}));chips.append(chip);});};drawChips();
    let kind='tag',term='',excluded=false;const matches=element('div',null,'attribute-results');let suggestionGeneration=0;
    const suggest=async()=>{const token=++suggestionGeneration;const values=await call('suggestions',{kind,query:term,sort:prefs().attributeSort});if(token!==suggestionGeneration)return;matches.replaceChildren();for(const value of values)matches.append(button(prefs().attributeCount?`${value.name} (${value.count})`:value.name,()=>{draft.attrs.push({kind,name:value.name,excluded});drawChips();}));};
    body.append(selectControl('Attribute',[['tag','Tag'],['artist','Artist'],['circle','Circle'],['series','Series'],['character','Character'],['language','Language'],['category','Category'],['uploader','Uploader'],['translator','Translator'],['publisher','Publisher'],['source','Source']],kind,v=>{kind=v;run(suggest);}),inputControl('Find an attribute','',v=>{term=v;run(suggest);}),selectControl('Condition',[['include','Include'],['exclude','Exclude']],'include',v=>excluded=v==='exclude'),matches);
    const missingTypes=element('label','Exclude books containing these attribute types (comma-separated)'),types=element('input');types.value=draft.excludedTypes.join(', ');types.placeholder='artist, circle';types.oninput=()=>draft.excludedTypes=types.value.split(',').map(t=>t.trim()).filter(Boolean);missingTypes.append(types);body.append(missingTypes);
    const actions=element('div',null,'dialog-actions');actions.append(button('Apply',()=>{filters={...draft,offset:0};resetScroll();dialog.close();return load();}),button('Shuffle',async()=>{await call('shuffle');filters={...draft,sort:'random',offset:0};dialog.close();return load();}),button('Clear',()=>{dialog.close();return clear();}));body.append(actions);run(suggest);
  }
  function groupDialog(dynamic=false,rename=false){const existing=rename?groups.find(g=>g.id===filters.group):null;if(rename&&!existing)throw new Error('Open a group first.');openDialog(rename?'Edit group':dynamic?'Save dynamic group':'New custom group');let name=existing?.name||'';body.append(inputControl('Group name',name,v=>name=v),element('p',dynamic?'This group updates automatically as books match the current search and filters.':'Add selected books to this group from the selection actions.'),button('Save',async()=>{await call('group',{action:'save',id:existing?.id,name,filters:existing?.filters||(dynamic?filters:null)});if(existing)groupLabel=name;closeDialog();}));if(existing)for(const [direction,label] of [[-1,'Move group up'],[1,'Move group down']])body.append(button(label,()=>call('group',{action:'moveGroup',id:existing.id,direction})));}
  async function selectionAction(action){
    const ids=[...selected];if(!ids.length)return;
    const patch={favourite:{favourite:true},unfavourite:{favourite:false},complete:{completed:true},incomplete:{completed:false},reset:{resetRead:true}}[action];
    if(patch)await call('update',{ids,patch});
    else if(action==='edit'){if(ids.length!==1)throw new Error('Select one book to edit.');return editBook(ids[0]);}
    else if(action==='rate'){openDialog('Rate selected books');for(let rating=0;rating<=5;rating++)body.append(button(rating?'★'.repeat(rating):'Unrated',async()=>{await call('update',{ids,patch:{rating}});closeDialog();}));return;}
    else if(action==='group'){openDialog('Add to custom group');for(const group of groups.filter(g=>!g.filters))body.append(button(group.name,async()=>{await call('group',{action:'assign',id:group.id,ids});closeDialog();}));if(!groups.some(g=>!g.filters))body.append(element('p','Create a custom group from the library menu first.'));return;}
    else if(action==='ungroup')await call('group',{action:'remove',id:filters.group,ids});
    else if(action==='up'||action==='down'){await call('group',{action:'move',id:filters.group,filters,ids,direction:action==='up'?-1:1});filters.sort='custom';filters.desc=false;}
    else if(action==='delete'||action==='detach'){await call(action,ids);selected.clear();}
    await load();
  }
  $('library-view').value=view;$('book-search').value=filters.query;
  $('library-ungrouped').onclick=()=>{filters={...defaults,ungrouped:true};groupLabel='Ungrouped';resetScroll();run(load);};
  $('library-top').onclick=()=>{resetScroll();run(load);};
  $('library-view').onchange=()=>{view=$('library-view').value;resetScroll();run(()=>api.savePreferences('library',{display:view==='list'?'list':'grid'}));run(load);};
  $('library-grouping').onchange=()=>{resetScroll();grouping=$('library-grouping').value;groupLabel='';filters={...defaults,attrs:[],excludedTypes:[]};selected.clear();$('book-search').value='';run(load);};
  $('book-search').oninput=()=>{clearTimeout(searchTimer);const delay=/^(?:\d|https?:)/.test($('book-search').value)?prefs().numberDelay:prefs().searchDelay;if(delay<0)return;searchTimer=setTimeout(()=>{filters.query=$('book-search').value;resetScroll();run(load);},delay);};
  $('library-search').onsubmit=event=>{event.preventDefault();clearTimeout(searchTimer);filters.query=$('book-search').value;resetScroll();run(load);};
  $('library-filters').onclick=showFilters;$('library-clear').onclick=()=>run(clear);
  $('library-menu-button').onclick=()=>{$('library-menu').hidden=!$('library-menu').hidden;};
  $('library-import').onclick=()=>run(()=>call('import'));$('library-refresh').onclick=()=>run(()=>call('scan'));$('library-cancel-scan').onclick=()=>run(()=>call('cancel'));
  $('library-backup').onclick=()=>run(()=>call('backup'));$('library-restore').onclick=()=>run(async()=>{await call('restoreDetached');await call('scan');});
  $('library-restore-backup').onclick=()=>run(()=>call('restoreBackup'));
  $('library-new-group').onclick=()=>run(()=>groupDialog());$('library-save-search').onclick=()=>run(()=>groupDialog(true));$('library-edit-group').onclick=()=>run(()=>groupDialog(false,true));
  $('library-delete-group').onclick=()=>run(async()=>{if(!filters.group)throw new Error('Open a group first.');openDialog('Delete group?');body.append(element('p','Books and image files will be kept.'),button('Delete group',async()=>{await call('group',{action:'delete',id:filters.group});dialog.close();await clear();}));});
  $('library-up').onclick=()=>{groupLabel='';filters={...defaults,attrs:[],excludedTypes:[]};selected.clear();run(load);};
  $('library-prev').onclick=()=>{filters.offset=Math.max(0,filters.offset-filters.limit);run(load);};$('library-next').onclick=()=>{filters.offset+=filters.limit;run(load);};
  $('library-deselect').onclick=()=>{selected.clear();selection();};$('library-select-page').onclick=()=>{for(const book of result?.books||[])selected.add(book.id);selection();};
  $('library-action').onchange=()=>{const action=$('library-action').value;$('library-action').value='';run(()=>selectionAction(action));};
  api.onLibraryOpen(id=>run(()=>startReader(id)));
  api.onLibraryBack(()=>{if(window.readerUI?.active){if(!window.readerUI.back())closeDialog();}else if(dialog.open)closeDialog();else if(selected.size){selected.clear();selection();}else if(groupLabel){$('library-up').click();}else if(grouping!=='flat')run(clear);else run(()=>api.panel('sources'));});
  window.libraryUI={render:state=>{
    const sig=JSON.stringify(state.librarySettings),changed=settingsSignature!==sig;
    if(changed){
      const old=settingsSignature?JSON.parse(settingsSignature):null;settingsSignature=sig;
      if(!old||(old.display!==state.librarySettings.display&&(view==='list')!==(state.librarySettings.display==='list')))view=state.librarySettings.display;
      $('library-view').value=view;resetScroll();
    }
    const entering=!active&&state.panel==='library';active=state.panel==='library';
    $('library-refresh').disabled=state.libraryScan.running;$('library-cancel-scan').hidden=!state.libraryScan.running;
    const scan=state.libraryScan;$('library-scan').hidden=!scan.running&&!scan.errors?.length;
    $('library-scan').textContent=scan.running?`Indexing · ${scan.checked} checked · ${scan.added} added or updated`:scan.errors?.length?`Refresh finished with ${scan.errors.length} issue(s).\n${scan.errors.join('\n')}`:'';
    if(active&&(changed||entering||revision!==state.libraryRevision)&&!dialog.open){revision=state.libraryRevision;run(load);}
  }};
  if(current)window.libraryUI.render(current);
})();
