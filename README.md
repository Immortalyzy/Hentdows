# Hentdows

A Windows reader and library manager adapted from [Hentoid](https://codeberg.org/VioletKnight/Hentoid), for larger screens, mouse and keyboard use.

## Install

1. Download the Windows x64 ZIP from [Releases](https://github.com/Immortalyzy/Hentdows/releases/latest).
2. Extract the entire folder and run **Hentdows.exe**. No Node.js installation is needed.
3. To update, close Hentdows and extract the new release into a separate folder. Your saved profile and library locations are reused.

The portable build is unsigned.

## Use

- **Add books:** open the library menu and choose **Add library location**, or **Import Hentoid folder** for a copied `.Hentoid` folder containing images and metadata. Use **Refresh library** after changing files outside the app.
- **Browse and download:** choose E-hentai, ExHentai or Hitomi from Sources. Sign in when needed; ExHentai requires an account with access. Double-click a gallery link to queue it, or use the download button on its page. Manage downloads in Queue.
- **Read:** click a book, or use arrow keys to focus it and **Enter** to open it. Turn pages with the mouse wheel or arrow keys. Click or drag the progress bar to jump to a page. **Esc** returns to the library.
- **Organize:** search, sort and filter the library; use the star button to rate books. Double-click to select books or right-click for actions. Deletion asks for confirmation and may permanently delete files if the Recycle Bin is unavailable.
- **Customize:** use the gear button for browser, downloader, library and viewer settings, including reading direction, zoom and Anime4K upscaling.
- **Back up:** use **Back up metadata** for your library index and reading history. Back up book folders separately. Keep metadata backups, bookmark exports and browser profiles private.

## Run from source

Install Node.js 22.13 or newer, then run:

```powershell
npm ci
npm start
```

## Hentoid and license

Hentdows is an independent Windows adaptation, not affiliated with or endorsed by Hentoid. Thanks to the [Hentoid project](https://codeberg.org/VioletKnight/Hentoid) for the original app and interface.

Licensed under Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for attribution and third-party licenses.
