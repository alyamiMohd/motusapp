// Workouts: last workout rating, overall rating, workouts per week, exercises by estimated 1RM, ratings per workout.
import { prefs, today, add, weekStart, workoutsBetween, label, esc, unit, toDisp, initNav } from "../core.js";
import { getData } from "../store.js";
import { exerciseStats, overallRating, workoutScore, mean } from "../stats.js";

const data = getData();
const { days, exercises } = data;
let showAll = false, weekOffset = 0;

const pctText = p => (p > 0 ? "+" : p < 0 ? "−" : "") + Math.abs(p * 100).toFixed(1) + "%";
const scoreHTML = sc => sc == null ? '<span class="no">no data</span>' : `<span class="${sc >= 7 ? "good" : ""}">${sc.toFixed(1)}</span>`;
const workoutDates = () => Object.keys(days).filter(d => days[d].workout_count && d <= today).sort();
const titles = d => esc((days[d].workout_titles || []).join(", "));

function spark(rows, good) {
  const pts = rows.slice(-24).map(r => r[1]);
  if (pts.length < 2) return "";
  const W = 300, H = 28, lo = Math.min(...pts), hi = Math.max(...pts), p = (hi - lo) || 1;
  const y = v => H - 3 - (v - lo) / p * (H - 6), x = i => i / (pts.length - 1) * W;
  const d = pts.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join(" ");
  const color = good ? "var(--green)" : "currentColor";
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">` +
         `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
}

function renderLast() {
  const dates = workoutDates(), el = document.getElementById("last");
  if (!dates.length) { el.innerHTML = '<span class="no">no workouts yet</span>'; return; }
  const d = dates[dates.length - 1], r = workoutScore(exercises, d);
  el.innerHTML = (r ? `<b class="${r.score >= 7 ? "good" : ""}">${r.score.toFixed(1)}</b><span> / 10</span>`
                    : '<span class="no" style="font-size:20px">not enough history to rate</span>') +
                 `<div><small>${label(d)} · ${titles(d)}</small></div>`;
}

function renderScore(stats) {
  const total = overallRating(stats, days);
  document.getElementById("score").innerHTML = `<b class="${total >= 7 ? "good" : ""}">${total.toFixed(1)}</b><span> / 10</span>`;
}

function renderWeeks() {
  const start = weekStart(today), N = 12, W = 300, H = 48;
  const weeks = Array.from({ length: N }, (_, i) => { const s = add(start, -7 * (N - 1 - i)); return { s, c: workoutsBetween(days, s, add(s, 6)) }; });
  const hi = Math.max(6, ...weeks.map(w => w.c)) * 1.05, step = W / N;
  const bars = weeks.map((w, i) => {
    if (!w.c) return "";
    const h = w.c / hi * (H - 4);
    return `<rect x="${i * step + 2}" y="${H - 2 - h}" width="${step - 4}" height="${h}" fill="${w.c >= prefs.workouts ? "var(--green)" : "var(--text)"}"` +
           `${i === N - 1 ? ' opacity=".5"' : ""}><title>Week of ${label(w.s)}: ${w.c}</title></rect>`;
  }).join("");
  document.getElementById("weeks").innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Workouts per week, last 12 weeks">${bars}</svg>` +
    `<div class="legend"><span><i style="background:var(--green)"></i>${prefs.workouts}+ workouts</span>` +
    `<span><i style="background:var(--text)"></i>below ${prefs.workouts}</span><small>fainter = this week</small></div>`;
}

function renderExercises(stats) {
  const shown = showAll ? stats : stats.slice(0, 10);
  let html = shown.map(s => {
    const good = s.pct != null && s.pct > 0;
    const change = s.pct == null ? '<span class="no">new</span>' : `<span class="${good ? "good" : "muted"}">${pctText(s.pct)}</span>`;
    return `<div class="ex"><div class="head"><span class="name">${esc(s.title)}</span>` +
           `<span>${Math.round(toDisp(s.cur))} ${unit()} &nbsp;${change}</span></div>${spark(s.rows, good)}</div>`;
  }).join("");
  if (stats.length > 10) html += `<button class="more" id="more">${showAll ? "Show fewer" : "Show all " + stats.length}</button>`;
  document.getElementById("exercises").innerHTML = html || '<span class="no">no exercises in the last 8 weeks</span>';
  const more = document.getElementById("more");
  if (more) more.onclick = () => { showAll = !showAll; renderExercises(stats); };
}

function renderRatings() {
  const ws = add(weekStart(today), -7 * weekOffset);
  const dates = workoutDates().filter(d => d >= ws && d <= add(ws, 6)).reverse();
  const scored = dates.map(d => workoutScore(exercises, d)).filter(Boolean);
  let html = dates.map(d => {
    const r = workoutScore(exercises, d);
    const detail = r ? r.parts.sort((a, b) => b.pct - a.pct).map(p =>
      `<div class="recent"><span class="t">${esc(p.title)}</span><span class="r ${p.pct > 0 ? "good" : ""}">${pctText(p.pct)}</span></div>`).join("") +
      r.skipped.map(t => `<div class="recent"><span class="t muted">${esc(t)}</span><span class="r">not rated (new)</span></div>`).join("")
      : '<div class="recent"><span class="t muted">not enough history to compare</span></div>';
    return `<details><summary class="recent"><span class="t">${label(d)} · ${titles(d)}</span><span>${scoreHTML(r && r.score)}</span></summary>${detail}</details>`;
  }).join("");
  if (!dates.length) html = '<span class="no">no workouts</span>';
  else if (scored.length > 1) html += `<div class="recent"><span class="t muted">Average</span><span>${scoreHTML(mean(scored.map(r => r.score)))}</span></div>`;
  document.getElementById("ratings").innerHTML = html;
  document.querySelectorAll(".tab").forEach(b => { b.classList.toggle("on", +b.dataset.w === weekOffset); b.setAttribute("aria-pressed", +b.dataset.w === weekOffset); });
}
document.querySelectorAll(".tab").forEach(b => b.onclick = () => { weekOffset = +b.dataset.w; renderRatings(); });

function render() {
  const stats = exerciseStats(exercises);
  renderLast(); renderScore(stats); renderWeeks(); renderExercises(stats); renderRatings();
}

initNav("workouts", render);
if (!workoutDates().some(d => d >= weekStart(today))) weekOffset = 1;   // nothing yet this week: open on last week
render();
if (data.demo) {
  const el = document.getElementById("banner");
  el.innerHTML = 'Demo workouts. <a href="connect.html">Connect Hevy or Strong</a> to rate your own.';
  el.hidden = false;
}
