# Downloader configuration implementation

Implemented from `01_config.md` after checkpoint commit `94de80f`.

## Reference and scope

The UI follows the Downloader preference screen in Hentoid's
`app/src/main/res/xml/preferences.xml`, using its categories, labels, choice lists,
and defaults. It includes every shared downloader preference and the options for
E-hentai/ExHentai and Hitomi. Kemono, Pawchive and Pixiv controls are deferred until
those sources have download adapters; no inert switches are presented for them.

| Preference | Runtime behavior |
| --- | --- |
| Auto-start / queue position | Start on enqueue, or wait for Start queue; insert top/bottom or ask each time |
| Schedule downloads | Daily local-time window, including overnight; equal start/end means all day |
| Only download on Wi-Fi | Query the active Windows default-route adapter; wait when Wi-Fi is not confirmed |
| Skip large downloads | Gate by page count; estimate resized size from transferred bytes; use known original size in hi-res mode |
| Allow Large Downloads on Wi-Fi | Exempt confirmed Wi-Fi from the size/page gates |
| Blocked tags / blocking behaviour | Inspect metadata before enqueue; reject, queue as error, or accept on a second explicit request |
| Retries activated / retry count | Retry failed pages a bounded number of times; retain successful pages |
| Mem usage threshold | Check download-drive storage utilization before automated retries, as the reference's storage checks imply |
| E-hentai hi-res | Off by default; only choose classic fullimg / MPV original links when on, with a logged-in session |
| Hitomi AVIF | Request AVIF only when the gallery file says it is available; otherwise WebP |
| Parallel downloads | Bounded worker pool (Auto: four), one gallery at a time |
| Speed limit | One shared transfer budget across the workers |
| HTTP 429 delay | One delayed request retry, using the larger of the setting and Retry-After; waits over a day require a later manual retry |
| Thumbnails | Separate thumbnail file, or reference page one |
| HTTP 404 management | Error, source-icon PNG placeholder, or recorded omitted page |

The existing Windows-specific keyboard conventions remain: Esc leaves settings
and returns to the panel from which they were opened. Preferences save immediately.
Existing profile files migrate by applying defaults for missing download settings;
they are not replaced or cleared. Failed downloads remain available for Retry.

## E-hentai failure

The user's saved failed jobs reported `The source returned an unsupported image
address.` The original validator rejected all explicit ports. A read-only live
check of a previously failed gallery and one of its image-page HTML documents
confirmed a displayed-image URL under `.hath.network` on port `8443`. No original
link was requested and no image body was downloaded during this diagnostic.

H@H hosts can use nonstandard ports; see the site's
[Hentai@Home documentation](https://ehwiki.org/wiki/H%40H). The validator now allows
these ports specifically for H@H subdomains, and regression tests reject lookalike
domains and local addresses. Classic-page fallback resolution also reuses the
already parsed fallback token instead of requesting the same image page twice.

### Follow-up transport failure (0.2.1)

The subsequent `net::ERR_BLOCKED_BY_CLIENT` error was reproduced against a
displayed-image URL. A full cross-origin `Referer` header conflicted with
Chromium's default `strict-origin-when-cross-origin` policy. The transport now
sends the page URL only for same-origin requests, the origin for cross-origin
requests, and no referrer on HTTPS-to-HTTP downgrades.

The investigation also reproduced Electron `session.fetch` canceling a manual
redirect instead of returning its response. `session-fetch.cjs` now uses
[ClientRequest](https://www.electronjs.org/docs/latest/api/client-request)'s
redirect event to expose the redirect to the existing destination-validation
loop. Session cookies, streaming/backpressure, aborts and timeouts are retained.
Cancellation stays active until the response finishes, including while waiting
for response headers. Redirects to local addresses/files and API POST redirects
remain rejected.

A live check through the repaired source adapter transferred one complete
displayed WebP image from a previously failed gallery (HTTP 200, 64,588 bytes,
matching Content-Length). It made zero original-image requests. A full live
gallery and authenticated ExHentai transfers have not been verified.

## Windows policy details

Wi-Fi mode reads NetAdapter / NetIPInterface / NetRoute information through a
hidden, read-only PowerShell process, cached for 15 seconds. Wireless physical
medium values follow Microsoft's
[MSFT_NetAdapter documentation](https://learn.microsoft.com/en-us/windows/win32/fwp/wmi/netadaptercimprov/msft-netadapter).
If route identification fails, or the preferred route is a VPN/unknown adapter,
Wi-Fi is not assumed. This is intentionally narrower than merely detecting an
enabled wireless card alongside Ethernet.

Schedules run while Hentdows is open. Closing the application pauses unfinished
jobs; starting it does not resume traffic until the queue is started. Network and
schedule changes are checked every 15 seconds, abort active transfers, remove
partial files, and leave the job waiting for the condition to clear.

Quality, parallelism and retry options are sampled when a gallery starts or is
retried. Already completed pages are retained even if quality changes. The speed
limit is live. Hentoid's Android memory-class auto-thread heuristic is expressed as
its four-thread upper bound on desktop. The retry storage threshold uses disk
usage rather than JavaScript heap usage; Hentoid's similarly named setting reads
filesystem space, despite its UI label.

## Validation

Unit tests cover settings validation/migration, schedule windows, queue ordering,
network gating, tag policies, size thresholds, concurrency, cancellation cleanup,
retry behavior, 404 modes, thumbnails, aggregate throttling, H@H ports, original
image selection, AVIF fallback and HTTP 429 delays.

The offline Electron integration test drives the settings UI, verifies persistence,
checks that default transfers never request originals, opts into originals with
a fixture login, and captures the settings screens. It also covers the actual
browser gesture, queue, and Chromium request path. `scripts/network-smoke.cjs`
additionally uses a local HTTP server with Chromium's actual network stack,
without protocol interception, to verify referrers, session cookies, redirect
validation/limits, streaming, cancellation before/during responses, timeouts and
cleanup after truncated responses. Live inspection confirms the reported
address-validation and referrer bugs; full authenticated transfers and every
real network policy combination have not been exercised against live sites.
