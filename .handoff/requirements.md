# Requirements

Status: `open` / `in progress` / `done` / `changed` / `dropped`. Added 2026-10-26 unless noted.

| ID | The owner's words | Interpretation | Status | Where |
|---|---|---|---|---|
| R-001 | "create a new github repo called, motusapp" | New public repo `alyamiMohd/motusapp`, served on GitHub Pages | done | https://github.com/alyamiMohd/motusapp, `32b3c2c` |
| R-002 | "remove 'My' integraitons, as I will be publishing this to the internet" | Nothing tied to the owner: no Riyadh-only time, no owner data, no phone upload token, no Hevy key in Actions, no GitHub write path | done | Fresh repo with no history from `motus`; visitor's own time zone (`js/core.js`) |
| R-003 | "just add some dummy data to demonstrate the application" | Visitors see believable demo data until they import their own; clearly labelled as made up | done | `js/demo.js`, banners on every page |
| R-004 | "add a section for integration including the applications for people to easily integrate with motus, like hevy, myfitnesspal, strong, ios health etc" | Connect page with step-by-step instructions and an import per app; a route for apps without a direct import | done | `connect.html`, `js/importers/*` |
| R-005 | "This app will be published publicly, and for public use so make it for that" | Works for any visitor: privacy (data on device), units kg/lb, week start Sun/Mon, plain privacy text, backup/restore/delete, security (CSP, escaping), indexable pages | done | `js/store.js`, `js/core.js`, Connect "Your data" and "Privacy" |
| R-006 | (carried from `motus`) "Minimalism is the main point of this website." | Same calm look and wording as the personal dashboard | done | `style.css` |
| R-007 | (carried) weekly averages: steps and calories to yesterday, sleep and weight to today; comparisons average vs average; last week line compares only steps and weight | Same rules | done | `weekAvg` in `js/core.js`, tests |
| R-008 | (carried) workout rating: 7 = normal, never 0 for a trained workout, new exercises not counted | Same scoring | done | `js/stats.js`, tests |
