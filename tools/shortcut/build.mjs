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

const detail = (prop, custom, item = "Repeat Item") => act("properties.health.quantity", {
  UUID: uid(), CustomOutputName: custom, WFContentItemPropertyName: prop, WFInput: attach(named(item)) });
const formatDate = (src, pattern) => act("format.date", {
  UUID: uid(), WFDate: text(out(uuidOf(src), src.WFWorkflowActionParameters.CustomOutputName)),
  WFDateFormatStyle: "Custom", WFDateFormat: pattern, WFTimeFormatStyle: "None" });
const DAY = "yyyy-MM-dd", MIN = "yyyy-MM-dd HH:mm";
const combineLines = endUUID => act("text.combine", { UUID: uid(), WFTextSeparator: "New Lines", text: attach(out(endUUID, "Repeat Results")) });

// Repeat over a Find Health Samples result: one "a|b|c" line per sample (or per day when grouped), then Combine Text.
// fields: detail names (dates formatted with `pattern`); item: the loop's variable ("Repeat Item 2" inside another
// loop); extra: more values at the end of each line.
function sampleLines(find, fields, pattern, item = "Repeat Item", extra = []) {
  const g = uid(), endUUID = uid();
  const inner = [], parts = [];
  fields.forEach((f, i) => {
    const d = detail(f, f, item);
    inner.push(d);
    let ref = out(uuidOf(d), f);
    if (/Date$/.test(f)) { const fd = formatDate(d, pattern); inner.push(fd); ref = out(uuidOf(fd), "Formatted Date"); }
    if (i) parts.push("|");
    parts.push(ref);
  });
  for (const e of extra) parts.push("|", e);
  const line = act("gettext", { UUID: uid(), WFTextActionText: text(...parts) });
  return [
    act("repeat.each", { GroupingIdentifier: g, WFControlFlowMode: 0, UUID: uid(),
      WFInput: attach(out(uuidOf(find), "Health Samples",
        { Aggrandizements: [{ CoercionItemClass: "WFHKSampleContentItem", Type: "WFCoercionVariableAggrandizement" }] })) }),
    ...inner, line,
    act("repeat.each", { GroupingIdentifier: g, WFControlFlowMode: 2, UUID: endUUID }),
    combineLines(endUUID),
  ];
}

// One Health type -> a text variable with one line per sample (or per day when grouped).
function healthBlock(varName, label, days, groupByDay, fields, pattern, fillMissing = false) {
  const find = findSamples(label, days, groupByDay, fillMissing);
  const body = sampleLines(find, fields, pattern);
  return [find, ...body, setVar(varName, out(uuidOf(body.at(-1)), "Combined Text"))];
}

// v3: day totals in three groups of devices, "day|value[|unit]|n" with n the group: 1 = a name with "Watch", 2 = with
// "iPhone", 3 = everything else (a ring, a band, an app). Health's day totals in Shortcuts add every device together
// (an iPhone and a Watch counting the same walk twice); this way the server keeps the busiest group each day, as the
// Health app roughly does. The filters are fixed text: a Source filter filled from a variable failed ("Source is",
// v3.0) or was silently ignored ("begins with", v3.1-3.3: every device's total came back as the sum of all) on the
// owner's iPhone, 2026-10-29. Default names keep "iPhone" and "Apple Watch" in every language.
// Shortcuts' day totals can't be split by device at all: a Source filter is applied AFTER grouping, to day totals
// whose source is every device (v3.4 put all steps under "Watch" and none under "iPhone"), and grouping a list from
// an earlier Find ignores that list and asks Health for everything again (v3.5: all three groups the same). Reading a
// month of single samples at once is too much (the 30-day runs stopped). So the Shortcut adds up each day itself: for
// each day and each group, Find that day's single samples (where the Source filter works), get their values and
// Calculate Statistics → Sum. Each Find holds one day of one group, a few hundred samples at most.
const src = (op, s) => ({ Bounded: true, Operator: op, Property: "Source", Removable: true, Values: { String: s } });
const GROUPS = [[src(99, "Watch")], [src(99, "iPhone"), src(999, "Watch")], [src(999, "Watch"), src(999, "iPhone")]];
const qty = (magnitude, unit) => ({ Value: { Magnitude: magnitude, Unit: unit }, WFSerializationType: "WFQuantityFieldValue" });
const adjust = (date, op, magnitude = "1") => act("adjustdate", { UUID: uid(), WFDate: text(date), WFAdjustOperation: op,
  WFDuration: qty(magnitude, "days") });
