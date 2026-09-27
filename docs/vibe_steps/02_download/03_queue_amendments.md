# Download amendments — 0.5.0

The requested filename `03_function_amend_download.md` was not present. The matching
requirements are in `../03_function_amend.md`: quick-download acknowledgement,
Hentoid-style queue, and automatic duplicate checks plus download improvements.

## Reference and implemented behavior

Reference files in the checked-in Android source:

- `QueueActivity`, `QueueFragment`, `ErrorsFragment`, `QueueViewModel`;
  `item_queue.xml`, `include_queue_bottom_bar.xml`, the three queue menu resources.
- `DuplicateHelper.kt`, `ContentHelper.findDuplicate`, `DuplicateEntry`, `Cosine`,
  `ImagePHash`, and the browser duplicate preferences/defaults.
- `LimitDownloadDialogFragment` and `DownloadDataLimiter`.

Quick downloads display a pending indicator, then a short green confirmation after
the main process accepts the gallery. The local queue icon also pulses. Repeated
requests, existing library books, rejected tags, cancellation and failures receive
different feedback. Only trusted mouse gestures can send the remote-page IPC;
webpages receive no Node API or application bridge.

Queue and Errors are separate searchable, source-filtered tabs, with bounded
60-row rendering. Rows show thumbnail/source fallback, title, artist, page progress,
status, errors, source and file actions. Double-click/Space selects entries. The
selection menu supports moving, freezing, retrying, restarting and removal. Drag
ordering and reverse preserve the active transfer; order changes apply to the
remaining jobs. Frozen jobs are not resumed by Start. Batch operations wait for
cancelled writers to settle before removing/restarting their records.

Completed jobs are hidden immediately, then removed from queue storage after their
manifest has been successfully indexed. Startup also removes previously indexed
completed history. Failed indexing preserves the completed queue record internally
for recovery; files and manifests remain untouched. Errors stay in their own tab.

Other additions: bulk retry and clear, confirmed download-from-scratch, link-list
import (up to 1000 URLs), error history/statistics including failed page numbers,
recent aggregate transfer speed, and a session byte limit. Setting/resetting the
limit resets the counter. Unlike Android's cellular-only limiter, the explicitly
labeled Windows limit covers all connections. It pauses unfinished transfers and
keeps completed pages. An interrupted page restarts when resumed. Removing a
queue record keeps partial files; it does not delete a book folder.

## Duplicate detection

Exact gallery identities are checked in the queue and library. E-hentai and
ExHentai gallery IDs share an identity; Hitomi remains separate. Concurrent adds
are serialized and repeated requests for one identity share their pending result.

Likely-duplicate checking follows Hentoid's longest-cleaned-title-word candidate
search, cosine trigram title comparison, artist matching (including reversed name
order), optional language restriction, cover similarity and three sensitivity
levels. Chapter-number variants are excluded when chapter bounds do not overlap.
This is a similarity heuristic, not proof of identical content.

Cover hashing uses the reference's 48×48 grayscale/DCT and retained coefficient
layout. Windows bitmap scaling is supplied by Electron. Hashes are cached by local
path, size and modification time. Animated GIF/unreadable/oversized covers fall
back to available metadata comparisons. Remote thumbnail bodies are restricted
to supported image MIME types and 8 MiB; the memory cache is bounded to 32 MiB.
Candidate database reads use indexed title search and batches of 100, without
loading all page lists or scanning image bodies across the library.

Potential duplicates prompt to cancel, download separately, or show the existing
book/queue. Existing copies are never automatically replaced or deleted. The six
duplicate preferences reproduce the reference browser defaults under Downloader.

## Scope boundaries

This amendment implements the listed queue and duplicate improvements for the
three supported sources and normal image downloads. It does not introduce streaming
or archive download modes, Android download-list file import, range downloads,
append-extra-pages on existing books, or replacement of a duplicate's files.
Those larger workflows remain separate work; no ineffective mode selector is shown.

## Validation

46 unit tests cover the existing downloader/library behavior plus cross-domain
identity, title/artist/language/chapter matching, perceptual hashes, reordered and
frozen queues, completed archival, active-removal cleanup, and resettable byte limits.

`smoke:queue` uses fictional galleries and isolated data. It exercises trusted
double-click acknowledgement, repeated requests, queue selection/freeze/reverse,
completion indexing and removal, exact and possible duplicates, both cancel and
download-anyway decisions, cover caching, URL import, Errors, bulk retry, statistics,
Esc behavior, the limit control and 390px layout. Screenshots are under
`artifacts/queue-smoke-*`. It can also run against a packaged ASAR through
`HENTDOWS_TEST_ASAR`. Existing browser, network, library and reader integration
suites remain regression checks. No real gallery downloads are needed for tests.
