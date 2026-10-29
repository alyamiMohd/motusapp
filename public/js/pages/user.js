// Someone's public profile at /u/<username>: their name, photo and username only, never their numbers.
const $ = id => document.getElementById(id);
const username = decodeURIComponent((location.pathname.match(/^\/u\/([^/]+)/) || [])[1] || "");

async function show() {
  let p = null;
  try {
    const res = await fetch("/api/u/" + encodeURIComponent(username));
    if (res.ok) p = await res.json();
  } catch (e) {}
  if (!p || !p.username) { $("none").hidden = false; return; }
  $("name").textContent = p.name || "@" + p.username;
  $("user").textContent = "@" + p.username;
  $("initial").textContent = ((p.name || p.username).trim().charAt(0) || "M").toUpperCase();
  if (p.avatar && /^data:image\//.test(p.avatar)) { $("photo").src = p.avatar; $("photo").hidden = false; $("initial").hidden = true; }
  document.title = (p.name || "@" + p.username) + " · Motus";
  $("card").hidden = false;
}
show();
