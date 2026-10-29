// Builds the Motus Shortcut (Apple's own actions only) as an unsigned XML plist: `node tools/shortcut/build.mjs`.
// Sign it on a Mac signed in to iCloud: `shortcuts sign --mode anyone -i <plist> -o Motus.shortcut` (GitHub's Macs
// are not signed in to iCloud, so CI cannot; tools/shortcut/sign.mjs tries RoutineHub's HubSign, behind a bot check now).
//
// What it does, matching public/shortcut.html and readHealthUpload in public/js/health.js:
//   Finish in Motus runs it with "<upload url>|<token>" as input; it keeps that in motus.txt (Shortcuts folder).
//   Every run reads Steps and Active Calories (a day total per source), Dietary Calories (day totals), Weight and
//   Sleep (raw samples), and POSTs them as text lines to the upload URL in three parts. Signed by
//   .github/workflows/sign-shortcut.yml.
//
// The plist format is not documented by Apple. Every action shape here was copied from real iOS exports:
// viticci/shortcuts-playground-plugin (HEALTHKIT.md, golden-shortcuts) and danielhopkins/apple-tools
// (plugins/health/build-shortcut.py), which also confirm the picker labels Steps, Active Calories, Weight, Sleep,
// the "is in the last N days" operator (1001, unit 16 = days) and WFHKSampleFilteringGroupBy = "Day".
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const NAME = "Motus";
const OBJ = "￼";                      // stands for one variable inside a text field
const uid = () => randomUUID().toUpperCase();

// ---- values ----
const out = (uuid, name, extra = {}) => ({ OutputUUID: uuid, OutputName: name, Type: "ActionOutput", ...extra });
const named = name => ({ Type: "Variable", VariableName: name });
const INPUT = { Type: "ExtensionInput" };                       // Shortcut Input
const attach = ref => ({ Value: ref, WFSerializationType: "WFTextTokenAttachment" });
// text("Bearer ", named("Token")) -> a text field mixing literal text and variables
function text(...parts) {
  let string = "";
  const attachmentsByRange = {};
  for (const p of parts) {
    if (typeof p === "string") { string += p; continue; }
    attachmentsByRange[`{${string.length}, 1}`] = p;
    string += OBJ;
  }
  return { Value: { attachmentsByRange, string }, WFSerializationType: "WFTextTokenString" };
}
const dictItems = items => ({ Value: { WFDictionaryFieldValueItems: items.map(([k, v]) =>
  ({ WFItemType: 0, WFKey: text(k), WFValue: v })) }, WFSerializationType: "WFDictionaryFieldValue" });

// ---- actions ----
const act = (id, params) => ({ WFWorkflowActionIdentifier: "is.workflow.actions." + id, WFWorkflowActionParameters: params });
const uuidOf = a => a.WFWorkflowActionParameters.UUID;
const setVar = (name, ref) => act("setvariable", { WFInput: attach(ref), WFVariableName: name });

function ifHasValue(ref, body, otherwise) {   // If <ref> has any value … [Otherwise …] End If
  const g = uid();
  return [
    act("conditional", { GroupingIdentifier: g, WFCondition: 100, WFControlFlowMode: 0,
      WFInput: { Type: "Variable", Variable: attach(ref) } }),
    ...body,
    ...(otherwise ? [act("conditional", { GroupingIdentifier: g, WFControlFlowMode: 1 }), ...otherwise] : []),
    act("conditional", { GroupingIdentifier: g, WFControlFlowMode: 2, UUID: uid() }),
  ];
}
const ifHasInput = (body, otherwise) => ifHasValue(INPUT, body, otherwise);

// rows: more filter rows after Type and Start Date (all must hold), such as a fixed "Source contains …"
function findSamples(label, days, groupByDay, fillMissing = false, rows = []) {
  const p = {
    UUID: uid(),
    WFContentItemFilter: {
      Value: {
        WFActionParameterFilterPrefix: 1,
        WFContentPredicateBoundedDate: false,
        WFActionParameterFilterTemplates: [
          { Bounded: true, Operator: 4, Property: "Type", Removable: false,
            Values: { Enumeration: { Value: label, WFSerializationType: "WFStringSubstitutableState" } } },
          { Bounded: true, Operator: 1001, Property: "Start Date", Removable: false,
            Values: { Number: String(days), Unit: 16 } },
          ...rows,
        ],
      },
      WFSerializationType: "WFContentPredicateTableTemplate",
    },
    WFContentItemSortProperty: "Start Date",
    WFContentItemSortOrder: "Oldest First",
    WFContentItemLimitEnabled: false,
    WFContentItemLimitNumber: 20,
    WFHKSampleFilteringFillMissing: fillMissing,
  };
  if (groupByDay) p.WFHKSampleFilteringGroupBy = "Day";
  return act("filter.health.quantity", p);
}

