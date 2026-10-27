// Small helpers for the Motus server: hashing, random tokens, encryption of stored API keys, rate limits, responses.

const enc = new TextEncoder();
const b64 = bytes => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));
export const b64url = bytes => b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function sha256(text) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)));
  return [...d].map(b => b.toString(16).padStart(2, "0")).join("");
}
export const token = (prefix = "") => prefix + b64url(crypto.getRandomValues(new Uint8Array(32)));
export const uuid = () => crypto.randomUUID();

// 6 digits, uniform (rejects the few values that would make some codes likelier)
export function sixDigits() {
  const a = new Uint32Array(1);
  do crypto.getRandomValues(a); while (a[0] >= 4294000000);
  return String(a[0] % 1000000).padStart(6, "0");
}

export function sameText(a, b) {          // constant-time comparison of two hex strings
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

// AES-256-GCM with HEVY_SECRET (32 random bytes, base64): stored keys are useless without the server's secret
async function aesKey(secret, use) {
  const raw = unb64(String(secret || ""));
  if (raw.length !== 32) throw new Error("HEVY_SECRET must be 32 random bytes in base64");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [use]);
}
export async function seal(text, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret, "encrypt"), enc.encode(text)));
  return b64(iv) + ":" + b64(ct);
}
export async function unseal(box, secret) {
  const [iv, ct] = String(box).split(":");
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(secret, "decrypt"), unb64(ct)));
}

// At most `max` hits per `seconds` for a key (an email address, an IP). D1-backed, so it holds across server instances.
export async function allow(db, key, max, seconds, now = Date.now()) {
  const row = await db.prepare("SELECT count, reset FROM rate WHERE key = ?").bind(key).first();
  if (!row || row.reset <= now) {
    await db.prepare("INSERT INTO rate (key, count, reset) VALUES (?, 1, ?) ON CONFLICT (key) DO UPDATE SET count = 1, reset = excluded.reset")
      .bind(key, now + seconds * 1000).run();
    return true;
  }
  if (row.count >= max) return false;
  await db.prepare("UPDATE rate SET count = count + 1 WHERE key = ?").bind(key).run();
  return true;
}

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
export const fail = (status, error) => json({ error }, status);
