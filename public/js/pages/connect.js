// Connect: sign in first; then the integrations, each with its own one-tap setup (Apple Health through the Motus
// Shortcut, Health Connect through HC Webhook on Android, Hevy by its API key, Strong and Hevy without Pro as a file,
// MyFitnessPal through the phone's health app).
import { initNav, refreshNav, download, esc, prefs } from "../core.js";
import { getData, putSource } from "../store.js";
import { fromHevyCSV } from "../importers/hevy.js";
import { fromStrongCSV } from "../importers/strong.js";
import { describe } from "../importers/csv.js";
import { checkAccount, cachedMe, sendCode, signIn, pull, pushSource, connectHevy, syncHevy, disconnect,
         healthSetupLink, androidSetup, runHealthNow, SHORTCUT_URL, HEVY_KEY_PAGE } from "../account.js";

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

// ---- signing in ----
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
  try { await signIn($("a-email").value, $("a-code").value); say("account", ""); refresh(); }
  catch (e) { say("account", esc(e.message), "bad"); }
  busy(["a-verify"], false);
};
$("a-code").addEventListener("input", () => { if (/^\d{6}$/.test($("a-code").value.trim())) $("a-verify").click(); });

// ---- the list: one integration open at a time, and #name opens one (from a link, or after coming back) ----
const ints = [...document.querySelectorAll("details.int")];
ints.forEach(d => d.addEventListener("toggle", () => { if (d.open) ints.forEach(o => { if (o !== d) o.open = false; }); }));
function openFromHash() {
  const d = $(location.hash.slice(1));
  if (d && d.matches("details.int")) { d.open = true; d.scrollIntoView({ block: "start" }); }
}
addEventListener("hashchange", openFromHash);

// ---- Apple Health: add the Shortcut, then Finish hands it its token and asks for Health access ----
$("b-shortcut").href = SHORTCUT_URL || "shortcut.html";
$("b-finish").onclick = async () => {
  busy(["b-finish", "b-health-again"], true);
  try {
    const link = await healthSetupLink();
    location.href = link;                                // opens Shortcuts, which runs Motus once and comes back here
    // Safari may refuse to leave for another app this long after the tap; then the person taps the link themselves
    setTimeout(() => { if (document.visibilityState === "visible")
      say("live-health", `If Shortcuts didn't open, <a href="${esc(link)}">tap here to open it</a>. The Shortcut must be called exactly “Motus”.`); }, 1500);
  } catch (e) { say("live-health", esc(e.message), "bad"); }
  busy(["b-finish", "b-health-again"], false);
};
// runs the Motus Shortcut now; Shortcuts comes back here with ?health=updated (or cancelled / failed)
$("b-health-now").onclick = () => {
  if (!onIPhone) { say("live-health", "Open Motus on your iPhone to update from Apple Health.", "bad"); return; }
  say("live-health", "Opening Shortcuts…");
  runHealthNow(location.origin + location.pathname);
};
$("b-health-again").onclick = () => {
  if (!confirm("Set up the Shortcut again? The one on your iPhone stops working until you tap Finish there.")) return;
  $("health-off").dataset.redo = "1"; $("health-on").hidden = true; $("health-off").hidden = false;
};
$("b-health-off").onclick = async () => {
  if (!confirm("Disconnect Apple Health? Its numbers are removed from Motus. You can delete the Motus Shortcut on your iPhone too.")) return;
  try { await disconnect("health"); say("live-health", "Disconnected.", "ok"); refresh(); } catch (e) { say("live-health", esc(e.message), "bad"); }
};

// ---- Health Connect (Android): a settings file for HC Webhook with Motus's address and this person's key ----
async function androidFile() {
  busy(["b-android", "b-android-again"], true);
  try {
    const { settings } = await androidSetup();
    download("motus-hc-webhook.json", JSON.stringify(settings, null, 2), "application/json");
    say("android", "Downloaded. Now import it in HC Webhook (step 3). Your numbers arrive within the hour.", "ok");
    await checkAccount(); refresh();
  } catch (e) { say("android", esc(e.message), "bad"); }
  busy(["b-android", "b-android-again"], false);
}
$("b-android").onclick = androidFile;
$("b-android-again").onclick = () => {
  if (!confirm("Make a new setup file? The one in HC Webhook stops working until you import the new one.")) return;
  androidFile();
};
$("b-android-off").onclick = async () => {
  if (!confirm("Disconnect Health Connect? Its numbers are removed from Motus. You can remove Motus from HC Webhook too.")) return;
  try { await disconnect("android"); say("android", "Disconnected.", "ok"); refresh(); } catch (e) { say("android", esc(e.message), "bad"); }
};

