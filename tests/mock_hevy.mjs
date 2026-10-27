// A stand-in for Hevy's API, for trying the whole Connect Hevy flow on `npm run dev` without a real key.
// Run `node tests/mock_hevy.mjs` and put HEVY_API=http://127.0.0.1:8790/v1 in .dev.vars. Accepts the key
// "mock-hevy-key-123"; serves made-up workouts for the last 10 weeks, 10 per page, like /v1/workouts/events.
import { createServer } from "node:http";

const KEY = "mock-hevy-key-123", PORT = Number(process.env.PORT || 8790);
const LIFTS = [["Bench Press (Barbell)", 60], ["Squat (Barbell)", 80], ["Lat Pulldown (Cable)", 50], ["Overhead Press (Dumbbell)", 18],
  ["Romanian Deadlift (Barbell)", 70], ["Seated Cable Row - V Grip (Cable)", 55]];
const workouts = [];
for (let d = 70; d >= 1; d--) {
  const day = new Date(Date.now() - d * 864e5);
  if (![1, 2, 4, 5].includes(day.getUTCDay())) continue;      // Mon, Tue, Thu, Fri
  day.setUTCHours(15, 0, 0, 0);
  const n = workouts.length, grow = Math.floor((70 - d) / 14) * 2.5;
  workouts.push({ id: `mock-${n + 1}`, title: n % 2 ? "Pull" : "Push", description: "", start_time: day.toISOString(),
    end_time: new Date(day.getTime() + 55 * 60000).toISOString(), updated_at: day.toISOString(), created_at: day.toISOString(),
    exercises: LIFTS.slice(n % 2 * 3, n % 2 * 3 + 3).map(([title, kg], i) => ({ index: i, title, notes: "", exercise_template_id: "X",
      sets: [0, 1, 2].map(s => ({ index: s, type: s ? "normal" : "warmup", weight_kg: s ? kg + grow : kg / 2, reps: s ? 8 : 10, rpe: null })) })) });
}

createServer((req, res) => {
  const url = new URL(req.url, "http://x"), send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.headers["api-key"] !== KEY) return send(401, { error: "Unauthorized" });
  if (url.pathname === "/v1/user/info") return send(200, { data: { id: "mock-user", name: "Test", url: "" } });
  if (url.pathname === "/v1/workouts/events") {
    const since = new Date(url.searchParams.get("since") || 0), size = Number(url.searchParams.get("pageSize") || 10);
    const page = Number(url.searchParams.get("page") || 1), list = workouts.filter(w => new Date(w.updated_at) > since);
    const page_count = Math.max(1, Math.ceil(list.length / size));
    if (page > page_count) return send(404, { error: "Page not found" });
    return send(200, { page, page_count, events: list.slice((page - 1) * size, page * size).map(workout => ({ type: "updated", workout })) });
  }
  send(404, { error: "Not found" });
}).listen(PORT, "127.0.0.1", () => console.log(`mock Hevy on http://127.0.0.1:${PORT}/v1 (${workouts.length} workouts)`));
