// A Cloudflare D1 stand-in for tests: the same prepare/bind/first/all/run/batch calls, on Node's built-in SQLite,
// so the server's real SQL runs against a real database.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

export function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8"));
  const plain = r => (r ? { ...r } : null);
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => plain(db.prepare(sql).get(...args)),
    all: async () => ({ results: db.prepare(sql).all(...args).map(plain) }),
    run: async () => ({ meta: { changes: db.prepare(sql).run(...args).changes } }),
    exec: () => (/^\s*select/i.test(sql) ? db.prepare(sql).all(...args) : db.prepare(sql).run(...args)),
  });
  return {
    prepare: sql => stmt(sql),
    async batch(list) {
      db.exec("BEGIN");
      try { const out = list.map(s => s.exec()); db.exec("COMMIT"); return out; }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    },
    sql: (q, ...a) => db.prepare(q).all(...a).map(plain),     // for looking inside in tests
  };
}
