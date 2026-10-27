// Week-to-date averages, week starts (Sunday or Monday), weekly history, workout scoring and the demo.
// Run from the repo root:  node tests/test_core.mjs
import { check, near, section, finish } from "./harness.mjs";
const { weekStart, add, weekAvg } = await import("../public/js/core.js");
const { buildWeeks, summarizeWorkouts, sessionScore, workoutScore, exerciseStats, overallRating } = await import("../public/js/stats.js");
const { generateDemo } = await import("../public/js/demo.js");

// Sun 18 Oct .. Sat 24 Oct 2026. Today's values are deliberately tiny ("first few steps of the day").
const days = {
  "2026-10-17": { steps: 99999, calories: 9999, sleep_hours: 9, weight_kg: 90 },   // last week: must never leak in
  "2026-10-18": { steps: 6000, calories: 1500, sleep_hours: 6.0, weight_kg: 65.0 },
  "2026-10-19": { steps: 10000, calories: 1400, sleep_hours: 8.0, weight_kg: 64.0 },
  "2026-10-20": { steps: null, calories: null, sleep_hours: null, weight_kg: null },  // a day with no data
  "2026-10-21": { steps: 8000, calories: 1600, sleep_hours: 7.0, weight_kg: 64.0 },
  "2026-10-22": { steps: 400, calories: 300, sleep_hours: 7.0, weight_kg: 63.0 },   // "today" in most tests
  "2026-10-23": { steps: 12000, calories: 2000, sleep_hours: 5.0, weight_kg: 70.0 }, // the future: must never leak in
};
const S = 0, M = 1;

section("weekStart");
check("Thursday -> its Sunday", weekStart("2026-10-22", S) === "2026-10-18");
check("Sunday -> itself", weekStart("2026-10-18", S) === "2026-10-18");
check("Saturday -> the Sunday before", weekStart("2026-10-24", S) === "2026-10-18");
check("Monday start: Thursday -> its Monday", weekStart("2026-10-22", M) === "2026-10-19");
check("Monday start: Sunday -> the Monday before", weekStart("2026-10-25", M) === "2026-10-19");
check("Monday start: Monday -> itself", weekStart("2026-10-19", M) === "2026-10-19");
check("add crosses months and years", add("2026-12-31", 1) === "2027-01-01" && add("2026-03-01", -1) === "2026-02-28");

section("Thursday 22 Oct (mid-week, Sunday start)");
let t = "2026-10-22";
check("steps skip today: mean(6000, 10000, 8000)", near(weekAvg(days, "steps", t, S), 8000), weekAvg(days, "steps", t, S));
check("calories skip today: mean(1500, 1400, 1600)", near(weekAvg(days, "calories", t, S), 1500));
check("sleep includes today: mean(6, 8, 7, 7)", near(weekAvg(days, "sleep_hours", t, S), 7));
check("weight includes today: mean(65, 64, 64, 63)", near(weekAvg(days, "weight_kg", t, S), 64));
check("a no-data day is ignored, not counted as zero", weekAvg(days, "steps", t, S) > 7000);
check("Monday start drops Sunday: steps mean(10000, 8000)", near(weekAvg(days, "steps", t, M), 9000));

section("first day of a week");
t = "2026-10-25";
check("steps: nothing before today this week -> null", weekAvg({ ...days, "2026-10-25": { steps: 50 } }, "steps", t, S) === null);
check("calories: null too", weekAvg({ ...days, "2026-10-25": { calories: 80 } }, "calories", t, S) === null);
check("sleep counts today alone", near(weekAvg({ "2026-10-25": { sleep_hours: 6.5 } }, "sleep_hours", t, S), 6.5));
check("last week's days do not leak into the new week", weekAvg(days, "sleep_hours", t, S) === null);
check("Saturday 24 Oct: steps = Sunday..Friday", near(weekAvg(days, "steps", "2026-10-24", S), (6000 + 10000 + 8000 + 400 + 12000) / 5));
check("no data anywhere -> null", weekAvg({}, "steps", "2026-10-24", S) === null);

