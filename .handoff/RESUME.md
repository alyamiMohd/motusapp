# RESUME: read this first

**Project:** Motus (public app): a browser-only fitness dashboard anyone can use. Visitors see demo data, then import their own from Apple Health, Hevy, Strong, MyFitnessPal or a CSV; everything stays on their device.
**Repo:** https://github.com/alyamiMohd/motusapp (public, branch `main`) · **Live:** https://alyamimohd.github.io/motusapp/
**Last updated:** 2026-10-26 15:40 (UTC+03, Riyadh) · **Code state:** commit `32b3c2c` (this handoff is the next commit on top).
**Related:** the owner's personal dashboard `alyamiMohd/motus` (own data, own GitHub Actions pipeline) keeps running separately; this app was built from its code on 2026-10-26.

## Instructions for Claude
1. Read in this order: `CLAUDE.md` → this file → `user-profile.md` → `requirements.md` → `decisions.md` → `project-state.md` → `next-steps.md` → the last 3 entries of `conversation-log.md` → `skills/`.
2. Adopt `user-profile.md` from your first reply (plain, short, honest; do the work yourself; verify before claiming).
3. Do not re-ask what `requirements.md` / `decisions.md` settle. Do not reverse a recorded decision silently.
4. Before anything: `git pull --rebase`, `git status`; trust the code and the live site over these notes when they disagree, and say so.
5. Give a 3–6 line "where we left off", then continue with the next action.
6. Every change: `npm test` → check the UI in the Browser pane at 390px and 320px → secret/personal-data scan → commit and push to `main` → check the Actions run and the live site → update `.handoff/`.

## Current status
- Live and verified on 2026-10-26: Home, Workouts, Weeks, Connect; demo data shows for new visitors; no console errors; no sideways scroll at 375/390/320.
- Imports built and tested (128 automated checks, all passing locally and on GitHub Actions): Apple Health `export.zip`/`export.xml` and Health Exporter JSON, Hevy (API key or CSV), Strong CSV (old and new formats), MyFitnessPal Premium zip/CSVs, generic CSV template, hand entry, backup/restore, delete everything.
- In a real browser (Edge, Browser pane): Apple zip, MyFitnessPal zip and Hevy CSV imported through the page; a fake Hevy key reached Hevy and got a clear "didn't accept that key" message; hostile exercise names displayed as text.
- **Not verified against real exports**: every fixture is made up from each app's documented/known format. The menu paths written on the Connect page for Hevy, Strong and MyFitnessPal are from memory, not checked in the apps.
- Not tested on a real iPhone (Safari file picker with a large `export.zip`).

## Next action
Ask the owner to try the live site with their own real exports (Apple Health `export.zip`, Hevy key or CSV, MyFitnessPal), on their iPhone, and report anything that fails or reads wrong. Fix what breaks, then work through `next-steps.md`.

## Open questions waiting on the owner
- A licence for the code (none yet, so by default nobody may reuse it)? Options: MIT, or keep all rights.
- A custom domain? It would give the app its own browser storage origin (today it shares `alyamimohd.github.io` with the old `motus` site) and a nicer address.
- This handoff folder is public in a public repo (it holds working preferences and chat history). Keep it, or move it to a private repo?
- Which apps to support next (Google Fit/Health Connect, Fitbit, Garmin, Withings…)?

## Last thing in progress
The owner asked (2026-10-26): create a new repo `motusapp`, remove their own integrations and use dummy data, add an integrations section for Hevy, MyFitnessPal, Strong, iOS Health and others, and make it for public use. All of that shipped and is live; nothing is half-done.
