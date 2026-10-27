// Where a visitor's data lives: this browser's localStorage, on their device only. Nothing is sent anywhere.
// Each connected app is kept as its own source, so importing it again updates it cleanly and it can be removed
// on its own. When two sources have the same metric for the same day, the one earlier in SOURCES wins.
// With no sources at all, the demo is shown instead.
import { today } from "./core.js";
import { generateDemo } from "./demo.js";

const KEY = "motusapp-data-v1";
export const SOURCES = {
  manual: "Entered by hand",
  sync: "Automatic sync",
  apple: "Apple Health",
  mfp: "MyFitnessPal",
  csv: "Spreadsheet",
  hevy: "Hevy",
  strong: "Strong",
};
const BODY = ["sleep_hours", "steps", "calories", "weight_kg", "active_kcal"];
const LIFT = ["workout_count", "workout_minutes", "workout_volume_kg", "workout_titles"];

// Plausible ranges; anything outside (or zero) is treated as "no data" rather than shown as a wild number.
const RANGE = { sleep_hours: [0, 24], steps: [0, 200000], calories: [0, 30000], weight_kg: [20, 400], active_kcal: [0, 30000],
                workout_count: [0, 20], workout_minutes: [0, 1440], workout_volume_kg: [0, 1e6] };
export function clean(key, v) {
  if (key === "workout_titles") return Array.isArray(v) ? v.map(t => String(t).slice(0, 80)).slice(0, 20) : null;
  const r = RANGE[key];
  if (!r) return undefined;
  v = typeof v === "string" ? parseFloat(v) : v;
  return typeof v === "number" && Number.isFinite(v) && v > r[0] && v <= r[1] ? v : null;
}

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
// replace: the import is a full history (e.g. a Hevy export), so it replaces what that source had.
// Otherwise it is merged in: newer values win per day and metric, other days are kept.
export function putSource(id, result, now = new Date()) {
  if (!(id in SOURCES)) throw new Error("unknown source " + id);
  const state = load();
  const src = result.replace || !state.sources[id] ? { days: {}, exercises: {} } : state.sources[id];
  for (const [d, vals] of Object.entries(result.days || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const rec = { ...(src.days[d] || {}) };
    if (vals.workout_count) LIFT.forEach(k => delete rec[k]);  // a day's workouts are replaced as a group
    for (const [k, v] of Object.entries(vals)) { const c = clean(k, v); if (c != null) rec[k] = c; }
    if (Object.keys(rec).length) src.days[d] = rec;
  }
  for (const [t, rows] of Object.entries(result.exercises || {})) {
    if (!Array.isArray(rows)) continue;
    const title = t.slice(0, 80), byDate = Object.fromEntries((src.exercises[title] || []).map(r => [r[0], r]));
    for (const r of rows) {
      if (Array.isArray(r) && /^\d{4}-\d{2}-\d{2}$/.test(r[0]) && r.slice(1, 5).every(x => Number.isFinite(x) && x >= 0) && r[1] > 0)
        byDate[r[0]] = r.slice(0, 5);
    }
    if (Object.keys(byDate).length) src.exercises[title] = Object.keys(byDate).sort().map(k => byDate[k]);
  }
  src.imported = now.toISOString();
  state.sources[id] = src;
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

// The merged view every page draws from.
export function getData(todayISO = today) {
  const state = load(), ids = Object.keys(SOURCES).filter(id => state.sources[id]);
  if (!ids.length) return { ...generateDemo(todayISO), demo: true, sources: [] };
  const days = {}, exercises = {};
  for (const id of ids) {
    const s = state.sources[id];
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
    const ds = Object.keys(state.sources[id].days || {}).sort();
    return { id, name: SOURCES[id], imported: state.sources[id].imported, count: ds.length, first: ds[0], last: ds[ds.length - 1] };
  });
  return { days, exercises, demo: false, sources };
}
