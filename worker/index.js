// The Motus server: a Cloudflare Worker that serves the app (public/, as static assets) and a small API for accounts.
//
//   POST /api/auth/start {email}        email a 6-digit code         POST /api/auth/verify {email, code}   sign in (cookie)
//   POST /api/auth/logout                                            GET  /api/me                          who, what's connected
//   GET  /api/data                      everything (ETag)            DELETE /api/me                        delete the account
//   PUT|DELETE /api/sources/:id         a source imported on a device (manual, apple, mfp, csv, hevy, strong)
//   POST /api/hevy {key} | DELETE       connect / disconnect Hevy    POST /api/hevy/sync                   next sync step
//   POST /api/health | DELETE           new Shortcut token / disconnect Apple Health
//   POST /api/upload                    the Motus Shortcut's daily upload (Authorization: Bearer <Shortcut token>)
//
// Every 30 minutes (cron) Hevy accounts are synced a few at a time and old sign-in codes are cleared.
import { start, verify, logout, sessionUser } from "./auth.js";
import * as hevy from "./hevy.js";
import { mergeSource } from "../public/js/merge.js";
import { readHealthUpload, HIJRI_EXACT, stepCandidates } from "../public/js/health.js";
import { sha256, token, allow, json, fail } from "./util.js";

const DEVICE_SOURCES = ["manual", "apple", "mfp", "csv", "hevy", "strong"];
const MAX_BODY = 3_000_000;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS ? env.ASSETS.fetch(req) : fail(404, "Not found");
    try {
      return await api(req, env, url);
    } catch (e) {
      if (!e.status) console.error(e);
      return fail(e.status || (e.retry ? 503 : 500), e.status || e.retry ? e.message : "Something went wrong on the server.");
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(background(env));
  },
};

async function api(req, env, url) {
  const ip = req.headers.get("cf-connecting-ip") || "local", path = url.pathname, method = req.method;
  if (method === "POST" && path === "/api/upload") return upload(req, env);

  // Everything else runs on the session cookie, so changes must come from Motus's own pages.
  if (method !== "GET" && method !== "HEAD" && req.headers.get("origin") !== url.origin) return fail(403, "Not allowed from another site.");
  if (method === "POST" && path === "/api/auth/start") return start(req, env, ip);
  if (method === "POST" && path === "/api/auth/verify") return verify(req, env, ip);
  if (method === "POST" && path === "/api/auth/logout") return logout(req, env);

  const user = await sessionUser(req, env);
  if (!user) return fail(401, "Sign in first.");
  const fetchFn = env.FETCH || fetch;
  let m;
  if (path === "/api/me" && method === "GET") return json(await me(env, user));
  if (path === "/api/me" && method === "DELETE") return deleteAccount(req, env, user);
  if (path === "/api/data" && method === "GET") return data(req, env, user);
  if ((m = /^\/api\/sources\/([a-z_]+)$/.exec(path)) && DEVICE_SOURCES.includes(m[1])) {
    if (method === "PUT") return putDeviceSource(req, env, user, m[1]);
    if (method === "DELETE") {
      await env.DB.prepare("DELETE FROM sources WHERE user_id = ? AND source = ?").bind(user.id, m[1]).run();
      await touch(env, user.id);
      return json({ ok: true });
    }
  }
  if (path === "/api/hevy" && method === "POST") {
    if (!(await allow(env.DB, "hevy:" + user.id, 20, 3600))) return fail(429, "Too many tries. Wait a little.");
    await hevy.connect(env.DB, env, user.id, (await body(req)).key, fetchFn);
    const r = await hevy.step(env.DB, env, user.id, fetchFn);
    await touch(env, user.id);
    return json(r);
  }
  if (path === "/api/hevy" && method === "DELETE") {
    await hevy.disconnect(env.DB, user.id);
    await touch(env, user.id);
    return json({ ok: true });
  }
  if (path === "/api/hevy/sync" && method === "POST") {
    if (!(await allow(env.DB, "hevysync:" + user.id, 120, 3600))) return fail(429, "Syncing too often. Wait a little.");
    const r = await hevy.step(env.DB, env, user.id, fetchFn);
    if (r.changed) await touch(env, user.id);
    return json(r);
  }
  if (path === "/api/health" && method === "POST") {
    const t = token("mh_");
    await env.DB.batch([
      env.DB.prepare("DELETE FROM upload_tokens WHERE user_id = ?").bind(user.id),     // one Shortcut per person; a new one replaces the old
      env.DB.prepare("INSERT INTO upload_tokens (token_hash, user_id, created) VALUES (?, ?, ?)").bind(await sha256(t), user.id, Date.now()),
    ]);
    return json({ token: t, url: url.origin + "/api/upload" });
  }
  if (path === "/api/health" && method === "DELETE") {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM upload_tokens WHERE user_id = ?").bind(user.id),
      env.DB.prepare("DELETE FROM sources WHERE user_id = ? AND source = 'health'").bind(user.id),
    ]);
    await touch(env, user.id);
    return json({ ok: true });
  }
  return fail(404, "Not found");
}

