# Ringside Archive v5.1.1 reconstruction and upgrade audit

## Recovered foundation

- 101-promotion catalogue
- 271 original programme families
- 1,144 dated major-event records
- recommendations and wrestler lists
- original compiled client and stylesheet
- TVMaze mappings, official URLs and YouTube links

## Catalogue expansion

- 16 important programme families added
- 287 total programme families
- JCP/Georgia/WCW cable lineages expanded
- WWF/WWE secondary and modern digital programmes expanded
- no invented episode dates

## Interface and archive features

- full event, episode and programme popouts
- known card, competitors, sourced details and completeness labels
- personal reviews and ratings
- working promotion, wrestler, year-range, Plex, YouTube and artwork filters
- unified Complete Timeline with programme markers, exact episodes and events
- layered show/season/episode/event artwork discovery

## Trakt

- device authorization
- exact episode and supported-event history import
- watched/unwatched writeback
- automatic access-token refresh
- encrypted account-linked tokens available across devices

## Plex

- PIN authentication
- server discovery and remote scan
- exact show/season/episode and event matching
- real `viewCount` / `viewOffset` import
- Watched/Watching mapping with configurable threshold
- exact scrobble/unscrobble writeback
- optional Plex-watched forwarding to Trakt
- encrypted connection and latest scan available across devices
- LAN-only JSON export fallback

## Supabase accounts

- email/password registration, confirmation session and sign-in
- password-reset completion flow
- RLS-protected account state
- AES-256-GCM encrypted server-only integration vault
- automatic current `sb_secret_` and legacy `service_role` key handling
- per-record conflict merge and automatic synchronization
- shared-browser account ownership guard
- provider tokens removed from local state after cloud migration

## Security safeguards

- no browser grants on integration vault
- secrets excluded from source control
- current Supabase opaque secret keys never sent as JWTs
- private `/api/` responses excluded from service-worker caching
- no AI image labelled as original
- no incomplete match list labelled complete

## Validation

```powershell
npm test
```

The suite audits references and IDs, validates required files and JSON, tests encryption round-trip and cloud schema, and performs a browser rendering smoke test.

## Vercel Hobby deployment correction (v5.1.1)

The v5.1 package exposed 13 serverless route entrypoints, one above the Vercel Hobby limit of 12. The two Trakt device-flow endpoints were consolidated into `api/trakt/device.js`, reducing the deployment to exactly 12 functions without removing functionality. The smoke test now counts deployable API routes and fails locally if the Hobby limit is exceeded again.
