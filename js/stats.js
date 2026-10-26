// Numbers derived from the merged data: per-day workout summaries, weekly history and workout ratings.
import { add, today, weekStart, prefs, workoutsBetween } from "./core.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

// Workouts from any app, normalised by its importer to:
//   { date: "YYYY-MM-DD", minutes, title, exercises: [{ title, sets: [{ warmup, kg, reps }] }] }
// Returns per-day totals and, per exercise and day, [date, best e1RM, weight, reps, volume] (oldest first).
// e1RM is Epley (weight x (1 + reps/30)) over sets of 12 reps or fewer; warm-ups and unweighted sets don't count.
export function summarizeWorkouts(list) {
  const days = {}, ex = {};
  for (const w of list) {
    if (!w || !/^\d{4}-\d{2}-\d{2}$/.test(w.date)) continue;
    const d = days[w.date] || (days[w.date] = { workout_count: 0, workout_minutes: 0, workout_volume_kg: 0, workout_titles: [] });
    d.workout_count += 1;
    d.workout_minutes += Math.max(0, Math.round(w.minutes || 0));
    d.workout_titles.push(String(w.title || "Workout").slice(0, 80));
    for (const e of w.exercises || []) {
      let best = null, volume = 0;
      for (const s of e.sets || []) {
        const kg = +s.kg || 0, reps = +s.reps || 0;
        d.workout_volume_kg += kg * reps;
        if (s.warmup || !kg || !reps) continue;
        volume += kg * reps;
        if (reps <= 12) {
          const e1rm = kg * (1 + reps / 30);
          if (!best || e1rm > best[0]) best = [e1rm, kg, reps];
        }
      }
      if (!best) continue;
      const title = String(e.title || "").trim().slice(0, 80);
      if (!title) continue;
      const byDay = ex[title] || (ex[title] = {});
      const prev = byDay[w.date];
      if (prev) {                                       // same exercise twice in a day: keep the best, add the volume
        if (best[0] <= prev[1]) best = [prev[1], prev[2], prev[3]];
        volume += prev[4];
      }
      byDay[w.date] = [w.date, round1(best[0]), round1(best[1]), best[2], Math.round(volume)];
    }
  }
  for (const d of Object.values(days)) d.workout_volume_kg = Math.round(d.workout_volume_kg);
  const exercises = {};
  for (const [t, byDay] of Object.entries(ex)) exercises[t] = Object.keys(byDay).sort().map(k => byDay[k]);
  return { days, exercises };
}
const round1 = v => Math.round(v * 10) / 10;

// ---- weekly history: one row per completed week; weeks with no data at all are skipped ----
const AVG = ["sleep_hours", "steps", "calories", "weight_kg"];
export function buildWeeks(days, todayISO = today, first = prefs.weekStart) {
  const dates = Object.keys(days).sort();
  if (!dates.length) return [];
  const out = [], thisWeek = weekStart(todayISO, first);
  for (let start = weekStart(dates[0], first); start < thisWeek; start = add(start, 7)) {
    const recs = Array.from({ length: 7 }, (_, i) => days[add(start, i)] || {});
    const row = { start, end: add(start, 6), days_with_data: {} };
    for (const k of AVG) {
      const v = recs.map(r => r[k]).filter(x => x != null);
      row[k] = v.length ? mean(v) : null;
      row.days_with_data[k] = v.length;
    }
    row.workouts = recs.reduce((t, r) => t + (r.workout_count || 0), 0);
    row.workout_minutes = recs.reduce((t, r) => t + (r.workout_minutes || 0), 0);
    row.workout_volume_kg = recs.reduce((t, r) => t + (r.workout_volume_kg || 0), 0);
    if (AVG.some(k => row[k] != null) || row.workouts) out.push(row);
  }
  return out;
}

// ---- workout ratings ----
const inWin = (d, from, to) => d > from && d <= to;           // (from, to]

// Per exercise: mean of per-session best e1RM, last 28 days vs the 28 before. Most recently trained first.
export function exerciseStats(exercises, todayISO = today) {
  const r28 = add(todayISO, -28), r56 = add(todayISO, -56), out = [];
  for (const [title, rows] of Object.entries(exercises)) {
    const recent = rows.filter(r => inWin(r[0], r28, todayISO)), prior = rows.filter(r => inWin(r[0], r56, r28));
    if (!recent.length && !prior.length) continue;
    const cur = recent.length ? Math.max(...recent.map(r => r[1])) : rows[rows.length - 1][1];
    const pct = recent.length && prior.length ? mean(recent.map(r => r[1])) / mean(prior.map(r => r[1])) - 1 : null;
    out.push({ title, rows, n: recent.length + prior.length, cur, pct, last: rows[rows.length - 1][0],
               scored: recent.length >= 2 && prior.length >= 2 });
  }
  return out.sort((a, b) => b.last.localeCompare(a.last) || b.n - a.n || a.title.localeCompare(b.title));
}

// Overall (last 4 weeks) = 0.7 x progress + 0.3 x consistency; consistency alone when nothing can be compared yet.
export function overallRating(stats, days, goal = prefs.workouts, todayISO = today) {
  const scored = stats.filter(s => s.scored);
  const progress = scored.length
    ? scored.reduce((t, s) => t + s.n * clamp(5 + s.pct * 100, 0, 10), 0) / scored.reduce((t, s) => t + s.n, 0)
    : null;
  const perWeek = workoutsBetween(days, add(todayISO, -27), todayISO) / 4;
  const consistency = clamp(perWeek / Math.max(goal, 1) * 10, 0, 10);
  return progress == null ? consistency : 0.7 * progress + 0.3 * consistency;
}

// pct = that day's best e1RM vs your recent level for the exercise.
// 7 = a normal session (within 5% below is plain noise); up to 10 at +10%; -0.8 per 10% under the 5% band; never below 3.
export function sessionScore(pct) {
  const p = pct * 100;
  if (p >= 0) return Math.min(10, 7 + 0.3 * p);
  if (p >= -5) return 7;
  return Math.max(3, 7 + 0.08 * (p + 5));
}

// One workout: each exercise's best e1RM that day vs the mean of its previous (up to) 4 sessions in the last ~3 months.
// Exercises without at least 2 earlier sessions are "new": listed, not rated, never a penalty.
export function workoutScore(exercises, date) {
  const parts = [], skipped = [], cutoff = add(date, -90);
  for (const [title, rows] of Object.entries(exercises)) {
    const i = rows.findIndex(r => r[0] === date);
    if (i < 0) continue;
    const prev = rows.slice(Math.max(0, i - 4), i).filter(r => r[0] >= cutoff);
    if (prev.length < 2) { skipped.push(title); continue; }
    const pct = rows[i][1] / mean(prev.map(r => r[1])) - 1;
    parts.push({ title, pct, score: sessionScore(pct) });
  }
  return parts.length ? { score: mean(parts.map(p => p.score)), parts, skipped } : null;
}
