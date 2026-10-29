// The Motus server (worker/) against a real SQLite database: sign-in codes, sessions, cross-site protection, sources,
// the Shortcut upload (incl. a phone set to Arabic), Hevy connect/sync with a faked Hevy, the cron, deleting an account.
// Run from the repo root:  node tests/test_server.mjs
import { check, section, finish } from "./harness.mjs";
import { d1 } from "./d1.mjs";
const worker = (await import("../worker/index.js")).default;
const { background } = await import("../worker/index.js");
const { readHealthUpload } = await import("../public/js/health.js");

const ORIGIN = "https://motus.test";
const codes = {};
let hevyCalls = [], hevyMode = "ok";
const fakeHevy = async (url, opt) => {
  hevyCalls.push(url);
  if (!url.startsWith("https://api.hevyapp.com/v1/")) throw new Error("unexpected " + url);
  if (opt.headers["api-key"] !== "good-key-123456") return new Response("", { status: 401 });
  if (hevyMode === "busy") return new Response("", { status: 429 });
  if (hevyMode === "nothing" && url.includes("/workouts/events")) return Response.json({ error: "Page not found" }, { status: 404 });
  if (url.includes("/user/info")) return Response.json({ data: { id: "u", is_pro: true } });
  const u = new URL(url), page = +u.searchParams.get("page"), since = u.searchParams.get("since");
  if (since !== "1970-01-01T00:00:00Z") return Response.json({ page: 1, page_count: 1, events: [{ type: "deleted", id: "w1" },
    { type: "updated", workout: wk("w99", "2026-10-27T15:00:00Z") }] });
  const all = Array.from({ length: 23 }, (_, i) => ({ type: "updated", workout: wk("w" + i, `2026-09-${String(1 + i).padStart(2, "0")}T15:00:00Z`) }));
  return Response.json({ page, page_count: 3, events: all.slice((page - 1) * 10, page * 10) });
};
const wk = (id, start) => ({ id, title: "Push", description: "private note", routine_id: "r", start_time: start, end_time: start.replace("T15", "T16"),
  exercises: [{ title: "Bench Press (Barbell)", notes: "n", sets: [{ type: "normal", weight_kg: 80, reps: 5, rpe: 8 }] }] });

const env = { DB: d1(), CODE_SINK: (e, c) => { codes[e] = c; }, HEVY_SECRET: Buffer.alloc(32, 7).toString("base64"), FETCH: fakeHevy };
const ctx = { waitUntil: p => p };
async function call(method, path, { body, cookie, origin = ORIGIN, headers = {} } = {}) {
  const h = { ...headers };
  if (origin) h.origin = origin;
  if (cookie) h.cookie = cookie;
  if (body !== undefined) h["content-type"] = "application/json";
  const res = await worker.fetch(new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) }), env, ctx);
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) {}
  return { status: res.status, json, text, headers: res.headers };
}
async function signIn(email) {
  await call("POST", "/api/auth/start", { body: { email } });
  const r = await call("POST", "/api/auth/verify", { body: { email, code: codes[email.toLowerCase()] } });
  return /motus=([^;]+)/.exec(r.headers.get("set-cookie"))[0];
}

section("signing in");
let r = await call("POST", "/api/auth/start", { body: { email: "not an email" } });
check("a bad address is refused", r.status === 400);
r = await call("POST", "/api/auth/start", { body: { email: " Sara@Example.com " } });
check("a code is sent (and never returned)", r.status === 200 && /^\d{6}$/.test(codes["sara@example.com"]) && !r.text.includes(codes["sara@example.com"]));
check("only a hash of the code is stored", env.DB.sql("SELECT code_hash FROM login_codes")[0].code_hash.length === 64 &&
  !JSON.stringify(env.DB.sql("SELECT * FROM login_codes")).includes(codes["sara@example.com"]));
