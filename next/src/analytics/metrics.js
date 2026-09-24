// Derived metrics. Must match metrics.py on the golden vectors (web/test/metrics.test.js).

const parse = (t) => Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10),
  +t.slice(11, 13), +t.slice(14, 16), +t.slice(17, 19));
const pad = (n) => String(n).padStart(2, "0");
const fmt = (ms) => { const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; };

/** Python-compatible round(x, 1): round half to even on the decimal value. */
function round1(x) {
  const y = x * 10;
  const f = Math.floor(y);
  const diff = y - f;
  const r = Math.abs(diff - 0.5) < 1e-9 ? (f % 2 === 0 ? f : f + 1) : Math.round(y);
  return r / 10;
}

/**
 * Lowest mean HR over any `windowMin` window in the `hours` before `end`.
 * samples: [[t, bpm], ...]. Returns {bpm, start, n} or null. Same algorithm as metrics.resting_hr.
 */
export function restingHR(samples, end, hours = 24, windowMin = 30, minSamples = 30) {
  const tEnd = parse(end);
  const tStart = tEnd - hours * 3600e3;
  const pts = samples.map(([t, b]) => [parse(t), b]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .filter(([t]) => t >= tStart && t <= tEnd);
  let best = null, j = 0, total = 0;
  for (let i = 0; i < pts.length; i++) {
    const limit = pts[i][0] + windowMin * 60e3;
    while (j < pts.length && pts[j][0] < limit) { total += pts[j][1]; j++; }
    const n = j - i;
    if (n >= minSamples) {
      const mean = total / n;
      if (best === null || mean < best[0] - 1e-9) best = [mean, pts[i][0], n];
    }
    total -= pts[i][1];
  }
  return best && { bpm: round1(best[0]), start: fmt(best[1]), n: best[2] };
}

// ---------- HR analytics (port of metrics.py; golden-tested) ----------

const sortPts = (samples, t0, t1) => samples.map(([t, b]) => [parse(t), b])
  .filter(([t]) => (t0 == null || t >= parse(t0)) && (t1 == null || t < parse(t1)))
  .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

function weights(pts, capS = 60.0) {
  return pts.map(([t], i) => Math.min(Math.max(i + 1 < pts.length ? (pts[i + 1][0] - t) / 1000 : 5.0, 0.0), capS));
}

/** Time-weighted mean, min, max and minutes covered between t0 and t1. */
export function hrWindow(samples, t0, t1) {
  const pts = sortPts(samples, t0, t1);
  if (!pts.length) return null;
  const w = weights(pts);
  const tot = w.reduce((s, v) => s + v, 0);
  if (tot <= 0) return null;
  const mean = pts.reduce((s, [, b], i) => s + b * w[i], 0) / tot;
  return { mean, min: Math.min(...pts.map((p) => p[1])), max: Math.max(...pts.map((p) => p[1])), minutes: tot / 60.0 };
}

/** Night ending on `day` (00:00-06:00) vs the previous day's daytime (08:00-22:00); dip in %. */
export function nightSummary(samples, day) {
  const d = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) - 864e5);
  const prev = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const night = hrWindow(samples, `${day} 00:00:00`, `${day} 06:00:00`);
  const daytime = hrWindow(samples, `${prev} 08:00:00`, `${prev} 22:00:00`);
  const out = { night, day: daytime, dip_pct: null };
  if (night && daytime && night.minutes >= 60 && daytime.minutes >= 120) out.dip_pct = 100.0 * (1.0 - night.mean / daytime.mean);
  return out;
}

function solve3(A, b) {
  const m = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col; r < 3; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    [m[col], m[piv]] = [m[piv], m[col]];
    for (let r = col + 1; r < 3; r++) {
      const f = m[r][col] / m[col][col];
      for (let c = col; c < 4; c++) m[r][c] -= f * m[col][c];
    }
  }
  const x = [0.0, 0.0, 0.0];
  for (const r of [2, 1, 0]) {
    let acc = 0;
    for (let c = r + 1; c < 3; c++) acc += m[r][c] * x[c];
    x[r] = (m[r][3] - acc) / m[r][r];
  }
  return x;
}

