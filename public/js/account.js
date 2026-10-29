// The Motus account in the browser: signing in with an emailed code, keeping this device's copy in step with the
// account, and connecting Hevy and Apple Health once so they stay up to date by themselves.
// Accounts need the Motus server (worker/). Where it isn't running (e.g. a plain static host) /api answers 404 and
// Motus simply stays on-device.
import { load, setAll, putSource, clearAll, SERVER_SOURCES } from "./store.js";
import { summarizeWorkouts } from "./stats.js";
import { fromApiWorkouts } from "./importers/hevy.js";
import { refreshNav } from "./core.js";

const ME = "motusapp-me", ETAG = "motusapp-etag";
const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };

// The shared Motus Shortcut: an iCloud link, signed by Apple, so it adds on any iPhone. Made 2026-10-28 from
// tools/shortcut/build.mjs (signed once for the owner's iPhone by .github/workflows/sign-shortcut.yml, then shared).
export const SHORTCUT_URL = "https://www.icloud.com/shortcuts/d49da9d79d1e49bca0092a4fdd53ef07";
export const HEVY_KEY_PAGE = "https://hevy.com/settings?developer";

async function api(path, { method = "GET", body, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(path, { method, credentials: "same-origin", headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers },
                              body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) { throw Object.assign(new Error("Couldn't reach Motus. Check your connection."), { offline: true }); }
  if (res.status === 401) { set(ME, null); set(ETAG, null); set(PHOTO, null); }
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
  set(ME, null); set(ETAG, null); set(PHOTO, null);
  clearAll();                       // the account's data doesn't stay on a device that signed out
}

export async function deleteAccount() {
  await api("/api/me", { method: "DELETE" });
  set(ME, null); set(ETAG, null); set(PHOTO, null);
  clearAll();
}

// Bring the account's data onto this device. Resolves true when something changed.
export async function pull() {
  if (!cachedMe()) return false;
  const etag = get(ETAG);
  const d = await api("/api/data", { headers: etag ? { "if-none-match": etag } : {} });
  if (d.status === 304) return false;
  setAll(toSources(d, d.me.hevy.synced));
  set(ME, JSON.stringify({ email: d.me.email, ...d.me }));
  set(ETAG, d.etag || null);
  return true;
}

// An account's data as it comes from the server -> the sources store.js draws from. Workouts are dated in this
// device's time zone. Used for my own account and for a friend's dashboard.
export function toSources(d, hevySynced = null) {
  const sources = {};
  for (const [id, s] of Object.entries(d.sources || {})) sources[id] = { ...s.data, imported: s.imported };
  if (d.workouts && d.workouts.length) {
    const lifts = summarizeWorkouts(fromApiWorkouts(d.workouts));
    sources.hevy_live = { days: lifts.days, exercises: lifts.exercises, imported: hevySynced ? new Date(hevySynced).toISOString() : null };
  }
  return sources;
}

// Every page: refresh from the account when signed in. Quiet when offline or signed out. Then, on an iPhone, bring
// Apple Health up to date if it's due (below).
export async function autoRefresh() {
  let changed = false;
  try { changed = await pull(); } catch (e) {}
  refreshNav();
  if (new URLSearchParams(location.search).has("health")) history.replaceState(null, "", location.pathname + location.hash);
  else runHealthIfDue();
  return changed;
}

// Apple Health without an automation: Apple lets no page, link or Shortcut create one, so when Motus is opened on an
// iPhone and the Shortcut hasn't sent anything for 12 hours, Motus runs it through Shortcuts' x-callback-url, which
// comes back here when it's done (?health=updated), cancelled or failed. At most once every 30 minutes, so a run that
// fails or is cancelled can't loop. The daily automation stays an option for numbers that are current even unopened.
export const ON_IPHONE = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const DUE_AFTER = 12 * 3600e3, AGAIN_AFTER = 30 * 60e3, TRIED = "motusapp-health-run";
export function healthRunLink(back = location.origin + location.pathname) {
  const to = s => encodeURIComponent(back + (back.includes("?") ? "&" : "?") + "health=" + s);
  return `shortcuts://x-callback-url/run-shortcut?name=Motus&x-success=${to("updated")}&x-cancel=${to("cancelled")}&x-error=${to("failed")}`;
}
export function runHealthNow(back) { set(TRIED, String(Date.now())); location.href = healthRunLink(back); }
function runHealthIfDue() {
  const h = (cachedMe() || {}).health;
  if (!ON_IPHONE || !h || !h.connected || Date.now() - (h.last_upload || 0) < DUE_AFTER) return;
  if (Date.now() - (+get(TRIED) || 0) < AGAIN_AFTER) return;
  runHealthNow();
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

// Health Connect (Android): a fresh HC Webhook token, inside HC Webhook's own settings file ({ url, token, settings }).
export async function androidSetup() {
  const r = await api("/api/android", { method: "POST" });
  set(ETAG, null);
  return r;
}

// The profile: name, username and photo. The photo is also kept on this device for the navbar.
const PHOTO = "motusapp-photo";
export const cachedPhoto = () => get(PHOTO);
export async function getProfile() {
  const p = await api("/api/profile");
  set(PHOTO, p.avatar || null);
  return p;
}
export async function saveProfile(fields) {
  const p = await api("/api/profile", { method: "PUT", body: fields });
  set(PHOTO, p.avatar || null);
  await checkAccount();
  return p;
}
export const profileLink = username => location.origin + "/u/" + encodeURIComponent(username);

// People and friends (worker/friends.js). Someone's dashboard shows to their friends, and to everyone signed in when
// their profile is public.
const who = u => encodeURIComponent(String(u || "").replace(/^@/, ""));
export const getFriends = () => api("/api/friends");
export const searchPeople = q => api("/api/people?q=" + encodeURIComponent(q));
export const getPerson = username => api("/api/people/" + who(username));
export const getPersonData = username => api("/api/people/" + who(username) + "/data");
export const addFriend = username => api("/api/friends", { method: "POST", body: { username } });
export const acceptFriend = username => api("/api/friends/accept", { method: "POST", body: { username } });
export const removeFriend = username => api("/api/friends/" + who(username), { method: "DELETE" });

// Apple Health: a fresh token for the Motus Shortcut, handed to it by running it once with the token as its input.
export async function healthSetupLink() {
  const { token, url } = await api("/api/health", { method: "POST" });
  return "shortcuts://run-shortcut?name=Motus&input=text&text=" + encodeURIComponent(url + "|" + token);
}
