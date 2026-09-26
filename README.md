# Watchlist

A small, password-protected website for a personal watching list.
Open the site, unlock once, and see the latest saved episode for each show.

The browser decrypts `watchlist-data.json` locally. The repository contains
only the page assets and encrypted viewing data; it never contains a password,
private upload key, or plaintext viewing data. Episode catalogs are inside the encrypted snapshot.

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

Website editing uses the GitHub API. Updated desktops check for newer website progress once at startup.

## Edit progress from your phone

Unlock the list, open **Editing setup**, and paste a fine-grained GitHub token
restricted to `ComfyCozyCat/watchlist`, with **Contents: Read and write** and
required **Metadata: Read-only**. The page checks access to the existing snapshot;
the first Save also checks write permission. **Remember editing access on this
device** is enabled by default. Close setup and tap **Edit** at the top of a
show. Season and Episode selectors default to the current episode; choose a
different episode to load its saved status and time. Per-row Edit buttons have
been removed to keep the list compact.

Enter Hours / Minutes / Seconds or choose **Watched** / **Unwatched**, then Save.
Minutes and seconds stay within 00–59. Positions above a known episode length
adjust to its end when leaving a field or saving. Hours support long recordings;
unknown lengths have no guessed media-duration limit (the input permits up to
99,999 hours). Manual time entry does not automatically mark an episode watched.
Unwatched clears that episode's position; Watched moves the summary to the next
unwatched episode. Cancel makes no changes. Editing unavailable media is allowed,
so DVD progress can be recorded even when desktop media is absent.

Save commits **only encrypted progress** to `watchlist-progress.json` on `main`.
Other browsers fetch that file through GitHub's API when unlocking, refreshing,
or returning to the page, without waiting for a Pages rebuild. Public read-only
browsers do not need the editing token, but are subject to GitHub's unauthenticated
API request limits. A failed refresh shows a warning and keeps the last loaded
edits in memory. A failed save retains the input; no success is claimed offline.
Refresh is paused while an editor/setup dialog is open.

The token is sent only as an HTTPS Authorization header to `api.github.com`.
It is never serialized into a progress document, commit, website source, URL,
or log. Remembering it stores an AES-GCM encrypted credential **only in this
browser's localStorage**, using the watchlist key and a distinct authenticated
context. Lock clears the active credential and decrypted UI; unlocking restores
remembered editing access. **Forget editing access** deletes the local encrypted
credential. This is device storage, not a server vault: remembered viewing keys
on the same device and malicious same-origin JavaScript remain relevant threats.
Clearing browser data removes remembered access. An expired/revoked token must
be replaced in Editing setup. Other editing browsers need their own setup.

## Progress storage and desktop startup sync

The desktop continues to publish only `watchlist-data.json`. Website overrides
remain in the separate progress file and therefore survive desktop uploads.
The desktop checks for newer episode progress once at startup, before uploading,
when its new Watchlist startup checkbox is enabled. It saves a recovery copy
before importing, respects Favorites/All/Off, and skips ambiguous identities,
legacy source-state conflicts, and shows already playing. It records each
imported website revision and exports per-episode `watch_updated_at` timestamps
plus `website_revision` acknowledgements. The website ignores acknowledged or
older overrides, letting later desktop watching appear normally. A changed
desktop episode detected while saving asks for Refresh instead of overwriting it.
Older desktops without that metadata retain the previous overlay behavior.

Progress envelopes use the snapshot's salt/key derivation, AES-256-GCM with a
fresh random nonce, and the distinct AAD `watchlist-progress-v1`. Plaintext has
`version: 1`, `kind: "website-progress"`, an update timestamp, and an `edits` array.
Each edit includes an identity key, explicit watched state, position, timestamp,
random revision, and allowlisted source context for later desktop reconciliation.
It does not include media paths, credentials, or the whole desktop library.

Episode keys use show name, season, and original episode number; unique
unnumbered episodes use their title. Disc numbering is display-only. Ambiguous
identities cannot be edited. Renamed shows/unnumbered titles are not guessed or
matched by array position; unmatched records remain preserved in the progress
file. Unmatched records are preserved; stable IDs across show/title renames remain a
future improvement. Upload time is never treated as the per-episode change time.

Saves read the latest file and compare the edited episode's revision with the
revision displayed when Edit opened. Same-episode conflicts require Cancel,
Refresh, and review. Unrelated edits merge; GitHub's file SHA prevents silent
replacement of a concurrent commit, with bounded retries. Do not delete or reset
the progress file during publication or desktop refresh.

Changing the desktop watchlist password/salt currently requires migrating the
progress file with the old and new keys. Until that exists, a salt mismatch
blocks website saves and displays an explanation instead of overwriting edits.
Remembered editing access also needs reconfiguration after a password change.

## Development checks

The desktop project's `tests/test_watchlist_editing.cjs` uses isolated encrypted
fixtures and mocked GitHub requests; it never reads private setup or writes to
GitHub. Run it alongside `test_watchlist_browser.cjs` and
`test_watchlist_cache.cjs`, with `WATCHLIST_SITE_DIR` pointing to this checkout
and `NODE_PATH` / `CHROMIUM_PATH` pointing to Playwright and Chromium. Test
cross-browser writes/conflicts, input limits, local credentials, and Lock after
changing the editor. Bump all versioned HTML/module asset references together
when deploying script/DOM changes.
