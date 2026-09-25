// Per-day summary cache. One record per calendar date D:
//   night: the main sleep that ended on the morning of D, with overnight physiology
//   day:   activity and heart-rate load over D (00:00-24:00)
//   scores: Sleep / Recovery / Activity (analytics/scores.js), filled by scoreDays()
// Trends and scores read these, never months of raw 5-s heart rate.
import { hrmaxTanaka, zonesAndLoad } from "./metrics.js?v=20260924214250";
import { detectWorkouts } from "./workouts.js?v=20260924214250";
import { nightSleep } from "./sleep.js?v=20260924214250";
import { sleepingBandHRV, sleepingHR, sleepingSpO2, sleepingTemp } from "./overnight.js?v=20260924214250";
import { nightPPI, nightRespiration } from "./ppi.js?v=20260924214250";
import { median } from "./baseline.js?v=20260924214250";
import { cvhr } from "./watch.js?v=20260924214250";
import { cardiacCost, hrByStage } from "./fitness.js?v=20260924214250";

export const SUMMARY_VERSION = 6; // bump to force a rebuild when the definitions change

const prevDate = (date) => {
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) - 1));
  return d.toISOString().slice(0, 10);
};

/** Beta-blockers blunt heart rate; Brawner 2004: HRmax ≈ 164 − 0.7 × age for people taking them. */
export function hrMaxFor(profile) {
  if (profile?.hrmax) return profile.hrmax;
  if (!profile?.age) return null;
  return profile.betablocker ? 164 - 0.7 * profile.age : hrmaxTanaka(profile.age);
}

/**
 * Pure: builds the summary for `date` from raw rows covering [date−1 18:00, date+1 00:00).
 * data = {hr: [{t,bpm}], sleep: [{t,stage}], spo2: [{t,pct}], temp: [{t,c}], hrv: [{t,hrv_ms,...}],
 *         daily: [{date,steps,km,kcal}], activity: [{t,steps}]}.
 * ctx = {restHint: resting HR to use for zones when tonight has none}.
 */
export function computeDay(data, date, profile = {}, ctx = {}) {
  const out = { date, v: SUMMARY_VERSION, night: null, day: null };
  const prev = prevDate(date);
  const inWin = (t, a, b) => t >= a && t < b;
  const sleepRows = data.sleep.filter((r) => inWin(r.t, `${prev} 18:00:00`, `${date} 14:00:00`)).map((r) => [r.t, r.stage]);
  const hrAll = data.hr.map((r) => [r.t, r.bpm]);

  const sl = nightSleep(sleepRows, date);
  if (sl) {
    const hr = sleepingHR(hrAll, sl.onset, sl.wake);
    out.night = {
      sleep: { ...sl, stages: undefined },
      stages: sl.stages,
      hr, hrv: sleepingBandHRV(data.hrv, sl.onset, sl.wake),
      ppi: nightPPI(data.ppi ?? [], sl.onset, sl.wake),
      resp: nightRespiration(data.ppi ?? [], sl.onset, sl.wake),
      spo2: sleepingSpO2(data.spo2, sl.onset, sl.wake),
      temp: sleepingTemp(data.temp, sl.onset, sl.wake),
      cvhr: compactCvhr(cvhr(data.hr, sl.onset, sl.wake, sl.stages)),
      stage_hr: stageHr(data.hr, sl.stages),
    };
  } else {
    // No band sleep record: fall back to 00:00-06:00 so resting HR and temperature still trend.
    const hr = sleepingHR(hrAll, `${date} 00:00:00`, `${date} 06:00:00`);
    const temp = sleepingTemp(data.temp, `${date} 00:00:00`, `${date} 06:00:00`);
    if (hr || temp) out.night = { sleep: null, stages: null, hr, hrv: null, ppi: nightPPI(data.ppi ?? [], `${date} 00:00:00`, `${date} 06:00:00`),
      spo2: sleepingSpO2(data.spo2, `${date} 00:00:00`, `${date} 06:00:00`), temp, fallback: true };
  }

  // Day (00:00-24:00): steps, awake heart rate, workouts and load.
  const d0 = `${date} 00:00:00`, d1 = `${date} 23:59:59`;
  const dayHr = hrAll.filter(([t]) => t >= d0 && t <= d1);
  const totals = data.daily.find((r) => r.date === date) ?? null;
  const act = (data.activity ?? []).filter((r) => r.t >= d0 && r.t <= d1);
  const wake = out.night?.sleep?.wake ?? `${date} 07:00:00`;
  const awake = dayHr.filter(([t]) => t >= wake);
  const hrMax = hrMaxFor(profile);
  const rest = out.night?.hr?.rhr ?? ctx.restHint ?? null;
  let load = null, bouts = [];
  if (hrMax && rest && profile.sex) {
    load = zonesAndLoad(dayHr, d0, `${date} 23:59:59`, rest, hrMax, profile.sex);
    bouts = detectWorkouts(dayHr, rest, hrMax, { sex: profile.sex }).map((w) => ({ ...w, kind: classifyBout(w, act) }));
  }
  // Asleep/awake state per minute of this calendar date, for the Sleep Regularity Index:
  // '1' asleep, '0' awake while the band was worn, '.' unknown.
  out.states = dayStates(data.sleep, hrAll, date);

  if (dayHr.length || totals) {
    out.day = {
      steps: totals?.steps ?? (act.length ? act.reduce((s, r) => s + r.steps, 0) : null),
      km: totals?.km ?? null, kcal: totals?.kcal ?? null,
      hr_mean_awake: awake.length ? awake.reduce((s, [, v]) => s + v, 0) / awake.length : null,
      hr_max: dayHr.length ? Math.max(...dayHr.map(([, v]) => v)) : null,
      hr_hourly: hourlyMeans(dayHr),
      wear_min: wearMinutes(dayHr),
      zone_minutes: load?.zone_minutes ?? null, trimp: load?.trimp ?? null,
      workouts: bouts,
      activity: act.length ? activityStats(act) : null,
      cardiac_cost: compactCost(rest != null && act.length ? cardiacCost(data.hr.filter((r) => r.t >= d0 && r.t <= d1), minuteSteps(act), date, rest) : null),
      temp_hourly: hourlyValues(data.temp.filter((r) => r.t >= d0 && r.t <= d1 && r.c > 25 && r.c < 42).map((r) => [r.t, r.c])),
    };
  }
  return out;
}

