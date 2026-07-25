# Plex catalogue import and historical lineage

Ringside Archive v5.8.1 was audited against the owner-supplied Plex version 3 export from the **Wrestling** and **Wrestling PPV** libraries. The import is used in two distinct ways:

1. A neutral catalogue supplement committed with the project supplies missing dates, programme families and exact episode records.
2. A private browser import links the owner’s actual Plex rating keys, watched state and progress to those archive records.

The committed supplement contains no Plex token, rating key, server address, watch history or other account-specific value.

## Audited export results

| Metric | Result |
|---|---:|
| Input rows | 13,075 |
| Plex episodes | 12,219 |
| Plex movie/event rows | 856 |
| Rows matched by the v5.8 matcher | 13,040 |
| Exact Plex-derived episode records added | 6,572 |
| New dated major events added | 760 |
| Plex show-title mappings | 69 |
| Intentionally excluded episode anomalies | 29 |
| Intentionally excluded compilations/documentaries | 6 |
| Unmapped event rows | 0 |

The full machine-readable audit is in [`data/plex-import-report.json`](../data/plex-import-report.json).

## Matching order

The runtime matcher applies the strongest evidence first:

1. IMDb, TMDB and TVDB identifiers.
2. Exact title plus original air date.
3. Explicit Plex-show mapping from `data/plex-title-map.json`.
4. Season and episode numbers inside the mapped date range.
5. Promotion-scoped normalized title/year matching.
6. Conservative fuzzy matching only after the stronger checks fail.

The matcher keeps ownership, viewing state and catalogue identity separate. A show-level match does not incorrectly mark every episode as owned.

## Historical promotion lineage

Television titles that crossed ownership changes are split by date rather than assigned to one company forever. Important examples include:

- **World Wide Wrestling**: Jim Crockett Promotions before November 27, 1988; WCW afterward.
- **World Championship Wrestling / Saturday Night lineage**: JCP before the Turner purchase; WCW afterward.
- **WCW Pro** and **WCW Main Event**: date-ranged JCP/WCW attribution.
- **Georgia Championship Wrestling** material found under a modern GCW Plex container: assigned to the historic Georgia promotion by date.
- **E.C.W. (2006–2010)**: assigned to WWE ECW, not the original Extreme Championship Wrestling promotion.
- **NWA-TNA weekly PPVs**: assigned to TNA’s 2002–2004 weekly pay-per-view chronology.

As a result, NWA, JCP and WCW no longer appear empty while their programmes are incorrectly collapsed under a single company.

## Intentional exclusions

Twenty-nine episode rows were rejected because their Plex metadata dates are impossible or outside a safe lineage range. They are primarily duplicated `Power Pro` rows dated in 2024 and anomalous UWF rows dated 1969 or 2012.

Six movie rows were classified as compilations or documentaries rather than chronology events. They remain valid Plex media but are not inserted as PPVs or supercards.

## Private import storage

The complete linked Plex index is stored in browser IndexedDB. `localStorage` and the encrypted roaming vault keep only a compact subset required for availability, links and viewing synchronization. This avoids the browser quota failure that occurred when a full 13,000-row library was placed in `localStorage`.

Matched records open through the configured LAN/Tailscale Plex base URL. The default is:

```text
http://100.112.143.89:32400
```

## Re-importing a fresh export

Create a safe version 3 export locally:

```powershell
& ".\tools\export-plex-library.ps1" `
  -PlexUrl "http://127.0.0.1:32400" `
  -LibraryNames @("Wrestling", "Wrestling PPV") `
  -Output ".\plex-library-export.json"
```

Audit it before importing:

```powershell
npm run audit:plex -- ".\plex-library-export.json"
```

A safe file reports `containsEmbeddedPlexToken: false`. Never commit the private export to GitHub.
