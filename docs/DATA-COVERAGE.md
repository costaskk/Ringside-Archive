# Data coverage and accuracy

The current catalogue contains:

```text
104 promotions
504 real programme and recurring-event families
1,904 individually dated major events
6,572 deferred exact Plex-derived episodes
71 curated recommendations
44 pre-mapped TVMaze feeds
```

Synthetic promotion-level master-index placeholders are not counted. Promotion navigation belongs in **Companies**; actual television, streaming and recurring event series belong in **Show Index**.

## Complete Timeline

Complete Timeline merges individually dated PPVs, supercards, tournaments, specials and exact episodes from approved TVMaze feeds and the privacy-reduced Plex supplement.

A programme family without a trustworthy episode feed remains in Show Index. The application does not manufacture weekly dates from a promotion’s founding year or a series date range.

## Plex catalogue supplement

The owner-library audit added 6,572 exact episode records and 760 dated events. The supplement contains only neutral chronology fields and does not retain Plex rating keys, tokens, server addresses or viewing history.

The matching and exclusion report is stored in `data/plex-import-report.json`. Known impossible dates and compilation releases remain excluded rather than being presented as real broadcasts or supercards.

## Promotion lineage

Shows that changed ownership are assigned by date. JCP, WCW and NWA therefore have separate, populated programme histories. Georgia Championship Wrestling is distinct from modern Game Changer Wrestling, and WWE ECW is distinct from original ECW.

See `docs/PLEX-CATALOGUE-IMPORT.md` for the exact lineage rules.

## Historical limitations

No public database is complete for every territory, local broadcast, house show or independent event. Sources may disagree about taping dates, broadcast dates, season numbering and promotion lineage. New records should retain source URLs and should not be promoted to exact chronology without defensible date evidence.

## Match cards

Every recovered event has a detail record containing known match information and parsed participants. `completeCard` remains false until the whole card is independently verified. The interface displays **Known matches** and uses **All matches verified** only for genuinely complete records.

## Reviews

Curated recommendation notes appear where they match a record. Personal ratings and reviews synchronize privately with the signed-in account. Published editorial reviews should be added only with an appropriate source and licence.

## Artwork

Artwork can come from manual overrides, TVMaze, TMDB, Wikipedia/Wikimedia, Plex or Cloudflare R2. A missing image means no configured source passed the strict confidence checks; it does not prove that no original poster existed.

The v5.7 recurring-series audit remains available in `data/series-coverage-audit.json`: it added 137 real recurring series and reassigned 850 already-dated records from generic archive buckets.
