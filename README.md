# Ringside Archive v5.8.0

Ringside Archive is a local-first professional-wrestling chronology covering television, weekly episodes, pay-per-views, premium live events, supercards and historically significant matches. It combines a curated catalogue with optional Supabase accounts, Trakt viewing synchronization, Plex ownership/progress matching and Cloudflare R2 artwork persistence.

## v5.8.0 highlights

### Owner-library catalogue ingestion

The project was audited against a version 3 Plex export containing **13,075 records** from the owner’s `Wrestling` and `Wrestling PPV` libraries.

- **13,040 records matched** through external IDs, exact dates, programme mappings and promotion-scoped title logic.
- **6,572 exact episode records** were added as a deferred supplement.
- **760 dated PPVs, supercards and specials** missing from the earlier catalogue were added.
- **69 Plex show-title mappings** now handle exact programmes and historical date ranges.
- **29 bad episode rows** and **6 compilations/documentaries** were intentionally excluded rather than inserted as false chronology entries.

The machine-readable results are in [`data/plex-import-report.json`](data/plex-import-report.json), with a detailed explanation in [`docs/PLEX-CATALOGUE-IMPORT.md`](docs/PLEX-CATALOGUE-IMPORT.md).

### Correct NWA, JCP and WCW attribution

Programme identity now follows the actual date and lineage instead of treating every related show as one company.

- `World Wide Wrestling` and the TBS `World Championship Wrestling` lineage split between Jim Crockett Promotions and WCW at the 1988 ownership change.
- `WCW Pro` and `WCW Main Event` use date-ranged JCP/WCW mappings.
- Historic Georgia Championship Wrestling material is separated from modern Game Changer Wrestling.
- WWE ECW is not merged into original ECW.
- NWA-TNA weekly PPVs remain within TNA’s 2002–2004 chronology.

Current catalogue totals:

```text
104 promotions
504 programme and recurring-event families
1,904 dated major events
6,572 deferred exact Plex-derived episodes
71 curated recommendations
110 wrestler profiles
12 Vercel Functions
```

### Deterministic Plex import

Plex matching now prioritizes:

1. IMDb, TMDB and TVDB IDs.
2. Exact original date and normalized title.
3. Explicit programme/date mappings.
4. Season and episode numbers.
5. Promotion-scoped conservative title matching.

The full matched item index is stored in IndexedDB. Only a compact subset is retained in `localStorage` and the encrypted cloud vault, preventing browser quota failures while preserving ownership, progress and exact Plex links.

Matched items open through the configurable LAN/Tailscale Plex address, defaulting to:

```text
http://100.112.143.89:32400
```

### Clickable artwork and image lightbox

All supported content images—including posters, episode stills, company logos, wrestler headshots and artwork galleries—are keyboard-accessible and open in a responsive modal. The modal provides the full image, original file link and source/attribution link when available.

### Non-disruptive card actions

Artwork scans and other asynchronous card operations update only the affected button, task status and image element. They do not replace the root document, reload the page or move the reader back to the top. Existing filters, open panels and scroll position remain intact.

### Runtime R2 persistence

When the five Cloudflare R2 variables are configured and the user is signed into a Ringside account, newly accepted artwork scans are fetched server-side, uploaded to R2 using AWS Signature V4, and returned as immutable content-hashed R2 URLs.

Signed-out users can still scan artwork, but those discoveries stay in local cache until an authenticated scan is performed. Anonymous callers never receive R2 write access.

## Core views

- **Complete Timeline** — individually dated episodes, PPVs, supercards and specials.
- **Show Index** — programme families and recurring event series.
- **Companies** — promotion-level browsing with historically accurate programme ownership.
- **Wrestlers** — rating-led profiles, headshots, top ten indexed matches and links to appearances.
- **Recommendations** — curated matches and career routes.
- **My Library** — watched, watching, skipped and Plex-owned records.

## Requirements

- Node.js 22.x
- Vercel for the API routes
- Supabase for accounts and encrypted roaming state
- Optional Trakt API application
- Optional TMDB Read Access Token
- Optional Cloudflare R2 bucket for durable artwork
- Optional Plex Media Server

## Local validation

```powershell
npm run build:core
npm test
```

The test suite validates data references, free-link specificity, the 12-function Vercel limit, async UI behavior, Trakt headers, Supabase encryption/RLS, R2 persistence, Plex catalogue matching, browser-storage compaction and runtime rendering.

