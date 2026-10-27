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
  let t = digits(s).trim().replace(/[^\d.,\-]/g, "");
  if (!t) return null;
  if (t.includes(",") && t.includes(".")) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if (t.includes(",")) t = /,\d{3}$/.test(t) && !/^-?0,/.test(t) ? t.replace(/,/g, "") : t.replace(",", ".");
  const v = parseFloat(t);
  return Number.isFinite(v) ? v : null;
}

// "2026-10-27", "2026-10-27 07:12", "2026-10-27T07:12:30" -> { date, mins } (mins on a naive clock, for durations)
function when(s) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(digits(s).trim());
  if (!m) return null;
  const ms = Date.UTC(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  if (isNaN(ms) || new Date(ms).getUTCDate() !== +m[3]) return null;
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
  for (const [field, key] of [["steps", "steps"], ["calories", "calories"], ["active", "active_kcal"]]) {
    for (const [d, v] of lines(p[field])) { const w = when(d), n = num(v); if (w && n != null) put(w.date, key, Math.round(n)); }
  }
  const weights = {};
  for (const [t, v, unit] of lines(p.weight)) {
    const w = when(t), n = num(v);
    if (w && n != null && (!weights[w.date] || w.mins >= weights[w.date][0])) weights[w.date] = [w.mins, toKg(n, unit)];
  }
  for (const [d, [, kg]] of Object.entries(weights)) put(d, "weight_kg", Math.round(kg * 10) / 10);
  const sleep = {};                                   // day -> source -> minutes; the busiest source wins (iPhone + Watch)
  for (const [s, e, value, source] of lines(p.sleep)) {
    const a = when(s), b = when(e);
    if (!a || !b || NOT_ASLEEP.test(value || "")) continue;
    const mins = b.mins - a.mins;
    if (mins <= 0 || mins >= 24 * 60) continue;
    const day = sleep[sleepDay(b)] || (sleep[sleepDay(b)] = {});
    day[source || "?"] = (day[source || "?"] || 0) + mins;
  }
  for (const [d, bySrc] of Object.entries(sleep)) put(d, "sleep_hours", Math.round(Math.max(...Object.values(bySrc)) / 60 * 100) / 100);
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
