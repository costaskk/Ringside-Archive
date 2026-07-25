# Upgrade an existing Ringside Archive repository to v5.8.0

Version 5.8.0 changes both application code and catalogue data. It also introduces a large Plex supplement and direct authenticated R2 persistence.

## Recommended upgrade: preserve your existing R2 catalogue automatically

Extract the v5.8.0 package outside your current Git repository. From the extracted package folder, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\upgrade-preserve-r2.ps1 `
  -TargetPath "R:\Files\ringside-archive-complete"
```

The script:

- preserves the target repository’s `data/artwork-catalog.json`;
- preserves `data/artwork-r2-manifest.json` when present;
- does not copy over `.env` files;
- excludes `.git`, `node_modules` and `public-artwork`;
- copies all v5.8.0 code and catalogue files;
- restores the generated R2 files;
- rebuilds `data/core.json`;
- runs `npm test`.

After it completes:

```powershell
Set-Location "R:\Files\ringside-archive-complete"
git add -A
git status
git commit -m "Upgrade Ringside Archive to v5.8.0"
git push
```

## Manual upgrade

Back up these files before copying the package over the repository:

```text
data/artwork-catalog.json
data/artwork-r2-manifest.json
.env
```

Copy the package files, restore the two generated artwork files, then run:

```powershell
npm run build:core
npm test
git add -A
git commit -m "Upgrade Ringside Archive to v5.8.0"
git push
```

## Vercel configuration

Retain all existing Supabase, Trakt and TMDB variables. To make in-app scans persist to R2, Production must have all five values:

```text
CLOUDFLARE_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
R2_ARTWORK_PUBLIC_BASE_URL
```

The R2 key should be restricted to Object Read & Write for the dedicated artwork bucket. Redeploy after adding or changing variables.

## One-time browser update

Open:

```text
https://ringside-archive.vercel.app/?v=5.8.0
```

Use `Ctrl+Shift+R` once. When an old service worker still controls the site:

1. Open DevTools → Application.
2. Unregister the old service worker.
3. Clear site data.
4. Close all site tabs and reopen the versioned URL.

Verify:

```text
Catalogue v5.8.0
104 promotions
504 programme families
1,904 dated major events
```

## Re-import Plex

Import the current version 3 JSON again so the new matcher can build the IndexedDB item index and compact cloud snapshot. The first import may take several seconds but should not reload the page.

The expected audit result for the supplied catalogue is:

```text
13,075 input rows
13,040 matched rows
29 intentionally excluded episode anomalies
6 intentionally excluded compilations/documentaries
0 unmapped event rows
```

## Security

The Plex token displayed during the earlier exporter run should be rotated. The version 3 JSON does not embed that token, but a token shown in chat or terminal history must still be treated as exposed.
