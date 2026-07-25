# Artwork sources, lightboxes and persistence

Ringside Archive v5.8.1 supports show, season, episode and individual-event artwork without presenting generated imitations as originals.

## Resolution order

1. `data/artwork-overrides.json`
2. TVMaze episode/show images
3. `data/artwork-catalog.json`
4. strict TMDB or Wikipedia/Wikimedia discovery
5. Plex artwork available to the current signed-in integration
6. labelled archive placeholder

A company logo is never silently substituted for an unrelated event poster.

## Image lightbox

Posters, stills, logos, wrestler headshots and gallery images use the shared `data-lightbox` behavior. Mouse click, Enter or Space opens a modal containing:

- the largest accepted image URL;
- the image title;
- a direct original-image link;
- source and attribution links when available.

Escape, the close button or the modal backdrop closes it.

## Manual override

```json
{
  "wwe-1985-03-31-wrestlemania": {
    "url": "./artwork/wrestlemania-1985.jpg",
    "type": "poster",
    "sourceUrl": "https://example.org/source-page",
    "credit": "Rights holder or archive",
    "confidence": "verified"
  }
}
```

`images` arrays are supported for multiple posters or backdrops.

## Strict discovery

The Vercel endpoint and `scripts/scan-artwork.mjs` use TVMaze, TMDB, Wikipedia and Wikimedia with title, year, promotion and content-type checks. Results below the client’s confidence threshold are rejected. Wrestler headshots reject logos, belts, posters and unrelated group photos.

Set `TMDB_READ_ACCESS_TOKEN` for richer TMDB coverage.

## Incremental card scans

In-app scans run asynchronously. The button and task dock show progress while accepted images are patched into existing cards. The root application is not rebuilt, so the scroll position, filters and open panels remain stable.

A **Wrong image** action rejects the local cached candidate without reloading the page.

## Cloudflare R2

Two R2 workflows are supported:

1. **Repository publication** — the CLI downloads accepted catalogue images, uploads content-hashed objects and rewrites `data/artwork-catalog.json`.
2. **Runtime persistence** — an authenticated in-app scan uploads the accepted source image through `/api/artwork/search` and returns the R2 URL immediately.

Runtime R2 writes require all five R2 environment variables and a valid Ringside/Supabase account. Signed-out scans remain local. R2 secrets never reach the browser.

See `docs/CLOUDFLARE-R2-ARTWORK.md`.

## Plex artwork

Plex tokens are never embedded in the safe export. Account-linked Plex images use signed same-origin proxy URLs, so the browser does not receive raw tokenized image addresses.

## Rights

Copyright remains with the respective rights holders. The repository licence applies to the software, not third-party posters, logos or photography. Only republish an image in R2 when its use is permitted.
