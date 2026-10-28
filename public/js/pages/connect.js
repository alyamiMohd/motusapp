// Connect: the account, connecting Hevy and Apple Health once, file imports, hand entry, and the person's own data.
import { prefs, today, unit, fromDisp, toDisp, initNav, download, esc } from "../core.js";
import { getData, putSource, removeSource, clearAll, backup, restore, load, SERVER_SOURCES } from "../store.js";
import { importAppleHealth } from "../importers/apple.js";
import { fromHevyCSV } from "../importers/hevy.js";
import { fromStrongCSV } from "../importers/strong.js";
import { importMfp } from "../importers/mfp.js";
import { fromSheetCSV, template } from "../importers/sheet.js";
import { describe } from "../importers/csv.js";
import { checkAccount, cachedMe, sendCode, signIn, signOut, deleteAccount, pull, pushSource, removeRemote,
         connectHevy, syncHevy, disconnect, healthSetupLink, SHORTCUT_URL, HEVY_KEY_PAGE } from "../account.js";

const $ = id => document.getElementById(id);
const dateText = iso => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const ago = ms => {
  if (!ms) return "not yet";
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 2 ? "just now" : m < 60 ? `${m} minutes ago` : m < 48 * 60 ? `${Math.round(m / 60)} hours ago` : dateText(new Date(ms).toISOString());
};
const onIPhone = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
let available = false;

function say(id, html, kind = "") { const el = $("m-" + id); el.className = "msg " + kind; el.innerHTML = html; }
const busy = (ids, on) => ids.forEach(id => { if ($(id)) $(id).disabled = on; });

// ---- the account ----
$("a-send").onclick = async () => {
  busy(["a-send"], true); say("account", "Sending…");
  try {
    await sendCode($("a-email").value);
    $("a-codebox").hidden = false; $("a-code").focus();
    say("account", "Check your email for a 6-digit code.", "ok");
  } catch (e) { say("account", esc(e.message), "bad"); }
  busy(["a-send"], false);
};
$("a-email").addEventListener("keydown", e => { if (e.key === "Enter") $("a-send").click(); });
$("a-verify").onclick = async () => {
  busy(["a-verify"], true); say("account", "Signing in…");
  try {
    await signIn($("a-email").value, $("a-code").value);
    say("account", "");
    refresh();
  } catch (e) { say("account", esc(e.message), "bad"); }
  busy(["a-verify"], false);
};
$("a-code").addEventListener("input", () => { if (/^\d{6}$/.test($("a-code").value.trim())) $("a-verify").click(); });
$("a-out").onclick = async () => {
  if (!confirm("Sign out? Your data stays in your account; this device goes back to the demo.")) return;
  await signOut();
  refresh();
};
const needAccount = msgId => {
  if (cachedMe()) return false;
  say(msgId, available ? "Sign in first (at the top), then connect." : "This needs a Motus account, which this address doesn't offer.", "bad");
  if (available) $("a-email").focus();
  return true;
};

// ---- Hevy: one tap to its key page, one tap to paste ----
$("b-hevy").onclick = () => {
  if (needAccount("live-hevy")) return;
  window.open(HEVY_KEY_PAGE, "_blank", "noopener");
  $("hevy-paste").hidden = false;
  say("live-hevy", "");
};
async function useHevyKey(key) {
  key = String(key || "").trim();
  if (!key) return say("live-hevy", "Copy the API key in Hevy first, then tap Paste key.", "bad");
  busy(["b-paste", "b-hevy"], true);
  say("live-hevy", "Checking the key with Hevy…");
  try {
    await connectHevy(key, n => say("live-hevy", `Bringing in your workouts… (${n * 50}+)`));
    $("k-hevy").value = ""; $("hevy-paste").hidden = true;
    say("live-hevy", 'Connected. Your workouts are in, and new ones arrive by themselves. <a href="workouts.html">See your workouts →</a>', "ok");
    refresh();
  } catch (e) { say("live-hevy", esc(e.message), "bad"); }
  busy(["b-paste", "b-hevy"], false);
}
$("b-paste").onclick = async () => {
  try { useHevyKey(await navigator.clipboard.readText()); }
  catch (e) { say("live-hevy", "Your browser didn't allow pasting from here. Paste the key into the box instead.", "bad"); $("k-hevy").focus(); }
};
$("k-hevy").addEventListener("paste", e => { const t = (e.clipboardData || window.clipboardData).getData("text"); if (t) { e.preventDefault(); useHevyKey(t); } });
$("k-hevy").addEventListener("keydown", e => { if (e.key === "Enter") useHevyKey($("k-hevy").value); });
$("b-hevy-sync").onclick = async () => {
  busy(["b-hevy-sync"], true); say("live-hevy", "Syncing…");
  try { await syncHevy(); say("live-hevy", "Up to date.", "ok"); refresh(); } catch (e) { say("live-hevy", esc(e.message), "bad"); }
  busy(["b-hevy-sync"], false);
};
$("b-hevy-off").onclick = async () => {
  if (!confirm("Disconnect Hevy? Its workouts are removed from Motus; nothing changes in Hevy.")) return;
  try { await disconnect("hevy"); say("live-hevy", "Disconnected.", "ok"); refresh(); } catch (e) { say("live-hevy", esc(e.message), "bad"); }
};

