# Multiple library locations and Hentoid import (0.7.0)

Open the Library menu and choose **Add library location** for another download
folder, or **Import Hentoid folder** for a copied `.Hentoid` folder. The storage
manager offers the same actions. Choose the folder on Windows containing the
source folders and books; individual book folders also work.

The library lists books from every registered location together. The **Storage**
selector limits the view to one location, and **Show all books** in the storage
manager resets filters. Adding or importing a location also resets library filters.
The default destination for new downloads changes only when explicitly selected
in the storage manager. Existing queue jobs keep their destinations.

## Supported Hentoid folders

Each book must have local image files and Hentoid JSON metadata. The importer
recognizes current `contentv2.json`, legacy `content.json`, and oldest `data.json`,
in that priority order. JPEG, PNG, WebP, AVIF, GIF and BMP images are supported.
Android file URIs and remote image URLs are not followed. Metadata names map to
local filenames, including extensionless names; page order follows metadata,
with remaining local images sorted naturally. Thumbnail files are used as covers
and excluded from readable pages.

Import brings in titles, source information, attributes, dates, 0–5 star ratings,
favourites, completion flags, reading counts/progress, favourite/read pages and
custom group membership recorded in each book's JSON. These user fields are
seeded on first import; later scans preserve Hentdows edits and reading state.
Books from sources without a Hentdows browser adapter can still be read offline.

Books are indexed in place. Import does not move images or modify Hentoid JSON;
Hentdows stores its own index and subsequent edits in its profile. Keep the
registered folders available. Reimporting the same path updates existing records;
separate copies in different folders remain separate books. Overlapping roots are
rejected or reused to prevent scanning the same path twice.

Malformed books are reported without stopping other imports. Missing referenced
pages produce warnings when local pages are available. Books with no local pages
are skipped. Unavailable drives retain indexed metadata and can be reconnected
through the storage manager.

Raw Android ObjectBox databases, metadata-only backups, archives, PDFs, remote-only
books, dynamic groups and empty groups are not imported by this feature. Copy
the image folders and their per-book JSON metadata from Hentoid.

## Validation

All development validation uses generated books and isolated profiles, following
`AGENTS.md`; no existing user library is accessed. Unit tests cover current and
legacy formats, ordering, metadata, path validation, multiple roots, offline
locations, malformed books and preservation of local edits. `npm run smoke:import`
checks the combined library, location filtering, repeat import, unchanged source
JSON, reader resume, cancellation and a narrow layout. Set `HENTDOWS_TEST_ASAR` to
the packaged `resources/app.asar` to run the same check against a build.
