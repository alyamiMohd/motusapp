# Motus

A quiet, private dashboard for your sleep, steps, food, weight and workouts.

**Open it:** https://alyamimohd.github.io/motusapp/

- **Connect once, then it keeps itself up to date.** The Connect page's *Automatic* setup (about ten minutes, once) uses your own free GitHub account: your iPhone sends Apple Health every day (MyFitnessPal and other apps come along through Health), and Hevy is fetched every few hours. See [Automatic sync](#automatic-sync).
- **No Motus account, no Motus server.** Motus runs in your browser and keeps what you see on your device. Automatic sync stores only a file encrypted with a key that you hold.
- **Or import a file** whenever you like: Apple Health, Hevy (API key or export), Strong, MyFitnessPal, or any app through a simple spreadsheet. You can also type a day by hand.
- **Demo first.** Until you connect something, Motus shows five months of made-up data so you can look around.

## Automatic sync

```
iPhone: Motus Shortcut (daily automation) ──repository_dispatch──┐
Hevy API ◄── every 3 hours ───────────────────────────────────────┤
                                     your copy of alyamiMohd/motus-sync (GitHub Actions)
                                     └─ runs sync/run.mjs from this repo
                                     └─ publishes motus-data.enc (AES-256-GCM, your MOTUS_KEY) on your GitHub Pages
Motus in your browser ── fetches motus-data.enc on every visit ── opens it with the key saved on your device
```

- Each person makes their own copy of the template [alyamiMohd/motus-sync](https://github.com/alyamiMohd/motus-sync) (public is fine: only the encrypted file is published, and the job never prints numbers). Setup: [Connect → Automatic](https://alyamimohd.github.io/motusapp/connect.html#auto); iPhone part: [shortcut.html](https://alyamimohd.github.io/motusapp/shortcut.html).
- The job reads the phone's upload from GitHub's event file. It is never passed as an environment variable, because GitHub prints a step's environment in the (public) log.
- If the job can't open the data already published with its `MOTUS_KEY`, it stops without changing anything (unless started by hand with *Start over*). A Hevy problem fails the run so GitHub e-mails the owner of the copy; the data that did arrive is still published.
- MyFitnessPal has no open API for new apps, so its numbers come through Apple Health. No website can read Apple Health, which is why the iPhone needs the Shortcut.
- Later: real accounts with email-code sign-in, so people without GitHub can use automatic sync too.

## What you see

- **Home:** this week's averages (steps and calories up to yesterday, because today isn't finished; sleep and weight up to today), weight change against last week, a week strip of training days, last week in one line, the last 7 days and 30-day charts.
- **Workouts:** a rating for your last workout and for the last 4 weeks, workouts per week, every exercise's estimated one-rep max and its trend, and a rating for each workout this week and last.
- **Weeks:** one row per finished week, downloadable as CSV.
- **Standards:** your own goals (green when you reach them), training days, kg or lb, and whether weeks start on Sunday or Monday.

## Supported imports

| App | What comes in | How |
|---|---|---|
| Apple Health | steps, sleep, food energy, weight | Health app → your picture → Export All Health Data → choose `export.zip`. Also reads JSON from the Health Exporter app. |
| Hevy | workouts | API key (Hevy Pro; requests go straight from your browser to `api.hevyapp.com`), or the app's CSV export |
| Strong | workouts | Settings → Export Strong Data → choose the CSV |
| MyFitnessPal | calories, weight | Premium data export (zip or its CSVs). Free accounts: sync to Apple Health and import that. |
| Anything else | any of the above | A CSV with `date,sleep_hours,steps,calories,weight_kg,workouts,workout_minutes` (template on the Connect page) |

Apple Health exports list every sample from every device, so an iPhone and a watch both counting the same walk appear twice. Motus takes, for each day, the single source with the highest total, which is close to what the Health app shows.

## Run it locally

No build step and no dependencies; Node 20 or newer.

```bash
npm start      # http://localhost:8098
npm test       # importers, averaging rules, storage
```

## Layout

| Path | What it is |
|---|---|
| `index.html`, `workouts.html`, `weeks.html`, `connect.html`, `shortcut.html`, `style.css` | The pages |
| `js/core.js` | Dates, goals and settings, formatting, the navbar |
| `js/store.js` | On-device storage; merges sources (hand entry > automatic sync > Apple Health > MyFitnessPal > spreadsheet > Hevy > Strong) |
| `js/stats.js` | Workout summaries, estimated 1RM, ratings, weekly history |
| `js/demo.js` | The demo data |
| `js/sync.js` | Automatic sync: the key, encryption, opening the sync file, refreshing on every visit |
| `sync/run.mjs`, `sync/template/` | The job each person's copy runs, and the files of the motus-sync template repo |
| `js/importers/` | One file per app, plus a CSV/date helper and a small zip reader |
| `tests/` | `node tests/test_*.mjs`; fixtures are made up |

## Privacy

Motus has no backend, analytics, cookies or trackers. Pages are served by GitHub Pages, which sees visitors' IP addresses like any web host. With automatic sync, the phone's upload and the Hevy pull pass through the person's own GitHub copy while its job runs; what is stored and published is encrypted with their key. A Content-Security-Policy limits the pages to their own scripts, `api.hevyapp.com` (optional Hevy sync) and `*.github.io` (sync files).
