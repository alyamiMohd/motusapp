# Motus

A quiet dashboard for your sleep, steps, food, weight and workouts.

**Open it:** https://motus.motusapp.workers.dev (the version without accounts: https://alyamimohd.github.io/motusapp/)

- **Connect once, then it keeps itself up to date.** Sign in with your email (a 6-digit code, no password), then pick from **Integrations** on Connect: Apple Health (iPhone), Health Connect (Android), Hevy, Strong, MyFitnessPal. Workouts sync in the background; phones send their Health numbers by themselves. MyFitnessPal comes along through Apple Health or Health Connect.
- **Demo first.** Signed out, Home shows five months of made-up data so you can look around. Signed in, only your own numbers: an empty dashboard (dashes) until your apps send data.

## What you see

- **Home:** this week's averages (steps and calories up to yesterday, because today isn't finished; sleep and weight up to today), weight change against last week, the week's workout days (trained and planned), last week in one line, the last 7 days and 30-day charts.
- **Workouts** (only once Hevy or Strong is connected): a rating for your last workout and for the last 4 weeks, workouts per week, every exercise's estimated one-rep max and its trend, and a rating for each workout this week and last.
- **Data:** one row per finished week, downloadable as CSV.
- **Profile** (the round button top right; the menu itself is only Home, Workouts and Data): your photo, name and username, then short parts, one open at a time:
  - **Integrations** (Apple Health, Health Connect, Hevy, Strong, MyFitnessPal; the icons of what's connected show on the row)
  - **Friends** (a green dot on the profile button when someone asks): find people by name or @username (private profiles only by their exact username), ask them to be friends, accept or decline requests. A friend's profile shows their dashboard; so does anyone's public profile to people signed in.
  - **Who can see your dashboard**: friends only (the default) or everyone on Motus.
  - **Standards**: your own goals (green when you reach them), training days, kg or lb, and whether weeks start on Sunday or Monday. Saved on the device, so they're there signed out too.
  - Signing out and deleting the account.

## How connecting works

```
Browser ── /api ──► Cloudflare Worker (worker/) ── D1 database (worker/schema.sql)
                      ├─ sign-in: 6-digit code by email (Resend), HttpOnly session cookie
                      ├─ Hevy: key checked once, stored encrypted (HEVY_SECRET); /v1/workouts/events every 30 min
                      ├─ /api/upload: the Motus Shortcut's Apple Health numbers (its own token)
                      └─ /api/upload/hc: HC Webhook's Health Connect numbers from Android (its own token)
iPhone: Motus Shortcut (built-in Shortcuts actions) ── POST /api/upload, run when Motus is opened
Android: HC Webhook (Google Play, open source) ── POST /api/upload/hc, every hour
```

- **Hevy** has no "Sign in with Hevy"; it gives Pro users an API key. **Connect Hevy** opens Hevy's key page; people copy the key, come back and tap **Paste key**. The server checks it with Hevy, keeps it encrypted, and fetches changes in the background.
- **Apple Health** can't be read by any website. **Connect Apple Health** adds the Motus Shortcut (one tap once it is published; until then [shortcut.html](public/shortcut.html) shows how it's built) and **Finish** runs it once with the account's upload address and token; iOS asks to allow Health. People add the daily automation themselves (iOS doesn't let apps do that).
- **Health Connect** (Android) can't be read by a website either. Connect points to HC Webhook on Google Play and downloads its settings file (Motus's address and a fresh token); importing it in HC Webhook is the whole setup. It sends Health Connect's daily totals (overlapping apps counted once) every hour. HC Webhook reads the last 48 hours, so the part-day at the start is skipped (that day arrived whole earlier), and a day's sleep keeps the longest night, since only new sessions are sent.
- **MyFitnessPal** has no open API for new apps; it writes to Apple Health and Health Connect, so it arrives with them.
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
To try Connect Hevy without a real key: `node tests/mock_hevy.mjs`, add `HEVY_API=http://127.0.0.1:8790/v1` to `.dev.vars`, and paste the key `mock-hevy-key-123` (40 made-up workouts).
On Windows, if the local database fails with `SQLITE_CANTOPEN` (path too long), add `--persist-to` with a short folder to both commands.

**First deploy to Cloudflare** (free plan to start):

1. `npx wrangler login` (opens Cloudflare in the browser to allow it).
2. `npx wrangler d1 create motus`, then put the printed `database_id` in `wrangler.jsonc`.
3. `npx wrangler d1 execute motus --remote --file worker/schema.sql`
4. Secrets: `npx wrangler secret put HEVY_SECRET` (32 random bytes, base64), `CODE_PEPPER` (any long random text), an email key (`BREVO_API_KEY` from brevo.com, free; or `RESEND_API_KEY`), and `EMAIL_FROM` (`Motus <a sender you verified with that provider>`, kept as a secret so the address stays out of the repo).
5. `npx wrangler deploy` → `https://motus.<your-subdomain>.workers.dev`.
6. To send codes reliably to everyone: a domain, verified with the email provider, as the `EMAIL_FROM` address. Brevo is tried first when its key is set.

GitHub Pages (`.github/workflows/pages.yml`) keeps publishing `public/` as the app without accounts.

## Layout

| Path | What it is |
|---|---|
| `public/` | The app: `index.html`, `workouts.html`, `weeks.html`, `connect.html`, `profile.html`, `friends.html`, `user.html` (the `/u/<username>` page: name and photo for anyone, the dashboard when you may see it), `shortcut.html`, `style.css`, `icons/` (the integrations' app icons), `js/` |
| `public/js/core.js` | Dates, goals and settings, formatting, the navbar |
| `public/js/store.js`, `merge.js` | Data on the device; sources and their priority (hand entry > Apple Health connected > Apple Health file > MyFitnessPal > spreadsheet > Hevy connected > Hevy file > Strong); merging shared with the server |
| `public/js/account.js` | Sign-in, keeping the device in step with the account, connecting Hevy, Apple Health and Health Connect, the profile |
| `public/js/health.js` | Reading the Shortcut's uploads (also phones set to Arabic), HC Webhook's, and Health Exporter JSON; shared with the server |
| `public/js/stats.js`, `demo.js`, `importers/` | Workout summaries and ratings, the demo, one importer per file type |
| `worker/` | The server: `index.js` (routes, cron), `auth.js`, `hevy.js`, `profile.js`, `friends.js` (who may see whose dashboard), `util.js`, `schema.sql` |
| `tests/` | `node tests/test_*.mjs`; `d1.mjs` runs the server's SQL on Node's SQLite; fixtures are made up |

## Privacy and security

- Signed in, a person's numbers are stored in the Motus database so they can arrive by themselves and show on any device. Only hashes of sign-in codes, session cookies, Shortcut and Health Connect tokens are stored; Hevy keys are encrypted. Deleting the account removes everything at once, the profile too.
- A profile's page shows the name, photo and username to anyone with the link. Someone's numbers show only to themselves, their friends, and, if they chose "Everyone on Motus", to people signed in; never to visitors without an account, and never their email. Clearing the username takes the page down. Photos are cropped and shrunk on the device (256 px) before they're sent.
- Sessions are HttpOnly, SameSite=Lax cookies; every change must come from Motus's own pages (Origin check). Sign-in codes expire in 10 minutes, allow 5 tries, and are rate-limited per address and per IP.
- No analytics, cookies other than the session, or third-party scripts. The pages' Content-Security-Policy allows only their own scripts and their own server.
