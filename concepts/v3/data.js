// Synthetic person, a year of nights and days, today's minute-by-minute data, three lab draws, a cuff log
// and a history of finger-ECG recordings for the v3 concept. Nothing here is recorded data. The "truth"
// effects below are what the driver fits should recover.

export const ME = { name: "Alex", age: 58, sex: "male", heightIn: 70, weightLb: 196, bpMeds: false, statin: false, smoker: false, diabetes: false };
export const bmi = (p) => (703 * p.weightLb) / p.heightIn ** 2;
export const HRMAX = (age) => 208 - 0.7 * age; // Tanaka 2001
export const STEP_GOAL = (age) => (age >= 60 ? 7000 : 8000); // Paluch 2022 plateau

let seed = 7;
export const reseed = (s) => { seed = s; };
export const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
export const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return (u - 3) / Math.sqrt(0.5); };
/** An independent generator, so new synthetic fields don't shift the tuned series above. */
export function prng(s) {
  let x = s;
  const r = () => ((x = (x * 16807) % 2147483647) / 2147483647);
  return { r, g: () => { let u = 0; for (let i = 0; i < 6; i++) u += r(); return (u - 3) / Math.sqrt(0.5); } };
}
export const median = (v) => { const a = [...v].sort((x, y) => x - y); const n = a.length >> 1; return a.length % 2 ? a[n] : (a[n - 1] + a[n]) / 2; };
export const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
export const sd = (v) => { const m = mean(v); return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1)); };
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export const TAGS = [
  { key: "alcohol", label: "Alcohol" },
  { key: "caffeine", label: "Late caffeine" },
  { key: "stress", label: "Stress" },
  { key: "workout", label: "Late workout", auto: true }, // detected from heart rate, never asked
];
export const LOG_DAYS = 90; // Pulse arrived 90 days ago
export const MIN_TAGGED = 8;
export const ASK_RATE = 0.25; // share of ordinary nights that get a one-tap check-in (keeps tag effects unbiased)

export const SCEN = {
  good: { onset: 23 * 60 + 8, wake: 30 * 60 + 41, hrvBase: 31, rhr: 58.9, nadir: 0.38, temp: 0.1, br: 15.0, awake: 0.012 },
  rough: { onset: 24 * 60 + 41, wake: 30 * 60 + 39, hrvBase: 16.5, rhr: 64.4, nadir: 0.74, temp: 0.4, br: 16.2, awake: 0.035, rough: true },
};
export const NOW = 15 * 60 + 10; // the concept's "now": 3:10 PM

/**
 * One night's minute-level detail (stages, heart rate, the band's ~80-s pulse recordings every 10 min).
 * p: onset/wake (minutes from the evening's midnight), rhr, hrvBase, nadir (0-1), temp (°F vs usual), br, awake, spo2.
 */
function nightDetail(p, R, asleepTarget = null) {
  const N = p.wake - p.onset, stages = [];
  for (let m = 0; m < N; m++) {
    const cyc = Math.floor(m / 92), ph = (m % 92) / 92;
    const deepEnd = Math.max(0.08, 0.5 - cyc * 0.11 - (p.rough ? 0.1 : 0)), remStart = 0.84 - Math.min(0.2, (m / N) * 0.24);
    let st = ph < 0.1 ? 2 : ph < deepEnd ? 1 : ph < remStart ? 2 : 3;
    if (R.r() < p.awake) st = 4;
    stages.push(st);
  }
  if (asleepTarget != null) { // make stage minutes match the night's summary exactly
    let awake = stages.filter((s) => s === 4).length;
    const want = Math.max(0, N - asleepTarget);
    for (let guard = 0; awake !== want && guard < 20000; guard++) {
      const k = 8 + Math.floor(R.r() * (N - 8));
      if (awake > want && stages[k] === 4) { stages[k] = 2; awake--; } else if (awake < want && stages[k] !== 4) { stages[k] = 4; awake++; }
    }
  }
  const hr = Array.from({ length: N }, (_, m) => { const f = m / N; return p.rhr - 1 + (f < p.nadir ? 9 * (1 - f / p.nadir) : 5 * ((f - p.nadir) / (1 - p.nadir))) + R.g() * 1.3; });
  const bursts = [];
  for (let m = 6; m < N; m += 10) {
    const f = m / N, ok = R.r() > (p.rough ? 0.12 : 0.06);
    bursts.push({ m, rmssd: p.hrvBase + 5 * Math.sin(f * 3.1) + R.g() * 2.6, br: p.br + R.g() * 0.55, spo2: Math.min(100, Math.round((p.spo2 ?? 96.4) + R.g() * 0.9 - (R.r() < 0.05 ? 2.5 : 0))),
      temp: 34.3 + p.temp * 0.55 + 1.0 * Math.min(1, f * 3) + R.g() * 0.06, ok, beats: 82 + Math.round(R.g() * 6) });
  }
  const good = bursts.filter((b) => b.ok);
  return { N, stages, hr, bursts, good, onset: p.onset, wake: p.wake, asleepMin: N - stages.filter((x) => x === 4).length };
}

