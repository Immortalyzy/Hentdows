# Browser and storage amendments — 0.6.0

## Bookmarks and resume

The star in the bottom browser toolbar opens Bookmarks. Bookmark the current page,
search/filter by source, edit title/address, remove, reorder, or set a bookmark as
that source's homepage. Lists render 60 entries per page. Import/export uses a
Hentdows JSON file, deduplicates URLs, validates the whole import before applying
it, and supports up to 5000 bookmarks. Unsupported schemes, hosts, credentials
and ports are rejected. Login forum URLs are not saved in browsing history.

The last page and scroll position are saved separately for each source. Browser
settings → Resume at last viewed page makes the source chooser return there.
When disabled, the source opens its custom homepage or the source homepage.
Reopen last page in Bookmarks restores the most recently closed page (or the last
viewed page if none was explicitly closed), including after restarting the app.
The app continues to start in Library. Closing a browser page keeps the saved
resume position and bookmarks. Ctrl+B toggles Bookmarks; Esc closes an edit dialog
first, then returns from the panel. All state lives in the existing user profile.

## Browser preferences

Reference: `res/xml/preferences.xml` browser section, `strings_settings.xml`,
`donottranslate.xml`, `BookmarksDrawerFragment`, `BaseBrowserActivity`, and
`HitomiActivity` from the checked-in Hentoid source.

| Setting | Windows behavior |
| --- | --- |
| Resume at last viewed page | Per-source URL and scroll position, off by reference default |
| Quick download | Enable/disable trusted double-click gallery downloads; enabled by default to preserve Hentdows behavior |
| Grab picture | Trusted double-click on an image outside a gallery link opens Save As; streams a validated image with a 128 MiB limit |
| Long-tap threshold | Replaced by Windows double-click detection; no Android hold timer |
| Language button/value | Hitomi's supported first-page/all-language listings gain a language button |
| Lock favourites panel | Disables Ctrl+B while retaining the explicit toolbar button |
| Augmented browser | Removes known ad spaces and uses Hitomi's explicit script blacklist; direct gallery metadata parsing remains the downloader's implementation |
| Mark downloaded/queued/blocked | Bounded page-link lookups against the indexed library, queue and visible/saved tags; EH/ExH share identities |
| Force light mode | Chromium light color-scheme preference for source pages; local application UI remains dark |
| Duplicate detection | Existing six functional duplicate settings also appear under Browser, sharing their stored values with Downloader |
| DNS over HTTPS | System resolver, Cloudflare, Quad9, or AdGuard through Chromium's resolver |
| Proxy | System default or explicit HTTP/HTTPS/SOCKS5 endpoint; browsing and downloader share the configured session |
| Clear cookies/cache | Separate confirmed actions; clearing cache preserves cookies, clearing cookies signs out of all sources |

Remote pages receive no application API. Mouse gestures require trusted events.
IPC checks sender, main frame, URL and bounded payloads. Marking queries at most
300 unique links per pass and does not load the entire library. Blocked marking
can only use tags available on the page or already indexed; it does not fetch all
gallery metadata in the background. Picture output uses a unique temporary file,
supported image MIME checks, and the existing guarded source transport.

The explicit Hitomi script blacklist applies only to scripts in the visible
browser, never image transfers or hidden downloader readers. Browser preferences
save automatically. New connections use updated proxy/DNS settings; a running
transfer is not intentionally cancelled to apply them. Authenticated proxy URLs
are rejected rather than storing passwords in plain text.

Per the user's scope decision, streaming, archive downloads, range downloads and
extending existing books remain deferred. Mark-merged and nhentai-only controls
are absent because this build has no merged-book model or nhentai adapter. The
existing supported-source image/download preferences stay under Downloader.

## Multiple storage locations

Open Storage locations from Sources, Settings, or the Library menu. Add existing
Hentdows download roots, scan all registered locations, select the destination for
new downloads, open folders, remove a location's index, or reconnect an existing
location at its new path. Existing queue entries retain their destination.
The manager displays book count, indexed size, free space, default destination
and online/offline state. Locations are canonicalized and overlapping roots are
rejected/reused to avoid double indexing.

An unavailable drive remains registered with its book metadata intact. Reconnect
updates indexed paths transactionally and preserves book IDs, ratings, groups,
reading progress and removal records. It does not move files. Select the same
folder on the replacement drive. Active queue destinations cannot be reconnected
or removed until their jobs are finished or removed. Metadata-changing storage
operations are blocked during a library refresh.

Removing a location requires confirmation, keeps image files, and removes its
indexed book metadata. The default download location cannot be removed until
another default is selected. Existing metadata backup/restore includes the roots.
Imports currently recognize Hentdows `content.json` manifests. This prepares for
attaching old libraries; Android Hentoid manifests and arbitrary CBZ/folders still
need separate format importers.

## Validation

50 unit tests cover existing functionality plus bookmark persistence, import
validation, home/resume precedence, browser preference validation, language URLs,
storage path relocation, metadata preservation and index removal.

`npm run smoke:browser` uses fictional pages, isolated profiles and temporary
folders. It exercises restored pages/scroll, bookmark UI/edit/Esc/import/export,
closing/reopening, custom homepages, markers, ad-space toggling, quick download,
picture save, normal click behavior, language filtering, light mode, proxy
application, multiple roots, offline scans, default changes, existing/new queue
destinations, reconnection, preserved ratings, index-only removal, cookie/cache
confirmation, and 390px layouts. Screenshots live under `artifacts/browser-smoke-*`.
Set `HENTDOWS_TEST_ASAR` to repeat this against the packaged application.

The existing source browser, queue, library, reader and network smoke tests remain
regression checks. Fixtures do not establish live-site or account-specific access.
