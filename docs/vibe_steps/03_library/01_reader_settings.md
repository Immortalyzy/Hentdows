# Library and viewer preferences — 0.4.0

Implements `02_after_library.md` against the checked-in Hentoid snapshot:
`app/src/main/res/xml/preferences.xml`, `values/array_preferences.xml`,
`values/donottranslate.xml`, and `ReaderViewModel.kt`.

## Settings and interactions

Settings has Downloader, Library and Viewer sections. Each section saves validated
values to the existing settings file; upgrading retains downloader preferences,
cookies, downloaded files and the library database. Missing new keys receive
Hentoid defaults. Choice values use explicit units instead of Android array indices.

Single-click/Enter opens a book directly. The small **⋯** button opens its existing
details/actions. Double-click selects books and Space toggles selection. A short
400 ms single-click delay preserves double-click selection. Esc remains Back.

| Hentoid preference group | Windows implementation |
| --- | --- |
| Library | Nostalgia source shortcuts; list/grid display; endless scrolling; 20/40/60/80/100 items per page; Go to Top |
| Library grid | Title, language text, favourite, rating, source and storage visibility; group count/size; S–XXL adaptive card width |
| Library search | Separate general and numeric/URL delays, including Enter-only; metadata alphabetical/count order and count visibility |
| Viewer controls | LTR, RTL, top-to-bottom; drag/swipe, fling, border clicks and wider zones; arrow keys and four configurable page/book keys |
| Windows wheel | Accumulated wheel/touchpad movement turns horizontal pages with a cooldown; vertical reading and zoom use native scrolling |
| Zoom | Double-click zoom, temporary hold zoom, zoom cap, zoom controls, drag to pan, optional persistence across horizontal pages |
| Visuals | Keep screen awake while the viewer is active, page/zoom animations, top/bottom/hidden page number, conditional rotation |
| Color | Color and opacity overlay; reset control |
| Rendering | Solid-border crop; original files preserved |
| Horizontal | Fit, proportionate fill, stretch, two-page spreads, RTL spread order |
| Vertical/gallery | Separator sizes; lazy visible page images; gallery with 2–5 columns and bounded thumbnail batches |
| Navigation | Resume except at book end, gallery startup, chapter/book controls, continuous reading, read/completion thresholds, next/previous after confirmed deletion |
| Slideshow | 0.5–30 second page delays, seven vertical scroll speeds, stop/chapter/book/continuous loops |

Read thresholds use unique successfully displayed pages in the current reading
session; a session is counted once when its threshold is reached. An already-read
book counts another session on viewing a page unless counting is disabled.
Completion uses the rounded percentage threshold, with at least one visible page.
Progress and last position save as pages are viewed, including revisited pages.
Opening the gallery alone does not mark its thumbnails read. Missing image files
produce a visible error without being marked read.

Book neighbours are captured on opening in the current filtered/sorted library
order, so changing a read/completed flag cannot lose the next book mid-session.
Navigation works across library page boundaries. Deletion uses the existing
confirmation and Recycle Bin containment checks; cancelling keeps the reader open.

## Agreed Windows adaptations

The user approved configurable keyboard equivalents for Android volume controls,
the full Windows viewer area instead of notch handling, and Chromium's native
rendering/color depth instead of Android bitmap options. Those Android-only
switches are not presented as ineffective controls.

Hentdows download manifests contain one chapter per book. Chapter navigation has
no adjacent chapter; chapter looping repeats the current book. Multi-chapter
imports remain outside the Hentdows-download scope. Broader app theme, locale,
plug reactions, storage conversion and source preferences are separate from this
library/viewer change.

Cropping analyzes a small bitmap for solid borders. Cropped/rotated previews use
a canvas capped at 4096 pixels on its longest side; native unprocessed images
keep their original resolution and animation. Processing animated files displays
a still frame. This is a bounded Chromium implementation, not Android's bitmap
renderer. No image file is rewritten.

## Scale and validation

Endless library scrolling uses fixed-height virtual rows, spacer geometry, bounded
queries (at most 200 records), and lazy covers. Offscreen rows are released and
requeried on return. Paged mode uses the selected quantity. The vertical reader
keeps lightweight page placeholders and decodes only images near the viewport.
Gallery thumbnails are limited to 100 per batch.

Unit tests exercise default migration, invalid IPC values/shortcut collisions,
all sort directions for reader adjacency, custom order, and group size/metadata
ordering. Existing library and downloader tests remain in use.

`npm run smoke:reader` uses 240 fictional books and checks settings persistence,
grid visibility, virtual scroll/back/top, direct reading/details, wheel toggles,
RTL/keyboard controls, custom keys, crop/rotation, two pages, gallery columns,
slideshow, read/completion thresholds, resume, continuous reading and lazy vertical
images. It captures screenshots under `artifacts/reader-smoke-*`. Existing library,
browser/download and Chromium transfer smoke tests cover regression paths.
