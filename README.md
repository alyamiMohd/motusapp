# Motus

A quiet, private dashboard for your sleep, steps, food, weight and workouts.

**Open it:** https://alyamimohd.github.io/motusapp/

- **Your data stays on your device.** Motus runs entirely in your browser. There are no accounts and no server; what you import is saved in your browser's storage and never uploaded.
- **Bring it from the apps you already use** (the Connect page): Apple Health, Hevy (API key or export), Strong, MyFitnessPal, or any app through a simple spreadsheet. You can also type a day by hand.
- **Demo first.** Until you import something, Motus shows five months of made-up data so you can look around.

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
| `index.html`, `workouts.html`, `weeks.html`, `connect.html`, `style.css` | The pages |
| `js/core.js` | Dates, goals and settings, formatting, the navbar |
| `js/store.js` | On-device storage; merges sources (hand entry > Apple Health > MyFitnessPal > spreadsheet > Hevy > Strong) |
| `js/stats.js` | Workout summaries, estimated 1RM, ratings, weekly history |
| `js/demo.js` | The demo data |
| `js/importers/` | One file per app, plus a CSV/date helper and a small zip reader |
| `tests/` | `node tests/test_*.mjs`; fixtures are made up |

## Privacy

Motus has no backend, analytics, cookies or trackers. Pages are served by GitHub Pages, which sees visitors' IP addresses like any web host. A Content-Security-Policy limits the pages to their own scripts and to `api.hevyapp.com` for the optional Hevy sync.
