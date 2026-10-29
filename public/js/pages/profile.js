// Profile: who you are, then everything personal in short parts: Friends (their faces), Integrations (your connected
// apps), Edit profile, Privacy (who sees your dashboard, your link), Standards, About and Account.
import { initNav, initStandards, refreshNav, esc } from "../core.js";
import { checkAccount, cachedMe, cachedPhoto, getProfile, saveProfile, profileLink, signOut, deleteAccount, getFriends } from "../account.js";
import { load } from "../store.js";

const $ = id => document.getElementById(id);
const say = (id, html, kind = "") => { const el = $("m-" + id); el.className = "msg " + kind; el.innerHTML = html; };
let saved = { name: null, username: null, avatar: null, public: false };

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

const face = p => p.avatar && /^data:image\//.test(p.avatar) ? `<img src="${esc(p.avatar)}" alt="">` : '<span class="mark"></span>';
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Friends: up to 4 faces, how many, and who's asking
async function friends() {
  const me = cachedMe() || {};
  const asking = me.requests || 0;
  $("friends-sub").textContent = asking ? `${asking} asking` : "";
  $("friends-sub").className = asking ? "good" : "";
  try {
    const f = await getFriends();
    const n = f.friends.length;
    $("faces").innerHTML = f.friends.slice(0, 4).map(p => `<span class="pic">${face(p)}</span>`).join("");
    $("friends-sub").textContent = [n ? plural(n, "friend", "friends") : "Add friends", f.incoming.length ? `${f.incoming.length} asking` : ""].filter(Boolean).join(" · ");
    $("friends-sub").className = f.incoming.length ? "good" : "";
  } catch (e) {}
}

// Integrations: the icons of what's connected (account connections, and files brought in on this device)
const APPS = [["health", "apple-health", "Apple Health"], ["android", "health-connect", "Health Connect"], ["hevy", "hevy", "Hevy"], ["strong", "strong", "Strong"]];
function integrations() {
  const me = cachedMe() || {}, sources = load().sources;
  const on = APPS.filter(([k]) => (me[k] && me[k].connected) || (k === "strong" && sources.strong));
  $("apps").innerHTML = on.map(([, icon, name]) => `<img src="icons/${icon}.png" alt="" title="${name}">`).join("");
  $("int-sub").textContent = on.length ? `${on.length} connected` : "Connect your apps";
  $("int-sub").className = on.length ? "" : "good";
}

function show(p) {
  const me = cachedMe() || {};
  saved = p;
  $("name").value = p.name || "";
  $("username").value = p.username || "";
  $("show-name").textContent = p.name || "Your name";
  $("show-user").textContent = p.username ? "@" + p.username : "Pick a username in Edit profile";
  $("photo").hidden = !p.avatar; $("initial").hidden = !!p.avatar; $("b-nophoto").hidden = !p.avatar;
  if (p.avatar) $("photo").src = p.avatar;
  const pub = !!p.public;
  for (const b of $("vis").querySelectorAll("button")) b.setAttribute("aria-pressed", String((b.dataset.v === "1") === pub));
  $("vis-sub").textContent = pub ? "Everyone sees your dashboard" : "Friends see your dashboard";
  $("vis-note").textContent = pub ? "Everyone on Motus sees your numbers." : "Only friends see your numbers.";
  $("sharebox").hidden = !p.username;
  if (p.username) { const l = profileLink(p.username); $("link").href = l; $("link").textContent = l; }
  $("b-share").hidden = !navigator.share;
  $("email").textContent = me.email || "";
  integrations();
  refreshNav();
}

async function save(fields, done, where = "profile") {
  $("b-save").disabled = true;
  try { show(await saveProfile(fields)); say(where, done, "ok"); }
  catch (e) { say(where, esc(e.message), "bad"); }
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
  $("p-edit").open = true;
  say("profile", "Saving…");
  try { await save({ avatar: await shrink(f) }, "Photo saved."); } catch (e) { say("profile", esc(e.message), "bad"); }
});
$("b-nophoto").onclick = () => save({ avatar: null }, "Photo removed.");
$("vis").addEventListener("click", e => {
  const b = e.target.closest("button[data-v]");
  if (!b || (b.dataset.v === "1") === !!saved.public) return;
  if (b.dataset.v === "1" && !confirm("Let everyone on Motus see your numbers?")) return;
  save({ public: b.dataset.v === "1" }, "Saved.", "privacy");
});

$("b-copy").onclick = async () => {
  try { await navigator.clipboard.writeText($("link").href); say("privacy", "Copied.", "ok"); }
  catch (e) { say("privacy", "Press and hold the link to copy it.", "bad"); }
};
$("b-share").onclick = () => navigator.share({ title: saved.name || "Motus", url: $("link").href }).catch(() => {});

$("b-out").onclick = async () => {
  if (!confirm("Sign out?")) return;
  await signOut();
  location.href = "./";
};
$("b-delete").onclick = async () => {
  if (!confirm("Delete your Motus account and everything in it? This can't be undone.")) return;
  try { await deleteAccount(); location.href = "./"; } catch (e) { say("account", esc(e.message), "bad"); }
};

// one part open at a time keeps the page short
const parts = [...document.querySelectorAll(".parts details")];
parts.forEach(d => d.addEventListener("toggle", () => { if (d.open) parts.forEach(o => { if (o !== d) o.open = false; }); }));

initNav("profile");
initStandards($("std"));
function signedIn(on) {
  $("out").hidden = on;
  for (const id of ["in", "p-friends", "p-int", "p-edit", "p-privacy", "p-acct"]) $(id).hidden = !on;
}
const me = cachedMe();
signedIn(!!me);
if (me) { show({ name: me.profile && me.profile.name, username: me.profile && me.profile.username, avatar: cachedPhoto(), public: !!(me.profile && me.profile.public) }); friends(); }
checkAccount().then(async r => {
  signedIn(!!r.me);
  if (r.me) { show(await getProfile().catch(() => saved)); friends(); }
});
