// What an iPhone sends to Motus, read into days: { "2026-10-27": { steps, sleep_hours, calories, active_kcal, weight_kg } }.
// Used by the Motus server (worker/) for uploads, and by the Apple Health file import (Health Exporter JSON).
// Self-contained on purpose: no browser-only code, so the server can bundle it.
//
// Accepted shapes:
// 1. The Motus Shortcut, made only of built-in Shortcuts actions: { v: 1, steps, calories, active, weight, sleep },
//    each a text with one Health sample per line, fields separated by "|":
//      steps, calories, active:  "2026-10-27|8123"                                   (Find Health Samples, grouped by day)
//      weight:                   "2026-10-27 07:12|80.4|kg"                          (time|value|unit)
//      sleep:                    "2026-10-26 23:40|2026-10-27 06:55|Core|Apple Watch" (start|end|value|source)
//    The phone's language can turn digits into Arabic ones (٠١٢) and decimals into commas; both are read.
// 2. The Health Exporter app's JSON (stepCount, sleepTime in minutes, dietaryEnergy, activeCalories, weight),
//    as JSON, as text, or as Base64 text under "health_b64".
// 3. Plain daily numbers: { days: { "2026-10-27": { steps, sleep_hours, calories, weight_kg, active_kcal } } }.
import { clean, BODY } from "./merge.js";

const LB = 0.45359237;

// Arabic-Indic and Persian digits, Arabic decimal and thousands separators -> ASCII
export const digits = s => String(s ?? "").replace(/[٠-٩]/g, c => c.charCodeAt(0) - 0x660)
  .replace(/[۰-۹]/g, c => c.charCodeAt(0) - 0x6F0).replace(/٫/g, ".").replace(/[٬  ]/g, "");

export function num(s) {
  if (typeof s === "string" && /^\d+(\.\d+)?$/.test(s)) return +s;      // the usual case, without the clean-up below
  let t = digits(s).trim().replace(/[^\d.,\-]/g, "");
  if (!t) return null;
  if (t.includes(",") && t.includes(".")) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if (t.includes(",")) t = /,\d{3}$/.test(t) && !/^-?0,/.test(t) ? t.replace(/,/g, "") : t.replace(",", ".");
  const v = parseFloat(t);
  return Number.isFinite(v) ? v : null;
}

// A phone set to another calendar writes its dates in it. iPhones in Saudi Arabia are often on Hijri (Umm al-Qura):
// "1448-05-17" is 28 Oct 2026. Thai Buddhist years are 543 ahead ("2569-10-28"). Both are turned into Gregorian.
const DAY = 864e5;
const UMM_AL_QURA = (() => {
  try {
    const f = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { year: "numeric", month: "numeric", day: "numeric", timeZone: "UTC" });
    return f.resolvedOptions().calendar === "islamic-umalqura" ? f : null;
  } catch (e) { return null; }
})();
export const HIJRI_EXACT = !!UMM_AL_QURA;
const HIJRI_DAYS = new Map();
function fromHijri(y, m, d) {
  if (UMM_AL_QURA) {                                  // a first guess from the mean month, then the exact day nearby
    const guess = Date.UTC(622, 6, 19) + Math.round((y - 1) * 354.36667 + (m - 1) * 29.53059 + (d - 1)) * DAY;
    for (let off = 0; off <= 12; off++) for (const t of [guess + off * DAY, guess - off * DAY]) {
      const p = {};
      for (const x of UMM_AL_QURA.formatToParts(new Date(t))) p[x.type] = x.value;
      if (+p.year === y && +p.month === m && +p.day === d) return new Date(t);
    }
  }
  // tabular (civil) Hijri, for runtimes without that calendar: up to two days off Umm al-Qura
  const jd = d + Math.ceil(29.5 * (m - 1)) + (y - 1) * 354 + Math.floor((3 + 11 * y) / 30) + 1948439.5 - 1;
  return new Date(Math.round((jd - 2440587.5) * DAY));
}

