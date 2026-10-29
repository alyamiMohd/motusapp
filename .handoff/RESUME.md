# RESUME: read this first

**Project:** Motus (public app): a fitness dashboard anyone can use. Sign in with an emailed code, connect Hevy and Apple Health once, and it stays up to date by itself; files can also be imported; demo data until then.
**Repo:** https://github.com/alyamiMohd/motusapp (public, `main`). **Live (with accounts): https://motus.motusapp.workers.dev** (Cloudflare: account subdomain `motusapp`, Worker `motus`, D1 `motus` id 4757ecc4-340b-41d4-a641-1f742da8af25, region WEUR, cron every 30 min). Pages without accounts: https://alyamimohd.github.io/motusapp/ (its Connect page links to the live app).
**Last updated:** 2026-10-29 14:45 (UTC+03, Riyadh) · last code commit `ecba543` (Shortcut v5.2), deployed as version 86abf3fd, which also carries temporary files under `/setup/` (see below)
**Obsolete:** `alyamiMohd/motus-sync` (template for the earlier GitHub-copy sync, rejected as onboarding); its copies would fail now. Ask the owner before archiving/deleting it.

## Instructions for Claude
1. Read in this order: `CLAUDE.md` → this file → `user-profile.md` → `requirements.md` → `decisions.md` → `project-state.md` → `next-steps.md` → the last 3 entries of `conversation-log.md` → `skills/`.
2. Adopt `user-profile.md` from your first reply (plain, short, honest; do the work yourself; verify before claiming).
3. Do not re-ask what `requirements.md` / `decisions.md` settle. Do not reverse a recorded decision silently.
4. Before anything: `git pull --rebase`, `git status`; trust the code over these notes when they disagree, and say so.
5. Give a 3–6 line "where we left off", then continue with the next action.
6. Every change: `npm test` → check in the Browser pane at 390px and 320px when UI changed → secret scan → commit and push → `npx wrangler deploy` → restart `npx wrangler tail motus --format pretty` (it stops following after every deploy) → update `.handoff/`.

## Current status
- **Shortcut v5.2 works end to end on the owner's iPhone** (Finish 14:39 → back to Motus 14:41, ~2.5 min for 30 days; daily run seconds): no loops over samples anywhere; food, weight, sleep as whole-list columns in one upload, then one upload per day with steps/energy values, sources, start times and the phone's name. D-030, D-031.
- **Steps merged like the Health app (D-030):** hour by hour, only the highest-ranked source with steps in that clock hour counts; order Health entries > Watches > phones (name has "iPhone" or equals the phone's own name, sent as `device`; the owner's iPhone is "iMone") > apps; ties busier first. Matches Health exactly on 27 Oct (6,632) and 29 Oct (4,481 at the time), 28 Oct 4,485 vs 4,491; 20 Oct 10,173 vs 9,977 (+2%). Other days only compared to the chart by eye (±200); a few look ±700–800 off: asked the owner for exact values of 30 Sep, 5, 16, 19, 22, 23 Oct. Possible refinement: a phone sample crossing an hour boundary probably blocks the next hour too (needs end times again).
- **What Shortcuts can and can't do (measured, 2026-10-29; don't retry):** Group By Day sums every source; Source filters (picker with variable errors; text contains/begins/ends let everything through) never filter; grouping an earlier Find's list ignores the list; "Start Date is after <var>" lets nothing through; "is between <var> and <var>" works; "Adjust Date subtract <Repeat Index> days" is ignored (fixed 1-day steps work); a month of single samples in one Find stops the run; empty Finds don't error; Get Details, Format Date (given the list in a text field) and Combine Text work on whole lists in order; per-sample Repeat loops are slow and memory-heavy (v5.1's 30-day run stopped at the end); a run cut off when the phone leaves Shortcuts ("Could not connect to the server"); no Shortcuts action exposes Health's own merged totals.
- **Signing:** one testing certificate (D-029): GitHub secrets `MOTUS_SIGN_KEY/CERT/ROOT`, expires 28 Nov 2026, fingerprint D2:E2:C7:84…, trusted on the owner's iPhone. New version = delete Motus → open https://motus.motusapp.workers.dev/setup/Motus.shortcut → Add.
- **Temporary, deployed but NOT in git:** `public/setup/` (in `.git/info/exclude`) and a TEMPORARY block in `public/_headers` (never commit it).
- `SHORTCUT_URL` (`public/js/account.js`) and `public/shortcut.html` still point to the **old v1** iCloud link `eb6a8c01…`.
- Data: 31 days stored (29 Sep is an old doubled leftover); sleep 26 nights, 3 over 11 h (10, 16, 20 Oct) not yet checked by the owner.
- Tests: 215 checks pass (core 43, importers 65, store 20, server 87).

## Next action
Get the owner's exact Health steps for 30 Sep, 5, 16, 19, 22, 23 Oct and compare; refine the hourly rule if needed (likely: a phone sample spanning two hours blocks both, which needs end times sent again). Then: owner shares Motus → Copy iCloud Link → `SHORTCUT_URL` + `public/shortcut.html`; delete `public/setup/`, `git checkout public/_headers`; deploy; commit. Then the daily automation, remove the upload-shape log, remove the testing certificate secrets and profile.

## Open questions waiting on the owner
- The v4.x iCloud link (after the 30-day run is right).
- Archive or delete `alyamiMohd/motus-sync`? Default: leave it.
- A domain; Workers Paid when real users come; licence. `.handoff/` stays public (owner knows).

## Last thing in progress
Owner: "I ran Set up again → Finish with Shortcuts open, and it went back to Motus without an error." Claude confirmed in D1 (31 days, last upload 14:41:36) and asked for exact Health numbers for six days.
