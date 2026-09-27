# First slice: Windows browsing and downloads

## Reference mapping

| Hentoid reference | Windows implementation |
| --- | --- |
| `activities/sources/BaseBrowserActivity.kt`, `activity_browser.xml` | Chromium view, top toolbar, narrow bottom actions, Esc back, double-click quick download |
| `EHentaiActivity.kt`, `ExHentaiActivity.kt` | Persistent browser session; extended gallery display and warning preference cookies |
| `parsers/content/EhentaiContent.kt`, `ExhentaiContent.kt` | Source metadata API with HTML metadata fallback |
| `parsers/images/EHentaiParser.kt`, `ExHentaiParser.kt` | Classic thumbnail pagination, MPV dispatch, fallback image pages, 509 limit detection |
| `parsers/images/HitomiParser.kt`, `assets/hitomi_pages.js` | Gallery JSON plus sandboxed reader JavaScript for WebP URL resolution |

Paths in this table are relative to `Hentoid/app/src/main/java/me/devsaki/hentoid/`
or `Hentoid/app/src/main/res/` / `assets/`, as appropriate.

## Implementation decisions

Electron bundles Chromium and supports the site JavaScript used by the reference
Hitomi adapter. A `WebContentsView` contains the site. The local UI uses a separate
renderer with a restricted preload bridge. Remote pages have no Node integration,
no application API bridge, and denied permission requests. IPC validates the
calling renderer and main frame. Top-level navigation is limited to supported
sources and their login forum; popups outside that set are denied.

See Electron's [WebContentsView documentation](https://www.electronjs.org/docs/latest/api/web-contents-view)
and [security guidance](https://www.electronjs.org/docs/latest/tutorial/security).

The queue processes one book at a time. Source resolution is repeated on resume
because image URLs may expire. Existing page files are checked by their recorded
size and reused. Images stream to disk and are renamed only after completion;
interrupted partial files are removed. Per-gallery IDs avoid Windows filename
restrictions and title collisions. Queue and metadata JSON use temporary writes
and rename. Corrupt state is reported without replacing it with an empty queue.

This queue is an initial download workflow, not the eventual 10,000–100,000-book
library database. Before implementing library management, port Hentoid's data
model and search/sort semantics into an indexed store; do not extend whole-queue
JSON rewriting into the library architecture.

## Validation and remaining work

The automated suite uses fictional fixtures. Live-site checks remain necessary
for authenticated ExHentai, E-H account-specific MPV pages, CDN behavior, and
Hitomi's current reader scripts. Website changes can invalidate selectors and
JavaScript function names independently of this port.

The initial interface follows Hentoid's portrait browser structure and palette;
full layout and feature parity is not yet complete. Remaining browser parity
includes bookmarks, ad filtering, language filters, source preferences, original
resolution/AVIF selection, download ranges, and on-page downloaded/queued badges.
Library management and the reader remain the next major functional areas in the
goal document. No required Windows incompatibility has been identified in this
slice; any such incompatibility should be discussed before replacing its behavior.
