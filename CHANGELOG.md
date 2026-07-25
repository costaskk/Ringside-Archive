# Changelog

## 5.8.1 — Episode index, duplicate and live-search reliability

- Populate show-index modals immediately from the checked-in Plex episode supplement, before any live feed refresh.
- Merge Plex and TVMaze rows by programme plus season/episode identity so the same broadcast appears once.
- Preserve owner-library titles and Plex matching while borrowing richer TVMaze summaries and still artwork.
- Keep the search input mounted while results update, including during deferred data, Plex and cloud refreshes.
- Prime record artwork on pointer/focus and load modal hero artwork eagerly at high priority.
- Add a dedicated UI regression smoke test for WWF Mania S01E01 deduplication and the stable-search path.

## 5.8.0 — Plex catalogue ingestion, lineage repair and R2 runtime persistence

- Audit 13,075 owner-library Plex records and match 13,040 of them.
- Add 6,572 exact deferred episode records and 760 missing dated events.
- Expand the catalogue to 104 promotions, 504 programme families and 1,904 dated major events.
- Add deterministic external-ID, date, programme and promotion-scoped Plex matching.
- Add `data/plex-title-map.json`, `data/plex-supplement.json` and `data/plex-import-report.json`.
- Split JCP, WCW, NWA, Georgia and modern GCW programme ownership by historical dates.
- Store the full linked Plex item index in IndexedDB and retain a quota-safe subset in local/cloud state.
- Make content images keyboard-accessible and open them in a full-size lightbox modal.
- Persist authenticated in-app artwork scans directly to Cloudflare R2 through the existing artwork API route.
- Patch artwork and action status incrementally without reloading the page or resetting scroll position.
- Add `tools/upgrade-preserve-r2.ps1` to protect an existing generated R2 catalogue during upgrades.
- Retain exactly 12 deployable Vercel Functions.

## 5.7.0 — Cloudflare R2 publication and recurring-series audit

- Add the R2 CLI publication workflow and content-hashed artwork assets.
- Split generic archives into real recurring series and reassign existing dated events.

## 5.6.0 — Artwork confidence, Plex LAN links and promotion coverage

- Add stricter artwork-source validation and wrong-image rejection.
- Add configurable Tailscale/LAN Plex detail links.
- Expand programme coverage, including the 111 NWA-TNA weekly PPVs.

## 5.5.0 — Async actions and exact free links

- Add button-level asynchronous progress and incremental artwork patches.
- Reject generic channel/search URLs as match or episode links.

## 5.4.x — Performance, wrestler profiles and stable scrolling

- Add deferred startup data, persistent Trakt activation state, wrestler headshots and top-match profiles.
- Remove synthetic master-index records and prevent background rerenders from resetting scroll.

## 5.3.0 — Trakt, Plex storage and artwork reliability

- Add complete Trakt headers and readable Cloudflare diagnostics.
- Add safe Plex export v3 and quota-aware browser storage.
