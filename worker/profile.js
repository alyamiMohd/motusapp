// Profiles: a name, a username others can be given (…/u/<username>), and a small photo. Nothing in a profile is
// health data, and the public view shows only these three things.
import { json, fail } from "./util.js";

export const USERNAME = /^[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$/;          // 3-20 characters, no dot or underscore at the ends
const RESERVED = new Set(["admin", "api", "app", "help", "me", "motus", "profile", "root", "settings", "support", "team", "www"]);
const AVATAR = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_AVATAR = 80_000;                                        // characters; the page sends about 10-30 KB

export async function get(env, userId) {
  const p = await env.DB.prepare("SELECT p.name, p.username, p.avatar, s.public FROM profiles p LEFT JOIN sharing s ON s.user_id = p.user_id " +
    "WHERE p.user_id = ?").bind(userId).first();
  return { name: p ? p.name : null, username: p ? p.username : null, avatar: p ? p.avatar : null, public: !!(p && p.public) };
}

// {name?, username?, avatar?, public?}: a field left out stays as it is; null or "" clears it.
// public: true lets everyone signed in to Motus see this dashboard; false (the default) only friends.
export async function put(env, userId, b) {
  const cur = await get(env, userId);
  const next = { ...cur };
  if ("public" in b) next.public = b.public === true;
  if ("name" in b) {
    const name = String(b.name ?? "").replace(/\s+/g, " ").trim();
    if (name.length > 60) return fail(400, "That name is too long (60 characters at most).");
    next.name = name || null;
  }
  if ("username" in b) {
    const u = String(b.username ?? "").trim().replace(/^@/, "").toLowerCase();
    if (u && (!USERNAME.test(u) || /[._]{2}/.test(u)))
      return fail(400, "A username is 3 to 20 letters, numbers, dots or underscores, starting and ending with a letter or number.");
    if (RESERVED.has(u)) return fail(409, "That username is taken.");
    next.username = u || null;
  }
  if ("avatar" in b) {
    const a = b.avatar == null ? "" : String(b.avatar);
    if (a && (!AVATAR.test(a) || a.length > MAX_AVATAR)) return fail(400, "That photo is too big or isn't an image.");
    next.avatar = a || null;
  }
  try {
    await env.DB.prepare("INSERT INTO profiles (user_id, name, username, avatar, updated) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT (user_id) DO UPDATE SET name = excluded.name, username = excluded.username, avatar = excluded.avatar, updated = excluded.updated")
      .bind(userId, next.name, next.username, next.avatar, Date.now()).run();
  } catch (e) {
    if (/UNIQUE/i.test(String(e && e.message))) return fail(409, "That username is taken.");
    throw e;
  }
  if (next.public !== cur.public) await env.DB.prepare("INSERT INTO sharing (user_id, public, updated) VALUES (?, ?, ?) " +
    "ON CONFLICT (user_id) DO UPDATE SET public = excluded.public, updated = excluded.updated").bind(userId, next.public ? 1 : 0, Date.now()).run();
  return json(next);
}

// the public view: name, username and photo only
export async function byUsername(env, username) {
  const u = String(username || "").toLowerCase();
  if (!USERNAME.test(u)) return fail(404, "No one by that name.");
  const p = await env.DB.prepare("SELECT name, username, avatar FROM profiles WHERE username = ?").bind(u).first();
  return p ? json({ name: p.name, username: p.username, avatar: p.avatar }, 200, { "cache-control": "public, max-age=60" })
           : fail(404, "No one by that name.");
}