// ---- Apple Health: add the Shortcut, then Finish hands it its token and asks for Health access ----
$("b-shortcut").href = SHORTCUT_URL || "shortcut.html";
$("b-shortcut").addEventListener("click", e => { if (needAccount("live-health")) e.preventDefault(); });
async function finishHealth() {
  if (needAccount("live-health")) return;
  busy(["b-finish", "b-health-again"], true);
  try {
    const link = await healthSetupLink();
    location.href = link;                                // opens Shortcuts, which runs Motus once and comes back here
    // Safari may refuse to leave for another app this long after the tap; then the person taps the link themselves
    setTimeout(() => { if (document.visibilityState === "visible")
      say("live-health", `If Shortcuts didn't open, <a href="${esc(link)}">tap here to open it</a>. The Shortcut must be called exactly “Motus”.`); }, 1500);
  } catch (e) { say("live-health", esc(e.message), "bad"); }
  busy(["b-finish", "b-health-again"], false);
}
$("b-finish").onclick = finishHealth;
$("b-health-again").onclick = () => {
  if (!confirm("Set up the Shortcut again? The one on your iPhone stops working until you tap Finish there.")) return;
  $("health-off").dataset.redo = "1"; $("health-on").hidden = true; $("health-off").hidden = false;
};
$("b-health-off").onclick = async () => {
  if (!confirm("Disconnect Apple Health? Its numbers are removed from Motus. You can delete the Motus Shortcut on your iPhone too.")) return;
  try { await disconnect("health"); say("live-health", "Disconnected.", "ok"); refresh(); } catch (e) { say("live-health", esc(e.message), "bad"); }
};

// ---- file imports ----
async function run(id, src, controls, task) {
  controls.forEach(c => { if (c) c.disabled = true; });
  say(id, "Reading…");
  try {
    const result = await task(p => say(id, `Reading… ${Math.round(p * 100)}%`));
    const saved = putSource(src, result);
    const what = result.count != null ? `${result.count} workout${result.count === 1 ? "" : "s"} (${describe(result.days)})` : describe(result.days);
    let note = saved ? "" : " <br>Your browser wouldn't let Motus save it, so it will be gone when you close this page.";
    if (cachedMe()) { try { await pushSource(src); note += " Saved to your account."; } catch (e) { note += " <br>Couldn't save it to your account yet: " + esc(e.message); } }
    say(id, `Imported ${what}. <a href="./">See your dashboard →</a>` +
      (result.unitGuessed ? ` The file didn't say its unit, so weights were read as ${$("u-strong").value}.` : "") + note, saved ? "ok" : "bad");
    refresh();
  } catch (e) {
    say(id, esc(e && e.message ? e.message : "Something went wrong reading that file."), "bad");
  } finally {
    controls.forEach(c => { if (c) c.disabled = false; });
  }
}
function onFile(inputId, id, src, importer) {          // clear the input so the same file can be chosen again
  const input = $(inputId);
  input.addEventListener("change", () => {
    const files = [...input.files];
    input.value = "";
    if (files.length) run(id, src, [input], p => importer(files, p));
  });
}
onFile("f-apple", "apple", "apple", (files, p) => importAppleHealth(files[0], p));
onFile("f-hevy", "hevy", "hevy", async files => fromHevyCSV(await files[0].text()));
onFile("f-strong", "strong", "strong", async files => fromStrongCSV(await files[0].text(), $("u-strong").value));
onFile("f-mfp", "mfp", "mfp", files => importMfp(files, $("u-mfp").value));
onFile("f-csv", "csv", "csv", async files => fromSheetCSV(await files[0].text(), $("u-csv").value));
$("t-csv").onclick = () => download("motus-template.csv", template(today), "text/csv");

// ---- by hand ----
const HAND = ["sleep_hours", "steps", "calories", "weight"];
function handPlaceholders() {
  const data = getData(), r = data.days[$("h-date").value] || {};
  for (const k of HAND) {
    const v = k === "weight" ? r.weight_kg : r[k];
    $("h-" + k).placeholder = data.demo || v == null ? "" : k === "weight" ? toDisp(v).toFixed(1) : String(v);
  }
}
$("h-date").max = today;
$("h-date").value = today;
$("h-date").addEventListener("change", handPlaceholders);
$("b-manual").onclick = async () => {
  const d = $("h-date").value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d > today) return say("manual", "Choose a date up to today.", "bad");
  const rec = {};
  for (const k of HAND) {
    const v = parseFloat($("h-" + k).value);
    if (!Number.isFinite(v) || v <= 0) continue;
    if (k === "weight") rec.weight_kg = Math.round(fromDisp(v) * 10) / 10;
    else rec[k] = k === "sleep_hours" ? v : Math.round(v);
  }
  if (!Object.keys(rec).length) return say("manual", "Type at least one number.", "bad");
  const saved = putSource("manual", { days: { [d]: rec } });
  HAND.forEach(k => { $("h-" + k).value = ""; });
  if (cachedMe()) await pushSource("manual").catch(() => {});
  say("manual", saved ? `Saved ${esc(d)}. <a href="./">See your dashboard →</a>` : "Your browser wouldn't let Motus save it.", saved ? "ok" : "bad");
  refresh();
};

