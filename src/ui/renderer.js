const api = window.hentdows;
const $ = id => document.getElementById(id);
let current;
function renderSettings(state) {
  if (!$('settings-fields').children.length) {
    let group;
    for (const field of state.settingsSchema) {
      if (field.group !== group) { group = field.group; if (group) $('settings-fields').append(element('h3', group, 'settings-group')); }
      const row = element('label', null, `preference ${field.type === 'boolean' ? 'toggle-row' : ''}`);
      const description = element('span', null, 'preference-description');
      description.append(element('span', field.title, 'preference-title'));
      if (field.summary) description.append(element('small', field.summary));
      row.append(description);
      const input = document.createElement(field.type === 'select' ? 'select' : 'input');
      input.id = `setting-${field.key}`; input.setAttribute('aria-label', field.title);
      if (field.type === 'select') for (const choice of field.choices) { const option = element('option', choice.label); option.value = String(choice.value); input.append(option); }
      else input.type = field.type === 'boolean' ? 'checkbox' : field.type;
      if (field.min != null) { input.min = field.min; input.max = field.max; input.step = 1; }
      input.onchange = () => run(async () => {
        let value = field.type === 'boolean' ? input.checked : field.type === 'number' ? Number(input.value) : input.value;
        if (field.type === 'select') value = field.choices.find(c => String(c.value) === input.value).value;
        if (!input.reportValidity()) return;
        try { await api.saveSettings({ [field.key]: value }); }
        catch (error) { renderSettings(current); throw error; }
      });
      row.append(input); $('settings-fields').append(row);
    }
  }
  for (const field of state.settingsSchema) {
    const input = $(`setting-${field.key}`), value = state.downloadSettings[field.key];
    if (field.type === 'boolean') input.checked = value;
    else if (document.activeElement !== input) input.value = value;
    input.disabled = Boolean(field.depends && !state.downloadSettings[field.depends]);
    input.closest('label').classList.toggle('disabled', input.disabled);
  }
}
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
  $('settings-panel').hidden = state.panel !== 'settings';
  $('library-panel').hidden = state.panel !== 'library';
  $('address-form').hidden = state.panel === 'library'; $('library-search').hidden = state.panel !== 'library';
  $('login').hidden = state.panel === 'library';
  for (const id of ['forward','reload','download']) $(id).hidden = state.panel === 'library';
  $('heading').textContent = state.panel === 'library' ? 'Library' : state.panel === 'settings' ? 'Settings' : state.panel === 'queue' ? 'Downloads' : 'Browser';
  window.libraryUI?.render(state);
  renderSettings(state);
  if (document.activeElement !== $('address')) $('address').value = state.url;
  $('folder-path').textContent = state.downloadRoot;
  $('count').textContent = state.jobs.filter(j => ['queued', 'waiting', 'resolving', 'downloading'].includes(j.status)).length;
  $('start-all').disabled = state.queueRunning;
  $('forward').disabled = !state.canForward; $('reload').disabled = !state.url;
  $('download').disabled = !state.gallery || state.panel !== 'browser';
  const status = state.error || state.notice || (state.panel === 'library' ? 'Double-click a book to select it · Esc to go back' : state.panel === 'settings' ? 'Download preferences' : state.loading ? 'Loading…' : state.gallery ? 'Gallery ready to download' : state.panel === 'browser' ? 'Double-click a gallery to download' : 'Choose a source');
  $('status').textContent = status; $('status').title = status; $('status').classList.toggle('error', Boolean(state.error));
  if (!$('site-list').children.length) state.sites.forEach((site, i) => {
    const item = button('', () => api.navigate(site.url)); item.className = 'site';
    item.append(element('span', ['E', 'Ex', 'H'][i], 'site-badge'));
    const info = element('span', null, 'site-info'); info.append(element('strong', site.name), element('small', new URL(site.url).hostname));
    item.append(info, element('span', '›', 'site-arrow')); $('site-list').append(item);
  });
  // Keep focused controls in place between browser loading events.
  const signature = JSON.stringify([state.queueRunning, state.jobs]);
  if ($('jobs').dataset.signature === signature) return;
  $('jobs').dataset.signature = signature; $('jobs').replaceChildren();
  if (!state.jobs.length) {
    const empty = element('div', null, 'empty');
    empty.append(element('div', '⇩', 'empty-icon'), element('h3', 'Your queue is empty'), element('p', 'Open a gallery and use the download button, or double-click a gallery link.'));
    $('jobs').append(empty);
  }
  const finished = job => ['complete', 'cancelled'].includes(job.status);
  for (const job of [...state.jobs.filter(j => !finished(j)), ...state.jobs.filter(finished).reverse()]) {
    const row = element('article', null, 'job'); row.append(element('h3', job.title));
    const detail = element('div', null, 'detail'); detail.append(element('span', `${job.site} · ${job.status}`), element('span', `${job.completed} / ${job.total || '—'} pages`)); row.append(detail);
    const progress = element('progress'); progress.max = job.total || 1; progress.value = job.completed; progress.setAttribute('aria-label', 'Download progress'); row.append(progress);
    if (job.error) row.append(element('p', job.error));
    if (job.waitReason) row.append(element('p', job.waitReason, 'wait-reason'));
    const actions = element('div', null, 'job-actions');
    if (['queued', 'waiting', 'resolving', 'downloading'].includes(job.status)) actions.append(button('Pause', () => api.queueAction(job.id, 'pause')));
    if (['paused', 'error', 'cancelled'].includes(job.status) || (job.status === 'queued' && !state.queueRunning)) actions.append(button(job.status === 'error' ? 'Retry' : 'Resume', () => api.queueAction(job.id, 'resume')));
    if (!['complete', 'cancelled'].includes(job.status)) actions.append(button('Cancel', () => api.queueAction(job.id, 'cancel')));
    if (job.completed) actions.append(button('Show files', () => api.openFolder(job.id)));
    row.append(actions); $('jobs').append(row);
  }
}
$('address-form').onsubmit = event => { event.preventDefault(); const value = $('address').value.trim(); run(() => api.navigate(value.includes('://') ? value : `https://${value}`)); };
$('sources').onclick = () => run(() => api.panel(current?.panel === 'sources' && current.url ? 'browser' : 'sources'));
$('queue').onclick = () => run(() => api.panel(current?.panel === 'queue' ? 'browser' : 'queue'));
$('settings').onclick = () => run(() => current?.panel === 'settings' ? api.command('back') : api.panel('settings'));
$('library').onclick = () => run(() => api.panel('library'));
for (const command of ['back', 'forward', 'reload', 'login', 'pause-all', 'start-all']) $(command).onclick = () => run(() => api.command(command));
$('download').onclick = () => run(() => api.enqueue());
$('choose-folder').onclick = () => run(() => api.chooseFolder());
api.subscribe(render);
run(async () => render(await api.state()));
