const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { galleryFromUrl } = require('./sites.cjs');
const { readJson, writeJson } = require('./storage.cjs');
const { DEFAULT_DOWNLOADS, inSchedule, blockedTags } = require('./settings.cjs');
const { SpeedLimiter, saveResponse, imageExtension, placeholderPng } = require('./transfer.cjs');

const BUSY = ['queued', 'waiting', 'resolving', 'downloading'];
class DownloadQueue extends EventEmitter {
  constructor({ file, resolveGallery, resolveImage, fetchImage, getMetadata, getSettings = () => DEFAULT_DOWNLOADS,
    network = async () => ({ online: true, wifi: null }), now = () => new Date(), sleep = delay }) {
    super();
    Object.assign(this, { file, resolveGallery, resolveImage, fetchImage, getMetadata, getSettings, network, now, sleep });
    this.jobs = readJson(file, []);
    if (!Array.isArray(this.jobs)) throw new Error('Invalid queue file. Your data has been preserved.');
    for (const job of this.jobs) if (BUSY.includes(job.status)) { job.status = 'paused'; job.waitReason = null; }
    this.active = null; this.running = false; this.closed = false; this.confirmations = new Map(); this.pendingAdds = new Set();
    this.limiter = new SpeedLimiter(() => this.getSettings().speedKBps, sleep);
  }
  snapshot() { return structuredClone(this.jobs); }
  archiveCompleted(indexedPaths) {
    const indexed=new Set(indexedPaths),completed=this.jobs.filter(j=>j.status==='complete'&&indexed.has(j.directory));
    const archive=new Set(completed.slice(0,Math.max(0,completed.length-100)).map(j=>j.id));
    if(archive.size){this.jobs=this.jobs.filter(j=>!archive.has(j.id));this.save();}
  }
  save() { writeJson(this.file, this.jobs); this.emit('change', this.snapshot()); }
  kick() { if (!this.closed) void this.pump().catch(error => this.emit('problem', error.message)); }

