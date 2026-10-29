// The data every page draws from, kept in this browser's localStorage. Without an account it lives only here;
// signed in, it is a copy of the account (js/account.js keeps the two in step).
// Each connected app is kept as its own source, so importing it again updates it cleanly and it can be removed
// on its own. When two sources have the same metric for the same day, the one earlier in SOURCES wins.
// With no sources at all, the demo is shown instead.
import { today } from "./core.js";
import { generateDemo } from "./demo.js";
import { BODY, LIFT, clean, mergeSource } from "./merge.js";
export { clean };

const KEY = "motusapp-data-v1";
export const SOURCES = {
  manual: "Entered by hand",
  health: "Apple Health (connected)",
  hc: "Health Connect (connected)",
  apple: "Apple Health (file)",
  mfp: "MyFitnessPal",
  csv: "Spreadsheet",
  hevy_live: "Hevy (connected)",
  hevy: "Hevy (file)",
  strong: "Strong",
};
// sources the account server fills by itself; everything else is imported on a device
export const SERVER_SOURCES = ["health", "hc", "hevy_live"];
// the sources that bring workouts: the Workouts page and its link only show with one of them
export const WORKOUT_SOURCES = ["hevy_live", "hevy", "strong"];
export const hasWorkouts = () => WORKOUT_SOURCES.some(id => load().sources[id]);

let memory = null;   // used when storage is blocked (some private modes): the data lasts for this visit only
export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const x = JSON.parse(raw); if (x && typeof x.sources === "object" && x.sources) return x; }
  } catch (e) {}
  return memory ? JSON.parse(JSON.stringify(memory)) : { v: 1, sources: {} };
}
function save(state) {
  memory = state;
  try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch (e) { return false; }
}

// result = { days: { date: { metric: value } }, exercises?: { title: [[date, e1rm, kg, reps, volume]] }, replace?: bool }
// (see mergeSource in merge.js)
export function putSource(id, result, now = new Date()) {
  if (!(id in SOURCES)) throw new Error("unknown source " + id);
  const state = load();
  state.sources[id] = { ...mergeSource(state.sources[id], result), imported: now.toISOString() };
  return save(state);
}

// Replace everything with the account's sources (signed in): { id: { days, exercises, imported } }.
export function setAll(sources) {
  const state = { v: 1, sources: {} };
  for (const [id, s] of Object.entries(sources || {})) {
    if (id in SOURCES && s && typeof s.days === "object") state.sources[id] = { ...mergeSource(null, { ...s, replace: true }), imported: s.imported || null };
  }
  return save(state);
}

export function removeSource(id) { const s = load(); delete s.sources[id]; return save(s); }
export function clearAll() { memory = null; try { localStorage.removeItem(KEY); } catch (e) {} }
export const backup = () => JSON.stringify({ app: "motus", ...load() });
// Restoring goes through putSource, so a damaged or hand-edited file can't bring in odd values.
export function restore(obj) {
  const valid = obj && typeof obj.sources === "object" && obj.sources &&
    Object.entries(obj.sources).filter(([id, s]) => id in SOURCES && s && typeof s.days === "object" && s.days);
  if (!valid || !valid.length) throw new Error("This isn't a Motus backup file, or it has no data in it.");
  clearAll();
  for (const [id, s] of valid) {
    const when = new Date(s.imported);
    putSource(id, { days: s.days, exercises: s.exercises || {}, replace: true }, isNaN(when) ? new Date() : when);
  }
  return valid.length;
}

// The merged view every page draws from: this device's sources. With none: the demo for visitors, and an empty
// dashboard once signed in (the account's own numbers only, never made-up ones).
const signedIn = () => { try { return !!JSON.parse(localStorage.getItem("motusapp-me") || "null"); } catch (e) { return false; } };
export function getData(todayISO = today) {
  const state = load();
  if (!Object.keys(SOURCES).some(id => state.sources[id]))
    return signedIn() ? { days: {}, exercises: {}, demo: false, empty: true, sources: [] } : { ...generateDemo(todayISO), demo: true, sources: [] };
  return dataFrom(state.sources);
}

// The same merged view of any set of sources (a friend's dashboard): { id: { days, exercises, imported } }
export function dataFrom(all) {
  const ids = Object.keys(SOURCES).filter(id => all[id]);
  const days = {}, exercises = {};
  for (const id of ids) {
    const s = all[id];
    for (const [d, r] of Object.entries(s.days || {})) {
      const rec = days[d] || (days[d] = {});
      for (const k of BODY) if (rec[k] == null && r[k] != null) rec[k] = r[k];
      if (!rec.workout_count && r.workout_count) LIFT.forEach(k => { rec[k] = r[k] ?? null; });
    }
    for (const [t, rows] of Object.entries(s.exercises || {})) {
      const have = exercises[t] || (exercises[t] = []), dates = new Set(have.map(r => r[0]));
      for (const r of rows) if (!dates.has(r[0])) have.push(r);
    }
  }
  for (const rows of Object.values(exercises)) rows.sort((a, b) => a[0].localeCompare(b[0]));
  const sources = ids.map(id => {
    const ds = Object.keys(all[id].days || {}).sort();
    return { id, name: SOURCES[id], imported: all[id].imported, count: ds.length, first: ds[0], last: ds[ds.length - 1] };
  });
  return { days, exercises, demo: false, sources };
}