/** A transparent sleep score: duration 50%, efficiency 25%, timing regularity 25%. */
export function sleepScore(h, prior) {
  const dur = clamp01((h.sleepH - 5) / 3), eff = clamp01(((h.sleepH * 60) / (h.wake - h.onset) - 0.8) / 0.15);
  const usualMid = prior.length ? median(prior.map((p) => p.mid)) : h.mid, reg = clamp01(1 - Math.abs(h.mid - usualMid) / 120);
  return { score: Math.round(100 * (0.5 * dur + 0.25 * eff + 0.25 * reg)), parts: { dur: 100 * dur, eff: 100 * eff, reg: 100 * reg }, usualMid };
}

/** Build the whole synthetic world for one scenario. */
export function world(scen) {
  seed = 7;
  const s = SCEN[scen];
  const lastNight = nightDetail(s, { r: rnd, g: gauss });
  const good = lastNight.good, bursts = lastNight.bursts;

  // A year of nights. Index 0 = a year ago, last = last night (and today). `ago` = days before today.
  const hist = [];
  seed = 99;
  const R2 = prng(4242);
  const today = new Date(2026, 8, 24);
  let prevSteps = 7400;
  for (let ago = 364; ago >= 0; ago--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ago), dow = d.getDay(); // night of d-1 → morning d
    const eve = (dow + 6) % 7; // the evening the night started
    const wkend = eve === 5 || eve === 6;
    const sick = ago >= 41 && ago <= 44;
    const t = {
      alcohol: rnd() < (wkend ? 0.36 : 0.08),
      caffeine: rnd() < 0.085,
      stress: rnd() < 0.24 && !wkend,
      workout: rnd() < 0.075,
    };
    const season = Math.sin((ago / 365) * 2 * Math.PI);
    const fit = ago / 365; // a year ago Alex was a little less fit
    const sleepH = 7.05 + gauss() * 0.5 + (wkend ? 0.3 : 0) - (eve === 0 ? 0.3 : 0) - 0.4 * t.caffeine - 0.2 * t.alcohol - 0.28 * t.stress + 0.05 * ((prevSteps - 7400) / 1000) - (sick ? 0.4 : 0);
    const steps = Math.max(1500, Math.round(7400 + (dow === 6 ? 1500 : dow === 0 ? -900 : 0) + gauss() * 1800 - (sick ? 3500 : 0)));
    const tdev = gauss() * 0.1 + (sick ? 0.55 : 0) + (t.alcohol ? 0.12 : 0) + (t.workout ? 0.08 : 0);
    const h = { d, ago, dow, eve, wkend, sick, t, inLog: ago < LOG_DAYS, sleepH, steps, stepsPrev: prevSteps, tdev,
      hrv: 31 + 3.6 * (sleepH - 7.05) - 6 * t.alcohol - 2.6 * t.caffeine - 0.5 * t.stress - 3.2 * t.workout - (sick ? 8 : 0) + 1.5 * season - 3 * fit + gauss() * 2.8,
      rhr: 59.2 - 1.0 * (sleepH - 7.05) + 3.2 * t.alcohol + 0.9 * t.caffeine + 0.3 * t.stress + 1.3 * t.workout + (sick ? 5 : 0) - 0.3 * season + 2.4 * fit + gauss() * 1.1,
      br: 15.0 + 0.35 * t.alcohol + (sick ? 1.6 : 0) + gauss() * 0.4,
      spo2: 96.3 - 0.6 * t.alcohol + gauss() * 0.45 };
    // timing + daytime fields (own generator)
    const eff = Math.min(0.975, 0.935 + R2.g() * 0.015 - (t.alcohol ? 0.015 : 0) - (sick ? 0.02 : 0));
    h.onset = Math.round(23 * 60 - 12 + R2.g() * 20 + (wkend ? 42 : 0) + (t.alcohol ? 18 : 0) + (t.stress ? 8 : 0) - (eve === 0 ? 15 : 0));
    h.wake = Math.round(h.onset + (sleepH * 60) / eff);
    h.mid = (h.onset + h.wake) / 2 - 1440;
    h.mvpa = Math.max(0, Math.round((steps - 3600) / 200 + R2.g() * 6 + (dow === 6 ? 8 : 0)));
    h.moveH = Math.max(1, Math.min(15, Math.round(3 + steps / 1400 + R2.g() * 1.2)));
    h.dayHr = h.rhr + 11.5 + R2.g() * 1.3 + (t.stress ? 1.8 : 0) - 0.4 * ((steps - 7400) / 1000);
    h.lateWorkoutAt = t.workout ? 19 * 60 + 40 + Math.round(R2.r() * 60) : null;
    prevSteps = steps;
    hist.push(h);
  }
  const L = hist.length - 1, last = hist[L];
  Object.assign(last, { hrv: median(good.map((b) => b.rmssd)), rhr: s.rhr, tdev: s.temp / 1.8, br: median(good.map((b) => b.br)), sleepH: lastNight.asleepMin / 60,
    spo2: median(bursts.map((b) => b.spo2)), onset: s.onset, wake: s.wake, mid: (s.onset + s.wake) / 2 - 1440, t: { alcohol: false, caffeine: false, stress: false, workout: false }, sick: false, lateWorkoutAt: null });
  if (scen === "rough") hist[L - 1].tdev = 0.21;
  // Scores (simplified from the app's scores.js: each part vs your own last 28 nights).
  for (let i = 0; i < hist.length; i++) {
    const h = hist[i], prior = hist.slice(Math.max(0, i - 28), i);
    const ss = sleepScore(h, prior.slice(-14)); h.sleepScore = ss.score; h.sleepParts = ss.parts; h.usualMid = ss.usualMid;
    if (prior.length < 7) { h.rec = null; continue; }
    const z = (k) => { const v = prior.map((p) => p[k]); return (h[k] - median(v)) / (sd(v) || 1); };
    const part = (zz) => Math.max(0, Math.min(100, 70 + 15 * zz));
    h.parts = { hrv: part(z("hrv")), rhr: part(-z("rhr")), temp: part(-Math.max(0, h.tdev / 0.15) + 0.3), sleep: part(Math.max(-3, Math.min(1.5, (h.sleepH - 7) / 0.6))) };
    h.rec = Math.round(0.3 * h.parts.hrv + 0.3 * h.parts.rhr + 0.15 * h.parts.temp + 0.25 * h.parts.sleep);
  }
  // Triggers: what makes Pulse ask about a night. Every unusual night is asked; so is ~1 in 4 ordinary one,
  // chosen at random, and those answers count 4× so tag effects aren't skewed toward bad nights.
  for (let i = 28; i < hist.length; i++) {
    const h = hist[i];
    h.trig = triggers(hist, i);
    const sampled = R2.r() < ASK_RATE;
    if (i === L) { h.asked = false; h.checkIn = false; continue; }
    h.checkIn = !h.trig.length && sampled;
    h.asked = h.inLog && (h.trig.length > 0 || sampled);
    h.w = h.trig.length ? 1 : 1 / ASK_RATE;
  }
  const detailCache = new Map([[L, lastNight]]);
  const night = (i) => {
    if (!detailCache.has(i)) {
      const h = hist[i], R = prng(1000 + i);
      const p = { onset: h.onset, wake: h.wake, rhr: h.rhr, hrvBase: h.hrv, br: h.br, spo2: h.spo2 + 0.1, temp: h.tdev * 1.8, rough: h.rec != null && h.rec < 50,
        nadir: Math.max(0.2, Math.min(0.85, 0.36 + (h.t.alcohol ? 0.3 : 0) + (h.sick ? 0.2 : 0) + R.g() * 0.05)), awake: 0.012 + (h.t.alcohol ? 0.012 : 0) + (h.t.stress ? 0.008 : 0) };
      const nd = nightDetail(p, R, Math.round(h.sleepH * 60));
      const shift = (k, want) => { const cur = median(nd.good.map((b) => b[k])); for (const b of nd.bursts) b[k] += want - cur; };
      if (nd.good.length) { shift("rmssd", h.hrv); shift("br", h.br); }
      detailCache.set(i, nd);
    }
    return detailCache.get(i);
  };
  const typical = Array.from({ length: 24 }, (_, hh) => (hh < 7 || hh > 22 ? 0 : Math.round(230 + 360 * Math.exp(-(((hh - 12.5) / 3.2) ** 2)) + (hh === 18 ? 780 : 0) + (hh === 8 ? 300 : 0))));
  const T = todayData(scen, last.rhr, s.wake - 1440);
  Object.assign(last, { steps: T.steps, mvpa: T.mvpa, moveH: T.moveH, dayHr: T.dayHr });
  return { s, hist, night, typical, today: T, L };
}