async function body(req) {
  const text = await req.text();
  if (text.length > MAX_BODY) throw Object.assign(new Error("That's too much data at once."), { status: 413 });
  try { return JSON.parse(text || "{}"); } catch (e) { throw Object.assign(new Error("Expected JSON."), { status: 400 }); }
}

// users.changed only ever goes up; it is the ETag of GET /api/data
const touch = (env, userId) => env.DB.prepare("UPDATE users SET changed = MAX(changed + 1, ?) WHERE id = ?").bind(Date.now(), userId).run();

async function me(env, user) {
  const h = await env.DB.prepare("SELECT synced, error, next_page FROM hevy WHERE user_id = ?").bind(user.id).first();
  const t = await env.DB.prepare("SELECT created, used FROM upload_tokens WHERE user_id = ?").bind(user.id).first();
  return {
    email: user.email,
    hevy: h ? { connected: true, synced: h.synced, error: h.error, syncing: h.next_page != null } : { connected: false },
    health: t ? { connected: true, last_upload: t.used } : { connected: false },
  };
}

// Everything the app needs, built as a string so stored JSON is passed through without re-parsing.
async function data(req, env, user) {
  const etag = `W/"${user.changed}"`;
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag, "cache-control": "no-cache" } });
  const [sources, workouts, status] = await Promise.all([
    env.DB.prepare("SELECT source, data, updated FROM sources WHERE user_id = ?").bind(user.id).all(),
    env.DB.prepare("SELECT data FROM workouts WHERE user_id = ? ORDER BY start_time").bind(user.id).all(),
    me(env, user),
  ]);
  const src = sources.results.map(r => `${JSON.stringify(r.source)}:{"imported":${JSON.stringify(new Date(r.updated).toISOString())},"data":${r.data}}`);
  const text = `{"me":${JSON.stringify(status)},"sources":{${src.join(",")}},"workouts":[${workouts.results.map(r => r.data).join(",")}]}`;
  return new Response(text, { headers: { "content-type": "application/json; charset=utf-8", etag, "cache-control": "no-cache" } });
}

async function mergeInto(env, userId, source, result) {
  const row = await env.DB.prepare("SELECT data FROM sources WHERE user_id = ? AND source = ?").bind(userId, source).first();
  const merged = mergeSource(row ? JSON.parse(row.data) : null, result);
  await env.DB.prepare("INSERT INTO sources (user_id, source, data, updated) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT (user_id, source) DO UPDATE SET data = excluded.data, updated = excluded.updated")
    .bind(userId, source, JSON.stringify(merged), Date.now()).run();
  await touch(env, userId);
  return merged;
}

async function putDeviceSource(req, env, user, source) {
  const b = await body(req);
  if (!b || typeof b.days !== "object") return fail(400, "Expected { days, exercises?, replace? }.");
  await mergeInto(env, user.id, source, { days: b.days, exercises: b.exercises || {}, replace: !!b.replace });
  return json({ ok: true });
}

