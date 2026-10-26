# Next steps (as of 2026-10-26)

## Prioritized
- [ ] **Real exports from the owner:** try https://alyamimohd.github.io/motusapp/connect.html on the iPhone with their own Apple Health `export.zip`, Hevy (key or CSV) and MyFitnessPal; fix any importer that misreads a real file (then add a made-up fixture in the same shape as a test).
- [ ] **Check the menu paths** written on the Connect page against the current Hevy, Strong and MyFitnessPal apps; correct the wording.
- [ ] **Real iPhone check:** Safari file picker, a large `export.zip` (time it), nav and tables at phone width.

## Waiting on the owner (state the default taken)
- [ ] Licence for the code. Default: none (all rights reserved).
- [ ] Custom domain (separate storage origin, nicer address). Default: GitHub Pages address.
- [ ] Keep this `.handoff/` public, or move it to a private repo. Default: kept here, like `motus`.
- [ ] Which apps next. Default: none until asked.

## Parked ideas
- Direct importers for Google Fit/Health Connect (Takeout), Fitbit, Garmin, Withings once real sample files are available.
- An "Add to Home Screen" manifest and offline cache.
- IndexedDB if `localStorage` ever proves too small.
- Optional self-hosted automatic sync (the `motus` GitHub Actions pipeline, generalised) for technical users.
