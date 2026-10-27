# Next steps (as of 2026-10-27)

## Prioritized
- [ ] **Deploy to Cloudflare** (blocked on the owner's free Cloudflare account): `npx wrangler login` → `npx wrangler d1 create motus` (put the id in `wrangler.jsonc`) → `npx wrangler d1 execute motus --remote --file worker/schema.sql` → secrets `HEVY_SECRET`, `CODE_PEPPER`, `RESEND_API_KEY` → `npx wrangler deploy`. Then point GitHub Pages' index to the new address (or keep both).
- [ ] **Resend** (owner's free account): API key as a secret. For codes to reach everyone: a domain, verified in Resend, and `EMAIL_FROM`.
- [ ] **Build the Motus Shortcut** on the owner's iPhone (public/shortcut.html), run Finish from Connect, check Home against the Health app; then share its iCloud link → `SHORTCUT_URL` in `public/js/account.js`.
- [ ] **Hevy with a real key** on the deployed app (only tested against a fake Hevy and Hevy's real 401).
- [ ] Decide what happens to `alyamiMohd/motus-sync` (obsolete; archive or delete, owner's call).
- [ ] Real exports for the file imports; check menu paths in Hevy/Strong/MyFitnessPal.

## Waiting on the owner (state the default taken)
- [ ] Cloudflare + Resend accounts (required to go live).
- [ ] Domain (~$10/year). Default: workers.dev address, codes only to the owner until then.
- [ ] Workers Paid ($5/month) once there are real users. Default: free plan.
- [ ] Licence; keep `.handoff/` public. Defaults: none; kept.

## Parked ideas
- A native iPhone app (true one-tap Health permission and background delivery): needs an Apple Developer account ($99/year); could be built in the cloud (Expo EAS) without a Mac.
- Passkeys (Face ID) as a second way to sign in.
- Direct connections for Fitbit, Withings, Oura (they have OAuth APIs) once accounts are live.
