---
name: "github-session-handoff"
description: "Use whenever pushing a project to GitHub, or when the user says checkpoint, save handoff, or resume from GitHub: saves and restores full chat context so work continues on any device."
---

# GitHub Session Handoff

**Goal:** every time a project is pushed to GitHub, the repo also carries a complete, cold-readable record of the conversation: requirements, preferences, decisions, state, next steps, and the skills used. The user can then open a brand-new chat on any device, say "read the GitHub repo and let's proceed", and Claude continues exactly as if it were the same chat.

Two modes:
- **SAVE**: write/update the handoff and push it.
- **RESUME**: read the handoff from a repo and continue the work.

---

## When to use

**SAVE (do it automatically, no need to ask):**
- Any time you are about to commit and push to GitHub for the user. Run SAVE first and include the handoff in the same push.
- The user says "checkpoint", "save handoff", "save the chat", "back up the session", or similar.
- At the end of a major milestone, before a long pause, or when the conversation is getting very long.

**RESUME:**
- The user says "read the github and let's proceed", "resume from <repo>", "continue from my repo", or shares a repo URL intending to continue.
- A repo you open contains `.handoff/RESUME.md`.

---

## Folder layout

```
<repo root>/
├── CLAUDE.md                  # short pointer, auto-read by Claude Code
└── .handoff/
    ├── RESUME.md              # entry point: read first
    ├── user-profile.md        # how the user wants Claude to respond and work
    ├── requirements.md        # every requirement, in the user's words, with status
    ├── decisions.md           # what was decided, why, and what was rejected
    ├── project-state.md       # stack, architecture, files, how to run/deploy
    ├── next-steps.md          # prioritized TODO, blockers, parked ideas
    ├── conversation-log.md    # append-only chronological history of the chat
    └── skills/
        └── <skill-name>/SKILL.md   # copies of every custom skill used, incl. this one
```

If `CLAUDE.md` already exists, append a "Session handoff" section instead of overwriting. Pointer text:

```markdown
# Session handoff
This project carries its full conversation context in `.handoff/`.
Before doing anything, read `.handoff/RESUME.md` and follow it.
After any change you push, update `.handoff/` following
`.handoff/skills/github-session-handoff/SKILL.md`.
```

---

## SAVE procedure

1. **Find where the last save stopped.** Read the newest entry in `.handoff/conversation-log.md`. Cover everything since then. If `.handoff/` doesn't exist yet, cover the entire conversation from the very first message.
2. **Update every file** per the specs below. Writing rules:
   - Write for a reader with zero memory of this chat. Nothing like "as discussed" without saying what was discussed.
   - Be concrete: names, versions, file paths, exact commands, numbers, URLs, error messages.
   - Quote the user's own words for requirements, preferences, and corrections.
   - History is append-only. Never silently delete: mark items superseded/dropped and point to the replacement.
3. **Copy skills.** For every non-built-in skill used in this project (always including this one), copy its `SKILL.md` and supporting files into `.handoff/skills/<name>/`. If a skill's file can't be read, write its name and a precise description of what it does and how it was used.
4. **Secret scan (mandatory).** Never write secrets. Run a scan over `.handoff/` and `CLAUDE.md`, e.g.:
   ```bash
   grep -rnEi 'ghp_|github_pat_|sk-ant-|sk-[A-Za-z0-9]{20}|AKIA[0-9A-Z]{16}|-----BEGIN|(password|passwd|api[_-]?key|secret|token)\s*[:=]\s*\S+' .handoff CLAUDE.md
   ```
   Replace any hit with `<REDACTED: stored in ...>`. Record environment variable *names* and where the value lives, never the value.
5. **Visibility check.** Before the first handoff push, check visibility (`gh repo view --json visibility` if available). If the repo is public, tell the user once that the handoff (including their preferences and chat history) will be public, and recommend making the repo private.
6. **Commit and push.** Same commit as the code, or a separate commit right after:
   `chore(handoff): update session context: <one-line summary>`
7. **Verify.** `git log -1 --stat` (or the last two commits) must show the `.handoff/` files. Then tell the user in one line that the handoff is saved. The first time, also give them the resume prompt (below).

---

## File specs