const DAY = "yyyy-MM-dd", STAMP = "yyyy-MM-dd HH:mm:ss";

// A Find Health Samples result as columns, one line per sample (or per day when grouped), with no loop over the
// samples: Get Details and Combine Text work on whole lists, in order. Dates go through Format Date given the list in a
// text field (of three ways tried on the owner's iPhone, 2026-10-29, the one that turns a list of dates into lines).
// Until v5.2 food, weight and sleep went through a Repeat per sample: 674 sleep samples for a 30-day run, over 5,000
// actions, about 2 minutes, and enough for the run to stop near its end.
// cols: [field, Health property, date pattern if a date]
function columns(find, cols) {
  const acts = [], fields = [];
  for (const [field, prop, pattern] of cols) {
    const details = act("properties.health.quantity", { UUID: uid(), CustomOutputName: prop, WFContentItemPropertyName: prop,
      WFInput: attach(out(uuidOf(find), "Health Samples")) });
    let list = out(uuidOf(details), prop);
    acts.push(details);
    if (pattern) {
      const fmt = act("format.date", { UUID: uid(), WFDate: text(list), WFDateFormatStyle: "Custom", WFDateFormat: pattern, WFTimeFormatStyle: "None" });
      acts.push(fmt);
      list = out(uuidOf(fmt), "Formatted Date");
    }
    const joined = act("text.combine", { UUID: uid(), WFTextSeparator: "New Lines", text: attach(list) });
    acts.push(joined);
    fields.push([field, text(out(uuidOf(joined), "Combined Text"))]);
  }
  return [acts, fields];
}

// v4: steps and active energy, one day at a time, as single samples with their device. Tried and failed on the
// owner's iPhone, 2026-10-29, and why each is out:
//   - Shortcuts' own day totals (Group By Day) add every device together (iPhone + Watch = the doubled steps), and
//     can't be split: a Source filter is applied after grouping, and grouping an earlier Find's list ignores the list.
//   - Source filters don't filter single samples either: "contains Watch" and "contains iPhone" both let all 176 of
//     a day's samples through, "Source is" with a variable fails, and a picked device can't be known for everyone.
//   - A month of single samples in one Find is too much for the phone.
//   - Of the date filters, "Start Date is after <variable>" let nothing through; "is between <variable> and
//     <variable>" works (24 of today's 176 by 11:36).
// So: for each day, Find that day's samples (is between the day's start and the next day's start), take their values
// and their sources as two lists (no loop over samples: Get Details and Combine Text work on whole lists, in order),
// and POST them. The server adds up each device and keeps the busiest one, as the Health app roughly does; it uses the
// device names only for that and doesn't store or log them.
const qty = (magnitude, unit) => ({ Value: { Magnitude: magnitude, Unit: unit }, WFSerializationType: "WFQuantityFieldValue" });
const adjust = (date, op, magnitude = "1", unit = "days") => act("adjustdate", { UUID: uid(), WFDate: text(date), WFAdjustOperation: op,
  WFDuration: qty(magnitude, unit) });
const between = (start, end) => ({ Bounded: true, Operator: 1003, Property: "Start Date", Removable: true,
  Values: { Date: attach(start), AnotherDate: attach(end) } });
