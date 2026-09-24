// Synthetic person, a year of nights, three lab draws and a week of cuff readings for the v3 concept.
// Nothing here is recorded data. The "truth" effects below are what the driver fits should recover.

export const ME = { name: "Alex", age: 58, sex: "male", heightIn: 70, weightLb: 196, bpMeds: false, statin: false, smoker: false, diabetes: false };
export const bmi = (p) => (703 * p.weightLb) / p.heightIn ** 2;

let seed = 7;
export const reseed = (s) => { seed = s; };
export const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
export const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return (u - 3) / Math.sqrt(0.5); };
export const median = (v) => { const a = [...v].sort((x, y) => x - y); const n = a.length >> 1; return a.length % 2 ? a[n] : (a[n - 1] + a[n]) / 2; };
export const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
export const sd = (v) => { const m = mean(v); return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1)); };

export const TAGS = [
  { key: "alcohol", label: "Alcohol" },
  { key: "caffeine", label: "Late caffeine" },
  { key: "stress", label: "Stress" },
  { key: "workout", label: "Late workout" },
];
export const LOG_DAYS = 60; // tagging started 60 days ago (when Pulse arrived)
export const MIN_TAGGED = 8;

export const SCEN = {
  good: { onset: 23 * 60 + 8, wake: 30 * 60 + 41, sleep: 84, state: "good", hrvBase: 31, rhr: 58.9, nadir: 0.38, temp: 0.1, br: 15.0, awake: 0.012, steps: 2640, pct: 33, ghost: 0.3 },
  rough: { onset: 24 * 60 + 41, wake: 30 * 60 + 39, sleep: 61, state: "bad", hrvBase: 16.5, rhr: 64.4, nadir: 0.74, temp: 0.4, br: 16.2, awake: 0.035, steps: 1210, pct: 15, ghost: 0.3 },
};

/** Build the whole synthetic world for one scenario. */
export function world(scen) {
  seed = 7;
  const s = SCEN[scen], N = s.wake - s.onset;
  const stages = [];
  for (let m = 0; m < N; m++) {
    const cyc = Math.floor(m / 92), ph = (m % 92) / 92;
    const deepEnd = Math.max(0.08, 0.5 - cyc * 0.11 - (scen === "rough" ? 0.1 : 0)), remStart = 0.84 - Math.min(0.2, (m / N) * 0.24);
    let st = ph < 0.1 ? 2 : ph < deepEnd ? 1 : ph < remStart ? 2 : 3;
    if (rnd() < s.awake) st = 4;
    stages.push(st);
  }
  const hr = Array.from({ length: N }, (_, m) => { const f = m / N; return s.rhr - 1 + (f < s.nadir ? 9 * (1 - f / s.nadir) : 5 * ((f - s.nadir) / (1 - s.nadir))) + gauss() * 1.3; });
  const bursts = [];
  for (let m = 6; m < N; m += 10) {
    const f = m / N, ok = rnd() > (scen === "rough" ? 0.12 : 0.06);
    bursts.push({ m, rmssd: s.hrvBase + 5 * Math.sin(f * 3.1) + gauss() * 2.6, br: s.br + gauss() * 0.55, spo2: Math.min(100, Math.round(96.4 + gauss() * 0.9 - (rnd() < 0.05 ? 2.5 : 0))),
      temp: 34.3 + s.temp * 0.55 + 1.0 * Math.min(1, f * 3) + gauss() * 0.06, ok, beats: 82 + Math.round(gauss() * 6) });
  }
  const good = bursts.filter((b) => b.ok);
  const asleepMin = N - stages.filter((x) => x === 4).length;

  // A year of nights. Index 0 = a year ago, last = last night. `ago` = days before today.
  const hist = [];
  seed = 99;
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
    const h = { d, ago, dow, eve, wkend, sick, t, logged: ago < LOG_DAYS && ago > 0, sleepH, steps, stepsPrev: prevSteps, tdev,
      hrv: 31 + 3.6 * (sleepH - 7.05) - 6 * t.alcohol - 2.6 * t.caffeine - 0.5 * t.stress - 3.2 * t.workout - (sick ? 8 : 0) + 1.5 * season - 3 * fit + gauss() * 2.8,
      rhr: 59.2 - 1.0 * (sleepH - 7.05) + 3.2 * t.alcohol + 0.9 * t.caffeine + 0.3 * t.stress + 1.3 * t.workout + (sick ? 5 : 0) - 0.3 * season + 2.4 * fit + gauss() * 1.1,
      br: 15.0 + 0.35 * t.alcohol + (sick ? 1.6 : 0) + gauss() * 0.4,
      spo2: 96.3 - 0.6 * t.alcohol + gauss() * 0.45 };
    prevSteps = steps;
    hist.push(h);
  }
  const last = hist[hist.length - 1];
  Object.assign(last, { hrv: median(good.map((b) => b.rmssd)), rhr: s.rhr, tdev: s.temp / 1.8, br: median(good.map((b) => b.br)), sleepH: asleepMin / 60,
    spo2: median(bursts.map((b) => b.spo2)), steps: s.steps, t: { alcohol: false, caffeine: false, stress: false, workout: false }, sick: false });
  if (scen === "rough") hist[hist.length - 2].tdev = 0.17;
  // Scores (simplified from the app's scores.js: each part vs your own last 28 nights).
  for (let i = 0; i < hist.length; i++) {
    const h = hist[i], prior = hist.slice(Math.max(0, i - 28), i);
    if (prior.length < 7) { h.rec = null; continue; }
    const z = (k) => { const v = prior.map((p) => p[k]); return (h[k] - median(v)) / (sd(v) || 1); };
    const part = (zz) => Math.max(0, Math.min(100, 70 + 15 * zz));
    h.parts = { hrv: part(z("hrv")), rhr: part(-z("rhr")), temp: part(-Math.max(0, h.tdev / 0.15) + 0.3), sleep: part(Math.max(-3, Math.min(1.5, (h.sleepH - 7) / 0.6))) };
    h.rec = Math.round(0.3 * h.parts.hrv + 0.3 * h.parts.rhr + 0.15 * h.parts.temp + 0.25 * h.parts.sleep);
  }
  const stepsHour = Array.from({ length: 24 }, (_, hh) => (hh < 7 || hh > 10 ? 0 : Math.round((rnd() * 800 + (hh === 8 ? 600 : 0)) * (scen === "rough" ? 0.45 : 1))));
  const typical = Array.from({ length: 24 }, (_, hh) => (hh < 7 || hh > 22 ? 0 : Math.round(230 + 360 * Math.exp(-(((hh - 12.5) / 3.2) ** 2)) + (hh === 18 ? 780 : 0) + (hh === 8 ? 300 : 0))));
  return { s, N, stages, hr, bursts, good, hist, stepsHour, typical, asleepMin };
}

