# Ringside Archive v5.1.1 deployment checklist

## Local verification

- [ ] Extract the ZIP into a normal writable folder.
- [ ] Install Node.js 22 or newer.
- [ ] Run `npm test` and confirm all checks pass.
- [ ] Confirm no real secret has been added to `.env.example`, `runtime-config.js` or source files.

## GitHub

- [ ] Create an empty GitHub repository.
- [ ] Run:

```powershell
git init
git add .
git commit -m "Initial Ringside Archive v5.1.1 release"
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
```

- [ ] Use `SUPABASE_SERVICE_ROLE_KEY` only for a legacy project without a current secret key.
- [ ] Deploy.
- [ ] Add the final URL to Supabase Auth URL Configuration.
- [ ] Redeploy after environment-variable changes.

## Functional acceptance test

- [ ] Create a Ringside account and confirm email.
- [ ] Sign out and back in.
- [ ] Test password-reset completion.
- [ ] Mark a record Watched, sync, and confirm it restores in another browser/profile.
- [ ] Connect Trakt while signed in.
- [ ] Import Trakt history.
- [ ] Connect Plex while signed in.
- [ ] Refresh servers and scan a server.
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
- [ ] Run the artwork workflow and manually review ambiguous images.
- [ ] Never label a fallback or generated image as original artwork.

## Vercel Hobby function check

Version 5.1.1 contains exactly 12 deployable Vercel Functions. Before pushing future API changes, run:

```powershell
npm test
```

The smoke test will stop if more than 12 route files are present under `api/`.
