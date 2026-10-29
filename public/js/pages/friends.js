// Friends: find people by name or @username, ask them to be friends, answer requests, and open a friend's dashboard
// (their profile page, /u/<username>). Who can see whose numbers is decided on the server (worker/friends.js).
import { initNav, refreshNav, esc } from "../core.js";
import { checkAccount, cachedMe, getFriends, searchPeople, addFriend, acceptFriend, removeFriend, profileLink } from "../account.js";

const $ = id => document.getElementById(id);
const say = (html, kind = "") => { const el = $("m-find"); el.className = "msg " + kind; el.innerHTML = html; };

// one person: photo or initial, name and @username (a link to their profile), and the buttons for how we relate
function row(p, rel) {
  const name = p.name || "@" + p.username, initial = esc((name.replace(/^@/, "").trim().charAt(0) || "M").toUpperCase());
  const face = p.avatar && /^data:image\//.test(p.avatar) ? `<img src="${esc(p.avatar)}" alt="">` : `<span>${initial}</span>`;
  const btn = (act, text, cls = "ghost") => `<button class="btn small ${cls}" type="button" data-act="${act}" data-u="${esc(p.username)}">${text}</button>`;
  const actions = {
    none: btn("add", "Add", ""),
    requested: btn("cancel", "Requested"),
    incoming: btn("accept", "Accept", "") + btn("decline", "Decline"),
    friend: "",
  }[rel] || "";
  const sub = "@" + esc(p.username) + (rel === "friend" ? "" : p.public ? " · public" : "");
  return `<li><a class="who" href="${esc(profileLink(p.username))}"><span class="pic">${face}</span>` +
    `<span><b>${esc(name)}</b><small>${sub}</small></span></a>${actions ? `<span class="acts">${actions}</span>` : ""}</li>`;
}

async function lists() {
  let f;
  try { f = await getFriends(); } catch (e) { say(esc(e.message), "bad"); return; }
  $("nouser").hidden = !!f.username;
  $("friends").innerHTML = f.friends.map(p => row(p, "friend")).join("");
  $("nofriends").hidden = f.friends.length > 0;
  $("incoming").innerHTML = f.incoming.map(p => row(p, "incoming")).join("");
  $("s-incoming").hidden = !f.incoming.length;
  $("outgoing").innerHTML = f.outgoing.map(p => row(p, "requested")).join("");
  $("s-outgoing").hidden = !f.outgoing.length;
}

let timer, last = "";
async function find() {
  const q = $("q").value.trim();
  if (q === last) return;
  last = q;
  if (q.replace(/^@/, "").length < 2) { $("results").innerHTML = ""; say(""); return; }
  try {
    const { people } = await searchPeople(q);
    if (q !== last) return;
    $("results").innerHTML = people.map(p => row(p, p.relation)).join("");
    say(people.length ? "" : "No one found. Private profiles show only for their exact @username.");
  } catch (e) { say(esc(e.message), "bad"); }
}
$("q").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(find, 250); });

document.addEventListener("click", async e => {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  const u = b.dataset.u, act = b.dataset.act;
  if (act === "decline" && !confirm(`Decline @${u}'s request?`)) return;
  b.disabled = true;
  try {
    if (act === "add") { const r = await addFriend(u); say(r.relation === "friend" ? `You and @${esc(u)} are friends now.` : `Asked @${esc(u)}. You'll be friends when they accept.`, "ok"); }
    if (act === "accept") { await acceptFriend(u); say(`You and @${esc(u)} are friends now.`, "ok"); }
    if (act === "cancel" || act === "decline") await removeFriend(u);
  } catch (err) { say(esc(err.message), "bad"); b.disabled = false; return; }
  last = ""; await Promise.all([lists(), find()]);
  checkAccount().then(refreshNav);                    // the dot on the profile button goes once requests are answered
});

function privacyNote(me) {
  const pub = me && me.profile && me.profile.public;
  $("privacy").innerHTML = (pub ? "Your profile is <b>public</b>: everyone on Motus can see your dashboard."
    : "Your profile is <b>private</b>: only your friends can see your dashboard.") + ` Change it on your <a href="profile.html"><u>Profile</u></a>.`;
}

initNav("profile");
const show = me => { $("out").hidden = !!me; $("in").hidden = !me; if (me) { privacyNote(me); lists(); } };
show(cachedMe());
checkAccount().then(r => { if (!!r.me !== !!cachedMe() || r.me) show(r.me); });
