# Ringside Archive v5.2.0

A GitHub-ready professional wrestling chronology and viewing tracker with:

- 101 promotion profiles
- 287 television, streaming, PPV, tournament and supercard programme families
- 1,144 individually dated major-event records
- exact weekly episode feeds where a dependable TVMaze mapping exists
- complete record popouts, known cards, competitors, reviews and personal ratings
- original artwork discovery for shows, seasons, episodes and individual events
- Trakt watched-history import and watched/unwatched writeback
- Plex ownership, exact episode matching, viewing-progress import and watched writeback
- Supabase email accounts and cross-device archive synchronization
- encrypted, account-linked Plex and Trakt connections that roam between devices


## v5.2.0 reliability and interface fixes

This release directly addresses the deployment/runtime failures reported from the previous Vercel build:

- **Stale PWA recovery:** application pages, modules, catalogue JSON and runtime configuration are now network-first. The service worker is versioned, updates immediately and never caches private API responses.
- **TVMaze 404 cleanup:** the browser reads `data/tvmaze/index.json` before requesting a checked-in snapshot. A missing snapshot is no longer requested; the app goes directly to the live mapped feed.
- **Trakt diagnostics:** configuration is rechecked from Vercel, both environment variables are validated, quoted/whitespace-padded values are normalized, and Trakt 403 responses now explain that the client ID/application credentials were rejected.
- **Plex library selection:** after refreshing servers, load the server's libraries, choose one or more TV/movie/video sections, then scan only those sections. Every secure direct/relay connection is tested and failures are reported separately.
- **Artwork discovery:** automatic, bounded background scanning now includes company logos, visible show/event art and wrestler headshots. TMDB is optional; Wikipedia and Wikimedia Commons are no-key fallbacks.
- **Working filters:** filters are visible by default, can be collapsed, show removable active-filter chips, and always provide **Reset all**. Company and wrestler selections can be cleared individually.
- **Faster wrestler directory:** wrestler appearances are indexed once, metrics are cached for sorting, only 50 cards render initially, headshot slots load lazily, and the default order is highest **Archive score** first.

**Archive score** uses direct source/personal ratings when available. Where no direct rating exists, it uses a transparent archive-prominence fallback based on matched appearances and curated picks; it is not represented as an external public ranking.

## Should this project use Supabase?

**Yes for the requested production setup.**

The archive can still run locally without Supabase, but Supabase is required for the features that must follow the same user across devices:

- account registration and login;
- viewing statuses, reviews, ratings, settings and artwork cache;
- the latest Plex library/view-state snapshot and short-lived signed Plex artwork links;
- the selected Plex server and Plex authorization;
- the Trakt authorization and refresh token;
- automatic restoration on another browser, computer or phone.

Use this deployment architecture:

```text
GitHub repository
      │
      ▼
Vercel static site + serverless APIs
      │
      ├── Supabase Auth + Postgres
      ├── Trakt API
      ├── Plex account/server APIs
      ├── TVMaze episode feeds
      └── TMDB/Wikipedia artwork discovery
```

GitHub Pages is intentionally not configured in this edition because it cannot run the private Vercel API routes needed for encrypted Plex/Trakt synchronization.

## What synchronizes between devices

After signing into the same Ringside account, the app synchronizes:

- Watched, Watching and Skipped states
- Per-record timestamps used for conflict merging
- Ratings and written reviews
- Filters/settings and viewing-sync preferences
- Custom TVMaze feed mappings
- Discovered artwork cache
- Trakt connection and watched synchronization
- Plex connection, known servers and selected server
- Latest Plex library scan, exact ownership matches, real view state and secure Plex artwork proxy links

Plex and Trakt tokens are **not** stored in the browser-readable archive table. Vercel encrypts them with AES-256-GCM before storing them in the server-only `integration_vault` table. Plex artwork is delivered through short-lived signed same-origin proxy URLs, so the Plex token is not exposed in image addresses on account-linked devices.

## Plex viewing synchronization

The Plex integration distinguishes ownership from viewing state:

- A programme match means the show exists in Plex.
- An exact episode match requires matching show + season + episode numbers.
- A PPV/supercard match uses title and year.
- `viewCount > 0` marks a matched record Watched.
- A non-zero `viewOffset / duration` marks it Watching.
- The watched threshold is configurable; the default is 90%.

Available switches under **Connections**:

