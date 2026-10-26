// The on-device store: demo when empty, which source wins, full vs partial imports, cleaning, backup and restore.
// Run from the repo root:  node tests/test_store.mjs
import { check, section, finish } from "./harness.mjs";
const store = await import("../js/store.js");
const { getData, putSource, removeSource, clearAll, backup, restore, clean, load } = store;
const T = "2026-10-26";

section("empty -> demo");
clearAll();
let d = getData(T);
check("demo shown when nothing is imported", d.demo === true && d.sources.length === 0 && Object.keys(d.days).length > 100);
check("the demo is never written to storage", localStorage.getItem("motusapp-data-v1") === null);

section("imports and priority");
putSource("hevy", { replace: true, days: { "2026-10-20": { workout_count: 1, workout_minutes: 60, workout_volume_kg: 5000, workout_titles: ["Push"] } },
  exercises: { Bench: [["2026-10-20", 93.3, 80, 5, 400]] } });
putSource("apple", { days: { "2026-10-20": { steps: 9000, calories: 2100, weight_kg: 80.1, sleep_hours: 7 }, "2026-10-21": { steps: 5000 } } });
putSource("mfp", { days: { "2026-10-20": { calories: 1900 }, "2026-10-22": { calories: 1800 } } });
d = getData(T);
check("own data replaces the demo", d.demo === false && d.sources.map(s => s.id).join() === "apple,mfp,hevy");
check("Apple Health wins over MyFitnessPal for the same day", d.days["2026-10-20"].calories === 2100);
check("MyFitnessPal fills days Apple Health doesn't have", d.days["2026-10-22"].calories === 1800);
check("workouts come through with exercises", d.days["2026-10-20"].workout_count === 1 && d.exercises.Bench.length === 1);
putSource("manual", { days: { "2026-10-20": { weight_kg: 79.5 } } });
check("a value typed by hand wins", getData(T).days["2026-10-20"].weight_kg === 79.5);

section("full vs partial imports");
putSource("apple", { days: { "2026-10-21": { steps: 6000, sleep_hours: 8 } } });
d = getData(T);
check("partial import merges: new values win, other days kept", d.days["2026-10-21"].steps === 6000 && d.days["2026-10-20"].steps === 9000);
putSource("hevy", { replace: true, days: { "2026-10-23": { workout_count: 1, workout_titles: ["Legs"] } }, exercises: {} });
d = getData(T);
check("full export replaces the old history", !d.days["2026-10-20"].workout_count && d.days["2026-10-23"].workout_count === 1 && !d.exercises.Bench);
putSource("strong", { replace: true, days: { "2026-10-23": { workout_count: 2, workout_titles: ["A", "B"] }, "2026-10-24": { workout_count: 1, workout_titles: ["C"] } } });
d = getData(T);
check("two workout apps on the same day: Hevy's day wins, no double counting", d.days["2026-10-23"].workout_count === 1 && d.days["2026-10-24"].workout_count === 1);

section("cleaning");
check("zero and negative are no data", clean("steps", 0) === null && clean("steps", -5) === null);
check("implausible values dropped", clean("sleep_hours", 30) === null && clean("weight_kg", 5) === null && clean("steps", 1e7) === null);
check("numbers in strings read", clean("steps", "8000") === 8000);
check("unknown fields ignored", clean("password", "x") === undefined);
putSource("csv", { days: { "2026-10-25": { steps: 0, weight_kg: 1000, sleep_hours: 7.5, evil: "<script>" }, "not-a-date": { steps: 5 } },
                   exercises: { X: [["2026-10-25", -1, 0, 0, 0], ["bad", 1, 1, 1, 1]], Y: "nope" } });
const raw = load().sources.csv;
check("only valid values and dates are stored", JSON.stringify(raw.days) === '{"2026-10-25":{"sleep_hours":7.5}}' && JSON.stringify(raw.exercises) === "{}");

section("remove, backup, restore");
const saved = backup();
removeSource("csv");
check("one source removed, others kept", !getData(T).sources.some(s => s.id === "csv") && getData(T).sources.length === 5);
clearAll();
check("delete everything returns to the demo", getData(T).demo === true);
const n = restore(JSON.parse(saved));
d = getData(T);
check("restore brings every source back", n === 6 && d.sources.length === 6 && d.days["2026-10-20"].weight_kg === 79.5);
let threw = ""; try { restore({ hello: "world" }); } catch (e) { threw = e.message; }
check("a non-backup file is refused and nothing is lost", /isn't a Motus backup/.test(threw) && getData(T).sources.length === 6);
threw = ""; try { putSource("dropbox", { days: {} }); } catch (e) { threw = e.message; }
check("unknown sources refused", /unknown source/.test(threw));

finish();
