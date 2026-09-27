# Replication of Hentoid

The goal of this repo is to replicate a Hentoid (`./Hentoid`) to Windows, including all of its key features and (almost) identical layout and interface.

The key features should include (and should be implemented in this order):
- Browsing and downloading from supported websites, starting with E-hentai/Exhentai, Hitomi.
    - The long-press download action should be replaced by double click on windows
    - You may use stand-alone chromium for this browser.

- Library management
    - Target library size (by number of books) is 10,000 - 100,000, around 200-400 GiB.
    - All library data management method, you can replciate the Hentoid method.
    - All the search, sorting behavior should be replicated.

- Targeting a portrait layout on a vertical screen
    - This means identical view options as Hentoid.
    - Resizing of the windows could be supported, but don't be limited by this function, it is not that important.



## design requirements
- For Android-only actions
    - Map back to Ese key
    - Map long press to double-click
    - if certain actions really need a button, make it display narrowly at the bottom.


For functions and details that are not mentioned above, replciate exactly what Hentoid offers. If certain functions are not supported on Windows, pause the design/implementation for discussion and decision.

## future
This repo should replicate the cloned Hentoid and its current functions. Migration of future Hentoid functions back to this repo or future development on Android for this repo are NOT considered.

