# Data coverage and accuracy

The 294 programme count excludes 101 former synthetic promotion-level master-index placeholders. Promotion navigation is handled by the Companies directory; only actual television, streaming and recurring event-series families remain in programme data.

The current catalogue contains 101 promotions, 294 programme families, 1,144 individually dated major events, 71 curated recommendations and 44 pre-mapped TVMaze feeds.

## Complete Timeline

Complete Timeline merges individually dated PPVs, supercards, tournaments, specials and exact episodes from approved feeds. Additional exact-title feeds may be discovered through the interface or `scripts/discover-tvmaze.mjs`.

A programme family without a trustworthy episode feed remains visible in Show Index, not as a fabricated sequence of weekly records. Its source, cadence and date span document the coverage while exact cards can be added later through `data/custom-records.json`.

## Historical limitations

No public database is complete for every territory, local broadcast, house show or independent event. Sources may disagree about taping dates, broadcast dates, season numbering and promotion lineage. Add verified records to `data/custom-records.json` and retain their source URLs.

## Match cards

Every recovered event has a detail record containing its known match information and parsed participants. `completeCard` remains false until the complete card is independently verified and supplied. The interface describes these as **Known matches** and uses **All matches verified** only when the flag is true.

## Reviews

Curated recommendation notes appear where they match a record. Personal ratings and reviews synchronize privately with the signed-in account. Published/editorial reviews should be added only with an appropriate source and licence.

## Artwork

Artwork can come from manual overrides, TVMaze, TMDB, Wikipedia/Wikimedia or Plex. Missing artwork means no configured source returned a reliable asset; it does not prove that no original poster existed.


## v5.6 requested-promotion expansion

The catalogue adds programme or recurring-event families for DEFY, IWA Mid-South, Memphis/CWA/USWA/Power Pro, Mid-South/UWF, Mid-Atlantic/JCP, NJPW, WCPW/Defiant, MLW, AWA, PROGRESS, PWG, CZW, modern GCW and Georgia Championship Wrestling. These are coverage indexes, not claims that every individual historic card is already present.

The NWA-TNA weekly PPV run is the major exception: TVMaze show 80637 supplies exact season/episode numbering and air dates for all 111 broadcasts from June 2002 through September 2004.