1. **Import after each Plex scan** — imports watched/in-progress state automatically.
2. **Push Ringside watched state to Plex** — scrobbles or unscrobbles exact matches.
3. **Forward Plex-watched matches to Trakt** — submits exact records that map in both services.

A library match is never treated as watched merely because the file exists.

## Trakt synchronization

Trakt uses device authorization. When connected:

- watched show history is imported at season/episode level;
- supported event/movie records are matched by title and year;
- marking an exact episode or event Watched submits it to Trakt;
- removing Watched removes it from Trakt history;
- expired access tokens refresh automatically;
- account-linked tokens are usable from every signed-in Ringside device.

Not every historic territory episode or independent supercard has a usable Trakt record. Unmatched archive items remain tracked by Ringside and Supabase.

## Data accuracy

The project never creates fictional weekly dates. Complete Timeline contains:

- every programme-family start/index marker;
- all 1,144 recovered dated major events;
- exact episodes loaded from approved feeds;
- manually verified records in `data/custom-records.json`.

For programmes with no dependable episode database, the show remains indexed but is not expanded into invented episodes. See `docs/DATA-COVERAGE.md`.

## Added programme families in v5.2.0

The recovery catalogue was expanded with important missing lineages and programmes, including:

- Georgia Championship Wrestling / World Championship Wrestling on TBS
- NWA World Championship Wrestling
- WCW Main Event
- NWA/WCW Power Hour
- WCW Worldwide
- WCW Pro
- WWF Mania
- WWF Action Zone
- WWF LiveWire
- WWE Confidential
- WWE Bottom Line
- WWE Afterburn
- WWE Experience
- WWE NXT Level Up
- WWE Speed
- WWE Evolve

These are programme families. Exact episode rows are only generated where a verified feed or custom sourced record exists.

---

# Deployment: GitHub + Vercel + Supabase

Upgrading an existing repository or a deployment that still shows 271 programme families: follow [`UPGRADE-INSTRUCTIONS.md`](UPGRADE-INSTRUCTIONS.md) before the general steps below.

## 1. Requirements

- Git
- GitHub account
- Vercel account
- Supabase project
- Node.js 22 or newer for tests and maintenance scripts
- Optional Trakt API application
- Optional TMDB read-access token

No frontend package installation or build step is required. The site uses browser-native ES modules.

## 2. Test the downloaded project

From the extracted project folder:

```powershell
node --version
npm test
```

The test suite validates the data catalogue, required files, encryption round-trip, Supabase RLS schema, current/legacy Supabase key handling and a browser rendering smoke test.

For a static local preview without server integrations:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\start-local.ps1
```

For local testing of Vercel API routes, install the Vercel CLI and use:

```powershell
npm install --global vercel
vercel dev
```

## 3. Create the GitHub repository

Create a new **empty** repository on GitHub. Do not add a README or licence during repository creation because both already exist here.

Open PowerShell in the project folder:

```powershell
git init
git add .
git commit -m "Initial Ringside Archive v5.2.0 release"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/ringside-archive.git
git push -u origin main
```

Future updates:

```powershell
git add .
git commit -m "Describe the update"
git push
```

`.gitignore` prevents normal local secret files from being committed. Never place real tokens in `.env.example`, `runtime-config.js`, source files or GitHub commits.

## 4. Create and configure Supabase

1. Create a Supabase project.
2. Open **SQL Editor**.
3. Paste and run the complete contents of:

```text
supabase/schema.sql
```

The script creates:

- `archive_state` — user-owned JSON state protected by Row Level Security;
- `integration_vault` — server-only encrypted Plex/Trakt data with no browser grants.

4. Open **Authentication → Providers → Email** and enable email/password authentication.
5. Open **Authentication → URL Configuration**.
6. Set **Site URL** to your final Vercel production URL.
7. Add the production URL and local Vercel development URL to **Redirect URLs**, for example:

```text
https://your-project.vercel.app
https://your-project.vercel.app/**
http://localhost:3000/**
```

8. For production account emails, configure your own SMTP provider under Supabase Auth settings.

From **Project Settings / Connect / API Keys**, collect:

- Project URL
- Publishable key (`sb_publishable_...`), or legacy `anon`
- Secret key (`sb_secret_...`), or legacy `service_role`

The publishable key is expected in browser configuration. The secret key must only exist in Vercel environment variables.

## 5. Generate the integration encryption key

Run once:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Copy the output into a password manager. This becomes `INTEGRATION_ENCRYPTION_KEY`.

**Do not casually change or lose this key.** Existing encrypted Plex and Trakt connections cannot be decrypted after the key changes. If it is lost, delete the affected `integration_vault` rows and reconnect both services.

## 6. Create a Trakt API application

This is required only for Trakt synchronization.

1. Create an API application in your Trakt account settings.
2. Use your Vercel production URL as the application website.
3. Copy the client ID and client secret.
4. Store them in Vercel as `TRAKT_CLIENT_ID` and `TRAKT_CLIENT_SECRET`.
5. Do not wrap either value in quotes and remove accidental leading/trailing spaces.
6. Apply the variables to **Production** and redeploy.

After deployment, open `/api/config` on your site. It must report `"traktConfigured": true`. The browser never receives the Trakt client secret; `/api/config` exposes booleans only.

A 403 from `/api/trakt/device` means Trakt rejected the client ID/application credentials. It does **not** mean that the Ringside user must be signed in: Trakt can be connected locally while signed out, or stored in the encrypted account vault while signed in.

## 7. Import the GitHub repository into Vercel

1. In Vercel, choose **Add New → Project**.
2. Import the GitHub repository.
3. Framework preset: **Other**.
4. Build command: leave empty.
5. Output directory: leave empty/root.
6. Add the following Environment Variables for Production, Preview and Development as appropriate:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
INTEGRATION_ENCRYPTION_KEY
TRAKT_CLIENT_ID
TRAKT_CLIENT_SECRET
TMDB_READ_ACCESS_TOKEN        # optional
```

