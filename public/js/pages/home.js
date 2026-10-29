// Home: your own dashboard (js/dashboard.js), a banner when something needs attention, and where the data came from.
import { today, add, dayMonth, esc, initNav, DAY_SHORT, dow } from "../core.js";
import { getData } from "../store.js";
import { autoRefresh, cachedMe } from "../account.js";
import { drawDashboard } from "../dashboard.js";

let data, days;
const load = () => { data = getData(); days = data.days; };

function banner() {
  const el = document.getElementById("banner");
  if (data.demo) {
    el.innerHTML = 'You’re looking at <b>demo data</b> from a made-up person. <a href="connect.html">Connect your apps</a> to see your own.';
  } else {
    const newest = Object.keys(days).filter(d => d <= today).sort().pop(), me = cachedMe();
    if (me && me.hevy && me.hevy.error) el.innerHTML = `Hevy didn't sync: ${esc(me.hevy.error)} <a href="connect.html">Connect it again</a>.`;
    else if (newest && newest < add(today, -2)) el.innerHTML = `Your newest data is from ${DAY_SHORT[dow(newest)]} ${dayMonth(newest)}. ` +
      (me && me.health && me.health.connected ? "Check that the Motus automation on your iPhone is on." : '<a href="connect.html">Connect your apps</a> to keep it up to date.');
    else { el.hidden = true; return; }
  }
  el.hidden = false;
}

function footer() {
  const el = document.getElementById("foot");
  if (data.demo) { el.textContent = "Demo data, made up in your browser. Nothing here is a real person."; return; }
  const when = iso => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  el.textContent = "From " + data.sources.map(s => s.imported ? `${s.name} (updated ${when(s.imported)})` : s.name).join(", ") +
    (cachedMe() ? ". Kept in your Motus account." : ". Stored on this device only.");
}

const render = () => drawDashboard(data);

const show = () => { load(); render(); banner(); footer(); };
initNav("home", render);
show();
autoRefresh().then(changed => { if (changed) show(); });