### RESUME.md (keep under ~150 lines)
- Project one-liner, repo URL, last updated (date, time, timezone), last commit hash.
- **Instructions for Claude:** read the files in the order listed in the RESUME procedure; adopt `user-profile.md` from the first reply; don't re-ask questions already settled in `requirements.md` / `decisions.md`; give a short "where we left off" then continue.
- Current status in 5 to 10 bullets.
- The single next action.
- Open questions waiting on the user.
- The last thing the user said or asked (near-verbatim) and what Claude was in the middle of.

### user-profile.md
How the user wants Claude to respond and work:
- Language(s), tone, response length, formatting likes/dislikes, level of explanation.
- Working style: proceed vs. ask first, how much narration, when to confirm.
- Every correction or preference the user gave, quoted, with date (e.g. "don't use bullet points", "always give me the full file").
- Environment: OS, devices, editors, accounts and services (names only), timezone.
- Things they dislike or that frustrated them.
Only record what the user actually said or clearly showed; mark anything inferred as `(inferred)`.

### requirements.md
The master list. For each requirement:
- ID (`R-001`, ...)
- The user's words (quote)
- Clarified interpretation
- Status: `open` / `in progress` / `done` / `changed` / `dropped`
- Date added; where implemented (file / commit)
- Notes
Include non-functional requirements (look and feel, performance, hosting, budget, deadlines) and the overall end goal. Changed or dropped requirements stay in the file, struck through, with a pointer to what replaced them.

### decisions.md
For each decision (`D-001`, ...): what was decided, alternatives considered, why, who decided (user / Claude), date. Include rejected approaches and the reason, so they are not proposed again.

### project-state.md
- Tech stack with versions
- Architecture overview
- File/folder map: what each important file does
- Exact commands to install, run, test, build, deploy
- Environment variables (names + where to obtain each value)
- External services, APIs, accounts
- What works now
- Known bugs and limitations
- Workarounds and hacks, and why they exist

### next-steps.md
- Prioritized checklist (`- [ ]`)
- Blocked items and what they're blocked on
- Ideas parked for later

### conversation-log.md (append-only)
Each save adds one entry:
```markdown
## 2026-10-22 10:34 (UTC+03) | Session N | commit abc1234
**User asked:** near-verbatim key messages, important ones quoted exactly
**Claude did:** what was built/changed/answered
**Outcome:** result, what works, what doesn't
**Errors & fixes:** problems hit and how they were solved
**User feedback / corrections:** quoted
```
Every substantive user message must be represented. This is a faithful reconstruction, not a raw transcript, so err on the side of more detail. If the file grows past ~1500 lines, condense the oldest entries into a "Summary of earlier sessions" section at the top, keeping every R-/D- reference.

---

## RESUME procedure

1. **Get the repo.** Clone it if possible. If GitHub isn't reachable: for a public repo, read raw files via web fetch; otherwise ask the user to connect GitHub or upload the `.handoff/` folder (zip is fine).
2. **Read in this order:** `CLAUDE.md` → `.handoff/RESUME.md` → `user-profile.md` → `requirements.md` → `decisions.md` → `project-state.md` → `next-steps.md` → the last 3 entries of `conversation-log.md` (the whole log if anything is unclear) → `skills/`.
3. **Restore skills.** For any skill in `.handoff/skills/` not available in this session, follow its instructions directly from the file, and tell the user once that they can re-add it to their account (especially this one, so saving keeps working).
4. **Become the same assistant.** Apply `user-profile.md` from the very first reply: language, tone, format, working style.
5. **Confirm briefly.** Reply with "Picking up where we left off": project, current status, the last thing in progress, the next action, open questions (3 to 6 lines total). Then ask "Shall I continue with <next action>?", or just proceed if the profile says the user prefers that.
6. **Keep the chain going.** On the next save, start a log entry "Session N+1, resumed on a new device".

Rules while resuming: don't redo finished work; don't reverse a recorded decision without flagging it; if the code and the handoff disagree, trust the code and flag the difference to the user.

---

## Resume prompt (give this to the user after the first save)

> Read the GitHub repo `<owner>/<repo>`. Start with `.handoff/RESUME.md` and follow its instructions, then let's proceed exactly where we left off.