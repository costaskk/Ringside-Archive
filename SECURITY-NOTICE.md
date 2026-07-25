# Security notice: legacy Plex exports

Older Ringside Archive Plex-export scripts could write `X-Plex-Token` into `thumbUrl` and `artUrl` values. A Plex token grants authenticated access to the associated Plex account/server and must be treated like a password.

## If an old export contains `X-Plex-Token=`

1. Do **not** import, publish, email or commit that file.
2. In Plex account security, change the password and choose **Sign out connected devices after password change** to invalidate existing tokens.
3. Sign the Plex server and trusted Plex clients back into the account.
4. Delete every copy of the unsafe export from GitHub history, cloud drives, chat attachments and shared folders where practical.
5. Create a fresh export with `tools/export-plex-library.ps1` from this release.
6. Audit the new file:

```powershell
npm run audit:plex -- .\plex-library-export.json
```

A safe export reports:

```text
version: 3
containsEmbeddedPlexToken: false
likelyWrestlingRows: greater than 0
```

## Protections in v5.7.0

- The exporter never writes the token or tokenized image URLs.
- The browser rejects a legacy Plex JSON import containing `X-Plex-Token=`.
- Plex scans are matched in memory and only compact matched records are persisted.
- Raw tokenized artwork URLs are stripped before browser or cloud storage.
- Signed-in Plex credentials are encrypted in the server-only Supabase integration vault.
- Plex artwork for account-linked devices uses signed same-origin proxy URLs.

## Exact free-viewing links

`data/free-links.json` contains public record-specific URLs only. Do not place authenticated streaming URLs, signed URLs, cookies or access tokens in this file. `npm run audit:free-links` rejects generic YouTube channel/search links but cannot make a private or token-bearing URL safe.
