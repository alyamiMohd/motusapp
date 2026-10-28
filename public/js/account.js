// The Motus account in the browser: signing in with an emailed code, keeping this device's copy in step with the
// account, and connecting Hevy and Apple Health once so they stay up to date by themselves.
// Accounts need the Motus server (worker/). Where it isn't running (e.g. a plain static host) /api answers 404 and
// Motus simply stays on-device.
import { load, setAll, putSource, clearAll, SERVER_SOURCES } from "./store.js";
import { summarizeWorkouts } from "./stats.js";
import { fromApiWorkouts } from "./importers/hevy.js";

const ME = "motusapp-me", ETAG = "motusapp-etag";
const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };

// The shared Motus Shortcut: an iCloud link, signed by Apple, so it adds on any iPhone. Made 2026-10-28 from
// tools/shortcut/build.mjs (signed once for the owner's iPhone by .github/workflows/sign-shortcut.yml, then shared).
export const SHORTCUT_URL = "https://www.icloud.com/shortcuts/a869175a85ec4b039ac134a375f7a3fe";
export const HEVY_KEY_PAGE = "https://hevy.com/settings?developer";

async function api(path, { method = "GET", body, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(path, { method, credentials: "same-origin", headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers },
                              body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) { throw Object.assign(new Error("Couldn't reach Motus. Check your connection."), { offline: true }); }
  if (res.status === 401) { set(ME, null); set(ETAG, null); }
  if (res.status === 304) return { status: 304 };
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Motus answered with an error (${res.status}).`), { status: res.status });
  if (res.headers.get("etag")) data.etag = res.headers.get("etag");
  return data;
}

// Who is signed in, as last seen (instant, no network). null = signed out or no server.
export const cachedMe = () => { try { return JSON.parse(get(ME) || "null"); } catch (e) { return null; } };

// Ask the server. Returns { available, me }: available is false where there is no Motus server.
export async function checkAccount() {
  try { const me = await api("/api/me"); set(ME, JSON.stringify(me)); return { available: true, me }; }
  catch (e) { return { available: e.status === 401, me: null }; }
}

export const sendCode = email => api("/api/auth/start", { method: "POST", body: { email } });

// After the code: this device's own imports go into the account (merged with what is there), then everything comes back.
export async function signIn(email, code) {
  await api("/api/auth/verify", { method: "POST", body: { email, code } });
  const local = load().sources;
  for (const [id, s] of Object.entries(local)) {
    if (!SERVER_SOURCES.includes(id)) await api("/api/sources/" + id, { method: "PUT", body: { days: s.days, exercises: s.exercises || {} } }).catch(() => {});
  }
  set(ETAG, null);
  await checkAccount();
  await pull();
}

export async function signOut() {
  await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  set(ME, null); set(ETAG, null);
  clearAll();                       // the account's data doesn't stay on a device that signed out
}

export async function deleteAccount() {
  await api("/api/me", { method: "DELETE" });
  set(ME, null); set(ETAG, null);
  clearAll();
}

// Bring the account's data onto this device. Resolves true when something changed.
export async function pull() {
  if (!cachedMe()) return false;
  const etag = get(ETAG);
  const d = await api("/api/data", { headers: etag ? { "if-none-match": etag } : {} });
  if (d.status === 304) return false;
  const sources = {};
  for (const [id, s] of Object.entries(d.sources || {})) sources[id] = { ...s.data, imported: s.imported };
  if (d.workouts && d.workouts.length) {
    const lifts = summarizeWorkouts(fromApiWorkouts(d.workouts));    // dated in this device's time zone
    sources.hevy_live = { days: lifts.days, exercises: lifts.exercises, imported: d.me.hevy.synced ? new Date(d.me.hevy.synced).toISOString() : null };
  }
  setAll(sources);
  set(ME, JSON.stringify({ email: d.me.email, ...d.me }));
  set(ETAG, d.etag || null);
  return true;
}

// Every page: refresh from the account when signed in. Quiet when offline or signed out.
export async function autoRefresh() {
  try { return await pull(); } catch (e) { return false; }
}

// A file imported on this device while signed in also goes to the account.
export async function pushSource(id) {
  if (!cachedMe() || SERVER_SOURCES.includes(id)) return;
  const s = load().sources[id];
  if (s) await api("/api/sources/" + id, { method: "PUT", body: { days: s.days, exercises: s.exercises || {}, replace: true } });
  set(ETAG, null);
}
export async function removeRemote(id) {
  if (!cachedMe() || SERVER_SOURCES.includes(id)) return;
  await api("/api/sources/" + id, { method: "DELETE" });
  set(ETAG, null);
}

// Hevy: the key is checked by the server, then the history comes in a few pages at a time.
export async function connectHevy(key, onProgress = () => {}) {
  let r = await api("/api/hevy", { method: "POST", body: { key } }), steps = 1;
  while (!r.done && steps++ < 200) { onProgress(steps); r = await api("/api/hevy/sync", { method: "POST" }); }
  if (r.error) throw new Error(r.error);
  await checkAccount(); set(ETAG, null); await pull();
}
export async function syncHevy() {
  let r, steps = 0;
  do r = await api("/api/hevy/sync", { method: "POST" }); while (!r.done && ++steps < 200);
  await checkAccount(); await pull();
  return r;
}
export async function disconnect(kind) {
  await api("/api/" + kind, { method: "DELETE" });
  set(ETAG, null); await checkAccount(); await pull();
}

// Apple Health: a fresh token for the Motus Shortcut, handed to it by running it once with the token as its input.
export async function healthSetupLink() {
  const { token, url } = await api("/api/health", { method: "POST" });
  return "shortcuts://run-shortcut?name=Motus&input=text&text=" + encodeURIComponent(url + "|" + token);
}
