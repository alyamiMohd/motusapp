# Motus (public app): instructions for Claude

Motus is a public fitness dashboard: people see demo data, sign in with an emailed code, and connect Hevy (API key, synced
in the background) and Apple Health (the Motus Shortcut's daily upload) once; files can also be imported. Owner: GitHub `alyamiMohd`.
Until Cloudflare is deployed, https://alyamimohd.github.io/motusapp/ serves the pages without accounts.
It grew out of the owner's personal dashboard (`alyamiMohd/motus`, still running separately with their own data and pipeline).
Plain HTML/CSS/ES modules in `public/` (no build); accounts on a Cloudflare Worker + D1 (`worker/`, deployed with `wrangler`, the only dev dependency).

## Hard rules
- **People's health data is sensitive.** Accounts (email code) live on a Cloudflare Worker + D1 (`worker/`). Store only
  hashes of codes, sessions and Shortcut tokens; keep Hevy keys encrypted (`HEVY_SECRET`); never log data or secrets.
  Every cookie-authenticated change needs the Origin check; every user query is scoped by `user_id`. No analytics or
  third-party scripts without the owner's explicit yes. The pages' CSP allows only `'self'`.
- **Secrets** (`HEVY_SECRET`, `CODE_PEPPER`, `RESEND_API_KEY`) go only into `.dev.vars` (local, git-ignored) or
  `wrangler secret put`. Never into `wrangler.jsonc`, the repo, or chat.
- **No schema change without care:** `worker/schema.sql` is applied with `CREATE ... IF NOT EXISTS`; anything that alters or
  drops a table in production needs the owner's yes.
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
| Full app with the server (local D1, codes printed in the log) | `npm run dev` → http://127.0.0.1:8787 (needs `.dev.vars`; see README) |
| Static pages only, no accounts | `npm start` → http://localhost:8098 |
| Tests (incl. the server on Node's SQLite) | `npm test` |
| Deploy | `npx wrangler deploy` (first time: README → "First deploy to Cloudflare") |

## Session handoff
This project carries its full conversation context in `.handoff/`.
Before doing anything, read `.handoff/RESUME.md` and follow it.
After any change you push, update `.handoff/` following
`.handoff/skills/github-session-handoff/SKILL.md`.
