// Demo data: shown until a visitor imports their own. Made up, generated in the browser around today's date
// from a fixed seed, so every visitor sees the same believable five months of sleep, steps, food, weight and training.
import { add, dow } from "./core.js";
import { summarizeWorkouts } from "./stats.js";

function rng(seed) {                         // mulberry32: small, fast, deterministic
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// weekday -> [session title, [[exercise, starting e1RM kg, reps, kg step]]]
const PLAN = {
  1: ["Upper A", [["Bench Press (Barbell)", 82, 5, 2.5], ["Bent Over Row (Barbell)", 74, 8, 2.5], ["Overhead Press (Barbell)", 52, 6, 2.5],
                  ["Lat Pulldown (Cable)", 72, 10, 2.5], ["Bicep Curl (Dumbbell)", 19, 10, 1]]],
  2: ["Lower A", [["Squat (Barbell)", 112, 5, 2.5], ["Romanian Deadlift (Barbell)", 102, 8, 2.5], ["Leg Press (Machine)", 185, 10, 5],
                  ["Lying Leg Curl (Machine)", 52, 10, 2.5]]],
  4: ["Upper B", [["Incline Bench Press (Dumbbell)", 31, 8, 1], ["Seated Cable Row", 72, 10, 2.5], ["Lateral Raise (Dumbbell)", 12.5, 12, 1],
                  ["Triceps Pushdown (Cable)", 36, 10, 2.5]]],
  5: ["Lower B", [["Deadlift (Barbell)", 142, 5, 2.5], ["Bulgarian Split Squat (Dumbbell)", 23, 8, 1], ["Hip Thrust (Barbell)", 124, 8, 2.5],
                  ["Standing Calf Raise (Machine)", 92, 12, 5]]],
};
const NEW_EXERCISE = ["Cable Fly", 31, 12, 2.5];   // added to Upper A two weeks ago: shows how "new" exercises look

export function generateDemo(todayISO, length = 150) {
  const r = rng(20261026);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
  const days = {}, workouts = [], sessions = {};
  for (let i = length; i >= 0; i--) {
    const d = add(todayISO, -i), wd = dow(d), weekend = wd === 0 || wd === 6, isToday = i === 0;
    const plan = PLAN[wd];
    const trains = plan && !isToday && r() < 0.88;              // today's session hasn't happened yet
    const rec = { sleep_hours: null, steps: null, calories: null, weight_kg: null };
    if (r() > 0.04) rec.sleep_hours = round(clamp(7.05 + (weekend ? 0.5 : 0) + gauss() * 0.55, 5.2, 9.4), 2);
    rec.steps = isToday ? Math.round(1400 + r() * 1600)
      : Math.round(clamp(7600 + (trains ? 1300 : 0) + (weekend ? 1800 * r() : 0) + gauss() * 2100, 2600, 17500));
    if (r() > 0.06) rec.calories = isToday ? Math.round(520 + r() * 380) : Math.round(clamp(1960 + (weekend ? 220 : 0) + gauss() * 230, 1450, 2900));
    if (isToday || r() < 0.8) rec.weight_kg = round(84.3 - (length - i) * 0.031 + gauss() * 0.32, 1);
    days[d] = rec;
    if (!trains) continue;
    const list = [...plan[1]];
    if (wd === 1 && i <= 14) list.push(NEW_EXERCISE);
    workouts.push({
      date: d, title: plan[0], minutes: Math.round(48 + r() * 26),
      exercises: list.map(([title, base, reps, step]) => {
        const n = sessions[title] = (sessions[title] || 0) + 1;
        const e1rm = base * (1 + 0.0035 * n) * (1 + gauss() * 0.022) * (r() < 0.06 ? 0.92 : 1);
        const top = Math.max(step, Math.round(e1rm / (1 + reps / 30) / step) * step);
        const back = Math.max(step, Math.round(top * 0.92 / step) * step);
        const sets = [{ kg: top, reps }, { kg: back, reps: reps + 1 }, { kg: back, reps }];
        if (step === 2.5 && top >= 60) sets.unshift({ kg: Math.round(top * 0.5 / step) * step, reps: 8, warmup: true });
        return { title, sets };
      }),
    });
  }
  const lifts = summarizeWorkouts(workouts);
  for (const [d, w] of Object.entries(lifts.days)) Object.assign(days[d], w);
  return { days, exercises: lifts.exercises };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round = (v, n) => Math.round(v * 10 ** n) / 10 ** n;
