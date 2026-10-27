# Motus

A quiet dashboard for your sleep, steps, food, weight and workouts.

- **Connect once, then it keeps itself up to date.** Sign in with your email (a 6-digit code, no password), tap **Connect Hevy** and **Connect Apple Health**. Workouts sync in the background; your iPhone sends the day's Health numbers every morning. MyFitnessPal comes along through Apple Health.
- **Or import a file**: Apple Health export, Hevy or Strong CSV, MyFitnessPal export, any app through a spreadsheet, or a day by hand. Without an account, imports stay on your device.
- **Demo first.** Until you connect something, Motus shows five months of made-up data so you can look around.

## What you see

- **Home:** this week's averages (steps and calories up to yesterday, because today isn't finished; sleep and weight up to today), weight change against last week, a week strip of training days, last week in one line, the last 7 days and 30-day charts.
- **Workouts:** a rating for your last workout and for the last 4 weeks, workouts per week, every exercise's estimated one-rep max and its trend, and a rating for each workout this week and last.
- **Weeks:** one row per finished week, downloadable as CSV.
- **Standards:** your own goals (green when you reach them), training days, kg or lb, and whether weeks start on Sunday or Monday.

## How connecting works

```
Browser ── /api ──► Cloudflare Worker (worker/) ── D1 database (worker/schema.sql)
                      ├─ sign-in: 6-digit code by email (Resend), HttpOnly session cookie
                      ├─ Hevy: key checked once, stored encrypted (HEVY_SECRET); /v1/workouts/events every 30 min
                      └─ /api/upload: the Motus Shortcut's daily Apple Health numbers (its own token)
iPhone: Motus Shortcut (built-in Shortcuts actions) ── POST /api/upload, daily automation
```

- **Hevy** has no "Sign in with Hevy"; it gives Pro users an API key. **Connect Hevy** opens Hevy's key page; people copy the key, come back and tap **Paste key**. The server checks it with Hevy, keeps it encrypted, and fetches changes in the background.
- **Apple Health** can't be read by any website. **Connect Apple Health** adds the Motus Shortcut (one tap once it is published; until then [shortcut.html](public/shortcut.html) shows how it's built) and **Finish** runs it once with the account's upload address and token; iOS asks to allow Health. People add the daily automation themselves (iOS doesn't let apps do that).
- **MyFitnessPal** has no open API for new apps; it writes to Apple Health, so it arrives with Apple Health.
- **Strong** has no API; it comes as a CSV export.

## Run and deploy

Node 20+ (tests use `node:sqlite`). `npm install` once.

```bash
npm test                 # importers, averaging rules, storage, and the server against a real SQLite database
npm run dev              # the full app with its server on http://127.0.0.1:8787 (local database, codes printed in the log)
npm start                # only the static pages, no accounts, on http://localhost:8098
```

Local secrets live in `.dev.vars` (git-ignored): `HEVY_SECRET` (32 random bytes, base64), `CODE_PEPPER`, `DEV_SHOW_CODES=1`.
Create the local tables once: `npx wrangler d1 execute motus --local --file worker/schema.sql`.

**First deploy to Cloudflare** (free plan to start):

1. `npx wrangler login` (opens Cloudflare in the browser to allow it).
2. `npx wrangler d1 create motus`, then put the printed `database_id` in `wrangler.jsonc`.
3. `npx wrangler d1 execute motus --remote --file worker/schema.sql`
4. Secrets: `npx wrangler secret put HEVY_SECRET` (32 random bytes, base64), `CODE_PEPPER` (any long random text), `RESEND_API_KEY` (from resend.com).
5. `npx wrangler deploy` → `https://motus.<your-subdomain>.workers.dev`.
6. To send codes to everyone (not only the Resend account's own address): add a domain in Resend, verify it, and set `EMAIL_FROM` in `wrangler.jsonc`.

GitHub Pages (`.github/workflows/pages.yml`) keeps publishing `public/` as the app without accounts.

## Layout

| Path | What it is |
|---|---|
| `public/` | The app: `index.html`, `workouts.html`, `weeks.html`, `connect.html`, `shortcut.html`, `style.css`, `js/` |
| `public/js/core.js` | Dates, goals and settings, formatting, the navbar |
| `public/js/store.js`, `merge.js` | Data on the device; sources and their priority (hand entry > Apple Health connected > Apple Health file > MyFitnessPal > spreadsheet > Hevy connected > Hevy file > Strong); merging shared with the server |
| `public/js/account.js` | Sign-in, keeping the device in step with the account, connecting Hevy and Apple Health |
| `public/js/health.js` | Reading the Shortcut's uploads (also phones set to Arabic) and Health Exporter JSON; shared with the server |
| `public/js/stats.js`, `demo.js`, `importers/` | Workout summaries and ratings, the demo, one importer per file type |
| `worker/` | The server: `index.js` (routes, cron), `auth.js`, `hevy.js`, `util.js`, `schema.sql` |
| `tests/` | `node tests/test_*.mjs`; `d1.mjs` runs the server's SQL on Node's SQLite; fixtures are made up |

## Privacy and security

- Signed in, a person's numbers are stored in the Motus database so they can arrive by themselves and show on any device. Only hashes of sign-in codes, session cookies and Shortcut tokens are stored; Hevy keys are encrypted. Deleting the account removes everything at once.
- Sessions are HttpOnly, SameSite=Lax cookies; every change must come from Motus's own pages (Origin check). Sign-in codes expire in 10 minutes, allow 5 tries, and are rate-limited per address and per IP.
- No analytics, cookies other than the session, or third-party scripts. The pages' Content-Security-Policy allows only their own scripts and their own server.