// "2026-10-27", "2026-10-27 07:12", "2026-10-27T07:12:30" -> { date, mins } (mins on a naive clock, for durations)
function when(s) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(digits(s).trim());
  if (!m) return null;
  let y = +m[1], mo = +m[2], d = +m[3];
  if (y < 1700 && mo >= 1 && mo <= 12 && d >= 1 && d <= 30) {
    const k = y * 10000 + mo * 100 + d;                 // thousands of samples share a few dozen days: convert each once
    const g = HIJRI_DAYS.get(k) || HIJRI_DAYS.set(k, fromHijri(y, mo, d)).get(k);
    y = g.getUTCFullYear(); mo = g.getUTCMonth() + 1; d = g.getUTCDate();
  } else if (y > 2400) y -= 543;
  const ms = Date.UTC(y, mo - 1, d, +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  if (isNaN(ms) || new Date(ms).getUTCDate() !== d) return null;
  return { date: new Date(ms).toISOString().slice(0, 10), mins: ms / 60000 };
}
const lines = t => String(t || "").split(/\r?\n/).map(l => l.split("|").map(f => f.trim())).filter(f => f[0]);

// A night belongs to the day you wake up: sleep ending after 18:00 counts towards the next day.
const sleepDay = end => new Date((end.mins + 6 * 60) * 60000).toISOString().slice(0, 10);
const NOT_ASLEEP = /in ?bed|awake|في السرير|مستيقظ|استيقاظ/i;
const UNIT = [[/^(kg|kgs|kilo|kilogram|kilograms|كغ|كجم|كيلو|كيلوغرام|كيلوجرام)$/i, 1], [/^(lb|lbs|pound|pounds|رطل|باوند)$/i, LB],
              [/^(g|gram|grams|غ|جم|غرام|جرام)$/i, 0.001], [/^(st|stone|stones)$/i, 6.35029318]];
const toKg = (v, unit) => { const u = UNIT.find(([re]) => re.test(String(unit || "").trim().replace(/\.$/, ""))); return u ? v * u[1] : v > 180 ? v * LB : v; };

function fromShortcut(p) {
  const days = {}, put = (d, k, v) => { (days[d] || (days[d] = {}))[k] = v; };
  const v2 = +p.v >= 2;
  const kcal = (n, u) => (/^(kj|كج)/i.test(u || "") ? n / 4.184 : n);
  if (v2) {
    // v2 sends Steps and Active Calories sample by sample with their source ("time|value|source", active also
    // "|unit" before the source), v3 a day total per source ("day|value|n"): per day the busiest source wins, so an
    // iPhone and a Watch counting the same walk aren't added together (Shortcuts' own "group by day" adds them up).
    const dayOf = new Map();          // only the day matters here, and thousands of samples share a few dozen days
    const dateOf = t => { const k = t.slice(0, 10); let v = dayOf.get(k); if (v === undefined) { const w = when(k); dayOf.set(k, v = w ? w.date : null); } return v; };
    for (const [field, key, hasUnit] of [["steps", "steps", false], ["active", "active_kcal", true]]) {
      const bySrc = {}, text = String(p[field] || "");
      // walked by hand rather than split into arrays: a first run can send thousands of lines
      for (let i = 0; i < text.length;) {
        let j = text.indexOf("\n", i);
        if (j < 0) j = text.length;
        const line = text.charCodeAt(j - 1) === 13 ? text.slice(i, j - 1) : text.slice(i, j);
        i = j + 1;
        const a = line.indexOf("|"), b = a < 0 ? -1 : line.indexOf("|", a + 1);
        if (a < 0) continue;
        const v = line.slice(a + 1, b < 0 ? undefined : b);
        let n = +v;
        if (!v.length || n !== n) n = num(v);           // plain numbers parse directly; "1,234", Arabic digits etc. take the slow road
        const date = dateOf(line.slice(0, a).trim());
        if (!date || n == null) continue;
        let unit = "", src = b < 0 ? "" : line.slice(b + 1);
        if (hasUnit) { const c = src.indexOf("|"); unit = c < 0 ? src : src.slice(0, c); src = c < 0 ? "" : src.slice(c + 1); }
        src = src.trim() || "?";
        const day = bySrc[date] || (bySrc[date] = {});
        day[src] = (day[src] || 0) + kcal(n, unit.trim());
      }
      // a day every source filled in as 0 had nothing recorded: leave it empty
      for (const [d, s] of Object.entries(bySrc)) { const n = Math.round(Math.max(...Object.values(s))); if (n > 0) put(d, key, n); }
    }
  }
  for (const [field, key] of (v2 ? [["calories", "calories"]] : [["steps", "steps"], ["calories", "calories"], ["active", "active_kcal"]])) {
    // an optional third field is the unit: phones set to kilojoules send kJ
    for (const [d, v, u] of lines(p[field])) { const w = when(d), n = num(v); if (w && n != null) put(w.date, key, Math.round(/^(kj|كج)/i.test(u || "") ? n / 4.184 : n)); }
  }
  const weights = {};
  for (const [t, v, unit] of lines(p.weight)) {
    const w = when(t), n = num(v);
    if (w && n != null && (!weights[w.date] || w.mins >= weights[w.date][0])) weights[w.date] = [w.mins, toKg(n, unit)];
  }
  for (const [d, [, kg]] of Object.entries(weights)) put(d, "weight_kg", Math.round(kg * 10) / 10);
  // day -> source -> asleep intervals; the busiest source wins (iPhone + Watch). Within a source, overlapping time
  // counts once: Shortcuts gives no source for sleep on the owner's iPhone, so a Watch and a ring recording the same
  // night arrive as one source, and adding them up made 11-hour nights.
  const sleep = {};
  for (const [s, e, value, source] of lines(p.sleep)) {
    const a = when(s), b = when(e);
    if (!a || !b || NOT_ASLEEP.test(value || "")) continue;
    if (b.mins - a.mins <= 0 || b.mins - a.mins >= 24 * 60) continue;
    const day = sleep[sleepDay(b)] || (sleep[sleepDay(b)] = {});
    (day[source || "?"] || (day[source || "?"] = [])).push([a.mins, b.mins]);
  }
  const covered = spans => {
    let total = 0, end = -Infinity;
    for (const [a, b] of spans.sort((x, y) => x[0] - y[0])) { if (b > end) { total += b - Math.max(a, end); end = b; } }
    return total;
  };
  for (const [d, bySrc] of Object.entries(sleep))
    put(d, "sleep_hours", Math.round(Math.max(...Object.values(bySrc).map(covered)) / 60 * 100) / 100);
  return days;
}

