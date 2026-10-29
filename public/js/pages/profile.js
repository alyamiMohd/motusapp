// Profile: a name, a photo and a username that can be shared (…/u/<username>), plus signing out and deleting the account.
import { initNav, refreshNav, esc } from "../core.js";
import { checkAccount, cachedMe, cachedPhoto, getProfile, saveProfile, profileLink, signOut, deleteAccount } from "../account.js";

const $ = id => document.getElementById(id);
const say = (id, html, kind = "") => { const el = $("m-" + id); el.className = "msg " + kind; el.innerHTML = html; };
let saved = { name: null, username: null, avatar: null };

// a photo, cropped square and resized on this device to 256 px (a JPEG of about 10-30 KB) before it's sent
function shrink(file) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(img.naturalWidth, img.naturalHeight), c = document.createElement("canvas");
      c.width = c.height = 256;
      c.getContext("2d").drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 256, 256);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file isn't a photo this browser can read.")); };
    img.src = url;
  });
}

function show(p) {
  const me = cachedMe() || {};
  saved = p;
  $("name").value = p.name || "";
  $("username").value = p.username || "";
  $("show-name").textContent = p.name || "Your name";
  $("show-user").textContent = p.username ? "@" + p.username : me.email || "";
  $("initial").textContent = ((p.name || me.email || "M").trim().charAt(0) || "M").toUpperCase();
  $("photo").hidden = !p.avatar; $("initial").hidden = !!p.avatar; $("b-nophoto").hidden = !p.avatar;
  if (p.avatar) $("photo").src = p.avatar;
  $("sharebox").hidden = !p.username;
  if (p.username) { const l = profileLink(p.username); $("link").href = l; $("link").textContent = l; }
  $("b-share").hidden = !navigator.share;
  $("email").textContent = me.email || "";
  refreshNav();
}

async function save(fields, done) {
  $("b-save").disabled = true;
  try { show(await saveProfile(fields)); say("profile", done, "ok"); }
  catch (e) { say("profile", esc(e.message), "bad"); }
  $("b-save").disabled = false;
}
$("b-save").onclick = () => save({ name: $("name").value, username: $("username").value }, "Saved.");
$("username").addEventListener("input", () => { $("username").value = $("username").value.toLowerCase().replace(/[^a-z0-9._]/g, ""); });
for (const id of ["name", "username"]) $(id).addEventListener("keydown", e => { if (e.key === "Enter") $("b-save").click(); });

$("b-photo").onclick = () => $("f-photo").click();
$("f-photo").addEventListener("change", async () => {
  const f = $("f-photo").files[0];
  $("f-photo").value = "";
  if (!f) return;
  say("profile", "Saving your photo…");
  try { await save({ avatar: await shrink(f) }, "Photo saved."); } catch (e) { say("profile", esc(e.message), "bad"); }
});
$("b-nophoto").onclick = () => save({ avatar: null }, "Photo removed.");

$("b-copy").onclick = async () => {
  try { await navigator.clipboard.writeText($("link").href); say("profile", "Link copied.", "ok"); }
  catch (e) { say("profile", "Couldn't copy here; press and hold the link instead.", "bad"); }
};
$("b-share").onclick = () => navigator.share({ title: saved.name || "Motus", url: $("link").href }).catch(() => {});

$("b-out").onclick = async () => {
  if (!confirm("Sign out? Your data stays in your account; this device goes back to the demo.")) return;
  await signOut();
  location.href = "./";
};
$("b-delete").onclick = async () => {
  if (!confirm("Delete your Motus account and everything in it? Your profile, Apple Health, Health Connect and Hevy are disconnected too. This can't be undone.")) return;
  try { await deleteAccount(); location.href = "./"; } catch (e) { say("account", esc(e.message), "bad"); }
};

initNav("profile", () => {});
const me = cachedMe();
$("out").hidden = !!me; $("in").hidden = !me;
if (me) show({ name: me.profile && me.profile.name, username: me.profile && me.profile.username, avatar: cachedPhoto() });
checkAccount().then(async r => {
  $("out").hidden = !!r.me; $("in").hidden = !r.me;
  if (r.me) show(await getProfile().catch(() => saved));
});