// The last n days, today first, one upload per day: {v: 5, day, device, steps_values, steps_sources, steps_starts,
// active_values, active_sources, active_units, active_starts}, each a column with one line per sample.
// Each pass steps one day back from the variable Day End (tomorrow at first). "Subtract <Repeat Index> days" gave
// three empty days on the owner's iPhone (the variable amount seems not to count), so every step is a fixed 1 day.
function byDayBlock(n, post4) {
  const now = act("date", { UUID: uid(), WFDateActionMode: "Current Date" });
  const today = adjust(out(uuidOf(now), "Date"), "Get Start of Day");
  const tomorrow = adjust(out(uuidOf(today), "Adjusted Date"), "Add");
  const end = adjust(named("Day End"), "Get Start of Day");       // a fresh copy of Day End to filter with
  const start = adjust(out(uuidOf(end), "Adjusted Date"), "Subtract");
  // readings from 3 hours before the day too: one that starts before midnight and runs into the day counts there in
  // part, as in the Health app (the server keeps only the day's own quarter hours)
  const from = adjust(out(uuidOf(start), "Adjusted Date"), "Subtract", "3", "hr");
  const day = act("format.date", { UUID: uid(), WFDate: text(out(uuidOf(start), "Adjusted Date")),
    WFDateFormatStyle: "Custom", WFDateFormat: DAY, WFTimeFormatStyle: "None" });
  // this phone's own name: Health ranks phones above apps, and a phone called something like "iMone" doesn't say so
  const phone = act("getdevicedetails", { UUID: uid(), WFDeviceDetail: "Device Name" });
  const body = [end, start, from, day],
    fields = [["day", text(out(uuidOf(day), "Formatted Date"))], ["device", text(out(uuidOf(phone), "Device Details"))]];
  for (const [key, label] of [["steps", "Steps"], ["active", "Active Calories"]]) {
    // "in the last n+1 days" too: a plain bound Health can use before the day's own range
    const find = findSamples(label, n + 1, false, false, [between(out(uuidOf(from), "Adjusted Date"), out(uuidOf(end), "Adjusted Date"))]);
    // steps also send end times: Health spreads a sample over the quarter hours it spans (see mergeLikeHealth)
    const [acts, cols] = columns(find, [[key + "_values", "Value"], [key + "_sources", "Source"],
      ...(key === "active" ? [[key + "_units", "Unit"]] : []), [key + "_starts", "Start Date", STAMP],
      ...(key === "steps" ? [[key + "_ends", "End Date", STAMP]] : [])]);
    body.push(find, ...acts);
    fields.push(...cols);
  }
  body.push(post4(fields), setVar("Day End", out(uuidOf(start), "Adjusted Date")));
  const g = uid();
  return [now, today, tomorrow, phone, setVar("Day End", out(uuidOf(tomorrow), "Adjusted Date")),
    act("repeat.count", { GroupingIdentifier: g, WFControlFlowMode: 0, WFRepeatCount: n, UUID: uid() }),
    ...body,
    act("repeat.count", { GroupingIdentifier: g, WFControlFlowMode: 2, UUID: uid() })];
}

