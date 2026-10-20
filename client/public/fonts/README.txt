Space Arenas — bundled UI fonts
===============================

Served from the web root at /fonts. `client/public/fonts` is copied into
`client/dist/fonts` by `npm run build`, and `client/dist` is what the LAN host
serves. Nothing here is fetched from the internet, so the interface keeps its
fonts on an offline LAN and the game still makes no third-party requests.

Files
-----
Audiowide-latin.woff2, Audiowide-latin-ext.woff2   English UI  ('Audiowide')
Kufam-arabic.woff2, Kufam-latin.woff2,
Kufam-latin-ext.woff2                              Arabic UI   ('Kufam')
OFL-Audiowide.txt, OFL-Kufam.txt                   font licences (SIL OFL 1.1)

Where they are used
-------------------
`client/src/styles.css` declares the @font-face rules and picks the family per
language:

    html[lang='en'] { --font-ui: 'Audiowide', ui-monospace, monospace; }
    html[lang='ar'] { --font-ui: 'Klapt Arabic', 'Kufam', ui-monospace, monospace; }

In-canvas text drawn by Pixi (unit counts, on-map labels) deliberately stays
monospace — see the `fontFamily` entries in `client/src/render/renderer.ts`.

Adding a licensed Klapt Arabic
------------------------------
"Klapt Arabic" by SevenType is a commercial typeface. It is NOT shipped here and
cannot be added to the public repository unless you hold a web/webfont licence
that allows redistribution. With a licence of your own:

  1. Put the woff2 files in this folder, e.g. `klapt-arabic-regular.woff2`
     (and mirror them into `client/dist/fonts` for the prebuilt copy).
  2. Add a matching @font-face rule to `client/src/styles.css` using the family
     name exactly `'Klapt Arabic'`. It already sits first in the Arabic stack,
     so nothing else has to change.
  3. Do NOT commit the licensed files. `.gitignore` already blocks `*klapt*`
     under both fonts folders — committing them would redistribute the font and
     breach its licence.

Tip: the same `README.txt` and `OFL-*.txt` files are copied to
`online/public/fonts` for the website. If you add a font here for the game, copy
it there too — the site's `online/public/styles.css` uses the same two stacks.

Free alternatives to Klapt Arabic, if you would rather not license it: Kufam
(already bundled), Reem Kufi, Noto Kufi Arabic, Cairo, Tajawal, Almarai — all on
Google Fonts under the SIL Open Font License.

Licensing
---------
The font files stay under their own licences (SIL OFL 1.1 — see the OFL-*.txt
files), which are compatible with the Space Arenas License: they may be used,
modified and redistributed, including commercially, as long as the OFL terms and
the fonts' own reserved names are respected. That is independent of the game's
non-commercial licence, which covers the game itself.
