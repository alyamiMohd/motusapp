// Importers: CSV parsing, dates, Hevy (CSV + API), Strong (old and new formats), MyFitnessPal, Apple Health
// (export.xml streamed from a real zip, Health Exporter JSON), the spreadsheet template, and the zip reader.
// Fixtures are made up and follow each app's export format. Run from the repo root:  node tests/test_importers.mjs
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { check, near, section, finish } from "./harness.mjs";
const { parseCSV, num, parseDateTime, columns } = await import("../js/importers/csv.js");
const { fromHevyCSV, fetchHevy } = await import("../js/importers/hevy.js");
const { fromStrongCSV } = await import("../js/importers/strong.js");
const { fromMfpCSV, importMfp } = await import("../js/importers/mfp.js");
const { healthXmlScanner, importAppleHealth, fromHealthExporterJSON } = await import("../js/importers/apple.js");
const { fromSheetCSV, template, TEMPLATE_HEADER } = await import("../js/importers/sheet.js");
const { listEntries, entryText } = await import("../js/importers/zip.js");
const { localISO } = await import("../js/core.js");

const fx = name => readFileSync(new URL("./fixtures/" + name, import.meta.url));
const file = (name, buf) => new File([buf], name);

section("CSV and numbers");
let rows = parseCSV('﻿a,b,c\r\n1,"two, 2","say ""hi"""\r\n\r\n3,,\n');
check("BOM, quotes, escaped quotes, CRLF, blank lines", rows.length === 3 && rows[1][1] === "two, 2" && rows[1][2] === 'say "hi"' && rows[2][1] === "");
check("semicolon files", parseCSV("a;b\n1;2")[1][1] === "2");
check("tab files", parseCSV("a\tb\n1\t2")[1][1] === "2");
check("quoted newline stays in the field", parseCSV('a,b\n"x\ny",2')[1][0] === "x\ny");
check("num: thousands, decimals, units", num("1,234") === 1234 && num("80.5 kg") === 80.5 && num("80,5") === 80.5 && num("1.234,5") === 1234.5 && num("") === null && num("abc") === null);
check("columns: loose header names", JSON.stringify(columns(["Date", "Weight (kg)", "Exercise Name"], { d: ["date"], w: ["weight"], e: ["exercise_name"], x: ["nope"] })) === '{"d":0,"w":1,"e":2,"x":-1}');

section("dates");
const pd = s => (parseDateTime(s) || {}).date;
check("ISO date", pd("2026-10-25") === "2026-10-25");
check("ISO with time", pd("2026-10-25 07:30:12") === "2026-10-25");
check("Hevy style '25 Oct 2026, 18:30'", pd("25 Oct 2026, 18:30") === "2026-10-25");
check("'Oct 25, 2026 6:30 PM'", pd("Oct 25, 2026 6:30 PM") === "2026-10-25");
check("'25 September 2026'", pd("25 September 2026") === "2026-09-25");
check("US slash date", pd("10/05/2026") === "2026-10-05");
check("day-first when it can only be a day", pd("25/10/2026") === "2026-10-25");
check("Z time becomes the local date", pd("2026-10-25T23:30:00Z") === localISO(new Date("2026-10-25T23:30:00Z")));
check("impossible dates rejected", parseDateTime("2026-02-31") === null && parseDateTime("hello") === null && parseDateTime("") === null);
check("durations from naive times", parseDateTime("25 Oct 2026, 19:05").t - parseDateTime("25 Oct 2026, 18:00").t === 65);
check("12 AM is midnight", parseDateTime("Oct 25, 2026 12:15 AM").t - parseDateTime("2026-10-25").t === 15);

