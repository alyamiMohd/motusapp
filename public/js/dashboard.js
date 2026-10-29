// The dashboard drawn on Home, and on someone's profile when you may see it: this week's averages, the week strip,
// last week in one line, the last 7 days and 30-day charts. Draws into #top, #rows, #kg and #charts.
// Goals and units are the viewer's own Standards.
import { prefs, today, add, weekStart, weekAvg, avgRange, workoutsBetween, label, dayMonth, NO, esc, int, one,
         unit, toDisp, DAY_LETTERS, DAY_SHORT, dow } from "./core.js";

let days = {}, mine = true;   // mine: my own dashboard, so my planned training days show too

const M = [
  { k: "sleep_hours", name: "Sleep", f: one, met: v => v >= prefs.sleep },
  { k: "steps", name: "Steps", f: int, met: v => v >= prefs.steps },
  { k: "calories", name: "Calories", f: int, met: v => v <= prefs.calories },
  { k: "weight_kg", name: "Weight", f: v => one(toDisp(v)), met: () => false },
];

function weightPerWeek() {      // this week's average weight minus last week's (kg); negative = losing
  const ws = weekStart(today), cur = weekAvg(days, "weight_kg"), prev = avgRange(days, "weight_kg", add(ws, -7), add(ws, -1));
  return cur == null || prev == null ? null : cur - prev;
}

function weekStrip(ws) {        // first day -> last day of the week, filled on workout days
  const dots = Array.from({ length: 7 }, (_, i) => {
    const d = add(ws, i), done = ((days[d] || {}).workout_count || 0) > 0, wd = (i + prefs.weekStart) % 7;
    const cls = ["dot", done ? "on" : mine && prefs.days.includes(wd) ? "plan" : "", d === today ? "today" : "", d > today ? "future" : ""].join(" ");
    return `<div class="wd"><small>${DAY_LETTERS[wd]}</small><div class="${cls}">${+d.slice(8)}</div></div>`;
  }).join("");
  return `<div class="wide"><div class="weekhead"><small>Workout days</small>` +
    `<span class="legend"><span><i style="background:var(--green)"></i>trained</span>${mine ? '<span><i style="background:var(--gray)"></i>planned</span>' : ""}</span></div>` +
    `<div class="week" role="img" aria-label="Workout days this week: green trained, gray planned">${dots}</div></div>`;
}

function lastWeekLine(ws) {     // last week's averages; steps and weight also show the change vs the week before
  const from = add(ws, -7), to = add(ws, -1), pFrom = add(from, -7), pTo = add(from, -1);
  const sign = d => (d > 0 ? "+" : d < 0 ? "−" : "±");
  const part = (k, fmt, u, noun, dec, good, compare, changeUnit) => {
    const cur = avgRange(days, k, from, to);
    if (cur == null) return `<span class="no">– ${noun}</span>`;
    const prev = compare ? avgRange(days, k, pFrom, pTo) : null;
    const d = prev == null ? null : cur - prev;
    const dTxt = d == null ? "" : ` (${sign(+d.toFixed(dec))}${fmt(Math.abs(d))}${changeUnit || ""})`;
    return `<span class="${good(cur, d) ? "good2" : ""}">${fmt(cur)} ${u}${dTxt}</span>`;
  };
  const w = v => one(toDisp(v)), workouts = workoutsBetween(days, from, to);
  return `<div class="wide lastweek"><small>Last Week: ` + [
    part("sleep_hours", one, "h sleep", "sleep", 1, cur => cur >= prefs.sleep, false),
    part("steps", int, "steps", "steps", 0, cur => cur >= prefs.steps, true),
    part("calories", int, "kcal", "kcal", 0, cur => cur <= prefs.calories, false),
    part("weight_kg", w, unit(), "weight", 1, (cur, d) => d != null && d < 0 && -d >= prefs.weight, true, " " + unit()),
    `<span class="${workouts >= prefs.workouts ? "good2" : ""}">${workouts} workout${workouts === 1 ? "" : "s"}</span>`,
  ].join(' <span class="sep">|</span> ') + "</small></div>";
}

