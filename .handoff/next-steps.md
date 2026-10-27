# Next steps (as of 2026-10-27)

## Prioritized
- [x] **Deployed to Cloudflare** 2026-10-27: https://motus.motusapp.workers.dev (subdomain registered through the API after `wrangler deploy` couldn't take "motus"; owner chose "motusapp"). Redeploy with `npx wrangler deploy`.
- [x] **Resend** key set 2026-10-27. Still to do for everyone else: a domain, verified in Resend, and `EMAIL_FROM` in `wrangler.jsonc`.
- [x] **Owner's first real sign-in** worked (2026-10-27).
- [x] Full flow verified locally by Claude with a mock Hevy and simulated uploads (2026-10-27); owner does not want their own accounts used for testing.
- [x] Deployed 17389fd (2026-10-27, version 5b044556); live checked: pages 200, new headers present, files match the repo, refusals work, no console errors.
- [ ] **Owner tests the live app.**
- [ ] Background sync covers 3 accounts per 30-min run: fine for a few users, about every 8 h at 50 users. Raise SYNC_USERS_PER_RUN or move to Workers Paid when real users arrive.
- [ ] **Build the Motus Shortcut** on the owner's iPhone (public/shortcut.html), run Finish from Connect, check Home against the Health app; then share its iCloud link → `SHORTCUT_URL` in `public/js/account.js`.
- [ ] Decide what happens to `alyamiMohd/motus-sync` (obsolete; archive or delete, owner's call).
- [ ] Real exports for the file imports; check menu paths in Hevy/Strong/MyFitnessPal.

## Waiting on the owner (state the default taken)
- [x] Cloudflare + Resend accounts (done 2026-10-27).
- [ ] Domain (~$10/year). Default: workers.dev address, codes only to the owner until then.
- [ ] Workers Paid ($5/month) once there are real users. Default: free plan.
- [ ] Licence; keep `.handoff/` public. Defaults: none; kept.

## Parked ideas
- A native iPhone app (true one-tap Health permission and background delivery): needs an Apple Developer account ($99/year); could be built in the cloud (Expo EAS) without a Mac.
- Passkeys (Face ID) as a second way to sign in.
- Direct connections for Fitbit, Withings, Oura (they have OAuth APIs) once accounts are live.
