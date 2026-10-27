// Signs dist/Motus.unsigned.plist into public/Motus.shortcut without a Mac, through RoutineHub's HubSign
// (the same service the open-source Cherri compiler uses). iPhones only import signed Shortcut files.
// The file holds no account details: each phone's address and token live in its own motus.txt.
// On a Mac, `shortcuts sign --mode anyone -i <unsigned> -o public/Motus.shortcut` does the same.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const plist = readFileSync(join(HERE, "dist", "Motus.unsigned.plist"), "utf8");
const res = await fetch("https://hubsign.routinehub.services/sign", {
  method: "POST", headers: { "content-type": "application/json", "user-agent": "motusapp-build" },
  body: JSON.stringify({ shortcutName: "Motus", shortcut: plist }),
});
const body = Buffer.from(await res.arrayBuffer());
if (!res.ok || body.subarray(0, 4).toString() !== "AEA1") {
  console.error(`signing failed: ${res.status} ${res.headers.get("content-type")}\n${body.subarray(0, 300).toString()}`);
  process.exit(1);
}
const target = join(HERE, "..", "..", "public", "Motus.shortcut");
writeFileSync(target, body);
console.log(`signed: ${target} (${body.length} bytes)`);
