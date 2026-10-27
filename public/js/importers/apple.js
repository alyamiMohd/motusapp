// Apple Health. Two kinds of file:
// 1. The Health app's own export: Health -> profile picture -> Export All Health Data. That gives export.zip with
//    apple_health_export/export.xml inside (often hundreds of MB). It is streamed and scanned, never loaded whole.
// 2. JSON from the "Health Exporter" app (daily totals: stepCount, sleepTime in minutes, dietaryEnergy, weight).
//
// The raw export lists every sample from every device, so an iPhone and an Apple Watch both counting the same
// walk appear twice. The Health app de-duplicates those; we approximate it by taking, per day, the single source
// with the highest total (for steps, sleep, food energy and active energy). Weight is the last reading of the day.
import { isZip, listEntries, entryStream } from "./zip.js";
import { LB } from "./csv.js";
import { fromHealthExporterJSON } from "../health.js";

const TYPES = {
  HKQuantityTypeIdentifierStepCount: "steps",
  HKQuantityTypeIdentifierDietaryEnergyConsumed: "calories",
  HKQuantityTypeIdentifierActiveEnergyBurned: "active_kcal",
  HKQuantityTypeIdentifierBodyMass: "weight_kg",
  HKCategoryTypeIdentifierSleepAnalysis: "sleep_hours",
};
const ASLEEP = new Set(["HKCategoryValueSleepAnalysisAsleep", "HKCategoryValueSleepAnalysisAsleepUnspecified",
  "HKCategoryValueSleepAnalysisAsleepCore", "HKCategoryValueSleepAnalysisAsleepDeep", "HKCategoryValueSleepAnalysisAsleepREM"]);

const attr = (tag, name) => { const i = tag.indexOf(" " + name + '="'); if (i < 0) return null; const s = i + name.length + 3; return tag.slice(s, tag.indexOf('"', s)); };
// "2026-10-20 23:41:07 +0300" -> ms since epoch
const when = s => { const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d) ([+-])(\d\d)(\d\d)$/.exec(s || ""); if (!m) return NaN;
  return Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - (m[7] === "-" ? -1 : 1) * (m[8] * 60 + +m[9]) * 60000; };
// A night belongs to the day you wake up: a stretch of sleep that ends after 18:00 local time counts towards the
// next day, so the part of a night before midnight isn't split off onto the previous date.
const sleepDay = end => new Date(Date.UTC(+end.slice(0, 4), end.slice(5, 7) - 1, +end.slice(8, 10), +end.slice(11, 13) + 6)).toISOString().slice(0, 10);
const energy = (v, u) => (u === "kJ" ? v / 4.184 : u === "Cal" || u === "kcal" ? v : null);
const mass = (v, u) => (u === "kg" ? v : u === "lb" ? v * LB : u === "g" ? v / 1000 : u === "st" ? v * 6.35029318 : null);

// Feeds export.xml text in chunks; call done() for the per-day result.
export function healthXmlScanner() {
  const sums = { steps: {}, calories: {}, active_kcal: {}, sleep_hours: {} };      // metric -> date -> source -> total
  const weights = {};                                                              // date -> [time, kg]
  let carry = "", records = 0;
  const addTo = (metric, date, src, v) => { const d = sums[metric][date] || (sums[metric][date] = {}); d[src] = (d[src] || 0) + v; };
  function handle(type, tag) {
    const metric = TYPES[type], src = attr(tag, "sourceName") || "?";
    const start = attr(tag, "startDate") || "", date = start.slice(0, 10);
    if (metric === "sleep_hours") {
      if (!ASLEEP.has(attr(tag, "value"))) return;
      const end = attr(tag, "endDate") || "", mins = (when(end) - when(start)) / 60000;
      if (mins > 0 && mins < 24 * 60) { addTo(metric, sleepDay(end), src, mins); records++; }
      return;
    }
    const raw = parseFloat(attr(tag, "value")), u = attr(tag, "unit");
    if (!Number.isFinite(raw) || !/^\d{4}-\d\d-\d\d$/.test(date)) return;
    if (metric === "steps") addTo(metric, date, src, raw);
    else if (metric === "weight_kg") { const kg = mass(raw, u), t = when(start); if (kg && (!weights[date] || t >= weights[date][0])) weights[date] = [t, kg]; }
    else { const kcal = energy(raw, u); if (kcal != null) addTo(metric, date, src, kcal); }
    records++;
  }
  return {
    push(text) {
      const buf = carry + text;
      let i = 0, keep = -1;
      for (;;) {
        const at = buf.indexOf('<Record type="', i);
        if (at < 0) break;
        const tEnd = buf.indexOf('"', at + 14), close = tEnd < 0 ? -1 : buf.indexOf(">", tEnd);
        if (close < 0) { keep = at; break; }
        const type = buf.slice(at + 14, tEnd);
        if (TYPES[type]) handle(type, buf.slice(tEnd, close));
        i = close + 1;
      }
      carry = keep >= 0 ? buf.slice(keep) : buf.slice(Math.max(i, buf.length - 16));   // enough for a split "<Record type=""
    },
    done() {
      const days = {};
      const put = (d, k, v) => { (days[d] || (days[d] = {}))[k] = v; };
      for (const [metric, byDate] of Object.entries(sums)) {
        for (const [d, bySrc] of Object.entries(byDate)) {
          const best = Math.max(...Object.values(bySrc));
          put(d, metric, metric === "sleep_hours" ? Math.round(best / 60 * 100) / 100 : Math.round(best));
        }
      }
      for (const [d, [, kg]] of Object.entries(weights)) put(d, "weight_kg", Math.round(kg * 10) / 10);
      return { days, records };
    },
  };
}

// Health Exporter app JSON (shared with the server's upload reader)
export { fromHealthExporterJSON };

// Any of: export.zip, export.xml, Health Exporter .json. onProgress(fraction 0..1).
export async function importAppleHealth(file, onProgress = () => {}) {
  const name = (file.name || "").toLowerCase();
  if (name.endsWith(".json")) return { ...fromHealthExporterJSON(JSON.parse(await file.text())), replace: false };
  let stream, total, read = 0;
  const tick = n => { read += n; onProgress(Math.min(1, read / total)); };
  if (await isZip(file)) {
    const entry = (await listEntries(file)).find(e => /(^|\/)export\.xml$/i.test(e.name));
    if (!entry) throw new Error("No export.xml inside this zip. Choose the export.zip the Health app made.");
    total = entry.compSize || 1;
    stream = await entryStream(file, entry, tick);
  } else {
    total = file.size || 1;
    stream = file.stream().pipeThrough(new TransformStream({ transform(c, ctl) { tick(c.byteLength); ctl.enqueue(c); } }));
  }
  const scan = healthXmlScanner(), reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) { const { value, done } = await reader.read(); if (done) break; scan.push(value); }
  const { days, records } = scan.done();
  if (!records && !Object.keys(days).length) throw new Error("Found no steps, sleep, food energy or weight in this export.");
  return { days, replace: false };
}
