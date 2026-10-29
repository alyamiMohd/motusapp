// Shared by every page: dates, preferences (goals, units, week start), formatting and the navbar.
// Everything here runs in the visitor's browser; preferences are saved on their device only.

const PREFS_KEY = "motusapp-prefs";
const LB = 0.45359237;

// training days: 0 = Sunday ... 6 = Saturday; weight 0 = any loss counts (stored in kg)
export const DEFAULTS = { steps: 8000, sleep: 7, calories: 2000, weight: 0, workouts: 4, days: [1, 2, 4, 5], units: "kg", weekStart: 0 };

function readPrefs() {
  const p = { ...DEFAULTS, days: [...DEFAULTS.days] };
  try { Object.assign(p, JSON.parse(localStorage.getItem(PREFS_KEY) || "{}")); } catch (e) {}
  if (!Array.isArray(p.days)) p.days = [...DEFAULTS.days];
  if (p.units !== "lb") p.units = "kg";
  p.weekStart = p.weekStart === 1 ? 1 : 0;
  return p;
}
export const prefs = readPrefs();
export const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {} };

// ---- dates: plain "YYYY-MM-DD" strings in the visitor's own time zone ----
const pad = n => String(n).padStart(2, "0");
export const localISO = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = localISO();
export const add = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const dow = iso => new Date(iso + "T00:00:00Z").getUTCDay();
export const weekStart = (iso, first = prefs.weekStart) => add(iso, -((dow(iso) - first + 7) % 7));
export const DAY_LETTERS = "SMTWTFS";
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const label = iso => DAY_SHORT[dow(iso)] + " " + +iso.slice(8);                  // "Mon 26", the same in every browser
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dayMonth = iso => +iso.slice(8) + " " + MONTHS[+iso.slice(5, 7) - 1];      // "27 Sep"

// Week-to-date average. Steps and calories stop at YESTERDAY because today is only a partial day (first steps,
// first meals); sleep and weight include TODAY (a night's sleep and a morning weigh-in are complete).
// Days without data are ignored; no data at all gives null (on the first day of a week, steps/calories have nothing yet).
export const AVG_THROUGH = { steps: "yesterday", calories: "yesterday", sleep_hours: "today", weight_kg: "today" };
export function weekAvg(days, key, todayISO = today, first = prefs.weekStart) {
  const to = AVG_THROUGH[key] === "yesterday" ? add(todayISO, -1) : todayISO;
  return avgRange(days, key, weekStart(todayISO, first), to);
}
export function avgRange(days, key, from, to) {        // mean of the days that have data, inclusive dates
  const v = [];
  for (let d = from; d <= to; d = add(d, 1)) { const x = (days[d] || {})[key]; if (x != null) v.push(x); }
  return v.length ? v.reduce((a, b) => a + b) / v.length : null;
}
export function workoutsBetween(days, from, to) {     // number of workouts, inclusive dates
  let n = 0;
  for (let d = from; d <= to; d = add(d, 1)) n += (days[d] || {}).workout_count || 0;
  return n;
}

// ---- formatting ----
export const NO = '<span class="no">no data</span>';
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const int = v => Math.round(v).toLocaleString("en-US");
export const one = v => v.toFixed(1);
export const unit = () => prefs.units;                                  // "kg" or "lb"
export const toDisp = kg => (prefs.units === "lb" ? kg / LB : kg);       // stored values are always kg
export const fromDisp = v => (prefs.units === "lb" ? v * LB : v);
export const LB_PER_KG = 1 / LB;

export function download(name, text, type = "text/plain") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// What the navbar needs from this device's copy, read directly so this module doesn't depend on store.js and
// account.js (which depend on it): who is signed in and their photo (account.js), and whether a workout tracker
// (Hevy or Strong) brought workouts (store.js, WORKOUT_SOURCES): the Workouts link only shows then.
const stored = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
function navState() {
  let me = null, sources = {};
  try { me = JSON.parse(stored("motusapp-me") || "null"); } catch (e) {}
  try { sources = (JSON.parse(stored("motusapp-data-v1") || "{}") || {}).sources || {}; } catch (e) {}
  return { me, photo: stored("motusapp-photo"), workouts: ["hevy_live", "hevy", "strong"].some(k => sources[k]) };
}
const PERSON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="4"/><path d="M4 21c.8-4.3 4-6.5 8-6.5s7.2 2.2 8 6.5"/></svg>';
function face({ me, photo }) {
  const name = me && ((me.profile && me.profile.name) || me.email) || "";
  return photo && /^data:image\//.test(photo) ? `<img src="${esc(photo)}" alt="">`
    : me ? `<span>${esc(name.trim().charAt(0).toUpperCase() || "M")}</span>` : PERSON;
}

// After signing in or out, a new photo or name, or a workout tracker connected: the navbar catches up.
export function refreshNav() {
  const s = navState(), el = document.querySelector("nav .me"), w = document.querySelector('nav a[href="workouts.html"]');
  if (el) { el.innerHTML = face(s); el.setAttribute("aria-label", s.me ? "Your profile" : "Sign in"); }
  if (w && !w.classList.contains("on")) w.hidden = !s.workouts;
}

