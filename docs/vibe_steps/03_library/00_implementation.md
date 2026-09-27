# Library milestone — Hentdows downloads

Starting checkpoint: `b73f2c5` (working downloader/settings and Chromium fixes).
The user selected Hentdows downloads as the intended library content.

## Reference mapping

The implementation follows the checked-in Android snapshot, especially:

- `widget/ContentSearchManager.kt`: query/filter structure and default AND combination.
- `database/ObjectBoxDB.kt`: title substring OR exact source ID OR matching attributes;
  comma-separated attribute terms; exact ratings; favourites/completion independently.
- `LibraryBottomSortFilterFragment.kt`: title, artist, page count, download processing
  and completion dates, upload date, last read date, reads, size, read progress,
  average page size, custom order and random ordering.
- `enums/Grouping.kt`: flat, artist, series, download-date, custom, dynamic and folder views.
- `library_selection_menu.xml`: editing, removal, rating, completion, reset read stats,
  grouping and opening the book folder. Android long press is a Windows double-click.
- `item_library_content.xml` and `item_library_content_grid.xml`: portrait rows/cards,
  cover, title, author, metadata, favourite and reading indicators.

SQLite replaces the Android ObjectBox binding. The content/attribute/group and
page-state relationships remain explicit; a background worker owns the database.
Images stay in book folders, are fetched lazily through an ID-based local protocol,
and never enter the database. File access validates the real book and image paths.

## Index and persistence

Only completed version-1 Hentdows manifests are imported. Startup registers the
current download root and previous roots represented by saved jobs, then scans
in the worker. Completion events import new books. Subsequent scans skip unchanged
manifest size/mtime signatures. Refresh never overwrites edited titles/tags,
ratings, favourites, custom membership or reading history. Missing books retain
their records; incomplete/unreadable scans do not remove records. Symlinked
directories are not traversed. Cancellation stops refresh between folders.

The first import necessarily visits book folders/manifests. It does not read
image bodies or calculate image hashes. Book/page count and size come from the
completed manifest. Old manifests use filesystem timestamps for download dates;
upload dates remain unknown when not recorded. New downloads record those dates.

List queries return at most 200 summaries (the UI requests 60), without page lists.
Detail/reader requests load one book's files. Search uses FTS5 trigram indexing for
three-or-more-character substrings and literal matching for shorter terms. Exact
metadata filters use normalized attribute relations. Sort columns are indexed;
ties use book ID, and reads additionally use last-read date and download date.
Random order persists until Shuffle. Custom ordering supports custom, artist and
series groups. Dynamic groups reevaluate their saved criteria.

The last 100 successfully indexed completed jobs remain in the download queue;
older ones leave the queue file only after indexing. The library prevents duplicate
downloads across that archived history. Active/failed jobs remain unchanged.

Metadata backup creates a consistent SQLite snapshot. Restore checks the database
application/version IDs and imports all tables in one transaction, rolling back
on failure. Images are never deleted or replaced by metadata restore. Book removal
keeps files and records a detached-path marker so refresh does not immediately
reimport it. Restore removed books clears those markers. Deletion uses the Windows
Recycle Bin, verifies root containment, and rejects library roots and active books.

## Validation

Unit tests cover literal/Unicode search, comma AND, metadata AND/OR/exclusions,
absent attribute types, exact ratings, all book sort pagination, custom ordering,
dynamic groups, refresh preservation, atomic edits, worker indexing, missing files,
traversal rejection, backup/restore, grouping beyond 100 groups, and restart.

The offline Electron test covers 75 fictional books: automatic startup indexing,
60/15 pagination, list/grid rendering, search, favourite/rating, double-click
selection, basic reader progress, Esc, custom groups, local image access, renderer
isolation, metadata backup and the 390px window layout. Existing downloader and
real-network smoke tests remain part of validation.

On the development machine, 100,000 synthetic metadata records indexed in 26.2 s.
Eight sampled queries (including the final page, title/tag searches, attribute
filter, average size, progress and random) took 4–100 ms. The test index was 113 MiB
and the process RSS was 63 MiB. These are synthetic results, not a guarantee for
every disk/query or an actual 400 GiB collection. Fixtures use short page lists;
real database size depends on metadata and page counts.

## Remaining parity work

This is the Hentdows-folder library milestone, not the entire Android library toolset.
Hentoid/CBZ/PDF imports, archive/storage conversion, merge/split/transform/export of
book files, LANraragi, richer group metadata/covers and advanced reader modes remain.
Those capabilities have not been judged unsupported on Windows. No Android-only
functional blocker was encountered in this milestone. The basic reader exists to
make read-date/count/progress/page-favourite management operative; it does not claim
Hentoid's complete rendering, gestures, effects or reader-settings parity.
