# Reconstruction audit

## Recovered from the supplied production files

- Complete promotion catalogue
- Complete programme-family catalogue
- Complete 1,144-record major-event JSON payload
- Curated recommendation and wrestler lists
- Original compiled client and stylesheet
- Existing TVMaze mappings, official URLs and YouTube links

## Integrity checks completed

- No duplicate promotion, programme, event or recommendation IDs
- Every programme points to a valid promotion
- Every major event points to a valid promotion and programme
- All major-event dates use `YYYY-MM-DD`
- Required deployment and data files are present and valid JSON where applicable
- No Trakt secret or private token is included in the ZIP

## Intentional accuracy decisions

- The six announced future events containing `TBA` are preserved and reported as audit warnings rather than deleted.
- Exact weekly episode dates are loaded only from mapped feeds or custom verified records.
- No synthetic weekly episodes are generated from programme start/end dates.
- No AI-created image is labelled as original artwork.
- Supabase is not enabled by default because local-first storage is complete and safer for a single-owner archive.

## Test commands

```bash
node --check src/app.js
node scripts/audit-data.mjs
node scripts/smoke-test.mjs
```

All three checks passed when the project ZIP was created.