/** 24 h cosinor on `binMin` means; null unless bins cover 16+ distinct clock hours. */
export function cosinor(samples, t0, t1, binMin = 10) {
  const pts = sortPts(samples, t0, t1), base = Date.UTC(2000, 0, 1), bins = new Map();
  for (const [t, b] of pts) {
    const k = Math.floor((t - base) / 1000 / (binMin * 60));
    const e = bins.get(k) ?? [0.0, 0];
    bins.set(k, [e[0] + b, e[1] + 1]);
  }
  const rows = [...bins.keys()].sort((a, b) => a - b).map((k) => {
    const [s, c] = bins.get(k);
    const tm = base + (k + 0.5) * binMin * 60 * 1000;
    const d = new Date(tm);
    return [d.getUTCHours() + d.getUTCMinutes() / 60.0 + d.getUTCSeconds() / 3600.0, s / c];
  });
  if (new Set(rows.map(([h]) => Math.floor(h))).size < 16) return null;
  const X = rows.map(([h]) => [1.0, Math.cos((2 * Math.PI * h) / 24), Math.sin((2 * Math.PI * h) / 24)]);
  const y = rows.map(([, v]) => v);
  const A = [0, 1, 2].map((r) => [0, 1, 2].map((c) => X.reduce((s, xi) => s + xi[r] * xi[c], 0)));
  const bv = [0, 1, 2].map((r) => X.reduce((s, xi, i) => s + xi[r] * y[i], 0));
  const [M, b1, b2] = solve3(A, bv);
  const amp = Math.sqrt(b1 * b1 + b2 * b2);
  const phi = ((((Math.atan2(b2, b1) * 24) / (2 * Math.PI)) % 24) + 24) % 24;
  const fit = X.map(([, c, s]) => M + b1 * c + b2 * s);
  const ybar = y.reduce((s, v) => s + v, 0) / y.length;
  const ssTot = y.reduce((s, v) => s + (v - ybar) * (v - ybar), 0);
  const ssRes = y.reduce((s, v, i) => s + (v - fit[i]) * (v - fit[i]), 0);
  return { mesor: M, amplitude: amp, acrophase_h: phi, r2: ssTot ? 1 - ssRes / ssTot : 0.0, bins: rows.length };
}

export const hrmaxTanaka = (age) => 208.0 - 0.7 * age;
export const ZONES = [0.5, 0.6, 0.7, 0.8, 0.9];

/** Minutes in Karvonen zones 1-5 and Banister TRIMP between t0 and t1. */
export function zonesAndLoad(samples, t0, t1, hrRest, hrMax, sex = "male") {
  const pts = sortPts(samples, t0, t1), w = weights(pts);
  const [k1, k2] = sex === "female" ? [0.86, 1.67] : [0.64, 1.92];
  const minutes = [0.0, 0.0, 0.0, 0.0, 0.0];
  let trimp = 0.0;
  pts.forEach(([, b], i) => {
    let hrr = (b - hrRest) / (hrMax - hrRest);
    if (hrr < ZONES[0]) return; // time in zones only (see metrics.zones_and_load)
    hrr = Math.min(hrr, 1.0);
    trimp += (w[i] / 60.0) * hrr * k1 * Math.exp(k2 * hrr);
    for (let z = 4; z >= 0; z--) if (hrr >= ZONES[z]) { minutes[z] += w[i] / 60.0; break; }
  });
  return { zone_minutes: minutes, trimp };
}

