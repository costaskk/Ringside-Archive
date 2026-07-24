# Data coverage and accuracy

The current catalogue contains 101 promotions, 287 programme families, 1,144 individually dated major events, 71 curated recommendations and 42 pre-mapped TVMaze feeds.

## Complete Timeline

The timeline contains a dated start/index marker for every programme family. It automatically loads approved exact feeds and merges individual episodes with PPVs, supercards and tournaments. Additional exact-title feeds may be discovered through the interface or `scripts/discover-tvmaze.mjs`.

A programme family without a trustworthy episode feed remains visible in Complete Timeline and Show Index as an archive marker. It is not expanded into fictional weekly dates.

## Historical limitations

No public database is complete for every territory, local broadcast, house show or independent event. Sources may disagree about taping dates, broadcast dates, season numbering and promotion lineage. Add verified records to `data/custom-records.json` and retain their source URLs.

## Match cards

Every recovered event has a detail record containing its known match information and parsed participants. `completeCard` remains false until the complete card is independently verified and supplied. The UI labels incomplete records accordingly.

## Reviews

Curated recommendation notes appear where they match a record. Personal ratings and reviews synchronize privately with the signed-in account. Published/editorial reviews should be added only with an appropriate source and licence.

## Artwork

Artwork can come from manual overrides, TVMaze, TMDB, Wikipedia/Wikimedia or Plex. Missing artwork means no configured source returned a reliable asset; it does not prove that no original poster existed.