A legacy Supabase server key may instead use:

```text
SUPABASE_SERVICE_ROLE_KEY
```

7. Deploy.
8. Put the final Vercel URL into Supabase Auth URL Configuration.
9. Redeploy once after changing environment variables or URL configuration.

## 8. First-use order

Use this order so the integrations become account-linked rather than device-local:

1. Open the deployed Ringside Archive.
2. Select **Account**.
3. Create an account and confirm the email if required.
4. Sign in.
5. Open **Connections**.
6. Connect Trakt.
7. Connect Plex.
8. Refresh Plex servers and scan the desired server.
9. Enable the viewing-sync switches you want.
10. Select **Sync now** under Account.

On another device, sign into the same Ringside account. The archive state, integration status and latest Plex snapshot will restore automatically.

---

# Plex setup and limitations

## Direct remote scan

The Vercel function can scan a Plex Media Server that advertises a remotely reachable HTTPS `plex.direct` or Plex relay connection.

After Plex login:

1. **Connections → Refresh servers**
2. Select **Load libraries** beside the intended server
3. Tick the wrestling TV/movie/video library section or sections
4. Select **Scan selected libraries**
5. Select **Import Plex viewing** or enable automatic import

A serverless Vercel deployment is outside your home network. Plex Remote Access or Plex Relay must provide a reachable secure HTTPS connection. Version 5.2 tests all advertised secure direct/relay connections and returns per-connection diagnostics instead of a generic `fetch failed` message.

## LAN-only server fallback

When the server cannot be reached securely by Vercel, export locally:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\export-plex-library.ps1 -PlexUrl "http://127.0.0.1:32400"
```

Import the generated JSON using:

```text
Connections → Import local export
```

When signed into Ringside, the imported snapshot is copied into the encrypted account integration record and becomes available to other devices. A local export alone cannot perform remote Plex scrobble/unscrobble; direct Plex authorization is needed for writeback.

## Matching expectations

Plex libraries vary widely. Best results use conventional naming:

```text
Show Name - S01E01 - Episode Title
Event Name (2024)
```

The app intentionally favors exact season/episode matches over broad title guesses to avoid marking the wrong records as owned or watched.

---

# Artwork

Artwork resolution order:

1. `data/artwork-overrides.json`
2. TVMaze show and episode images
3. `data/artwork-catalog.json`
4. TMDB show/season/episode/event results
5. Wikipedia lead images and Wikimedia Commons search
6. Company logo fallback for records from that promotion
7. Plex artwork available to the current device
8. Labelled fallback artwork

The Companies page scans visible promotions for logos. The Wrestlers page scans visible names for headshots. Timeline pages scan both the visible record and its company, so a promotion logo can appear while a unique event poster is still unavailable. Results are cached locally and, when signed in, follow the account to other devices.

Set `TMDB_READ_ACCESS_TOKEN` for better show, season and episode results. The included GitHub workflow can update `data/artwork-catalog.json`:

```text
GitHub → Actions → Refresh artwork catalogue → Run workflow
```

Artwork search results should be reviewed. A Wikimedia lead image is not automatically an original event poster. See `docs/ARTWORK.md`.

---

# Episode feed maintenance

Approved TVMaze mappings can be downloaded into `data/tvmaze/`:

```powershell
npm run sync:tvmaze
```

The included workflow runs weekly:

```text
.github/workflows/update-tvmaze.yml
```

The live app also attempts to load mapped feeds directly. If both the snapshot and the live API are unavailable, programme indexes remain visible instead of being replaced by fabricated dates.

Useful maintenance commands:

```powershell
npm test
npm run audit
npm run discover:tvmaze
npm run sync:tvmaze
npm run scan:artwork
npm run enrich:events
npm run check:links
```

---

# Troubleshooting a previous deployment

## The page still shows 271 programme families or calls `/api/trakt/device-code`

That is the older application being served by its service-worker cache. Version 5.2 contains 287 programme families and uses only `/api/trakt/device`.

After deploying the new commit:

1. Open `https://YOUR-SITE.vercel.app/?v=5.2.0` once.
2. Press **Ctrl+Shift+R**.
3. If the old interface remains, open DevTools → **Application** → **Service Workers** → **Unregister**.
4. Under **Storage**, select **Clear site data**.
5. Reload the normal site URL.