/** Bouts at >= 50% HRR lasting >= minMinutes, with informal heart-rate recovery (port of metrics.workouts). */
export function workouts(samples, hrRest, hrMax, minMinutes = 5.0, gapS = 120.0, sex = "male") {
  const pts = sortPts(samples);
  const thr = hrRest + ZONES[0] * (hrMax - hrRest);
  const bouts = [];
  let cur = [];
  for (const p of pts) {
    if (p[1] < thr) continue;
    if (cur.length && (p[0] - cur[cur.length - 1][0]) / 1000 > gapS) { bouts.push(cur); cur = []; }
    cur.push(p);
  }
  if (cur.length) bouts.push(cur);
  const out = [];
  for (const bout of bouts) {
    const start = bout[0][0], end = bout[bout.length - 1][0];
    if ((end - start) / 1000 < minMinutes * 60) continue;
    const s0 = fmt(start), s1 = fmt(end + 1000);
    const win = hrWindow(samples, s0, s1);
    const load = zonesAndLoad(samples, s0, s1, hrRest, hrMax, sex);
    const tail = pts.filter(([t]) => t >= end - 10e3 && t <= end).map((p) => p[1]);
    const hrEnd = tail.reduce((a, b) => a + b, 0) / tail.length;
    const at = (sec) => {
      const target = end + sec * 1000;
      const near = pts.filter(([t]) => Math.abs((t - target) / 1000) <= 10)
        .map(([t, b]) => [Math.abs((t - target) / 1000), b]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      return near.length ? near[0][1] : null;
    };
    const h60 = at(60), h120 = at(120);
    out.push({ start: s0, end: fmt(end), minutes: (end - start) / 1000 / 60.0, mean: win ? win.mean : null,
      peak: Math.max(...bout.map((p) => p[1])), trimp: load.trimp,
      hrr60: h60 != null ? hrEnd - h60 : null, hrr120: h120 != null ? hrEnd - h120 : null });
  }
  return out;
}

const median = (v) => { const m = v.length; return m % 2 ? v[Math.floor(m / 2)] : (v[m / 2 - 1] + v[m / 2]) / 2; };

/** Median skin temperature per night (readings 00:00-06:00, keyed by that date). */
export function nightlyTemps(rows) {
  const by = new Map();
  for (const [t, c] of rows) {
    const clock = t.slice(11);
    if (clock >= "00:00:00" && clock < "06:00:00") { const d = t.slice(0, 10); if (!by.has(d)) by.set(d, []); by.get(d).push(c); }
  }
  return Object.fromEntries([...by].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([d, v]) => [d, median(v.slice().sort((a, b) => a - b))]));
}

/** Tonight's median minus the median of up to maxBaseline previous nights (port of metrics.temp_deviation). */
export function tempDeviation(rows, day, minBaseline = 3, maxBaseline = 14) {
  const nights = nightlyTemps(rows);
  if (!(day in nights)) return null;
  const prev = Object.keys(nights).filter((d) => d < day).slice(-maxBaseline);
  const out = { night: nights[day], baseline: null, deviation: null, n_baseline: prev.length };
  if (prev.length >= minBaseline) {
    out.baseline = median(prev.map((d) => nights[d]).sort((a, b) => a - b));
    out.deviation = out.night - out.baseline;
  }
  return out;
}

const SLEEP_STAGES = { 1: "deep", 2: "light", 3: "rem" }; // 4 and anything else = awake

/** Night summary from the band's per-minute stage codes in [t0, t1) (port of metrics.sleep_summary). */
export function sleepSummary(rows, t0, t1) {
  const pts = rows.filter(([t]) => t >= t0 && t < t1).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
  if (!pts.length) return null;
  const asleep = pts.filter(([, s]) => s in SLEEP_STAGES).map(([t]) => t);
  const mins = { deep: 0, light: 0, rem: 0, awake: 0 };
  for (const [, s] of pts) mins[SLEEP_STAGES[s] ?? "awake"] += 1;
  let wakes = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i - 1][1] in SLEEP_STAGES && !(pts[i][1] in SLEEP_STAGES)) wakes++;
  return { start: pts[0][0], onset: asleep[0] ?? null, wake: asleep.length ? fmt(parse(asleep[asleep.length - 1]) + 60e3) : null,
    asleep: asleep.length, in_record: pts.length, efficiency: (100.0 * asleep.length) / pts.length, awakenings: wakes, ...mins };
}