export function dayStates(sleepRows, hrAll, date) {
  const st = new Array(1440).fill(".");
  const d0 = `${date} 00:00:00`, d1 = `${date} 23:59:59`;
  for (const [t] of hrAll) if (t >= d0 && t <= d1) st[+t.slice(11, 13) * 60 + +t.slice(14, 16)] = "0";
  // Fill wear gaps up to 10 min between readings (the band samples HR continuously while worn).
  let last = -99;
  for (let i = 0; i < 1440; i++) {
    if (st[i] === "0") { if (i - last > 1 && i - last <= 10) for (let k = last + 1; k < i; k++) st[k] = "0"; last = i; }
  }
  for (const r of sleepRows) if (r.t >= d0 && r.t <= d1) st[+r.t.slice(11, 13) * 60 + +r.t.slice(14, 16)] = r.stage >= 1 && r.stage <= 3 ? "1" : "0";
  return st.join("");
}

/** Mean heart rate for each clock hour of the day (null where not worn), plus min and max. */
export function hourlyMeans(samples) {
  const acc = Array.from({ length: 24 }, () => [0, 0, 999, 0]);
  for (const [t, v] of samples) { const e = acc[+t.slice(11, 13)]; e[0] += v; e[1]++; e[2] = Math.min(e[2], v); e[3] = Math.max(e[3], v); }
  return acc.map(([sum, n, lo, hi]) => (n ? [Math.round((sum / n) * 10) / 10, lo, hi] : null));
}

/** Experimental cyclic-HR (CVHR) index for the night, without the per-event list. */
function compactCvhr(c) { return c && c.index != null ? { index: Math.round(c.index * 10) / 10, hours: Math.round(c.hours * 10) / 10, events: c.events.length } : null; }
function compactCost(c) { return c ? { bpmPer100spm: Math.round(c.bpmPer100spm * 10) / 10, walkingHr: Math.round(c.walkingHr), cadence: Math.round(c.cadence), minutes: c.minutes } : null; }
/** Mean heart rate in each sleep stage (per-minute alignment of 5-s HR with the band's stage codes). */
function stageHr(hrRows, stages) {
  if (!stages?.length) return null;
  const st = new Map(stages.map(([t, c]) => [t.slice(0, 16), c])), acc = new Map();
  for (const r of hrRows) { const k = r.t.slice(0, 16); if (!st.has(k)) continue; const e = acc.get(k) ?? [0, 0]; e[0] += r.bpm; e[1]++; acc.set(k, e); }
  const hr = new Map([...acc].map(([k, [s, n]]) => [k, s / n]));
  const out = hrByStage(st, hr);
  return out && (out.deep ?? out.light ?? out.rem) != null ? { deep: out.deep, light: out.light, rem: out.rem, awake: out.awake } : null;
}

/** Mean of [t, value] samples for each clock hour (null where none). */
export function hourlyValues(samples) {
  const acc = Array.from({ length: 24 }, () => [0, 0]);
  for (const [t, v] of samples) { const e = acc[+t.slice(11, 13)]; e[0] += v; e[1]++; }
  return acc.map(([sum, n]) => (n ? Math.round((sum / n) * 100) / 100 : null));
}

/** Minutes of the day with at least one HR sample (the band only reports HR while worn). */
export function wearMinutes(samples) {
  const set = new Set(samples.map(([t]) => t.slice(0, 16)));
  return set.size;
}

/** Per-minute step counts for the day: {minuteOfDay: steps} from the band's 10-minute blocks. */
export function minuteSteps(act) {
  const m = new Map();
  for (const r of act) {
    const base = +r.t.slice(11, 13) * 60 + +r.t.slice(14, 16);
    (r.minute ?? [r.steps]).forEach((v, i) => { if (v && base + i < 1440) m.set(base + i, (m.get(base + i) ?? 0) + v); });
  }
  return m;
}

