# RESUME: read this first

**Project:** Motus (public app): a fitness dashboard anyone can use. Sign in with an emailed code, connect Hevy and Apple Health once, and it stays up to date by itself; files can also be imported; demo data until then.
**Repo:** https://github.com/alyamiMohd/motusapp (public, `main`). **Live (with accounts): https://motus.motusapp.workers.dev** (Cloudflare: account subdomain `motusapp`, Worker `motus`, D1 `motus` id 4757ecc4-340b-41d4-a641-1f742da8af25, region WEUR, cron every 30 min). Pages without accounts: https://alyamimohd.github.io/motusapp/ (its Connect page links to the live app).
**Last updated:** 2026-10-29 (UTC+03, Riyadh) · last code commit `be21130` (Shortcut v3), deployed as version 10dc3677, which also carries two temporary files under `/setup/` (see below)
**Obsolete:** `alyamiMohd/motus-sync` (template for the earlier GitHub-copy sync, rejected as onboarding); its copies would fail now. Ask the owner before archiving/deleting it.

## Instructions for Claude
1. Read in this order: `CLAUDE.md` → this file → `user-profile.md` → `requirements.md` → `decisions.md` → `project-state.md` → `next-steps.md` → the last 3 entries of `conversation-log.md` → `skills/`.
2. Adopt `user-profile.md` from your first reply (plain, short, honest; do the work yourself; verify before claiming).
3. Do not re-ask what `requirements.md` / `decisions.md` settle. Do not reverse a recorded decision silently.
4. Before anything: `git pull --rebase`, `git status`; trust the code over these notes when they disagree, and say so.
5. Give a 3–6 line "where we left off", then continue with the next action.
6. Every change: `npm test` → check in the Browser pane at 390px and 320px when UI changed → secret scan → commit and push → `npx wrangler deploy` → restart `npx wrangler tail motus --format pretty` (it stops following after every deploy) → update `.handoff/`.

## Current status
- **Live and working for the owner:** email-code sign-in (codes sent from the owner's Gmail through an Apps Script web app, D-023), sessions, Connect Apple Health through the Motus Shortcut (Finish → Health permission → upload), Home filled from real Health data (21–28 Oct 2026 stored, Hijri dates converted, D-024).
- **Shortcut v3 (`be21130`, D-027) replaced v2**: v2's raw samples were blocked by iOS (large data). v3 sends a day total per source (steps, active energy), numbered, never device names. Waiting for the owner to install it (root fingerprint 0B:F4:D1:44…).
- Earlier, v2 (`fd29eb5`): one Shortcut, two modes. Run from **Finish** (it gets text input) → reads the last 30 days; run by the daily automation or a tap (no input) → last 2 days, plus 7 days of food and weight. Steps and Active Calories go sample by sample with their Source; the server keeps the busiest source per day, which fixes the owner's "steps are doubled" (iPhone + Watch were summed). Dietary Calories fills missing days with 0 so it no longer stops on "No Samples Found". D-025, D-026.
- **Temporary download, live now:** https://motus.motusapp.workers.dev/setup/motus-shortcut-signing.mobileconfig and https://motus.motusapp.workers.dev/setup/Motus.shortcut (now v3, signing run 40831094221). They are deployed but NOT in git: `public/setup/` is in `.git/info/exclude`, and the uncommitted edit to `public/_headers` (a block marked TEMPORARY) must not be committed.
- `SHORTCUT_URL` in `public/js/account.js` and the button in `public/shortcut.html` still point to the **old v1** iCloud link `https://www.icloud.com/shortcuts/eb6a8c01f9194356bfac351f9c1c238f` (doubles steps, no 30-day first run).
- Tests: 197 checks pass (`npm test`: core 43, importers 65, store 20, server 69). Upload reader benchmark: 18,000 samples in ~12–19 ms on the laptop; the free plan allows 10 ms CPU, so a 30-day first upload may hit the limit.
- Not tested with real data: Hevy (owner won't connect their own key), the daily automation, the v2 Shortcut.
- A background `wrangler tail` was running in the old session; it does not survive a new session.

## Next action
Wait for the owner to install v2 on the iPhone: remove the old signing profile → install the new profile and turn on full trust (Settings → General → About → Certificate Trust Settings) → delete the old Motus shortcut → add the new one keeping the name exactly "Motus" → tap Finish in Motus → Connect → Share → Copy iCloud Link. Then: check the log/D1 (counts only, never values) that 30 days arrived and steps are no longer doubled; put the new link into `SHORTCUT_URL` and `public/shortcut.html`; delete `public/setup/`, revert `public/_headers` (`git checkout public/_headers`); deploy; commit. If the upload fails on CPU, tell the owner the fix is Workers Paid ($5/month).

## Open questions waiting on the owner
- The v2 iCloud link (after they install it).
- Archive or delete `alyamiMohd/motus-sync`? Default: leave it until asked.
- A domain (for code emails from Motus and a nice address); maybe Cloudflare Email later. Workers Paid when real users come. Licence. Keep `.handoff/` public (repo is public; owner knows).

## Last thing in progress
Owner's last messages: "if it already exists don't make it no more, but how, When I click finish does it invoke another shortcut? or just the shortcut "Motus" that i shared the link with u". Claude answered: Finish runs the same "Motus" Shortcut via `shortcuts://run-shortcut?name=Motus&input=text&text=<url>|<token>`; with input it saves motus.txt and reads 30 days, without input it reads motus.txt and 2 days; the link they shared before is v1, so they must install the new one from /setup/. No separate "Starter Motus" will be made. Then the owner ran `/handoff` (this save).