function summary() {
  const cell = (val, text, green, sub) => `<div><b class="${green ? "good" : ""}">${val == null ? NO : text}</b><small>${sub}</small></div>`;
  const ws = weekStart(today);
  const sl = weekAvg(days, "sleep_hours"), st = weekAvg(days, "steps"), ca = weekAvg(days, "calories"), w = weightPerWeek();
  const wText = w == null ? "" : (w > 0 ? "+" : w < 0 ? "−" : "") + one(Math.abs(toDisp(w))) + " " + unit();
  document.getElementById("top").innerHTML =
    `<div class="wide"><small>Weekly avg (Since ${DAY_SHORT[dow(ws)]}, ${dayMonth(ws)})</small></div>` +
    cell(sl, sl == null ? "" : one(sl) + " h", sl != null && sl >= prefs.sleep, "Sleep") +
    cell(st, st == null ? "" : int(st), st != null && st >= prefs.steps, "Steps") +
    cell(ca, ca == null ? "" : int(ca), ca != null && ca <= prefs.calories, "Calories") +
    cell(w, wText, w != null && w < 0 && -w >= prefs.weight,
         w == null ? "Weight per week" : "Weight per week, " + (w < 0 ? "lost" : w > 0 ? "gained" : "no change")) +
    weekStrip(ws) + lastWeekLine(ws);
}

function table() {
  document.getElementById("kg").textContent = unit() === "lb" ? "Lb" : "Kg";
  let html = "";
  for (let i = 0; i < 7; i++) {
    const d = add(today, -i), r = days[d] || {};
    html += `<tr><td>${label(d)}</td>` + M.map(m => {
      const v = r[m.k];
      return v == null ? `<td>${NO}</td>` : `<td class="${m.met(v) ? "good" : ""}">${m.f(v)}</td>`;
    }).join("") +
      (r.workout_count ? `<td title="${esc((r.workout_titles || []).join(", "))}">${r.workout_minutes ? r.workout_minutes + "m" : "✓"}</td>` : `<td class="muted">–</td>`) + "</tr>";
  }
  document.getElementById("rows").innerHTML = html;
}

function chart(m) {
  const N = 30, W = 300, H = 48;
  const vals = Array.from({ length: N }, (_, i) => (days[add(today, i - N + 1)] || {})[m.k] ?? null);
  const have = vals.filter(v => v != null);
  const div = document.createElement("div");
  div.className = "chart";
  if (!have.length) { div.innerHTML = `<small>${m.name}</small> ${NO}`; return div; }
  const line = m.k === "weight_kg";
  let lo = line ? Math.min(...have) : 0, hi = Math.max(...have);
  if (line) { const p = (hi - lo) || 1; lo -= p * .3; hi += p * .3; } else hi *= 1.1;
  const y = v => H - 2 - (v - lo) / (hi - lo) * (H - 4), s = W / N;
  let g = "";
  if (line) {
    let p = "", pen = false;
    vals.forEach((v, i) => { if (v == null) { pen = false; return; } p += (pen ? "L" : "M") + (i * s + s / 2).toFixed(1) + " " + y(v).toFixed(1); pen = true; });
    g = `<path d="${p}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/>` +
        vals.map((v, i) => v == null ? "" : `<circle cx="${i * s + s / 2}" cy="${y(v)}" r="2" fill="currentColor"/>`).join("");
  } else {
    g = vals.map((v, i) => v == null ? "" :
      `<rect x="${i * s + 1}" y="${y(v)}" width="${s - 2}" height="${H - 2 - y(v)}" fill="${m.met(v) ? "var(--green)" : "currentColor"}"/>`).join("");
  }
  div.innerHTML = `<small>${m.name}, 30 days</small><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${g}</svg>`;
  return div;
}

export function drawDashboard(data, { own = true } = {}) {
  days = data.days || {}; mine = own;
  summary(); table();
  document.getElementById("charts").replaceChildren(...M.map(chart));
}
