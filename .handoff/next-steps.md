# Next steps (as of 2026-10-27)

## Prioritized
- [ ] **Owner's iPhone test of automatic sync:** make a copy of `motus-sync`, follow Connect → Automatic, build the Motus Shortcut (`shortcut.html`), run it once, check the numbers in Motus against the Health app. Fix what breaks (the Shortcut steps are written from the owner's working "Health to Drive" shortcut but not built by Claude).
- [ ] **Share the Shortcut:** once it works, the owner shares its iCloud link; set `SHORTCUT_URL` in `js/pages/connect.js` and add a "Get the Shortcut" button on `shortcut.html`. Ideally with import questions for the copy's name and the phone token.
- [ ] **Hevy live in the job:** the owner adds `HEVY_API_KEY` to their copy and confirms workouts arrive (tested only with a faked Hevy).
- [ ] **Real exports for one-off imports:** Apple Health `export.zip`, Hevy CSV, MyFitnessPal zip on the iPhone.
- [ ] Check the menu paths on the Connect page against the current Hevy, Strong and MyFitnessPal apps.
- [ ] Watch whether GitHub pauses a copy's schedule after 60 days without activity (the job runs `gh workflow enable` each time to prevent it; unverified that this resets the timer). Daily phone uploads keep runs going anyway.

## Waiting on the owner (state the default taken)
- [ ] Licence. Default: none.
- [ ] Custom domain. Default: GitHub Pages address.
- [ ] Keep `.handoff/` public. Default: kept.
- [ ] Accounts phase (email-code sign-in + a small server, e.g. Cloudflare Workers/D1): when, and which host. Default: not started.
- [ ] Remove the test `MOTUS_KEY` secret and test Pages data from the `motus-sync` template, or keep them for future live tests. Default: kept.

## Parked ideas
- Direct importers for Google Fit/Health Connect, Fitbit, Garmin, Withings once real sample files exist.
- "Add to Home Screen" manifest and offline cache; IndexedDB if `localStorage` proves too small.
- Android: any automation app (e.g. Tasker) can send `{"event_type":"health","client_payload":{"days":{...}}}` to a copy; document it when someone asks.
