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
- Hitomi: gallery metadata and WebP URLs resolved by the site's reader JavaScript,
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
- Streamed images, `.part` files, deterministic page names, and a `content.json`
  manifest for each gallery. Choose a destination from the source screen; changes
  apply to newly queued galleries.

Downloads default to `Downloads/Hentdows/<source>/<gallery-id>/`. Application
settings, queue state, and Chromium cookies live in Electron's per-user
`Hentdows` data directory (the development app name may appear as `hentdows`).
Cookies are managed by Chromium and are not copied into gallery manifests.

This is the first working slice, not complete Hentoid parity. Library indexing,
search, sorting, reader and library view options are later milestones. Browser
bookmarks, source-specific filters, download ranges, original-resolution/AVIF
preferences, comprehensive ad blocking and Hentoid-compatible import/export are
also not implemented yet. The current manifest is a versioned Hentdows format;
it does not claim compatibility with Hentoid's database or backup format.

## Verify and package

```powershell
npm test
npm run smoke
npm run package
```

Unit tests cover parser behavior, URL validation, streaming, duplicate detection,
pause/resume, errors and restart recovery. The Electron smoke test intercepts all
source HTTPS requests with fictional local fixtures and exercises actual browser
gestures, all three adapters, renderer isolation, file output and queue rendering.
It writes screenshots and a result file under `artifacts/smoke-<timestamp>/`.
These tests do not establish that live sites or account-specific access work.

Packaging produces `dist/Hentdows-win32-x64/Hentdows.exe`; distribute the whole
directory. It is an unsigned portable build, not an installer.

See [implementation notes](docs/vibe_steps/01_browsing_downloads.md) for the
reference mapping and remaining validation.

## License

Apache-2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE). The Android reference
source retains its own notices.