// ---- navbar + Standards panel. onChange runs whenever a goal or setting changes. ----
export function initNav(active, onChange) {
  const link = (href, key, text) => `<a href="${href}" class="${active === key ? "on" : ""}"${active === key ? ' aria-current="page"' : ""}>${text}</a>`;
  const s = navState();
  document.body.insertAdjacentHTML("afterbegin", `
<nav>
  <div class="bar">
    <a href="./" class="brand"><b>Motus</b></a>
    <a href="profile.html" class="me${active === "profile" ? " on" : ""}" aria-label="${s.me ? "Your profile" : "Sign in"}"${active === "profile" ? ' aria-current="page"' : ""}>${face(s)}</a>
    <span class="links">
      ${link("./", "home", "Home")}
      ${link("workouts.html", "workouts", "Workouts").replace("<a ", s.workouts || active === "workouts" ? "<a " : "<a hidden ")}
      ${link("weeks.html", "weeks", "Weeks")}
      ${link("connect.html", "connect", "Connect")}
      <button id="toggle" aria-expanded="false" aria-controls="standards">Standards</button>
    </span>
  </div>
  <div id="standards">
    <label>Steps per day <input id="s-steps" type="number" inputmode="numeric" min="0" step="500"></label>
    <label>Sleep hours per night <input id="s-sleep" type="number" inputmode="decimal" min="0" max="24" step="0.5"></label>
    <label>Calories per day, less than <input id="s-calories" type="number" inputmode="numeric" min="0" step="50"></label>
    <label><span>Weight loss <span id="s-wunit"></span> per week</span> <input id="s-weight" type="number" inputmode="decimal" min="0" step="0.1"></label>
    <label>Workouts per week <input id="s-workouts" type="number" inputmode="numeric" min="1" max="14" step="1"></label>
    <div class="label2">Training days</div>
    <div class="chips" id="s-days"></div>
    <div class="label2">Units</div>
    <div class="seg" id="s-units"><button type="button" data-v="kg">kg</button><button type="button" data-v="lb">lb</button></div>
    <div class="label2">Week starts on</div>
    <div class="seg" id="s-first"><button type="button" data-v="0">Sunday</button><button type="button" data-v="1">Monday</button></div>
    <div class="row2"><small>Green when you reach it. Saved on this device.</small><button id="reset">Reset</button></div>
  </div>
</nav>`);
  const wInput = document.getElementById("s-weight");
  const inputs = { steps: "s-steps", sleep: "s-sleep", calories: "s-calories", workouts: "s-workouts" };
  const fill = () => {
    for (const [key, id] of Object.entries(inputs)) document.getElementById(id).value = prefs[key];
    wInput.value = +toDisp(prefs.weight).toFixed(2);
    document.getElementById("s-wunit").textContent = unit();
    document.querySelectorAll("#s-units button").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === prefs.units));
    document.querySelectorAll("#s-first button").forEach(b => b.setAttribute("aria-pressed", +b.dataset.v === prefs.weekStart));
    drawChips();
  };
  for (const [key, id] of Object.entries(inputs)) {
    const el = document.getElementById(id);
    el.addEventListener("input", () => {
      const v = parseFloat(el.value);
      prefs[key] = Number.isFinite(v) && v >= 0 ? v : DEFAULTS[key];
      savePrefs(); onChange();
    });
  }
  wInput.addEventListener("input", () => {
    const v = parseFloat(wInput.value);
    prefs.weight = Number.isFinite(v) && v >= 0 ? fromDisp(v) : DEFAULTS.weight;
    savePrefs(); onChange();
  });
  const chips = document.getElementById("s-days");
  function drawChips() {
    const order = Array.from({ length: 7 }, (_, i) => (i + prefs.weekStart) % 7);
    chips.innerHTML = order.map(d =>
      `<button type="button" data-d="${d}" aria-pressed="${prefs.days.includes(d)}" aria-label="${DAY_SHORT[d]}">${DAY_LETTERS[d]}</button>`).join("");
  }
  chips.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    const d = +b.dataset.d;
    prefs.days = prefs.days.includes(d) ? prefs.days.filter(x => x !== d) : [...prefs.days, d].sort();
    savePrefs(); drawChips(); onChange();
  });
  document.getElementById("s-units").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    prefs.units = b.dataset.v; savePrefs(); fill(); onChange();
  });
  document.getElementById("s-first").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    prefs.weekStart = +b.dataset.v; savePrefs(); fill(); onChange();
  });
  document.getElementById("reset").addEventListener("click", () => {
    Object.assign(prefs, { ...DEFAULTS, days: [...DEFAULTS.days] });
    savePrefs(); fill(); onChange();
  });
  const toggle = document.getElementById("toggle"), panel = document.getElementById("standards");
  toggle.addEventListener("click", () => toggle.setAttribute("aria-expanded", panel.classList.toggle("open")));
  fill();
}