// ---------- your-own-data models ----------
/** Ordinary least squares with standard errors. X rows include the intercept. */
export function ols(X, y) {
  const n = X.length, p = X[0].length;
  const A = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => X.reduce((a, r) => a + r[i] * r[j], 0)));
  const b = Array.from({ length: p }, (_, i) => X.reduce((a, r, k) => a + r[i] * y[k], 0));
  // Invert A (Gauss-Jordan)
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
  const s2 = res.reduce((a, r) => a + r * r, 0) / Math.max(1, n - p);
  return { beta, se: inv.map((r, i) => Math.sqrt(s2 * r[i])), sigma: Math.sqrt(s2), n };
}

/** What last night's sleep predicts for a metric, from your own prior 120 nights (80% range). */
export function expected(hist, get, sleepH) {
  const prior = hist.slice(-121, -1).filter((h) => !h.sick);
  const fit = ols(prior.map((h) => [1, h.sleepH]), prior.map(get));
  if (!fit) return null;
  const c = fit.beta[0] + fit.beta[1] * sleepH, w = 1.2816 * fit.sigma;
  return { lo: c - w, hi: c + w, center: c, slope: fit.beta[1], slopeSe: fit.se[1], n: fit.n };
}

/**
 * Honest drivers. Continuous inputs use your last 120 nights; tags use only the nights you've been tagging,
 * adjusted for sleep length. A tag shows an effect only once it has MIN_TAGGED nights, and is called "clear"
 * only when its 95% interval excludes zero.
 */
export function drivers(hist, get, list) {
  const out = [];
  const recent = hist.slice(-121, -1).filter((h) => !h.sick);
  const loggedN = hist.filter((h) => h.logged && !h.sick);
  for (const d of list) {
    if (d === "sleep") {
      const f = ols(recent.map((h) => [1, h.sleepH]), recent.map(get));
      out.push({ key: d, label: "1 h less sleep", note: `${recent.length} nights`, effect: -f.beta[1], ci: 1.96 * f.se[1], n: recent.length, state: Math.abs(f.beta[1]) > 1.96 * f.se[1] ? "clear" : "unclear" });
    } else if (d === "steps") {
      const f = ols(recent.map((h) => [1, h.stepsPrev / 1000]), recent.map(get));
      out.push({ key: d, label: "+1,000 steps the day before", note: `${recent.length} days`, effect: f.beta[1], ci: 1.96 * f.se[1], n: recent.length, state: Math.abs(f.beta[1]) > 1.96 * f.se[1] ? "clear" : "unclear" });
    } else {
      const tag = TAGS.find((t) => t.key === d);
      const n = loggedN.filter((h) => h.t[d]).length;
      if (n < MIN_TAGGED) { out.push({ key: d, label: tag.label, n, state: "needs", need: MIN_TAGGED - n }); continue; }
      const useSleep = list.includes("sleep");
      const f = ols(loggedN.map((h) => (useSleep ? [1, h.sleepH, h.t[d] ? 1 : 0] : [1, h.t[d] ? 1 : 0])), loggedN.map(get));
      const k = useSleep ? 2 : 1;
      out.push({ key: d, label: tag.label, note: `${n} tagged nights`, effect: f.beta[k], ci: 1.96 * f.se[k], n, state: Math.abs(f.beta[k]) > 1.96 * f.se[k] ? "clear" : "unclear" });
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

// ---------- home blood pressure (synthetic cuff + the band's own estimate) ----------
export function bpLog() {
  seed = 31;
  const rows = [];
  for (let day = 6; day >= 0; day--) for (const am of [true, false]) {
    if (day === 0 && !am) continue;
    const sys = Math.round(134 + (am ? 3 : -2) + gauss() * 4.5), dia = Math.round(84 + (am ? 1.5 : -1) + gauss() * 3);
    const band = Math.round(121 + 0.15 * (sys - 134) + gauss() * 5.5); // the band's estimate barely tracks the cuff
    rows.push({ day, am, sys, dia, band, bandDia: Math.round(78 + gauss() * 3.5), pulse: Math.round(64 + gauss() * 4) });
  }
  return rows;
}
