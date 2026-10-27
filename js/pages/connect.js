// Connect: automatic sync setup, every import, the hand-entry form, and the visitor's own data (sources, backup, delete).
import { prefs, today, unit, fromDisp, toDisp, initNav, download, esc } from "../core.js";
import { getData, putSource, removeSource, clearAll, backup, restore } from "../store.js";
import { importAppleHealth } from "../importers/apple.js";
import { fetchHevy, fromHevyCSV } from "../importers/hevy.js";
import { fromStrongCSV } from "../importers/strong.js";
import { importMfp } from "../importers/mfp.js";
import { fromSheetCSV, template } from "../importers/sheet.js";
import { describe } from "../importers/csv.js";
import { newKey, syncUrl, getSync, setSync, pullSync, autoRefresh, getHevyKey as getKey, setHevyKey as setKey } from "../sync.js";

const $ = id => document.getElementById(id);
const dateText = iso => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const timeText = iso => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// The shared Motus Shortcut (an iCloud link), once it exists; until then shortcut.html explains how to make it.
const SHORTCUT_URL = "";

function say(id, html, kind = "") { const el = $("m-" + id); el.className = "msg " + kind; el.innerHTML = html; }

// Runs one import: progress in the card's status line, then saves it as that source.
async function run(id, src, controls, task) {
  controls.forEach(c => { if (c) c.disabled = true; });
  say(id, "Reading…");
  try {
    const result = await task(p => say(id, `Reading… ${Math.round(p * 100)}%`));
    const saved = putSource(src, result);
    const what = result.count != null ? `${result.count} workout${result.count === 1 ? "" : "s"} (${describe(result.days)})` : describe(result.days);
    say(id, `Imported ${what}. <a href="./">See your dashboard →</a>` +
      (result.unitGuessed ? ` The file didn't say its unit, so weights were read as ${$("u-strong").value}.` : "") +
      (saved ? "" : " <br>Your browser wouldn't let Motus save it, so it will be gone when you close this page."), saved ? "ok" : "bad");
    refresh();
  } catch (e) {
    say(id, esc(e && e.message ? e.message : "Something went wrong reading that file."), "bad");
  } finally {
    controls.forEach(c => { if (c) c.disabled = false; });
  }
}

// a file input: run the importer on the chosen file(s); clear it so the same file can be chosen again
function onFile(inputId, id, src, importer) {
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

// ---- automatic sync: the person's own GitHub copy of motus-sync ----
const DRAFT = "motusapp-sync-draft";     // the copy's name and key while setting up, so a reload loses nothing
const draft = () => { try { return JSON.parse(localStorage.getItem(DRAFT) || "{}"); } catch (e) { return {}; } };
const saveDraft = d => { try { d ? localStorage.setItem(DRAFT, JSON.stringify({ ...draft(), ...d })) : localStorage.removeItem(DRAFT); } catch (e) {} };
const copy = async (text, ok) => {
  try { await navigator.clipboard.writeText(text); say("auto", ok, "ok"); }
  catch (e) { say("auto", "Couldn't copy here; select it and copy it by hand.", "bad"); }
};

function repoName() {
  const v = $("a-repo").value.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\/+$/, "");
  const m = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/.exec(v);
  return m ? { user: m[1], full: `${m[1]}/${m[2]}` } : null;
}
function autoLinks() {
  const r = repoName(), base = r && `https://github.com/${r.full}`;
  const link = (id, href) => { const a = $(id); if (href) a.href = href; else a.removeAttribute("href"); a.classList.toggle("off", !href); };
  link("l-secret", base && base + "/settings/secrets/actions/new");
  link("l-pages", base && base + "/settings/pages");
  link("l-run", base && base + "/actions/workflows/motus-sync.yml");
  link("l-token", r && "https://github.com/settings/personal-access-tokens/new?" + new URLSearchParams({
    name: "Motus phone", description: `Lets your iPhone send Apple Health numbers to ${r.full}.`,
    target_name: r.user, expires_in: "366", contents: "write" }));
  $("a-hint").hidden = !!r;
}
function showKey(k) {
  $("a-keytext").textContent = k;
  $("a-keybox").hidden = !k;
  $("a-key").textContent = k ? "Make a new key" : "Create my key";
}
function autoUI() {
  const cfg = getSync(), d = draft();
  $("auto-on").hidden = !cfg;
  $("auto-setup").open = !cfg;
  $("auto-summary").textContent = cfg ? "Setup steps" : "Setup, about ten minutes";
  if (cfg) $("auto-status").innerHTML = `Connected to <b>${esc(cfg.repo)}</b>.` + (cfg.updated ? ` Newest from GitHub: ${esc(timeText(cfg.updated))}.` : "") +
    (cfg.hevyError ? ` <span class="warn">Hevy didn't sync: ${esc(cfg.hevyError)}</span>` : "");
  if (!$("a-repo").value) $("a-repo").value = (cfg && cfg.repo) || d.repo || "";
  showKey((cfg && cfg.key) || d.key || "");
  $("l-shortcut").href = SHORTCUT_URL || "shortcut.html";
  autoLinks();
}

