# Host Ringside artwork on Cloudflare R2

Cloudflare R2 is a practical fit for durable posters, logos, headshots and episode stills. The project supports both batch repository publication and authenticated runtime uploads.

## Architecture

### Batch publication

- `data/artwork-catalog.json` retains attribution, confidence and original source pages.
- `scripts/cache-artwork-assets.mjs` downloads images accepted by the strict matcher.
- `public-artwork/` is a temporary ignored staging directory.
- `tools/upload-artwork-r2.ps1` uploads content-hashed objects with immutable cache headers.
- `data/artwork-r2-manifest.json` records published objects.

### Runtime persistence

`/api/artwork/search` can upload a newly accepted image directly to R2. It uses AWS Signature V4 server-side and writes paths shaped like:

```text
runtime/<kind>/<record-key>/<content-hash>.<extension>
```

Runtime writes require a signed-in Ringside account. Public anonymous artwork search remains read-only.

## 1. Create the bucket

1. Open **Cloudflare → R2 Object Storage**.
2. Create `ringside-artwork`.
3. Leave placement on Automatic or choose the Eastern Europe hint for primarily Greek/European usage.

## 2. Attach a custom domain

Use a Cloudflare-managed domain such as:

```text
https://artwork.example.com
```

The public `r2.dev` URL is suitable for testing but is rate-limited. After the custom domain becomes active, use it as `R2_ARTWORK_PUBLIC_BASE_URL` and disable the development URL.

## 3. Cache behavior

Create a Cache Rule for the artwork hostname and mark it eligible for cache. The project uploads objects with:

```text
Cache-Control: public,max-age=31536000,immutable
```

Object keys include a content hash, so a changed image receives a new URL.

## 4. Create bucket-scoped credentials

Create an R2 S3 token with **Object Read & Write** limited to `ringside-artwork`. Save:

- Cloudflare Account ID
- Access Key ID
- Secret Access Key

Never commit these values.

## 5. Configure Vercel runtime persistence

Add all five Production environment variables:

```text
CLOUDFLARE_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME=ringside-artwork
R2_ARTWORK_PUBLIC_BASE_URL=https://artwork.example.com
```

Redeploy. In-app scans now persist accepted images when the user is signed into Ringside.

## 6. Install AWS CLI for batch publication

Verify on Windows:

```powershell
aws --version
```

Set temporary credentials in the current PowerShell window:

```powershell
$env:AWS_ACCESS_KEY_ID="YOUR_R2_ACCESS_KEY_ID"
$env:AWS_SECRET_ACCESS_KEY="YOUR_R2_SECRET_ACCESS_KEY"
$env:AWS_DEFAULT_REGION="auto"
```

## 7. Scan and publish repository artwork

```powershell
$env:TMDB_READ_ACCESS_TOKEN="YOUR_TMDB_READ_ACCESS_TOKEN"
npm run scan:artwork

powershell -ExecutionPolicy Bypass -File .\tools\upload-artwork-r2.ps1 `
  -AccountId "YOUR_CLOUDFLARE_ACCOUNT_ID" `
  -BucketName "ringside-artwork" `
  -PublicBaseUrl "https://artwork.example.com"
```

The script downloads accepted images, uploads them, replaces the staged catalogue only after success, rebuilds `data/core.json` and runs the test suite.

Commit generated catalogue data afterward:

```powershell
git add data/artwork-catalog.json data/artwork-r2-manifest.json data/core.json data/meta.json
git commit -m "Publish artwork catalogue to Cloudflare R2"
git push
```

## 8. Upgrade without losing the catalogue

A release package contains an empty artwork-catalogue template. Preserve an existing populated R2 catalogue with:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\upgrade-preserve-r2.ps1 `
  -TargetPath "R:\Files\ringside-archive-complete"
```

## GitHub Actions

`.github/workflows/publish-artwork-r2.yml` supports manual batch publication. Store these as repository secrets:

```text
CLOUDFLARE_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
R2_PUBLIC_BASE_URL
TMDB_READ_ACCESS_TOKEN
```

## CORS

Normal `<img>` display does not require permissive CORS. Add a restrictive GET/HEAD policy only when browser JavaScript needs to read image bytes or use canvas.

## Copyright

R2 changes hosting, not rights. Preserve attribution and upload only material that may lawfully be republished.
