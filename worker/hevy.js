// Hevy on the server: the key is checked once, kept encrypted, and used to fetch workout changes in the background
// (Hevy's /v1/workouts/events: everything changed or deleted since a time). Work is done a few pages at a time so
// no single request or scheduled run does too much; a sync in progress carries on where it stopped.
import { seal, unseal } from "./util.js";

const API = "https://api.hevyapp.com/v1";
export const PAGES_PER_STEP = 5;
// HEVY_API is set only in a local .dev.vars, to try the whole flow against tests/mock_hevy.mjs
const base = env => env.HEVY_API || API;

async function hevyGet(path, key, fetchFn = fetch, root = API) {
  const res = await fetchFn(root + path, { headers: { "api-key": key, accept: "application/json" } });
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error("Hevy didn't accept the key. It needs Hevy Pro; copy it again from Hevy → Settings → Developer."), { status: 400 });
  // Hevy answers 404 for a page past the last one (also seen by the browser importer): nothing more to read
  if (res.status === 404 && path.startsWith("/workouts/events")) return { page_count: 0, events: [] };
  if (res.status === 429) throw Object.assign(new Error("Hevy is busy. Motus will try again shortly."), { retry: true });
  if (!res.ok) throw Object.assign(new Error(`Hevy answered with an error (${res.status}).`), { retry: true });
  return res.json();
}

// Only what Motus uses: no notes, descriptions or ids of other things.
export const trim = w => ({
  id: String(w.id), title: String(w.title || "Workout").slice(0, 80), start_time: w.start_time, end_time: w.end_time,
  exercises: (w.exercises || []).map(e => ({ title: String(e.title || "").slice(0, 80),
    sets: (e.sets || []).map(s => ({ type: s.type, weight_kg: s.weight_kg, reps: s.reps })) })),
});

// POST /api/hevy { key }: check the key with Hevy, then keep it (encrypted) and start from the beginning
export async function connect(db, env, userId, key, fetchFn = fetch) {
  key = String(key || "").trim();
  if (!/^[\w-]{8,100}$/.test(key)) throw Object.assign(new Error("That doesn't look like a Hevy API key."), { status: 400 });
  await hevyGet("/user/info", key, fetchFn, base(env));
  await db.prepare("INSERT INTO hevy (user_id, key_enc, since, next_page, started, synced, error) VALUES (?, ?, NULL, NULL, NULL, NULL, NULL) " +
    "ON CONFLICT (user_id) DO UPDATE SET key_enc = excluded.key_enc, since = NULL, next_page = NULL, started = NULL, error = NULL")
    .bind(userId, await seal(key, env.HEVY_SECRET)).run();
  await db.prepare("DELETE FROM workouts WHERE user_id = ?").bind(userId).run();
}

// One step of syncing: up to PAGES_PER_STEP pages of changes. Returns { done, changed }.
export async function step(db, env, userId, fetchFn = fetch, now = new Date()) {
  const row = await db.prepare("SELECT key_enc, since, next_page, started FROM hevy WHERE user_id = ?").bind(userId).first();
  if (!row) return { done: true, changed: 0 };
  const key = await unseal(row.key_enc, env.HEVY_SECRET);
  const since = row.since || "1970-01-01T00:00:00Z", started = row.started || now.toISOString();
  let page = row.next_page || 1, changed = 0, done = false;
  try {
    for (let n = 0; n < PAGES_PER_STEP; n++, page++) {
      const data = await hevyGet(`/workouts/events?page=${page}&pageSize=10&since=${encodeURIComponent(since)}`, key, fetchFn, base(env));
      const writes = [];
      for (const ev of data.events || []) {
        if (ev.type === "deleted" && ev.id) writes.push(db.prepare("DELETE FROM workouts WHERE user_id = ? AND id = ?").bind(userId, String(ev.id)));
        else if (ev.workout && ev.workout.id && ev.workout.start_time) {
          const w = trim(ev.workout);
          writes.push(db.prepare("INSERT INTO workouts (user_id, id, start_time, data) VALUES (?, ?, ?, ?) " +
            "ON CONFLICT (user_id, id) DO UPDATE SET start_time = excluded.start_time, data = excluded.data")
            .bind(userId, w.id, w.start_time, JSON.stringify(w)));
        }
      }
      if (writes.length) { await db.batch(writes); changed += writes.length; }
      if (page >= (data.page_count || 0) || !(data.events || []).length) { done = true; break; }
    }
  } catch (e) {
    if (e.status === 400) {      // the key stopped working: stop until it is connected again
      await db.prepare("UPDATE hevy SET error = ?, next_page = NULL, started = NULL WHERE user_id = ?").bind(e.message, userId).run();
      return { done: true, changed, error: e.message };
    }
    await db.prepare("UPDATE hevy SET error = ?, next_page = ?, started = ? WHERE user_id = ?").bind(e.message, page, started, userId).run();
    throw e;                     // busy or down: the same page is tried again next time
  }
  if (done) await db.prepare("UPDATE hevy SET since = ?, next_page = NULL, started = NULL, synced = ?, error = NULL WHERE user_id = ?")
    .bind(started, now.getTime(), userId).run();
  else await db.prepare("UPDATE hevy SET next_page = ?, started = ? WHERE user_id = ?").bind(page, started, userId).run();   // the loop already moved past the last page read
  return { done, changed };
}

export async function disconnect(db, userId) {
  await db.batch([db.prepare("DELETE FROM hevy WHERE user_id = ?").bind(userId), db.prepare("DELETE FROM workouts WHERE user_id = ?").bind(userId)]);
}
