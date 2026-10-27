# Motus (public app): instructions for Claude

Motus is a public, browser-only fitness dashboard: anyone opens https://alyamimohd.github.io/motusapp/, sees demo data,
and imports their own from Apple Health, Hevy, Strong, MyFitnessPal or a CSV on the Connect page. Owner: GitHub `alyamiMohd`.
It grew out of the owner's personal dashboard (`alyamiMohd/motus`, still running separately with their own data and pipeline).
Plain HTML/CSS/ES modules, no build, no dependencies, hosted on GitHub Pages from `main`.

## Hard rules
- **No Motus server; people's data stays theirs.** No backend, analytics, cookies or third-party scripts without the owner's explicit yes.
  The app talks only to `api.hevyapp.com` (optional Hevy) and `*.github.io` (sync files), both in the CSP `connect-src`.
- **Automatic sync runs in each person's own GitHub copy** (template `alyamiMohd/motus-sync`, job `sync/run.mjs`). Only the
  AES-256-GCM file encrypted with their `MOTUS_KEY` is stored or published. Their logs are public: **never print data, and
  never pass the phone's upload through `env`** (GitHub prints a step's env); it is read from `GITHUB_EVENT_PATH`.
  `tests/test_sync.mjs` guards both. Changes to `sync/template/` must also be pushed to `alyamiMohd/motus-sync`.
- **The repo is public.** Never commit real exports, the owner's data from `motus`, keys, tokens or `.env`. Test fixtures are made up.
- **Escape everything imported** (exercise and workout names come from files): use `esc()` from `js/core.js` before `innerHTML`.
- **Minimalism is the point** (owner's words). Plain, short wording from the visitor's side of the screen. No clutter.
- Do not silently reverse a recorded decision (`.handoff/decisions.md`); add a new one.

## Workflow for every change
1. `git pull --rebase`, `git status`.
2. Implement; keep comments short and about why.
3. `npm test` (all three test files must pass); add a test for any importer or rule you change.
4. Check the UI in the Browser pane at 390px and 320px (no sideways scroll), and desktop; light and dark.
5. Scan what's staged for secrets and personal data (`git diff --cached --name-only`).
6. Commit and push to `main` (the owner wants changes committed and pushed by default), check the Actions run is green and the live site updated.
7. Update `.handoff/` (see `.handoff/skills/github-session-handoff/SKILL.md`).

## Commands
| Task | Command |
|---|---|
| Local preview | `npm start` → http://localhost:8098 (`serve.mjs`, no dependencies) |
| Tests | `npm test` |

## Session handoff
This project carries its full conversation context in `.handoff/`.
Before doing anything, read `.handoff/RESUME.md` and follow it.
After any change you push, update `.handoff/` following
`.handoff/skills/github-session-handoff/SKILL.md`.
