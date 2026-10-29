# RESUME: read this first

**Project:** Motus (public app): a fitness dashboard anyone can use. Sign in with an emailed code, connect Hevy and Apple Health once, and it stays up to date by itself; files can also be imported; demo data until then.
**Repo:** https://github.com/alyamiMohd/motusapp (public, `main`). **Live (with accounts): https://motus.motusapp.workers.dev** (Cloudflare: account subdomain `motusapp`, Worker `motus`, D1 `motus` id 4757ecc4-340b-41d4-a641-1f742da8af25, region WEUR, cron every 30 min). Pages without accounts: https://alyamimohd.github.io/motusapp/ (its Connect page links to the live app).
**Last updated:** 2026-10-29 16:35 (UTC+03, Riyadh) · last code commit `e1c16d5`, deployed as version cc57c6ea (no temporary files any more)
**Obsolete:** `alyamiMohd/motus-sync` (template for the earlier GitHub-copy sync, rejected as onboarding); its copies would fail now. Ask the owner before archiving/deleting it.

## Instructions for Claude
1. Read in this order: `CLAUDE.md` → this file → `user-profile.md` → `requirements.md` → `decisions.md` → `project-state.md` → `next-steps.md` → the last 3 entries of `conversation-log.md` → `skills/`.
2. Adopt `user-profile.md` from your first reply (plain, short, honest; do the work yourself; verify before claiming).
3. Do not re-ask what `requirements.md` / `decisions.md` settle. Do not reverse a recorded decision silently.
4. Before anything: `git pull --rebase`, `git status`; trust the code over these notes when they disagree, and say so.
5. Give a 3–6 line "where we left off", then continue with the next action.
6. Every change: `npm test` → check in the Browser pane at 390px and 320px when UI changed → secret scan → commit and push → `npx wrangler deploy` → restart `npx wrangler tail motus --format pretty` (it stops following after every deploy) → update `.handoff/`.

## Current status
- **Steps now match the Health app**: after the owner's v5.4 Finish (16:19–16:21), all 29 comparable days are within 1% of their Health chart (mean 0.12%; the chart is read to ±50 steps), 27 and 28 Oct exact (6,632 / 4,491). Rule (D-032): quarter hours on the clock, each sample spread over the quarters it spans, only the top source with steps in a quarter counts (Health entries > Watches > phones incl. the Shortcut's own phone `device` > apps), only the day's own quarters (the Shortcut also reads the 3 h before each day).
- **Shortcut v5.4** works end to end (Finish ~2.5 min for 30 days, daily run seconds): no loops over samples; food/weight/sleep as columns in one upload, then one upload per day (steps values, sources, starts, ends; energy values, sources, units, starts; day; device). D-031.
- **Intermittent "Could not connect to the server"** on the owner's phone during Finish (14:31, 16:06, 16:17); the server saw nothing wrong; manual 3-day runs work. Probably the phone/cell connection dropping one of 31 uploads. Asked the owner to try Wi-Fi; the 16:19 run then completed. Idea if it keeps happening: fewer, bigger uploads (CPU per day upload is already 5–28 ms on the free plan and passes).
- Still open: 3 sleep nights over 11 h (10, 16, 20 Oct) not confirmed by the owner; 29 Sep is an old doubled leftover (8,723) outside the 30-day window.

- **What Shortcuts can and can't do (measured, 2026-10-29; don't retry):** Group By Day sums every source; Source filters (picker with variable errors; text contains/begins/ends let everything through) never filter; grouping an earlier Find's list ignores the list; "Start Date is after <var>" lets nothing through; "is between <var> and <var>" works; "Adjust Date subtract <Repeat Index> days" is ignored (fixed 1-day steps work); a month of single samples in one Find stops the run; empty Finds don't error; Get Details, Format Date (given the list in a text field) and Combine Text work on whole lists in order; per-sample Repeat loops are slow and memory-heavy (v5.1's 30-day run stopped at the end); a run cut off when the phone leaves Shortcuts ("Could not connect to the server"); no Shortcuts action exposes Health's own merged totals.
- **Signing:** one testing certificate (D-029): GitHub secrets `MOTUS_SIGN_KEY/CERT/ROOT`, expires 28 Nov 2026, fingerprint D2:E2:C7:84…, trusted on the owner's iPhone. New version = delete Motus → open https://motus.motusapp.workers.dev/setup/Motus.shortcut → Add.
- `/setup/` and its TEMPORARY `_headers` block are removed (2026-10-29 16:35); `public/setup/` stays in `.git/info/exclude` for the next test version.
- **Everyone now gets v5.4:** `SHORTCUT_URL` and `public/shortcut.html` point to the owner's iCloud link https://www.icloud.com/shortcuts/d49da9d79d1e49bca0092a4fdd53ef07 (checked: 141 actions, the v5.4 features). Apple signs iCloud links, so no profile for anyone else.
- Data: 31 days stored (29 Sep is an old doubled leftover); sleep 26 nights, 3 over 11 h (10, 16, 20 Oct) not yet checked by the owner.
- Tests: 215 checks pass (core 43, importers 65, store 20, server 87).

## Next action
The daily automation on the owner's iPhone (Shortcuts → Automation → Time of Day → Daily → Run Immediately → Motus) and a check the next morning; then remove the upload-shape log; decide whether to keep the testing certificate (GitHub secrets `MOTUS_SIGN_*`, expires 28 Nov; the owner can remove the profile from the iPhone now). Open data questions: 3 sleep nights over 11 h (10, 16, 20 Oct), 29 Sep's doubled leftover (delete only with the owner's yes). To ship a new Shortcut version: build → sign (testing cert) → `public/setup/` + TEMPORARY `_headers` → owner tests → owner shares iCloud link → swap the link, remove setup.

## Open questions waiting on the owner
- The v4.x iCloud link (after the 30-day run is right).
- Archive or delete `alyamiMohd/motus-sync`? Default: leave it.
- A domain; Workers Paid when real users come; licence. `.handoff/` stays public (owner knows).

## Last thing in progress
Owner: "Ok the finish has completed, check the data and everything". Claude: 29/29 days within 1% of Health. The owner also asked how Claude reaches the server and how to see the data/users (Cloudflare dashboard → D1 → motus; `wrangler d1 execute`).
