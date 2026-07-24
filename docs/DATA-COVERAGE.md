# Data coverage and accuracy

The recovered catalogue contains:

- 101 promotions and territory lineages
- 271 programme families
- 1,144 individually dated major events
- 71 curated recommendations
- 42 programme mappings to TVMaze exact episode feeds

## Exact television episodes

Exact episodes are not invented. They are loaded from TVMaze when a mapped programme is opened or a company chronology is selected. The `scripts/sync-tvmaze.mjs` command downloads snapshots into `data/tvmaze/`, and the included GitHub Action refreshes those snapshots weekly.

Many historic wrestling programmes have incomplete or disputed episode records. A programme can remain in the index even when no trustworthy exact feed exists. The interface labels these as programme families instead of generating fictional weekly dates.

## Dates

Major-event dates are preserved from the recovered source bundle. Individual records retain a `sourceUrl` and `sourceLabel`. Some events dated after the current day may be announced future events and can contain `TBA` details.

## Corrections

Edit the JSON files directly, preserve stable IDs, and run:

```bash
node scripts/audit-data.mjs
```

For disputed dates, add a note field rather than silently replacing the source-backed value.
