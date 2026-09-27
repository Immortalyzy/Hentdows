const api = window.hentdows;
const $ = id => document.getElementById(id);
let current;
async function run(action) {
  try { return await action(); }
  catch (error) { $('status').textContent = error.message.replace(/^Error invoking remote method '[^']+': Error: /, ''); $('status').title = $('status').textContent; $('status').classList.add('error'); }
}
function element(tag, text, className) {
  const el = document.createElement(tag); if (text != null) el.textContent = text; if (className) el.className = className; return el;
}
function button(text, action) { const el = element('button', text); el.onclick = () => run(action); return el; }
function render(state) {
  current = state;
  document.body.classList.toggle('loading', state.loading);
  $('source-panel').hidden = state.panel !== 'sources'; $('queue-panel').hidden = state.panel !== 'queue';
  $('heading').textContent = state.panel === 'queue' ? 'Downloads' : 'Browser';
  if (document.activeElement !== $('address')) $('address').value = state.url;
  $('folder-path').textContent = state.downloadRoot;
  $('count').textContent = state.jobs.filter(j => ['queued', 'resolving', 'downloading'].includes(j.status)).length;
  $('forward').disabled = !state.canForward; $('reload').disabled = !state.url;
  $('download').disabled = !state.gallery || state.panel !== 'browser';
  const status = state.error || state.notice || (state.loading ? 'Loading…' : state.gallery ? 'Gallery ready to download' : state.panel === 'browser' ? 'Double-click a gallery to download' : 'Choose a source');
  $('status').textContent = status; $('status').title = status; $('status').classList.toggle('error', Boolean(state.error));
  if (!$('site-list').children.length) state.sites.forEach((site, i) => {
    const item = button('', () => api.navigate(site.url)); item.className = 'site';
    item.append(element('span', ['E', 'Ex', 'H'][i], 'site-badge'));
    const info = element('span', null, 'site-info'); info.append(element('strong', site.name), element('small', new URL(site.url).hostname));
    item.append(info, element('span', '›', 'site-arrow')); $('site-list').append(item);
  });
  // Keep focused controls in place between browser loading events.
  const signature = JSON.stringify(state.jobs);
  if ($('jobs').dataset.signature === signature) return;
  $('jobs').dataset.signature = signature; $('jobs').replaceChildren();
  if (!state.jobs.length) {
    const empty = element('div', null, 'empty');
    empty.append(element('div', '⇩', 'empty-icon'), element('h3', 'Your queue is empty'), element('p', 'Open a gallery and use the download button, or double-click a gallery link.'));
    $('jobs').append(empty);
  }
  for (const job of [...state.jobs].reverse()) {
    const row = element('article', null, 'job'); row.append(element('h3', job.title));
    const detail = element('div', null, 'detail'); detail.append(element('span', `${job.site} · ${job.status}`), element('span', `${job.completed} / ${job.total || '—'} pages`)); row.append(detail);
    const progress = element('progress'); progress.max = job.total || 1; progress.value = job.completed; progress.setAttribute('aria-label', 'Download progress'); row.append(progress);
    if (job.error) row.append(element('p', job.error));
    const actions = element('div', null, 'job-actions');
    if (['queued', 'resolving', 'downloading'].includes(job.status)) actions.append(button('Pause', () => api.queueAction(job.id, 'pause')));
    if (['paused', 'error', 'cancelled'].includes(job.status)) actions.append(button(job.status === 'error' ? 'Retry' : 'Resume', () => api.queueAction(job.id, 'resume')));
    if (!['complete', 'cancelled'].includes(job.status)) actions.append(button('Cancel', () => api.queueAction(job.id, 'cancel')));
    if (job.completed) actions.append(button('Show files', () => api.openFolder(job.id)));
    row.append(actions); $('jobs').append(row);
  }
}
$('address-form').onsubmit = event => { event.preventDefault(); const value = $('address').value.trim(); run(() => api.navigate(value.includes('://') ? value : `https://${value}`)); };
$('sources').onclick = () => run(() => api.panel(current?.panel === 'sources' && current.url ? 'browser' : 'sources'));
$('queue').onclick = () => run(() => api.panel(current?.panel === 'queue' ? 'browser' : 'queue'));
for (const command of ['back', 'forward', 'reload', 'login', 'pause-all']) $(command).onclick = () => run(() => api.command(command));
$('download').onclick = () => run(() => api.enqueue());
$('choose-folder').onclick = () => run(() => api.chooseFolder());
api.subscribe(render);
run(async () => render(await api.state()));
