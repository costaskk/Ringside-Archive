# Adding exact records from other sources

TVMaze does not cover every historic territory, local broadcast or independent series. Add verified records to `data/custom-records.json` using the same structure as `data/major-events.json`:

```json
[
  {
    "id": "memphis-1982-01-02-tv",
    "itemKey": "episode:memphis-tv:1982-01-02",
    "promotionId": "memphis",
    "programId": "memphis-tv",
    "title": "Memphis Wrestling — January 2, 1982",
    "date": "1982-01-02",
    "kind": "episode",
    "description": "Verified episode summary.",
    "artwork": "./artwork/memphis-1982-01-02.jpg",
    "sourceUrl": "https://example.org/verified-record",
    "sourceLabel": "Archive source"
  }
]
```

Rules:

- Use the original air date when known and label a taping date explicitly if that is all the source provides.
- Never generate a weekly sequence from a programme start/end date.
- Keep `id` and `itemKey` stable after publication so viewing progress continues to match.
- Use only artwork you can legally link or redistribute.
- Run `node scripts/audit-data.mjs` after editing.
