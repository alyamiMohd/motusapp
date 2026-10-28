// Signing in with a 6-digit code sent by email. No passwords. Only hashes of codes and session cookies are stored.
import { sha256, token, uuid, sixDigits, sameText, allow, json, fail } from "./util.js";

const CODE_MINUTES = 10, MAX_TRIES = 5, COOKIE = "motus";
const YEAR = 365 * 24 * 3600;
export const normEmail = e => String(e || "").trim().toLowerCase();
const validEmail = e => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const codeHash = (env, email, code) => sha256(`${email}|${code}|${env.CODE_PEPPER || ""}`);

// The code goes out through Brevo (BREVO_API_KEY) or Resend (RESEND_API_KEY), whichever is set; Brevo first.
// EMAIL_FROM ("Motus <someone@example.com>", a sender verified with the provider) is a secret, so the address
// stays out of the public repo. Only the status and error type of a refusal are logged, never the address.
const parseFrom = from => { const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from || ""); return m ? { name: m[1] || "Motus", email: m[2] } : { name: "Motus", email: String(from || "").trim() }; };
const subject = code => `Your Motus code: ${code}`;
const body = code => `Your Motus sign-in code is ${code}\n\nIt works for ${CODE_MINUTES} minutes. If you didn't ask for it, you can ignore this email.\n`;

async function sendCode(env, email, code) {
  if (typeof env.CODE_SINK === "function") return env.CODE_SINK(email, code);   // tests only (real settings are never functions)
  const fetchFn = env.FETCH || fetch;
  if (env.BREVO_API_KEY) {
    if (!env.EMAIL_FROM) throw new Error("Email isn't set up on this server yet.");
    const res = await fetchFn("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ sender: parseFrom(env.EMAIL_FROM), to: [{ email }], subject: subject(code), textContent: body(code) }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.log("brevo refused:", res.status, err.code || "");
      throw new Error("Couldn't send the email. Try again in a minute.");
    }
    return;
  }
  if (env.RESEND_API_KEY) {
    const res = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM || "Motus <onboarding@resend.dev>", to: [email], subject: subject(code), text: body(code) }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.log("resend refused:", res.status, err.name || "");
      throw new Error(res.status === 403 && err.name === "validation_error"
        ? "Codes can't be sent to this address yet. Use the email the Motus owner signed up to Resend with."
        : "Couldn't send the email. Try again in a minute.");
    }
    return;
  }
  if (env.DEV_SHOW_CODES === "1") { console.log(`[dev] sign-in code for ${email}: ${code}`); return; }
  throw new Error("Email isn't set up on this server yet.");
}

// POST /api/auth/start { email }: always the same answer, so it never tells whether someone has an account
export async function start(req, env, ip) {
  const body = await req.json().catch(() => ({}));
  const email = normEmail(body.email);
  if (!validEmail(email)) return fail(400, "That doesn't look like an email address.");
  if (!(await allow(env.DB, "ip:" + ip, 30, 3600)) || !(await allow(env.DB, "email:" + email, 5, 3600)))
    return fail(429, "Too many codes asked for. Wait a little and try again.");
  const code = sixDigits();
  await env.DB.prepare("INSERT INTO login_codes (email, code_hash, expires, attempts) VALUES (?, ?, ?, 0) " +
    "ON CONFLICT (email) DO UPDATE SET code_hash = excluded.code_hash, expires = excluded.expires, attempts = 0")
    .bind(email, await codeHash(env, email, code), Date.now() + CODE_MINUTES * 60000).run();
  try { await sendCode(env, email, code); } catch (e) { return fail(503, e.message); }
  return json({ ok: true });
}

// POST /api/auth/verify { email, code } -> sets the session cookie
export async function verify(req, env, ip) {
  const body = await req.json().catch(() => ({}));
  const email = normEmail(body.email), code = String(body.code || "").replace(/\D/g, "");
  if (!(await allow(env.DB, "verify:" + ip, 60, 3600))) return fail(429, "Too many tries. Wait a little and try again.");
  const row = await env.DB.prepare("SELECT code_hash, expires, attempts FROM login_codes WHERE email = ?").bind(email).first();
  if (!row || row.expires < Date.now()) return fail(400, "That code has expired. Ask for a new one.");
  if (row.attempts >= MAX_TRIES) return fail(429, "Too many wrong codes. Ask for a new one.");
  if (code.length !== 6 || !sameText(await codeHash(env, email, code), row.code_hash)) {
    await env.DB.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?").bind(email).run();
    return fail(400, "That code isn't right.");
  }
  await env.DB.prepare("DELETE FROM login_codes WHERE email = ?").bind(email).run();
  const now = Date.now();
  await env.DB.prepare("INSERT INTO users (id, email, created, changed) VALUES (?, ?, ?, ?) ON CONFLICT (email) DO NOTHING")
    .bind(uuid(), email, now, now).run();
  const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  const t = token();
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created, seen) VALUES (?, ?, ?, ?)")
    .bind(await sha256(t), user.id, now, now).run();
  return json({ email }, 200, { "set-cookie": cookie(req, t, YEAR) });
}

export async function logout(req, env) {
  const t = readCookie(req);
  if (t) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(t)).run();
  return json({ ok: true }, 200, { "set-cookie": cookie(req, "", 0) });
}

// The signed-in person for this request, or null.
export async function sessionUser(req, env) {
  const t = readCookie(req);
  if (!t) return null;
  const hash = await sha256(t);
  const row = await env.DB.prepare("SELECT u.id, u.email, u.changed, s.seen FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?")
    .bind(hash).first();
  if (!row) return null;
  if (Date.now() - row.seen > 24 * 3600e3) await env.DB.prepare("UPDATE sessions SET seen = ? WHERE token_hash = ?").bind(Date.now(), hash).run();
  return { id: row.id, email: row.email, changed: row.changed };
}

function readCookie(req) {
  const m = /(?:^|;\s*)motus=([A-Za-z0-9_-]{20,})/.exec(req.headers.get("cookie") || "");
  return m ? m[1] : null;
}
function cookie(req, value, maxAge) {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