## Deployment

### 1. Supabase

Run [`supabase/schema.sql`](supabase/schema.sql) in the project’s Supabase SQL editor.

### 2. Vercel environment variables

Required for accounts and encrypted integrations:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
INTEGRATION_ENCRYPTION_KEY
```

For Trakt:

```text
TRAKT_CLIENT_ID
TRAKT_CLIENT_SECRET
```

For richer artwork discovery:

```text
TMDB_READ_ACCESS_TOKEN
```

For authenticated runtime R2 persistence:

```text
CLOUDFLARE_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
R2_ARTWORK_PUBLIC_BASE_URL
```

`R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` are server-only secrets. Restrict them to Object Read & Write on the dedicated artwork bucket. Prefer a custom R2 domain over the rate-limited `r2.dev` development URL.

### 3. Deploy

```powershell
npm run build:core
npm test
git add -A
git commit -m "Upgrade Ringside Archive to v5.8.0"
git push
```

Open the deployment once with:

```text
https://ringside-archive.vercel.app/?v=5.8.0
```

The footer should display `Catalogue v5.8.0`.

## Safely upgrading an existing R2-enabled repository

Do not manually overwrite a populated `data/artwork-catalog.json` or `data/artwork-r2-manifest.json` with the empty package defaults.

From the extracted v5.8.0 folder, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\upgrade-preserve-r2.ps1 `
  -TargetPath "R:\Files\ringside-archive-complete"
```

The script backs up and restores the existing generated R2 catalogue/manifest, leaves `.env` untouched, copies the application update, rebuilds `data/core.json` and runs the full test suite.

See [`UPGRADE-INSTRUCTIONS.md`](UPGRADE-INSTRUCTIONS.md).

## Plex export and import

Create a safe version 3 export on the Plex server computer:

```powershell
& ".\tools\export-plex-library.ps1" `
  -PlexUrl "http://127.0.0.1:32400" `
  -LibraryNames @("Wrestling", "Wrestling PPV") `
  -Output ".\plex-library-export.json"
```

Audit it:

```powershell
npm run audit:plex -- ".\plex-library-export.json"
```

The export must report `containsEmbeddedPlexToken: false`. Never commit a private Plex export.

## Artwork workflows

### Repository catalogue publication

The existing CLI workflow scans accepted artwork, downloads it locally, publishes content-hashed objects to R2 and rewrites the repository catalogue:

```powershell
npm run scan:artwork

powershell -ExecutionPolicy Bypass -File .\tools\upload-artwork-r2.ps1 `
  -AccountId "YOUR_ACCOUNT_ID" `
  -BucketName "ringside-artwork" `
  -PublicBaseUrl "https://artwork.example.com"
```

### In-app scan

The in-app scan uses `/api/artwork/search`. With a signed-in Ringside account and complete R2 configuration, an accepted image is persisted directly to R2 without a page reload. The user’s account state stores the accepted R2 URL; it does not write a Git commit from the browser.

## Trakt

Trakt uses the device authorization flow through `/api/trakt/device`. The activation code remains visible during background updates and polling. All API requests include the required Trakt version, client-key and identifying user-agent headers.

## Security

- Plex and Trakt user tokens are encrypted server-side using AES-256-GCM.
- R2 write credentials never reach the browser.
- Raw `X-Plex-Token` image URLs are rejected from imports and stripped from persistence.
- The owner-supplied export used to build the neutral supplement is not included in the package.
- The committed Plex supplement contains no rating keys, token, watch history or server URL.

The Plex token displayed earlier during development should be rotated. See [`SECURITY-NOTICE.md`](SECURITY-NOTICE.md).

## Project structure

```text
api/                       Vercel account, artwork, Plex and Trakt routes
data/                      catalogue, Plex mappings and audit reports
docs/                      R2 and Plex-import documentation
scripts/                   validation, catalogue and artwork tools
src/                       application modules and styles
supabase/                  schema and RLS policies
tools/                     Plex exporter, R2 publisher and safe upgrade script
```

## Data provenance

The catalogue combines recovered project data, source URLs stored with dated events, verified TVMaze feeds, external IDs supplied by Plex metadata and conservative owner-library mappings. Plex metadata is treated as evidence, not unquestioned truth: impossible dates and compilation releases are explicitly excluded rather than converted into fake episodes or events.
