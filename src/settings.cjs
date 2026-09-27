// Labels, defaults and choices follow Hentoid's downloader PreferenceScreen.
const choice = (value, label) => ({ value, label });
const SETTINGS = [
  ...[
    {key:'duplicateAsk',title:'Ask before downloading duplicates',default:true},
    {key:'duplicateTitle',title:'Compare titles',default:true},
    {key:'duplicateArtist',title:'Compare artists',default:true},
    {key:'duplicateLanguage',title:'Require the same language',default:false},
    {key:'duplicateCover',title:'Compare covers',default:true}
  ].map(f=>({...f,group:'Duplicate detection',type:'boolean'})),
  {key:'duplicateSensitivity',group:'Duplicate detection',title:'Sensitivity',type:'select',default:2,choices:[choice(0,'High (more matches)'),choice(1,'Medium'),choice(2,'Low (strong matches)')]},
  { key: 'autoStart', group: '', title: 'Auto-start download queue', type: 'boolean', default: true, summary: 'Start the queue when a gallery is added.' },
  { key: 'scheduleEnabled', group: '', title: 'Schedule downloads', type: 'boolean', default: false, summary: 'Download only during the daily time window while Hentdows is open.' },
  { key: 'scheduleStart', group: '', title: 'Start time', type: 'time', default: '00:00', depends: 'scheduleEnabled' },
  { key: 'scheduleEnd', group: '', title: 'End time', type: 'time', default: '06:00', depends: 'scheduleEnabled' },
  { key: 'newPosition', group: '', title: 'New downloads position', type: 'select', default: 'bottom', choices: [choice('top', 'Top'), choice('bottom', 'Bottom'), choice('ask', 'Ask every time')] },
  { key: 'wifiOnly', group: '', title: 'Only download on Wi-Fi', type: 'boolean', default: false, summary: 'Wait until the active Windows network connection is Wi-Fi.' },
  { key: 'skipLarge', group: 'Skip large downloads', title: 'Skip large downloads', type: 'boolean', default: false },
  { key: 'largeOnWifi', group: 'Skip large downloads', title: 'Allow Large Downloads on Wi-Fi', type: 'boolean', default: false, depends: 'skipLarge' },
  { key: 'maxSizeMB', group: 'Skip large downloads', title: 'Size threshold for large downloads', type: 'select', default: 40, depends: 'skipLarge', choices: [choice(999999, 'No size limit'), ...[20, 40, 100, 200].map(n => choice(n, `${n} MB`))] },
  { key: 'maxPages', group: 'Skip large downloads', title: 'Page threshold for large downloads', type: 'select', default: 999999, depends: 'skipLarge', choices: [choice(999999, 'No page limit'), ...[60, 120, 200, 500].map(n => choice(n, `${n} pages`))] },
  { key: 'blockedTags', group: 'Tag blocking', title: 'Blocked tags', type: 'text', default: '', summary: 'Separate tags with commas. A namespace such as artist: or language: is optional.' },
  { key: 'blockedBehaviour', group: 'Tag blocking', title: 'Blocking behaviour', type: 'select', default: 'reject', choices: [choice('reject', "Don't queue"), choice('error', 'Queue as download error'), choice('confirm', 'Queue on 2nd tap')] },
  { key: 'retriesEnabled', group: 'Automated download retries', title: 'Retries activated', type: 'boolean', default: false, summary: 'Automatically retry failed pages after trying the source fallback.' },
  { key: 'retryCount', group: 'Automated download retries', title: 'Number of retries before aborting', type: 'select', default: 5, depends: 'retriesEnabled', choices: [1, 2, 3, 4, 5].map(n => choice(n, String(n))) },
  { key: 'retryStorageLimit', group: 'Automated download retries', title: 'Mem usage threshold before aborting', type: 'select', default: 100, depends: 'retriesEnabled', summary: 'Stop retries when the download drive reaches this storage usage.', choices: [90, 95, 98, 100].map(n => choice(n, n === 100 ? 'None' : `${n}%`)) },
  { key: 'ehOriginal', group: 'E-hentai / ExHentai', title: 'Download hi-res pictures', type: 'boolean', default: false, summary: 'Off: download pictures displayed on the website. On: use originals when available; requires login and consumes the image-view quota much faster.' },
  { key: 'hitomiAvif', group: 'Hitomi', title: 'Download in AVIF format', type: 'boolean', default: false, summary: 'Use AVIF when available. Otherwise download WebP.' },
  { key: 'parallel', group: 'Advanced', title: 'Parallel downloads', type: 'select', default: 0, summary: 'Number of images downloaded simultaneously. Auto uses up to four.', choices: [choice(0, 'Auto (default)'), choice(2, '2 (slow Internet)'), ...[4, 6, 8, 10].map(n => choice(n, String(n)))] },
  { key: 'speedKBps', group: 'Advanced', title: 'Download speed limit', type: 'select', default: 0, summary: 'Shared across all active image transfers.', choices: [choice(0, 'None (default)'), ...[100, 200, 400, 800].map(n => choice(n, `${n} KBps`))] },
  { key: 'http429Delay', group: 'Advanced', title: 'HTTP 429 default delay (seconds)', type: 'number', default: 120, min: 1, max: 86400, summary: 'Wait before retrying a rate-limited request. A longer Retry-After from the server takes precedence.' },
  { key: 'separateThumbnail', group: 'Advanced', title: 'Thumbnails', type: 'boolean', default: true, summary: 'On: create a separate thumbnail file. Off: use page 1 as the thumbnail.' },
  { key: 'http404', group: 'Advanced', title: 'HTTP 404 management', type: 'select', default: 'error', choices: [choice('error', 'Flag as download error (default)'), choice('placeholder', 'Replace with a placeholder picture'), choice('ignore', 'Ignore missing files')] }
];
const DEFAULT_DOWNLOADS = Object.freeze(Object.fromEntries(SETTINGS.map(s => [s.key, s.default])));

function validateDownloads(patch, base = DEFAULT_DOWNLOADS) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid download settings.');
  const output = { ...DEFAULT_DOWNLOADS, ...base };
  for (const [key, value] of Object.entries(patch)) {
    const field = SETTINGS.find(s => s.key === key);
    if (!field) throw new Error(`Unknown download setting: ${key}`);
    const valid = field.type === 'boolean' ? typeof value === 'boolean'
      : field.type === 'select' ? field.choices.some(c => c.value === value)
        : field.type === 'time' ? typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
          : field.type === 'number' ? Number.isInteger(value) && value >= field.min && value <= field.max
            : typeof value === 'string' && value.length <= 10000;
    if (!valid) throw new Error(`Invalid value for ${field.title}.`);
    output[key] = value;
  }
  return output;
}

function inSchedule(options, now = new Date()) {
  if (!options.scheduleEnabled) return true;
  const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const start = minutes(options.scheduleStart), end = minutes(options.scheduleEnd), current = now.getHours() * 60 + now.getMinutes();
  return start === end || (start < end ? current >= start && current < end : current >= start || current < end);
}

function blockedTags(tags, input) {
  const normalized = tags.map(t => String(t).toLowerCase().trim().replaceAll('_', ' '));
  return input.split(',').map(t => t.toLowerCase().trim().replaceAll('_', ' ')).filter(Boolean)
    .filter(blocked => normalized.some(tag => tag === blocked || (!blocked.includes(':') && tag.split(':').at(-1) === blocked)));
}

module.exports = { SETTINGS, DEFAULT_DOWNLOADS, validateDownloads, inSchedule, blockedTags };
