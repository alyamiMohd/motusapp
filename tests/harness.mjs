// Tiny test helper shared by the test files: no dependencies, exit code 1 on any failure.
// A Map-backed localStorage so the browser modules can be imported in Node.
const mem = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), clear: () => mem.clear() },
});

let passed = 0;
const failed = [];
export function check(name, ok, extra = "") {
  if (ok) { passed++; console.log("  PASS ", name); }
  else { failed.push(name); console.log("  FAIL ", name, extra); }
}
export const near = (a, b, eps = 1e-9) => a != null && b != null && Math.abs(a - b) < eps;
export function section(name) { console.log("\n" + name); }
export function finish() {
  console.log(`\n${passed} passed, ${failed.length} failed`);
  if (failed.length) { console.log("FAILED:", failed); process.exit(1); }
}