r = await call("POST", "/api/auth/verify", { body: { email: "sara@example.com", code: codes["sara@example.com"] === "000000" ? "111111" : "000000" } });
check("a wrong code is refused", r.status === 400 && /isn't right/.test(r.json.error));
r = await call("POST", "/api/auth/verify", { body: { email: "SARA@example.com", code: codes["sara@example.com"] } });
const setCookie = r.headers.get("set-cookie") || "";
check("the right code signs in with a secure cookie", r.status === 200 && r.json.email === "sara@example.com" && /HttpOnly/.test(setCookie) && /Secure/.test(setCookie) && /SameSite=Lax/.test(setCookie));
const sara = /motus=([^;]+)/.exec(setCookie)[0];
check("only a hash of the session is stored", !JSON.stringify(env.DB.sql("SELECT * FROM sessions")).includes(sara.slice(6)));
r = await call("POST", "/api/auth/verify", { body: { email: "sara@example.com", code: codes["sara@example.com"] } });
check("a code works once", r.status === 400);
r = await call("GET", "/api/me", { cookie: sara });
check("signed in: /api/me", r.status === 200 && r.json.email === "sara@example.com" && r.json.hevy.connected === false);
check("not signed in: 401", (await call("GET", "/api/me")).status === 401 && (await call("GET", "/api/me", { cookie: "motus=" + "x".repeat(43) })).status === 401);
r = await call("PUT", "/api/sources/apple", { cookie: sara, origin: "https://evil.example", body: { days: {} } });
check("changes from another site are refused", r.status === 403);
r = await call("PUT", "/api/sources/apple", { cookie: sara, origin: null, body: { days: {} } });
check("…and so are changes without an Origin", r.status === 403);
await call("POST", "/api/auth/start", { body: { email: "brute@example.com" } });
for (let i = 0; i < 5; i++) await call("POST", "/api/auth/verify", { body: { email: "brute@example.com", code: "12345" + i } });
r = await call("POST", "/api/auth/verify", { body: { email: "brute@example.com", code: codes["brute@example.com"] } });
check("after 5 wrong codes even the right one is refused", r.status === 429);
for (let i = 0; i < 4; i++) await call("POST", "/api/auth/start", { body: { email: "brute@example.com" } });
check("at most 5 codes per address per hour", (await call("POST", "/api/auth/start", { body: { email: "brute@example.com" } })).status === 429);
env.DB.sql("UPDATE login_codes SET expires = 1");
await call("POST", "/api/auth/start", { body: { email: "late@example.com" } });
env.DB.sql("UPDATE login_codes SET expires = 1 WHERE email = 'late@example.com'");
check("an expired code is refused", (await call("POST", "/api/auth/verify", { body: { email: "late@example.com", code: codes["late@example.com"] } })).status === 400);

section("sources from a device");
r = await call("PUT", "/api/sources/apple", { cookie: sara, body: { days: { "2026-10-20": { steps: 9000, weight_kg: 80.1 }, "bad": { steps: 1 } } } });
check("an import is saved", r.status === 200);
await call("PUT", "/api/sources/apple", { cookie: sara, body: { days: { "2026-10-21": { steps: 5000, evil: "<x>" } } } });
r = await call("GET", "/api/data", { cookie: sara });
const apple = r.json.sources.apple.data.days;
check("merged, cleaned, only valid dates", apple["2026-10-20"].steps === 9000 && apple["2026-10-21"].steps === 5000 && !apple.bad && !("evil" in apple["2026-10-21"]));
check("unknown and server-only sources can't be written", (await call("PUT", "/api/sources/health", { cookie: sara, body: { days: {} } })).status === 404 &&
  (await call("PUT", "/api/sources/xyz", { cookie: sara, body: { days: {} } })).status === 404);
const etag = r.headers.get("etag");
r = await call("GET", "/api/data", { cookie: sara, headers: { "if-none-match": etag } });
check("unchanged data: 304, nothing sent", r.status === 304 && r.text === "");
await call("PUT", "/api/sources/manual", { cookie: sara, body: { days: { "2026-10-22": { weight_kg: 79.9 } } } });
r = await call("GET", "/api/data", { cookie: sara, headers: { "if-none-match": etag } });
check("changed data: sent again", r.status === 200 && r.json.sources.manual.data.days["2026-10-22"].weight_kg === 79.9);
const tom = await signIn("tom@example.com");
r = await call("GET", "/api/data", { cookie: tom });
check("one person never sees another's data", r.status === 200 && Object.keys(r.json.sources).length === 0);

section("Apple Health through the Shortcut");
r = await call("POST", "/api/health", { cookie: sara });
const shortcutToken = r.json.token;
check("a Shortcut token and where to send", /^mh_[\w-]{43}$/.test(shortcutToken) && r.json.url === ORIGIN + "/api/upload");
const up = (body, t = shortcutToken) => call("POST", "/api/upload", { origin: null, body, headers: t ? { authorization: "Bearer " + t } : {} });
r = await up({ v: 1,
  steps: "2026-10-26|7,345\n٢٠٢٦-١٠-٢٧|١٥٢٠",
  calories: "2026-10-26|1876.4",
  weight: "2026-10-27 07:10|171.3|lb\n2026-10-27 06:00|200|lb",
  sleep: ["2026-10-26 23:00|2026-10-26 23:50|Core|Watch", "2026-10-26 23:50|2026-10-27 02:00|Deep|Watch", "2026-10-27 02:00|2026-10-27 06:00|REM|Watch",
          "2026-10-26 22:30|2026-10-27 06:30|In Bed|iPhone", "2026-10-26 23:10|2026-10-27 05:40|Asleep|AutoSleep"].join("\n") });
check("the Shortcut's upload is accepted (no cookie, no Origin needed)", r.status === 200 && r.json.days === 2, r.text);
let health = (await call("GET", "/api/data", { cookie: sara })).json.sources.health.data.days;
check("steps per day, incl. Arabic digits and a thousands comma", health["2026-10-26"].steps === 7345 && health["2026-10-27"].steps === 1520);
check("weight: the day's last reading, lb -> kg", health["2026-10-27"].weight_kg === 77.7);
check("sleep: asleep only, whole night on the wake-up day, busiest source", health["2026-10-27"].sleep_hours === 7 && !health["2026-10-26"].sleep_hours);
check("no token / wrong token: refused", (await up({ v: 1, steps: "2026-10-26|1" }, null)).status === 401 && (await up({ v: 1, steps: "2026-10-26|1" }, "mh_" + "A".repeat(43))).status === 401);
check("nothing readable: refused", (await up({ hello: 1 })).status === 400 && (await up("{not json")).status === 400);
r = await up({ days: { "2026-10-28": { steps: 300 } } });
check("plain daily numbers work too", r.status === 200);
r = await up({ v: "3", active: "" });
const r2 = await up({ v: "3", steps: "2026-10-27|5000|1\n2026-10-27|6100|2" });
health = (await call("GET", "/api/data", { cookie: sara })).json.sources.health.data.days;
check("v3 parts: an empty part is fine, and a steps-only part keeps the day's other numbers",
  r.status === 200 && r.json.days === 0 && r2.status === 200 && health["2026-10-27"].steps === 6100 && health["2026-10-27"].weight_kg === 77.7, r.text);
const b64 = Buffer.from(JSON.stringify({ stepCount: [{ date: "2026-10-29", value: 4000 }] })).toString("base64");
check("…and Health Exporter JSON as Base64", (await up({ health_b64: b64 })).status === 200);
r = await call("GET", "/api/me", { cookie: sara });
check("/api/me shows when the Shortcut last sent", r.json.health.connected && r.json.health.last_upload > 0);
const second = (await call("POST", "/api/health", { cookie: sara })).json.token;
check("setting up again replaces the old Shortcut token", (await up({ days: { "2026-10-28": { steps: 1 } } })).status === 401 &&
  (await up({ days: { "2026-10-28": { steps: 301 } } }, second)).status === 200);
await call("DELETE", "/api/health", { cookie: sara });
r = await call("GET", "/api/data", { cookie: sara });
check("disconnecting removes the token and that data", !r.json.sources.health && (await up({ days: {} }, second)).status === 401);

section("Hevy");
r = await call("POST", "/api/hevy", { cookie: sara, body: { key: "wrong-key-123456" } });
check("a key Hevy rejects: clear message, nothing saved", r.status === 400 && /didn't accept/.test(r.json.error) && env.DB.sql("SELECT * FROM hevy").length === 0);
hevyCalls = [];
r = await call("POST", "/api/hevy", { cookie: sara, body: { key: "good-key-123456" } });
check("a good key: checked, then the first pages fetched", r.status === 200 && r.json.done === true && hevyCalls[0].includes("/user/info"));
check("the key is stored encrypted", !JSON.stringify(env.DB.sql("SELECT * FROM hevy")).includes("good-key-123456"));
let d = (await call("GET", "/api/data", { cookie: sara })).json;
check("every workout stored, trimmed (no notes or descriptions)", d.workouts.length === 23 && !JSON.stringify(d.workouts).includes("private note") &&
  !("rpe" in d.workouts[0].exercises[0].sets[0]) && d.me.hevy.connected && !d.me.hevy.error);
r = await call("POST", "/api/hevy/sync", { cookie: sara });
d = (await call("GET", "/api/data", { cookie: sara })).json;
check("next sync asks only for changes since the last one: a delete and a new workout", r.json.done && d.workouts.length === 23 &&
  !d.workouts.some(w => w.id === "w1") && d.workouts.some(w => w.id === "w99"));
hevyMode = "nothing";
r = await call("POST", "/api/hevy/sync", { cookie: sara });
check("no new changes (Hevy answers 404): done, no error, workouts kept", r.status === 200 && r.json.done &&
  !(await call("GET", "/api/me", { cookie: sara })).json.hevy.error && (await call("GET", "/api/data", { cookie: sara })).json.workouts.length === 23);
hevyMode = "ok";
env.DB.sql("UPDATE hevy SET since = NULL, next_page = NULL");
env.SYNC_USERS_PER_RUN = "5";
const { PAGES_PER_STEP } = await import("../worker/hevy.js");
hevyMode = "busy";
await background(env, fakeHevy);
check("Hevy busy in the background: error noted, same page kept for next time", env.DB.sql("SELECT error, next_page FROM hevy")[0].next_page === 1 &&
  /busy/.test(env.DB.sql("SELECT error FROM hevy")[0].error));
hevyMode = "ok";
await background(env, fakeHevy);
check("the background sync picks it up again and finishes", env.DB.sql("SELECT error, next_page FROM hevy")[0].next_page === null && !env.DB.sql("SELECT error FROM hevy")[0].error && PAGES_PER_STEP >= 3);
await call("DELETE", "/api/hevy", { cookie: sara });
check("disconnecting Hevy removes the key and the workouts", env.DB.sql("SELECT * FROM hevy").length === 0 && (await call("GET", "/api/data", { cookie: sara })).json.workouts.length === 0);

section("profile");
r = await call("GET", "/api/profile", { cookie: sara });
check("a new account has an empty profile", r.status === 200 && r.json.name === null && r.json.username === null && r.json.avatar === null);
r = await call("PUT", "/api/profile", { cookie: sara, body: { name: "  Sara   R ", username: "@Sara.R" } });
check("name and username saved: spaces tidied, @ dropped, lower case", r.status === 200 && r.json.name === "Sara R" && r.json.username === "sara.r", r.text);
const badNames = ["ab", "_sara", "sara_", "sa..ra", "sa ra", "سارة", "x".repeat(21)];
const bad = await Promise.all(badNames.map(u => call("PUT", "/api/profile", { cookie: sara, body: { username: u } })));
check("usernames that aren't 3-20 letters, numbers, dots or underscores are refused", bad.every(x => x.status === 400), bad.map(x => x.status).join());
check("reserved and taken usernames: 409, the case doesn't matter", (await call("PUT", "/api/profile", { cookie: tom, body: { username: "admin" } })).status === 409 &&
  (await call("PUT", "/api/profile", { cookie: tom, body: { username: "SARA.R" } })).status === 409);
check("a name over 60 characters is refused", (await call("PUT", "/api/profile", { cookie: sara, body: { name: "n".repeat(61) } })).status === 400);
const PHOTO = "data:image/jpeg;base64," + Buffer.alloc(3000, 1).toString("base64");
r = await call("PUT", "/api/profile", { cookie: sara, body: { avatar: PHOTO } });
check("a photo is saved, and fields left out stay as they were", r.status === 200 && r.json.avatar === PHOTO && r.json.username === "sara.r" && r.json.name === "Sara R");
check("a photo that isn't an image, or is too big, is refused",
  (await call("PUT", "/api/profile", { cookie: sara, body: { avatar: "data:text/html;base64,PHNjcmlwdD4=" } })).status === 400 &&
  (await call("PUT", "/api/profile", { cookie: sara, body: { avatar: "javascript:alert(1)" } })).status === 400 &&
  (await call("PUT", "/api/profile", { cookie: sara, body: { avatar: "data:image/png;base64," + "A".repeat(80_000) } })).status === 400);
r = await call("GET", "/api/me", { cookie: sara });
check("/api/me carries the name, username and whether there's a photo (not the photo)", r.json.profile.name === "Sara R" &&
  r.json.profile.username === "sara.r" && r.json.profile.photo === true && !r.text.includes("base64"));
r = await call("GET", "/api/u/Sara.R", { origin: null });
check("anyone can look up a username: name, username and photo only", r.status === 200 &&
  JSON.stringify(Object.keys(r.json).sort()) === '["avatar","name","username"]' && r.json.avatar === PHOTO && !r.text.includes("sara@example.com"));
check("an unknown or malformed username: 404", (await call("GET", "/api/u/nobody.here", { origin: null })).status === 404 &&
  (await call("GET", "/api/u/%3Cscript%3E", { origin: null })).status === 404);
check("a profile can't be changed from another site", (await call("PUT", "/api/profile", { cookie: sara, origin: "https://evil.test", body: { name: "x" } })).status === 403 &&
  (await call("PUT", "/api/profile", { body: { name: "x" } })).status === 401);
r = await call("PUT", "/api/profile", { cookie: sara, body: { username: "", avatar: null } });
check("clearing the username takes the public page down; the name stays", r.json.username === null && r.json.avatar === null && r.json.name === "Sara R" &&
  (await call("GET", "/api/u/sara.r", { origin: null })).status === 404);
check("…and frees the username for someone else", (await call("PUT", "/api/profile", { cookie: tom, body: { username: "sara.r" } })).status === 200 &&
  (await call("PUT", "/api/profile", { cookie: sara, body: { username: "sara" } })).status === 200);
env.ASSETS = { fetch: req => new Response(new URL(req.url).pathname) };
r = await call("GET", "/u/sara", { origin: null });
check("/u/<username> serves the public profile page", r.status === 200 && r.text === "/user");
delete env.ASSETS;

section("Android through Health Connect");
r = await call("POST", "/api/android", { cookie: sara });
const hcToken = r.json.token, set = r.json.settings, hook = set.webhookConfigs[0];
check("a Health Connect token and where to send", /^mc_[\w-]{43}$/.test(hcToken) && r.json.url === ORIGIN + "/api/upload/hc");
check("HC Webhook's settings file: Motus's address, the token as a header, hourly, daily totals",
  hook.url === r.json.url && hook.headers.Authorization === "Bearer " + hcToken && hook.isEnabled && hook.deliveryFormat === "JSON" &&
  set.enabledDataTypes.join() === "STEPS,ACTIVE_CALORIES,NUTRITION,WEIGHT,SLEEP" && set.syncMode === "INTERVAL" && set.syncIntervalMinutes === 60 &&
  set.dataTypeResolutions.STEPS === -1 && set.dataTypeResolutions.ACTIVE_CALORIES === -1 && set.dataTypeResolutions.NUTRITION === -1 && !set.localTcpEnabled);
check("only a hash of the token is stored", env.DB.sql("SELECT token_hash FROM upload_tokens").every(t => t.token_hash.startsWith("hc:") && !t.token_hash.includes(hcToken)));
const hc = (body, t = hcToken) => call("POST", "/api/upload/hc", { origin: null, body, headers: t ? { authorization: "Bearer " + t } : {} });
// a phone in Riyadh (UTC+3); HC Webhook sends instants in UTC. Its first sync: the last 48 hours, to 28 Oct 14:00.
const Z = "Asia/Riyadh";
r = await hc({ timezone: Z, timestamp: "2026-10-28T11:00:00Z",
  steps: [{ count: 3000, start_time: "2026-10-26T11:00:00Z", end_time: "2026-10-26T21:00:00Z" },      // 26 Oct from 14:00 only
          { count: 9100, start_time: "2026-10-26T21:00:00Z", end_time: "2026-10-27T21:00:00Z" },      // all of 27 Oct
          { count: 4491, start_time: "2026-10-27T21:00:00Z", end_time: "2026-10-28T11:00:00Z" }],     // 28 Oct so far
  active_calories: [{ calories: 411.4, start_time: "2026-10-27T21:00:00Z", end_time: "2026-10-28T11:00:00Z" }],
  nutrition: [{ calories: 1850, start_time: "2026-10-27T21:00:00Z", end_time: "2026-10-28T11:00:00Z" }],
  weight: [{ kilograms: 80.4, time: "2026-10-28T03:10:00Z" }, { kilograms: 80.12, time: "2026-10-28T04:30:00Z" }],
  sleep: [{ session_end_time: "2026-10-28T03:30:00Z", duration_seconds: 25200, stages: [
    { stage: "4", start_time: "2026-10-27T20:30:00Z", end_time: "2026-10-28T00:00:00Z" },               // light 3.5 h
    { stage: "1", start_time: "2026-10-28T00:00:00Z", end_time: "2026-10-28T00:15:00Z" },               // awake
    { stage: "5", start_time: "2026-10-28T00:15:00Z", end_time: "2026-10-28T02:00:00Z" },               // deep 1.75 h
    { stage: "6", start_time: "2026-10-28T02:00:00Z", end_time: "2026-10-28T03:30:00Z" }] }] });        // REM 1.5 h
let hcDays = (await call("GET", "/api/data", { cookie: sara })).json.sources.hc;
hcDays = hcDays && hcDays.data.days;
check("HC Webhook's upload is accepted (no cookie, no Origin needed)", r.status === 200 && r.json.days === 2, r.text);
check("days in the phone's own time zone: steps, active energy, food, the last weight", hcDays["2026-10-27"].steps === 9100 &&
  hcDays["2026-10-28"].steps === 4491 && hcDays["2026-10-28"].active_kcal === 411 && hcDays["2026-10-28"].calories === 1850 && hcDays["2026-10-28"].weight_kg === 80.1,
  JSON.stringify(hcDays));
check("sleep: the asleep stages, on the morning you wake up (6.75 h)", hcDays["2026-10-28"].sleep_hours === 6.75 && !hcDays["2026-10-27"].sleep_hours);
check("the part-day at the start of the 48 hours isn't taken for a whole day", !hcDays["2026-10-26"]);
// the next day's sync: 27 Oct is now the part-day, and a nap is the only new sleep
await hc({ timezone: Z, steps: [{ count: 2000, start_time: "2026-10-27T11:00:00Z", end_time: "2026-10-27T21:00:00Z" },
                               { count: 8200, start_time: "2026-10-27T21:00:00Z", end_time: "2026-10-28T21:00:00Z" }],
           sleep: [{ session_end_time: "2026-10-28T11:00:00Z", duration_seconds: 3600, stages: [] }] });
hcDays = (await call("GET", "/api/data", { cookie: sara })).json.sources.hc.data.days;
check("a later sync: the finished day is updated, the earlier full day is kept, a nap doesn't replace the night",
  hcDays["2026-10-28"].steps === 8200 && hcDays["2026-10-27"].steps === 9100 && hcDays["2026-10-28"].sleep_hours === 6.75 && hcDays["2026-10-28"].calories === 1850,
  JSON.stringify(hcDays));
r = await call("GET", "/api/me", { cookie: sara });
check("/api/me shows when the phone last sent, apart from Apple Health", r.json.android.connected && r.json.android.last_upload > 0 && !r.json.health.connected);
check("no token, a wrong one, or a Shortcut token: refused", (await hc({ steps: [] }, null)).status === 401 &&
  (await hc({ steps: [] }, "mc_" + "A".repeat(43))).status === 401 && (await hc({ steps: [] }, shortcutToken)).status === 401 &&
  (await up({ days: {} }, hcToken)).status === 401);
check("not JSON: refused; nothing new (empty lists): fine", (await hc("{not json")).status === 400 && (await hc({ steps: [], sleep: [] })).json.days === 0);
const apple2 = (await call("POST", "/api/health", { cookie: sara })).json.token;
await call("DELETE", "/api/health", { cookie: sara });
check("setting up or disconnecting Apple Health leaves Android alone", !!apple2 && (await hc({ steps: [] })).status === 200 &&
  !!(await call("GET", "/api/data", { cookie: sara })).json.sources.hc);
const hc2 = (await call("POST", "/api/android", { cookie: sara })).json.token;
check("setting up Android again replaces the old token", (await hc({ steps: [] })).status === 401 && (await hc({ steps: [] }, hc2)).status === 200);
await call("DELETE", "/api/android", { cookie: sara });
r = await call("GET", "/api/data", { cookie: sara });
check("disconnecting removes the token and that data", !r.json.sources.hc && (await hc({ steps: [] }, hc2)).status === 401 && !r.json.me.android.connected);

section("signing out and deleting");
await call("POST", "/api/hevy", { cookie: tom, body: { key: "good-key-123456" } });
await call("POST", "/api/health", { cookie: tom });
await call("POST", "/api/android", { cookie: tom });
r = await call("POST", "/api/auth/logout", { cookie: tom });
check("signing out ends the session", /Max-Age=0/.test(r.headers.get("set-cookie")) && (await call("GET", "/api/me", { cookie: tom })).status === 401);
const tom2 = await signIn("tom@example.com");
r = await call("DELETE", "/api/me", { cookie: tom2 });
const left = ["users", "sessions", "upload_tokens", "sources", "hevy", "workouts"].map(t => env.DB.sql(`SELECT COUNT(*) n FROM ${t} WHERE ${t === "users" ? "email" : "user_id"} = ?`, t === "users" ? "tom@example.com" : "x")[0].n);
check("deleting the account removes it and signs out", r.status === 200 && left[0] === 0 && env.DB.sql("SELECT COUNT(*) n FROM hevy")[0].n === 0 &&
  env.DB.sql("SELECT COUNT(*) n FROM upload_tokens")[0].n === 0 && (await call("GET", "/api/me", { cookie: tom2 })).status === 401);
check("…their profile too, which frees the username", env.DB.sql("SELECT COUNT(*) n FROM profiles WHERE username = 'sara.r'")[0].n === 0 &&
  (await call("GET", "/api/u/sara.r", { origin: null })).status === 404);
check("…and nobody else's data", (await call("GET", "/api/data", { cookie: sara })).json.sources.apple !== undefined &&
  (await call("GET", "/api/u/sara", { origin: null })).status === 200);

section("other paths");
check("unknown API path: 404", (await call("GET", "/api/nope", { cookie: sara })).status === 404);
{
  // what the generated Motus Shortcut sends (tools/shortcut/build.mjs): daily totals with units, raw weight and sleep
  const d = readHealthUpload({ v: "1", steps: "2026-10-26|8,123\n2026-10-27|2400", calories: "2026-10-26|7531|kJ\n2026-10-27|1650|kcal",
    active: "2026-10-26|450|kcal", weight: "2026-10-27 07:05|80.9|kg", sleep: "2026-10-26 23:50|2026-10-27 06:30|Core|Apple Watch" });
  check("Shortcut upload with units: kJ converted, totals and sleep read", d["2026-10-26"].steps === 8123 && d["2026-10-26"].calories === 1800 &&
    d["2026-10-27"].calories === 1650 && d["2026-10-26"].active_kcal === 450 && d["2026-10-27"].weight_kg === 80.9 && d["2026-10-27"].sleep_hours === 6.67);
  const { build, toPlist } = await import("../tools/shortcut/build.mjs");
  const wf = build(), acts = wf.WFWorkflowActions, ids = acts.map(a => a.WFWorkflowActionIdentifier);
  const posts = acts.filter(a => a.WFWorkflowActionIdentifier.endsWith("downloadurl")).map(a => a.WFWorkflowActionParameters);
  const post = posts[0];
  const keys = posts.map(p => p.WFJSONValues.Value.WFDictionaryFieldValueItems.map(i => i.WFKey.Value.string).join("+")).join();
  const labels = acts.filter(a => a.WFWorkflowActionIdentifier.endsWith("filter.health.quantity"))
    .map(a => a.WFWorkflowActionParameters.WFContentItemFilter.Value.WFActionParameterFilterTemplates[0].Values.Enumeration.Value);
  const DAY4 = "v+day+device+steps_values+steps_sources+steps_starts+steps_ends+active_values+active_sources+active_units+active_starts";
  const PARTS = "v+calories_days+calories_values+calories_units+weight_starts+weight_values+weight_units+" +
    "sleep_starts+sleep_ends+sleep_values+sleep_sources," + DAY4;
  check("Shortcut sends food, weight and sleep, then each day's steps and energy, in both runs",
    keys === PARTS + "," + PARTS && posts.every(p => p.WFHTTPMethod === "POST"), keys);
  const FIVE = "Dietary Calories,Weight,Sleep,Steps,Active Calories";
  check("Shortcut reads the five Health types, once for the first run and once for daily runs", labels.join() === FIVE + "," + FIVE, labels.join());
  const finds = acts.filter(a => a.WFWorkflowActionIdentifier.endsWith("filter.health.quantity")).map(a => a.WFWorkflowActionParameters);
  const days = finds.map(p => p.WFContentItemFilter.Value.WFActionParameterFilterTemplates[1].Values.Number).join();
  check("first run: 30 days of food, weight and sleep; daily: a week of food and weight, 2 days of sleep",
    days === "30,30,30,31,31,7,7,2,4,4", days);
  const grouped = finds.map(p => (p.WFHKSampleFilteringGroupBy || "-") + (p.WFHKSampleFilteringFillMissing ? "+" : "")).join();
  check("v4: only food is a Shortcuts day total; nothing is limited, and no Source filter anywhere (they don't filter)",
    grouped === "Day+,-,-,-,-,Day+,-,-,-,-" && !finds.some(p => p.WFContentItemLimitEnabled) &&
    !finds.some(p => p.WFContentItemFilter.Value.WFActionParameterFilterTemplates.some(r => r.Property === "Source")), grouped);
  const counts = acts.filter(a => a.WFWorkflowActionIdentifier.endsWith("repeat.count") && a.WFWorkflowActionParameters.WFControlFlowMode === 0)
    .map(a => a.WFWorkflowActionParameters.WFRepeatCount).join();
  const back = acts.filter(a => a.WFWorkflowActionIdentifier.endsWith("adjustdate") && a.WFWorkflowActionParameters.WFAdjustOperation === "Subtract");
  const dayEnds = acts.filter(a => a.WFWorkflowActionIdentifier.endsWith("setvariable") && a.WFWorkflowActionParameters.WFVariableName === "Day End").length;
  const dur = a => a.WFWorkflowActionParameters.WFDuration.Value.Magnitude + " " + a.WFWorkflowActionParameters.WFDuration.Value.Unit;
  check("v4: the first run goes back 30 days, daily runs 3 (today first), a fixed 1 day back each pass (Day End), reading from 3 hours before",
    counts === "30,3" && back.map(dur).join() === "1 days,3 hr,1 days,3 hr" && dayEnds === 4 &&
    !JSON.stringify(acts).includes('"VariableName":"Repeat Index"'), back.map(dur).join());
  const byDay = finds.filter(p => p.WFContentItemFilter.Value.WFActionParameterFilterTemplates.length > 2);
  check("v4: each day's Find: Start Date is between the day's start and the next day's start (the date filter that works)",
    byDay.length === 4 && byDay.every(p => { const r = p.WFContentItemFilter.Value.WFActionParameterFilterTemplates;
      return r.length === 3 && r[2].Operator === 1003 && r[2].Values.Date.Value.OutputName === "Adjusted Date" &&
        r[2].Values.AnotherDate.Value.OutputName === "Adjusted Date" && r[2].Values.Date.Value.OutputUUID !== r[2].Values.AnotherDate.Value.OutputUUID; }));
  const cols = acts.filter(a => a.WFWorkflowActionIdentifier.endsWith("properties.health.quantity") && a.WFWorkflowActionParameters.WFInput.Value.OutputName === "Health Samples")
    .map(a => a.WFWorkflowActionParameters.WFContentItemPropertyName).join();
  const COLS = "Start Date,Value,Unit,Start Date,Value,Unit,Start Date,End Date,Value,Source,Value,Source,Start Date,End Date,Value,Source,Unit,Start Date";
  check("v5.2: food, weight, sleep, steps and energy all as whole-list columns; no Repeat over samples anywhere",
    cols === COLS + "," + COLS && !ids.some(id => id.endsWith("repeat.each")), cols);
  const fmts = acts.filter(a => a.WFWorkflowActionIdentifier.endsWith("format.date") && a.WFWorkflowActionParameters.WFDateFormat === "yyyy-MM-dd HH:mm:ss");
  const phones = acts.filter(a => a.WFWorkflowActionIdentifier.endsWith("getdevicedetails") && a.WFWorkflowActionParameters.WFDeviceDetail === "Device Name");
  check("v5: start times through Format Date given the list as text (the way that worked), and this phone's name sent once per day",
    fmts.length === 12 && fmts.every(a => a.WFWorkflowActionParameters.WFDate.WFSerializationType === "WFTextTokenString") &&
    phones.length === 2 && !JSON.stringify(acts).includes("WFDateFormatVariableAggrandizement"));
  const open = (kind, mode) => ids.filter((id, i) => id.endsWith(kind) && acts[i].WFWorkflowActionParameters.WFControlFlowMode === mode).length;
  check("Shortcut: every If and Repeat is closed", open("conditional", 0) === open("conditional", 2) && open("repeat.each", 0) === 0 &&
    open("repeat.count", 0) === 2 && open("repeat.count", 2) === 2 && open("conditional", 0) === 3 && open("conditional", 1) === 1);
  const uuids = new Set(acts.map(a => a.WFWorkflowActionParameters.UUID).filter(Boolean));
  const refs = [...JSON.stringify(wf).matchAll(/"OutputUUID":"([^"]+)"/g)].map(m => m[1]);
  check("Shortcut: every variable points at an action that exists", refs.length > 20 && refs.every(u => uuids.has(u)));
  check("Shortcut plist is well-formed XML text", /^<\?xml[\s\S]*<\/plist>\n$/.test(toPlist(wf)) && !/[<>]\w*undefined/.test(toPlist(wf)));
}
check("upload reader alone: nothing usable -> error", (() => { try { readHealthUpload({ v: 1 }); return false; } catch (e) { return true; } })());
{
  // an iPhone set to the Hijri (Umm al-Qura) calendar, as the owner's is: 1448-05-17 = 28 Oct 2026
  const h = readHealthUpload({ v: "1", steps: "١٤٤٨-٠٥-١٧|500\n1448-05-10|8120", weight: "1448-05-10 07:00|64|كغ",
    sleep: "1448-05-16 23:00|1448-05-17 06:00|Core|Watch" });
  check("Hijri dates become Gregorian (also with Arabic digits)", h["2026-10-28"].steps === 500 && h["2026-10-21"].steps === 8120 &&
    h["2026-10-21"].weight_kg === 64 && h["2026-10-28"].sleep_hours === 7 && !Object.keys(h).some(k => k < "2000"), JSON.stringify(Object.keys(h)));
  // v2: steps and active energy sample by sample with their source; the busiest source per day wins
  const v2 = readHealthUpload({ v: "2",
    steps: ["2026-10-27 09:00|3000|iPhone", "2026-10-27 18:00|2000|iPhone", "2026-10-27 09:00|4500|Apple Watch", "2026-10-27 18:10|1000|Apple Watch",
            "1448-05-17 08:00|900|iPhone"].join("\n"),
    active: "2026-10-27 09:00|200|kcal|Apple Watch\n2026-10-27 10:00|1255|kJ|Apple Watch\n2026-10-27 09:00|150|kcal|iPhone",
    calories: "2026-10-27|1300|Cal\n2026-10-26|0|Cal" });
  check("v2: iPhone and Watch on the same day aren't added together (Watch 5,500 beats iPhone 5,000)", v2["2026-10-27"].steps === 5500 && v2["2026-10-28"].steps === 900);
  check("v2: active energy per source, kJ converted (200 + 300 beats 150)", v2["2026-10-27"].active_kcal === 500);
  check("v2: food still daily; a filled-in 0 day stays empty", v2["2026-10-27"].calories === 1300 && !(v2["2026-10-26"] && v2["2026-10-26"].calories));
  // v3: a day total per source, numbered by the Shortcut; active energy filled in as 0 for a source that has none
  const v3 = readHealthUpload({ v: "3",
    steps: "2026-10-27|5000|1\n2026-10-27|5500|2\n2026-10-27|4200|3\n1448-05-17|900|1\n\n",
    active: "2026-10-27|300|kcal|1\n2026-10-27|1674|kJ|2\n2026-10-27|0|kcal|3\n2026-10-26|0|kcal|1\n2026-10-26|0|kcal|2",
    calories: "", weight: "", sleep: "" });
  check("v3: the busiest source each day wins (5,500 of 5,000 / 5,500 / 4,200), Hijri day converted", v3["2026-10-27"].steps === 5500 && v3["2026-10-28"].steps === 900);
  const night = readHealthUpload({ v: "3", sleep: ["2026-10-26 23:00|2026-10-27 06:00|Core|", "2026-10-26 23:30|2026-10-27 06:30|Deep|",
    "2026-10-27 01:00|2026-10-27 02:00|REM|"].join("\n") });
  check("sleep with no source from a Watch and a ring on the same night counts the time once (7.5 h, not 15.5 h)",
    night["2026-10-27"].sleep_hours === 7.5, JSON.stringify(night));
  const d4 = readHealthUpload({ v: "4", day: "1448-05-17",
    steps_values: "3000\n2000\n4500\n1000\n150", steps_sources: "Mo’s iPhone\nMo’s iPhone\nMohd’s Apple Watch\nMohd’s Apple Watch\nUltrahuman",
    active_values: "200\n1255\n150", active_sources: "Mohd’s Apple Watch\nMohd’s Apple Watch\niPhone", active_units: "kcal\nkJ\nkcal" });
  check("v4: one Hijri day; each device added up, the busiest counts (Watch 5,500 beats iPhone 5,000 and the ring 150)",
    d4["2026-10-28"].steps === 5500 && Object.keys(d4).join() === "2026-10-28", JSON.stringify(d4));
  check("v4: energy per device with kJ per sample (200 + 300 beats 150); an empty day is empty",
    d4["2026-10-28"].active_kcal === 500 && !Object.keys(readHealthUpload({ v: "4", day: "2026-10-27", steps_values: "", steps_sources: "" })).length);
  {
    // v5: merged like the Health app: quarter hours on the clock, each sample spread over the quarters it spans, and in
    // each quarter only the top source with steps there counts. rows: [steps, source, start, end?]
    const day = (rows, extra = {}) => readHealthUpload({ v: "5", day: "2026-10-28",
      steps_values: rows.map(r => r[0]).join("\n"), steps_sources: rows.map(r => r[1]).join("\n"),
      steps_starts: rows.map(r => "2026-10-28 " + r[2]).join("\n"),
      ...(rows.some(r => r[3]) ? { steps_ends: rows.map(r => r[3] ? "2026-10-28 " + r[3] : "").join("\n") } : {}), ...extra });
    const walk = [[4500, "Mohd’s Apple Watch", "09:00:00", "10:00:00"], [3000, "Mo’s iPhone", "09:05:00", "10:05:00"],
                  [2000, "Mo’s iPhone", "18:00:00", "18:30:00"]];
    check("v5: the same walk counts once, from the Watch; the iPhone counts in the quarters the Watch left empty: its last 5 minutes " +
      "(3,000 × 5/60 = 250) and the evening (4,500 + 250 + 2,000)", day(walk)["2026-10-28"].steps === 6750, JSON.stringify(day(walk)));
    check("v5: quarters are clock quarters: an iPhone reading in the Watch's quarter is dropped, one in the next quarter counts (1,000 + 300)",
      day([[1000, "Apple Watch", "09:00:00", "09:15:00"], [200, "iPhone", "09:10:00"], [300, "iPhone", "09:20:00"]])["2026-10-28"].steps === 1300);
    const huawei = [[300, "iMone", "08:10:00", "08:20:00"], [900, "HUAWEI Health: Global", "08:10:00", "08:40:00"], [200, "HUAWEI Health: Global", "22:00:00"]];
    check("v5: an app (HUAWEI Health) only fills quarters the phone left empty; the phone called iMone is known by `device` " +
      "(150 + 150 from the phone, 300 + 200 from HUAWEI)", day(huawei, { device: "iMone" })["2026-10-28"].steps === 800 &&
      day(huawei)["2026-10-28"].steps === 1100, JSON.stringify(day(huawei, { device: "iMone" })));
    const night = readHealthUpload({ v: "5", day: "2026-10-28", steps_values: "500\n600\n400", steps_sources: "iPhone\niPhone\niPhone",
      steps_starts: "2026-10-27 22:00:00\n2026-10-27 23:30:00\n2026-10-28 23:45:00",
      steps_ends: "2026-10-27 22:30:00\n2026-10-28 00:30:00\n2026-10-29 00:15:00" });
    check("v5: only the day's own quarter hours count: a reading across midnight in part on each day (300 + 200), the evening before not at all",
      night["2026-10-28"].steps === 500, JSON.stringify(night));
    check("v5: entries made in the Health app itself come first",
      day([[5000, "Health", "12:00:00"], [800, "Apple Watch", "12:05:00"]])["2026-10-28"].steps === 5000);
    const bad = day(walk, { steps_starts: "Oct 28, 2026 at 9:00 AM\n\n" });
    check("v5: times that didn't arrive as lines: the busiest source counts, as in v4 (5,000)", bad["2026-10-28"].steps === 5000, JSON.stringify(bad));
    const viaB = day(walk.map(r => r.slice(0, 3)), { steps_starts: "", steps_starts_b: walk.map(r => "2026-10-28 " + r[2]).join("\n") });
    check("v5: without end times (energy, the first v5 Shortcut's steps_starts_b) a reading counts in the quarter it starts in",
      viaB["2026-10-28"].steps === 6500, JSON.stringify(viaB));
    const many = [];
    for (let i = 0; i < 1500; i++) many.push([20 + (i % 30), ["Apple Watch", "iPhone", "Ultrahuman"][i % 3],
      `${String(6 + (i % 16)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00`]);
    day(many);
    const t0 = performance.now(); day(many); const ms = performance.now() - t0;
    console.log(`    (a 1,500-sample day merged in ${ms.toFixed(1)} ms)`);
    check("v5: a busy day (1,500 samples, 3 devices) merges quickly", ms < 20, ms.toFixed(1) + " ms");
  }
  const p5 = readHealthUpload({ v: "5", calories_days: "2026-10-27\n2026-10-26", calories_values: "1300\n0", calories_units: "Cal\nCal",
    weight_starts: "2026-10-27 07:05:00", weight_values: "80.9", weight_units: "kg",
    sleep_starts: "2026-10-26 23:00:00\n2026-10-26 23:30:00", sleep_ends: "2026-10-27 06:00:00\n2026-10-27 06:30:00",
    sleep_values: "Core\nDeep", sleep_sources: "\n" });
  check("v5.2: food, weight and sleep as columns read as before (a filled-in 0 stays empty; two devices' night counted once)",
    p5["2026-10-27"].calories === 1300 && p5["2026-10-27"].weight_kg === 80.9 && p5["2026-10-27"].sleep_hours === 7.5 && !p5["2026-10-26"], JSON.stringify(p5));
  check("v3: active energy per source with kJ (1,674 kJ = 400 kcal beats 300); an all-zero day stays empty",
    v3["2026-10-27"].active_kcal === 400 && !v3["2026-10-26"], JSON.stringify(v3));
  {
    // a first run: 30 days x 2 devices x 150 samples, Hijri dates, must stay well inside the free plan's 10 ms
    const big = [];
    for (let d = 1; d <= 30; d++) for (const src of ["iPhone", "Apple Watch"]) for (let i = 0; i < 150; i++)
      big.push(`1448-04-${String(d).padStart(2, "0")} ${String(6 + (i % 16)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}|${20 + i}|${src}`);
    const payload = { v: "2", steps: big.join("\n"), active: "", calories: "", weight: "", sleep: "" };
    readHealthUpload(payload);                                   // warm up, as a running Worker would be
    const t0 = performance.now(), out = readHealthUpload(payload), ms = performance.now() - t0;
    console.log(`    (9,000 step samples read in ${ms.toFixed(1)} ms)`);
    check("a 30-day first run (9,000 samples) is read quickly", Object.keys(out).length === 30 && ms < 25, ms.toFixed(1) + " ms");
  }
  const b = readHealthUpload({ steps: "2569-10-28|100" });
  check("Thai Buddhist years become Gregorian", b["2026-10-28"].steps === 100);
  check("a month boundary in Hijri lands right (1448-06-01 = 2026-11-11)", readHealthUpload({ steps: "1448-06-01|1" })["2026-11-11"] !== undefined);
}

section("sending the code");
{
  const sent = [], logs = [], realLog = console.log;
  let brevoStatus = 201;
  const mail = { DB: d1(), BREVO_API_KEY: "xkeysib-test", EMAIL_FROM: "Motus <owner@example.com>", HEVY_SECRET: env.HEVY_SECRET,
    FETCH: async (url, opt) => { sent.push({ url, opt }); return new Response(brevoStatus < 300 ? '{"messageId":"x"}' : '{"code":"unauthorized"}', { status: brevoStatus }); } };
  const start = (email, e = mail) => worker.fetch(new Request(ORIGIN + "/api/auth/start", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ email }) }), e, ctx).then(async r => ({ status: r.status, json: await r.json() }));
  r = await start("Lina@Example.com");
  const req = sent[0], b = JSON.parse(req.opt.body);
  check("Brevo: one request to its email API with the key in its header", r.status === 200 && sent.length === 1 && req.url === "https://api.brevo.com/v3/smtp/email" && req.opt.headers["api-key"] === "xkeysib-test");
  check("Brevo: sender from EMAIL_FROM, recipient, a 6-digit code in subject and text", b.sender.name === "Motus" && b.sender.email === "owner@example.com" &&
    b.to[0].email === "lina@example.com" && /^Your Motus code: \d{6}$/.test(b.subject) && b.textContent.includes(b.subject.slice(-6)) && b.textContent.includes("\n\n"));
  console.log = (...a) => logs.push(a.join(" "));
  brevoStatus = 401;
  r = await start("sam@example.com");
  console.log = realLog;
  check("Brevo refusing: a calm message, and the log never holds the address", r.status === 503 && /Couldn't send/.test(r.json.error) &&
    logs.some(l => /brevo refused: 401 unauthorized/.test(l)) && !logs.some(l => l.includes("sam@")));
  r = await start("x@example.com", { ...mail, EMAIL_FROM: undefined, DB: d1() });
  check("Brevo without a sender: says email isn't set up", r.status === 503 && /isn't set up/.test(r.json.error));

  // the owner's Gmail through tools/gmail-sender/Code.gs (comes first when set)
  const calls = [];
  let gmailReply = { ok: true };
  const gmail = { DB: d1(), HEVY_SECRET: env.HEVY_SECRET, GMAIL_SCRIPT_URL: "https://script.google.com/macros/s/TEST/exec", GMAIL_SECRET: "s".repeat(40),
    BREVO_API_KEY: "xkeysib-test", EMAIL_FROM: "Motus <owner@example.com>",
    FETCH: async (url, opt) => { calls.push({ url, opt }); return Response.json(gmailReply); } };
  r = await start("Nour@Example.com", gmail);
  const g = JSON.parse(calls[0].opt.body);
  check("Gmail: used before Brevo, one POST with the secret, the address and a 6-digit code", r.status === 200 && calls.length === 1 &&
    calls[0].url === gmail.GMAIL_SCRIPT_URL && g.secret === gmail.GMAIL_SECRET && g.to === "nour@example.com" && /^\d{6}$/.test(g.code));
  gmailReply = { ok: false, error: "quota" };
  r = await start("omar@example.com", { ...gmail, DB: d1() });
  check("Gmail out of today's quota: says so", r.status === 503 && /all its codes for today/.test(r.json.error));
  gmailReply = { ok: false, error: "forbidden" };
  r = await start("omar@example.com", { ...gmail, DB: d1() });
  check("Gmail refusing (wrong secret): a calm message", r.status === 503 && /Couldn't send/.test(r.json.error));
  const { readFileSync } = await import("node:fs");
  const gs = readFileSync(new URL("../tools/gmail-sender/Code.gs", import.meta.url), "utf8");
  check("the committed Gmail script holds no real secret, and only sends the fixed code email", /var SECRET = 'REPLACE_WITH_SECRET';/.test(gs) &&
    /SECRET\.length < 32/.test(gs) && /\^\\d\{6\}\$/.test(gs) && (gs.match(/MailApp\.sendEmail/g) || []).length === 1);
}

section("people and friends");
{
  const [ana, ben, cai, dee] = await Promise.all(["ana@example.com", "ben@example.com", "cai@example.com", "dee@example.com"].map(signIn));
  const as = c => ({ cookie: c });
  check("asking needs a username of your own", (await call("POST", "/api/friends", { ...as(ana), body: { username: "nobody" } })).status === 409);
  await call("PUT", "/api/profile", { ...as(ana), body: { name: "Ana Lima", username: "ana" } });
  await call("PUT", "/api/profile", { ...as(ben), body: { name: "Ben Ode", username: "ben.o" } });
  await call("PUT", "/api/profile", { ...as(cai), body: { name: "Cai Wu", username: "cai", public: true } });
  await call("PUT", "/api/sources/apple", { ...as(ben), body: { days: { "2026-10-27": { steps: 8100, sleep_hours: 7.2 } } } });
  await call("PUT", "/api/sources/apple", { ...as(cai), body: { days: { "2026-10-27": { steps: 12000 } } } });
  check("profiles are private by default; public can be turned on", (await call("GET", "/api/profile", as(ben))).json.public === false &&
    (await call("GET", "/api/profile", as(cai))).json.public === true);

  r = await call("GET", "/api/people?q=a", as(ana));
  check("search needs 2 characters", r.status === 200 && r.json.people.length === 0);
  r = await call("GET", "/api/people?q=wu", as(ana));
  check("a public profile is found by part of the name", r.json.people.length === 1 && r.json.people[0].username === "cai" && r.json.people[0].relation === "none");
  r = await call("GET", "/api/people?q=ben", as(ana));
  check("a private profile isn't found by part of a name or username", r.json.people.length === 0);
  r = await call("GET", "/api/people?q=@Ben.O", as(ana));
  check("…but is found by its exact username", r.json.people.length === 1 && r.json.people[0].username === "ben.o" && !("email" in r.json.people[0]));
  check("search and people need sign-in", (await call("GET", "/api/people?q=cai")).status === 401 && (await call("GET", "/api/people/cai/data")).status === 401);

  r = await call("GET", "/api/people/ben.o/data", as(ana));
  check("a private dashboard is refused to someone who isn't a friend", r.status === 403 && !r.text.includes("8100"));
  r = await call("GET", "/api/people/ben.o", as(ana));
  check("…their name and photo still show, with canSee false", r.status === 200 && r.json.name === "Ben Ode" && r.json.canSee === false && r.json.relation === "none");
  r = await call("GET", "/api/people/cai/data", as(ana));
  check("a public dashboard: anyone signed in sees the numbers, never the email", r.status === 200 && r.json.sources.apple.data.days["2026-10-27"].steps === 12000 &&
    !r.text.includes("cai@example.com") && !("me" in r.json) && r.json.person.username === "cai");

  r = await call("POST", "/api/friends", { ...as(ana), body: { username: "ben.o" } });
  check("a request is sent", r.status === 200 && r.json.relation === "requested");
  check("…not yet a friend: still private", (await call("GET", "/api/people/ben.o/data", as(ana))).status === 403);
  r = await call("GET", "/api/friends", as(ben));
  check("Ben sees Ana's request waiting", r.json.incoming.length === 1 && r.json.incoming[0].username === "ana" && r.json.friends.length === 0);
  check("only the person asked can accept", (await call("POST", "/api/friends/accept", { ...as(ana), body: { username: "ben.o" } })).status === 409);
  r = await call("POST", "/api/friends/accept", { ...as(ben), body: { username: "ana" } });
  check("Ben accepts: friends", r.status === 200 && r.json.relation === "friend");
  r = await call("GET", "/api/people/ben.o/data", as(ana));
  check("a friend sees the private dashboard", r.status === 200 && r.json.sources.apple.data.days["2026-10-27"].steps === 8100);
  check("…both ways", (await call("GET", "/api/people/ana/data", as(ben))).status === 200);
  check("…but a stranger still can't", (await call("GET", "/api/people/ben.o/data", as(cai))).status === 403);
  r = await call("GET", "/api/people?q=ode", as(ana));
  check("friends find each other by name", r.json.people.length === 1 && r.json.people[0].relation === "friend");
  check("a cross-site request can't add friends", (await call("POST", "/api/friends", { ...as(cai), origin: "https://evil.example", body: { username: "ana" } })).status === 403);

  await call("POST", "/api/friends", { ...as(cai), body: { username: "ana" } });
  r = await call("POST", "/api/friends", { ...as(ana), body: { username: "cai" } });
  check("asking someone who already asked you makes you friends", r.json.relation === "friend" && (await call("GET", "/api/friends", as(cai))).json.friends.length === 1);
  await call("DELETE", "/api/friends/ben.o", as(ana));
  check("removing a friend ends it both ways", (await call("GET", "/api/people/ben.o/data", as(ana))).status === 403 &&
    (await call("GET", "/api/people/ana/data", as(ben))).status === 403);
  await call("POST", "/api/friends", { ...as(ben), body: { username: "cai" } });
  r = await call("DELETE", "/api/friends/ben.o", as(cai));
  check("declining a request removes it", (await call("GET", "/api/friends", as(ben))).json.outgoing.length === 0);
  check("you can't add yourself", (await call("POST", "/api/friends", { ...as(ana), body: { username: "ana" } })).status === 400);
  check("switching to private hides the dashboard from strangers again",
    (await call("PUT", "/api/profile", { ...as(cai), body: { public: false } })).json.public === false && (await call("GET", "/api/people/cai/data", as(dee))).status === 403);

  await call("POST", "/api/friends", { ...as(cai), body: { username: "ben.o" } });
  const caiId = env.DB.sql("SELECT id FROM users WHERE email = ?", "cai@example.com")[0].id;
  await call("DELETE", "/api/me", as(cai));
  const left = ["sharing", "friends", "friend_requests"].map(t => JSON.stringify(env.DB.sql(`SELECT * FROM ${t}`)).includes(caiId));
  check("deleting an account removes its sharing, friendships and requests", !left.some(Boolean) &&
    (await call("GET", "/api/friends", as(ana))).json.friends.length === 0);
}

finish();
