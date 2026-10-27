// Automatic sync through a person's own GitHub copy of motus-sync (https://github.com/alyamiMohd/motus-sync).
// Their GitHub Actions keeps one encrypted file, motus-data.enc, on their own GitHub Pages site: phone uploads
// (Apple Health, which includes MyFitnessPal) and a Hevy pull every few hours go into it. Motus fetches that file
// and opens it here with their key, which only they hold. GitHub stores and serves the encrypted bytes only.
// The same code runs in the browser and in the GitHub job (sync/run.mjs).
import { summarizeWorkouts } from "./stats.js";
import { fromApiWorkouts, fetchHevy } from "./importers/hevy.js";
import { putSource, load } from "./store.js";

export const SYNC_FILE = "motus-data.enc";

// ---- encryption: AES-256-GCM over gzipped JSON, a fresh random IV every time ----
const b64 = bytes => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
const toUrl = s => s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromUrl = s => s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

export const newKey = () => toUrl(b64(crypto.getRandomValues(new Uint8Array(32))));
export function keyBytes(key) {
  let bytes;
  try { bytes = unb64(fromUrl(String(key || "").trim())); } catch (e) { bytes = null; }
  if (!bytes || bytes.length !== 32) throw new Error("That isn't a Motus key (it should be 43 letters and numbers).");
  return bytes;
}
const aes = (key, use) => crypto.subtle.importKey("raw", keyBytes(key), "AES-GCM", false, [use]);

export async function seal(obj, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const zipped = await pipe(new TextEncoder().encode(JSON.stringify(obj)), new CompressionStream("gzip"));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aes(key, "encrypt"), zipped));
  return JSON.stringify({ motus: 1, iv: b64(iv), data: b64(data) }) + "\n";
}

export async function unseal(text, key) {
  let box;
  try { box = JSON.parse(text); } catch (e) { box = null; }
  if (!box || box.motus !== 1 || !box.iv || !box.data) throw new Error("This isn't a Motus sync file.");
  let zipped;
  try { zipped = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(box.iv) }, await aes(key, "decrypt"), unb64(box.data)); }
  catch (e) { throw new Error("Your key doesn't open this sync file. Check that it's the same key you saved on GitHub as MOTUS_KEY."); }
  return JSON.parse(new TextDecoder().decode(await pipe(new Uint8Array(zipped), new DecompressionStream("gzip"))));
}

// ---- what the sync file holds -> one Motus source ----
// state = { v, updated, health: { days, latest_upload }, hevy: { workouts, ok, error, fetched } }
export function toSource(state) {
  const days = {};
  for (const [d, r] of Object.entries((state.health && state.health.days) || {})) days[d] = { ...r };
  const lifts = summarizeWorkouts(fromApiWorkouts((state.hevy && state.hevy.workouts) || []));   // dated in this device's time zone
  for (const [d, r] of Object.entries(lifts.days)) days[d] = { ...days[d], ...r };
  return { days, exercises: lifts.exercises, replace: true };
}

// ---- in the browser: where the file is, and pulling it ----
const CONFIG = "motusapp-sync", HEVY_KEY = "motusapp-hevy-key", HEVY_LAST = "motusapp-hevy-last";
const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };

// "someone/motus-sync" -> https://someone.github.io/motus-sync/motus-data.enc (a full https URL is also accepted)
export function syncUrl(repo) {
  repo = String(repo || "").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\/+$/, "");
  if (/^https:\/\/[^/]+\.github\.io\//i.test(repo)) return repo.endsWith(SYNC_FILE) ? repo : repo + "/" + SYNC_FILE;
  const m = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/.exec(repo);
  if (!m) return null;
  const user = m[1].toLowerCase();
  return m[2].toLowerCase() === user + ".github.io" ? `https://${user}.github.io/${SYNC_FILE}` : `https://${user}.github.io/${m[2]}/${SYNC_FILE}`;
}

export const getSync = () => { try { return JSON.parse(get(CONFIG) || "null"); } catch (e) { return null; } };
export const setSync = cfg => set(CONFIG, cfg ? JSON.stringify(cfg) : null);

// Fetch, open and store the sync file. Returns { state } or throws a readable error.
export async function pullSync(cfg = getSync(), fetchFn = fetch) {
  if (!cfg || !cfg.url || !cfg.key) throw new Error("Automatic sync isn't set up on this device.");
  let res;
  try { res = await fetchFn(cfg.url + "?t=" + Date.now(), { cache: "no-store" }); }
  catch (e) { throw new Error("Couldn't reach your sync copy. Check its name, that GitHub Pages is on (Source: GitHub Actions), that the Motus sync workflow has run once, and your connection."); }
  if (res.status === 404) throw new Error("Nothing published yet. Check that GitHub Pages is on (Source: GitHub Actions) and run the Motus sync workflow once.");
  if (!res.ok) throw new Error(`Your sync copy answered with an error (${res.status}).`);
  const state = await unseal(await res.text(), cfg.key);
  if (!putSource("sync", toSource(state))) throw new Error("Your browser wouldn't let Motus save the data.");
  setSync({ ...cfg, last: new Date().toISOString(), updated: state.updated, hevyError: state.hevy && state.hevy.ok === false ? state.hevy.error : null });
  return { state };
}

export const getHevyKey = () => get(HEVY_KEY) || "";
export const setHevyKey = k => { set(HEVY_KEY, k || null); if (!k) set(HEVY_LAST, null); };

// Runs on every page: brings in the sync file and, for people who saved a Hevy key here, fresh workouts
// (at most every 30 minutes). Quietly does nothing when neither is set up. Resolves true when data changed.
export async function autoRefresh() {
  let changed = false;
  if (getSync()) { try { await pullSync(); changed = true; } catch (e) {} }
  const key = getHevyKey(), last = +get(HEVY_LAST) || 0;
  if (key && Date.now() - last > 30 * 60e3 && load().sources.hevy !== undefined) {
    set(HEVY_LAST, String(Date.now()));
    try { if (putSource("hevy", await fetchHevy(key))) changed = true; } catch (e) {}
  }
  return changed;
}
