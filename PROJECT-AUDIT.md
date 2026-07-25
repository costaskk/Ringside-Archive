# Ringside Archive v5.8.1 professional audit

## Scope

This release was validated as a complete application and catalogue update, not only a front-end patch. The audit covers data integrity, Plex matching, historical promotion ownership, image behavior, authenticated R2 persistence, browser storage and Vercel deployment limits.

## Catalogue

```text
104 promotions
504 programme/event families
1,904 dated major events
6,572 deferred exact Plex-derived episode records
71 curated recommendations
110 wrestler profiles
```

## Owner Plex export

The source export contained 13,075 rows: 12,219 episodes and 856 movie/event records. The v5.8 matcher linked 13,040 rows.

Strong matches include 749 external-ID matches and 101 exact-date matches. The remaining valid records use explicit programme/date mappings and conservative promotion-scoped title logic.

Excluded deliberately:

- 29 episode rows with impossible or unsafe dates.
- 6 compilation/documentary releases that are not chronology events.
- 0 unexplained event rows.

The committed supplement is privacy-reduced and excludes Plex rating keys, token, server URL and watch state.

## Promotion lineage corrections

JCP, WCW and NWA are populated independently. Cross-era programme titles use explicit cutover dates, preventing a 1980s JCP episode from appearing under WCW or a modern NWA show from being merged into historic NWA content.

Georgia territory records found under a misleading modern GCW Plex container are reassigned by date. WWE ECW and original ECW remain separate.

## Runtime behavior

- Artwork, logos, headshots and gallery images open in an accessible lightbox.
- Artwork scanning patches the affected card instead of rebuilding the root page.
- Scroll/focus preservation remains active for the few operations that legitimately render a view.
- The complete linked Plex index is written to IndexedDB.
- Compact ownership and viewing data remains within browser/cloud storage limits.
- The Plex supplement loads after the initial usable screen.

## R2 architecture

The existing `/api/artwork/search` function also performs authenticated R2 persistence, keeping the deployment at 12 functions. It accepts only strict-resolver sources, downloads the accepted image server-side, enforces a 10 MB limit, creates a content-hashed key and uploads with immutable caching.

R2 writes require:

- all five R2 environment variables;
- a valid signed-in Ringside/Supabase account.

Public signed-out scans remain available but cannot consume the private R2 write credential.

## Limitations stated honestly

- The application does not automatically commit runtime-scanned R2 URLs back to GitHub. They persist in R2 and the signed-in account/local artwork cache.
- Historical Plex metadata can contain errors; the release excludes known anomalies rather than guessing.
- Live Plex scanning still depends on a remotely reachable secure Plex connection; local JSON import is the reliable fallback.
- A Plex token exposed outside the export remains a credential and should be rotated.
