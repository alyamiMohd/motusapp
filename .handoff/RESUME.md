# RESUME: read this first

**Project:** Motus (public app): a fitness dashboard anyone can use. Visitors see demo data, then connect once (automatic sync through their own free GitHub copy) or import files from Apple Health, Hevy, Strong, MyFitnessPal or a CSV.
**Repos:** https://github.com/alyamiMohd/motusapp (the app, public, `main`) · https://github.com/alyamiMohd/motus-sync (public **template** each person copies for automatic sync; its files live in `motusapp/sync/template/`)
**Live:** https://alyamimohd.github.io/motusapp/ · **Last updated:** 2026-10-27 10:40 (UTC+03, Riyadh)
**Related:** the owner's personal dashboard `alyamiMohd/motus` keeps running separately.

## Instructions for Claude
1. Read in this order: `CLAUDE.md` → this file → `user-profile.md` → `requirements.md` → `decisions.md` → `project-state.md` → `next-steps.md` → the last 3 entries of `conversation-log.md` → `skills/`.
2. Adopt `user-profile.md` from your first reply (plain, short, honest; do the work yourself; verify before claiming).
3. Do not re-ask what `requirements.md` / `decisions.md` settle. Do not reverse a recorded decision silently.
4. Before anything: `git pull --rebase`, `git status`; trust the code and the live site over these notes when they disagree, and say so.
5. Give a 3–6 line "where we left off", then continue with the next action.
6. Every change: `npm test` → check the UI in the Browser pane at 390px and 320px → secret/personal-data scan → commit and push to `main` (and to `motus-sync` if `sync/template/` changed) → check the Actions run and the live site → update `.handoff/`.

## Current status
- Live: Home, Workouts, Weeks, Connect (Automatic setup first, then one-off imports), Shortcut instructions page. 162 automated checks pass.
- **Automatic sync works end to end (tested 2026-10-27 on the template repo itself, with made-up data):** a phone-style upload (`repository_dispatch`) → the job opened the previous encrypted file, merged, published `motus-data.enc` on GitHub Pages → the app connected through the "link for another device" and showed exactly the uploaded numbers. Hevy-in-the-job is covered by tests with a faked Hevy, not run live (no key available to Claude).
- The first live run exposed that GitHub prints a step's env in the public log; the upload is now read from the event file and a test guards it. That first run's log (only made-up numbers) is still visible in motus-sync's Actions history.
- The template repo `motus-sync` has a **test** `MOTUS_KEY` secret and GitHub Pages on (serving the made-up encrypted test data). Copies don't inherit either. The test key is in Claude's scratchpad only.
- Not yet done by anyone: building the real **Motus Shortcut** on an iPhone (steps on `shortcut.html`), and trying imports or the whole flow with real data on a real iPhone.

## Next action
The owner builds the Motus Shortcut once on their iPhone (https://alyamimohd.github.io/motusapp/shortcut.html), sets up their own copy through Connect → Automatic, and reports what happens. If it works, they share the Shortcut's iCloud link: put it in `SHORTCUT_URL` in `js/pages/connect.js` (ideally with import questions for the copy's name and the token) so other people get it in one tap.

## Open questions waiting on the owner
- Licence for the code (none yet). Custom domain (also gives the app its own storage origin). Keep `.handoff/` public or move it.
- Later phase: real accounts with **email-code sign-in** (the owner's choice, 2026-10-27) and a small server, so people without GitHub get automatic sync too. Needs a host (e.g. Cloudflare, the owner creates the account), an email-sending service and a domain.

## Last thing in progress
"The whole point of this, is to once connect your apps, and then have it fully automated the whole time". Owner chose: "For now make it use the github actions to pull what's required"; approved creating `alyamiMohd/motus-sync`. All built, pushed and tested; waiting for the owner's iPhone test.