section("weekly history");
const wk = buildWeeks({ ...days, "2026-10-26": { steps: 5 } }, "2026-10-26", S);
check("only completed weeks: 11-17 and 18-24 Oct", wk.length === 2 && wk[0].start === "2026-10-11" && wk[1].end === "2026-10-24", JSON.stringify(wk.map(w => w.start)));
check("the current week never appears", !wk.some(w => w.start === "2026-10-25"));
check("averages use days with data", near(wk[1].steps, (6000 + 10000 + 8000 + 400 + 12000) / 5) && wk[1].days_with_data.steps === 5);
check("empty weeks are skipped", buildWeeks({ "2026-09-01": { steps: 1 }, "2026-10-20": { steps: 2 } }, "2026-10-26", S).length === 2);
const wkM = buildWeeks(days, "2026-10-26", M);
check("Monday weeks run Monday to Sunday", wkM.every(w => new Date(w.start + "T00:00:00Z").getUTCDay() === 1) && wkM[wkM.length - 1].end === "2026-10-25");

section("workout summaries and scoring");
const sum = summarizeWorkouts([
  { date: "2026-10-01", minutes: 60.4, title: "Push", exercises: [{ title: "Bench", sets: [{ kg: 40, reps: 10, warmup: true }, { kg: 80, reps: 5 }, { kg: 70, reps: 15 }] }] },
  { date: "2026-10-01", minutes: 20, title: "Extra", exercises: [{ title: "Bench", sets: [{ kg: 85, reps: 3 }] }] },
  { date: "bad", minutes: 5, title: "x", exercises: [] },
]);
check("two workouts on one day are counted", sum.days["2026-10-01"].workout_count === 2 && sum.days["2026-10-01"].workout_minutes === 80);
check("day volume counts every set", sum.days["2026-10-01"].workout_volume_kg === 40 * 10 + 80 * 5 + 70 * 15 + 85 * 3);
check("e1RM: best Epley set of <= 12 reps across the day", near(sum.exercises.Bench[0][1], Math.round(85 * 1.1 * 10) / 10));
check("warm-ups and >12-rep sets don't set the e1RM", sum.exercises.Bench[0][2] === 85);
check("bad dates are skipped", !sum.days.bad);
check("sessionScore: normal day = 7", sessionScore(-0.03) === 7 && sessionScore(0) === 7);
check("sessionScore: +10% = 10, capped", near(sessionScore(0.1), 10) && sessionScore(0.5) === 10);
check("sessionScore: never below 3", sessionScore(-0.9) === 3);
const ex = { Squat: [["2026-09-01", 100], ["2026-09-08", 100], ["2026-09-15", 110]], Curl: [["2026-09-15", 20]] };
const ws = workoutScore(ex, "2026-09-15");
check("workout score compares with the previous sessions", near(ws.score, 10) && ws.skipped.includes("Curl"));
check("an exercise without history is listed, not rated", workoutScore({ Curl: ex.Curl }, "2026-09-15") === null);
check("overall rating is consistency alone without comparisons",
  near(overallRating([], { "2026-10-20": { workout_count: 4 } }, 4, "2026-10-26"), 2.5));

section("demo");
const demo = generateDemo("2026-10-26");
const dd = Object.keys(demo.days).sort();
check("five months ending today", dd.length === 151 && dd[dd.length - 1] === "2026-10-26");
check("same every time (fixed seed)", JSON.stringify(generateDemo("2026-10-26")) === JSON.stringify(demo));
check("today's steps are a partial day", demo.days["2026-10-26"].steps < 3500);
check("no workout logged today yet", !demo.days["2026-10-26"].workout_count);
check("has workouts and exercise history", Object.values(demo.days).filter(d => d.workout_count).length > 50 && Object.keys(demo.exercises).length >= 15);
check("weight trends down", demo.days[dd[0]].weight_kg == null || demo.days[dd[0]].weight_kg > (demo.days["2026-10-26"].weight_kg + 2));
const st = exerciseStats(demo.exercises, "2026-10-26");
check("demo shows a 'new' exercise", st.some(s => s.title === "Cable Fly" && s.pct == null));
check("demo's last workout can be rated", workoutScore(demo.exercises, Object.keys(demo.days).filter(d => demo.days[d].workout_count).sort().pop()) !== null);

finish();
