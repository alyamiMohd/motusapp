// Strong: Settings -> Export Strong Data gives a CSV with one row per set. Older versions use ";" and a
// "Weight Unit" column; newer ones put the unit in the header ("Weight (kg)") and the duration in seconds.
import { summarizeWorkouts } from "../stats.js";
import { parseCSV, columns, num, parseDateTime, norm, LB } from "./csv.js";

// "1h 5m", "45m", "50 min", "3600" (seconds when the header says so, or when it's too long to be minutes)
function minutes(s, header) {
  s = String(s || "").trim();
  if (!s) return 0;
  if (/^\d+(\.\d+)?$/.test(s)) return /sec/i.test(header) || +s > 600 ? +s / 60 : +s;
  const h = /(\d+)\s*h/i.exec(s), m = /(\d+)\s*m(?!s)/i.exec(s), sec = /(\d+)\s*s/i.exec(s);
  return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0) + (sec ? +sec[1] / 60 : 0);
}

// unitFallback ("kg" | "lb") is used when the file doesn't say.
export function fromStrongCSV(text, unitFallback = "kg") {
  const [header, ...rows] = parseCSV(text);
  if (!header) throw new Error("This file is empty.");
  const c = columns(header, { date: ["date"], name: ["workout name"], dur: ["duration"], ex: ["exercise name"],
    order: ["set order"], weight: ["weight"], unit: ["weight unit"], reps: ["reps"] });
  if (c.date < 0 || c.ex < 0 || c.weight < 0 || c.reps < 0)
    throw new Error("This isn't a Strong export (missing Date, Exercise Name, Weight or Reps columns).");
  const wHead = norm(header[c.weight]);
  const headerUnit = /lb/.test(wHead) ? "lb" : /kg/.test(wHead) ? "kg" : null;
  const byWorkout = new Map();
  let bad = 0;
  for (const r of rows) {
    const at = parseDateTime(r[c.date]);
    if (!at) { bad++; continue; }
    const id = r[c.date] + "|" + (c.name >= 0 ? r[c.name] : "");
    let w = byWorkout.get(id);
    if (!w) {
      w = { date: at.date, title: (c.name >= 0 && r[c.name]) || "Workout", minutes: c.dur >= 0 ? minutes(r[c.dur], header[c.dur]) : 0,
            exercises: [], byEx: new Map() };
      byWorkout.set(id, w);
    }
    const name = r[c.ex] || "";
    let e = w.byEx.get(name);
    if (!e) { e = { title: name, sets: [] }; w.byEx.set(name, e); w.exercises.push(e); }
    const unit = (c.unit >= 0 && /lb/i.test(r[c.unit]) ? "lb" : c.unit >= 0 && /kg/i.test(r[c.unit]) ? "kg" : null) || headerUnit || unitFallback;
    const weight = num(r[c.weight]) || 0;
    e.sets.push({ warmup: c.order >= 0 && /^w/i.test(String(r[c.order]).trim()), kg: unit === "lb" ? weight * LB : weight, reps: num(r[c.reps]) });
  }
  if (!byWorkout.size) throw new Error(bad ? "Couldn't read the dates in this file." : "No workouts in this file.");
  const list = [...byWorkout.values()].map(({ byEx, ...w }) => w);
  return { ...summarizeWorkouts(list), replace: true, count: list.length, unitGuessed: !headerUnit && c.unit < 0 };
}
