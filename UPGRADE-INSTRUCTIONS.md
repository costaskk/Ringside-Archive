# Upgrade an existing Ringside Archive repository to v5.7.0

These steps are for an existing GitHub/Vercel deployment, including the deployment shown with the older 271-programme interface.

## Important v5.7.0 behaviour changes

The 101 synthetic `Promotion Master Index` rows have been removed. They were coverage placeholders rather than real shows or dated events. Use **Companies** for promotion-level navigation, **Show Index** for real programme families, and **Complete Timeline** for exact dated records.

Background cloud, episode and artwork updates preserve the visible card and scroll offset. The service worker does not refresh an active page when a new version becomes available.

In v5.7.0, button-triggered network operations are also non-blocking. Artwork scans patch cards incrementally, long jobs expose local progress, and generic YouTube channel/search URLs are no longer accepted as match or episode links. The new exact-link catalogue is `data/free-links.json`.

The upgrade retains the strict artwork cache and adds an optional Cloudflare R2 publication pipeline. It also adds 137 recurring families derived from 850 already-dated records, so major event series are no longer hidden inside generic ROH, NJPW, ECW, NOAH, AEW, WCCW and NWA archive buckets. The NWA-TNA weekly PPVs continue to use an exact 111-episode feed.

## 1. Replace the repository files cleanly

Extract the v5.7.0 ZIP into a new temporary folder. Copy **all** contents over the local Git repository, allowing replacements.

Before committing, confirm these obsolete routes do not exist:

```text
api/trakt/device-code.js
api/trakt/device-token.js
```

Confirm this consolidated route does exist:

```text
api/trakt/device.js
```

On Windows PowerShell:

```powershell
Remove-Item .\api\trakt\device-code.js -Force -ErrorAction SilentlyContinue
Remove-Item .\api\trakt\device-token.js -Force -ErrorAction SilentlyContinue
npm run build:core
npm test
```

## 2. Commit every replacement and deletion

Use `git add -A`, not only `git add .`, so obsolete endpoint deletions are definitely recorded:

```powershell
git add -A
git status
git commit -m "Upgrade Ringside Archive to v5.7.0"
git push
```

Vercel should deploy the new commit automatically.

## 3. Verify Vercel variables

Under **Vercel → Project → Settings → Environment Variables**, configure:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
INTEGRATION_ENCRYPTION_KEY
TRAKT_CLIENT_ID
TRAKT_CLIENT_SECRET
TMDB_READ_ACCESS_TOKEN        optional
R2_ARTWORK_PUBLIC_BASE_URL    optional public CDN status/base URL
```

Do not put quotes around the Trakt ID or secret. Redeploy after changing any variable.

Open:

```text
https://YOUR-DEPLOYMENT.vercel.app/api/config
```

It must report Trakt as configured before the Connect Trakt button can succeed. The endpoint exposes booleans/diagnostics only, never the secret values.

## 4. Force the old PWA out once

Open the new deployment with:

```text
https://YOUR-DEPLOYMENT.vercel.app/?v=5.7.0
```

Then press **Ctrl+Shift+R**.

Confirm:

- the dashboard reports **431 programme families**;
- the footer says **Catalogue v5.7.0**;
- the browser no longer calls `/api/trakt/device-code`;
- the Filters panel is visible and shows active-filter reset chips;
- the initial page becomes usable before account/episode background work finishes;
- the footer reports **Catalogue v5.7.0**;
- pressing **Scan visible artwork** shows a spinner/progress dock without replacing the page;
- exact green viewing buttons open a direct video/event URL rather than a channel homepage or search page.

If the old interface is still present:

1. Open DevTools → **Application**.
2. Open **Service Workers** and select **Unregister**.
3. Open **Storage** and select **Clear site data**.
4. Close every tab for the domain and open it again.

## 5. Rotate any token exposed by an older Plex export

Before importing a Plex file, run:

```powershell
npm run audit:plex -- .\plex-library-export.json
```

If it reports `containsEmbeddedPlexToken: true`, do not use that file. Change the Plex account password with **Sign out connected devices after password change** enabled, sign trusted clients back in, delete the unsafe export, and create a new version 3 export. See `SECURITY-NOTICE.md`.

Create the replacement file with:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\export-plex-library.ps1 `
  -PlexUrl "http://127.0.0.1:32400" `
  -LibraryNames "Wrestling","Wrestling PPV"

node .\scripts\audit-plex-export.mjs .\plex-library-export.json
```

The audit must report version 3, no embedded token and at least one likely wrestling row.

## 6. Test Trakt

1. Sign into Ringside when cross-device storage is desired.
2. Open **Connections**.
3. Confirm the diagnostics say Trakt is configured.
4. Select **Connect Trakt**.
5. Complete the displayed Trakt device code.
6. Import watched history.

The device code must remain visible during background account, artwork and episode updates. It includes a countdown and Copy code control. A 403 identifies rejected/missing app credentials instead of returning an ambiguous fetch error.

## 7. Test Plex

1. Select **Sign in to Plex** and approve the PIN.
2. Select **Refresh servers**.
3. Select **Load libraries** for the desired server.
4. Check the actual wrestling TV/movie/video libraries.
5. Select **Scan selected libraries**.

A Vercel function cannot contact a private LAN-only `192.168.x.x` Plex address. Enable Plex Remote Access or Relay so a secure reachable connection appears. When that is impossible, use `tools/export-plex-library.ps1` locally and import the JSON.

## 8. Test artwork, filters and wrestlers

- Open **Companies** and select **Scan visible logos**.
- Open **Wrestlers**. Headshots should resolve progressively through the same-origin Wikipedia/Wikimedia image route without requiring a manual scan.
- Confirm the default wrestler order is Archive score, high to low.
- Open a wrestler and verify the profile hero, Top 10 match ratings, programme links and chronological appearance list.
- Open Filters, select a company/wrestler/year range and remove each selection through its chip or **Reset all**.
- Add `TMDB_READ_ACCESS_TOKEN` for richer show/season/episode/event artwork; Wikipedia/Wikimedia remain the no-key fallback.


## Optional: publish artwork through Cloudflare R2

R2 is recommended when you want the discovered posters, logos, headshots and stills to load from a stable CDN that you control. Follow `docs/CLOUDFLARE-R2-ARTWORK.md`. The short Windows command is:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\upload-artwork-r2.ps1 `
  -AccountId "YOUR_CLOUDFLARE_ACCOUNT_ID" `
  -BucketName "ringside-artwork" `
  -PublicBaseUrl "https://artwork.yourdomain.com"
```

Do not commit R2 access keys. Add only the public base URL as `R2_ARTWORK_PUBLIC_BASE_URL` in Vercel when you want it shown in integration diagnostics.

## 9. Final acceptance

```powershell
npm test
```

Expected essentials:

```text
101 promotions
431 programme families
44 mapped TVMaze feeds
1,144 major events
12 Vercel Functions
Cloud smoke passed
Integration smoke passed
Performance smoke passed
Async UI smoke passed
Free-link audit passed
Runtime smoke passed
```