The v5.2 service worker then handles later upgrades automatically.

## TVMaze snapshot 404 messages

Version 5.2 includes `data/tvmaze/index.json`. Only files listed in that manifest are requested. Run `npm run sync:tvmaze` or the GitHub workflow to populate snapshots; otherwise mapped feeds are loaded live without first generating a local 404.

## Trakt says not configured

Confirm all of the following in Vercel:

```text
TRAKT_CLIENT_ID
TRAKT_CLIENT_SECRET
```

Redeploy after adding/changing them, then use **Connections → Recheck configuration**. `/api/config` should show `traktConfigured: true`.

## Plex returns 502

Open **Connections**, refresh servers, load libraries, and scan a selected section. The returned error now lists each attempted connection. If all fail, enable Plex Remote Access/Relay or use `tools/export-plex-library.ps1` and **Import local export**.

## Artwork remains empty

- Open Companies or Wrestlers and allow the automatic scanner a few seconds.
- Use **Connections → Scan visible records**.
- Add `TMDB_READ_ACCESS_TOKEN` for richer season/episode/event art.
- Check that the Vercel function `/api/artwork/search` is deployed.
- A clearly labelled fallback means no trustworthy match was found; it is not an application crash.

---

# Security notes

- `SUPABASE_PUBLISHABLE_KEY` is public by design and is limited by RLS.
- `SUPABASE_SECRET_KEY`, `INTEGRATION_ENCRYPTION_KEY`, `TRAKT_CLIENT_SECRET` and Plex/Trakt user tokens must never be committed.
- The backend supports both current `sb_secret_...` Supabase keys and legacy JWT `service_role` keys.
- Private `/api/` responses are never written to the PWA service-worker cache.
- The integration vault is encrypted before database storage.
- Tokens are removed from local browser state after successful migration into account storage.
- Account state uses per-record timestamps to merge edits from multiple devices.
- Local caches are tagged to the owning Ringside user; signing into a different account clears the previous account cache before restoring the new account.
- Exported local backup files may contain personal viewing information; keep them private.

## Removing an integration

Use **Connections → Disconnect**. This deletes the account’s encrypted provider row and clears the local device copy.

## Deleting an account

Delete the user through Supabase Authentication administration. Both archive and integration rows reference `auth.users` with `ON DELETE CASCADE` and are removed with the account.

---

# Project structure

```text
api/                         Vercel serverless APIs
  account/                   encrypted integration account endpoints
  plex/                      PIN auth, servers, library, view-state writeback
  trakt/                     device auth, history, refresh and sync
  artwork/                   TMDB/Wikipedia artwork search
  _lib/                      auth, encryption and provider helpers
data/                        promotions, programmes, events and artwork data
docs/                        coverage, artwork and source guidance
scripts/                     audit, feed, artwork and smoke-test scripts
src/                         browser application
supabase/schema.sql          Auth-linked state and encrypted vault schema
tools/                       local server and Plex export tools
vercel.json                  deployment and security headers
```

## Licence

The software licence does not grant rights to third-party wrestling artwork, logos, photography, video or metadata. Copyright remains with the respective owners and sources.
