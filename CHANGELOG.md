# Changelog

## 5.6.0 — Source-validated artwork, Plex LAN links and expanded coverage

- Prioritize mapped TVMaze images and enforce strict title/year/context thresholds for TMDB and Wikipedia/Wikimedia results.
- Reject ambiguous company portraits, wrestler logos, generic promotion art and unrelated event images.
- Stop using company logos as fallback posters for show, episode and event cards.
- Start a new v2 device artwork cache and add a Wrong image action for scanned results.
- Replace visible Full card terminology with Known matches / All matches verified.
- Add configurable Plex LAN/Tailscale deep links, defaulting to `http://100.112.143.89:32400`.
- Expand programme coverage from 188 to 294 real programme/event-series families.
- Map the complete 111-show NWA-TNA weekly PPV run through TVMaze show 80637.
- Add requested television, streaming, tournament and recurring-event families for DEFY, IWA-MS, Memphis, Mid-South/UWF, JCP/Mid-Atlantic, NJPW, WCPW/Defiant, MLW, AWA, PROGRESS, PWG, CZW, GCW and Georgia Championship Wrestling.

## 5.5.0 — Non-blocking actions and exact free links

- Add a shared button-task controller with spinners, progress percentages and a background operation dock.
- Replace remaining full-root renders in artwork scans, account bootstrap and sign-out flows with view/modal patches.
- Apply discovered artwork directly to visible DOM targets as each bounded batch finishes.
- Keep filters, scroll position, open detail panels and unrelated controls usable during network operations.
- Add `data/free-links.json` for record-specific direct videos, playlists and event pages.
- Reject YouTube channel homepages, search-result links and other generic landing pages as match/show links.
- Remove legacy generated YouTube search URLs from all curated recommendations.
- Add automated free-link and non-blocking UI audits to the full test suite.

## 5.4.1 — Performance and wrestler profiles

- Render the core archive before cloud, event-detail, artwork and episode background work.
- Cache the merged chronology and episode collection.
- Reduce exact-feed concurrency and throttle progress rendering.
- Limit initial Company and Wrestler directories to 24 cards.
- Keep Trakt device codes persistent through all rerenders, with countdown/copy/cancel controls.
- Add direct lazy wrestler headshot rendering through the existing artwork API.
- Add wrestler profile heroes, Top 10 matches, five-star Archive editorial ratings, programme links and full career routes.
- Add editorial star ratings to all curated recommendations.
- Redesign major interface surfaces and add rendering containment/reduced-motion support.
- Use stale-while-revalidate for release data on repeat visits.

## 5.3.0 — Trakt, Plex storage and artwork reliability

- Add required Trakt request headers and readable Cloudflare diagnostics.
- Compact Plex scans before browser/cloud storage.
- Add safe Plex export v3 and token detection.
- Proxy approved artwork sources and stop artwork-triggered cloud-sync loops.
