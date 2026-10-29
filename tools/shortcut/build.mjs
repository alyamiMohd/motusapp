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

// source: a variable holding one source's name. "Source is" is a picker of the phone's own sources and fails at run
// time when a variable fills it (seen on the owner's iPhone, 2026-10-29), so the name is matched as text instead:
// begins with it AND ends with it, which only the name itself does in practice ("contains" would also take
// "Mo's iPhone" for "iPhone").
// newest: only the newest N samples (Latest First), for looking up sources without reading a month of samples
function findSamples(label, days, groupByDay, fillMissing = false, source, newest) {
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
          ...(source ? [8, 9].map(op => ({ Bounded: true, Operator: op, Property: "Source", Removable: true,   // begins / ends with
            Values: { String: text(source) } })) : []),
        ],
      },
      WFSerializationType: "WFContentPredicateTableTemplate",
    },
    WFContentItemSortProperty: "Start Date",
    WFContentItemSortOrder: newest ? "Latest First" : "Oldest First",
    WFContentItemLimitEnabled: !!newest,
    WFContentItemLimitNumber: newest || 20,
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

// The sources (iPhone, Watch, ring, apps) with samples of this type in the window, each once, in the variable
// sourcesVar: their names joined into {"a":1,"b":1} and read back as a dictionary, whose keys can't repeat. Quotes and
// backslashes in a name are escaped first so the JSON always reads. The names stay on the phone.
// Only the newest SOURCE_SAMPLES samples are looked at: the 30-day run stopped here on the owner's iPhone (2026-10-29)
// while 2 days (a few hundred samples) ran; this many still reaches back about a week for a phone, a watch and a ring.
const SOURCE_SAMPLES = 600;
const SEP = "␞";                     // joins the names before escaping; no device is called that
const replace = (input, find, by) => act("text.replace", { UUID: uid(), WFInput: text(input), WFReplaceTextFind: find,
  WFReplaceTextReplace: text(by) });
function sourcesBlock(label, days, sourcesVar) {
  const find = findSamples(label, days, false, false, undefined, SOURCE_SAMPLES);
  const src = act("properties.health.quantity", { UUID: uid(), CustomOutputName: "Source", WFContentItemPropertyName: "Source",
    WFInput: attach(out(uuidOf(find), "Health Samples")) });
  const joined = act("text.combine", { UUID: uid(), WFTextSeparator: "Custom", WFTextCustomSeparator: SEP,
    text: attach(out(uuidOf(src), "Source")) });
  const r1 = replace(out(uuidOf(joined), "Combined Text"), "\\", "\\\\");
  const r2 = replace(out(uuidOf(r1), "Updated Text"), '"', '\\"');
  const r3 = replace(out(uuidOf(r2), "Updated Text"), SEP, '":1,"');
  const json = act("gettext", { UUID: uid(), WFTextActionText: text('{"', out(uuidOf(r3), "Updated Text"), '":1}') });
  const dict = act("detect.dictionary", { UUID: uid(), WFInput: attach(out(uuidOf(json), "Text")) });
  const keys = act("getvalueforkey", { UUID: uid(), WFGetDictionaryValueType: "All Keys", WFInput: attach(out(uuidOf(dict), "Dictionary")) });
  return [find, src, joined, r1, r2, r3, json, dict, keys, setVar(sourcesVar, out(uuidOf(keys), "Dictionary Value"))];
}

// v3: one total per day for each source on its own, "day|value[|unit]|n" with n the source's place in the list (a
// number, never a device name). Health's day totals in Shortcuts add every source together (an iPhone and a Watch
// counting the same walk twice); this way the server keeps the busiest source each day, as the Health app roughly
// does. Day totals keep the upload small: iOS refuses to send thousands of single samples. Each type finds its own
// sources, so every source asked has samples of that type (a ring or an app may count steps but no energy).
function perSourceBlock(varName, label, days, fields) {
  const g = uid(), endUUID = uid(), sourcesVar = varName + " Sources";
  const find = findSamples(label, days, true, false, named("Repeat Item"));
  const combine = combineLines(endUUID);
  return [
    ...sourcesBlock(label, days, sourcesVar),
    act("repeat.each", { GroupingIdentifier: g, WFControlFlowMode: 0, UUID: uid(), WFInput: attach(named(sourcesVar)) }),
    // a sample without a source gives an empty name, and a text filter can't match on nothing
    ...ifHasValue(named("Repeat Item"), [find, ...sampleLines(find, fields, DAY, "Repeat Item 2", [named("Repeat Index")])]),
    act("repeat.each", { GroupingIdentifier: g, WFControlFlowMode: 2, UUID: endUUID }),
    combine, setVar(varName, out(uuidOf(combine), "Combined Text")),
  ];
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
    // Steps and Active Calories: a day total per source (v3, perSourceBlock)
    ...perSourceBlock("Steps", "Steps", w.move, ["Start Date", "Value"]),
    post(["Steps"]),
    ...perSourceBlock("Active", "Active Calories", w.move, ["Start Date", "Value", "Unit"]),
    post(["Active"]),
  ];
  const FIRST = { move: 30, food: 30 }, DAILY = { move: 2, food: 7 };
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