  async add(url, root, position) {
    const gallery = galleryFromUrl(url);
    if (!gallery) throw new Error('Open a supported gallery before downloading.');
    const existing = this.jobs.find(j => j.key === gallery.key && j.status !== 'cancelled');
    if (existing) return existing.id;
    const options = this.getSettings();
    let metadata, overrideBlocked = false, initialError;
    if (options.blockedTags.trim()) {
      const controller = new AbortController(); this.pendingAdds.add(controller);
      try { metadata = await this.getMetadata(gallery, controller.signal); }
      finally { this.pendingAdds.delete(controller); }
      const blocked = blockedTags(metadata.tags || [], options.blockedTags);
      if (blocked.length) {
        const message = `Blocked tags: ${blocked.join(', ')}.`, signature = JSON.stringify(blocked);
        if (options.blockedBehaviour === 'reject') throw new Error(`${message} Gallery was not queued.`);
        if (options.blockedBehaviour === 'error') initialError = message;
        if (options.blockedBehaviour === 'confirm') {
          if (this.confirmations.get(gallery.key) !== signature) {
            this.confirmations.set(gallery.key, signature);
            throw new Error(`${message} Download this gallery again to queue it anyway.`);
          }
          this.confirmations.delete(gallery.key); overrideBlocked = true;
        }
      }
    }
    return this.enqueue(url, root, { position, metadata, overrideBlocked, initialError });
  }
  enqueue(url, root, { position, metadata, overrideBlocked = false, initialError } = {}) {
    if (this.closed) throw new Error('The download queue is closing.');
    const gallery = galleryFromUrl(url);
    if (!gallery) throw new Error('Open a supported gallery before downloading.');
    const existing = this.jobs.find(j => j.key === gallery.key && j.status !== 'cancelled');
    if (existing) return existing.id;
    if (!path.isAbsolute(root)) throw new Error('Choose an absolute download folder.');
    const options = this.getSettings();
    const job = { ...gallery, id: randomUUID(), sourceId: gallery.id, title: metadata?.title || `${gallery.site} ${gallery.id}`,
      directory: path.join(root, gallery.site, gallery.id), status: initialError ? 'error' : 'queued', completed: 0, total: 0,
      files: [], createdAt: new Date().toISOString(), error: initialError || null, overrideBlocked };
    if ((position || options.newPosition) === 'top') this.jobs.splice(this.active ? this.jobs.findIndex(j => j.id === this.active.id) + 1 : 0, 0, job);
    else this.jobs.push(job);
    if (options.autoStart && !initialError) this.running = true;
    this.save(); this.kick(); return job.id;
  }
  action(id, action) {
    const job = this.jobs.find(j => j.id === id);
    if (!job) throw new Error('Download not found.');
    if (action === 'pause' && BUSY.includes(job.status)) job.status = 'paused';
    else if (action === 'cancel' && job.status !== 'complete') job.status = 'cancelled';
    else if (action === 'resume' && ['paused', 'error', 'cancelled', 'queued', 'waiting'].includes(job.status)) {
      if (this.jobs.some(other => other.id !== id && other.key === job.key && other.status !== 'cancelled')) throw new Error('This gallery already has another download.');
      job.status = 'queued'; job.error = null; this.running = true;
    } else return;
    job.waitReason = null;
    if (this.active?.id === id) this.active.controller.abort();
    this.save(); this.kick();
  }
  startAll() {
    this.running = true;
    for (const job of this.jobs) if (job.status === 'paused') job.status = 'queued';
    this.save(); this.kick();
  }
  pauseAll() {
    this.running = false;
    for (const job of this.jobs) if (BUSY.includes(job.status)) { job.status = 'paused'; job.waitReason = null; }
    this.active?.controller.abort(); this.save();
  }
  close() { this.closed = true; for (const controller of this.pendingAdds) controller.abort(); this.pauseAll(); }
  async gate() {
    const options = this.getSettings();
    if (!inSchedule(options, this.now())) return 'Waiting for the scheduled download window.';
    const network = await this.network(options.wifiOnly || (options.skipLarge && options.largeOnWifi));
    if (!network.online) return 'Waiting for a network connection.';
    if (options.wifiOnly && network.wifi !== true) return 'Waiting for an active Wi-Fi connection.';
    return null;
  }
  async tick() {
    if (!this.running || this.closed) return;
    if (this.active) {
      const current = this.active, reason = await this.gate();
      if (reason && this.active === current && !current.controller.signal.aborted) {
        const job = this.jobs.find(j => j.id === current.id);
        job.status = 'waiting'; job.waitReason = reason; current.controller.abort(); this.save();
      }
    } else this.kick();
  }
  async pump() {
    if (this.active || !this.running || this.closed) return;
    const job = this.jobs.find(j => ['queued', 'waiting'].includes(j.status));
    if (!job) { this.running = false; this.emit('change', this.snapshot()); return; }
    const controller = new AbortController(), signal = controller.signal;
    this.active = { id: job.id, controller };
    let wait = false;
    try {
      const reason = await this.gate(); signal.throwIfAborted();
      if (reason) { job.status = 'waiting'; job.waitReason = reason; wait = true; this.save(); return; }
      const options = { ...this.getSettings() };
      job.status = 'resolving'; job.waitReason = null; job.options = options; this.save();
      const gallery = await this.resolveGallery({ ...job, id: job.sourceId }, signal, options);
      signal.throwIfAborted();
      if (!gallery.pages.length) throw new Error('No images found.');
      Object.assign(job, { title: gallery.title, tags: gallery.tags, uploadedAt: gallery.uploadedAt || 0, total: gallery.pages.length, status: 'downloading' });
      const blocked = blockedTags(gallery.tags || [], options.blockedTags);
      if (blocked.length && !job.overrideBlocked) throw Object.assign(new Error(`Blocked tags: ${blocked.join(', ')}.`), { noRetry: true });
      const network = options.skipLarge && options.largeOnWifi ? await this.network(true) : { wifi: false };
      signal.throwIfAborted();
      const limitLarge = options.skipLarge && !(options.largeOnWifi && network.wifi === true);
      if (limitLarge && job.total > options.maxPages) throw Object.assign(new Error(`Skipped large download: ${job.total} pages exceeds ${options.maxPages}.`), { noRetry: true });
      // E-H metadata describes originals; estimate resized downloads from actual bytes.
      if (limitLarge && options.ehOriginal && gallery.sizeBytes > options.maxSizeMB * 1024 ** 2) throw Object.assign(new Error('Skipped large download: original gallery exceeds the size threshold.'), { noRetry: true });
      fs.mkdirSync(job.directory, { recursive: true });
      job.files = job.files.filter(f => f.index < job.total && (f.ignored || (fs.existsSync(path.join(job.directory, f.name)) && fs.statSync(path.join(job.directory, f.name)).size === f.bytes)));
      job.completed = job.files.length; this.save();
      let failure, nextIndex = 0;
      const fail = error => { if (!failure) { failure = error; controller.abort(); } };
      const worker = async () => {
        while (!signal.aborted) {
          const index = nextIndex++;
          if (index >= gallery.pages.length) return;
          if (job.files.some(f => f.index === index)) continue;
          try {
            const file = await this.downloadPage(job, gallery.pages[index], index, options, signal, limitLarge);
            signal.throwIfAborted(); job.files.push(file); job.completed = job.files.length;
            writeJson(path.join(job.directory, 'content.json'), this.manifest(job)); this.save();
          } catch (error) { if (!signal.aborted) fail(error); return; }
        }
      };
      await Promise.all(Array.from({ length: Math.min(options.parallel || 4, gallery.pages.length) }, worker));
      if (failure) throw failure;
      signal.throwIfAborted();
      const firstPage = job.files.find(f => f.index === 0 && !f.ignored);
      if (options.separateThumbnail) {
        if (gallery.thumbnail && (!job.thumbnail || !fs.existsSync(path.join(job.directory, job.thumbnail)))) {
          const file = await this.downloadPage(job, { kind: 'direct', url: gallery.thumbnail, referer: job.url }, -1, options, signal, false);
          if (file.ignored) job.thumbnail = firstPage?.name || null;
          else {
            job.thumbnail = `thumbnail${path.extname(file.name)}`;
            fs.renameSync(path.join(job.directory, file.name), path.join(job.directory, job.thumbnail));
          }
        } else if (!gallery.thumbnail && firstPage) {
          job.thumbnail = `thumbnail${path.extname(firstPage.name)}`;
          fs.copyFileSync(path.join(job.directory, firstPage.name), path.join(job.directory, job.thumbnail));
        }
      } else job.thumbnail = firstPage?.name || null;
      job.status = 'complete'; job.error = null; job.completedAt = new Date().toISOString();
      writeJson(path.join(job.directory, 'content.json'), this.manifest(job)); this.save();
      this.emit('complete', job.directory);
    } catch (error) {
      // All concurrent writers settle before reporting an internal worker failure.
      if (!['paused', 'cancelled', 'queued', 'waiting'].includes(job.status)) {
        job.status = 'error'; job.error = error.message;
        if (fs.existsSync(path.join(job.directory, 'content.json'))) writeJson(path.join(job.directory, 'content.json'), this.manifest(job));
        this.save();
      }
    } finally { this.active = null; if (!wait && job.status !== 'waiting') this.kick(); }
  }
  async downloadPage(job, page, index, options, signal, limitLarge) {
    let retries = 0, fallbackUsed = false, attempt = 0;
    for (;;) {
      let image;
      try {
        image = await this.resolveImage(page, signal, attempt, options);
        const response = await this.fetchImage(image.url, image.referer || job.url, signal);
        const ext = await imageExtension(response, image.url);
        const name = `${String(index + 1).padStart(5, '0')}.${ext}`;
        let pageBytes = 0;
        const bytes = await saveResponse(response, path.join(job.directory, name), signal, this.limiter, count => {
          pageBytes += count;
          if (limitLarge) {
            const saved = job.files.filter(f => !f.ignored && !f.placeholder);
            const estimate = (saved.reduce((sum, f) => sum + f.bytes, 0) + pageBytes) / (saved.length + 1) * job.total;
            if (estimate > options.maxSizeMB * 1024 ** 2) throw Object.assign(new Error('Skipped large download: estimated gallery size exceeds the size threshold.'), { noRetry: true });
          }
        });
        return { index, name, bytes, original: options.ehOriginal && job.site !== 'hitomi' };
      } catch (error) {
        signal.throwIfAborted();
        if (error.noRetry || /limit reached|HTTP (429|509)|Sign in before/i.test(error.message)) throw error;
        if (image?.hasBackup && !fallbackUsed) { fallbackUsed = true; attempt++; continue; }
        if (/HTTP (401|403)/i.test(error.message)) throw error;
        if (error.status === 404 && options.http404 !== 'error') {
          if (options.http404 === 'ignore') return { index, ignored: true, bytes: 0 };
          const name = `${String(index + 1).padStart(5, '0')}.png`, data = placeholderPng(job.site);
          const temporary = path.join(job.directory, `${name}.part`);
          fs.writeFileSync(temporary, data); fs.renameSync(temporary, path.join(job.directory, name));
          return { index, name, bytes: data.length, placeholder: true };
        }
        if (!options.retriesEnabled || retries >= options.retryCount) throw error;
        if (options.retryStorageLimit < 100) {
          const stats = fs.statfsSync(job.directory), used = (1 - stats.bavail / stats.blocks) * 100;
          if (used >= options.retryStorageLimit) throw new Error(`Retries stopped: download drive is ${used.toFixed(1)}% full.`);
        }
        retries++; attempt++;
        job.waitReason = `Retrying page ${index + 1} (${retries}/${options.retryCount}).`; this.save();
        await this.sleep(Math.min(30000, retries * 1000), null, { signal }); job.waitReason = null;
      }
    }
  }
  manifest(job) {
    return { schemaVersion: 1, site: job.site, sourceId: job.sourceId, url: job.url, title: job.title,
      tags: job.tags || [], status: job.status, pages: job.total, thumbnail: job.thumbnail || null,
      createdAt: job.createdAt, completedAt: job.completedAt || null, uploadedAt: job.uploadedAt || 0,
      files: [...job.files].sort((a, b) => a.index - b.index) };
  }
}
module.exports = { DownloadQueue };