async function connectSync(cfg, button) {
  if (button) button.disabled = true;
  say("auto", "Checking…");
  try {
    const { state } = await pullSync(cfg);
    const hevyBad = state.hevy && state.hevy.ok === false;
    say("auto", "Connected." + (hevyBad ? ` Hevy didn't sync: ${esc(state.hevy.error)}` : "") + ' <a href="./">See your dashboard →</a>', hevyBad ? "bad" : "ok");
    saveDraft(null);
    refresh();
  } catch (e) {
    say("auto", esc(e.message), "bad");
  } finally {
    if (button) button.disabled = false;
  }
}

$("a-repo").addEventListener("input", () => { saveDraft({ repo: $("a-repo").value.trim() }); autoLinks(); });
$("a-key").onclick = () => {
  if ($("a-keytext").textContent && !confirm("Make a new key? You'll have to replace MOTUS_KEY on GitHub with it and run the workflow once with “Start over” ticked.")) return;
  const k = newKey();
  saveDraft({ key: k });
  showKey(k);
};
$("a-copy").onclick = () => copy($("a-keytext").textContent, "Key copied. Paste it as the value of the MOTUS_KEY secret.");
$("a-check").onclick = () => {
  const r = repoName(), key = $("a-keytext").textContent;
  if (!r) return say("auto", "Type your copy's name in step 1, like your-username/motus-sync.", "bad");
  if (!key) return say("auto", "Create your key in step 2 first.", "bad");
  connectSync({ repo: r.full, url: syncUrl(r.full), key }, $("a-check"));
};
$("a-sync").onclick = () => connectSync(getSync(), $("a-sync"));
$("a-link").onclick = () => {
  const cfg = getSync();
  copy(`${location.origin}${location.pathname}#sync=${encodeURIComponent(cfg.repo)}:${cfg.key}`,
       "Link copied. Open it on your other device to connect it. Keep it private: it opens your data.");
};
$("a-off").onclick = () => {
  if (!confirm("Disconnect automatic sync on this device? Your GitHub copy keeps working, and you can connect again with the same key.")) return;
  setSync(null); removeSource("sync");
  say("auto", "Disconnected on this device.", "ok");
  refresh();
};

// A link made on another device: connect.html#sync=user/repo:KEY. What follows # never leaves the browser.
function fromLink() {
  const m = /^#sync=([^:]+):([A-Za-z0-9_-]{43})$/.exec(location.hash);
  if (!m) return;
  history.replaceState(null, "", location.pathname + "#auto");
  const repo = decodeURIComponent(m[1]);
  if (!syncUrl(repo) || !confirm(`Connect this device to your automatic sync from ${repo}?`)) return;
  connectSync({ repo, url: syncUrl(repo), key: m[2] });
}

