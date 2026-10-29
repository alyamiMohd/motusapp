# RESUME: read this first

**Project:** Motus (public app): a fitness dashboard anyone can use. Sign in with an emailed code; everything personal lives in the **Profile** (Integrations: Apple Health, Health Connect, Hevy, Strong, MyFitnessPal; Friends; Privacy; Standards; About; Account). Menu: Home, Workouts (with a tracker), Data. Visitors see a demo on Home; signed-in people without data see a blurred, locked sample until their apps send numbers.
**Repo:** https://github.com/alyamiMohd/motusapp (public, `main`). **Live (with accounts): https://motus.motusapp.workers.dev** (Cloudflare: account subdomain `motusapp`, Worker `motus`, D1 `motus` id 4757ecc4-340b-41d4-a641-1f742da8af25, region WEUR, cron every 30 min). Pages without accounts: https://alyamimohd.github.io/motusapp/ (its Connect page links to the live app).
**Last updated:** 2026-10-29 (UTC+03, Riyadh) · last code commit `adbac1f` (blur edge fix), deployed as version 182baa84
**Obsolete:** `alyamiMohd/motus-sync` (template for the earlier GitHub-copy sync, rejected as onboarding); its copies would fail now. Ask the owner before archiving/deleting it.

## Instructions for Claude
1. Read in this order: `CLAUDE.md` → this file → `user-profile.md` → `requirements.md` → `decisions.md` → `project-state.md` → `next-steps.md` → the last 3 entries of `conversation-log.md` → `skills/`.
2. Adopt `user-profile.md` from your first reply (plain, short, honest; do the work yourself; verify before claiming).
3. Do not re-ask what `requirements.md` / `decisions.md` settle. Do not reverse a recorded decision silently.
4. Before anything: `git pull --rebase`, `git status`; trust the code over these notes when they disagree, and say so.
5. Give a 3–6 line "where we left off", then continue with the next action.
6. Every change: `npm test` → check in the Browser pane at 390px and 320px when UI changed → secret scan → commit and push → `npx wrangler deploy` → restart `npx wrangler tail motus --format pretty` (it stops following after every deploy) → update `.handoff/`.

## Current status
- **New this session (2026-10-29, session 2; all live unless noted):** brand kit applied (black theme, cape mark, icons, social card; D-038); **friends + public/private profiles** (D-039; tables `sharing`, `friends`, `friend_requests` live); Friends, Standards, Integrations, Privacy, About, Account all inside the **Profile hub** (D-040, D-041); green dot on the profile button for friend requests; default picture = the cape mark; **Weeks renamed Data**; signed in = never the demo; **locked starter look** (D-042): Home without data shows a blurred sample fading down under "Integrate your data"; Data is locked the same way for anyone without their own data; the week strip stays blurred under "Set training days" until days are picked (prefs.daysSet). Copy cut hard everywhere (owner: the audience has ADHD, hates text). Tests: 299 checks (core 43, importers 65, store 20, server 145).
- Not tried with two real accounts on the live site (only the owner can receive codes until a domain), nor the Profile/Integrations flows on a real iPhone after the redesign.
- **New 2026-10-29 (`6be8e99`, live):** Connect = sign-in, then **Integrations** rows with real app icons (Apple Health, Health Connect, Hevy, Strong, MyFitnessPal), one setup each; file imports/hand entry/backup removed from the UI (R-015–R-017). Signed out: demo on Home, sign-in on Connect and Profile (D-034). **Profile** (round button top right): photo, name, username, share link `/u/<username>` showing only those three; sign out and delete moved there; `profiles` table live (D-035). **Android** via HC Webhook + a downloaded settings file → `/api/upload/hc` (D-036/D-037), untested on a real phone. **Workouts** hidden until Hevy or Strong; **Home** "Workout days" with a trained/planned key. Tests: 245 checks.
- **Steps now match the Health app**: after the owner's v5.4 Finish (16:19–16:21), all 29 comparable days are within 1% of their Health chart (mean 0.12%; the chart is read to ±50 steps), 27 and 28 Oct exact (6,632 / 4,491). Rule (D-032): quarter hours on the clock, each sample spread over the quarters it spans, only the top source with steps in a quarter counts (Health entries > Watches > phones incl. the Shortcut's own phone `device` > apps), only the day's own quarters (the Shortcut also reads the 3 h before each day).
- **Shortcut v5.4** works end to end (Finish ~2.5 min for 30 days, daily run seconds): no loops over samples; food/weight/sleep as columns in one upload, then one upload per day (steps values, sources, starts, ends; energy values, sources, units, starts; day; device). D-031.
- **Intermittent "Could not connect to the server"** on the owner's phone during Finish (14:31, 16:06, 16:17); the server saw nothing wrong; manual 3-day runs work. Probably the phone/cell connection dropping one of 31 uploads. Asked the owner to try Wi-Fi; the 16:19 run then completed. Idea if it keeps happening: fewer, bigger uploads (CPU per day upload is already 5–28 ms on the free plan and passes).
- Still open: 3 sleep nights over 11 h (10, 16, 20 Oct) not confirmed by the owner; 29 Sep is an old doubled leftover (8,723) outside the 30-day window.

