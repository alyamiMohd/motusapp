# Project state (2026-10-26)

## Stack
Plain HTML, CSS and JavaScript ES modules. No framework, build, CDN or npm dependencies. Node 20+ only for tests and the local preview server. Hosted on GitHub Pages from `main` (root). Browser features used: `localStorage`, `DecompressionStream("deflate-raw")`, `TextDecoderStream`, `Blob.stream()`.

## Architecture
```
visitor's browser
  connect.html ── importers (js/importers/*) ── putSource() ──► localStorage "motusapp-data-v1" (one entry per app)
                                                                 └─ getData(): merge by priority; demo (js/demo.js) when empty
  index / workouts / weeks ◄── getData()  +  prefs in localStorage "motusapp-prefs"
  optional: Hevy API (GET api.hevyapp.com/v1/workouts, api-key header) straight from the browser
```

## Files
| Path | Role |
|---|---|
| `index.html` + `js/pages/home.js` | Home: week-to-date averages, weight per week, week strip, last week line, 7-day table, 30-day charts, demo/stale banner |
| `workouts.html` + `js/pages/workouts.js` | Last workout rating, 4-week rating, workouts per week, exercises by e1RM, ratings this/last week, "How ratings work" |
| `weeks.html` + `js/pages/weeks.js` | Completed weeks, newest first, CSV download |
| `connect.html` + `js/pages/connect.js` | One section per app with steps and an import; Hevy key (optional "keep on this device", key `motusapp-hevy-key`); hand entry; Your data (sources, remove, backup, restore, delete everything); Privacy |
| `js/core.js` | Dates (visitor's local time), `weekStart`, `weekAvg`, prefs (goals, kg/lb, week start), `esc`, navbar + Standards panel |
| `js/store.js` | Sources, cleaning ranges, merge priority, replace vs merge, backup/restore |
| `js/stats.js` | `summarizeWorkouts` (Epley e1RM, reps ≤ 12, no warm-ups), `buildWeeks`, `exerciseStats`, `overallRating`, `sessionScore`, `workoutScore` |
| `js/demo.js` | Seeded demo: 150 days, 4-day split, progressive e1RM, a "new" exercise |
| `js/importers/csv.js` | CSV parser (`,` `;` tab, quotes, BOM), loose column names, numbers, dates (ISO, "25 Oct 2026, 18:30", "Oct 25, 2026 6:30 PM", slash dates month-first unless the first number > 12) |
| `js/importers/zip.js` | Zip reader incl. ZIP64; streams one entry |
| `js/importers/apple.js` | `export.xml` streaming scanner; Health Exporter JSON |
| `js/importers/hevy.js` | Hevy API (paged, retries 429/5xx, clear 401 message) and CSV (`weight_kg` or `weight_lbs`, `set_type` warmup) |
| `js/importers/strong.js` | Strong CSV, old (`;`, "Weight Unit", "1h 5m") and new ("Weight (kg)", "Duration (sec)", Set Order "W") |
| `js/importers/mfp.js` | MyFitnessPal Nutrition Summary (meals summed) and Measurement Summary (weight, unit chosen by the visitor), from zip or CSVs |
| `js/importers/sheet.js` | Generic CSV and its template |
| `tests/test_core.mjs` (43), `tests/test_importers.mjs` (65), `tests/test_store.mjs` (20) | 128 checks; `tests/fixtures/` are made up; `export.zip` and `mfp-export.zip` were made with Windows' `tar.exe`; the ZIP64 file is built in the test |
| `serve.mjs` | Local preview server (port 8098) |
| `.github/workflows/test.yml` | `npm test` on every push |

## Commands
- `npm start` (preview on http://localhost:8098), `npm test`.
- Pages: already enabled (`gh api -X POST repos/alyamiMohd/motusapp/pages -f source[branch]=main -f source[path]=/`). A push to `main` redeploys in about a minute.

## Environment variables / secrets
None. The app has no secrets. A visitor's Hevy key lives only in their own browser if they tick "keep".

## What works (verified 2026-10-26)
- All 128 tests pass locally (Node 24) and on GitHub Actions (Node 22).
- Live site loads with demo data, no console errors, no sideways scroll at 375px; checked locally at 390px and 320px (nav fits: rightmost link ends at 304px), desktop, light and dark.
- Through the real page in Edge: Apple Health zip, MyFitnessPal zip, Hevy CSV, hand entry; Hevy API reached with a fake key (401 → clear message, key not saved); merge priority as designed; lb and Monday settings change every view.

## Known limitations
- Importers are tested only against made-up files in each app's known format; real exports may differ (header names, date formats). Hevy/Strong/MyFitnessPal menu paths on the Connect page are not checked in the apps.
- Apple Health de-duplication is approximate (D-006).
- Storage: `localStorage` (about 5 MB). Years of data fit; an extremely large history might not, in which case the page says it couldn't save.
- The origin `alyamimohd.github.io` is shared with the owner's other Pages sites (`motus`), so they share browser storage; keys are prefixed `motusapp-` so nothing collides.
- Large Apple exports on older phones may be slow; not tested on a real iPhone.

## Automatic sync (added 2026-10-27)
```
iPhone: Motus Shortcut (Health Exporter "Export Health Data" → Base64 → POST /repos/<copy>/dispatches, event_type "health")
Hevy API ◄─ every 3 h
        └► person's copy of alyamiMohd/motus-sync: .github/workflows/motus-sync.yml
             checks out alyamiMohd/motusapp@main → node motus/sync/run.mjs out
             reads previous motus-data.enc from its own Pages, merges, encrypts (MOTUS_KEY), deploys Pages
Motus (any page) ── autoRefresh() ── fetch https://<user>.github.io/<copy>/motus-data.enc ── unseal with the key in localStorage
```
| Piece | Where |
|---|---|
| Key, seal/unseal (AES-256-GCM, gzip, random IV), sync file → source, `pullSync`, `autoRefresh` (also refetches Hevy every 30 min for keys saved in the browser) | `js/sync.js` |
| The job: previous state (404 = first run; can't open = stop), upload from `GITHUB_EVENT_PATH` (`health_b64`, `health`, `days`), Hevy, write `out/` | `sync/run.mjs` |
| Template repo files (pushed to `alyamiMohd/motus-sync` by hand when they change) | `sync/template/` |
| Setup guide and device link (`connect.html#sync=<repo>:<key>`) | `connect.html`, `js/pages/connect.js` (`SHORTCUT_URL` empty until the owner shares the Shortcut) |
| Shortcut instructions (fills in the person's copy) | `shortcut.html`, `js/pages/shortcut.js` |
| Tests (34) | `tests/test_sync.mjs` |

Browser storage keys: `motusapp-data-v1`, `motusapp-prefs`, `motusapp-sync` ({repo, url, key, last, updated, hevyError}), `motusapp-sync-draft` (during setup), `motusapp-hevy-key`, `motusapp-hevy-last`.
Secrets in each copy: `MOTUS_KEY` (required), `HEVY_API_KEY` (optional). Phone token: fine-grained, Contents read/write, that copy only, ≤ 366 days, stored only in the Shortcut.
The template repo itself has a test `MOTUS_KEY` and Pages on, for live tests; scheduled runs are skipped there (`if:` in the workflow).
Verified live 2026-10-27 with made-up data: dispatch → run → Pages → app showed the exact numbers. Not verified: a real Shortcut, Hevy inside the job, the 60-day schedule keep-alive.
