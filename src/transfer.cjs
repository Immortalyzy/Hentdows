const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { HttpError } = require('./http.cjs');
const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif', 'image/bmp': 'bmp' };
class SpeedLimiter {
  constructor(getLimit, sleep = delay, now = () => performance.now()) { this.getLimit = getLimit; this.sleep = sleep; this.now = now; this.availableAt = 0; }
  async consume(bytes, signal) {
    const rate = this.getLimit() * 1024;
    if (!rate) { this.availableAt = 0; return; }
    const now = this.now();
    this.availableAt = Math.max(now, this.availableAt) + bytes / rate * 1000;
    await this.sleep(Math.max(0, this.availableAt - now), null, { signal });
  }
}
async function saveResponse(response, filename, signal, limiter, onChunk = () => {}) {
  const partial = `${filename}.part`;
  async function* limited(source) {
    for await (const data of source) {
      for (let offset = 0; offset < data.length; offset += 16384) {
        const chunk = data.subarray(offset, offset + 16384);
        signal.throwIfAborted(); await limiter.consume(chunk.length, signal); onChunk(chunk.length); yield chunk;
      }
    }
  }
  try {
    await pipeline(Readable.fromWeb(response.body), limited, fs.createWriteStream(partial), { signal });
    signal.throwIfAborted();
    const bytes = fs.statSync(partial).size;
    if (!bytes) throw new Error('The server returned an empty image.');
    fs.renameSync(partial, filename); return bytes;
  } finally { if (fs.existsSync(partial)) fs.unlinkSync(partial); }
}
async function imageExtension(response, url) {
  if (!response.ok) { await response.body?.cancel(); throw new HttpError(response.status, url, response.headers.get('retry-after')); }
  const ext = EXTENSIONS[(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()];
  if (!ext) { await response.body?.cancel(); throw new Error('The server returned a login/challenge page or unsupported image type.'); }
  return ext;
}
function placeholderPng(site) {
  if (!['ehentai', 'exhentai', 'hitomi'].includes(site)) throw new Error('Unknown placeholder source.');
  return fs.readFileSync(path.join(__dirname, 'assets', `missing-${site}.png`));
}
module.exports = { SpeedLimiter, saveResponse, imageExtension, placeholderPng };
