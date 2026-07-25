# Ringside Archive security notice

## Rotate the exposed Plex token

A Plex authentication token was displayed during the exporter troubleshooting. Even though the safe version 3 JSON does not include the token, the displayed credential should be considered exposed and rotated.

Changing the Plex account password while selecting **Sign out connected devices after password change** invalidates existing tokens. Sign the server and trusted clients back in afterward.

## Safe Plex exports

Version 3 exports contain metadata and viewing state but do not generate tokenized `thumbUrl` or `artUrl` fields. Audit every export before importing:

```powershell
npm run audit:plex -- ".\plex-library-export.json"
```

The result must say:

```text
containsEmbeddedPlexToken: false
```

Never commit a private Plex export. The neutral committed supplement contains no rating keys, token, server URL or personal watch state.

## Cloudflare R2 credentials

These are server-only secrets:

```text
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

Restrict the credential to Object Read & Write on the dedicated artwork bucket. Do not place it in `runtime-config.js`, source files, browser storage or public GitHub variables.

The app writes to R2 only after Supabase account authentication. Signed-out scans cannot use the bucket credential.

## Integration vault

Plex and Trakt connections are encrypted with AES-256-GCM before storage. Keep `INTEGRATION_ENCRYPTION_KEY` stable. Losing or changing it makes existing vault records undecryptable and requires reconnecting integrations.

## Upgrade safety

Use `tools/upgrade-preserve-r2.ps1` so a populated generated artwork catalogue is not replaced by the package’s empty template. The script leaves `.env` untouched.
