# User profile: how to work with this owner

Carried over from the `motus` handoff (sessions of 2026-10-21 to 2026-10-24) and updated on 2026-10-26. Only things the owner said or clearly showed; anything inferred is marked `(inferred)`.

## Communication
- English; short, informal messages with occasional typos; read for intent. Sometimes pastes a long structured spec, which is their own instruction.
- Wants plain, short answers. "This is such a lot of stuff, I want you to redo it" (on a busy first dashboard); "simple and concise, like nothing much" (on the weeks page).
- Wants step-by-step phone instructions with exact taps when something must be done on the iPhone; reports back with screenshots.
- Wants the maths shown when a number looks odd: "Show me the maths u did for this".
- Wants honesty about what is verified: "Do not claim an issue is fixed unless you have verified it."
- Use they/them for the owner (no pronouns stated).

## Working style
- "you create the github repo, after that we proceed": prefers Claude to run commands, create things and verify, and to say what it needs from them. Never ask them to paste secrets.
- Wants changes committed, pushed and documented by default: "Do not wait for me to explicitly request a commit or push."
- Reacts quickly with follow-ups mid-task; incorporate them without restarting.
- Answers questions selectively; don't block on open questions, state the default taken.

## Design preferences (quoted)
- "Minimalism is the main point of this website."
- Green means a standard is met; the Last Week line in a darker green so it doesn't take all the attention.
- Week strip as a row of numbered circles, workout days green, planned days gray.
- Dislikes clutter and labels they don't understand ("I don't know what it means").
- Checks things on an iPhone.

## Corrections and strong opinions (quoted, with date)
- 2026-10-21 "no everything we doing is average ... compare it to the week before it average" (weekly comparisons are average vs average).
- 2026-10-21 Last week: only steps and weight show a change vs the week before.
- 2026-10-22 "0 means I didn't even train" (a trained workout never rates 0) and "If there's new exercises, don't count them".
- 2026-10-22 Steps and calories average up to yesterday; sleep and weight up to today.
- 2026-10-21 "you can make the data public no worries, just make sure my api keys are safe."
- 2026-10-26 "The whole point of this, is to once connect your apps, and then have it fully automated the whole time ... make the people's life easier by just asking them once."
- 2026-10-27 "This is the most complicated and insane onboarding for the users, and literally no user would complete this" (on the GitHub-copy setup) and "make it a click of a button integrations ... Make it a seamless integration". Judges every flow by how few steps a stranger needs; anything needing GitHub, tokens or secrets from users is out.
- Answers multiple-choice questions readily (chose GitHub Actions, then email code, then Shortcut + accounts, then the `motusapp` address); short messages like "Try again" mean "carry on with the work".
- 2026-10-26 "remove 'My' integraitons, as I will be publishing this to the internet, and make people use this application, so just add some dummy data to demonstrate the application"; "This app will be published publicly, and for public use so make it for that".

- 2026-10-27 "No I don't want to link my stuff ... what I'm trying to do is make that production level for people to start using it": don't ask the owner to connect their own Hevy/Health for testing. "just test everything by you, then I will test it after you have verified its working": Claude tests end to end first (local server + mock Hevy + simulated uploads), the owner tests after.
- 2026-10-27 "if you are asking for an email then you have to create users in motus": every sign-in field must clearly mean a Motus account. Domain for email: "I will buy domain later on".
- 2026-10-28 "No you build it yourself, and give me a copy link ... your end objective to create the shortcut": Claude builds and signs things; the owner only taps on the iPhone.
- 2026-10-28 Free first, paid later: "let's do a free one now, if we check everything is good, we might buy a cloudflares one"; asks what each paid service is for before agreeing ("What do you need the routinehub for? testing only?", "which plan u need").
- 2026-10-28 "brevo sucks, they don't even share the sms to my phone through mfa": services that need phone verification or long sign-ups are out.
- 2026-10-28 "Something's off, the steps are doubled": checks the numbers against Apple Health; spots wrong totals quickly.
- 2026-10-28 "if it already exists don't make it no more": don't build a duplicate of something that already does the job; explain how the existing thing covers it.
- 2026-10-29 "open the website in claude in phone size ... iphone 15 pro": check UI in the Browser pane at 393×852.
- 2026-10-29 "Remove most of the non sense, make it mostly depend on the integrations": fewer options, one clear way per app; people shouldn't see screens whose purpose isn't obvious ("people see multiple circles not knowing the intent of it").
- Rejected a small cosmetic refactor mid-task (2026-10-28) (inferred: don't touch working code that isn't part of the request).

- 2026-10-29 "make it clean looking and not too much text, my audience hates text as part of their adhd, don't do too much of it": every page short; icons and one or two words; explanations only where a step needs them.

## Environment
- Windows 11 laptop, Claude desktop app (Git Bash + PowerShell), iPhone with Shortcuts and Apple Health. Timezone Asia/Riyadh (UTC+3). Python 3.10 and Node 24 on this laptop.
- Accounts (names only): GitHub `alyamiMohd` (`gh` signed in), Hevy Pro, MyFitnessPal, the Health Exporter iPhone app, Cloudflare (free; workers.dev subdomain `motusapp`), Google (Apps Script "Motus sign-in" sends the codes), Resend (paused by Resend), Brevo (abandoned at phone verification).
- iPhone set to the Hijri (Umm al-Qura) calendar; has an iPhone and an Apple Watch (both write steps and energy).
- This laptop: PowerShell's execution policy blocks `npx.ps1` (use `npx.cmd`); Claude's Bash and the owner's terminal keep separate wrangler logins.

## Things that frustrated them
- Data not updating without a visible reason; a workout rating of 0.0; layouts that looked wrong on the iPhone; being asked to do work Claude could do.
