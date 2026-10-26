// Weeks: one row per completed week, newest first, with a CSV download of the whole history.
import { prefs, add, dayMonth, one, int, unit, toDisp, initNav, download } from "../core.js";
import { getData } from "../store.js";
import { buildWeeks } from "../stats.js";

const SHOWN = 12, NODATA = '<span class="no">no data</span>';
const data = getData();
let weeks = [], showAll = false;

const span = w => (w.start.slice(5, 7) === w.end.slice(5, 7) ? String(+w.start.slice(8)) : dayMonth(w.start)) + "–" + dayMonth(w.end);
const cell = (v, fmt, green) => (v == null ? `<td>${NODATA}</td>` : `<td class="${green ? "good" : ""}">${fmt(v)}</td>`);

function render() {
  weeks = buildWeeks(data.days);
  document.getElementById("kg").textContent = unit() === "lb" ? "Lb" : "Kg";
  const byStart = Object.fromEntries(weeks.map(w => [w.start, w]));
  const list = [...weeks].reverse();
  const rows = (showAll ? list : list.slice(0, SHOWN)).map(w => {
    const prev = byStart[add(w.start, -7)];        // weight is green when the average dropped by the goal vs the week before
    const lost = prev && prev.weight_kg != null && w.weight_kg != null ? prev.weight_kg - w.weight_kg : null;
    return `<tr><td>${span(w)}</td>` +
      cell(w.sleep_hours, one, w.sleep_hours >= prefs.sleep) +
      cell(w.steps, int, w.steps >= prefs.steps) +
      cell(w.calories, int, w.calories <= prefs.calories) +
      cell(w.weight_kg, v => one(toDisp(v)), lost != null && lost > 0 && lost >= prefs.weight) +
      `<td class="${w.workouts >= prefs.workouts ? "good" : ""}">${w.workouts}</td></tr>`;
  });
  document.getElementById("rows").innerHTML = rows.join("") || `<tr><td colspan="6">${NODATA}</td></tr>`;
  const more = document.getElementById("more");
  more.hidden = list.length <= SHOWN;
  more.textContent = showAll ? "Show fewer" : "Show all " + list.length;
}

function csv() {
  const r = (v, d) => (v == null ? "" : d === 0 ? Math.round(v) : v.toFixed(d));
  const lines = [`week_start,week_end,sleep_hours,steps,calories,weight_${unit()},workouts,workout_minutes,volume_${unit()}`];
  for (const w of [...weeks].reverse()) {
    lines.push([w.start, w.end, r(w.sleep_hours, 2), r(w.steps, 0), r(w.calories, 0), r(w.weight_kg == null ? null : toDisp(w.weight_kg), 1),
                w.workouts, w.workout_minutes, Math.round(toDisp(w.workout_volume_kg))].join(","));
  }
  return lines.join("\n") + "\n";
}

document.getElementById("more").onclick = () => { showAll = !showAll; render(); };
document.getElementById("csv").onclick = () => download("motus-weeks.csv", csv(), "text/csv");
initNav("weeks", render);
render();
if (data.demo) {
  const el = document.getElementById("banner");
  el.innerHTML = 'Demo weeks. <a href="connect.html">Connect your apps</a> to see your own history.';
  el.hidden = false;
}
