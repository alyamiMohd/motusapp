// MyFitnessPal (Premium data export). It arrives as a zip of CSV files; we read two of them:
//   Nutrition Summary   - one row per meal: Date, Meal, Calories, ...   -> calories per day (meals added up)
//   Measurement Summary - Date, Weight                                   -> weight (MyFitnessPal doesn't say the unit)
// Anything else in the zip (exercise, notes) is ignored. Free accounts: sync MyFitnessPal to Apple Health instead.
import { parseCSV, columns, num, parseDateTime, LB } from "./csv.js";
import { isZip, listEntries, entryText } from "./zip.js";

export function fromMfpCSV(text, unit = "kg") {
  const [header, ...rows] = parseCSV(text);
  if (!header) return { days: {}, kind: null };
  const c = columns(header, { date: ["date"], meal: ["meal"], cal: ["calories", "energy"], weight: ["weight"] });
  if (c.date < 0) return { days: {}, kind: null };
  const days = {};
  if (c.meal >= 0 && c.cal >= 0) {
    for (const r of rows) {
      const d = parseDateTime(r[c.date]), v = num(r[c.cal]);
      if (d && v) days[d.date] = { calories: (days[d.date]?.calories || 0) + v };
    }
    for (const d of Object.values(days)) d.calories = Math.round(d.calories);
    return { days, kind: "nutrition" };
  }
  if (c.weight >= 0) {
    for (const r of rows) {
      const d = parseDateTime(r[c.date]), v = num(r[c.weight]);
      if (d && v) days[d.date] = { weight_kg: Math.round((unit === "lb" ? v * LB : v) * 10) / 10 };
    }
    return { days, kind: "weight" };
  }
  return { days: {}, kind: null };
}

// One or more files: the zip itself, or the CSVs taken out of it.
export async function importMfp(files, unit = "kg") {
  const texts = [];
  for (const f of files) {
    if (await isZip(f)) {
      for (const e of await listEntries(f)) if (/\.csv$/i.test(e.name) && !/(^|\/)__MACOSX\//.test(e.name)) texts.push(await entryText(f, e));
    } else texts.push(await f.text());
  }
  const days = {}, kinds = new Set();
  for (const t of texts) {
    const r = fromMfpCSV(t, unit);
    if (!r.kind) continue;
    kinds.add(r.kind);
    for (const [d, v] of Object.entries(r.days)) Object.assign(days[d] || (days[d] = {}), v);
  }
  if (!kinds.size) throw new Error("Found no Nutrition Summary or Measurement Summary in this file.");
  return { days, kinds: [...kinds], replace: false };
}
