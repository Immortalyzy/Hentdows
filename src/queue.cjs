const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { randomUUID } = require('node:crypto');
const { galleryFromUrl } = require('./sites.cjs');
const { readJson, writeJson } = require('./storage.cjs');

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif' };

class DownloadQueue extends EventEmitter {
  constructor({ file, resolveGallery, resolveImage, fetchImage }) {
    super();
    Object.assign(this, { file, resolveGallery, resolveImage, fetchImage });
    this.jobs = readJson(file, []);
    if (!Array.isArray(this.jobs)) throw new Error('Invalid queue file. Your data has been preserved.');
    // Restart is explicit: never resume traffic before the user has checked their session.
    for (const job of this.jobs) if (['queued', 'resolving', 'downloading'].includes(job.status)) job.status = 'paused';
    this.active = null;
  }

  snapshot() { return structuredClone(this.jobs); }
  save() { writeJson(this.file, this.jobs); this.emit('change', this.snapshot()); }
  enqueue(url, root) {
    const gallery = galleryFromUrl(url);
    if (!gallery) throw new Error('Open a supported gallery before downloading.');
    const existing = this.jobs.find(j => j.key === gallery.key && j.status !== 'cancelled');
    if (existing) return existing.id;
    if (!path.isAbsolute(root)) throw new Error('Choose an absolute download folder.');
    const job = { ...gallery, id: randomUUID(), sourceId: gallery.id, title: `${gallery.site} ${gallery.id}`,
      directory: path.join(root, gallery.site, gallery.id), status: 'queued', completed: 0, total: 0,
      files: [], createdAt: new Date().toISOString(), error: null };
    this.jobs.push(job);
    this.save();
    void this.pump();
    return job.id;
  }

  action(id, action) {
    const job = this.jobs.find(j => j.id === id);
    if (!job) throw new Error('Download not found.');
    if (action === 'pause' && ['queued', 'resolving', 'downloading'].includes(job.status)) job.status = 'paused';
    else if (action === 'cancel' && job.status !== 'complete') job.status = 'cancelled';
    else if (action === 'resume' && ['paused', 'error', 'cancelled'].includes(job.status)) {
      if (this.jobs.some(other => other.id !== id && other.key === job.key && other.status !== 'cancelled')) {
        throw new Error('This gallery already has another download.');
      }
      job.status = 'queued'; job.error = null;
    } else return;
    if (this.active?.id === id) this.active.controller.abort();
    this.save();
    void this.pump();
  }

  pauseAll() {
    for (const job of this.jobs) if (['queued', 'resolving', 'downloading'].includes(job.status)) job.status = 'paused';
    this.active?.controller.abort();
    this.save();
  }

  async pump() {
    if (this.active) return;
    const job = this.jobs.find(j => j.status === 'queued');
    if (!job) return;
    const controller = new AbortController(), signal = controller.signal;
    this.active = { id: job.id, controller };
    try {
      job.status = 'resolving'; this.save();
      const gallery = await this.resolveGallery({ ...job, id: job.sourceId }, signal);
      signal.throwIfAborted();
      if (!gallery.pages.length) throw new Error('No images found.');
      Object.assign(job, { title: gallery.title, tags: gallery.tags, total: gallery.pages.length, status: 'downloading' });
      fs.mkdirSync(job.directory, { recursive: true });
      // Reconcile saved files: missing files are re-downloaded on retry.
      job.files = job.files.filter(f => f.index < job.total && fs.existsSync(path.join(job.directory, f.name))
        && fs.statSync(path.join(job.directory, f.name)).size === f.bytes);
      job.completed = job.files.length;
      this.save();
      for (let i = 0; i < gallery.pages.length; i++) {
        signal.throwIfAborted();
        if (job.files.some(f => f.index === i)) continue;
        let lastError;
        for (let attempt = 0; attempt < 3; attempt++) {
          signal.throwIfAborted();
          try {
            const image = await this.resolveImage(gallery.pages[i], signal, attempt);
            const response = await this.fetchImage(image.url, image.referer || job.url, signal);
            if (!response.ok) throw new Error(`Image server returned HTTP ${response.status}.`);
            const ext = EXTENSIONS[(response.headers.get('content-type') || '').split(';')[0].trim()];
            if (!ext) { await response.body?.cancel(); throw new Error('The server returned a login/challenge page or unsupported image type.'); }
            const name = `${String(i + 1).padStart(5, '0')}.${ext}`;
            const target = path.join(job.directory, name), partial = `${target}.part`;
            try {
              await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(partial), { signal });
              signal.throwIfAborted();
              const bytes = fs.statSync(partial).size;
              if (!bytes) throw new Error('The server returned an empty image.');
              fs.renameSync(partial, target);
              job.files.push({ index: i, name, bytes }); job.completed = job.files.length;
              writeJson(path.join(job.directory, 'content.json'), this.manifest(job));
              this.save(); lastError = null; break;
            } finally { if (fs.existsSync(partial)) fs.unlinkSync(partial); }
          } catch (error) {
            lastError = error;
            if (signal.aborted || /limit reached|HTTP (401|403|429|509)/i.test(error.message)) throw error;
            if (attempt < 2) await require('node:timers/promises').setTimeout(1000 * (attempt + 1), null, { signal });
          }
        }
        if (lastError) throw lastError;
      }
      job.status = 'complete'; job.error = null;
      writeJson(path.join(job.directory, 'content.json'), this.manifest(job));
      this.save();
    } catch (error) {
      if (!signal.aborted) { job.status = 'error'; job.error = error.message; this.save(); }
    } finally { this.active = null; void this.pump(); }
  }

  manifest(job) {
    return { schemaVersion: 1, site: job.site, sourceId: job.sourceId, url: job.url, title: job.title,
      tags: job.tags || [], status: job.status, pages: job.total, files: [...job.files].sort((a, b) => a.index - b.index) };
  }
}

module.exports = { DownloadQueue };