- **What Shortcuts can and can't do (measured, 2026-10-29; don't retry):** Group By Day sums every source; Source filters (picker with variable errors; text contains/begins/ends let everything through) never filter; grouping an earlier Find's list ignores the list; "Start Date is after <var>" lets nothing through; "is between <var> and <var>" works; "Adjust Date subtract <Repeat Index> days" is ignored (fixed 1-day steps work); a month of single samples in one Find stops the run; empty Finds don't error; Get Details, Format Date (given the list in a text field) and Combine Text work on whole lists in order; per-sample Repeat loops are slow and memory-heavy (v5.1's 30-day run stopped at the end); a run cut off when the phone leaves Shortcuts ("Could not connect to the server"); no Shortcuts action exposes Health's own merged totals.
- **Signing:** one testing certificate (D-029): GitHub secrets `MOTUS_SIGN_KEY/CERT/ROOT`, expires 28 Nov 2026, fingerprint D2:E2:C7:84…, trusted on the owner's iPhone. New version = delete Motus → open https://motus.motusapp.workers.dev/setup/Motus.shortcut → Add.
- `/setup/` and its TEMPORARY `_headers` block are removed (2026-10-29 16:35); `public/setup/` stays in `.git/info/exclude` for the next test version.
- **Everyone now gets v5.4:** `SHORTCUT_URL` and `public/shortcut.html` point to the owner's iCloud link https://www.icloud.com/shortcuts/d49da9d79d1e49bca0092a4fdd53ef07 (checked: 141 actions, the v5.4 features). Apple signs iCloud links, so no profile for anyone else.
- Data: 31 days stored (29 Sep is an old doubled leftover); sleep 26 nights, 3 over 11 h (10, 16, 20 Oct) not yet checked by the owner.
- Tests: 245 checks pass (core 43, importers 65, store 20, server 117).

## Next action
**Now:** the owner looks at the new Home (locked look), Data, Profile hub and Friends on the iPhone and says what to change. Then: a domain so others can sign in, and a second real account to try friends live.
Older items still open (see next-steps.md): Android on a real phone; the daily Shortcut automation check; remove the upload-shape log; testing certificate expires 28 Nov; sleep nights over 11 h (10, 16, 20 Oct); 29 Sep doubled leftover (delete only with the owner's yes).

## Open questions waiting on the owner
- The v4.x iCloud link (after the 30-day run is right).
- Archive or delete `alyamiMohd/motus-sync`? Default: leave it.
- A domain; Workers Paid when real users come; licence. `.handoff/` stays public (owner knows).

## Last thing in progress
Owner (2026-10-29): "in the main home, make the workout days blurred out, until the user sets them out in the settings ... make the data instead of - blurred out ... blur from the top fading down ... like unlocking it with his data ... Home data are too close to the right close to profile pic ... When a user clicks on data, Make everything blurred out, and asking him to integrate his data first ... After you do all of that use the handoff skill to push everything to github, and publish things live". Claude built and checked all of it locally (393/320 px, three test accounts), saved this handoff, pushed and deployed.
