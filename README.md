# Hentdows

A Windows port of the Hentoid snapshot in `Hentoid/`. The first implementation
focuses on browsing and downloading, as requested in
[the repository goal](docs/vibe_steps/00_goal.md).

## Run on Windows

Install Node.js 22.12 or newer, then run from the repository root:

```powershell
npm ci
npm start
```

The first launch downloads the pinned Electron runtime if it is not installed.
Electron supplies Chromium; no separate Chrome installation is needed.

## First feature slice

- Portrait browser window, source chooser, address bar, history and reload.
- E-hentai and ExHentai: classic gallery pagination, multipage viewer parsing,
  metadata, displayed-image downloads, failed-image fallback, and download-limit
  reporting.
- Hitomi: gallery metadata and WebP/optional AVIF URLs resolved by the site's reader JavaScript,
  following the reference app's approach.
- Persistent browser session shared with downloads. Use **Sign in** for the
  E-hentai forum login, then browse the desired source. ExHentai still requires
  an account with access; the app does not grant that access.
- Double-click a gallery link or linked thumbnail to enqueue it without leaving
  the results. Single clicks on gallery links wait 550 ms to distinguish them
  from double clicks. The bottom download button saves the current gallery.
- **Esc** goes back in browser history, closes the queue/source panel, or returns
  to sources when no history remains.
- Sequential queue with duplicate detection, pause, resume, retry, and cancel.
  Restart leaves unfinished downloads paused. Cancel keeps already saved pages.
  Image transfers within a gallery use the configured parallelism.
- Streamed images, `.part` files, deterministic page names, and a `content.json`
  manifest for each gallery. Choose a destination from the source screen; changes
  apply to newly queued galleries.

## Download settings

Open the gear button in the top toolbar, then use the **Downloader** preferences.
Settings save automatically. **Download hi-res pictures is off by default**:
E-hentai/ExHentai use displayed images, without requesting the original-image link.
Displayed images still use the site's normal image-view quota. Enabling hi-res
requires login and can consume that quota substantially faster.

The Hentoid downloader categories cover auto-start, daily schedules, queue position,
Wi-Fi-only downloads, large-download thresholds, tag blocking, automatic retries,
storage usage thresholds, E-hentai originals, Hitomi AVIF, parallel transfers,
aggregate speed limits, HTTP 429 delay, thumbnails, and HTTP 404 handling.
Use **Start queue** when auto-start is off. The default image format is displayed
E-hentai images / Hitomi WebP; AVIF falls back to WebP when a file has no AVIF.

Schedules run while the app is open, including overnight windows. Unfinished jobs
remain paused after a restart. Wi-Fi detection checks the preferred Windows default
route; an unknown or VPN adapter does not count as confirmed Wi-Fi. Policy changes
are checked every 15 seconds. Quality, parallelism and retry changes apply to the
next book or retry; already downloaded pages are retained. Speed limits apply live.

The E-hentai `unsupported image address` failure was caused by rejecting nonstandard
ports on H@H image servers. These ports are now accepted specifically for
`.hath.network` hosts. Existing failed jobs can be retried from the queue.
The follow-up `net::ERR_BLOCKED_BY_CLIENT` failure is fixed in 0.2.1: download
referrers now match Chromium's policy, and redirects are validated through
Electron's request API before following them.

Downloads default to `Downloads/Hentdows/<source>/<gallery-id>/`. Application
settings, queue state, and Chromium cookies live in Electron's per-user
`Hentdows` data directory (the development app name may appear as `hentdows`).
Cookies are managed by Chromium and are not copied into gallery manifests.

This is the first working slice, not complete Hentoid parity. Library indexing,
search, sorting, reader and library view options are later milestones. Browser
bookmarks, source-specific filters, download ranges,
comprehensive ad blocking and Hentoid-compatible import/export are
also not implemented yet. The current manifest is a versioned Hentdows format;
it does not claim compatibility with Hentoid's database or backup format.

## Verify and package

```powershell
npm test
npm run smoke
npm run smoke:network
npm run package
```

Unit tests cover parser behavior, URL validation, streaming, duplicate detection,
pause/resume, errors and restart recovery. The Electron smoke test intercepts all
source HTTPS requests with fictional local fixtures and exercises actual browser
gestures, all three adapters, renderer isolation, file output and queue rendering.
It writes screenshots and a result file under `artifacts/smoke-<timestamp>/`.
These tests do not establish that live sites or account-specific access work.
The network smoke test uses a local HTTP server through Chromium's real network
stack to verify referrers, cookies, redirects, streaming and cancellation.

Packaging produces `dist/Hentdows-win32-x64/Hentdows.exe`; distribute the whole
directory. It is an unsigned portable build, not an installer.
Close a running older copy before launching an updated build; both use the same
saved profile. The latest download-fix build is also available locally under
`dist/0.2.1/Hentdows-win32-x64/` so it can be built while the older copy is running.

See [browser implementation notes](docs/vibe_steps/01_browersing/01_browsing_downloads.md)
and [download settings notes](docs/vibe_steps/02_download/02_config_implementation.md)
for the reference mapping and validation details.

## License

Apache-2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE). The Android reference
source retains its own notices.
