# Next steps (as of 2026-10-29, UTC+03)

## Prioritized
- [ ] (2026-10-29) Owner reviews the new Home (locked look, training-days prompt), Data, Profile hub, Friends and Integrations on the iPhone.
- [ ] A domain so other people can sign in; then try friends with two real accounts on the live site (request, accept, dashboard, privacy switch, dot).
- [ ] People with data but default training days see a blurred week strip until they tap a day: check the owner is fine with that for existing users.
- [ ] (2026-10-29) Owner looks at the new Connect, Profile (photo, username, share link), Workouts and Home on the iPhone and says what to change.
- [ ] (2026-10-29) **Android on a real phone**: someone with Android installs HC Webhook, downloads the setup file from Connect → Health Connect, imports it (⋮ → Settings backup → Import), grants permissions; Claude checks the `hc upload:` counts in `wrangler tail` and the days in D1 (never print values). Check HC Webhook's import screen wording matches Connect's step 3.
- [ ] **Owner installs Shortcut v2** from https://motus.motusapp.workers.dev/setup/ (remove old profile → install new profile + full trust → delete old Motus → add new, name exactly "Motus" → Finish → Copy iCloud Link). Then Claude: check counts in the log/D1 (30 days arrived, steps not doubled; never print values), set the new link in `SHORTCUT_URL` (`public/js/account.js`) and `public/shortcut.html`, delete `public/setup/`, `git checkout public/_headers`, deploy, commit, restart the tail.
- [ ] If the 30-day upload fails on CPU (free plan 10 ms): tell the owner the fix is Workers Paid ($5/month), or shorten the first run.
- [ ] Owner sets up the **daily automation** (Shortcuts → Automation → + → Time of Day → Daily → Run Immediately → Motus) and Claude checks the next morning's upload.
- [ ] Remove the temporary upload-shape log in `worker/index.js` once the Shortcut is settled.
- [ ] People missing a type (no Watch, no weight, never logged food): make sure the Shortcut doesn't stop on "No Samples Found" for Steps/Active/Weight/Sleep (only Dietary Calories has Fill Missing now).
- [ ] Hevy with a real key (owner won't use their own; needs a volunteer or a test Pro account).
- [ ] Background sync covers 3 accounts per 30-min run: fine for a few users, about every 8 h at 50 users. Raise SYNC_USERS_PER_RUN or move to Workers Paid when real users arrive.
- [ ] Decide what happens to `alyamiMohd/motus-sync` (obsolete; archive or delete, owner's call).
- [ ] Real exports for the file imports; check menu paths in Hevy/Strong/MyFitnessPal.
- [ ] Privacy note: data is in Cloudflare's Western Europe region (D1 WEUR); say so in the privacy text before public launch (Saudi PDPL).

## Done (recent)
- [x] 2026-10-29 session 2: brand kit, friends + privacy, Profile hub, default picture, Data rename, no demo signed in, locked starter look (D-038 to D-042).
- [x] Deployed to Cloudflare 2026-10-27; sign-in by email code; owner signed in.
- [x] Sign-in codes from the owner's Gmail (Apps Script) 2026-10-28 (Resend paused, Brevo rejected).
- [x] Motus Shortcut signed without a Mac (D-022) and run on the owner's iPhone: Apple Health end to end, Hijri dates converted (2026-10-28).
- [x] Shortcut v2: 30-day first run, 2-day daily runs, busiest source per day (fd29eb5, deployed 2026-10-28; waiting for install).

## Waiting on the owner (state the default taken)
- [ ] Domain (~$10/year), maybe Cloudflare Email later. Default: workers.dev address, codes from the owner's Gmail.
- [ ] Workers Paid ($5/month) once there are real users or if uploads hit the CPU limit. Default: free plan.
- [ ] Licence; keep `.handoff/` public. Defaults: none; kept.

## Parked ideas
- A native iPhone app (true one-tap Health permission and background delivery): needs an Apple Developer account ($99/year); could be built in the cloud (Expo EAS) without a Mac.
- Passkeys (Face ID) as a second way to sign in.
- Direct connections for Fitbit, Withings, Oura (they have OAuth APIs) once accounts are live.
- First run further back than 30 days ("or the oldest"): a number in `build.mjs` (`FIRST`), limited by free-plan CPU.
