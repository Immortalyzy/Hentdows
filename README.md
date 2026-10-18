# Hentdows

A Windows port of the Hentoid snapshot in `Hentoid/`. The first implementation
focuses on browsing and downloading, as requested in
[the repository goal](docs/vibe_steps/00_goal.md).

## Run on Windows

Install Node.js 22.13 or newer, then run from the repository root:

```powershell
npm ci
npm start
```

The first launch downloads the pinned Electron runtime if it is not installed.
Electron supplies Chromium; no separate Chrome installation is needed.

## First feature slice

- Navigate library books with the arrow keys (up/down follows grid rows).
  Enter opens the focused book; Esc returns focus to the original book, even
  across pages, endless scrolling, or changes to reading-based sort order.
  Delete targets the focused book. Enter confirms the deletion dialog; Esc
  cancels it. After deletion, focus moves to the next book (or the previous
  book at the end). Search fields and other controls keep their normal keys.
- Rate library books from 0–5 stars using the card's star button, book details,
  or selection actions. Clear resets a rating to zero.
  In Sort & filter, select a rating and check **At least this many stars (inclusive)**
  to include that rating and higher ratings. Unchecked matches the exact rating;
  Any rating ignores the threshold. This option is also saved in dynamic groups.
- Right-click a library book for the selection actions, with Delete first.
  Right-clicking inside a selection acts on all selected books; outside it selects
  only the clicked book. Delete asks once, then uses the Recycle Bin when possible
  or permanently deletes the book folder if recycling fails (such as on USB/network drives).

- Persistent bookmarks with search, source filters, editing, ordering, custom
  homepages, and JSON import/export. Use the bottom star or Ctrl+B.
- Browser preferences include per-source resume, reopen last page, quick download,
  picture saving, page markers, Hitomi language filtering, light mode, DNS/proxy,
  and confirmed cookie/cache clearing. See [browser/storage notes](docs/vibe_steps/01_browersing/04_browser_storage.md).
  Quick download leaves gallery-page controls such as tag voting and Show Tagged
  Galleries to the site's own click handlers.
- Multiple storage locations with a default for new downloads, offline status,
  free space, and path reconnection that preserves reading metadata. Manage them
  from Sources, Settings or the Library menu. Existing jobs keep their destination.

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

## Download queue and duplicate checks

A trusted double-click shows **Checking gallery…**, followed by an animated green
confirmation only when the gallery has been queued. Existing books and failures
have distinct messages. Queue and Errors tabs replace the completed-job history.
Completed downloads appear in the library; failed downloads remain retryable.

Queue controls include title/tag/ID search, source filtering, double-click or Space
selection, drag ordering, move top/bottom, reverse, freeze/unfreeze, bulk retry,
restart from scratch, removal, URL-list import, error details/statistics and a
transfer limit. The bottom bar shows queue progress and recent transfer speed.
Frozen jobs stay frozen when the queue starts. Retry retains completed pages;
restart from scratch asks before replacing them. Removing an entry keeps partial
files. The transfer limit is session-only and applies to all Windows connections.

Automatic duplicate checks recognize identical gallery IDs across E-hentai and
ExHentai. Likely duplicates use Hentoid-style title similarity, artist/language
checks, cover hashes and sensitivity settings under **Downloader → Duplicate
detection**. The prompt offers Cancel, Download anyway, or Show existing book.
It never automatically replaces or deletes the existing copy. Cover hashes are
cached, and candidate metadata is queried in batches for large libraries.

See [queue implementation notes](docs/vibe_steps/02_download/03_queue_amendments.md)
for reference mapping and remaining download-mode differences.

## Library

The app opens in the library. Completed Hentdows downloads are indexed automatically;
registered download folders are discovered on startup. Use **••• → Add library location**
for another download folder, or **Import Hentoid folder** to select a copied `.Hentoid`
folder containing book images and JSON metadata. All registered locations appear
together; the **Storage** selector can narrow the list to one location. Adding a
location leaves the default destination for new downloads unchanged.
Use **Refresh library** to find filesystem changes.
The index reads manifests and checks small headers for extensionless images. Missing drives/books retain
their metadata and reading state. Incomplete downloads stay in the queue.

- List, adaptive-width grid, and two-, three- or four-column grids. Settings offer
  endless scrolling (bounded rendered rows) or 20–100 books per page with lazy covers.
- Case-insensitive title/attribute substring search and exact gallery IDs. Comma-
  separated terms match attributes with AND. **Filters** includes exact metadata
  inclusion/exclusion, AND/OR, absent attribute types, favourites, completion,
  exact ratings, favourite pages and missing files.
- All 13 book sort fields from Hentoid, including read progress, average page size,
  stable random order with Shuffle, and custom order in eligible groups.
- Group by artist, series, download date or folder; create custom groups or save
  current search filters as a dynamic group. Groups and books are paged.
- Single-click a book to read. Use its small **⋯** button for details and actions. Double-click to select, then edit
  metadata, rate, mark completed, change groups, reorder, remove from the index,
  or delete the book folder. Deletion uses the Recycle Bin when possible and falls
  back to permanent deletion if recycling fails. Removal/deletion asks for confirmation.
- **View source** revisits a book's saved web page from reader **⋯**, book details,
  the right-click menu or single-book selection actions. Supported sources open
  inside Hentdows with the saved browser session; other saved HTTP(S) addresses
  open in your default browser. Books without a usable address disable the action.
- A full-window reader records viewed pages, reading sessions and favourite pages.
  Mouse wheel and arrow keys turn pages; Esc closes the reader, selection or group.
