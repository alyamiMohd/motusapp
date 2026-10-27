// A plain spreadsheet (CSV) for every app without a direct import: Google Fit, Health Connect, Fitbit, Garmin,
// Samsung Health, a notebook... One row per day; every column but the date is optional.
import { parseCSV, columns, num, parseDateTime, LB } from "./csv.js";
import { add } from "../core.js";

export const TEMPLATE_HEADER = "date,sleep_hours,steps,calories,weight_kg,workouts,workout_minutes";

export function template(todayISO) {
  const ex = [[7.4, 8120, 1950, 80.6, 1, 62], [6.9, 10450, 2100, 80.4, "", ""], [7.8, 6300, 1880, "", 1, 55]];
  return TEMPLATE_HEADER + "\n" + ex.map((r, i) => [add(todayISO, i - 3), ...r].join(",")).join("\n") + "\n";
}

export function fromSheetCSV(text, unit = "kg") {
  const [header, ...rows] = parseCSV(text);
  if (!header) throw new Error("This file is empty.");
  const c = columns(header, { date: ["date", "day"], sleep: ["sleep_hours", "sleep", "sleep (h)", "hours slept"], steps: ["steps", "step count"],
    cal: ["calories", "kcal", "energy", "calories eaten"], kg: ["weight_kg", "weight (kg)"], lb: ["weight_lb", "weight_lbs", "weight (lb)", "weight (lbs)"],
    w: ["weight"], wc: ["workouts", "workout_count"], wm: ["workout_minutes", "lift minutes", "workout minutes"] });
  if (c.date < 0) throw new Error('No "date" column. Start from the template.');
  const days = {};
  let bad = 0;
  for (const r of rows) {
    const d = parseDateTime(r[c.date]);
    if (!d) { bad++; continue; }
    const rec = {};
    const v = i => (i >= 0 ? num(r[i]) : null);
    if (v(c.sleep)) rec.sleep_hours = v(c.sleep);
    if (v(c.steps)) rec.steps = Math.round(v(c.steps));
    if (v(c.cal)) rec.calories = Math.round(v(c.cal));
    const kg = v(c.kg) ?? (v(c.lb) != null ? v(c.lb) * LB : v(c.w) != null ? (unit === "lb" ? v(c.w) * LB : v(c.w)) : null);
    if (kg) rec.weight_kg = Math.round(kg * 10) / 10;
    if (v(c.wc)) { rec.workout_count = Math.round(v(c.wc)); rec.workout_minutes = Math.round(v(c.wm) || 0); rec.workout_titles = Array(rec.workout_count).fill("Workout"); }
    if (Object.keys(rec).length) days[d.date] = { ...days[d.date], ...rec };
  }
  if (!Object.keys(days).length) throw new Error(bad ? "Couldn't read the dates. Use YYYY-MM-DD, like 2026-10-25." : "No values found in this file.");
  return { days, replace: false, badRows: bad };
}
