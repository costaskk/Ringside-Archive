# Ringside Archive v5.8.0 deployment checklist

## Repository

- [ ] Upgrade with `tools/upgrade-preserve-r2.ps1` or manually preserve the generated R2 catalogue and manifest.
- [ ] Run `npm run build:core`.
- [ ] Run `npm test` and confirm every test passes.
- [ ] Confirm `git status` does not contain `.env`, a private Plex export or `public-artwork/`.
- [ ] Commit and push the complete v5.8.0 update.

## Expected validated counts

- [ ] 104 promotions.
- [ ] 504 programme/event families.
- [ ] 1,904 dated major events.
- [ ] 6,572 deferred exact Plex-derived episodes.
- [ ] 71 recommendations.
- [ ] 110 wrestler profiles.
- [ ] Exactly 12 Vercel Functions.

## Vercel environment

- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_PUBLISHABLE_KEY`
- [ ] `SUPABASE_SECRET_KEY`
- [ ] `INTEGRATION_ENCRYPTION_KEY`
- [ ] `TRAKT_CLIENT_ID`
- [ ] `TRAKT_CLIENT_SECRET`
- [ ] `TMDB_READ_ACCESS_TOKEN`
- [ ] `CLOUDFLARE_ACCOUNT_ID`
- [ ] `R2_ACCESS_KEY_ID`
- [ ] `R2_SECRET_ACCESS_KEY`
- [ ] `R2_BUCKET_NAME`
- [ ] `R2_ARTWORK_PUBLIC_BASE_URL`

## Browser verification

- [ ] Open `?v=5.8.0` and confirm the footer version.
- [ ] Scroll deep into the timeline and run an artwork scan; confirm the page does not jump to the top.
- [ ] Click a poster, logo, headshot and gallery image; confirm each opens in the lightbox.
- [ ] Confirm Escape and the close button dismiss the lightbox.
- [ ] Sign into Ringside and scan one missing artwork item.
- [ ] Confirm the result says it was saved to Cloudflare R2.
- [ ] Confirm the R2 object uses a `runtime/<kind>/...` content-hashed path.

## Plex verification

- [ ] Import the safe version 3 `Wrestling`/`Wrestling PPV` export.
- [ ] Confirm import diagnostics report approximately 13,040 matches.
- [ ] Confirm no browser quota error appears.
- [ ] Confirm watched and partial-progress items import correctly.
- [ ] Confirm matched items open through `http://100.112.143.89:32400` or the configured LAN/Tailscale URL.
- [ ] Confirm JCP, WCW and NWA each show their own historically appropriate programmes and episodes.

## Trakt and accounts

- [ ] Connect Trakt and confirm the activation code remains visible while polling.
- [ ] Import Trakt history.
- [ ] Sign into a second device and confirm account progress and encrypted connection status roam correctly.

## Security

- [ ] Rotate the Plex token exposed during development.
- [ ] Confirm the R2 secret and Supabase secret are not in Git history.
- [ ] Confirm `npm run audit:plex -- <export>` reports no embedded token.
