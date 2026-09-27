class HttpError extends Error {
  constructor(status, url, retryAfter) {
    const host = new URL(url).host;
    super(`HTTP ${status} from ${host}.${status === 403 ? ' Check login or the site challenge in the browser.' : ''}`);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
function retryAfterSeconds(value, now = Date.now()) {
  if (!value) return 0;
  if (/^\d+$/.test(value.trim())) return Number(value);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - now) / 1000)) : 0;
}
module.exports = { HttpError, retryAfterSeconds };
