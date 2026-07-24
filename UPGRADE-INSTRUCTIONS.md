# Upgrade an existing Ringside Archive repository to v5.2.0

These steps are for an existing GitHub/Vercel deployment, including the deployment shown with the older 271-programme interface.

## 1. Replace the repository files cleanly

Extract the v5.2.0 ZIP into a new temporary folder. Copy **all** contents over the local Git repository, allowing replacements.

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
npm test
```

## 2. Commit every replacement and deletion

Use `git add -A`, not only `git add .`, so obsolete endpoint deletions are definitely recorded:

```powershell
git add -A
git status
git commit -m "Upgrade Ringside Archive to v5.2.0"
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
https://YOUR-DEPLOYMENT.vercel.app/?v=5.2.0
```

Then press **Ctrl+Shift+R**.

Confirm:

- the dashboard reports **287 programme families**;
- the footer says **Catalogue v5.2.0**;
- the browser no longer calls `/api/trakt/device-code`;
- the Filters panel is visible and shows active-filter reset chips.

If the old interface is still present:

1. Open DevTools → **Application**.
2. Open **Service Workers** and select **Unregister**.
3. Open **Storage** and select **Clear site data**.
4. Close every tab for the domain and open it again.

## 5. Test Trakt

1. Sign into Ringside when cross-device storage is desired.
2. Open **Connections**.
3. Confirm the diagnostics say Trakt is configured.
4. Select **Connect Trakt**.
5. Complete the displayed Trakt device code.
6. Import watched history.

A 403 now identifies rejected/missing app credentials instead of returning an ambiguous fetch error.

## 6. Test Plex

1. Select **Sign in to Plex** and approve the PIN.
2. Select **Refresh servers**.
3. Select **Load libraries** for the desired server.
4. Check the actual wrestling TV/movie/video libraries.
5. Select **Scan selected libraries**.

A Vercel function cannot contact a private LAN-only `192.168.x.x` Plex address. Enable Plex Remote Access or Relay so a secure reachable connection appears. When that is impossible, use `tools/export-plex-library.ps1` locally and import the JSON.

## 7. Test artwork, filters and wrestlers

- Open **Companies** and select **Scan visible logos**.
- Open **Wrestlers** and select **Scan visible headshots**.
- Confirm the default wrestler order is Archive score, high to low.
- Open Filters, select a company/wrestler/year range and remove each selection through its chip or **Reset all**.
- Add `TMDB_READ_ACCESS_TOKEN` for richer show/season/episode/event artwork; Wikipedia/Wikimedia remain the no-key fallback.

## 8. Final acceptance

```powershell
npm test
```

Expected essentials:

```text
101 promotions
287 programme families
1,144 major events
12 Vercel Functions
Cloud smoke passed
Integration smoke passed
Runtime smoke passed
```
