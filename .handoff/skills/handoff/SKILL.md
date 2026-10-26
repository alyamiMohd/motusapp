---
name: "handoff"
description: "Shortcut command. Use only when the user types /handoff: saves a session handoff to GitHub, or with 'resume owner/repo' restores one and continues."
---

# /handoff

Short command for the `github-session-handoff` skill. Load that skill with the Skill tool and follow it. If it isn't available, look for `.handoff/skills/github-session-handoff/SKILL.md` in the repo and follow that file instead.

## Usage

| Command | What to do |
|---|---|
| `/handoff` or `/handoff save` | Run the **SAVE** procedure now on the current project's repo, then push. |
| `/handoff resume <owner>/<repo>` | Run the **RESUME** procedure on that repo and continue the work. |
| `/handoff resume` (no repo) | Ask which repo to resume from, in one short question. |
| `/handoff status` | Say when the last handoff was saved (newest entry in `.handoff/conversation-log.md`) and what has happened since that isn't saved yet. |

If the user types `/handoff save` and no repo exists yet for this project, ask for the repo name (or offer to create a private one), then save.

After a save, reply in one line, for example: "Handoff saved to `<owner>/<repo>` (commit `abc1234`). Resume anywhere with `/handoff resume <owner>/<repo>`."