section("Hevy CSV");
const hevyCSV = `"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"
"Push","20 Oct 2026, 18:00","20 Oct 2026, 19:05","","Bench Press (Barbell)","","","0","warmup","40","10","","",""
"Push","20 Oct 2026, 18:00","20 Oct 2026, 19:05","","Bench Press (Barbell)","","","1","normal","80","5","","",""
"Push","20 Oct 2026, 18:00","20 Oct 2026, 19:05","","Plank","","","0","normal","","","","60",""
"Legs","22 Oct 2026, 07:30","22 Oct 2026, 08:20","Felt good, ""strong""","Squat (Barbell)","","","0","normal","100","5","","","8"
`;
let h = fromHevyCSV(hevyCSV);
check("two workouts", h.count === 2 && h.days["2026-10-20"].workout_count === 1 && h.days["2026-10-22"].workout_count === 1);
check("minutes from start and end", h.days["2026-10-20"].workout_minutes === 65 && h.days["2026-10-22"].workout_minutes === 50);
check("e1RM skips the warm-up", near(h.exercises["Bench Press (Barbell)"][0][1], 93.3));
check("bodyweight/time sets don't create an exercise", !h.exercises.Plank);
check("a full export replaces the source", h.replace === true);
h = fromHevyCSV(hevyCSV.replace('"weight_kg"', '"weight_lbs"'));
check("weight_lbs converted to kg", near(h.exercises["Squat (Barbell)"][0][2], 45.4));
let threw = ""; try { fromHevyCSV("a,b\n1,2"); } catch (e) { threw = e.message; }
check("a wrong file says so", /isn't a Hevy/.test(threw));

section("Hevy API (faked)");
const page = (n, count) => ({ ok: true, status: 200, json: async () => ({ page: n, page_count: count, workouts: [
  { title: "W" + n, start_time: `2026-10-${10 + n}T15:00:00+00:00`, end_time: `2026-10-${10 + n}T16:00:00+00:00`,
    exercises: [{ title: "Deadlift (Barbell)", sets: [{ type: "normal", weight_kg: 140, reps: 5 }] }] }] }) });
const calls = [];
let api = await fetchHevy("abcd1234-efgh", () => {}, async (url, opt) => { calls.push([url, opt.headers["api-key"]]); return page(calls.length, 3); });
check("walks every page", api.count === 3 && calls.length === 3 && calls[2][0].includes("page=3"));
check("sends the key only in the api-key header to api.hevyapp.com", calls.every(([u, k]) => u.startsWith("https://api.hevyapp.com/v1/workouts?") && k === "abcd1234-efgh" && !u.includes("abcd1234")));
check("workouts land on their local dates", Object.keys(api.days).length === 3);
threw = ""; try { await fetchHevy("abcd1234-efgh", () => {}, async () => ({ ok: false, status: 401 })); } catch (e) { threw = e.message; }
check("a rejected key gives a clear message", /didn't accept that key/.test(threw));
let tries = 0;
api = await fetchHevy("abcd1234-efgh", () => {}, async () => (++tries < 3 ? { ok: false, status: 429 } : page(1, 1)), async () => {});
check("busy (429) is retried", tries === 3 && api.count === 1);
threw = ""; try { await fetchHevy("bad key!", () => {}, async () => page(1, 1)); } catch (e) { threw = e.message; }
check("an obviously wrong key isn't sent", /doesn't look like/.test(threw));

section("Strong");
const strongNew = `Workout #,Date,Workout Name,Duration (sec),Exercise Name,Set Order,Weight (kg),Reps,RPE,Distance (meters),Seconds,Notes,Workout Notes
1,2026-10-20 18:00:00,"Evening Workout",3900,"Bench Press (Barbell)",W,40,10,,,,,
1,2026-10-20 18:00:00,"Evening Workout",3900,"Bench Press (Barbell)",1,80,5,,,,,
1,2026-10-20 18:00:00,"Evening Workout",3900,"Bench Press (Barbell)",Rest Timer,,,,,90,,
`;
let s = fromStrongCSV(strongNew);
check("new format: one workout, 65 minutes", s.count === 1 && s.days["2026-10-20"].workout_minutes === 65);
check("new format: W is a warm-up, rest rows ignored", near(s.exercises["Bench Press (Barbell)"][0][1], 93.3) && s.exercises["Bench Press (Barbell)"].length === 1);
check("unit read from the header", s.unitGuessed === false);
const strongOld = `Date;Workout Name;Duration;Exercise Name;Set Order;Weight;Weight Unit;Reps;Distance;Distance Unit;Seconds;Notes;Workout Notes;RPE
2024-01-15 07:30:12;"Morning";"1h 5m";"Squat (Barbell)";1;225;lbs;5;;;0;"";"";
2024-01-15 07:30:12;"Morning";"1h 5m";"Squat (Barbell)";2;225;lbs;5;;;0;"";"";
2024-01-17 07:30:12;"Morning";"45m";"Squat (Barbell)";1;100;kg;5;;;0;"";"";
`;
s = fromStrongCSV(strongOld);
check("old format: semicolons, '1h 5m'", s.count === 2 && s.days["2024-01-15"].workout_minutes === 65 && s.days["2024-01-17"].workout_minutes === 45);
check("old format: per-row Weight Unit (lbs -> kg)", near(s.exercises["Squat (Barbell)"][0][2], 102.1) && s.exercises["Squat (Barbell)"][1][2] === 100);
s = fromStrongCSV("Date,Exercise Name,Weight,Reps\n2026-10-20 08:00:00,Row,100,5\n", "lb");
check("no unit in the file: uses the chosen unit and says so", near(s.exercises.Row[0][2], 45.4) && s.unitGuessed === true);

section("MyFitnessPal");
const nut = fx("mfp/Nutrition-Summary-2026-10-01-to-2026-10-25.csv").toString();
let m = fromMfpCSV(nut);
check("meals add up per day ('1,200' read as 1200)", m.kind === "nutrition" && m.days["2026-10-20"].calories === 1651 && m.days["2026-10-21"].calories === 700);
m = fromMfpCSV(fx("mfp/Measurement-Summary-2026-10-01-to-2026-10-25.csv").toString(), "lb");
check("weight in lb converted", m.kind === "weight" && m.days["2026-10-20"].weight_kg === 80);
check("exercise summary ignored", fromMfpCSV(fx("mfp/Exercise-Summary-2026-10-01-to-2026-10-25.csv").toString()).kind === null);
m = await importMfp([file("mfp-export.zip", fx("mfp-export.zip"))], "lb");
check("the emailed zip: both files read from inside it", m.kinds.length === 2 && m.days["2026-10-20"].calories === 1651 && m.days["2026-10-20"].weight_kg === 80);
threw = ""; try { await importMfp([file("x.csv", Buffer.from("a,b\n1,2"))]); } catch (e) { threw = e.message; }
check("a wrong file says so", /Nutrition Summary/.test(threw));

section("Apple Health export.xml");
const xml = fx("apple_health_export/export.xml").toString();
const scan = healthXmlScanner(); scan.push(xml);
const a = scan.done().days;
check("steps: iPhone and Watch not added together (busiest source wins)", a["2026-10-24"].steps === 6500 && a["2026-10-25"].steps === 1234, JSON.stringify(a["2026-10-24"]));
check("weight: last reading of the day, lb -> kg", a["2026-10-24"].weight_kg === 80 && a["2026-10-25"].weight_kg === 79.6);
check("food energy: one source per day, kJ understood", a["2026-10-24"].calories === 1500);
check("active energy", a["2026-10-24"].active_kcal === 251);
check("sleep: asleep stages only, whole night on the wake-up day", a["2026-10-24"].sleep_hours === 7 && !a["2026-10-23"], JSON.stringify(a["2026-10-23"]));
check("heart rate and other records ignored", !Object.values(a).some(d => "heart" in d));
for (const size of [1, 7, 64, 333]) {
  const sc = healthXmlScanner();
  for (let i = 0; i < xml.length; i += size) sc.push(xml.slice(i, i + size));
  check(`same result when read in ${size}-character chunks`, JSON.stringify(sc.done().days) === JSON.stringify(a));
}
let progress = 0;
const z = await importAppleHealth(file("export.zip", fx("export.zip")), p => { progress = p; });
check("export.zip (made by a real zip tool) streamed and read", JSON.stringify(z.days) === JSON.stringify(a) && progress === 1);
const x = await importAppleHealth(file("export.xml", fx("apple_health_export/export.xml")));
check("a bare export.xml works too", JSON.stringify(x.days) === JSON.stringify(a));
threw = ""; try { await importAppleHealth(file("other.zip", fx("mfp-export.zip"))); } catch (e) { threw = e.message; }
check("a zip without export.xml says so", /No export.xml/.test(threw));

section("Health Exporter JSON");
const he = fromHealthExporterJSON({ stepCount: [{ date: "2026-10-23", unit: "count", value: 8123.6 }], sleepTime: [{ date: "2026-10-23", value: 451 }],
  dietaryEnergy: [{ date: "2026-10-23", unit: "kcal", value: 1311.11 }], weight: [{ date: "2026-10-23", unit: "kg", value: 63.94 }], activeCalories: [] });
check("daily totals mapped", JSON.stringify(he.days["2026-10-23"]) === JSON.stringify({ steps: 8124, sleep_hours: 7.52, calories: 1311, weight_kg: 63.9 }));
threw = ""; try { fromHealthExporterJSON({ hello: 1 }); } catch (e) { threw = e.message; }
check("other JSON refused", /isn't a Health Exporter/.test(threw));

section("spreadsheet");
check("template has the documented header and parses back", template("2026-10-26").startsWith(TEMPLATE_HEADER) && Object.keys(fromSheetCSV(template("2026-10-26")).days).length === 3);
const sh = fromSheetCSV(`Date,Sleep,Steps,Calories,Weight_lb,Workouts,Workout minutes
2026-10-20,7.5,"8,200",1950,176.4,1,60
21/10/2026,,9000,,,,
not a date,1,2,3,4,,
`);
check("loose headers, lb, thousands", JSON.stringify(sh.days["2026-10-20"]) === JSON.stringify({ sleep_hours: 7.5, steps: 8200, calories: 1950, weight_kg: 80, workout_count: 1, workout_minutes: 60, workout_titles: ["Workout"] }));
check("day-first date, empty cells skipped", JSON.stringify(sh.days["2026-10-21"]) === '{"steps":9000}' && sh.badRows === 1);
check("plain 'weight' uses the chosen unit", fromSheetCSV("date,weight\n2026-10-20,176.4", "lb").days["2026-10-20"].weight_kg === 80);
threw = ""; try { fromSheetCSV("day_of_year,steps\nx,1"); } catch (e) { threw = e.message; }
check("unreadable dates say how to write them", /YYYY-MM-DD/.test(threw));

section("zip reader: ZIP64 (as large Apple Health exports use)");
const body = Buffer.from("<HealthData>\n" + xml.slice(xml.indexOf("<Record")), "utf8"), comp = deflateRawSync(body);
const name = Buffer.from("apple_health_export/export.xml");
const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(45, 4); lh.writeUInt16LE(8, 8);
lh.writeUInt32LE(0xffffffff, 18); lh.writeUInt32LE(0xffffffff, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(20, 28);
const lx = Buffer.alloc(20); lx.writeUInt16LE(1, 0); lx.writeUInt16LE(16, 2); lx.writeBigUInt64LE(BigInt(body.length), 4); lx.writeBigUInt64LE(BigInt(comp.length), 12);
const local = Buffer.concat([lh, name, lx, comp]);
const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(45, 4); ch.writeUInt16LE(45, 6); ch.writeUInt16LE(8, 10);
ch.writeUInt32LE(0xffffffff, 20); ch.writeUInt32LE(0xffffffff, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(28, 30); ch.writeUInt32LE(0xffffffff, 42);
const cx = Buffer.alloc(28); cx.writeUInt16LE(1, 0); cx.writeUInt16LE(24, 2); cx.writeBigUInt64LE(BigInt(body.length), 4); cx.writeBigUInt64LE(BigInt(comp.length), 12); cx.writeBigUInt64LE(0n, 20);
const cd = Buffer.concat([ch, name, cx]);
const e64 = Buffer.alloc(56); e64.writeUInt32LE(0x06064b50, 0); e64.writeBigUInt64LE(44n, 4); e64.writeBigUInt64LE(1n, 24); e64.writeBigUInt64LE(1n, 32);
e64.writeBigUInt64LE(BigInt(cd.length), 40); e64.writeBigUInt64LE(BigInt(local.length), 48);
const loc = Buffer.alloc(20); loc.writeUInt32LE(0x07064b50, 0); loc.writeBigUInt64LE(BigInt(local.length + cd.length), 8); loc.writeUInt32LE(1, 16);
const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0xffff, 8); eocd.writeUInt16LE(0xffff, 10);
eocd.writeUInt32LE(0xffffffff, 12); eocd.writeUInt32LE(0xffffffff, 16);
const z64 = file("export.zip", Buffer.concat([local, cd, e64, loc, eocd]));
const ents = await listEntries(z64);
check("ZIP64 sizes and offsets read from the extra fields", ents.length === 1 && ents[0].size === body.length && ents[0].compSize === comp.length && ents[0].offset === 0);
check("ZIP64 entry decompresses", (await entryText(z64, ents[0])) === body.toString());
check("ZIP64 export imports", JSON.stringify((await importAppleHealth(z64)).days) === JSON.stringify(a));
threw = ""; try { await listEntries(file("x.zip", Buffer.from("not a zip at all"))); } catch (e) { threw = e.message; }
check("not a zip says so", /doesn't look like a zip/.test(threw));

finish();
