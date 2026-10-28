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

section("signing out and deleting");
await call("POST", "/api/hevy", { cookie: tom, body: { key: "good-key-123456" } });
await call("POST", "/api/health", { cookie: tom });
r = await call("POST", "/api/auth/logout", { cookie: tom });
check("signing out ends the session", /Max-Age=0/.test(r.headers.get("set-cookie")) && (await call("GET", "/api/me", { cookie: tom })).status === 401);
const tom2 = await signIn("tom@example.com");
r = await call("DELETE", "/api/me", { cookie: tom2 });
const left = ["users", "sessions", "upload_tokens", "sources", "hevy", "workouts"].map(t => env.DB.sql(`SELECT COUNT(*) n FROM ${t} WHERE ${t === "users" ? "email" : "user_id"} = ?`, t === "users" ? "tom@example.com" : "x")[0].n);
check("deleting the account removes it and signs out", r.status === 200 && left[0] === 0 && env.DB.sql("SELECT COUNT(*) n FROM hevy")[0].n === 0 &&
  env.DB.sql("SELECT COUNT(*) n FROM upload_tokens")[0].n === 0 && (await call("GET", "/api/me", { cookie: tom2 })).status === 401);
check("…and nobody else's data", (await call("GET", "/api/data", { cookie: sara })).json.sources.apple !== undefined);

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
  const post = acts.find(a => a.WFWorkflowActionIdentifier.endsWith("downloadurl")).WFWorkflowActionParameters;
  const keys = post.WFJSONValues.Value.WFDictionaryFieldValueItems.map(i => i.WFKey.Value.string);
  const labels = acts.filter(a => a.WFWorkflowActionIdentifier.endsWith("filter.health.quantity"))
    .map(a => a.WFWorkflowActionParameters.WFContentItemFilter.Value.WFActionParameterFilterTemplates[0].Values.Enumeration.Value);
  check("Shortcut sends exactly the fields the server reads", keys.join() === "v,steps,calories,active,weight,sleep" && post.WFHTTPMethod === "POST");
  check("Shortcut reads the five Health types", labels.join() === "Steps,Dietary Calories,Active Calories,Weight,Sleep");
  const open = (kind, mode) => ids.filter((id, i) => id.endsWith(kind) && acts[i].WFWorkflowActionParameters.WFControlFlowMode === mode).length;
  check("Shortcut: every If and Repeat is closed", open("conditional", 0) === open("conditional", 2) && open("repeat.each", 0) === open("repeat.each", 2) && open("repeat.each", 0) === 5);
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

finish();
