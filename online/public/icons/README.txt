Space Arenas — website icons
============================

Everything in this folder is served from the GitHub Pages root
(https://sdevrami.github.io/space-arenas/...), so the site needs no third-party
request for its icon. The fonts live next door in ../fonts/.

Files in the parent folder
--------------------------
favicon.ico          The tab icon. The same file the game serves
                     (client/public/favicon.ico -> client/dist/favicon.ico).
                     The .ico already carries 16/32/48/64/128/256 px variants.
apple-touch-icon.png 180x180 home-screen icon for iOS/iPadOS.
logo.png             256x256 transparent copy of the game logo
                     (client/dist/logo.png), used for the social preview
                     (og:image).

All four HTML pages link them with:

    <link rel="icon" href="./favicon.ico" sizes="any" />
    <link rel="apple-touch-icon" href="./apple-touch-icon.png" />

Regenerating
------------
The PNG files are derived from the game's 800x800 logo.png master. If the logo
changes, regenerate them: keep the transparent background, scale the artwork to
fill the whole canvas, and do not re-letter or recolour it. To update only the tab
icon, replace favicon.ico here and in client/public.

Fonts
-----
See ../fonts/README.txt for the two families, the @font-face rules in
../styles.css and the notes on the commercial "Klapt Arabic" typeface.

