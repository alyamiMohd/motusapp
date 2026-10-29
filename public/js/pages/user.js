// Someone's profile at /u/<username>: their name, photo and username for anyone with the link. Signed in, also how
// you relate (add, accept, remove) and their dashboard when you may see it: you're friends, or their profile is
// public. The server decides who sees what (worker/friends.js); this page only draws what it is given.
import { initNav, esc } from "../core.js";
import { cachedMe, checkAccount, getPerson, getPersonData, addFriend, acceptFriend, removeFriend, toSources } from "../account.js";
import { dataFrom } from "../store.js";
import { drawDashboard } from "../dashboard.js";

const $ = id => document.getElementById(id);
const username = decodeURIComponent((location.pathname.match(/^\/u\/([^/]+)/) || [])[1] || "");
const say = (html, kind = "") => { const el = $("m-rel"); el.className = "msg " + kind; el.innerHTML = html; };
let person = null;

function card(p) {
  $("name").textContent = p.name || "@" + p.username;
  $("user").textContent = "@" + p.username;
  if (p.avatar && /^data:image\//.test(p.avatar)) { $("photo").src = p.avatar; $("photo").hidden = false; $("initial").hidden = true; }
  document.title = (p.name || "@" + p.username) + " · Motus";
  $("card").hidden = false;
}

function buttons(rel) {
  const b = (act, text, cls = "ghost") => `<button class="btn ${cls}" type="button" data-act="${act}">${text}</button>`;
  $("rel").innerHTML = {
    none: b("add", "Add friend", ""),
    requested: b("cancel", "Requested"),
    incoming: b("accept", "Accept", "") + b("decline", "Decline"),
    friend: b("remove", "Friends ✓"),
    self: `<a class="btn ghost" href="profile.html">Edit your profile</a>`,
  }[rel] || "";
}

function why(text) { $("why").innerHTML = text; $("why").hidden = !text; }

async function dashboard() {
  try {
    const d = await getPersonData(username);
    const data = dataFrom(toSources(d));
    if (!data.sources.length) { why("No data yet."); $("dash").hidden = true; return; }
    drawDashboard(data, { own: person.relation === "self" });
    const newest = Object.keys(data.days).sort().pop();
    $("foot").textContent = newest ? `Updated ${new Date(newest + "T12:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "";
    $("dash").hidden = false; why("");
  } catch (e) { $("dash").hidden = true; why(esc(e.message)); }
}

async function show() {
  const me = cachedMe();
  if (!me) {                                          // signed out: name, photo and username only
    let p = null;
    try { const res = await fetch("/api/u/" + encodeURIComponent(username)); if (res.ok) p = await res.json(); } catch (e) {}
    if (!p || !p.username) { $("none").hidden = false; $("about").hidden = false; return; }
    card(p);
    why(`<a href="connect.html"><u>Sign in</u></a> to add as a friend.`);
    $("about").hidden = false;
    return;
  }
  try { person = await getPerson(username); }
  catch (e) { if (e.status === 404) { $("none").hidden = false; return; } why(esc(e.message)); return; }
  card(person);
  buttons(person.relation);
  if (person.canSee) dashboard();
  else { $("dash").hidden = true; why("Private. Add as a friend to see."); }
}

$("rel").addEventListener("click", async e => {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  const act = b.dataset.act, who = esc(person.name || "@" + person.username);
  if (act === "remove" && !confirm(`Remove ${person.name || "@" + person.username} from your friends? You'll stop seeing each other's private dashboards.`)) return;
  if (act === "decline" && !confirm(`Decline ${person.name || "@" + person.username}'s request?`)) return;
  b.disabled = true;
  try {
    if (act === "add") { const r = await addFriend(username); say(r.relation === "friend" ? "Friends now." : "Request sent.", "ok"); }
    if (act === "accept") { await acceptFriend(username); say("Friends now.", "ok"); }
    if (act === "cancel" || act === "decline" || act === "remove") { await removeFriend(username); say(""); }
  } catch (err) { say(esc(err.message), "bad"); b.disabled = false; return; }
  show();
});

initNav(null, () => { if (!$("dash").hidden && person) dashboard(); });
show();
checkAccount().then(r => { if (!!r.me !== !!cachedMe()) show(); });
