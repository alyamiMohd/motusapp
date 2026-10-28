// Builds the Motus Shortcut (Apple's own actions only) as an unsigned XML plist: `node tools/shortcut/build.mjs`.
// Sign it on a Mac signed in to iCloud: `shortcuts sign --mode anyone -i <plist> -o Motus.shortcut` (GitHub's Macs
// are not signed in to iCloud, so CI cannot; tools/shortcut/sign.mjs tries RoutineHub's HubSign, behind a bot check now).
//
// What it does, matching public/shortcut.html and readHealthUpload in public/js/health.js:
//   Finish in Motus runs it with "<upload url>|<token>" as input; it keeps that in motus.txt (Shortcuts folder).
//   Every run reads Steps, Dietary Calories, Active Calories (Health's own daily totals: Group By Day, deduplicated
//   across iPhone and Watch), Weight and Sleep (raw samples), and POSTs them as text lines to the upload URL.
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

function ifHasInput(body, otherwise) {   // If Shortcut Input has any value … [Otherwise …] End If
  const g = uid();
  return [
    act("conditional", { GroupingIdentifier: g, WFCondition: 100, WFControlFlowMode: 0,
      WFInput: { Type: "Variable", Variable: attach(INPUT) } }),
    ...body,
    ...(otherwise ? [act("conditional", { GroupingIdentifier: g, WFControlFlowMode: 1 }), ...otherwise] : []),
    act("conditional", { GroupingIdentifier: g, WFControlFlowMode: 2, UUID: uid() }),
  ];
}

function findSamples(label, days, groupByDay, fillMissing = false) {
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

const detail = (prop, custom) => act("properties.health.quantity", {
  UUID: uid(), CustomOutputName: custom, WFContentItemPropertyName: prop, WFInput: attach(named("Repeat Item")) });
const formatDate = (src, pattern) => act("format.date", {
  UUID: uid(), WFDate: text(out(uuidOf(src), src.WFWorkflowActionParameters.CustomOutputName)),
  WFDateFormatStyle: "Custom", WFDateFormat: pattern, WFTimeFormatStyle: "None" });

// One Health type -> a text variable with one "a|b|c" line per sample (or per day when grouped).
// fields: list of detail names; dates are formatted with `pattern`.
function healthBlock(varName, label, days, groupByDay, fields, pattern, fillMissing = false) {
  const find = findSamples(label, days, groupByDay, fillMissing);
  const g = uid(), endUUID = uid();
  const inner = [], parts = [];
  fields.forEach((f, i) => {
    const d = detail(f, f);
    inner.push(d);
    let ref = out(uuidOf(d), f);
    if (/Date$/.test(f)) { const fd = formatDate(d, pattern); inner.push(fd); ref = out(uuidOf(fd), "Formatted Date"); }
    if (i) parts.push("|");
    parts.push(ref);
  });
  const line = act("gettext", { UUID: uid(), WFTextActionText: text(...parts) });
  const combine = act("text.combine", { UUID: uid(), WFTextSeparator: "New Lines", text: attach(out(endUUID, "Repeat Results")) });
  return [
    find,
    act("repeat.each", { GroupingIdentifier: g, WFControlFlowMode: 0, UUID: uid(),
      WFInput: attach(out(uuidOf(find), "Health Samples",
        { Aggrandizements: [{ CoercionItemClass: "WFHKSampleContentItem", Type: "WFCoercionVariableAggrandizement" }] })) }),
    ...inner, line,
    act("repeat.each", { GroupingIdentifier: g, WFControlFlowMode: 2, UUID: endUUID }),
    combine,
    setVar(varName, out(uuidOf(combine), "Combined Text")),
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

  // 2. Read Health. The first run (from Finish, so with input) fills the last 30 days; every later run (the daily
  //    automation, or a tap) only the last 2, plus a week of food and weight to catch late entries.
  const DAY = "yyyy-MM-dd", MIN = "yyyy-MM-dd HH:mm";
  const read = w => [
    // v2: Steps and Active Calories go sample by sample with their source. Grouping by day in Shortcuts adds every
    // source together (an iPhone and a Watch counting the same walk double); the server keeps the busiest source per
    // day instead, as the Health app roughly does.
    ...healthBlock("Steps", "Steps", w.move, false, ["Start Date", "Value", "Source"], MIN),
    // the picker shows "Dietary Energy" but stores "Dietary Calories" (seen in the owner's re-shared Shortcut, 2026-10-28);
    // Fill Missing: days with nothing logged come back as 0 instead of a "No Samples Found" stop
    ...healthBlock("Calories", "Dietary Calories", w.food, true, ["Start Date", "Value", "Unit"], DAY, true),
    ...healthBlock("Active", "Active Calories", w.move, false, ["Start Date", "Value", "Unit", "Source"], MIN),
    ...healthBlock("Weight", "Weight", w.food, false, ["Start Date", "Value", "Unit"], MIN),
    ...healthBlock("Sleep", "Sleep", w.move, false, ["Start Date", "End Date", "Value", "Source"], MIN),
  ];
  const FIRST = { move: 30, food: 30 }, DAILY = { move: 2, food: 7 };
  const health = ifHasInput(read(FIRST), read(DAILY));

  // 3. Send
  const post = act("downloadurl", {
    UUID: uid(), Advanced: true, ShowHeaders: true, WFURL: text(named("Address")), WFHTTPMethod: "POST",
    WFHTTPHeaders: dictItems([["Authorization", text("Bearer ", named("Token"))]]),
    WFHTTPBodyType: "JSON",
    WFJSONValues: dictItems([["v", text("2")], ...["Steps", "Calories", "Active", "Weight", "Sleep"]
      .map(k => [k.toLowerCase(), text(named(k))])]),
  });
  const back = act("text.replace", { UUID: uid(), WFInput: text(named("Address")),
    WFReplaceTextFind: "/api/upload", WFReplaceTextReplace: text("/connect.html?health=done") });
  const open = act("openurl", { UUID: uid(), WFInput: attach(out(uuidOf(back), "Updated Text")) });

  return {
    WFWorkflowActions: [
      ...ifHasInput([save]),
      file, split, first, setVar("Address", out(uuidOf(first), "Item from List")),
      last, setVar("Token", out(uuidOf(last), "Item from List")),
      ...health,
      post,
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
