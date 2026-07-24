# Optional Supabase cloud sync

Supabase is not required for the included project. Progress is stored in the browser and can be exported as JSON.

Supabase becomes useful only when you want:

- the same progress on multiple devices;
- user accounts;
- shared household profiles;
- server-side storage of private integration tokens.

A safe implementation should use Supabase Auth, Row Level Security, and a user-owned `watch_status` table. Do not expose Plex or Trakt secrets in client-side JavaScript. The current ZIP intentionally does not enable cloud sync automatically, because a half-configured public database would be less secure than local storage.
