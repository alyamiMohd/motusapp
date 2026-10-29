// Profile: a name, a photo and a username that can be shared (…/u/<username>), plus signing out and deleting the account.
import { initNav, initStandards, refreshNav, esc } from "../core.js";
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
  const pub = !!p.public;
  for (const b of $("vis").querySelectorAll("button")) b.setAttribute("aria-pressed", String((b.dataset.v === "1") === pub));
  $("vis-note").textContent = pub ? "Everyone signed in to Motus can see your sleep, steps, calories, weight and workouts. Your email never shows."
    : "Only your friends can see your sleep, steps, calories, weight and workouts. Others see just your name and photo.";
  $("share-note").textContent = pub ? "Anyone with the link sees your name and photo; people signed in to Motus also see your dashboard."
    : "Anyone with the link sees your name and photo, and can ask to be your friend. Your numbers show only to friends.";
  $("sharebox").hidden = !p.username;
  if (p.username) { const l = profileLink(p.username); $("link").href = l; $("link").textContent = l; }
  $("b-share").hidden = !navigator.share;
  $("email").textContent = me.email || "";
  const n = me.requests || 0;
  $("friends-sub").textContent = n ? `${n} asking to be friends` : "Find people and see how they're doing";
  $("friends-sub").className = n ? "good" : "";
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
$("vis").addEventListener("click", e => {
  const b = e.target.closest("button[data-v]");
  if (!b || (b.dataset.v === "1") === !!saved.public) return;
  if (b.dataset.v === "1" && !confirm("Make your dashboard public? Everyone signed in to Motus will see your sleep, steps, calories, weight and workouts.")) return;
  save({ public: b.dataset.v === "1" }, b.dataset.v === "1" ? "Your dashboard is public now." : "Only your friends can see your dashboard now.");
});

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

initNav("profile");
initStandards($("std"));
const me = cachedMe();
$("out").hidden = !!me; $("in").hidden = !me; $("acct").hidden = !me;
if (me) show({ name: me.profile && me.profile.name, username: me.profile && me.profile.username, avatar: cachedPhoto(), public: !!(me.profile && me.profile.public) });
checkAccount().then(async r => {
  $("out").hidden = !!r.me; $("in").hidden = !r.me; $("acct").hidden = !r.me;
  if (r.me) show(await getProfile().catch(() => saved));
});