// ---- Hevy: one tap to its key page, one tap to paste ----
$("b-hevy").onclick = () => {
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

// ---- files: Strong, and Hevy without Pro ----
function onFile(inputId, msgId, src, read) {           // the input is cleared so the same file can be chosen again
  const input = $(inputId);
  input.addEventListener("change", async () => {
    const f = input.files[0];
    input.value = "";
    if (!f) return;
    input.disabled = true; say(msgId, "Reading…");
    try {
      const result = await read(f);
      putSource(src, result);
      await pushSource(src);
      say(msgId, `Imported ${result.count} workout${result.count === 1 ? "" : "s"} (${describe(result.days)}). <a href="workouts.html">See your workouts →</a>` +
        (result.unitGuessed ? ` The file didn't say its unit, so weights were read as ${$("u-strong").value}.` : ""), "ok");
      refresh();
    } catch (e) { say(msgId, esc(e && e.message ? e.message : "Something went wrong reading that file."), "bad"); }
    input.disabled = false;
  });
}
onFile("f-strong", "strong", "strong", async f => fromStrongCSV(await f.text(), $("u-strong").value));
onFile("f-hevy", "live-hevy", "hevy", async f => fromHevyCSV(await f.text()));

// ---- what is shown ----
const status = (id, text, on) => { $(id).textContent = text; $(id).classList.toggle("good", !!on); };
function refresh() {
  const me = cachedMe(), sources = getData().sources, has = id => sources.find(s => s.id === id);
  refreshNav();
  $("acct-out").hidden = !available || !!me;
  $("acct-none").hidden = available || !!me;
  $("integrations").hidden = !me;
  $("title").textContent = me || !available ? "Integrations" : "Sign in";
  $("back").hidden = !me;
  if (!me) return;

  const hl = me.health && me.health.connected ? me.health : null;
  if (!$("health-off").dataset.redo) { $("health-off").hidden = !!hl; $("health-on").hidden = !hl; }
  if (hl) $("s-health").textContent = hl.last_upload ? `Your iPhone last sent numbers ${ago(hl.last_upload)}.` : "Waiting for the first upload from your iPhone.";
  status("t-health", hl ? (hl.last_upload ? `Connected · ${ago(hl.last_upload)}` : "Connected · waiting for the iPhone") : "iPhone: steps, sleep, weight, food, energy", hl);
  $("h-elsewhere").hidden = onIPhone;
  $("h-steps").classList.toggle("dim", !onIPhone);

  const an = me.android && me.android.connected ? me.android : null;
  $("android-off").hidden = !!an && !!an.last_upload; $("android-on").hidden = !(an && an.last_upload);
  if (an && an.last_upload) $("s-android").textContent = `Your Android phone last sent numbers ${ago(an.last_upload)}.`;
  status("t-android", an ? (an.last_upload ? `Connected · ${ago(an.last_upload)}` : "Waiting for HC Webhook") : "Android: Samsung Health, Google Fit, Fitbit, HUAWEI…", an && an.last_upload);

  const h = me.hevy && me.hevy.connected ? me.hevy : null;
  $("hevy-off").hidden = !!h; $("hevy-on").hidden = !h;
  if (h) $("s-hevy").innerHTML = h.error ? `<span class="warn">Hevy stopped syncing: ${esc(h.error)}</span>` : `Up to date by itself. Last sync ${ago(h.synced)}.`;
  const hevyFile = has("hevy");
  status("t-hevy", h ? (h.error ? "Stopped syncing" : "Connected") : hevyFile ? `Imported ${dateText(hevyFile.imported)}` : "Workouts, ratings and estimated 1RM", h && !h.error || (!h && hevyFile));

  const st = has("strong");
  status("t-strong", st ? `Imported ${dateText(st.imported)}` : "Workouts, as a file", st);
  status("t-mfp", hl || an ? `Through ${hl ? "Apple Health" : "Health Connect"}` : "Food, through Apple Health or Health Connect", hl || an);
  if (!$("u-strong").dataset.touched) $("u-strong").value = prefs.units;
}
$("u-strong").addEventListener("change", () => { $("u-strong").dataset.touched = "1"; });

initNav("profile");
refresh();
checkAccount().then(async r => {
  available = r.available;
  if (r.me) await pull().catch(() => {});
  const back = new URLSearchParams(location.search).get("health");
  if (back) history.replaceState(null, "", location.pathname + "#health");
  refresh();
  if (back === "done") {
    say("live-health", "Apple Health is connected.", "ok");
    $("health-off").dataset.redo = "1"; $("health-off").hidden = false; $("health-on").hidden = true;
  }
  if (back === "updated") say("live-health", "Updated from Apple Health.", "ok");
  if (back === "failed") say("live-health", "The Shortcut couldn't send this time (no connection, perhaps). Tap Update now to try again.", "bad");
  openFromHash();
});
