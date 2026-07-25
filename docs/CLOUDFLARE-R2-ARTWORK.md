# Host Ringside artwork on Cloudflare R2

Cloudflare R2 is the recommended storage product for this project. The archive mostly needs durable original files served through a CDN; it does not require paid per-image transformation on every request. Cloudflare Images remains useful when you specifically want managed resizing/cropping variants, but R2 is simpler and usually more economical for a large poster/episode-still archive.

## Architecture

- `data/artwork-catalog.json` keeps attribution, confidence and source-page information.
- `scripts/cache-artwork-assets.mjs` downloads only artwork already accepted by the strict matcher.
- `public-artwork/` is uploaded to R2.
- The catalogue is rewritten to your public R2 custom domain.
- Original source URLs remain under `cachedFrom` and source attribution remains intact.

Do not upload an image unless you have the right to republish it. R2 hosting does not change the copyright or licence of a poster, logo, photograph or episode still.

## 1. Create the R2 bucket

1. Sign in to Cloudflare.
2. Open **R2 Object Storage**.
3. Select **Create bucket**.
4. Name it `ringside-artwork`.
5. Leave location on **Automatic**, or choose the Eastern Europe location hint when most use is expected from Greece and nearby countries.
6. Create the bucket.

## 2. Attach a production custom domain

The `r2.dev` address is intended for development. Use a domain that is already active in your Cloudflare account.

1. Open the `ringside-artwork` bucket.
2. Select **Settings → Public access**.
3. Under **Custom domains**, select **Connect domain**.
4. Enter a subdomain such as `artwork.yourdomain.com`.
5. Confirm the DNS change.
6. Disable the public `r2.dev` development URL after the custom domain works.
7. Under **SSL/TLS → Edge Certificates**, enable **Always Use HTTPS**.

Your public base URL will be:

```text
https://artwork.yourdomain.com
```

## 3. Add a cache rule

In **Rules → Cache Rules**, create a rule for the artwork hostname:

```text
Hostname equals artwork.yourdomain.com
```

Use these settings:

- Cache eligibility: **Eligible for cache**
- Edge TTL: **1 month** or longer
- Browser TTL: **Respect existing headers**

The upload script applies `Cache-Control: public,max-age=31536000,immutable`. Artwork filenames contain a content hash, so changed files receive a new URL rather than overwriting the old cached object.

## 4. Create bucket-scoped R2 credentials

1. Open **R2 Object Storage → Manage R2 API tokens**.
2. Select **Create Account API token**.
3. Choose **Object Read & Write**.
4. Limit it to the `ringside-artwork` bucket only.
5. Create the token.
6. Copy the **Access Key ID** and **Secret Access Key** immediately. The secret is shown only once.
7. Note your Cloudflare **Account ID**.

Never put these values in `runtime-config.js`, the browser, the repository or Vercel public variables.

## 5. Install AWS CLI on Windows

Install AWS CLI v2, reopen PowerShell, and confirm:

```powershell
aws --version
```

## 6. Scan, prepare and upload artwork

Open PowerShell in the Ringside Archive repository.

Set the temporary credentials for that PowerShell window:

```powershell
$env:AWS_ACCESS_KEY_ID="YOUR_R2_ACCESS_KEY_ID"
$env:AWS_SECRET_ACCESS_KEY="YOUR_R2_SECRET_ACCESS_KEY"
$env:AWS_DEFAULT_REGION="auto"
```

Populate the strict artwork catalogue first:

```powershell
$env:TMDB_READ_ACCESS_TOKEN="YOUR_TMDB_READ_ACCESS_TOKEN"
npm run scan:artwork
```

Upload the accepted files:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\upload-artwork-r2.ps1 `
  -AccountId "YOUR_CLOUDFLARE_ACCOUNT_ID" `
  -BucketName "ringside-artwork" `
  -PublicBaseUrl "https://artwork.yourdomain.com"
```

The script performs these steps safely:

1. Downloads accepted images into `public-artwork/`.
2. Creates a staged R2 catalogue.
3. Uploads the files with long immutable cache headers.
4. Replaces the live catalogue only after the upload succeeds.
5. Rebuilds `data/core.json` and runs the full test suite.

Then commit:

```powershell
git add data/artwork-catalog.json data/artwork-r2-manifest.json package.json scripts tools docs .github
git commit -m "Publish Ringside artwork through Cloudflare R2"
git push
```

## 7. Optional GitHub Actions automation

The repository includes `.github/workflows/publish-artwork-r2.yml`.

Add these GitHub repository secrets:

```text
CLOUDFLARE_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
R2_PUBLIC_BASE_URL
TMDB_READ_ACCESS_TOKEN
```

Run **Actions → Publish artwork to Cloudflare R2 → Run workflow**. The workflow scans artwork, downloads accepted assets, uploads them, validates the project and commits the rewritten catalogue.

## CORS

Normal `<img>` display does not require a permissive CORS policy. Add CORS only when browser JavaScript must read image bytes, use canvas without tainting, or upload directly. A restrictive example is:

```json
[
  {
    "AllowedOrigins": ["https://ringside-archive.vercel.app"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 86400
  }
]
```

## Purging and updates

Because object names include a hash, normal image updates require no purge. When you intentionally remove an object or change cache behavior, purge the specific URL in Cloudflare rather than purging the entire zone.
