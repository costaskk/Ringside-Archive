# Ringside Archive — reconstructed complete project

A local-first professional wrestling chronology and watch tracker recovered from the published Ringside Archive application bundle and rebuilt as a maintainable, dependency-free web project.

## Included catalogue

- 101 promotions and territory lineages
- 271 weekly-show, studio, streaming, tournament, PPV and supercard programme families
- 1,144 exact dated major events
- 71 curated match/event/episode recommendations
- 110 wrestler career filters
- 42 mapped TVMaze programme feeds for exact episode dates, titles and available original artwork

The original compiled application is preserved under `legacy-original/` for reference and comparison.

## What was improved

- Recovered the embedded catalogue into readable JSON files.
- Removed the hosted-site dependency and made the default project static and portable.
- Added exact TVMaze episode loading and local snapshots.
- Added a weekly GitHub Action to refresh episode snapshots.
- Added local watched/watching/skipped progress with complete JSON backup and restore.
- Added Plex library import through a safe local export tool.
- Added optional Trakt device authorization through Vercel Functions.
- Added PWA/offline caching, responsive navigation and deployment security headers.
- Added data auditing and link-checking scripts.
- Added explicit artwork provenance rules so fallbacks are never presented as original posters.

## Run locally on Windows

### Easiest method

Double-click:

```text
tools\start-local.bat
```

The site opens at `http://127.0.0.1:4173`.

Python must be installed. Do not open `index.html` directly with `file://`, because browsers block JSON module requests from local files.

### Command line

```powershell
cd ringside-archive-complete
python -m http.server 4173
```

Then open `http://127.0.0.1:4173`.

## Validate the recovered database

Node.js 22 or newer is required only for maintenance scripts:

```powershell
node scripts/audit-data.mjs
```

Expected core counts:

```text
101 promotions
271 programmes
1,144 major events
71 recommendations
```

## Download every mapped TVMaze episode

```powershell
node scripts/sync-tvmaze.mjs
```

This creates one snapshot per mapped programme under `data/tvmaze/`. The website uses a snapshot when available and otherwise requests the live TVMaze API.

The GitHub workflow `.github/workflows/update-tvmaze.yml` runs this automatically every Monday and commits changed snapshots.

## Upload to GitHub

Create an empty repository, extract this ZIP, and run inside the extracted folder:

```powershell
git init
git add .
git commit -m "Initial Ringside Archive release"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/ringside-archive.git
git push -u origin main
```

Do not create the GitHub repository with a README when using the commands above, or pull/merge the initial GitHub commit first.

### Optional GitHub Pages

The included `pages.yml` workflow can publish the same project directly from GitHub. In the repository:

1. Open **Settings → Pages**.
2. Set **Source** to **GitHub Actions**.
3. Run the **Deploy GitHub Pages** workflow, or push to `main`.

## Deploy to Vercel

1. Push the folder to GitHub.
2. In Vercel, choose **Add New → Project**.
3. Import the GitHub repository.
4. Leave **Framework Preset** as **Other**.
5. Leave the build command empty.
6. Leave the output directory empty or set it to `.` if Vercel requests one.
7. Deploy.

Every push to the connected GitHub repository creates a new deployment and preview branches are supported automatically.

## Optional Trakt connection on Vercel

The archive works without Trakt. To enable device authorization:

1. Create a Trakt API application.
2. In the Vercel project, open **Settings → Environment Variables**.
3. Add:

```text
TRAKT_CLIENT_ID
TRAKT_CLIENT_SECRET
```

4. Redeploy.
5. Open **Connections → Connect Trakt** in Ringside Archive.

The browser stores the returned access token locally. The serverless functions use the secret only during device authorization; the secret is never bundled into the public frontend.

## Plex availability

A cloud deployment cannot normally reach a Plex server restricted to your home network. Export your Plex titles locally:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\export-plex-library.ps1 -PlexUrl "http://127.0.0.1:32400"
```

Enter your Plex token when asked. In Ringside Archive, open **Connections → Import Plex export** and select `plex-library-export.json`.

## Supabase

Supabase is **not needed** for this version. Progress uses local storage and can be backed up from **My Library**. See `docs/SUPABASE-OPTIONAL.md` before adding account-based cloud sync.

## Editing data

- `data/promotions.json`: company and territory information
- `data/programmes.json`: weekly shows, event series and programme families
- `data/major-events.json`: individually dated events
- `data/recommendations.json`: curated routes
- `data/artwork-overrides.json`: verified event/programme artwork
- `data/custom-records.json`: exact episodes/events imported from additional verified sources

Run the audit after every data edit.

## Artwork and attribution

Programme and episode artwork is loaded from TVMaze where provided. Major-event artwork must be supplied through a verified override; otherwise the interface displays a labelled fallback. See `docs/ARTWORK.md`.

TVMaze-derived data is subject to TVMaze's CC BY-SA terms. Event facts retain their source links. Wrestling names, logos, posters and footage belong to their respective rights holders.

## Project structure

```text
api/trakt/                 Optional Vercel Trakt functions
data/                      Recovered readable catalogue
legacy-original/           Original compiled site backup
scripts/                    Audit and update tools
src/                        Maintainable frontend source
.github/workflows/          Episode refresh and Pages deployment
vercel.json                 Vercel settings and security headers
```
