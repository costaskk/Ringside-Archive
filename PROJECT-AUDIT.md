# Ringside Archive v5.6.0 professional audit

## Preserved archive foundation

- 101 promotion profiles
- 294 programme families
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

## v5.5.0 findings retained

### Button-triggered whole-page work

Several remaining operations still called the root renderer while waiting for remote services, especially visible-artwork scanning and account transitions. That replaced hundreds of chronology nodes, recreated controls and made a simple button action feel like a page reload.

### Generic viewing destinations

Historic recommendations contained generated YouTube search URLs or promotion channel links. They could help discovery, but they were not evidence that the specific match or show was freely available and therefore should not be shown as direct viewing links.

## Corrections implemented

### Non-blocking operation architecture

- Central task state controls initiating buttons independently.
- Artwork, episode, Plex, Trakt and cloud operations expose local progress without rebuilding the root document.
- Artwork batches patch only elements carrying the matching `data-artwork-key`.
- Operation messages update dedicated live regions in the current modal or view.
- Exact free-link resolution is separated from promotion channel metadata and rejects generic destinations.

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
- full browser rendering smoke test;
- exact free-link ID/URL/attribution policy;
- button-task, progress-dock and incremental artwork patch markers.

Live Trakt and Plex access still depends on the deployed credentials and the network reachability of the user’s Plex server. The repository tests use controlled mock responses and do not impersonate the user’s accounts.


## Scroll stability and catalogue cleanup

- Full-document renders capture and restore the first visible record and exact viewport offset.
- Quiet cloud sync skips rendering unless user-visible state actually changed.
- Background artwork hydration and feed-progress reporting do not rebuild the timeline.
- Service-worker controller changes never call `location.reload()`.
- 101 synthetic promotion master-index placeholders were removed from programme data and the Complete Timeline.


## v5.6.0 audit findings and corrections

### Incorrect artwork selection

The old resolver accepted broad title containment and could use a Wikipedia lead photograph as a company logo or a company logo as fallback event art. The revised resolver prioritizes exact TVMaze mappings, applies media-specific rejection rules, scores aliases, years, promotion context and programme context, and requires at least 80% client confidence before caching. Older device results are invalidated by a new v2 cache key.

### Ambiguous match-card wording

`completeCard` is a useful internal assertion: it records whether the stored match list is known to be complete. The visible text is now **Known matches** or **All matches verified**, and the action button is **View details**.

### Plex LAN navigation

The browser now builds matched-record URLs against the configured Tailscale address, `http://100.112.143.89:32400`, while retaining `app.plex.tv` as a fallback if the user clears the LAN setting. Vercel scanning continues to use advertised remote/Relay connections rather than this private address.

### Catalogue gaps

One hundred and six programme/event-series records were added. This improves navigational coverage without inventing weekly dates. Exact TNA weekly PPVs are provided by the dedicated TVMaze feed; other series remain source-labelled programme families until exact individual cards are imported.
