const api = window.hentdows;
const $ = id => document.getElementById(id);
let current;
function renderSettings(state) {
  const section=$('settings-section').value;
  const schema=section==='downloads'?state.settingsSchema:state[section+'Schema'];
  const values=section==='downloads'?state.downloadSettings:state[section+'Settings'];
  $('settings-title').textContent={downloads:'Downloader',browser:'Browser',library:'Library',viewer:'Viewer'}[section];
  $('settings-note').textContent=section==='viewer'?'Windows uses configurable keyboard shortcuts and Chromium image rendering. Hentdows downloads contain one chapter per book.':section==='downloads'?'Image options apply to the next download or retry; saved pages are kept.':'';
  if ($('settings-fields').dataset.section!==section) {
    $('settings-fields').dataset.section=section; $('settings-fields').replaceChildren();
    let group;
    for (const field of schema) {
      if (field.group !== group) { group = field.group; if (group) $('settings-fields').append(element('h3', group, 'settings-group')); }
      const row = element('label', null, `preference ${field.type === 'boolean' ? 'toggle-row' : ''}`);
      const description = element('span', null, 'preference-description');
      description.append(element('span', field.title, 'preference-title'));
      if (field.summary) description.append(element('small', field.summary));
      row.append(description);
      const input = document.createElement(field.type === 'select' ? 'select' : 'input');
      input.id = `setting-${field.key}`; input.setAttribute('aria-label', field.title);
      if (field.type === 'select') for (const choice of field.choices) { const option = element('option', choice.label); option.value = String(choice.value); input.append(option); }
      else input.type = field.type === 'boolean' ? 'checkbox' : field.type === 'key' ? 'text' : field.type;
      if(field.type==='key')input.onkeydown=e=>{if(e.key==='Tab')return;e.preventDefault();input.value=e.key;input.dispatchEvent(new Event('change'));};
      if (field.min != null) { input.min = field.min; input.max = field.max; input.step = 1; }
      input.onchange = () => run(async () => {
        let value = field.type === 'boolean' ? input.checked : field.type === 'number' ? Number(input.value) : input.value;
        if (field.type === 'select') value = field.choices.find(c => String(c.value) === input.value).value;
        if (!input.reportValidity()) return;
        try { await (section==='downloads'||section==='browser'&&field.key.startsWith('duplicate')?api.saveSettings({ [field.key]: value }):section==='browser'?api.saveBrowser({[field.key]:value}):api.savePreferences(section,{ [field.key]: value })); }
        catch (error) { renderSettings(current); throw error; }
      });
      row.append(input); $('settings-fields').append(row);
    }
  }
  if(section==='viewer'&&!$('reset-color')){const reset=button('Reset color filter',()=>api.savePreferences('viewer',{color:'#ffffff',colorOpacity:0}));reset.id='reset-color';$('settings-fields').append(reset);}
  if(section==='browser'&&!$('browser-clear-actions')){const actions=element('div',null,'browser-actions');actions.id='browser-clear-actions';actions.append(button('Clear cookies…',()=>api.browser('clear-cookies')),button('Clear cache…',()=>api.browser('clear-cache')));$('settings-fields').append(actions);}
  for (const field of schema) {
    const input = $(`setting-${field.key}`), value = values[field.key];
    if (field.type === 'boolean') input.checked = value;
    else if (document.activeElement !== input) input.value = value;
    input.disabled = Boolean((field.depends && !values[field.depends]) || (field.disabledWhen && values[field.disabledWhen]));
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
  current = state;document.body.classList.toggle('queue-open',state.panel==='queue');
  document.body.classList.toggle('loading', state.loading);
  $('source-panel').hidden = state.panel !== 'sources'; $('queue-panel').hidden = state.panel !== 'queue';
  $('settings-panel').hidden = state.panel !== 'settings';
  $('library-panel').hidden = state.panel !== 'library';
  $('address-form').hidden = state.panel === 'library'; $('library-search').hidden = state.panel !== 'library';
  $('login').hidden = state.panel === 'library';
  for (const id of ['forward','reload','download']) $(id).hidden = ['library','queue'].includes(state.panel);
  $('heading').textContent = state.panel === 'library' ? 'Library' : state.panel === 'settings' ? 'Settings' : state.panel === 'queue' ? 'Downloads' : 'Browser';
  window.libraryUI?.render(state);
  window.browserUI?.render(state);
  renderSettings(state);
  if (document.activeElement !== $('address')) $('address').value = state.url;
  $('folder-path').textContent = state.downloadRoot;
  $('count').textContent = state.jobs.filter(j => ['queued', 'waiting', 'resolving', 'downloading'].includes(j.status)).length;
  $('start-all').disabled = state.queueRunning;
  $('forward').disabled = !state.canForward; $('reload').disabled = !state.url;
  $('download').disabled = !state.gallery || state.panel !== 'browser';
  const status = state.error || state.notice || (state.panel === 'library' ? 'Double-click a book to select it · Esc to go back' : state.panel === 'settings' ? 'Preferences' : state.loading ? 'Loading…' : state.gallery ? 'Gallery ready to download' : state.panel === 'browser' ? 'Double-click a gallery to download' : 'Choose a source');
  $('status').textContent = status; $('status').title = status; $('status').classList.toggle('error', Boolean(state.error));
  if (!$('site-list').children.length) state.sites.forEach((site, i) => {
    const item = button('', () => api.browser('source',site.id)); item.className = 'site';
    item.append(element('span', ['E', 'Ex', 'H'][i], 'site-badge'));
    const info = element('span', null, 'site-info'); info.append(element('strong', site.name), element('small', new URL(site.url).hostname));
    item.append(info, element('span', '›', 'site-arrow')); $('site-list').append(item);
  });
  window.queueUI?.render(state);
}
$('address-form').onsubmit = event => { event.preventDefault(); const value = $('address').value.trim(); run(() => api.navigate(value.includes('://') ? value : `https://${value}`)); };
$('sources').onclick = () => run(() => api.panel(current?.panel === 'sources' && current.url ? 'browser' : 'sources'));
$('queue').onclick = () => run(() => api.panel(current?.panel === 'queue' ? 'browser' : 'queue'));
$('settings').onclick = () => run(() => current?.panel === 'settings' ? api.command('back') : api.panel('settings'));
$('library').onclick = () => run(() => api.panel('library'));
for (const command of ['back', 'forward', 'reload', 'login', 'pause-all', 'start-all']) $(command).onclick = () => run(() => api.command(command));
$('download').onclick = () => run(() => api.enqueue());
$('choose-folder').onclick = () => run(() => api.chooseFolder());
$('settings-section').onchange=()=>renderSettings(current);
api.subscribe(render);
run(async () => render(await api.state()));
