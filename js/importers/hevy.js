// Hevy. Two ways in:
// - API key (Hevy Pro): read-only GET requests from this browser straight to api.hevyapp.com. Nothing else sees the key.
// - CSV export from the app (any Hevy account): Settings -> Export & Import Data -> Export Workouts.
import { summarizeWorkouts } from "../stats.js";
import { localISO } from "../core.js";
import { parseCSV, columns, num, parseDateTime, LB } from "./csv.js";

const API = "https://api.hevyapp.com/v1/workouts";

// Hevy API workouts -> the common workout shape (see summarizeWorkouts).
export function fromApiWorkouts(list) {
  return list.map(w => {
    const start = new Date(w.start_time), end = new Date(w.end_time);
    if (isNaN(start)) return null;
    return {
      date: localISO(start), title: w.title, minutes: isNaN(end) ? 0 : (end - start) / 60000,
      exercises: (w.exercises || []).map(e => ({
        title: e.title,
        sets: (e.sets || []).map(s => ({ warmup: s.type === "warmup", kg: s.weight_kg, reps: s.reps })),
      })),
    };
  }).filter(Boolean);
}

// Every workout, newest first, 10 per page (Hevy's limit). Retries busy/server errors; a bad key stops at once.
export async function fetchHevy(key, onProgress = () => {}, fetchFn = fetch, wait = ms => new Promise(r => setTimeout(r, ms))) {
  key = String(key || "").trim();
  if (!/^[\w-]{8,}$/.test(key)) throw new Error("That doesn't look like a Hevy API key.");
  const all = [];
  for (let page = 1, pages = 1; page <= pages; page++) {
    let res;
    for (let attempt = 1; ; attempt++) {
      try { res = await fetchFn(`${API}?page=${page}&pageSize=10`, { headers: { "api-key": key, accept: "application/json" } }); }
      catch (e) { if (attempt >= 4) throw new Error("Couldn't reach Hevy. Check your connection and try again."); await wait(1000 * 2 ** attempt); continue; }
      if ((res.status === 429 || res.status >= 500) && attempt < 4) { await wait(1000 * 2 ** attempt); continue; }
      break;
    }
    if (res.status === 401 || res.status === 403) throw new Error("Hevy didn't accept that key. Copy it again from Hevy (Settings → Developer); it needs Hevy Pro.");
    if (res.status === 404 && page > 1) break;
    if (!res.ok) throw new Error(`Hevy answered with an error (${res.status}). Try again later.`);
    const data = await res.json();
    all.push(...(data.workouts || []));
    pages = Math.min(data.page_count || 1, 2000);
    onProgress(page / pages, all.length);
  }
  return { ...summarizeWorkouts(fromApiWorkouts(all)), replace: true, count: all.length };
}

// Hevy CSV: title, start_time, end_time, exercise_title, set_type, weight_kg | weight_lbs, reps, ...
export function fromHevyCSV(text) {
  const [header, ...rows] = parseCSV(text);
  if (!header) throw new Error("This file is empty.");
  const c = columns(header, { title: ["title"], start: ["start_time"], end: ["end_time"], ex: ["exercise_title"],
    type: ["set_type"], kg: ["weight_kg"], lbs: ["weight_lbs", "weight_lb"], reps: ["reps"] });
  if (c.start < 0 || c.ex < 0 || c.reps < 0 || (c.kg < 0 && c.lbs < 0))
    throw new Error("This isn't a Hevy workouts CSV (missing start_time, exercise_title, reps or weight columns).");
  const byWorkout = new Map();
  let bad = 0;
  for (const r of rows) {
    const start = parseDateTime(r[c.start]);
    if (!start) { bad++; continue; }
    const id = r[c.start] + "|" + (r[c.title] || "");
    let w = byWorkout.get(id);
    if (!w) {
      const end = c.end >= 0 ? parseDateTime(r[c.end]) : null;
      w = { date: start.date, title: r[c.title] || "Workout", minutes: end ? end.t - start.t : 0, exercises: [], byEx: new Map() };
      byWorkout.set(id, w);
    }
    const name = r[c.ex] || "";
    let e = w.byEx.get(name);
    if (!e) { e = { title: name, sets: [] }; w.byEx.set(name, e); w.exercises.push(e); }
    const kg = c.kg >= 0 ? num(r[c.kg]) : (num(r[c.lbs]) || 0) * LB;
    e.sets.push({ warmup: c.type >= 0 && /warm/i.test(r[c.type]), kg, reps: num(r[c.reps]) });
  }
  if (!byWorkout.size) throw new Error(bad ? "Couldn't read the dates in this file." : "No workouts in this file.");
  const list = [...byWorkout.values()].map(({ byEx, ...w }) => w);
  return { ...summarizeWorkouts(list), replace: true, count: list.length };
}
