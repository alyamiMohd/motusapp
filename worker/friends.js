// People and friends. Someone's dashboard (their numbers and workouts) can be seen by themselves, by their friends,
// and, when they made their profile public, by everyone signed in to Motus. Never their email or connections.
// Friends: a request by username, which the other person accepts; either can remove the friendship any time.
// People are found by username or name: public profiles by any part of either, private ones only by their exact
// username (so a private person can still be added by someone they gave it to).
import { json, fail } from "./util.js";
import { USERNAME } from "./profile.js";

const PERSON = "p.user_id, p.name, p.username, p.avatar, COALESCE(s.public, 0) AS public";
const FROM = "profiles p LEFT JOIN sharing s ON s.user_id = p.user_id";
// a request, a new friend or one removed: both people's pages refresh (users.changed is the ETag of /api/data,
// which also carries the count of people asking, shown as a dot on the profile button)
const touch = (env, ...ids) => env.DB.batch(ids.map(id => env.DB.prepare("UPDATE users SET changed = MAX(changed + 1, ?) WHERE id = ?").bind(Date.now(), id)));
const show = r => ({ username: r.username, name: r.name, avatar: r.avatar, public: !!r.public });

async function byUsername(env, username) {
  const u = String(username || "").trim().replace(/^@/, "").toLowerCase();
  if (!USERNAME.test(u)) return null;
  return env.DB.prepare(`SELECT ${PERSON} FROM ${FROM} WHERE p.username = ?`).bind(u).first();
}

// "self" | "friend" | "requested" (I asked them) | "incoming" (they asked me) | "none"
export async function relation(env, meId, otherId) {
  if (meId === otherId) return "self";
  const [f, out, inc] = await Promise.all([
    env.DB.prepare("SELECT 1 AS x FROM friends WHERE user_id = ? AND friend_id = ?").bind(meId, otherId).first(),
    env.DB.prepare("SELECT 1 AS x FROM friend_requests WHERE from_id = ? AND to_id = ?").bind(meId, otherId).first(),
    env.DB.prepare("SELECT 1 AS x FROM friend_requests WHERE from_id = ? AND to_id = ?").bind(otherId, meId).first(),
  ]);
  return f ? "friend" : out ? "requested" : inc ? "incoming" : "none";
}
const canSee = (rel, person) => rel === "self" || rel === "friend" || !!person.public;

async function myUsername(env, meId) {
  const p = await env.DB.prepare("SELECT username FROM profiles WHERE user_id = ?").bind(meId).first();
  return p && p.username;
}

// GET /api/friends: my friends, requests waiting for me, requests I sent
export async function list(env, meId) {
  const q = sql => env.DB.prepare(`SELECT ${PERSON} FROM ${FROM} ${sql} ORDER BY COALESCE(p.name, p.username) COLLATE NOCASE`).bind(meId).all();
  const [friends, incoming, outgoing] = await Promise.all([
    q("JOIN friends f ON f.friend_id = p.user_id WHERE f.user_id = ?"),
    q("JOIN friend_requests r ON r.from_id = p.user_id WHERE r.to_id = ?"),
    q("JOIN friend_requests r ON r.to_id = p.user_id WHERE r.from_id = ?"),
  ]);
  return json({ username: await myUsername(env, meId), friends: friends.results.map(show),
    incoming: incoming.results.map(show), outgoing: outgoing.results.map(show) });
}

// GET /api/people?q=: up to 20 people, each with how they relate to me
export async function search(env, meId, query) {
  const q = String(query || "").trim().replace(/^@/, "").toLowerCase().slice(0, 40);
  if (q.length < 2) return json({ people: [] });
  const like = "%" + q.replace(/[\\%_]/g, c => "\\" + c) + "%";
  const rows = (await env.DB.prepare(`SELECT ${PERSON} FROM ${FROM} WHERE p.user_id != ? AND p.username IS NOT NULL AND (p.username = ? OR ` +
    `(COALESCE(s.public, 0) = 1 OR p.user_id IN (SELECT friend_id FROM friends WHERE user_id = ?)) AND ` +
    `(p.username LIKE ? ESCAPE '\\' OR LOWER(p.name) LIKE ? ESCAPE '\\')) ORDER BY p.username = ? DESC, p.username LIMIT 20`)
    .bind(meId, q, meId, like, like, q).all()).results;
  const people = await Promise.all(rows.map(async r => ({ ...show(r), relation: await relation(env, meId, r.user_id) })));
  return json({ people });
}