/** Why Pulse would ask about night i (each against the person's own prior 28 nights). */
export function triggers(hist, i) {
  const h = hist[i], prior = hist.slice(Math.max(0, i - 28), i).filter((p) => !p.sick), u = (k) => median(prior.map((p) => p[k]));
  const out = [], e = expected(hist.slice(0, i + 1), (z) => z.hrv, h.sleepH);
  if (e && h.hrv < e.lo) out.push({ k: "hrv", txt: `HRV was lower than your sleep predicts (${h.hrv.toFixed(0)} ms vs ${e.lo.toFixed(0)}–${e.hi.toFixed(0)})` });
  if (h.rhr >= u("rhr") + 3) out.push({ k: "rhr", txt: `resting heart rate ran ${(h.rhr - u("rhr")).toFixed(0)} bpm over your usual` });
  if (h.br >= u("br") + 1.5) out.push({ k: "breath", txt: `breathing was ${(h.br - u("br")).toFixed(1)}/min faster than usual` });
  if (h.tdev >= 0.2 && hist[i - 1]?.tdev >= 0.2) out.push({ k: "temp", txt: `skin temperature was above your usual two nights running` });
  return out;
}

/** Today, minute by minute from waking to NOW: steps, heart rate, detected sessions. */
function todayData(scen, rhr, wake) {
  const R = prng(scen === "rough" ? 515 : 313), n = NOW - wake, rough = scen === "rough";
  const plan = rough ? [{ a: 7 * 60 + 40, b: 7 * 60 + 52, cad: 104 }] : [{ a: 7 * 60 + 18, b: 7 * 60 + 48, cad: 112 }, { a: 12 * 60 + 38, b: 12 * 60 + 53, cad: 101 }];
  const lift = rough ? null : { a: 11 * 60 + 5, b: 11 * 60 + 47 };
  const steps = new Array(n).fill(0), hr = new Array(n).fill(0);
  let bout = 0, boutCad = 0, h = rhr + 12;
  for (let k = 0; k < n; k++) {
    const t = wake + k, w = plan.find((p) => t >= p.a && t < p.b);
    let cad = 0;
    if (w) cad = w.cad + R.g() * 3;
    else if (lift && t >= lift.a && t < lift.b) cad = R.r() < 0.3 ? 6 + R.r() * 10 : 0;
    else {
      if (bout > 0) { bout--; cad = boutCad; } else if (R.r() < (t > 8 * 60 && t < 18 * 60 ? 0.026 : 0.014) * (rough ? 0.75 : 1)) { bout = 1 + Math.floor(R.r() * 4); boutCad = 55 + R.r() * 40; cad = boutCad; }
    }
    steps[k] = Math.max(0, Math.round(cad + (cad ? R.g() * 4 : 0)));
    let target = rhr + 12 + 2.5 * Math.sin(k / 97) + (cad > 40 ? 0.68 * (cad - 48) : 0);
    if (lift && t >= lift.a && t < lift.b) target = ((t - lift.a) % 3 === 0 ? 124 : 104) + R.g() * 3;
    h += (target - h) * 0.55;
    hr[k] = h + R.g() * 1.6;
  }
  const hrr40 = rhr + 0.4 * (HRMAX(ME.age) - rhr), hrr60 = rhr + 0.6 * (HRMAX(ME.age) - rhr);
  // sessions: ≥10 min at ≥40% heart-rate reserve (2-min gaps allowed)
  const sessions = [];
  let a = -1, gap = 0;
  for (let k = 0; k <= n; k++) {
    const on = k < n && hr[k] >= hrr40;
    if (on) { if (a < 0) a = k; gap = 0; } else if (a >= 0 && (++gap > 2 || k === n)) {
      const b = k - gap + 1;
      if (b - a >= 10) {
        const seg = hr.slice(a, b), st = steps.slice(a, b), spm = mean(st);
        sessions.push({ a: wake + a, b: wake + b, min: b - a, avg: mean(seg), max: Math.max(...seg), spm, steps: st.reduce((x, y) => x + y, 0),
          kind: spm >= 60 ? "walk" : null, zone: [seg.filter((v) => v < hrr60).length, seg.filter((v) => v >= hrr60).length],
          trimp: seg.reduce((acc, v) => { const x = Math.max(0, (v - rhr) / (HRMAX(ME.age) - rhr)); return acc + x * 0.64 * Math.exp(1.92 * x); }, 0) });
      }
      a = -1; gap = 0;
    }
  }
  const brisk = steps.map((v, k) => v >= 100 || (hr[k] >= hrr40 && sessions.some((s) => wake + k >= s.a && wake + k < s.b)));
  const hourly = Array.from({ length: 24 }, (_, hh) => steps.reduce((acc, v, k) => acc + (Math.floor((wake + k) / 60) === hh ? v : 0), 0));
  const firstH = Math.ceil(wake / 60), nowH = Math.floor(NOW / 60);
  const moveH = hourly.filter((v, hh) => hh >= 7 && hh < nowH && v >= 250).length;
  const still = []; let run = 0; for (let k = 0; k < n; k++) { if (steps[k] < 10) run++; else { if (run) still.push(run); run = 0; } }
  const restHr = hr.filter((_, k) => !brisk[k] && steps[k] < 20);
  return { wake, now: NOW, n, hr, sessions, brisk, hourly, hrr40, hrr60, firstH, nowH,
    steps: steps.reduce((x, y) => x + y, 0), stepsMin: steps, mvpa: brisk.filter(Boolean).length, moveH, stillNow: run, longestStill: Math.max(run, ...still),
    dayHr: mean(restHr), hrNow: hr[n - 1], hrLo: Math.min(...hr), hrHi: Math.max(...hr) };
}