- **Back up metadata / Restore metadata backup** preserves the SQLite index,
  edits, groups and reading history. Images remain in their download folders.
  Back up those folders separately. Restore uses the paths recorded in the backup.

Library metadata lives in `library.sqlite` in the app's data directory. Queries and
indexing run in a worker, with indexed sorting and trigram substring search.
Completed downloads disappear from the queue immediately and their queue records
are removed after successful library indexing. The library retains their metadata
and checks for duplicates when enqueueing.

Hentoid imports support `contentv2.json`, legacy `content.json`, and `data.json`
beside local image files. Titles, attributes, stars, favourites, custom groups and
reading state are imported into Hentdows; repeat imports preserve local edits.
Images stay in place and import does not rewrite Hentoid files.
See [Hentoid import notes](docs/hentoid-import.md) for details and limitations.
Raw Android ObjectBox databases, CBZ/PDF libraries, archive conversion, book
merge/split, LANraragi integration, download ranges and advanced book-file editing
are not implemented. Metadata backups use Hentdows' own format.

## Library and viewer settings

Use the gear button and select **Library** or **Viewer**. Library preferences control
paging/endless scrolling, grid fields and card width, group counts/sizes, search
delays, metadata order/counts, and the Go to Top button.

Viewer preferences cover LTR/RTL/vertical reading, wheel/drag/border controls,
keyboard shortcuts, double-click/hold zoom, screen wake, animations, page numbers,
auto-rotation, color overlay, solid-border cropping, fit/fill/stretch, two-page
spreads, vertical separators, gallery columns, resume/gallery startup, continuous
reading, read/completion thresholds, deletion direction, and slideshow speed/loop.
The narrow bottom bar provides page/book navigation, gallery, slideshow, and more
actions. In vertical mode the wheel scrolls naturally; in paged mode one wheel
step turns a page. Zoomed pages scroll/pan before returning to normal page turns.
Paged reading keeps the previous image visible until the next page has loaded
and decoded. Two-page spreads change together. Failed page loads retain the
previous image and offer Retry; rapid navigation cannot display a stale page.
Normal loading is silent. Page animation is clipped to the spread, preventing
temporary bottom scrollbars from resizing the image during a page turn or upscale.
Zoomed pages and vertical reading remain scrollable.

Anime4K upscaling is enabled at **2×** by default. The original appears first,
then the enhanced page replaces it. The GPU model stays loaded while the app is
open, including between books. The next **three pages** are decoded and upscaled
ahead of time. Viewer → Rendering offers Off / 2× / 4× and 0 / 2 / 3-page preload.
4× runs the small Anime4K network twice. Pages with a longest side of 2048 pixels
or more, or outputs above 40 megapixels, remain original. A missing or lost GPU
also leaves originals available.

Animated WebP pages play natively, including imported files without an extension.
They preload normally but automatically bypass 2×/4× upscaling, smart crop and
auto-rotation: those canvas operations would freeze playback into a still frame.
Fit, zoom and color filters remain available. Still WebP pages keep all existing
enhancements, and the GPU model stays ready for the next still page.

The session cache allows 64 MiB for decoded originals and 512 MiB for enhanced
pages; distant lookahead is reduced when necessary, especially at 4×. Current
display canvases and GPU working textures use additional memory. Page caches
clear when the reader closes, while compiled shaders remain resident. No
upscaled files are saved to the library. See the
[Anime4K implementation and measurements](docs/performance/anime4k-reader-2026-10-02.md).

Windows uses the agreed configurable keyboard equivalents for Android volume
buttons, the full window area, and Chromium's native renderer/color depth.
Hentdows downloads contain one chapter per book. Chapter navigation therefore has
no adjacent chapters; chapter slideshow looping repeats that book. See the
[preference mapping](docs/vibe_steps/03_library/01_reader_settings.md).

## Verify and package

```powershell
npm test
npm run smoke
npm run smoke:network
npm run smoke:queue
npm run smoke:browser
npm run smoke:browser-tags
npm run smoke:library
npm run smoke:library-keyboard
npm run smoke:delete-books
npm run smoke:import
npm run smoke:reader
npm run smoke:reader-transitions
npm run smoke:book-source
npm run smoke:upscale # Requires a hardware GPU; generated fixtures only
npm run smoke:animated-webp # Verifies native playback and automatic upscaling bypass
npm run benchmark:library
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
The library smoke test uses fictional books and verifies paging, search, edits,
groups, image boundaries, reading state and narrow layouts. The benchmark creates
100,000 synthetic metadata records under `artifacts/` and reports timings; it
does not scan or validate an actual 200–400 GiB image collection.

Packaging produces `dist/1.0.0/Hentdows-win32-x64/Hentdows.exe`; distribute the whole
folder or a ZIP of it. It is an unsigned portable build, not an installer.
The build requires committed source and stages only committed `src/`, package
metadata, LICENSE and NOTICE, then installs fresh production dependencies with
install scripts disabled. Local profiles, books, exports, development documents
and untracked files are not copied. Build provenance is saved in `build-info.json`.
Build releases from a separate clean worktree with a fresh `npm ci` installation.

The application still uses the current Windows user's saved profile when launched.
Close a running older copy before launching an update. Development validation must
use synthetic fixtures and isolated profiles as described in AGENTS.md.

See [browser implementation notes](docs/vibe_steps/01_browersing/01_browsing_downloads.md)
and [download settings notes](docs/vibe_steps/02_download/02_config_implementation.md)
for the reference mapping and validation details.

## License

Apache-2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE). The Android reference
source retains its own notices.
