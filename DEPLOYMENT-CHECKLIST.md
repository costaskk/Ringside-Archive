# Ringside Archive v5.7.0 deployment checklist

## Local verification

- [ ] Extract the ZIP into a normal writable folder.
- [ ] Install Node.js 22 or newer.
- [ ] Run `npm run build:core` after catalogue edits.
- [ ] Run `npm test` and confirm all checks pass, including the exact-link and async UI audits.
- [ ] Confirm no real secret has been added to `.env.example`, `runtime-config.js` or source files.

## GitHub

- [ ] Create an empty GitHub repository.
- [ ] Run:

```powershell
git init
git add .
git commit -m "Initial Ringside Archive v5.7.0 release"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/ringside-archive.git
git push -u origin main
```

- [ ] Keep the repository private while initially configuring secrets if desired.
- [ ] Do not enable the removed GitHub Pages workflow for the production app; Plex/Trakt account sync needs Vercel APIs.

## Supabase

- [ ] Create the Supabase project.
- [ ] Run all of `supabase/schema.sql` in SQL Editor.
- [ ] Confirm RLS is enabled on `archive_state`.
- [ ] Confirm `integration_vault` has no `anon` or `authenticated` grants.
- [ ] Enable Email/password under Authentication providers.
- [ ] Configure production Site URL and Redirect URLs.
- [ ] Configure custom SMTP before public production use.
- [ ] Copy the project URL, publishable key and server secret key.

## Encryption

- [ ] Generate a 32-byte key:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

- [ ] Store it securely as `INTEGRATION_ENCRYPTION_KEY`.
- [ ] Back it up in a password manager.
- [ ] Never rotate it without first planning migration/reconnection.

## Trakt

- [ ] Create a Trakt API application.
- [ ] Store its client ID and client secret.
- [ ] Use the deployed Vercel URL as the application website.
- [ ] Do not include quotes around the client ID/secret.
- [ ] After deployment, confirm `/api/config` reports `traktConfigured: true`.

## Vercel

- [ ] Import the GitHub repository.
- [ ] Select framework **Other**.
- [ ] Leave Build Command and Output Directory empty.
- [ ] Add:

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

- [ ] Use `SUPABASE_SERVICE_ROLE_KEY` only for a legacy project without a current secret key.
- [ ] Deploy.
- [ ] Add the final URL to Supabase Auth URL Configuration.
- [ ] Redeploy after environment-variable changes.

## Post-upgrade cache reset

- [ ] Open the deployed URL once with `?v=5.7.0`.
- [ ] Hard refresh with **Ctrl+Shift+R**.
- [ ] If an older interface remains, unregister the old service worker and clear site data once.
- [ ] Confirm the footer says **Catalogue v5.7.0** and the dashboard reports **431 programme families**.
- [ ] Press **Scan visible artwork** and confirm only the button/progress indicator changes while the current scroll position remains stable.
- [ ] Open a green free-viewing link and confirm it is a direct video, playlist or event page—not a channel/search page.

## Legacy Plex-export security

- [ ] Run `npm run audit:plex -- .\plex-library-export.json` before importing an old file.
- [ ] If the audit reports an embedded token, rotate Plex credentials and delete the unsafe file.
- [ ] Create a version 3 export that explicitly selects the wrestling libraries.
- [ ] Confirm the audit reports `containsEmbeddedPlexToken: false` and at least one likely wrestling row.

## Functional acceptance test


- [ ] Create a Ringside account and confirm email.
- [ ] Sign out and back in.
- [ ] Test password-reset completion.
- [ ] Mark a record Watched, sync, and confirm it restores in another browser/profile.
- [ ] Connect Trakt while signed in.
- [ ] Confirm the Trakt device code stays visible for at least one polling cycle and can be copied.
- [ ] Import Trakt history.
- [ ] Connect Plex while signed in.
- [ ] Refresh servers.
- [ ] Load libraries for the intended server.
- [ ] Select one or more wrestling library sections and scan them.
- [ ] Confirm exact owned episodes show Plex availability.
- [ ] Confirm Plex `viewCount` imports as Watched.
- [ ] Confirm partial Plex `viewOffset` imports as Watching.
- [ ] Enable Plex writeback and test on one expendable matched record.
- [ ] Sign into a second device and confirm Plex/Trakt show connected without reconnecting.
- [ ] Confirm `/api/` responses are not available offline from the PWA cache.

## Catalogue and artwork

- [ ] Run the TVMaze update workflow.
- [ ] Review newly discovered feed mappings before treating them as exact.
- [ ] Add `TMDB_READ_ACCESS_TOKEN` if richer artwork is desired.
- [ ] Open Companies and confirm logo placeholders begin resolving.
- [ ] Open Wrestlers and confirm lazy headshots resolve through the same-origin artwork endpoint.
- [ ] Open a wrestler and confirm Top 10 match stars, programme links and the full career route.
- [ ] Confirm the first usable screen appears before cloud restoration and exact-feed loading complete.
- [ ] Run the artwork workflow and manually review ambiguous images.
- [ ] Never label a fallback or generated image as original artwork.

## Vercel Hobby function check

Version 5.7.0 contains exactly 12 deployable Vercel Functions. Before pushing future API changes, run:

```powershell
npm test
```

The smoke test will stop if more than 12 route files are present under `api/`.

### v5.7 artwork and Plex checks

- [ ] Confirm old scanned artwork is absent on first v5.7 load (`ringside-artwork-v2`).
- [ ] Scan a mapped show and confirm TVMaze artwork is preferred.
- [ ] Confirm a card without verified art uses the archive placeholder, not its company logo.
- [ ] In Connections, confirm Plex LAN URL is `http://100.112.143.89:32400` or your preferred Tailscale address.
- [ ] Open a matched item and confirm it goes to the local Plex Web details page.
- [ ] Open TNA weekly PPVs and confirm the exact feed can load 111 episodes.