// "Start Date is after <day start>" (2, as Apple's own "is after Current Date") and "is between <long ago> and <day
// end>" (1003, as Apple's own samples: a fixed lower bound, a variable upper bound)
const LONG_AGO = new Date("2000-01-01T00:00:00Z");
const dayRows = (start, end) => [
  { Bounded: true, Operator: 2, Property: "Start Date", Removable: true, Values: { Date: attach(start) } },
  { Bounded: true, Operator: 1003, Property: "Start Date", Removable: true, Values: { Date: LONG_AGO, AnotherDate: attach(end) } },
];

// TEMPORARY (2026-10-29): which filters actually filter? v3.6's day-by-day Finds all came back empty on the owner's
// iPhone. Today's steps are counted with each filter alone and the counts are sent as diag_* fields (one line per
// sample, values only; the server logs line counts, nothing else). Remove once the answer is in.
function diagBlock() {
  const now = act("date", { UUID: uid(), WFDateActionMode: "Current Date" });
  const today = adjust(out(uuidOf(now), "Date"), "Get Start of Day");
  const tomorrow = adjust(out(uuidOf(today), "Adjusted Date"), "Add");
  const T = out(uuidOf(today), "Adjusted Date"), M = out(uuidOf(tomorrow), "Adjusted Date");
  const variants = {
    all: [],
    watch: [src(99, "Watch")],
    iphone: [src(99, "iPhone")],
    after: [{ Bounded: true, Operator: 2, Property: "Start Date", Removable: true, Values: { Date: attach(T) } }],
    upto: [{ Bounded: true, Operator: 1003, Property: "Start Date", Removable: true, Values: { Date: LONG_AGO, AnotherDate: attach(M) } }],
    between: [{ Bounded: true, Operator: 1003, Property: "Start Date", Removable: true, Values: { Date: attach(T), AnotherDate: attach(M) } }],
  };
  const acts = [now, today, tomorrow], fields = [];
  for (const [name, rows] of Object.entries(variants)) {
    const find = findSamples("Steps", 1, false, false, rows);
    const values = act("properties.health.quantity", { UUID: uid(), CustomOutputName: "Value", WFContentItemPropertyName: "Value",
      WFInput: attach(out(uuidOf(find), "Health Samples")) });
    const joined = act("text.combine", { UUID: uid(), WFTextSeparator: "New Lines", text: attach(out(uuidOf(values), "Value")) });
    acts.push(find, values, joined);
    fields.push(["diag_" + name, text(out(uuidOf(joined), "Combined Text"))]);
  }
  acts.push(act("downloadurl", { UUID: uid(), Advanced: true, ShowHeaders: true, WFURL: text(named("Address")), WFHTTPMethod: "POST",
    WFHTTPHeaders: dictItems([["Authorization", text("Bearer ", named("Token"))]]), WFHTTPBodyType: "JSON",
    WFJSONValues: dictItems([["v", text("3")], ...fields]) }));
  return acts;
}

// The last n days, today first: Steps and Active get one "day|sum[|unit]|group" line per day and group that has samples.
function byDayBlock(n) {
  const now = act("date", { UUID: uid(), WFDateActionMode: "Current Date" });
  const today = adjust(out(uuidOf(now), "Date"), "Get Start of Day");
  const tomorrow = adjust(out(uuidOf(today), "Adjusted Date"), "Add");
  const start = adjust(out(uuidOf(tomorrow), "Adjusted Date"), "Subtract", attach(named("Repeat Index")));
  const end = adjust(out(uuidOf(start), "Adjusted Date"), "Add");
  const day = act("format.date", { UUID: uid(), WFDate: text(out(uuidOf(start), "Adjusted Date")),
    WFDateFormatStyle: "Custom", WFDateFormat: DAY, WFTimeFormatStyle: "None" });
  const body = [start, end, day];
  for (const [varName, label, withUnit] of [["Steps", "Steps", false], ["Active", "Active Calories", true]]) {
    GROUPS.forEach((rows, i) => {
      const find = findSamples(label, n + 1, false, false,
        [...dayRows(out(uuidOf(start), "Adjusted Date"), out(uuidOf(end), "Adjusted Date")), ...rows]);
      const samples = out(uuidOf(find), "Health Samples");
      const values = act("properties.health.quantity", { UUID: uid(), CustomOutputName: "Value", WFContentItemPropertyName: "Value",
        WFInput: attach(samples) });
      const sum = act("statistics", { UUID: uid(), WFStatisticsOperation: "Sum", WFInput: attach(out(uuidOf(values), "Value")) });
      const unitActs = [], unitPart = [];
      if (withUnit) {
        const units = act("properties.health.quantity", { UUID: uid(), CustomOutputName: "Unit", WFContentItemPropertyName: "Unit",
          WFInput: attach(samples) });
        const unit = act("getitemfromlist", { UUID: uid(), WFItemSpecifier: "First Item", WFInput: attach(out(uuidOf(units), "Unit")) });
        unitActs.push(units, unit); unitPart.push("|", out(uuidOf(unit), "Item from List"));
      }
      const line = act("gettext", { UUID: uid(), WFTextActionText: text(out(uuidOf(day), "Formatted Date"), "|",
        out(uuidOf(sum), "Statistics"), ...unitPart, "|" + (i + 1)) });
      body.push(find, ...ifHasValue(samples, [values, sum, ...unitActs, line,
        act("appendvariable", { WFVariableName: varName, WFInput: attach(out(uuidOf(line), "Text")) })]));
    });
  }
  const g = uid();
  return [now, today, tomorrow,
    act("repeat.count", { GroupingIdentifier: g, WFControlFlowMode: 0, WFRepeatCount: n, UUID: uid() }),
    ...body,
    act("repeat.count", { GroupingIdentifier: g, WFControlFlowMode: 2, UUID: uid() })];
}