// ---------- your-own-data models ----------
/** (Weighted) least squares with standard errors. X rows include the intercept. */
export function ols(X, y, w = null) {
  const n = X.length, p = X[0].length, W = w ?? X.map(() => 1);
  const A = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => X.reduce((a, r, k) => a + W[k] * r[i] * r[j], 0)));
  const b = Array.from({ length: p }, (_, i) => X.reduce((a, r, k) => a + W[k] * r[i] * y[k], 0));
  const M = A.map((r, i) => [...r, ...Array.from({ length: p }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < p; c++) {
    let piv = c; for (let r = c + 1; r < p; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const v = M[c][c]; if (Math.abs(v) < 1e-12) return null;
    for (let j = 0; j < 2 * p; j++) M[c][j] /= v;
    for (let r = 0; r < p; r++) if (r !== c) { const f = M[r][c]; for (let j = 0; j < 2 * p; j++) M[r][j] -= f * M[c][j]; }
  }
  const inv = M.map((r) => r.slice(p));
  const beta = inv.map((r) => r.reduce((a, v, j) => a + v * b[j], 0));
  const res = y.map((v, k) => v - X[k].reduce((a, x, j) => a + x * beta[j], 0));
  // Weights are inverse sampling probabilities: rescale so the error variance uses the real number of nights.
  const sw = W.reduce((a, v) => a + v, 0), s2 = (res.reduce((a, r, k) => a + W[k] * r * r, 0) / sw) * (n / Math.max(1, n - p));
  const scale = sw / n;
  return { beta, se: inv.map((r, i) => Math.sqrt(s2 * r[i] * scale)), sigma: Math.sqrt(s2), n };
}

/** What a night's sleep predicts for a metric, from your own prior 120 nights (80% range). */
export function expected(hist, get, sleepH) {
  const prior = hist.slice(-121, -1).filter((h) => !h.sick);
  if (prior.length < 20) return null;
  const fit = ols(prior.map((h) => [1, h.sleepH]), prior.map(get));
  if (!fit) return null;
  const c = fit.beta[0] + fit.beta[1] * sleepH, w = 1.2816 * fit.sigma;
  return { lo: c - w, hi: c + w, center: c, slope: fit.beta[1], slopeSe: fit.se[1], n: fit.n };
}

/**
 * Honest drivers. Continuous inputs use your last 120 nights. Asked tags use only the nights Pulse asked
 * about, weighted by how likely each was to be asked, and adjusted for sleep length. Detected tags (late
 * workout) use every night. A tag shows an effect only once it has MIN_TAGGED nights, and is called
 * "clear" only when its 95% interval excludes zero.
 */
export function drivers(hist, get, list) {
  const out = [];
  const recent = hist.slice(-121, -1).filter((h) => !h.sick);
  const asked = hist.filter((h) => h.asked && !h.sick), seen = hist.filter((h) => h.inLog && !h.sick && h.trig);
  for (const d of list) {
    if (d === "sleep") {
      const f = ols(recent.map((h) => [1, h.sleepH]), recent.map(get));
      out.push({ key: d, label: "1 h less sleep", note: `${recent.length} nights`, effect: -f.beta[1], ci: 1.96 * f.se[1], n: recent.length, state: Math.abs(f.beta[1]) > 1.96 * f.se[1] ? "clear" : "unclear" });
    } else if (d === "steps") {
      const f = ols(recent.map((h) => [1, h.stepsPrev / 1000]), recent.map(get));
      out.push({ key: d, label: "+1,000 steps the day before", note: `${recent.length} days`, effect: f.beta[1], ci: 1.96 * f.se[1], n: recent.length, state: Math.abs(f.beta[1]) > 1.96 * f.se[1] ? "clear" : "unclear" });
    } else {
      const tag = TAGS.find((t) => t.key === d), rows = tag.auto ? seen : asked;
      const n = rows.filter((h) => h.t[d]).length;
      if (n < MIN_TAGGED) { out.push({ key: d, label: tag.label, n, state: "needs", need: MIN_TAGGED - n, auto: tag.auto }); continue; }
      const useSleep = list.includes("sleep");
      const f = ols(rows.map((h) => (useSleep ? [1, h.sleepH, h.t[d] ? 1 : 0] : [1, h.t[d] ? 1 : 0])), rows.map(get), tag.auto ? null : rows.map((h) => h.w));
      const k = useSleep ? 2 : 1;
      out.push({ key: d, label: tag.label, note: `${n} ${tag.auto ? "detected" : "tagged"} nights`, effect: f.beta[k], ci: 1.96 * f.se[k], n, state: Math.abs(f.beta[k]) > 1.96 * f.se[k] ? "clear" : "unclear", auto: tag.auto });
    }
  }
  const rank = { clear: 0, unclear: 1, needs: 2 };
  return out.sort((a, b) => rank[a.state] - rank[b.state] || Math.abs(b.effect ?? 0) - Math.abs(a.effect ?? 0));
}

// ---------- labs (synthetic; US units) ----------
export const DRAWS = [
  { date: "2026-02-10", label: "Feb 10", v: { tc: 238, ldl: 161, hdl: 41, tg: 212, glucose: 104, insulin: 12.8, a1c: 5.6, hscrp: 1.6, egfr: 84, apob: 118 } },
  { date: "2026-05-12", label: "May 12", v: { tc: 226, ldl: 153, hdl: 42, tg: 166, glucose: 100, insulin: 10.4, a1c: 5.5, hscrp: 1.1, egfr: 85, apob: 111 } },
  { date: "2026-09-03", label: "Sep 3", v: { tc: 218, ldl: 148, hdl: 44, tg: 131, glucose: 97, insulin: 8.9, a1c: 5.4, hscrp: 0.8, egfr: 86, apob: 104 } },
];
export const ANALYTES = [
  { k: "ldl", n: "LDL cholesterol", u: "mg/dL", ref: [0, 99], grp: "Lipids" },
  { k: "hdl", n: "HDL cholesterol", u: "mg/dL", ref: [40, 200], grp: "Lipids" },
  { k: "tg", n: "Triglycerides", u: "mg/dL", ref: [0, 149], grp: "Lipids" },
  { k: "tc", n: "Total cholesterol", u: "mg/dL", ref: [0, 199], grp: "Lipids" },
  { k: "apob", n: "Apolipoprotein B", u: "mg/dL", ref: [0, 89], grp: "Lipids" },
  { k: "glucose", n: "Fasting glucose", u: "mg/dL", ref: [65, 99], grp: "Metabolic" },
  { k: "insulin", n: "Fasting insulin", u: "µIU/mL", ref: [0, 18.4], grp: "Metabolic" },
  { k: "a1c", n: "HbA1c", u: "%", ref: [0, 5.6], grp: "Metabolic" },
  { k: "hscrp", n: "hs-CRP", u: "mg/L", ref: [0, 1.0], grp: "Inflammation" },
  { k: "egfr", n: "eGFR", u: "mL/min", ref: [60, 200], grp: "Kidney" },
];

// ---------- home blood pressure (synthetic cuff + the band's own estimate), newest last ----------
export function bpLog(days = 56) {
  const R = prng(31), rows = [];
  for (let day = days - 1; day >= 0; day--) for (const am of [true, false]) {
    if (day === 0 && !am) continue;
    if (day > 6 && R.r() < 0.3) continue; // older weeks: some readings skipped
    const trend = 6 * (day / days); // home average drifting down ~6 mmHg over two months
    const sys = Math.round(130.5 + trend + (am ? 3 : -2) + R.g() * 4.5), dia = Math.round(83.5 + trend * 0.5 + (am ? 1.5 : -1) + R.g() * 3);
    const band = Math.round(121 + 0.15 * (sys - 134) + R.g() * 5.5); // the band's estimate barely tracks the cuff
    rows.push({ day, am, sys, dia, band, bandDia: Math.round(78 + R.g() * 3.5), pulse: Math.round(64 + R.g() * 4), d: new Date(2026, 8, 24 - day) });
  }
  return rows;
}

// ---------- finger-ECG recordings (analysed live by the app's own code when shown) ----------
export function ecgLog() {
  const R = prng(77), agos = [58, 51, 45, 41, 36, 30, 24, 19, 14, 9, 5, 2, 0];
  return agos.map((ago, k) => {
    const last = ago === 0, f = k / (agos.length - 1);
    return { id: `r${k}`, ago, d: new Date(2026, 8, 24 - ago), min: last ? 7 * 60 + 12 : 6 * 60 + 50 + Math.round(R.r() * 50),
      seed: last ? 13 : 101 + k * 17, hr: last ? 62 : 67.5 - 4.5 * f + R.g() * 1.8, breath: last ? 13.8 : 14.4 + R.g() * 0.6,
      rsa: last ? 0.021 : 0.0145 + 0.0055 * f + R.g() * 0.0012, seconds: last ? 125 : k === 3 ? 26 : k % 3 === 0 ? 125 : 65, pvcAt: last ? 66 : k === 7 ? 40 : -1 };
  });
}
