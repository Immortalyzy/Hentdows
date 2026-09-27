const { net } = require('electron');
const { Readable } = require('node:stream');

function responseHeaders(raw) {
  const headers = new Headers();
  for (const [name, values] of Object.entries(raw)) {
    for (const value of Array.isArray(values) ? values : [values]) headers.append(name, value);
  }
  return headers;
}

// Electron fetch cancels manual redirects without exposing their response.
// Keep the Fetch response interface, but use ClientRequest's redirect event so
// the source adapter can validate each destination before making another request.
function createSessionFetch(session) {
  return async (url, { signal, method = 'GET', headers = {}, referrer, body } = {}) => {
    signal?.throwIfAborted();
    const outgoing = new Headers(headers);
    if (referrer) {
      const from = new URL(referrer), to = new URL(url);
      from.hash = ''; from.username = ''; from.password = '';
      // Match Chromium's strict-origin-when-cross-origin policy. A full page
      // URL in a cross-origin Referer header causes ERR_BLOCKED_BY_CLIENT.
      if (!(from.protocol === 'https:' && to.protocol === 'http:')) {
        outgoing.set('Referer', from.origin === to.origin ? from.href : `${from.origin}/`);
      }
    }
    return new Promise((resolve, reject) => {
      const request = net.request({ url, method, session, credentials: 'include', redirect: 'manual',
        referrerPolicy: 'strict-origin-when-cross-origin', headers: Object.fromEntries(outgoing) });
      let stream;
      const cleanup = () => signal?.removeEventListener('abort', abort);
      const fail = error => { cleanup(); reject(error); stream?.destroy(error); };
      const abort = () => { fail(signal.reason); request.abort(); };
      signal?.addEventListener('abort', abort, { once: true });
      request.on('error', fail);
      // ClientRequest can emit close after its upload finishes, while the
      // response is still pending. Keep cancellation until response completion.
      request.on('redirect', (status, _method, location, rawHeaders) => {
        const headers = responseHeaders(rawHeaders);
        headers.set('location', location);
        resolve(new Response(null, { status, headers }));
        cleanup();
        request.abort();
      });
      request.on('response', incoming => {
        stream = incoming;
        incoming.on('error', fail);
        incoming.on('end', cleanup);
        // Canceling the consumer must also stop Chromium's network transfer.
        incoming.on('close', () => { cleanup(); request.abort(); });
        const empty = method === 'HEAD' || [204, 205, 304].includes(incoming.statusCode);
        resolve(new Response(empty ? null : Readable.toWeb(incoming), {
          status: incoming.statusCode, headers: responseHeaders(incoming.headers)
        }));
        if (empty) incoming.resume();
      });
      request.end(body);
    });
  };
}

module.exports = { createSessionFetch };
