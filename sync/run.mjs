// The job inside a person's own copy of motus-sync (GitHub Actions; see sync/template/). Each run:
// 1. reads the previous encrypted file from their GitHub Pages site (refuses to go on if their key can't open it,
//    so a mistake can never wipe their history),
// 2. adds the phone's upload, if this run was started by one (repository_dispatch payload),
// 3. pulls every workout from Hevy, if they saved HEVY_API_KEY,
// 4. writes the new encrypted file to OUT for Pages to publish.
// The log of a public repo is public, so it prints what happened, never any numbers from the data.
//
// usage: node sync/run.mjs <out dir>
// env: MOTUS_KEY (required), PAGES_URL, HEVY_API_KEY, RESET ("true" to start over); the upload comes from
// GITHUB_EVENT_PATH on a repository_dispatch run (PAYLOAD, JSON, overrides it in tests)
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seal, unseal, SYNC_FILE } from "../js/sync.js";
import { fetchHevyWorkouts } from "../js/importers/hevy.js";
import { fromHealthExporterJSON } from "../js/importers/apple.js";
import { clean } from "../js/store.js";

const BODY = ["sleep_hours", "steps", "calories", "weight_kg", "active_kcal"];

// Phone upload -> { date: { metric: value } }. Accepts the Health Exporter app's JSON under "health" (as JSON, as
// text, or Base64 text under "health_b64", which is what the Motus Shortcut sends), or plain daily numbers under
// "days" ({ "2026-10-25": { "steps": 8123, "sleep_hours": 7.2, "calories": 1900, "weight_kg": 80.1 } }),
// which any automation app can send.
const fromB64 = t => new TextDecoder().decode(Uint8Array.from(atob(String(t).replace(/\s+/g, "")), c => c.charCodeAt(0)));
export function readPayload(p) {
  if (!p || typeof p !== "object") return null;
  if (typeof p.health_b64 === "string") p = { health: fromB64(p.health_b64) };
  if (typeof p.health === "string") p = { health: JSON.parse(p.health) };
  let days = null;
  if (p.health && typeof p.health === "object") days = fromHealthExporterJSON(p.health).days;
  else if (p.days && typeof p.days === "object") days = p.days;
  if (!days) return null;
  const out = {};
  for (const [d, r] of Object.entries(days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !r || typeof r !== "object") continue;
    for (const k of BODY) { const v = clean(k, r[k]); if (v != null) (out[d] || (out[d] = {}))[k] = v; }
  }
  return out;
}

export async function runSync(env, { fetchFn = fetch, now = new Date(), log = console.log } = {}) {
  const errors = [];
  if (!env.MOTUS_KEY) return { errors: ["MOTUS_KEY is missing. Add it under Settings → Secrets and variables → Actions."], fatal: true };

  // 1. previous state
  let state = { v: 1, health: { days: {}, latest_upload: null }, hevy: { workouts: [], ok: null } };
  if (env.RESET === "true") log("Starting over: the previously published data is replaced.");
  else if (env.PAGES_URL) {
    let res;
    try { res = await fetchFn(env.PAGES_URL.replace(/\/+$/, "") + "/" + SYNC_FILE + "?t=" + now.getTime(), { cache: "no-store" }); }
    catch (e) { return { errors: ["Couldn't read the previous data from GitHub Pages; nothing was changed. It will try again next run."], fatal: true }; }
    if (res.status === 200) {
      try { state = await unseal(await res.text(), env.MOTUS_KEY); }
      catch (e) { return { errors: ["MOTUS_KEY doesn't open the data already published, so nothing was changed. If you made a new key on purpose, run this workflow by hand with “Start over” ticked."], fatal: true }; }
      log("Previous data opened.");
    } else if (res.status === 404) log("First run: nothing published yet.");
    else return { errors: [`GitHub Pages answered ${res.status}; nothing was changed. It will try again next run.`], fatal: true };
  }
  state.health = state.health || { days: {} };
  state.health.days = state.health.days || {};
  state.hevy = state.hevy || { workouts: [] };

  // 2. phone upload. In GitHub Actions it is read from the event file: a step's environment is printed in the
  // (public) log, so the numbers must never be passed as an environment variable. PAYLOAD is for tests.
  let payload = null;
  try {
    if (env.PAYLOAD != null) payload = JSON.parse(env.PAYLOAD || "null");
    else if (env.GITHUB_EVENT_NAME === "repository_dispatch" && env.GITHUB_EVENT_PATH)
      payload = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, "utf8")).client_payload || null;
  } catch (e) { errors.push("The phone upload wasn't valid JSON."); }
  if (payload) {
    let days = null;
    try { days = readPayload(payload); } catch (e) { errors.push("The phone upload couldn't be read: " + e.message); }
    if (days && Object.keys(days).length) {
      for (const [d, r] of Object.entries(days)) state.health.days[d] = { ...state.health.days[d], ...r };
      state.health.latest_upload = now.toISOString();
      log("Phone upload added.");
    } else if (!errors.length) errors.push("The phone upload had no steps, sleep, calories or weight in it.");
  } else log("No phone upload in this run.");

  // 3. Hevy
  if (env.HEVY_API_KEY) {
    try {
      state.hevy = { workouts: await fetchHevyWorkouts(env.HEVY_API_KEY, undefined, fetchFn), ok: true, fetched: now.toISOString() };
      log("Hevy workouts updated.");
    } catch (e) {
      state.hevy = { ...state.hevy, ok: false, error: e.message };   // keep the workouts we already had
      errors.push("Hevy: " + e.message);
    }
  } else log("No HEVY_API_KEY: skipping Hevy.");

  state.v = 1;
  state.updated = now.toISOString();
  return { state, errors };
}

const PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Motus sync</title><body style="font:16px/1.5 system-ui,sans-serif;max-width:480px;margin:40px auto;padding:0 16px">
<p>This is a private Motus sync copy. Its data is encrypted and only opens on devices that have its key.</p>
<p><a href="https://alyamimohd.github.io/motusapp/">Open Motus →</a></p></body>
`;

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const out = process.argv[2] || "out";
  const { state, errors, fatal } = await runSync(process.env);
  if (fatal) { console.log("::error::" + errors[0]); process.exit(1); }
  await mkdir(out, { recursive: true });
  await writeFile(join(out, SYNC_FILE), await seal(state, process.env.MOTUS_KEY));
  await writeFile(join(out, "index.html"), PAGE);
  await writeFile(join(out, ".nojekyll"), "");
  console.log("Encrypted data written.");
  // published anyway; a problem is reported by failing a later step so GitHub e-mails the owner of the copy
  await writeFile("sync-errors.txt", errors.map(e => "::error::" + e).join("\n"));
}