export function build() {
  // 1. Remember where to send (only when Motus → Finish passes "<url>|<token>")
  const save = act("documentpicker.save", { UUID: uid(), WFInput: attach(INPUT), WFAskWhereToSave: false,
    WFSaveFileOverwrite: true, WFFileDestinationPath: text("motus.txt") });
  const file = act("documentpicker.open", { UUID: uid(), WFGetFilePath: "motus.txt",
    WFFileErrorIfNotFound: true, WFShowFilePicker: false });
  const split = act("text.split", { UUID: uid(), WFTextSeparator: "Custom", WFTextCustomSeparator: "|",
    text: attach(out(uuidOf(file), "File")) });
  const first = act("getitemfromlist", { UUID: uid(), WFItemSpecifier: "First Item", WFInput: attach(out(uuidOf(split), "Split Text")) });
  const last = act("getitemfromlist", { UUID: uid(), WFItemSpecifier: "Last Item", WFInput: attach(out(uuidOf(split), "Split Text")) });

  // 2. Read Health and send it in parts: food, weight and sleep, then steps and active energy one day at a time. Smaller
  //    uploads, and if a run stops, the server has what came before and its log shows how far it got. The first run (from
  //    Finish, so with input) fills the last 30 days; every later run (the daily automation, or a tap) only the last 2,
  //    plus a week of food and weight to catch late entries.
  const send = (v, fields) => act("downloadurl", {
    UUID: uid(), Advanced: true, ShowHeaders: true, WFURL: text(named("Address")), WFHTTPMethod: "POST",
    WFHTTPHeaders: dictItems([["Authorization", text("Bearer ", named("Token"))]]),
    WFHTTPBodyType: "JSON",
    WFJSONValues: dictItems([["v", text(v)], ...fields]),
  });
  const read = w => {
    // the picker shows "Dietary Energy" but stores "Dietary Calories" (seen in the owner's re-shared Shortcut, 2026-10-28);
    // Fill Missing: days with nothing logged come back as 0 instead of a "No Samples Found" stop
    const food = findSamples("Dietary Calories", w.food, true, true), weight = findSamples("Weight", w.food, false);
    const sleep = findSamples("Sleep", w.move, false);
    const [fa, ff] = columns(food, [["calories_days", "Start Date", DAY], ["calories_values", "Value"], ["calories_units", "Unit"]]);
    const [wa, wf] = columns(weight, [["weight_starts", "Start Date", STAMP], ["weight_values", "Value"], ["weight_units", "Unit"]]);
    const [sa, sf] = columns(sleep, [["sleep_starts", "Start Date", STAMP], ["sleep_ends", "End Date", STAMP],
      ["sleep_values", "Value"], ["sleep_sources", "Source"]]);
    return [food, ...fa, weight, ...wa, sleep, ...sa, send("5", [...ff, ...wf, ...sf]),
      // Steps and Active Calories: one upload per day, single samples with their devices (byDayBlock)
      ...byDayBlock(w.days, fields => send("5", fields))];
  };
  const FIRST = { move: 30, food: 30, days: 30 }, DAILY = { move: 2, food: 7, days: 3 };
  const health = ifHasInput(read(FIRST), read(DAILY));

  // 3. Back to Motus
  const back = act("text.replace", { UUID: uid(), WFInput: text(named("Address")),
    WFReplaceTextFind: "/api/upload", WFReplaceTextReplace: text("/connect.html?health=done") });
  const open = act("openurl", { UUID: uid(), WFInput: attach(out(uuidOf(back), "Updated Text")) });

  return {
    WFWorkflowActions: [
      ...ifHasInput([save]),
      file, split, first, setVar("Address", out(uuidOf(first), "Item from List")),
      last, setVar("Token", out(uuidOf(last), "Item from List")),
      ...health,
      ...ifHasInput([back, open]),           // after Finish: back to Motus → Connect
    ],
    WFWorkflowClientVersion: "1146.11.1",
    WFWorkflowMinimumClientVersion: 900,
    WFWorkflowMinimumClientVersionString: "900",
    WFWorkflowIcon: { WFWorkflowIconStartColor: 4292093695, WFWorkflowIconGlyphNumber: 59843 },
    WFWorkflowImportQuestions: [],
    WFWorkflowTypes: [],
    WFQuickActionSurfaces: [],
    WFWorkflowHasOutputFallback: false,
    WFWorkflowHasShortcutInputVariables: true,
    WFWorkflowInputContentItemClasses: ["WFStringContentItem", "WFURLContentItem"],
    WFWorkflowOutputContentItemClasses: [],
  };
}

// ---- XML plist ----
const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function xml(v, ind = "") {
  const n = ind + "\t";
  if (v === true || v === false) return `${ind}<${v}/>`;
  if (v instanceof Date) return `${ind}<date>${v.toISOString().replace(/\.\d{3}Z$/, "Z")}</date>`;
  if (typeof v === "number") return `${ind}<integer>${v}</integer>`;
  if (typeof v === "string") return `${ind}<string>${esc(v)}</string>`;
  if (Array.isArray(v)) return v.length ? `${ind}<array>\n${v.map(x => xml(x, n)).join("\n")}\n${ind}</array>` : `${ind}<array/>`;
  const keys = Object.keys(v).filter(k => v[k] !== undefined);
  if (!keys.length) return `${ind}<dict/>`;
  return `${ind}<dict>\n${keys.map(k => `${n}<key>${esc(k)}</key>\n${xml(v[k], n)}`).join("\n")}\n${ind}</dict>`;
}
export const toPlist = obj => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${xml(obj)}\n</plist>\n`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = join(HERE, "dist", `${NAME}.unsigned.plist`);
  mkdirSync(dirname(target), { recursive: true });
  const wf = build();
  writeFileSync(target, toPlist(wf));
  console.log(`wrote ${target} (${wf.WFWorkflowActions.length} actions)`);
}