// Health Exporter app JSON: { stepCount: [{date, value}], sleepTime: [{date, value (minutes)}], dietaryEnergy, weight, activeCalories }
const energy = (v, u) => (u === "kJ" ? v / 4.184 : v);
export function fromHealthExporterJSON(obj) {
  if (!obj || typeof obj !== "object" || !["stepCount", "sleepTime", "dietaryEnergy", "weight"].some(k => Array.isArray(obj[k])))
    throw new Error("This JSON file isn't a Health Exporter export.");
  const days = {};
  const put = (key, k, fn) => { for (const it of obj[key] || []) { const v = fn(+it.value, it.unit); if (it.date && v) (days[it.date] || (days[it.date] = {}))[k] = v; } };
  put("stepCount", "steps", v => Math.round(v));
  put("sleepTime", "sleep_hours", v => Math.round(v / 60 * 100) / 100);
  put("dietaryEnergy", "calories", (v, u) => Math.round(energy(v, u)));
  put("activeCalories", "active_kcal", (v, u) => Math.round(energy(v, u)));
  put("weight", "weight_kg", (v, u) => Math.round(toKg(v, u || "kg") * 10) / 10);
  return { days };
}

const fromB64 = t => new TextDecoder().decode(Uint8Array.from(atob(String(t).replace(/\s+/g, "")), c => c.charCodeAt(0)));

// Any accepted upload -> cleaned days (only valid dates and plausible values). Throws on anything else.
export function readHealthUpload(p) {
  if (typeof p === "string") p = JSON.parse(p);
  if (!p || typeof p !== "object") throw new Error("Expected a JSON object.");
  let days;
  if (typeof p.health_b64 === "string") days = fromHealthExporterJSON(JSON.parse(fromB64(p.health_b64))).days;
  else if (p.health) days = fromHealthExporterJSON(typeof p.health === "string" ? JSON.parse(p.health) : p.health).days;
  else if (p.days && typeof p.days === "object") days = p.days;
  else if (["steps", "calories", "active", "weight", "sleep"].some(k => typeof p[k] === "string")) days = fromShortcut(p);
  else if (["stepCount", "sleepTime", "dietaryEnergy", "weight"].some(k => Array.isArray(p[k]))) days = fromHealthExporterJSON(p).days;
  else throw new Error("Nothing Motus can read in this upload.");
  const out = {};
  for (const [d, r] of Object.entries(days || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !r || typeof r !== "object") continue;
    for (const k of BODY) { const v = clean(k, r[k]); if (v != null) (out[d] || (out[d] = {}))[k] = v; }
  }
  return out;
}