export function build({ diag = true } = {}) {   // diag: the TEMPORARY filter test (diagBlock)
  // 1. Remember where to send (only when Motus → Finish passes "<url>|<token>")
  const save = act("documentpicker.save", { UUID: uid(), WFInput: attach(INPUT), WFAskWhereToSave: false,
    WFSaveFileOverwrite: true, WFFileDestinationPath: text("motus.txt") });
  const file = act("documentpicker.open", { UUID: uid(), WFGetFilePath: "motus.txt",
    WFFileErrorIfNotFound: true, WFShowFilePicker: false });
  const split = act("text.split", { UUID: uid(), WFTextSeparator: "Custom", WFTextCustomSeparator: "|",
    text: attach(out(uuidOf(file), "File")) });
  const first = act("getitemfromlist", { UUID: uid(), WFItemSpecifier: "First Item", WFInput: attach(out(uuidOf(split), "Split Text")) });
  const last = act("getitemfromlist", { UUID: uid(), WFItemSpecifier: "Last Item", WFInput: attach(out(uuidOf(split), "Split Text")) });

  // 2. Read Health and send it in three parts: food, weight and sleep, then steps, then active energy. Smaller uploads,
  //    and if a run stops, the server has what came before and its log shows how far it got. The first run (from
  //    Finish, so with input) fills the last 30 days; every later run (the daily automation, or a tap) only the last 2,
  //    plus a week of food and weight to catch late entries.
  const post = vars => act("downloadurl", {
    UUID: uid(), Advanced: true, ShowHeaders: true, WFURL: text(named("Address")), WFHTTPMethod: "POST",
    WFHTTPHeaders: dictItems([["Authorization", text("Bearer ", named("Token"))]]),
    WFHTTPBodyType: "JSON",
    WFJSONValues: dictItems([["v", text("3")], ...vars.map(k => [k.toLowerCase(), text(named(k))])]),
  });
  const read = w => [
    // the picker shows "Dietary Energy" but stores "Dietary Calories" (seen in the owner's re-shared Shortcut, 2026-10-28);
    // Fill Missing: days with nothing logged come back as 0 instead of a "No Samples Found" stop
    ...healthBlock("Calories", "Dietary Calories", w.food, true, ["Start Date", "Value", "Unit"], DAY, true),
    ...healthBlock("Weight", "Weight", w.food, false, ["Start Date", "Value", "Unit"], MIN),
    ...healthBlock("Sleep", "Sleep", w.move, false, ["Start Date", "End Date", "Value", "Source"], MIN),
    post(["Calories", "Weight", "Sleep"]),
    // Steps and Active Calories: day totals per group of devices, added up on the phone (v3.6, byDayBlock)
    ...byDayBlock(w.days),
    post(["Steps", "Active"]),
  ];
  const FIRST = { move: 30, food: 30, days: 30 }, DAILY = { move: 2, food: 7, days: 3 };
  const health = ifHasInput(read(FIRST), [...(diag ? diagBlock() : []), ...read(DAILY)]);

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
