# Ringside Archive v5.3.0 professional audit

## Preserved archive foundation

- 101 promotion profiles
- 287 programme families
- 1,144 dated major events
- 1,144 detail records
- 71 curated recommendations
- 110 wrestler-directory entries
- recovered original production assets under `legacy-original/`
- exactly 12 deployable Vercel Functions

## Problems reproduced from the live deployment

### Trakt

The Trakt device-code function was correctly configured in Vercel, but the API request lacked a stable application identity and complete Trakt API headers. Trakt/Cloudflare could return an HTML “Attention Required” page, which the older UI then displayed as an error string.

### Plex export and matching

The supplied legacy export contained thousands of valid records from unrelated libraries, but the `Wrestling` and `Wrestling PPV` entries were empty library placeholders rather than media rows. It also embedded a Plex token in artwork URLs and did not contain Plex viewing-state fields. Zero wrestling matches was therefore the expected result for that file.

### Browser quota

The older client attempted to persist the complete Plex scan and artwork cache in `localStorage`. A sufficiently large scan exceeded browser storage quota even though matching itself had completed.

### Artwork and cloud noise

Direct Wikimedia hotlinks could return 403. Artwork discovery also marked the account state dirty after each small batch, causing repeated Supabase pull/push cycles and noisy service-worker logs.

## Corrections implemented

### Trakt API compatibility

- Every OAuth, history, refresh and sync request now sends:
  - stable `User-Agent` and `Api-User-Agent`;
  - `trakt-api-key`;
  - `trakt-api-version: 2`;
  - JSON accept/content headers;
  - language and no-cache headers.
- HTML/Cloudflare responses are parsed into a short diagnostic; Cloudflare markup is never inserted into the interface.
- Client ID and secret values are trimmed before use.
- The client secret remains server-side in Vercel.

### Plex export v3

- Select libraries with `-LibraryNames` or automatic wrestling-name detection.
- Show libraries export exact episode rows (`type=4`).
- Other Videos libraries use their native section type instead of an incorrect movie filter.
- Movie libraries export movie/event rows.
- `viewCount`, `viewOffset` and `lastViewedAt` are included.
- Output is UTF-8 without a BOM.
- Null placeholder rows are removed.
- Plex tokens and tokenized artwork URLs are never written.
- `npm run audit:plex -- <file>` reports format, library counts, likely wrestling rows, viewing-state rows and token exposure.

### Plex matching and storage

- Matching normalizes punctuation, file extensions, resolution/codec/release tags and numeric prefixes.
- Programme aliases, exact `SxxEyy`, season/episode text and event title/year are supported.
- Scans are matched in memory.
- All ownership match keys are retained, but only compact linked Plex items are persisted.
- Raw `X-Plex-Token` artwork URLs and unapproved fields are stripped before browser/cloud storage.
- If storage is tight, the derived artwork cache is removed first and the Plex item links fall back to viewed/in-progress records while ownership keys remain.
- Legacy imports containing `X-Plex-Token=` are rejected before storage or account upload.

### Artwork delivery and sync

- TMDB, TVMaze and Wikimedia images are delivered through the existing allow-listed same-origin artwork route.
- The proxy validates host, HTTPS, image content type and size.
- Artwork remains source-attributed.
- Artwork is a bounded, regenerable device cache and is excluded from Supabase archive state.
- Artwork batches no longer trigger account synchronization.

### Service worker

- Non-origin requests, including Supabase and third-party artwork, bypass the service worker.
- Same-origin private API responses are network-only and never cached.
- Application modules and catalogue files remain network-first.

## Validation performed

`npm test` validates:

- catalogue references, IDs and date formats;
- 12-function Vercel Hobby limit;
- absence of obsolete Trakt routes;
- Supabase key compatibility, RLS schema and encryption round-trip;
- Trakt required headers and HTML-error diagnostics;
- artwork discovery and same-origin image proxy;
- Plex direct-to-Relay connection fallback;
- exact show and native Other Videos section scanning;
- episode/event Plex matching;
- quota-aware Plex storage compaction and token stripping;
- full browser rendering smoke test.

Live Trakt and Plex access still depends on the deployed credentials and the network reachability of the user’s Plex server. The repository tests use controlled mock responses and do not impersonate the user’s accounts.
