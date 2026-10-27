// Automatic sync: encryption, the GitHub job (sync/run.mjs) with faked GitHub Pages and Hevy, and the browser side.
// Run from the repo root:  node tests/test_sync.mjs
import { check, section, finish } from "./harness.mjs";
const { newKey, keyBytes, seal, unseal, toSource, syncUrl, pullSync, setSync, getSync } = await import("../js/sync.js");
const { runSync, readPayload } = await import("../sync/run.mjs");
const { getData, clearAll } = await import("../js/store.js");

const KEY = newKey(), OTHER = newKey();
let threw;
const fails = async (fn, re) => { try { await fn(); return false; } catch (e) { threw = e.message; return re.test(e.message); } };

section("keys and encryption");
check("a key is 43 url-safe characters, 32 random bytes", /^[A-Za-z0-9_-]{43}$/.test(KEY) && keyBytes(KEY).length === 32 && KEY !== OTHER);
check("anything else isn't a key", await fails(() => keyBytes("hello"), /isn't a Motus key/));
const state = { v: 1, health: { days: { "2026-10-24": { steps: 6500 } } }, note: "صباح الخير ✓".repeat(500) };
const box = await seal(state, KEY);
check("sealed file holds no readable data", !box.includes("6500") && !box.includes("2026-10-24") && JSON.parse(box).motus === 1);
check("opens with the right key", JSON.stringify(await unseal(box, KEY)) === JSON.stringify(state));
check("same data seals differently each time (fresh IV)", (await seal(state, KEY)) !== box);
check("the wrong key can't open it", await fails(() => unseal(box, OTHER), /doesn't open/));
const tampered = JSON.parse(box); tampered.data = tampered.data.slice(0, -8) + "AAAAAAA=";
check("a changed file is refused", await fails(() => unseal(JSON.stringify(tampered), KEY), /doesn't open/));
check("not a sync file", await fails(() => unseal("<html>", KEY), /isn't a Motus sync file/));
check("gzip keeps the file small", box.length < JSON.stringify(state).length / 3);

section("phone uploads");
const he = { stepCount: [{ date: "2026-10-25", unit: "count", value: 8123.4 }], sleepTime: [{ date: "2026-10-25", value: 430 }],
             dietaryEnergy: [{ date: "2026-10-25", unit: "kcal", value: 1900.2 }], weight: [{ date: "2026-10-25", unit: "kg", value: 80.14 }] };
check("Health Exporter JSON", JSON.stringify(readPayload({ health: he })["2026-10-25"]) === '{"sleep_hours":7.17,"steps":8123,"calories":1900,"weight_kg":80.1}');
check("plain daily numbers from any automation app", JSON.stringify(readPayload({ days: { "2026-10-25": { steps: "9000", weight_kg: 79.9, evil: 1 }, "bad": { steps: 1 } } })) === '{"2026-10-25":{"steps":9000,"weight_kg":79.9}}');
check("anything else is nothing", readPayload({ foo: 1 }) === null && readPayload(null) === null);
const b64lines = Buffer.from(JSON.stringify(he)).toString("base64").replace(/(.{76})/g, "$1\n");
check("Base64 from the Shortcut, with line breaks", JSON.stringify(readPayload({ health_b64: b64lines })) === JSON.stringify(readPayload({ health: he })));
check("JSON sent as text", JSON.stringify(readPayload({ health: JSON.stringify(he) })) === JSON.stringify(readPayload({ health: he })));

section("the GitHub job");
let published = null;     // what the fake GitHub Pages site serves
const pages = async url => {
  if (url.startsWith("https://api.hevyapp.com")) return hevy(url);
  if (!url.startsWith("https://me.github.io/motus-sync/motus-data.enc?t=")) throw new Error("unexpected " + url);
  return published ? { status: 200, ok: true, text: async () => published } : { status: 404, ok: false };
};
let hevyMode = "ok";
const hevy = async () => hevyMode === "down" ? { status: 401, ok: false } : ({ status: 200, ok: true, json: async () => ({ page: 1, page_count: 1, workouts: [
  { id: "x", title: "Push", start_time: "2026-10-24T15:00:00Z", end_time: "2026-10-24T16:05:00Z", description: "private note",
    exercises: [{ title: "Bench Press (Barbell)", notes: "n", sets: [{ type: "warmup", weight_kg: 40, reps: 10 }, { type: "normal", weight_kg: 80, reps: 5, rpe: 8 }] }] }] }) });
const env = (extra = {}) => ({ MOTUS_KEY: KEY, PAGES_URL: "https://me.github.io/motus-sync", PAYLOAD: "null", ...extra });
const quiet = { fetchFn: pages, log: () => {}, now: new Date("2026-10-26T06:00:00Z") };

let r = await runSync(env({ PAYLOAD: JSON.stringify({ health: he }) }), quiet);
check("first run: nothing published yet, phone upload added", !r.fatal && r.errors.length === 0 && r.state.health.days["2026-10-25"].steps === 8123);
published = await seal(r.state, KEY);
r = await runSync(env({ HEVY_API_KEY: "abcd1234-efgh", PAYLOAD: JSON.stringify({ days: { "2026-10-26": { steps: 1200 } } }) }), quiet);
check("next run keeps earlier days and adds new ones", r.state.health.days["2026-10-25"].steps === 8123 && r.state.health.days["2026-10-26"].steps === 1200);
check("Hevy pulled and trimmed to what Motus uses", r.state.hevy.ok === true && r.state.hevy.workouts.length === 1 &&
  !JSON.stringify(r.state.hevy).includes("private note") && !("rpe" in r.state.hevy.workouts[0].exercises[0].sets[1]));
published = await seal(r.state, KEY);
hevyMode = "down";
r = await runSync(env({ HEVY_API_KEY: "abcd1234-efgh" }), quiet);
check("Hevy failing: reported, earlier workouts kept, still publishes", !r.fatal && /Hevy/.test(r.errors[0]) && r.state.hevy.workouts.length === 1 && r.state.hevy.ok === false);
r = await runSync({ ...env(), MOTUS_KEY: OTHER }, quiet);
check("a different key never overwrites the data", r.fatal === true && /doesn't open/.test(r.errors[0]));
r = await runSync({ ...env(), MOTUS_KEY: OTHER, RESET: "true" }, quiet);
check("…unless started over on purpose", !r.fatal && Object.keys(r.state.health.days).length === 0);
r = await runSync(env(), { ...quiet, fetchFn: async () => ({ status: 503, ok: false }) });
check("GitHub Pages trouble: stops without publishing", r.fatal === true);
r = await runSync(env(), { ...quiet, fetchFn: async () => { throw new Error("dns"); } });
check("network trouble: stops without publishing", r.fatal === true);
r = await runSync({ PAGES_URL: "x" }, quiet);
check("no MOTUS_KEY: clear message", r.fatal && /MOTUS_KEY is missing/.test(r.errors[0]));
r = await runSync(env({ PAYLOAD: "{not json" }), quiet);
check("a broken upload is reported, nothing lost", !r.fatal && /valid JSON/.test(r.errors[0]) && r.state.health.days["2026-10-25"].steps === 8123);
const logs = [];
await runSync(env({ HEVY_API_KEY: "abcd1234-efgh", PAYLOAD: JSON.stringify({ health: he }) }), { ...quiet, log: m => logs.push(m) });
check("the public log never shows numbers", logs.length > 0 && !logs.some(m => /\d{3,}/.test(m)));

section("in the browser");
check("repo name -> Pages address", syncUrl("Me/motus-sync") === "https://me.github.io/motus-sync/motus-data.enc" &&
  syncUrl("https://github.com/me/motus-sync/") === "https://me.github.io/motus-sync/motus-data.enc" &&
  syncUrl("me/me.github.io") === "https://me.github.io/motus-data.enc" && syncUrl("not a repo") === null);
hevyMode = "ok";
r = await runSync(env({ HEVY_API_KEY: "abcd1234-efgh" }), quiet);
published = await seal(r.state, KEY);
const src = toSource(r.state);
check("sync file -> one source: phone days and Hevy workouts", src.days["2026-10-25"].steps === 8123 && Object.values(src.days).some(d => d.workout_count === 1) && src.exercises["Bench Press (Barbell)"]);
clearAll();
setSync({ repo: "me/motus-sync", url: "https://me.github.io/motus-sync/motus-data.enc", key: KEY });
await pullSync(getSync(), async url => pages(url.replace("motus-data.enc?t=", "motus-data.enc?t=")));
const d = getData("2026-10-26");
check("pulled into the app as 'Automatic sync'", d.demo === false && d.sources[0].id === "sync" && d.days["2026-10-25"].steps === 8123);
check("remembers when it last synced", !!getSync().last && getSync().updated === r.state.updated);
check("wrong key on this device: readable error", await fails(() => pullSync({ ...getSync(), key: OTHER }, pages), /doesn't open/));
published = null;
check("nothing published yet: says what to do", await fails(() => pullSync(getSync(), pages), /GitHub Pages is on/));

finish();
