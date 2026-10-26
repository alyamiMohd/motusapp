// CSV and date helpers shared by the importers. Exports from different apps disagree on delimiters, quoting,
// header names and date formats, so everything here is deliberately forgiving.
import { localISO } from "../core.js";

// Rows as arrays of strings. Handles quotes, escaped quotes, CRLF, a BOM, and , ; or tab as the delimiter.
export function parseCSV(text) {
  text = String(text).replace(/^﻿/, "");
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const delim = [",", ";", "\t"].map(d => [d, countOutsideQuotes(firstLine, d)]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(f => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(f => f.trim() !== "")) rows.push(row);
  return rows;
}
function countOutsideQuotes(line, d) {
  let n = 0, q = false;
  for (const c of line) { if (c === '"') q = !q; else if (c === d && !q) n++; }
  return n;
}

// Column lookup by loose name: "Weight (kg)", "weight_kg" and "WeightKg" all match "weight kg".
export const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
export function columns(header, spec) {
  const h = header.map(norm), out = {};
  for (const [key, names] of Object.entries(spec)) {
    const ns = names.map(norm);
    let i = h.findIndex(x => ns.includes(x));
    if (i < 0) i = h.findIndex(x => ns.some(n => x.startsWith(n)));
    out[key] = i;
  }
  return out;
}

// Numbers like "1,234", "1.234,5" (European) or "80.5 kg".
export function num(s) {
  if (s == null) return null;
  let t = String(s).trim().replace(/[^\d.,\-]/g, "");
  if (!t) return null;
  if (t.includes(",") && t.includes(".")) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if (t.includes(",")) t = /,\d{3}$/.test(t) && !/^-?0,/.test(t) ? t.replace(/,/g, "") : t.replace(",", ".");
  const v = parseFloat(t);
  return Number.isFinite(v) ? v : null;
}

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const monthOf = s => MON[s.toLowerCase().slice(0, 3)];

// "2026-10-20", "2026-10-20 18:30:00", "2026-10-20T15:30:00Z", "20 Oct 2026, 18:30", "Oct 20, 2026 6:30 PM", "10/20/2026".
// Returns { date: "YYYY-MM-DD" (local), t: minutes on a naive clock for durations } or null.
// A time with a zone (Z or +03:00) is converted to the visitor's local date; one without is taken as written.
// Slash dates are month first unless the first number can only be a day (13 or more).
export function parseDateTime(s) {
  s = String(s || "").trim();
  if (!s) return null;
  let m, y, mo, d, h = 0, mi = 0, sec = 0, ap = "";
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?)?/))) {
    if (m[7]) {
      const z = m[7] === "Z" ? "Z" : m[7].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
      const at = new Date(`${m[1]}-${pad(m[2])}-${pad(m[3])}T${pad(m[4])}:${m[5]}:${m[6] || "00"}${z}`);
      if (isNaN(at)) return null;
      return { date: localISO(at), t: at.getTime() / 60000 };
    }
    [y, mo, d, h, mi, sec] = [m[1], m[2], m[3], m[4] || 0, m[5] || 0, m[6] || 0];
  } else if ((m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3,9})\.?[\s,-]+(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?/))) {
    [d, mo, y, h, mi, sec, ap] = [m[1], monthOf(m[2]), m[3], m[4] || 0, m[5] || 0, m[6] || 0, m[7] || ""];
  } else if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?:,?\s+(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?/))) {
    [mo, d, y, h, mi, sec, ap] = [monthOf(m[1]), m[2], m[3], m[4] || 0, m[5] || 0, m[6] || 0, m[7] || ""];
  } else if ((m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?/))) {
    const dayFirst = +m[1] > 12;
    [mo, d] = dayFirst ? [m[2], m[1]] : [m[1], m[2]];
    [y, h, mi, sec, ap] = [m[3], m[4] || 0, m[5] || 0, m[6] || 0, m[7] || ""];
  } else return null;
  y = +y; mo = +mo; d = +d; h = +h; mi = +mi; sec = +sec;
  if (ap) { ap = ap.toLowerCase(); if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0; }
  if (!mo || mo > 12 || d < 1 || d > 31 || y < 1970 || y > 2100) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi, sec);
  if (new Date(ms).getUTCDate() !== d) return null;          // 31 Feb and friends
  return { date: `${y}-${pad(mo)}-${pad(d)}`, t: ms / 60000 };
}
const pad = n => String(n).padStart(2, "0");

export const LB = 0.45359237;

// Summary line for an import: "412 days, 2 Mar 2025 to 25 Oct 2026".
export function describe(days) {
  const ds = Object.keys(days).sort();
  if (!ds.length) return "nothing";
  const f = iso => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${ds.length} day${ds.length === 1 ? "" : "s"}, ${f(ds[0])} to ${f(ds[ds.length - 1])}`;
}
