# RESUME: read this first

**Project:** Motus (public app): a fitness dashboard anyone can use. Sign in with an emailed code, connect Hevy and Apple Health once, and it stays up to date by itself; files can also be imported; demo data until then.
**Repo:** https://github.com/alyamiMohd/motusapp (public, `main`). **Live (with accounts): https://motus.motusapp.workers.dev** (Cloudflare: account subdomain `motusapp`, Worker `motus`, D1 `motus` id 4757ecc4-340b-41d4-a641-1f742da8af25, cron every 30 min). Pages without accounts: https://alyamimohd.github.io/motusapp/ (its Connect page links to the live app).
**Last updated:** 2026-10-27 (UTC+03, Riyadh)
**Obsolete:** `alyamiMohd/motus-sync` (template for the earlier GitHub-copy sync, rejected as onboarding); its copies would fail now. Ask the owner before archiving/deleting it.

## Instructions for Claude
1. Read in this order: `CLAUDE.md` → this file → `user-profile.md` → `requirements.md` → `decisions.md` → `project-state.md` → `next-steps.md` → the last 3 entries of `conversation-log.md` → `skills/`.
2. Adopt `user-profile.md` from your first reply (plain, short, honest; do the work yourself; verify before claiming).
3. Do not re-ask what `requirements.md` / `decisions.md` settle. Do not reverse a recorded decision silently.
4. Before anything: `git pull --rebase`, `git status`; trust the code over these notes when they disagree, and say so.
5. Give a 3–6 line "where we left off", then continue with the next action.
6. Every change: `npm test` → `npm run dev` and check in the Browser pane at 390px and 320px → secret scan → commit and push → check Actions → update `.handoff/`.

## Current status
- Built and tested locally (2026-10-27): email-code sign-in, sessions, Connect Hevy (opens Hevy's key page, Paste key, server checks and syncs in the background via /v1/workouts/events), Connect Apple Health (Shortcut token, upload endpoint, return to Connect), imports saved to the account, sign out/in, delete account, cron. 173 automated checks pass (45 run the server on a real SQLite database); the whole flow was also run on `wrangler dev` in the Browser pane, with the Shortcut's upload simulated by curl.
- **Deployed 2026-10-27** after the owner logged in to Cloudflare: database created and tables applied, `HEVY_SECRET` and `CODE_PEPPER` set (random, never displayed), Worker live. Checked live: pages load, signed-out and cross-site requests refused, fake Shortcut token refused. `RESEND_API_KEY` added by the owner 2026-10-27 (through their own terminal; Resend accepts it: a test request got a 422 address error, not an auth error). Without a verified domain, codes only reach the Resend account's own address.
- **The Motus Shortcut isn't built yet:** only the owner can build it on an iPhone (public/shortcut.html); then its iCloud link goes into `SHORTCUT_URL` in `public/js/account.js`.
- Hevy with a real key and the real Shortcut on a real iPhone are not tested.
- Cloudflare free plan: 10 ms CPU per request/cron; Hevy syncs are done in small steps for that reason. With real users, the $5/month Workers plan removes the risk.

## Next action
Owner: sign in at https://motus.motusapp.workers.dev/connect with the Resend account's email, connect Hevy with the real key, build the Shortcut on the iPhone and tap Finish.

## Open questions waiting on the owner
- Archive or delete `alyamiMohd/motus-sync`? Default: leave it until asked.
- A domain (for code emails to everyone and a nice address). Licence. Keep `.handoff/` public.

## Last thing in progress
Owner: "This is the most complicated and insane onboarding ... make it a click of a button integrations ... redirects to hevy ... for ios health the same thing". Chose "Shortcut + Motus accounts". Built and tested locally; waiting for Cloudflare/Resend accounts to deploy.
