// How one source's data is cleaned and merged. Shared by the browser's store and the Motus server (worker/),
// so an import is treated the same whether it is kept on the device or in someone's account.

export const BODY = ["sleep_hours", "steps", "calories", "weight_kg", "active_kcal"];
export const LIFT = ["workout_count", "workout_minutes", "workout_volume_kg", "workout_titles"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

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

// src = { days, exercises } or undefined; result = { days, exercises?, replace? }.
// replace: the import is a full history (e.g. a Hevy export), so it replaces what the source had.
// Otherwise it is merged in: newer values win per day and metric, other days are kept.
// Returns a new { days, exercises }; src is not changed.
export function mergeSource(src, result) {
  const out = result.replace || !src ? { days: {}, exercises: {} }
    : { days: { ...(src.days || {}) }, exercises: { ...(src.exercises || {}) } };
  for (const [d, vals] of Object.entries((result && result.days) || {})) {
    if (!DATE.test(d) || !vals || typeof vals !== "object") continue;
    const rec = { ...(out.days[d] || {}) };
    if (vals.workout_count) LIFT.forEach(k => delete rec[k]);  // a day's workouts are replaced as a group
    for (const [k, v] of Object.entries(vals)) { const c = clean(k, v); if (c != null) rec[k] = c; }
    if (Object.keys(rec).length) out.days[d] = rec;
  }
  for (const [t, rows] of Object.entries((result && result.exercises) || {})) {
    if (!Array.isArray(rows)) continue;
    const title = String(t).slice(0, 80), byDate = Object.fromEntries((out.exercises[title] || []).map(r => [r[0], r]));
    for (const r of rows) {
      if (Array.isArray(r) && DATE.test(r[0]) && r.slice(1, 5).every(x => Number.isFinite(x) && x >= 0) && r[1] > 0)
        byDate[r[0]] = r.slice(0, 5);
    }
    if (Object.keys(byDate).length) out.exercises[title] = Object.keys(byDate).sort().map(k => byDate[k]);
  }
  return out;
}
