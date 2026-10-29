# RESUME: read this first

**Project:** Motus (public app): a fitness dashboard anyone can use. Sign in with an emailed code, connect Hevy and Apple Health once, and it stays up to date by itself; files can also be imported; demo data until then.
**Repo:** https://github.com/alyamiMohd/motusapp (public, `main`). **Live (with accounts): https://motus.motusapp.workers.dev** (Cloudflare: account subdomain `motusapp`, Worker `motus`, D1 `motus` id 4757ecc4-340b-41d4-a641-1f742da8af25, region WEUR, cron every 30 min). Pages without accounts: https://alyamimohd.github.io/motusapp/ (its Connect page links to the live app).
**Last updated:** 2026-10-29 13:50 (UTC+03, Riyadh) · last code commit `3722bb5` (Shortcut v4.1), deployed as version 08c03680, which also carries temporary files under `/setup/` (see below)
**Obsolete:** `alyamiMohd/motus-sync` (template for the earlier GitHub-copy sync, rejected as onboarding); its copies would fail now. Ask the owner before archiving/deleting it.

## Instructions for Claude
1. Read in this order: `CLAUDE.md` → this file → `user-profile.md` → `requirements.md` → `decisions.md` → `project-state.md` → `next-steps.md` → the last 3 entries of `conversation-log.md` → `skills/`.
2. Adopt `user-profile.md` from your first reply (plain, short, honest; do the work yourself; verify before claiming).
3. Do not re-ask what `requirements.md` / `decisions.md` settle. Do not reverse a recorded decision silently.
4. Before anything: `git pull --rebase`, `git status`; trust the code over these notes when they disagree, and say so.
5. Give a 3–6 line "where we left off", then continue with the next action.
6. Every change: `npm test` → check in the Browser pane at 390px and 320px when UI changed → secret scan → commit and push → `npx wrangler deploy` → restart `npx wrangler tail motus --format pretty` (it stops following after every deploy) → update `.handoff/`.

## Current status
- **Live and working for the owner:** email-code sign-in (codes from the owner's Gmail via Apps Script, D-023), Connect Apple Health through the Motus Shortcut, 30 days of food, weight and sleep stored (29 Sep–29 Oct), Hijri dates converted (D-024).
- **Shortcut v4.1 (`3722bb5`, D-028) works on the owner's iPhone for the 3-day run:** one upload per day with that day's step and energy samples as whole-list columns (values, device names, units); the server adds each device and keeps the busiest. The owner: steps are "much closer than before". 13:40 run: 27–29 Oct, steps from 2 devices each day.
- **In progress:** the owner is running Finish (the 30-day run: food/weight/sleep in one upload, then 30 day uploads). Check the log: 30 `day` uploads, sensible sample counts.
- **What Shortcuts can and can't do (measured on the owner's iPhone, 2026-10-29; don't retry the failures):** Group By Day sums every device; a Source filter is applied after grouping; grouping an earlier Find's list ignores the list; Source text filters (contains Watch/iPhone) let every sample through; "Source is" with a variable errors; "Start Date is after <var>" lets nothing through; "Start Date is between <var> and <var>" works; "Adjust Date subtract <Repeat Index> days" is ignored (fixed 1-day steps work); a month of single samples in one Find stops the run; empty Finds don't error; Get Details and Combine Text work on whole lists in order.
- **Signing:** one testing certificate for the testing period (owner's choice): GitHub secrets `MOTUS_SIGN_KEY/CERT/ROOT`, root key destroyed, expires 28 Nov 2026, fingerprint D2:E2:C7:84…; the owner's iPhone trusts it. New version = delete Motus → open https://motus.motusapp.workers.dev/setup/Motus.shortcut → Add. Remove the secrets and the profile when testing ends.
- **Temporary, deployed but NOT in git:** `public/setup/` (in `.git/info/exclude`) and a TEMPORARY block in `public/_headers` (never commit it).
- `SHORTCUT_URL` (`public/js/account.js`) and `public/shortcut.html` still point to the **old v1** iCloud link `eb6a8c01…`. Needs the owner's iCloud link of v4.x.
- Tests: 206 checks pass (core 43, importers 65, store 20, server 78).
- Not tested with real data: Hevy (owner won't connect their own key), the daily automation.

## Next action
After the 30-day Finish run: read the log (30 day uploads), ask the owner to compare a few days with the Health app. Then: owner shares Motus → Copy iCloud Link → set `SHORTCUT_URL` and the link in `public/shortcut.html`; delete `public/setup/`, `git checkout public/_headers`; deploy; commit. Then make the first run faster (sleep is a 674-step loop, ~2 min), remove the upload-shape log, set up the daily automation.

## Open questions waiting on the owner
- The v4.x iCloud link (after the 30-day run is right).
- Archive or delete `alyamiMohd/motus-sync`? Default: leave it.
- A domain; Workers Paid when real users come; licence. `.handoff/` stays public (owner knows).

## Last thing in progress
Owner: "its much cloesr than before, let me try finish then check". Claude is waiting for the 30-day run and updated these notes meanwhile.
