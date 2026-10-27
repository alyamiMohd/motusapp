// The Shortcut page: fills in the visitor's own copy (from their sync setup on this device) so the URL can be copied as is.
import { initNav } from "../core.js";
import { getSync } from "../sync.js";

let repo = (getSync() || {}).repo;
try { repo = repo || JSON.parse(localStorage.getItem("motusapp-sync-draft") || "{}").repo; } catch (e) {}
if (repo && /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(repo)) {
  document.getElementById("s-url").textContent = `https://api.github.com/repos/${repo}/dispatches`;
  document.getElementById("s-actions").href = `https://github.com/${repo}/actions`;
}
initNav("connect", () => {});
