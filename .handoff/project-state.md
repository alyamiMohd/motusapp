# Project state (2026-10-27)

## Stack
- `public/`: plain HTML, CSS, ES modules (no build, no framework). Pages: index (Home), workouts, weeks, connect, shortcut.
- `worker/`: Cloudflare Worker (ES modules) + D1 (SQLite). Serves `public/` as static assets and `/api`. Deployed with `wrangler` 4.x (dev dependency; the only one).
- Tests: Node 20+ (24 on this laptop and in CI), no test framework; `tests/d1.mjs` runs the worker's SQL on `node:sqlite`.

## Architecture
```
Browser (public/) ── same origin ──► Worker (worker/index.js) ── D1 (worker/schema.sql)
  account.js: sign-in, pull (ETag), push imports       ├─ auth.js: codes (hash, 10 min, 5 tries, rate limits), session cookie
  store.js/merge.js: sources + priority                 ├─ hevy.js: key encrypted (HEVY_SECRET), /v1/workouts/events in steps
                                                       ├─ /api/upload: Shortcut token (hash) → merge into source "health"
                                                       └─ cron */30: Hevy steps for a few accounts, cleanup
iPhone: Motus Shortcut ── POST /api/upload (Bearer mh_…) daily via a Shortcuts automation
Resend: sends the sign-in codes (RESEND_API_KEY)
```

## API
| Route | What |
|---|---|
| POST /api/auth/start, /api/auth/verify, /api/auth/logout | email code sign-in; cookie `motus` (HttpOnly, SameSite=Lax, Secure on https, 1 year) |
| GET /api/me · DELETE /api/me | status (Hevy, Health) · delete the account and everything |
| GET /api/data | `{ me, sources: {id: {imported, data}}, workouts: [...] }`, ETag = users.changed |
| PUT/DELETE /api/sources/:id | device-imported sources: manual, apple, mfp, csv, hevy, strong |
| POST/DELETE /api/hevy · POST /api/hevy/sync | connect (validate + first step) / disconnect · next sync step |
| POST/DELETE /api/health | new Shortcut token (replaces the old) + upload URL / disconnect |
| POST /api/upload | the Shortcut's upload: `{steps, calories, active, weight, sleep}` lines, or Health Exporter JSON/`health_b64`, or `{days}` |
All cookie-authenticated non-GET requests require `Origin` = the app's origin.

## Sources (priority, highest first)
manual > health (Shortcut) > apple (file) > mfp > csv > hevy_live (connected Hevy, computed in the browser from the server's workouts) > hevy (CSV) > strong.

## Files
| Path | Role |
|---|---|
| `public/js/core.js` | dates, prefs (goals, kg/lb, week start), formatting, navbar |
| `public/js/store.js` | device storage, `putSource`, `setAll` (account copy), `getData` (merge + demo) |
| `public/js/merge.js` | `clean`, `mergeSource` (shared with the worker) |
| `public/js/health.js` | upload reader (Shortcut lines incl. Arabic digits/units/sleep names; Health Exporter JSON; days) |
| `public/js/account.js` | API client: sign-in/out, pull/push, Hevy connect/sync, Health setup link, `SHORTCUT_URL` |
| `public/js/pages/*.js` | one script per page; every page renders from the device copy, then `autoRefresh()` |
| `public/js/importers/*` | file imports (Apple export.zip/xml streaming, Hevy CSV, Strong CSV, MFP zip/CSV, spreadsheet) |
| `worker/index.js`, `auth.js`, `hevy.js`, `util.js`, `schema.sql` | the server |
| `wrangler.jsonc` | Worker config: assets `public/`, D1 binding `DB` (database_id placeholder until created), cron, `EMAIL_FROM` |
| `.dev.vars` (git-ignored) | local secrets: HEVY_SECRET, CODE_PEPPER, DEV_SHOW_CODES=1 |
| `.github/workflows/test.yml`, `pages.yml` | tests on every push; GitHub Pages publishes `public/` (no accounts there) |
| `tests/` | test_core (43), test_importers (65), test_store (20), test_server (45); harness.mjs, d1.mjs, fixtures/ |

## Secrets and accounts (names only)
Production secrets via `npx wrangler secret put`: `HEVY_SECRET` (32 random bytes, base64), `CODE_PEPPER`, `GMAIL_SCRIPT_URL` + `GMAIL_SECRET` (the owner's Gmail sender, in use since 2026-10-28), `RESEND_API_KEY` (account paused; fallback only); optional `BREVO_API_KEY` + `EMAIL_FROM` (not set; `EMAIL_FROM` is no longer a plain var). Accounts: Cloudflare (free), the owner's Google account (Apps Script "Motus sign-in", Web app, access Anyone); later a domain.

## Verified (2026-10-27)
- `npm test`: 173 checks pass.
- `wrangler dev` in the Browser pane: sign-in with a printed code; HttpOnly cookie; Shortcut token + simulated upload (curl) → Home shows the numbers (sleep 7.4 h / 7.3 h as expected); Connect Hevy opens Hevy's key page, a fake key gets Hevy's real refusal; a CSV import while signed in is saved to the account; sign out clears the device, sign in brings it all back; the cron runs.
- Live (2026-10-27): deployed at https://motus.motusapp.workers.dev; secrets HEVY_SECRET, CODE_PEPPER, RESEND_API_KEY set; the owner signed in with a real emailed code.
- 2026-10-27 evening, full end-to-end run by Claude on `wrangler dev` with `tests/mock_hevy.mjs` (40 made-up workouts): sign-in with printed code; wrong Hevy key → clear message; good key → 40 workouts in D1, key encrypted, Workouts page filled; Shortcut uploads via curl (normal, Arabic digits/units, duplicate iPhone+Watch sleep deduped; no/wrong token and junk refused); Home updates within ~3 s of opening; cron run incremental, no error; sign out clears device, sign in restores; delete account removes every row and kills the Shortcut token; all pages 320px no sideways scroll, light + dark. `npm test`: 174 checks.
- Live: pages 200, deployed files match the repo, signed-out and cross-site requests refused.
- Windows note: local D1 needs `--persist-to <short path>` here (scratch path too long → SQLITE_CANTOPEN).
## Not verified
Hevy with a real key; the real Shortcut on an iPhone (Health permission, automation, Arabic-language phone); free-plan CPU limits under real load.
