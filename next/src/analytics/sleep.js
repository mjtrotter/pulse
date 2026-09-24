// Sleep metrics from the band's per-minute stage codes (1 deep, 2 light, 3 REM, 4 awake; others = awake).
// Rows: [[t "YYYY-MM-DD hh:mm:ss", code], ...]. Wrist staging is approximate (Chinoy 2021); timing,
// duration and continuity are the robust parts, so scores weight those.

const ASLEEP = new Set([1, 2, 3]);
const STAGE = { 1: "deep", 2: "light", 3: "rem" };
const toMin = (t) => Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10), +t.slice(11, 13), +t.slice(14, 16)) / 60e3;
const fromMin = (m) => {
  const d = new Date(m * 60e3), p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00`;
};

/**
 * Splits minute rows into sleep periods: runs of asleep minutes joined across awake gaps of up to
 * `maxGap` minutes (normal night awakenings) and across missing minutes of up to `maxMissing`.
 * Returns periods [{start, end, rows}] with start = first asleep minute, end = last asleep minute + 1.
 */
export function sleepPeriods(rows, { maxGap = 60, maxMissing = 30 } = {}) {
  const pts = rows.map(([t, s]) => [toMin(t), s]).sort((a, b) => a[0] - b[0]);
  const periods = [];
  let cur = null, lastAsleep = null, prevMin = null;
  for (const [m, s] of pts) {
    const gapMissing = prevMin !== null && m - prevMin > maxMissing + 1;
    if (cur && (gapMissing || (lastAsleep !== null && ASLEEP.has(s) && m - lastAsleep > maxGap + 1))) {
      periods.push(cur); cur = null; lastAsleep = null;
    }
    if (ASLEEP.has(s)) {
      if (!cur) cur = { startMin: m, rows: [] };
      lastAsleep = m;
    }
    if (cur) cur.rows.push([m, s]);
    if (cur && lastAsleep !== null && m - lastAsleep > maxGap) { periods.push(cur); cur = null; lastAsleep = null; }
    prevMin = m;
  }
  if (cur) periods.push(cur);
  return periods.map((p) => {
    const asleepRows = p.rows.filter(([, s]) => ASLEEP.has(s));
    const endMin = asleepRows[asleepRows.length - 1][0] + 1;
    const inside = p.rows.filter(([m]) => m < endMin);
    return { start: fromMin(p.startMin), end: fromMin(endMin), startMin: p.startMin, endMin, rows: inside };
  });
}

/**
 * Summary of one sleep period: time asleep (TST), in bed (from the band's first to last record in
 * the window), efficiency, WASO (awake minutes between onset and final wake), awakenings (awake runs
 * of ≥ 1 min after onset), stage minutes and percentages, and the midpoint in minutes after the
 * previous midnight (can exceed 1440 for late sleepers).
 */
export function periodSummary(period, recordStart = null, recordEnd = null) {
  const mins = { deep: 0, light: 0, rem: 0, awake: 0 };
  let wakes = 0, prevAsleep = false, longestWake = 0, run = 0;
  for (const [, s] of period.rows) {
    const asleep = ASLEEP.has(s);
    mins[STAGE[s] ?? "awake"]++;
    if (!asleep) { run++; if (prevAsleep) wakes++; } else { longestWake = Math.max(longestWake, run); run = 0; }
    prevAsleep = asleep;
  }
  const tst = mins.deep + mins.light + mins.rem;
  const span = period.endMin - period.startMin;
  const inBedStart = recordStart ? Math.min(toMin(recordStart), period.startMin) : period.startMin;
  const inBedEnd = recordEnd ? Math.max(toMin(recordEnd), period.endMin) : period.endMin;
  const inBed = Math.max(span, inBedEnd - inBedStart);
  const midnight = Math.floor(period.startMin / 1440) * 1440;
  const mid = (period.startMin + period.endMin) / 2 - midnight;
  return {
    onset: period.start, wake: period.end, asleep: tst, span, in_bed: inBed,
    efficiency: inBed ? (100 * tst) / inBed : null, waso: mins.awake, awakenings: wakes, longest_wake: longestWake,
    onset_latency: Math.max(0, period.startMin - inBedStart),
    ...mins,
    pct: tst ? { deep: (100 * mins.deep) / tst, light: (100 * mins.light) / tst, rem: (100 * mins.rem) / tst } : null,
    onset_min: period.startMin - midnight, wake_min: period.endMin - midnight, midpoint_min: mid,
  };
}

/**
 * The main sleep for the night ending on `date` ("YYYY-MM-DD"): the longest period that ends between
 * 03:00 on `date` and 14:00 on `date` (so an 8 pm-4 am shift still counts) from rows spanning
 * 18:00 the day before to 14:00. Other periods in the window are returned as naps.
 */
export function nightSleep(rows, date) {
  const periods = sleepPeriods(rows);
  if (!periods.length) return null;
  const d0 = toMin(`${date} 00:00:00`);
  const cands = periods.filter((p) => p.endMin > d0 + 3 * 60 && p.endMin <= d0 + 14 * 60 && p.startMin >= d0 - 8 * 60);
  if (!cands.length) return null;
  const main = cands.reduce((a, b) => (b.endMin - b.startMin > a.endMin - a.startMin ? b : a));
  const first = rows.length ? rows.reduce((a, b) => (b[0] < a ? b[0] : a), rows[0][0]) : null;
  const s = periodSummary(main, first && first >= fromMin(main.startMin - 120) ? first : null, null);
  if (s.asleep < 120) return null; // under 2 h is a nap, not a night
  s.naps = periods.filter((p) => p !== main).map((p) => ({ start: p.start, end: p.end, minutes: periodSummary(p).asleep }))
    .filter((n) => n.minutes >= 10);
  s.stages = main.rows.map(([m, code]) => [fromMin(m), code]);
  return s;
}

/**
 * Recommended sleep for adults (National Sleep Foundation, Hirshkowitz 2015; AASM/SRS Watson 2015):
 * 7-9 h for 18-64, 7-8 h for 65+. Returns {min, max} in minutes.
 */
export function sleepNeed(age) {
  return age >= 65 ? { min: 420, max: 480 } : { min: 420, max: 540 };
}

/**
 * Sleep Regularity Index (Phillips et al. 2017): the probability of being in the same state
 * (asleep/awake) at any two time points 24 h apart, rescaled to −100..100 (100 = perfectly regular):
 * SRI = 200·P(same) − 100. `days` is an array of per-day 1440-slot arrays (1 asleep, 0 awake,
 * null unknown) for consecutive days. Pairs with a null on either side are skipped.
 * Returns {sri, pairs, days} or null if fewer than `minDays` days with data.
 */
export function sleepRegularityIndex(days, minDays = 5) {
  let same = 0, pairs = 0, used = 0;
  const flat = days.flat();
  for (const d of days) if (d.some((v) => v !== null)) used++;
  if (used < minDays) return null;
  for (let i = 0; i + 1440 < flat.length; i++) {
    const a = flat[i], b = flat[i + 1440];
    if (a === null || b === null) continue;
    pairs++;
    if (a === b) same++;
  }
  if (pairs < 1440 * (minDays - 1) * 0.5) return null;
  return { sri: 200 * (same / pairs) - 100, pairs, days: used };
}

/** 1440-slot asleep/awake array for calendar day `date` from sleep periods (null where unknown).
 *  Minutes inside a recorded period are 1/0 by stage; outside any record the person is assumed awake
 *  when the band was worn (hasWear(minuteOfDay) true), else unknown. */
export function dayStateArray(stageRows, date, hasWear = () => true) {
  const d0 = toMin(`${date} 00:00:00`);
  const out = new Array(1440).fill(null);
  for (let i = 0; i < 1440; i++) if (hasWear(i)) out[i] = 0;
  for (const [t, s] of stageRows) {
    const i = toMin(t) - d0;
    if (i >= 0 && i < 1440) out[i] = ASLEEP.has(s) ? 1 : 0;
  }
  return out;
}

/** Circular mean and SD (minutes) of clock times given as minutes after midnight. */
export function circularStats(mins) {
  if (!mins.length) return null;
  const a = mins.map((m) => (2 * Math.PI * m) / 1440);
  const C = a.reduce((s, x) => s + Math.cos(x), 0) / a.length, S = a.reduce((s, x) => s + Math.sin(x), 0) / a.length;
  const R = Math.min(1, Math.hypot(C, S));
  const mean = ((Math.atan2(S, C) * 1440) / (2 * Math.PI) + 1440) % 1440;
  const sd = R > 0 ? (Math.sqrt(-2 * Math.log(R)) * 1440) / (2 * Math.PI) : Infinity;
  return { mean, sd, n: mins.length };
}

/** Signed difference a − b between two clock times in minutes, wrapped to −720..720. */
export const clockDiff = (a, b) => ((((a - b) % 1440) + 2160) % 1440) - 720;