// ---- what is shown ----
function refresh() {
  const me = cachedMe(), data = getData();
  $("acct-out").hidden = !available || !!me;
  $("acct-in").hidden = !me;
  $("acct-none").hidden = available || !!me;
  if (me) $("a-who").textContent = me.email;

  const h = me && me.hevy && me.hevy.connected ? me.hevy : null;
  $("hevy-off").hidden = !!h; $("hevy-on").hidden = !h;
  $("p-hevy").textContent = h ? "Connected" : "";
  if (h) $("s-hevy").innerHTML = h.error ? `<span class="warn">Hevy stopped syncing: ${esc(h.error)}</span>` : `Up to date by itself. Last sync ${ago(h.synced)}.`;

  const hl = me && me.health && me.health.connected ? me.health : null;
  if (!$("health-off").dataset.redo) { $("health-off").hidden = !!hl; $("health-on").hidden = !hl; }
  $("p-health").textContent = hl ? "Connected" : "";
  if (hl) $("s-health").textContent = hl.last_upload ? `Your iPhone last sent numbers ${ago(hl.last_upload)}.` : "Waiting for the first upload from your iPhone.";
  $("h-elsewhere").hidden = onIPhone;
  $("h-steps").classList.toggle("dim", !onIPhone);

  const on = new Set(data.sources.map(s => s.id));
  document.querySelectorAll(".pill[data-src]").forEach(p => { p.textContent = on.has(p.dataset.src) ? "Imported" : ""; });
  $("sources").innerHTML = data.sources.length ? data.sources.map(s =>
    `<li><span><b>${esc(s.name)}</b><small>${s.count} day${s.count === 1 ? "" : "s"}${s.first ? `, ${dateText(s.first)} to ${dateText(s.last)}` : ""}${s.imported ? ` · updated ${dateText(s.imported)}` : ""}</small></span>` +
    (SERVER_SOURCES.includes(s.id) ? "" : `<button class="more" type="button" data-remove="${s.id}">Remove</button>`) + "</li>").join("")
    : '<li class="muted">Nothing connected or imported yet.</li>';
  $("backup").disabled = data.demo;
  $("wipe").textContent = me ? "Delete my account" : "Delete everything";
  $("wipe").disabled = data.demo && !me;
  $("h-unit").textContent = unit();
  for (const s of ["u-strong", "u-mfp", "u-csv"]) if (!$(s).dataset.touched) $(s).value = prefs.units;
  handPlaceholders();
}
for (const s of ["u-strong", "u-mfp", "u-csv"]) $(s).addEventListener("change", () => { $(s).dataset.touched = "1"; });

$("sources").addEventListener("click", async e => {
  const b = e.target.closest("[data-remove]"); if (!b) return;
  const name = b.closest("li").querySelector("b").textContent;
  if (!confirm(`Remove everything imported from ${name}?`)) return;
  removeSource(b.dataset.remove);
  await removeRemote(b.dataset.remove).catch(() => {});
  say("mine", `Removed ${esc(name)}.`, "ok");
  refresh();
});
$("backup").onclick = () => download(`motus-backup-${today}.json`, backup(), "application/json");
$("restore").addEventListener("change", async () => {
  const f = $("restore").files[0];
  $("restore").value = "";
  if (!f) return;
  try {
    const obj = JSON.parse(await f.text());
    if (!getData().demo && !confirm("Replace the data on this device with this backup?")) return;
    const n = restore(obj);
    if (cachedMe()) for (const id of Object.keys(load().sources)) await pushSource(id).catch(() => {});
    say("mine", `Restored ${n} source${n === 1 ? "" : "s"}. <a href="./">See your dashboard →</a>`, "ok");
  } catch (e) {
    say("mine", esc(e instanceof SyntaxError ? "That file isn't a Motus backup." : e.message), "bad");
  }
  refresh();
});
$("wipe").onclick = async () => {
  if (cachedMe()) {
    if (!confirm("Delete your Motus account and everything in it? Hevy and Apple Health are disconnected too. This can't be undone.")) return;
    try { await deleteAccount(); say("mine", "Your account is deleted. You're back to the demo.", "ok"); } catch (e) { say("mine", esc(e.message), "bad"); }
  } else {
    if (!confirm("Delete all your Motus data from this device? This can't be undone unless you have a backup.")) return;
    clearAll();
    say("mine", "Deleted. You're back to the demo.", "ok");
  }
  refresh();
};

initNav("connect", refresh);
refresh();
checkAccount().then(async r => {
  available = r.available;
  if (r.me) await pull().catch(() => {});
  if (new URLSearchParams(location.search).get("health") === "done") {
    history.replaceState(null, "", location.pathname + "#live-health");
    say("live-health", "Apple Health is connected. Last step: make it daily (step 3).", "ok");
    $("health-off").dataset.redo = "1"; $("health-off").hidden = false; $("health-on").hidden = true;
  }
  refresh();
});
