Space Arenas — website fonts
============================

Served from this folder on GitHub Pages, so the site needs no third-party font
request. These are the same files the game bundles (`client/public/fonts` →
`client/dist/fonts`); keep the two folders in step when a font changes.

Files
-----
Audiowide-latin.woff2, Audiowide-latin-ext.woff2   English UI  ("Audiowide")
Kufam-arabic.woff2, Kufam-latin.woff2,
Kufam-latin-ext.woff2                              Arabic UI   ("Kufam")
OFL-Audiowide.txt, OFL-Kufam.txt                   font licences (SIL OFL 1.1)

Where they are used
-------------------
`../styles.css` declares the @font-face rules and picks the family per language:

    html[lang="en"] { --font-ui: "Audiowide", "Segoe UI", system-ui, ... }
    html[lang="ar"] { --font-ui: "Klapt Arabic", "Kufam", "Noto Sans Arabic", ... }

A licensed Klapt Arabic
-----------------------
"Klapt Arabic" by SevenType is a commercial typeface. It is NOT shipped and must
not be committed to the public repository unless your web/webfont licence allows
redistribution. With a licence of your own, add the woff2 here and in
`client/public/fonts` plus a matching @font-face rule in both stylesheets using
the family name exactly `"Klapt Arabic"` — it is already first in the Arabic
stack, so nothing else changes. `.gitignore` blocks `*klapt*` in both folders to
keep the licensed files out of the repo.

Free alternatives, all on Google Fonts under the SIL OFL: Kufam (already used),
Reem Kufi, Noto Kufi Arabic, Cairo, Tajawal, Almarai.

Licensing
---------
The fonts stay under their own licences (SIL OFL 1.1 — see the OFL-*.txt files),
which are compatible with the Space Arenas License: they may be used, modified and
redistributed, including commercially, as long as the OFL terms and the fonts' own
reserved names are respected. That is independent of the game's non-commercial
licence, which covers the game itself.
