# Watchlist

A small, password-protected reading view for a personal watching list.
Open the site, unlock once, and see the latest saved episode for each show.

The browser decrypts `watchlist-data.json` locally. The repository contains
only the page assets and encrypted viewing data; it never contains a password,
private upload key, plaintext export, media paths, or a full episode catalog.

## Hosting

Serve this directory over HTTPS. For GitHub Pages, publish `main` from `/ (root)`.
There is no build step and no third-party runtime dependency. Local previews
can use `python3 -m http.server` on localhost, where browser cryptography works.

## Snapshot format

Version 1 uses AES-256-GCM with a new random 12-byte nonce for each update,
PBKDF2-HMAC-SHA256 (600,000 iterations), a 16-byte salt, and UTF-8 additional
authenticated data `watchlist-v1`. Binary fields use standard Base64.
The salt remains stable until the password changes; the nonce never does.

Remembering access stores a password-equivalent decryption key in this browser's
local storage. Use Lock to remove it. A new password/salt invalidates remembered
access to future snapshots. Previously downloaded data and old Git revisions
retain their old password. Use a long, unique password: encrypted public files
can be subjected to offline guessing.

The list is read-only. Nothing is sent back to a player or media library.
