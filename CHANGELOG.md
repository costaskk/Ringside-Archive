# Changelog

## 5.4.0 — Performance and wrestler profiles

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
