# Ringside Archive v5.2.0 professional upgrade audit

## Recovered and preserved foundation

- 101 promotion profiles
- 271 recovered programme families plus 16 verified catalogue additions
- 287 total programme families
- 1,144 dated major-event records
- 1,144 detail records
- 71 curated recommendations
- 110 wrestler-directory entries
- original compiled client and stylesheet retained under `legacy-original/`
- existing TVMaze mappings, official URLs and YouTube links preserved

## Catalogue and chronology

- Complete Timeline combines programme markers, major events and exact episodes.
- Weekly episodes are loaded only from mapped TVMaze feeds, checked-in snapshots or manually sourced custom records.
- The app never invents missing territorial broadcast dates.
- Missing local TVMaze snapshots no longer generate a console flood: `data/tvmaze/index.json` declares which snapshots actually exist, and the browser otherwise goes directly to the live mapped feed.
- Sixteen important programme families were added, including WCW Worldwide, WCW Main Event, WCW Pro, Power Hour, the JCP/TBS lineage, WWF Mania, Action Zone, LiveWire, NXT Level Up, WWE Speed and WWE Evolve.

## Filters and navigation

- Filters are visible on first load and can be collapsed.
- Company, region, programme type, wrestler, start year, end year, Plex, YouTube, artwork, exact-feed and watched-state filters are functional.
- Active filters render as removable chips.
- Company and wrestler selections can be cleared individually.
- Every filtered/empty state includes a Reset all action.
- The service-worker update path prevents an older cached UI from hiding newly deployed controls.

## Wrestler directory

- Wrestler appearances are indexed once instead of rescanning the full catalogue for every card.
- Metrics are cached and only the first 50 wrestler cards render initially.
- Headshots use lazy image slots and bounded artwork discovery.
- Default order is Archive score, high to low.
- Alternate orders include appearances, curated picks and alphabetical name.
- Archive score uses direct source/personal ratings where available; otherwise it transparently uses archive prominence and is not presented as an external public ranking.

## Artwork and logos

- Layered discovery supports programme posters, show backdrops, season posters, episode stills, individual-event art, company logos and wrestler headshots.
- Sources include manual verified overrides, TVMaze, optional TMDB, Wikipedia/Wikimedia Commons and imported Plex artwork.
- Company cards have logo slots with initials/favicons as graceful fallbacks.
- Wrestler cards have headshot slots with initials as graceful fallbacks.
- Failed image URLs no longer leave invisible content; the fallback is restored.
- Artwork scans are bounded, cached and source-attributed.
- No generated or unrelated image is labelled as original artwork.

## Trakt

- Device authorization is consolidated into `api/trakt/device.js`.
- The client never calls the removed `device-code` or `device-token` routes.
- Vercel configuration is re-read immediately before authorization.
- Environment values are trimmed to tolerate accidental whitespace.
- Missing credentials and Trakt 403 responses return actionable diagnostics.
- Signed-out users can keep a device-local connection; signed-in users can migrate the encrypted connection into the account vault.
- Exact episode and supported-event history import, watched/unwatched writeback and token refresh remain supported.

## Plex

- Plex PIN authorization, server discovery and cross-device encrypted credentials are preserved.
- Users can load the actual library sections on a selected server, choose one or more wrestling sections and scan only those sections.
- Scans try secure direct and relay connections, record per-connection diagnostics and page large libraries with bounded concurrency.
- The scanner distinguishes show ownership, exact season/episode ownership and event title/year matches.
- Real `viewCount`, `viewOffset` and duration determine Watched/Watching state; owning a file does not mark it watched.
- Exact scrobble/unscrobble writeback and optional Plex-to-Trakt forwarding remain supported.
- LAN-only servers retain the PowerShell JSON-export fallback.

## Accounts and security

- Supabase email accounts and Row Level Security protect per-user archive state.
- AES-256-GCM encryption protects Plex and Trakt provider credentials in a server-only integration vault.
- Both current `sb_secret_...` and legacy `service_role` Supabase server keys are supported correctly.
- Shared-browser caches are tied to the owning account.
- Private `/api/` traffic is always network-only and is never stored by the service worker.
- Plex artwork is served through short-lived signed proxy URLs rather than exposing the Plex token.

## PWA and deployment reliability

- Service-worker cache version: `ringside-archive-v5.2.0`.
- Navigations, source modules, catalogue JSON and runtime configuration are network-first.
- API requests are `no-store` and network-only.
- An upgrade guard clears older Ringside caches and activates the latest worker.
- Vercel Hobby compatibility is enforced at exactly 12 deployable functions.

## Validation

Run:

```powershell
npm test
```

The final suite validates:

- catalogue references, IDs and dates;
- required files and JSON;
- the 12-function Vercel Hobby ceiling;
- absence of obsolete Trakt routes;
- encryption round-trip and Supabase schema/key compatibility;
- Trakt diagnostics;
- company-logo and wrestler-headshot artwork discovery;
- Plex direct-to-relay connection fallback and selected-section scanning;
- browser rendering of the production UI.