// The Motus Shortcut's upload. Its token is its only identity: no cookie, no account details.
async function upload(req, env) {
  const m = /^Bearer\s+(mh_[A-Za-z0-9_-]{40,})$/.exec(req.headers.get("authorization") || "");
  if (!m) return fail(401, "Missing or malformed token. Set up Apple Health again in Motus → Connect.");
  const hash = await sha256(m[1]);
  const row = await env.DB.prepare("SELECT user_id FROM upload_tokens WHERE token_hash = ?").bind(hash).first();
  if (!row) return fail(401, "This Shortcut isn't connected any more. Set up Apple Health again in Motus → Connect.");
  // a first run sends a day at a time (30 uploads), so allow a few of those in an hour
  if (!(await allow(env.DB, "upload:" + hash, 200, 3600))) return fail(429, "Too many uploads. Try again later.");
  let days, payload;
  try { payload = await body(req); days = readHealthUpload(payload); } catch (e) { return fail(400, e.message); }
  // Diagnostics while the Shortcut is new: the SHAPE of each field (line count, first line with every digit masked
  // and every letter masked except in units), never the values, dates or device names.
  if (payload && typeof payload === "object") {
    const shape = {};
    for (const k of ["steps", "calories", "active", "weight", "sleep"]) {
      if (!(k in payload)) continue;                     // v3 sends in parts
      if (typeof payload[k] !== "string") { shape[k] = typeof payload[k]; continue; }
      const ls = payload[k].split(/\r?\n/).filter(Boolean), first = (ls[0] || "").split("|");
      // field 2 is a unit, except in v2 steps, where it is a device name: masked then
      const keep = i => k !== "sleep" && i === 2 && !(k === "steps" && +payload.v === 2);
      shape[k] = ls.length + ": " + first.map((f, i) => (keep(i) ? f : f.replace(/[0-9٠-٩]/g, "9").replace(/[^\s9|:.,\-]/g, "a"))).join("|");
      // v3 numbers its device groups: how many sent something, and on how many days with two or more of them every
      // group sent the same number (a filter that doesn't filter). Counts only, no numbers or names.
      if (+payload.v >= 3 && (k === "steps" || k === "active")) {
        const byDay = {};
        for (const l of ls) { const f = l.split("|"); (byDay[f[0]] || (byDay[f[0]] = [])).push(f[1]); }
        const multi = Object.values(byDay).filter(v => v.length > 1);
        shape[k] += ` (${new Set(ls.map(l => l.slice(l.lastIndexOf("|") + 1))).size} groups; alike on ${
          multi.filter(v => new Set(v).size === 1).length}/${multi.length} days)`;
      }
    }
    // v5.2 food, weight and sleep as columns: line counts only
    for (const k of ["calories", "weight", "sleep"]) if (typeof payload[k + "_values"] === "string")
      shape[k] = String(payload[k + "_values"]).split(/\r?\n/).filter(Boolean).length + " lines (columns)";
    // v4, one day: which day, how many samples, whether the columns line up, how many devices (counts only, no names)
    if (+payload.v >= 4) shape.day = String(payload.day || "").slice(0, 10);
    if (+payload.v >= 4) for (const k of ["steps", "active"]) {
      const lines = f => String(payload[k + "_" + f] || "").split(/\r?\n/).filter(Boolean);
      const v = lines("values"), s = lines("sources");
      shape[k] = `${v.length} samples${v.length === s.length ? "" : ` but ${s.length} sources`}, ${new Set(s).size} devices`;
      // v5: whether the start times line up with the samples
      if (+payload.v >= 5) shape[k] += `, ${lines("starts").length || lines("starts_b").length} start times`;
    }
    console.log("upload shape:", JSON.stringify(shape), "| hijri exact:", HIJRI_EXACT);
    // TEMPORARY: candidate step totals for this day (the owner asked for Health's exact numbers)
    if (+payload.v >= 5 && typeof payload.day === "string") console.log("steps", payload.day.slice(0, 10), JSON.stringify(stepCandidates(payload)));
  }
  if (!Object.keys(days).length) {
    // v3 sends in parts; a part with nothing in the window (no energy recorded in 2 days, say) is fine
    if (payload && +payload.v >= 3) return json({ ok: true, days: 0 });
    return fail(400, "No steps, sleep, calories or weight in this upload.");
  }
  await mergeInto(env, row.user_id, "health", { days });
  await env.DB.prepare("UPDATE upload_tokens SET used = ? WHERE token_hash = ?").bind(Date.now(), hash).run();
  return json({ ok: true, days: Object.keys(days).length });
}

async function deleteAccount(req, env, user) {
  const db = env.DB;
  await db.batch(["sessions", "upload_tokens", "sources", "hevy", "workouts"].map(t => db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(user.id))
    .concat([db.prepare("DELETE FROM login_codes WHERE email = ?").bind(user.email), db.prepare("DELETE FROM users WHERE id = ?").bind(user.id)]));
  return json({ ok: true }, 200, { "set-cookie": `motus=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${new URL(req.url).protocol === "https:" ? "; Secure" : ""}` });
}

// Cron: sync the Hevy accounts that waited longest (unfinished syncs first), a few per run; clear old codes and limits.
export async function background(env, fetchFn = env.FETCH || fetch) {
  const n = +env.SYNC_USERS_PER_RUN || 3;
  const due = await env.DB.prepare("SELECT user_id FROM hevy WHERE error IS NULL OR next_page IS NOT NULL " +
    "ORDER BY next_page IS NULL, COALESCE(synced, 0) LIMIT ?").bind(n).all();
  for (const { user_id } of due.results) {
    try { const r = await hevy.step(env.DB, env, user_id, fetchFn); if (r.changed) await touch(env, user_id); }
    catch (e) { console.log("hevy sync failed for a user:", e.message); }
  }
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_codes WHERE expires < ?").bind(now),
    env.DB.prepare("DELETE FROM rate WHERE reset < ?").bind(now),
    env.DB.prepare("DELETE FROM sessions WHERE seen < ?").bind(now - 400 * 24 * 3600e3),
  ]);
}