// ---- Hevy API ----
function hevyKeyUI() {
  const saved = !!getKey();
  $("saved-hevy").hidden = !saved;
  [$("k-hevy").parentElement, $("r-hevy").parentElement].forEach(el => { el.hidden = saved; });
}
function syncHevy(key) {
  run("hevy", "hevy", [$("b-hevy"), $("s-hevy")], p => fetchHevy(key, p)).then(() => {
    if ($("m-hevy").classList.contains("ok") && $("r-hevy").checked) setKey(key.trim());
    $("k-hevy").value = "";
    hevyKeyUI();
  });
}
$("b-hevy").onclick = () => syncHevy($("k-hevy").value);
$("k-hevy").addEventListener("keydown", e => { if (e.key === "Enter") syncHevy($("k-hevy").value); });
$("s-hevy").onclick = () => syncHevy(getKey());
$("x-hevy").onclick = () => { setKey(""); hevyKeyUI(); say("hevy", "Key forgotten on this device. Your imported workouts are still here.", "ok"); };

// ---- spreadsheet template ----
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
$("b-manual").onclick = () => {
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
  say("manual", saved ? `Saved ${esc(d)}. <a href="./">See your dashboard →</a>` : "Your browser wouldn't let Motus save it.", saved ? "ok" : "bad");
  refresh();
};

// ---- your data ----
function refresh() {
  const data = getData();
  $("state").innerHTML = data.demo
    ? "Right now you're seeing <b>demo data</b>. Connect your apps below and your own replaces it."
    : `Showing your data from ${data.sources.map(s => esc(s.name)).join(", ")}.`;
  const on = new Set(data.sources.map(s => s.id));
  document.querySelectorAll(".pill").forEach(p => { p.textContent = on.has(p.dataset.src) ? "Connected" : ""; });
  $("sources").innerHTML = data.sources.length ? data.sources.map(s =>
    `<li><span><b>${esc(s.name)}</b><small>${s.count} day${s.count === 1 ? "" : "s"}${s.first ? `, ${dateText(s.first)} to ${dateText(s.last)}` : ""} · updated ${dateText(s.imported)}</small></span>` +
    `<button class="more" type="button" data-remove="${s.id}">Remove</button></li>`).join("")
    : '<li class="muted">Nothing imported yet.</li>';
  $("backup").disabled = data.demo;
  $("wipe").disabled = data.demo && !getKey() && !getSync();
  $("h-unit").textContent = unit();
  for (const s of ["u-strong", "u-mfp", "u-csv"]) if (!$(s).dataset.touched) $(s).value = prefs.units;
  handPlaceholders();
  autoUI();
}
for (const s of ["u-strong", "u-mfp", "u-csv"]) $(s).addEventListener("change", () => { $(s).dataset.touched = "1"; });

$("sources").addEventListener("click", e => {
  const b = e.target.closest("[data-remove]"); if (!b) return;
  const name = b.closest("li").querySelector("b").textContent;
  if (!confirm(`Remove everything imported from ${name} on this device?`)) return;
  removeSource(b.dataset.remove);
  if (b.dataset.remove === "hevy") { setKey(""); hevyKeyUI(); }
  if (b.dataset.remove === "sync") setSync(null);
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
    say("mine", `Restored ${n} source${n === 1 ? "" : "s"}. <a href="./">See your dashboard →</a>`, "ok");
  } catch (e) {
    say("mine", esc(e instanceof SyntaxError ? "That file isn't a Motus backup." : e.message), "bad");
  }
  refresh();
});
$("wipe").onclick = () => {
  if (!confirm("Delete all your Motus data, saved keys and sync connection from this device? This can't be undone unless you have a backup.")) return;
  clearAll(); setKey(""); setSync(null); saveDraft(null); hevyKeyUI();
  say("mine", "Deleted. You're back to the demo.", "ok");
  refresh();
};

initNav("connect", refresh);
hevyKeyUI();
refresh();
fromLink();
window.addEventListener("hashchange", fromLink);   // a link pasted while the page is already open
autoRefresh().then(changed => { if (changed) refresh(); });