// GET /api/people/:username: their profile, how they relate to me, and whether I can see their dashboard
export async function person(env, meId, username) {
  const p = await byUsername(env, username);
  if (!p) return fail(404, "There's no one on Motus with that username.");
  const rel = await relation(env, meId, p.user_id);
  return json({ ...show(p), relation: rel, canSee: canSee(rel, p) });
}

// GET /api/people/:username/data: their dashboard, the same shape as /api/data without "me"
export async function dashboard(env, meId, username) {
  const p = await byUsername(env, username);
  if (!p) return fail(404, "There's no one on Motus with that username.");
  const rel = await relation(env, meId, p.user_id);
  if (!canSee(rel, p)) return fail(403, "This dashboard is private. Add them as a friend to see it.");
  const [sources, workouts] = await Promise.all([
    env.DB.prepare("SELECT source, data, updated FROM sources WHERE user_id = ?").bind(p.user_id).all(),
    env.DB.prepare("SELECT data FROM workouts WHERE user_id = ? ORDER BY start_time").bind(p.user_id).all(),
  ]);
  const src = sources.results.map(r => `${JSON.stringify(r.source)}:{"imported":${JSON.stringify(new Date(r.updated).toISOString())},"data":${r.data}}`);
  const text = `{"person":${JSON.stringify({ ...show(p), relation: rel })},"sources":{${src.join(",")}},"workouts":[${workouts.results.map(r => r.data).join(",")}]}`;
  return new Response(text, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" } });
}

// POST /api/friends {username}: ask to be friends; if they already asked me, we're friends now
export async function request(env, meId, username) {
  if (!(await myUsername(env, meId))) return fail(409, "Pick a username on your Profile first, so people know who's asking.");
  const p = await byUsername(env, username);
  if (!p) return fail(404, "There's no one on Motus with that username.");
  const rel = await relation(env, meId, p.user_id);
  if (rel === "self") return fail(400, "That's you.");
  if (rel === "incoming") return accept(env, meId, p.username);
  if (rel === "none") {
    await env.DB.prepare("INSERT OR IGNORE INTO friend_requests (from_id, to_id, created) VALUES (?, ?, ?)").bind(meId, p.user_id, Date.now()).run();
    await touch(env, meId, p.user_id);
  }
  return json({ ...show(p), relation: rel === "none" ? "requested" : rel });
}

// POST /api/friends/accept {username}: accept their request
export async function accept(env, meId, username) {
  const p = await byUsername(env, username);
  if (!p) return fail(404, "There's no one on Motus with that username.");
  if ((await relation(env, meId, p.user_id)) !== "incoming") return fail(409, "There's no request from them to accept.");
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO friends (user_id, friend_id, since) VALUES (?, ?, ?)").bind(meId, p.user_id, now),
    env.DB.prepare("INSERT OR IGNORE INTO friends (user_id, friend_id, since) VALUES (?, ?, ?)").bind(p.user_id, meId, now),
    env.DB.prepare("DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)").bind(p.user_id, meId, meId, p.user_id),
  ]);
  await touch(env, meId, p.user_id);
  return json({ ...show(p), relation: "friend" });
}

// DELETE /api/friends/:username: remove a friend, cancel my request or decline theirs
export async function remove(env, meId, username) {
  const p = await byUsername(env, username);
  if (!p) return fail(404, "There's no one on Motus with that username.");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)").bind(meId, p.user_id, p.user_id, meId),
    env.DB.prepare("DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)").bind(meId, p.user_id, p.user_id, meId),
  ]);
  await touch(env, meId, p.user_id);
  return json({ ...show(p), relation: "none" });
}

// when an account is deleted
export const forget = (env, userId) => [
  env.DB.prepare("DELETE FROM sharing WHERE user_id = ?").bind(userId),
  env.DB.prepare("DELETE FROM friends WHERE user_id = ? OR friend_id = ?").bind(userId, userId),
  env.DB.prepare("DELETE FROM friend_requests WHERE from_id = ? OR to_id = ?").bind(userId, userId),
];