/** Walking/running when the bout averages ≥ 60 steps a minute, otherwise "strength or other"
 *  (heart rate up without walking: lifting, cycling, yard work). Needs the band's step blocks. */
function classifyBout(w, act) {
  if (!act.length) return null;
  const mins = minuteSteps(act);
  const a = +w.start.slice(11, 13) * 60 + +w.start.slice(14, 16), b = +w.end.slice(11, 13) * 60 + +w.end.slice(14, 16);
  let steps = 0;
  for (let m = a; m <= b; m++) steps += mins.get(m) ?? 0;
  const perMin = steps / Math.max(1, w.minutes);
  return perMin >= 60 ? (perMin >= 140 ? "run" : "walk") : "other";
}

/**
 * Minute-level cadence (the band stores steps per minute inside its 10-minute blocks):
 * moderate ≥ 100 and vigorous ≥ 130 steps/min (Tudor-Locke 2018, CADENCE-Adults), peak 1-minute
 * cadence, peak-30 cadence (mean of the day's 30 highest minutes; Saint-Maurice 2020 / Tudor-Locke),
 * active hours (≥ 250 steps), hourly steps.
 */
export function activityStats(act) {
  const mins = minuteSteps(act);
  const vals = [...mins.values()];
  const sorted = [...vals].sort((a, b) => b - a);
  const hourly = new Array(24).fill(0);
  for (const [m, v] of mins) hourly[Math.floor(m / 60)] += v;
  return {
    mvpa_min: vals.filter((v) => v >= 100).length,
    light_min: vals.filter((v) => v >= 60 && v < 100).length, // light walking (below the 100 steps/min brisk threshold)
    vigorous_min: vals.filter((v) => v >= 130).length,
    peak1: sorted[0] ?? 0,
    peak30: sorted.length ? sorted.slice(0, 30).reduce((s, v) => s + v, 0) / 30 : 0,
    active_hours: hourly.filter((s) => s >= 250).length,
    hourly,
  };
}

/** Reads what computeDay needs for `date` from IndexedDB. */
export async function loadDay(store, dbm, date) {
  const prev = prevDate(date);
  const a = `${prev} 18:00:00`, b = `${date} 23:59:59`;
  const [hr, sleep, spo2, temp, hrv, activity, ppi] = await Promise.all(
    ["hr", "sleep", "spo2", "temp", "hrv_vendor", "activity", "ppi"].map((s) => dbm.range(store, s, a, b)));
  const daily = (await dbm.all(store, "daily")).filter((r) => r.date === date);
  return { hr, sleep, spo2, temp, hrv, activity, daily, ppi };
}

/** Recompute summaries for `dates` (Set or array of "YYYY-MM-DD"), then rescore. */
export async function recomputeDays(store, dbm, dates, profile, scoreDays) {
  const list = [...new Set([...dates].flatMap((d) => [d, nextDate(d)]))].filter((d) => d <= todayStr()).sort();
  let restHint = null;
  for (const date of list) {
    const data = await loadDay(store, dbm, date);
    const prior = await dbm.summaries(store, prevDate(prevDate(prevDate(date))), prevDate(date));
    restHint = median(prior.map((s) => s.night?.hr?.rhr)) ?? restHint;
    const s = computeDay(data, date, profile, { restHint });
    if (s.night || s.day) await dbm.put(store, "summary", s);
  }
  if (scoreDays && list.length) await rescore(store, dbm, list[0], profile, scoreDays);
}

/** Scores every summary from `from` to today using the 28 days before each as its baseline. */
export async function rescore(store, dbm, from, profile, scoreDays) {
  const start = new Date(Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10) - 40)).toISOString().slice(0, 10);
  const rows = await dbm.summaries(store, start, todayStr());
  const scored = scoreDays(rows, profile);
  await dbm.putMany(store, "summary", scored.filter((s) => s.date >= from));
}

/** Builds any missing or outdated summaries (first run of v2, or after SUMMARY_VERSION changes). */
export async function ensureSummaries(store, dbm, profile, scoreDays, onProgress = () => {}) {
  const first = await firstDataDate(store, dbm);
  if (!first) return;
  const have = new Map((await dbm.summaries(store, first, todayStr())).map((s) => [s.date, s.v]));
  const need = [];
  for (let d = first; d <= todayStr(); d = nextDate(d)) if (have.get(d) !== SUMMARY_VERSION) need.push(d);
  if (!need.length) return;
  onProgress(`Analysing ${need.length} day${need.length > 1 ? "s" : ""}…`);
  await recomputeDays(store, dbm, need, profile, scoreDays);
}

async function firstDataDate(store, dbm) {
  const req = (r) => new Promise((ok, err) => { r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error); });
  let first = null;
  for (const s of ["hr", "sleep"]) {
    const cur = await req(store.transaction(s).objectStore(s).index("t").openCursor());
    const t = cur?.value?.t;
    if (t && (!first || t < first)) first = t;
  }
  return first ? first.slice(0, 10) : null;
}

const nextDate = (date) => new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) + 1)).toISOString().slice(0, 10);
const todayStr = () => { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
export { nextDate, prevDate };
