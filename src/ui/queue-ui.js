(() => {
  let state,tab='queue',query='',source='',offset=0,selected=new Set(),signature='',visible=[],dragId;
  const dialog=$('queue-dialog'),body=$('queue-dialog-content');
  const size=n=>n>=1024**3?`${(n/1024**3).toFixed(1)} GiB`:`${(n/1024**2).toFixed(1)} MiB`;
  function open(title){body.replaceChildren(element('h2',title));if(!dialog.open)dialog.showModal();}
  const close=()=>dialog.close();$('queue-dialog-close').onclick=close;
  dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  function selection(){
    $('queue-selection').hidden=!selected.size;$('queue-selected').textContent=`${selected.size} selected`;
    for(const row of $('jobs').querySelectorAll('.job'))row.classList.toggle('selected',selected.has(row.dataset.id));
  }
  function toggle(id){selected.has(id)?selected.delete(id):selected.add(id);selection();}
  function refresh(){signature='';if(state)render(state);}
  function errors(job){open('Download errors');body.append(element('h3',job.title));for(const entry of job.errorLog?.length?job.errorLog:[{message:job.error||'No errors recorded.'}])body.append(element('p',`${entry.at?new Date(entry.at).toLocaleString()+' · ':''}${entry.message}`));}
  async function action(action,ids=[...selected]){
    if(!ids.length)return;
    if(action==='remove'){
      open('Remove downloads?');body.append(element('p',`Remove ${ids.length} entries? Partial files will be kept.`),button('Remove',async()=>{await api.queueBulk('remove',ids);selected.clear();close();refresh();}));return;
    }
    await api.queueBulk(action,ids);selected.clear();refresh();
  }
  function render(next){
    state=next;selected=new Set([...selected].filter(id=>state.jobs.some(j=>j.id===id)));
    const pending=state.jobs.filter(j=>j.status!=='error'),failed=state.jobs.filter(j=>j.status==='error'),stats=state.queueStats;
    $('queue-pending-tab').textContent=`Queue (${pending.length})`;$('queue-errors-tab').textContent=`Errors (${failed.length})`;
    $('queue-pending-tab').classList.toggle('active',tab==='queue');$('queue-errors-tab').classList.toggle('active',tab==='errors');
    $('start-all').hidden=state.queueRunning;$('start-all').disabled=!pending.some(j=>j.status!=='frozen');$('pause-all').hidden=!state.queueRunning;
    const current=state.jobs.find(j=>j.id===stats.activeId),pages=pending.reduce((n,j)=>n+(j.total||j.expectedPages||0),0),done=pending.reduce((n,j)=>n+j.completed,0);
    $('queue-status').textContent=current?.waitReason||(current?`${current.status==='resolving'?'Preparing':'Downloading'} ${current.title}`:state.queueRunning?'Waiting…':pending.length?'Queue paused':'Queue empty');
    $('queue-info').textContent=`${done} / ${pages||'—'} pages${failed.length?' · '+failed.length+' error(s)':''} · ${size(stats.bytesPerSecond)}/s${stats.dataLimit?' · '+size(stats.transferred)+' / '+size(stats.dataLimit):''}`;
    const nextSignature=JSON.stringify([state.jobs,tab,query,source,offset]);if(signature===nextSignature){selection();return;}signature=nextSignature;
    visible=(tab==='queue'?pending:failed).filter(j=>(!source||j.site===source)&&(!query||[j.title,j.sourceId,...(j.tags||[])].join(' ').toLowerCase().includes(query.toLowerCase())));
    if(offset>=visible.length)offset=Math.max(0,Math.ceil(visible.length/60)-1)*60;
    $('queue-prev').disabled=offset===0;$('queue-next').disabled=offset+60>=visible.length;$('queue-page').textContent=visible.length?`${offset/60+1} / ${Math.ceil(visible.length/60)}`:'0 / 0';
    $('jobs').replaceChildren();
    if(!visible.length){const empty=element('div',null,'empty');empty.append(element('div',tab==='errors'?'✓':'⇩','empty-icon'),element('h3',tab==='errors'?'No download errors':'Your queue is empty'),element('p',query?'No matching downloads.':tab==='errors'?'Failed downloads will appear here.':'Completed books are in the library.'));$('jobs').append(empty);}
    for(const job of visible.slice(offset,offset+60)){
      const row=element('article',null,'job');row.dataset.id=job.id;row.tabIndex=0;row.draggable=tab==='queue';
      const cover=element('img',null,'queue-cover');cover.src=`hentdows://app/queue/${job.id}/cover`;cover.alt='';cover.loading='lazy';
      const info=element('div',null,'queue-book');info.append(element('h3',job.title),element('p',(job.tags||[]).filter(t=>t.startsWith('artist:')).map(t=>t.slice(7)).join(', '),'queue-artist'));
      const detail=element('div',null,'detail');detail.append(element('span',`${job.site} · ${job.status}`),element('span',`${job.completed} / ${job.total||job.expectedPages||'—'} pages`));info.append(detail);
      const progress=element('progress');progress.max=job.total||job.expectedPages||1;progress.value=job.completed;info.append(progress);
      if(job.error)info.append(button(job.error,()=>errors(job)));if(job.waitReason)info.append(element('p',job.waitReason,'wait-reason'));
      const actions=element('div',null,'job-actions');
      if(['error','paused'].includes(job.status))actions.append(button(job.status==='error'?'Retry':'Resume',()=>action('resume',[job.id])));
      if(job.status!=='error')actions.append(button(job.status==='frozen'?'Unfreeze':'Freeze',()=>action(job.status==='frozen'?'unfreeze':'freeze',[job.id])),button('↑',()=>action('top',[job.id])),button('↓',()=>action('bottom',[job.id])));
      actions.append(button('↗',()=>api.navigate(job.url)),button('×',()=>action('remove',[job.id])));
      if(job.completed)actions.append(button('Files',()=>api.openFolder(job.id)));
      info.append(actions);row.append(cover,info);row.ondblclick=e=>{if(!e.target.closest('button'))toggle(job.id);};row.onclick=e=>{if(selected.size&&!e.target.closest('button'))toggle(job.id);};row.onkeydown=e=>{if(e.target===row&&e.key===' '){e.preventDefault();toggle(job.id);}};
      row.ondragstart=e=>{dragId=job.id;e.dataTransfer.effectAllowed='move';};row.ondragover=e=>e.preventDefault();row.ondrop=e=>{e.preventDefault();if(!dragId||dragId===job.id)return;const ids=pending.map(j=>j.id).filter(id=>id!==dragId);ids.splice(ids.indexOf(job.id),0,dragId);run(()=>api.queueBulk('order',ids));dragId=null;};
      $('jobs').append(row);
    }
    selection();
  }
  $('queue-pending-tab').onclick=()=>{tab='queue';offset=0;selected.clear();refresh();};$('queue-errors-tab').onclick=()=>{tab='errors';offset=0;selected.clear();refresh();};
  $('queue-search').oninput=()=>{query=$('queue-search').value;offset=0;refresh();};$('queue-source').onchange=()=>{source=$('queue-source').value;offset=0;refresh();};
  $('queue-prev').onclick=()=>{offset-=60;refresh();};$('queue-next').onclick=()=>{offset+=60;refresh();};
  $('queue-select-all').onclick=()=>{visible.forEach(j=>selected.add(j.id));selection();};$('queue-deselect').onclick=()=>{selected.clear();selection();};
  $('queue-action').onchange=()=>{const value=$('queue-action').value;$('queue-action').value='';run(()=>action(value));};
  $('queue-menu-button').onclick=()=>{$('queue-menu').hidden=!$('queue-menu').hidden;};
  $('queue-reverse').onclick=()=>run(()=>action('reverse',state.jobs.filter(j=>j.status!=='error').map(j=>j.id)));
  $('queue-retry-all').onclick=()=>run(()=>action('resume',state.jobs.filter(j=>j.status==='error').map(j=>j.id)));
  $('queue-remove-all').onclick=()=>run(()=>action('remove',visible.map(j=>j.id)));
  $('queue-error-stats').onclick=()=>{open('Error statistics');const counts=new Map();for(const job of state.jobs.filter(j=>j.status==='error'))counts.set(job.error,(counts.get(job.error)||0)+1);for(const [message,count]of counts)body.append(element('p',`${count} · ${message}`));if(!counts.size)body.append(element('p','No errors.'));};
  $('queue-limit').onclick=()=>{open('Download data limit');const input=element('input');input.type='number';input.min=0;input.max=1000000;input.value=Math.round(state.queueStats.dataLimit/1024**2);input.setAttribute('aria-label','Data limit in MiB');body.append(element('p','Pause after transferring this many MiB over any connection. Zero removes the limit. Setting a limit resets its byte counter.'),input,button('Set limit',async()=>{await api.queueBulk('limit',Number(input.value));close();}));};
  $('queue-import').onclick=()=>{open('Import download links');const input=element('textarea');input.placeholder='One gallery URL per line';input.setAttribute('aria-label','Gallery URLs');const submit=button('Queue links',async()=>{submit.disabled=true;try{const results=await api.queueImport(input.value);body.append(element('p',`${results.filter(r=>r.status==='queued').length} queued · ${results.filter(r=>r.status==='duplicate').length} duplicates · ${results.filter(r=>r.status==='error').length} errors`));for(const result of results.filter(r=>r.status==='error'))body.append(element('p',result.message));}finally{submit.disabled=false;}});body.append(input,submit);};
  $('queue-settings').onclick=()=>run(async()=>{await api.panel('settings');$('settings-section').value='downloads';renderSettings(current);});
  api.onQueueBack(()=>{if(dialog.open)close();else if(selected.size){selected.clear();selection();}else run(()=>api.command('leave-queue'));});
  api.onDownloadFeedback(value=>{if(value.status==='queued')$('queue').animate([{transform:'scale(1)'},{transform:'scale(1.35)',color:'#8de2ac'},{transform:'scale(1)'}],{duration:500});});
  window.queueUI={render};if(current)render(current);
})();
