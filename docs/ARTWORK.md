# Artwork sources and scanning

Ringside Archive v5.2 supports show, season, episode and individual event artwork without presenting generated imitations as originals.

## Resolution order

1. `data/artwork-overrides.json`
2. TVMaze episode/show images
3. `data/artwork-catalog.json`
4. browser-cached TMDB or Wikipedia/Wikimedia results
5. imported Plex art
6. labelled promotion-colour fallback

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

`images` arrays are also supported for multiple posters/backdrops.

## TMDB and Wikipedia/Wikimedia

The Vercel endpoint and `scripts/scan-artwork.mjs` can use Wikipedia/Wikimedia without a key. Set `TMDB_READ_ACCESS_TOKEN` in Vercel or in the shell for richer TMDB matching. Programme matches can populate show and season posters. Episode matches can populate stills. Event records are searched as movie-style releases first and television records second.

When TMDB has no confident result, the scanner can return a Wikipedia/Wikimedia lead image with a source-page link. A lead image is not necessarily an original event poster, and its individual image licence must be checked.

Search results should be reviewed. Wrestling events often have repeated names, alternate years and inconsistent catalogue entries.

## Plex artwork

The direct Plex scanner and v2 PowerShell exporter include `thumbUrl` and `artUrl`. Direct local Plex artwork URLs can contain a Plex token and must be kept private. Account-linked cloud snapshots omit token-bearing Plex URLs. Vercel generates short-lived signed proxy URLs for each stored Plex thumb/background so artwork can appear on another signed-in device without exposing the Plex token.

## Rights

Copyright remains with the respective rights holders. The repository licence applies to the software, not third-party posters, logos or photography.
