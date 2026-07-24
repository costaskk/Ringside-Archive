# Ringside Archive v5.4.1 professional audit

## Preserved archive foundation

- 101 promotion profiles
- 188 programme families
- 1,144 dated major events
- 1,144 detail records
- 71 curated recommendations
- 110 wrestler-directory entries
- recovered original production assets under `legacy-original/`
- exactly 12 deployable Vercel Functions

## Problems reproduced from the live deployment

### Slow startup and repeated work

The older client blocked its first useful render on every JSON file, Supabase configuration, account verification, cloud restoration and integration restoration. It then started 42 episode feeds with four workers, repeatedly flattened/resorted the timeline and rebuilt the wrestler index while feeds arrived. Non-timeline pages also rendered the dashboard and full supporting UI.

### Trakt device code disappearing

The device code was written directly into a DOM node rather than application state. Any unrelated render—cloud sync, artwork discovery, episode progress or a toast—replaced the modal HTML and removed the code while polling continued.

### Wrestler headshots and profile depth

Headshots depended on a background artwork scan finishing and then rerendering the whole app. A wrestler page contained only a long chronology, with no ranked matches, visible rating methodology or direct show-family navigation.

### Visual density

The recovered interface was functional but visually flat at large desktop sizes, and large directories did not consistently use browser rendering containment or bounded first-page sizes.

## Corrections implemented

### Startup and runtime performance

- Core catalogue data renders first; event details and artwork catalogues load during idle time.
- Supabase configuration, user restoration and encrypted integration restoration run after the first usable paint.
- Exact episode feeds start only on timeline/show views, during idle time, with two workers.
- Episode progress updates are throttled rather than rerendering after every feed.
- Flattened episodes and the merged chronology are cached and invalidated only when feed data changes.
- Wrestler indexing uses parsed competitor names instead of scanning every wrestler against every episode string.
- Initial directories are bounded to 24 cards; Companies and Wrestlers use pagination.
- Cards and large lists use `content-visibility` and intrinsic-size containment.
- Repeat catalogue requests use stale-while-revalidate caching, while private APIs remain network-only.

### Persistent Trakt authorization

- Device-code data is stored in `state.traktDevice`.
- Connections renders the code from state, so unrelated rerenders cannot remove it.
- A countdown, Copy code button, activation link and Cancel action are included.
- Closing and reopening the modal retains the active code while polling continues.

### Wrestler headshots and Top 10 profiles

- Headshots have a lazy same-origin render URL backed by fast Wikipedia summary lookup and Wikimedia search fallback.
- Edge/browser caching and asynchronous decoding keep the directory responsive.
- Each wrestler profile includes an eager hero portrait, four metrics, a Top 10 match list, five-star Archive editorial ratings, links to exact records or programmes, programme-family appearances and the complete chronology.
- All 71 curated recommendations now contain a labelled Archive editorial star rating. Stored source/personal ratings take precedence where present.

### Visual refresh

- Refined dark arena palette, spacing, type hierarchy, card depth and focus states.
- Improved hero, filters, chronology cards, modals and connection surfaces.
- New wrestler profile hero, ranked-match cards, star meter and programme-appearance cards.
- Better responsive layouts and reduced-motion support.

### Existing integration protections retained

- Required Trakt headers and Cloudflare diagnostics.
- Compact Plex storage and exact view-state matching.
- Encrypted Supabase integration vault.
- Safe artwork proxying and bounded device artwork cache.
- 12-function Vercel Hobby compatibility.

## Validation performed

`npm test` validates:

- catalogue references, IDs and date formats;
- 12-function Vercel Hobby limit;
- absence of obsolete Trakt routes;
- Supabase key compatibility, RLS schema and encryption round-trip;
- Trakt required headers and HTML-error diagnostics;
- artwork discovery and same-origin image proxy;
- Plex direct-to-Relay connection fallback;
- exact show and native Other Videos section scanning;
- episode/event Plex matching;
- quota-aware Plex storage compaction and token stripping;
- full browser rendering smoke test.

Live Trakt and Plex access still depends on the deployed credentials and the network reachability of the user’s Plex server. The repository tests use controlled mock responses and do not impersonate the user’s accounts.


## Scroll stability and catalogue cleanup

- Full-document renders capture and restore the first visible record and exact viewport offset.
- Quiet cloud sync skips rendering unless user-visible state actually changed.
- Background artwork hydration and feed-progress reporting do not rebuild the timeline.
- Service-worker controller changes never call `location.reload()`.
- 101 synthetic promotion master-index placeholders were removed from programme data and the Complete Timeline.
