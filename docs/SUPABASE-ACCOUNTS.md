# Supabase accounts and roaming integrations

Supabase is recommended for this edition because the requested state must follow a user between devices.

## Browser-accessible table

`archive_state` stores viewing status, reviews, settings and feed mappings. Artwork is a regenerable device cache and is intentionally excluded from cloud state. RLS policies require the authenticated user ID to equal the row's `user_id`.

## Server-only table

`integration_vault` stores one encrypted Plex row and one encrypted Trakt row per user. Browser roles have no grants or policies on this table. Vercel authenticates the user's Supabase JWT, then accesses the row with the server secret key.

Before database storage, the provider payload is:

1. serialized as JSON;
2. gzip-compressed;
3. encrypted using AES-256-GCM with a random IV;
4. encoded into a versioned text envelope.

## Keys

- `SUPABASE_PUBLISHABLE_KEY`: public/browser-safe, constrained by RLS.
- `SUPABASE_SECRET_KEY`: server-only current key (`sb_secret_...`).
- `SUPABASE_SERVICE_ROLE_KEY`: supported legacy JWT alternative.
- `INTEGRATION_ENCRYPTION_KEY`: server-only application encryption key.

Current Supabase secret keys are opaque API keys and are sent only in the `apikey` header. Legacy service-role JWT keys also use the `Authorization: Bearer` header. The project detects the format automatically.

## Cross-device lifecycle

1. User signs into Supabase Auth.
2. Browser pulls and merges `archive_state`.
3. Browser calls the Vercel account endpoint with the user's JWT.
4. Vercel verifies that JWT through Supabase Auth.
5. Vercel decrypts only that user's Plex/Trakt rows.
6. The browser receives sanitized integration metadata, not raw account tokens.
7. Provider calls are made by Vercel with the encrypted server-side token.
8. A local account-owner marker prevents cached data from one account being merged into another account on a shared browser.

## Recovery and deletion

The app consumes Supabase email confirmation/recovery sessions and provides a password-update form. Deleting the Auth user removes both tables' rows through cascading foreign keys.

Losing `INTEGRATION_ENCRYPTION_KEY` makes existing provider rows unreadable. Delete those rows and reconnect Plex/Trakt if the key cannot be recovered.
