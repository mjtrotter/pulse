// EXPERIMENTAL, personally cuff-calibrated blood-pressure estimate. Every value this module
// produces is a research-grade estimate, never a diagnostic reading, and must be labeled
// "Experimental BP estimate" by any screen that shows it (source doc "BP output gates").
//
// Hard limit (source: "$HOME/Downloads/V8 ECG Metrics, Respiration Fusion, and Cuff-Calibrated BP.md",
// "BP feature construction"): BP modeling normally starts from pulse arrival time (PAT), the delay
// from the ECG R-peak to the PPG pulse foot. This band exposes no raw PPG waveform, so PAT/PTT
// cannot be computed here — the entire "PAT models" rung of the doc's "BP model ladder" is
// unavailable on this hardware. Mukkamala et al. 2015 (IEEE Trans Biomed Eng 62(8):1879-901,
// PMID 26057530; see also ~/jcv8/research/lit_ecg_ppg.md §6.4) is explicit that even WITH PAT,
// cuffless BP is not a validated, calibration-free replacement for a cuff, is highly sensitive to
// pre-ejection-period changes unrelated to BP, and needs per-user calibration; without PAT at all,
// what remains is a much weaker regression against whatever loosely correlates with BP that this
// band does expose every ~10 minutes: its own (noisy) BP estimate, heart rate, skin temperature,
// activity and time of day. That is why every model here is tested against trivial baselines
// (doc "BP model ladder" / "BP performance": "Any sensor model must outperform these on future,
// unseen sessions; calibration can otherwise create the illusion of accuracy") before it is ever
// allowed to call itself `usable`.
//
// Cuff protocol assumed for `cuffRows` (doc "Cuff-aligned collection"): seated, rested 5 minutes,
// cuff at heart level, standardized V8 wrist/posture; [{t, sys, dia, pulse}].

import { mean } from "./baseline.js?v=20260925173307";

// ---- time helpers (self-contained; deliberately Date.UTC-based so results don't depend on the
// host machine's timezone — only relative differences matter here, never wall-clock instants). ----
const pad = (n) => String(n).padStart(2, "0");
const ms = (t) => Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10),
  +t.slice(11, 13), +t.slice(14, 16), +t.slice(17, 19));
/** Minutes after local midnight, read directly off the timestamp string (0..1439.99). */
const clockMinOf = (t) => +t.slice(11, 13) * 60 + +t.slice(14, 16) + +t.slice(17, 19) / 60;
/** {date, minute} for an internal ms value, reconstructed on the same UTC basis as `ms`. */
function dateAndMinuteAt(msVal) {
  const d = new Date(msVal);
  return { date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, minute: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

/** Nearest row (by `.t`) to `t0` (ms) within `withinMin` minutes, or null. dt = (t0 - row time) in minutes. */
function nearestByTime(rows, t0, withinMin) {
  let best = null;
  for (const row of rows) {
    if (row?.t == null) continue;
    const dt = (t0 - ms(row.t)) / 60000;
    if (Math.abs(dt) <= withinMin && (!best || Math.abs(dt) < Math.abs(best.dt))) best = { row, dt };
  }
  return best;
}

/**
 * EXPERIMENTAL. Feature vector at timestamp `at` (doc "BP feature construction", the "Context
 * features" list, adapted to what this band actually exposes — see file header). `ctx`:
 *   bandBp: [{t, sys, dia}]        — band's own BP estimate, ~every 10 min
 *   hr:     [{t, bpm}]             — 5-s heart rate
 *   temp:   [{t, c}]               — skin temperature
 *   stepsByMinute: (date, minute) => steps   — per-minute step count, keyed like the rest of the app
 *   ecg:    [{t, hr, qtc}]         — occasional finger-ECG session summaries
 * Every value is explicitly `null` (not NaN/undefined) when there is nothing within its window,
 * so downstream code can tell "no signal" from "signal of zero".
 */
export function features(at, ctx = {}) {
  const { bandBp = [], hr = [], temp = [], stepsByMinute, ecg = [] } = ctx;
  const t0 = ms(at);

  // Band's own BP estimate nearest within ±60 min (matches the window already used to pair
  // band vs. cuff readings elsewhere in this app, e.g. src/v3/measure.js's cuff/band pairing).
  const band = nearestByTime(bandBp, t0, 60);
  // Skin temperature nearest within ±30 min (no cadence given in the source doc; 30 min keeps the
  // reading close enough to "now" to be meaningful without being so strict it's usually null).
  const tempR = nearestByTime(temp, t0, 30);
  // Finger-ECG session within ±30 min, per spec.
  const ecgS = nearestByTime(ecg, t0, 30);

  // Mean HR over the prior 10 minutes (inclusive of `at`), from 5-s HR rows.
  const hrWin = hr.filter((r) => { const d = t0 - ms(r.t); return d >= 0 && d <= 10 * 60000; });
  const hrMean10 = hrWin.length ? hrWin.reduce((s, r) => s + r.bpm, 0) / hrWin.length : null;

  // Steps in the 30 minutes ending at `at`. `stepsByMinute` existing (a function) means "we have
  // a step data source"; a minute with no entry in it is 0 steps, not missing data.
  let steps30 = null;
  if (typeof stepsByMinute === "function") {
    steps30 = 0;
    for (let k = 0; k < 30; k++) {
      const { date, minute } = dateAndMinuteAt(t0 - k * 60000);
      steps30 += stepsByMinute(date, minute) || 0;
    }
  }

  // Time of day as a point on the unit circle, so "23:55" and "00:05" are close, not far apart.
  const ang = (2 * Math.PI * clockMinOf(at)) / 1440;

  return {
    at,
    bandSys: band ? band.row.sys : null,
    bandDia: band ? band.row.dia : null,
    bandDt: band ? band.dt : null,
    hrMean10, hrN10: hrWin.length,
    steps30,
    tempC: tempR ? tempR.row.c : null,
    tempDt: tempR ? tempR.dt : null,
    todSin: Math.sin(ang), todCos: Math.cos(ang),
    ecgHr: ecgS ? ecgS.row.hr ?? null : null,
    ecgQtc: ecgS ? ecgS.row.qtc ?? null : null,
    ecgDt: ecgS ? ecgS.dt : null,
  };
}

// ---- small linear-algebra + stats helpers used by the model ladder ----

const range = (n) => Array.from({ length: n }, (_, i) => i);

/** {n, mae, bias, sd} of (pred - actual) over pairs where pred != null; nulls excluded from n. */
function errStats(pairs) {
  const e = pairs.filter((p) => p.pred != null).map((p) => p.pred - p.actual);
  if (!e.length) return { n: 0, mae: null, bias: null, sd: null };
  const bias = e.reduce((s, x) => s + x, 0) / e.length;
  const mae = e.reduce((s, x) => s + Math.abs(x), 0) / e.length;
  const sd = e.length > 1 ? Math.sqrt(e.reduce((s, x) => s + (x - bias) ** 2, 0) / (e.length - 1)) : 0;
  return { n: e.length, mae, bias, sd };
}

/** Univariate OLS on [[x, y], ...]; b = 0 (flat line at the mean) if x has no spread. */
function ols(pairs) {
  const n = pairs.length;
  const mx = pairs.reduce((s, [x]) => s + x, 0) / n, my = pairs.reduce((s, [, y]) => s + y, 0) / n;
  let sxy = 0, sxx = 0;
  for (const [x, y] of pairs) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; }
  const b = sxx > 1e-9 ? sxy / sxx : 0;
  return { a: my - b * mx, b };
}

/** In-place-free Gauss-Jordan inverse of a small square matrix (fine for p ≤ 8, per spec). */
function invert(M) {
  const n = M.length;
  const A = M.map((row, i) => [...row, ...range(n).map((j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) A[piv][col] += 1e-9; // guard a degenerate fold, ridge keeps this rare
    [A[col], A[piv]] = [A[piv], A[col]];
    const d = A[col][col];
    for (let j = 0; j < 2 * n; j++) A[col][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col];
      if (f !== 0) for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[col][j];
    }
  }
  return A.map((row) => row.slice(n));
}

// Ridge feature set (doc "BP model ladder" > "Multivariable models": "Ridge/elastic-net regression
// with PAT, HR, PPG shape, temperature, posture, and motion" — PAT/PPG shape are unavailable here,
// so this is HR, activity, temperature, time of day, and the band's own (weak) BP estimate).
// Finger-ECG features are deliberately left out of the ridge feature set even though features()
// exposes them: sessions are occasional, so most cuff-linked rows would get an imputed (mean)
// value for them, diluting whatever little signal they carry. p = 7, comfortably ≤ 8.
const FEATURE_KEYS = ["bandSys", "bandDia", "hrMean10", "steps30", "tempC", "todSin", "todCos"];
const LAMBDA_GRID = [0.1, 0.3, 1, 3, 10, 30, 100, 300, 1000];

/** Per-feature {mean, sd} from rows `idxs` of `feats`, sd floored to 1 (never 0) to avoid /0. */
function featureStats(feats, idxs) {
  return FEATURE_KEYS.map((k) => {
    const vals = idxs.map((i) => feats[i][k]).filter((x) => x != null && Number.isFinite(x));
    const m = vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : 0;
    const v = vals.length > 1 ? vals.reduce((s, x) => s + (x - m) ** 2, 0) / (vals.length - 1) : 0;
    return { mean: m, sd: Math.sqrt(v) > 1e-9 ? Math.sqrt(v) : 1 };
  });
}
/** Standardized feature vector; a missing value is imputed to the training mean, i.e. standardizes to 0. */
const standardizeRow = (f, stats) => FEATURE_KEYS.map((k, j) => (f[k] != null && Number.isFinite(f[k]) ? (f[k] - stats[j].mean) / stats[j].sd : 0));
const designRow = (std) => [1, ...std]; // intercept + p standardized features
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

/** Ridge normal equations beta = (XᵀX + λP)⁻¹Xᵀy, P = diag(0,1,1,...,1) so the intercept isn't shrunk. */
function ridgeSolve(X, y, lambda) {
  const p1 = X[0].length;
  const XtX = range(p1).map(() => new Array(p1).fill(0)), Xty = new Array(p1).fill(0);
  for (let r = 0; r < X.length; r++) {
    for (let a = 0; a < p1; a++) {
      Xty[a] += X[r][a] * y[r];
      for (let b = 0; b < p1; b++) XtX[a][b] += X[r][a] * X[r][b];
    }
  }
  for (let a = 1; a < p1; a++) XtX[a][a] += lambda;
  const inv = invert(XtX);
  return range(p1).map((a) => dot(inv[a], Xty));
}

/** Leave-one-out ridge predictions for one target array, standardizing on each fold's training rows only. */
function ridgeLOO(feats, target, lambda) {
  const n = feats.length;
  return range(n).map((i) => {
    const idxs = range(n).filter((j) => j !== i);
    const stats = featureStats(feats, idxs);
    const X = idxs.map((j) => designRow(standardizeRow(feats[j], stats)));
    const beta = ridgeSolve(X, idxs.map((j) => target[j]), lambda);
    return dot(designRow(standardizeRow(feats[i], stats)), beta);
  });
}

/** Picks lambda by LOO MAE over `LAMBDA_GRID` (doc: "choose lambda by LOO"), unless overridden. */
function chooseLambda(feats, target, override) {
  if (override != null) return override;
  let bestLambda = LAMBDA_GRID[0], bestMae = Infinity;
  for (const lam of LAMBDA_GRID) {
    const { mae } = errStats(ridgeLOO(feats, target, lam).map((pred, i) => ({ pred, actual: target[i] })));
    if (mae != null && mae < bestMae) { bestMae = mae; bestLambda = lam; }
  }
  return bestLambda;
}

// ---- the four ladder rungs (doc "BP model ladder" > "Baselines" and "Multivariable models") ----

/** (a) Personal mean of cuff readings — LOO predicts each reading from the mean of every OTHER reading. */
function fitMean(sys, dia) {
  const n = sys.length;
  const pred = (v) => range(n).map((i) => mean(v.filter((_, j) => j !== i)));
  const sStat = errStats(pred(sys).map((p, i) => ({ pred: p, actual: sys[i] })));
  const dStat = errStats(pred(dia).map((p, i) => ({ pred: p, actual: dia[i] })));
  const finalSys = mean(sys), finalDia = mean(dia);
  return { name: "mean", maeSys: sStat.mae, biasSys: sStat.bias, sdSys: sStat.sd, maeDia: dStat.mae, biasDia: dStat.bias, sdDia: dStat.sd,
    predict: () => ({ sys: finalSys, dia: finalDia }) };
}

/**
 * (b) Last cuff reading, carry-forward. `sys`/`dia` MUST already be in chronological order (fit()
 * sorts before calling this) — each reading is predicted from the one strictly BEFORE it in time,
 * never from a later one, so this can't leak a future reading into "last known".
 */
function fitCarryForward(sys, dia) {
  const n = sys.length;
  const pred = (v) => range(n).map((i) => (i === 0 ? null : v[i - 1]));
  const sStat = errStats(pred(sys).map((p, i) => ({ pred: p, actual: sys[i] })));
  const dStat = errStats(pred(dia).map((p, i) => ({ pred: p, actual: dia[i] })));
  const lastSys = sys[n - 1], lastDia = dia[n - 1];
  return { name: "lastCuff", maeSys: sStat.mae, biasSys: sStat.bias, sdSys: sStat.sd, maeDia: dStat.mae, biasDia: dStat.bias, sdDia: dStat.sd,
    predict: () => ({ sys: lastSys, dia: lastDia }) };
}

/** (c) Band estimate + personal linear offset/scale calibration: target = a + b * band value. */
function fitBandCalibration(feats, sys, dia) {
  const oneTarget = (target, key) => {
    const n = feats.length;
    const predAt = range(n).map((i) => {
      const trainIdx = range(n).filter((j) => j !== i);
      const pairs = trainIdx.map((j) => [feats[j][key], target[j]]).filter(([x]) => x != null);
      if (pairs.length >= 2) {
        const { a, b } = ols(pairs);
        const x = feats[i][key];
        return x != null ? a + b * x : mean(pairs.map(([, y]) => y));
      }
      return mean(trainIdx.map((j) => target[j])); // not enough band coverage in this fold: fall back to the mean
    });
    const stat = errStats(predAt.map((p, i) => ({ pred: p, actual: target[i] })));
    const allPairs = feats.map((f, j) => [f[key], target[j]]).filter(([x]) => x != null);
    const fit = allPairs.length >= 2 ? ols(allPairs) : null;
    const fallback = mean(target);
    return { stat, predictOne: (x) => (fit && x != null ? fit.a + fit.b * x : fallback) };
  };
  const s = oneTarget(sys, "bandSys"), d = oneTarget(dia, "bandDia");
  return { name: "bandCalibrated", maeSys: s.stat.mae, biasSys: s.stat.bias, sdSys: s.stat.sd, maeDia: d.stat.mae, biasDia: d.stat.bias, sdDia: d.stat.sd,
    predict: (at, ctx) => { const f = features(at, ctx); return { sys: s.predictOne(f.bandSys), dia: d.predictOne(f.bandDia) }; } };
}

/** (d) Ridge regression on standardized features (small p, strong regularization; lambda chosen by LOO). */
function fitRidge(feats, sys, dia, lambdaOverride) {
  const oneTarget = (target) => {
    const lambda = chooseLambda(feats, target, lambdaOverride);
    const stat = errStats(ridgeLOO(feats, target, lambda).map((p, i) => ({ pred: p, actual: target[i] })));
    const allIdx = range(feats.length), stats = featureStats(feats, allIdx);
    const beta = ridgeSolve(feats.map((f) => designRow(standardizeRow(f, stats))), target, lambda);
    return { stat, lambda, predictOne: (f) => dot(designRow(standardizeRow(f, stats)), beta) };
  };
  const s = oneTarget(sys), d = oneTarget(dia);
  return { name: "ridge", maeSys: s.stat.mae, biasSys: s.stat.bias, sdSys: s.stat.sd, maeDia: d.stat.mae, biasDia: d.stat.bias, sdDia: d.stat.sd,
    lambdaSys: s.lambda, lambdaDia: d.lambda,
    predict: (at, ctx) => { const f = features(at, ctx); return { sys: s.predictOne(f), dia: d.predictOne(f) }; } };
}

/**
 * EXPERIMENTAL. Fits the full model ladder (doc "BP model ladder") against `cuffRows` and scores
 * every rung with time-ordered leave-one-out cross-validation, never random-fold CV — the doc's
 * calibration-design warning applies even at this small scale ("more flexible models should be
 * accepted only when they improve future-session error, not random beat-level cross-validation").
 *
 * `usable` is true only when the best of the two non-trivial models (bandCalibrated, ridge) beats
 * BOTH trivial baselines (mean, lastCuff) on LOO systolic MAE by at least `MARGIN_SYS` mmHg, and
 * there are at least `minN` cuff readings. The margin (not just "any" improvement) matters because
 * with a handful of readings a model can look better than a baseline purely by chance; the doc's
 * own performance section warns that "calibration can otherwise create the illusion of accuracy",
 * and 2 mmHg is small next to both a validated home cuff's own reading-to-reading noise and the
 * standard error of a LOO-MAE estimate computed from a dozen or two readings. The check is on
 * systolic only, per the spec's own example margin — SBP is the number BP guidance is generally
 * framed around, and the doc gives no separate diastolic margin to combine it with.
 *
 * Returns {n, need, models, best, usable, note}. `models` is the full ladder (each entry also
 * carries a `predict(at, ctx)` closure fitted on ALL `n` rows, used by `estimate`/`series`).
 * `best` is the winning non-trivial model's name (string), or null if fewer than 2 readings exist.
 */
export function fit(cuffRows, ctx, { minN = 10, lambda } = {}) {
  const rows = [...cuffRows].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  const n = rows.length;
  const need = Math.max(0, minN - n);
  if (n < 2) {
    return { n, need, models: [], best: null, usable: false,
      note: n === 0 ? "No cuff readings yet; log some to enable any model." : "Only one cuff reading; need at least two to evaluate any model." };
  }

  const feats = rows.map((r) => features(r.t, ctx));
  const sys = rows.map((r) => r.sys), dia = rows.map((r) => r.dia);

  const meanModel = fitMean(sys, dia);
  const lastModel = fitCarryForward(sys, dia);
  const bandModel = fitBandCalibration(feats, sys, dia);
  const ridgeModel = fitRidge(feats, sys, dia, lambda);
  const models = [meanModel, lastModel, bandModel, ridgeModel];

  const best = [bandModel, ridgeModel].reduce((a, b) => (b.maeSys < a.maeSys ? b : a));
  const MARGIN_SYS = 2; // mmHg, LOO systolic MAE — see doc comment above.
  const usable = n >= minN && best.maeSys <= meanModel.maeSys - MARGIN_SYS && best.maeSys <= lastModel.maeSys - MARGIN_SYS;

  const note = usable
    ? `${best.name} beats mean (${meanModel.maeSys.toFixed(1)} mmHg) and last-reading (${lastModel.maeSys.toFixed(1)} mmHg) baselines by ≥${MARGIN_SYS} mmHg systolic LOO MAE over ${n} readings.`
    : n < minN
      ? `Only ${n} of ${minN} cuff readings logged; need ${need} more before a personal model can be trusted.`
      : `Best model (${best.name}, ${best.maeSys.toFixed(1)} mmHg) doesn't beat the mean (${meanModel.maeSys.toFixed(1)} mmHg) / last-reading (${lastModel.maeSys.toFixed(1)} mmHg) baselines by the required ${MARGIN_SYS} mmHg; showing baselines only, no experimental estimate.`;

  return { n, need, models, best: best.name, usable, note };
}

/**
 * EXPERIMENTAL. Point estimate at `at` from the model ladder returned by `fit`, using whichever
 * rung won (`model.best`). The interval is the chosen model's LOO residual SD (doc "BP performance":
 * "Coverage and width of 80%/95% prediction intervals"), a 95% interval (±1.96 SD) around the
 * systolic point estimate; `usable` simply forwards the ladder's own usability verdict, so a caller
 * can still show the number (per the doc's "Display" list: point estimate plus interval, always
 * labeled experimental) while visibly flagging that it hasn't cleared the baseline bar.
 * Returns {sys, dia, lowSys, highSys, usable} (plus lowDia/highDia for convenience).
 */
export function estimate(model, at, ctx) {
  const m = model?.models?.find((x) => x.name === model.best) ?? null;
  if (!m) return { sys: null, dia: null, lowSys: null, highSys: null, lowDia: null, highDia: null, usable: false };
  const { sys, dia } = m.predict(at, ctx);
  const z = 1.96, r = (x) => (x != null ? Math.round(x * 10) / 10 : null);
  return {
    sys: r(sys), dia: r(dia),
    lowSys: sys != null ? r(sys - z * (m.sdSys || 0)) : null, highSys: sys != null ? r(sys + z * (m.sdSys || 0)) : null,
    lowDia: dia != null ? r(dia - z * (m.sdDia || 0)) : null, highDia: dia != null ? r(dia + z * (m.sdDia || 0)) : null,
    usable: !!model.usable,
  };
}

/**
 * EXPERIMENTAL. Estimates at every band BP record time in [fromT, toT], plus an EXPERIMENTAL
 * nocturnal dipping % = (day mean − night mean) / day mean × 100 (a normal dipper is usually
 * quoted as roughly 10-20%; this module makes no claim about that threshold, it just reports the
 * number). Day/night here is a plain clock split (22:00-06:00 = night) since this ctx has no sleep
 * stage/onset data to key off of — flagged `experimental` in the return for exactly that reason.
 */
export function series(model, fromT, toT, ctx) {
  const from = ms(fromT), to = ms(toT);
  const times = (ctx?.bandBp ?? []).map((r) => r.t).filter((t) => { const x = ms(t); return x >= from && x <= to; }).sort();
  const points = times.map((t) => ({ at: t, ...estimate(model, t, ctx) }));
  const isNight = (t) => { const mm = clockMinOf(t); return mm >= 22 * 60 || mm < 6 * 60; };
  const withSys = points.filter((p) => p.sys != null);
  const dayPts = withSys.filter((p) => !isNight(p.at)), nightPts = withSys.filter((p) => isNight(p.at));
  const avg = (arr, key) => (arr.length ? arr.reduce((s, p) => s + p[key], 0) / arr.length : null);
  const day = { n: dayPts.length, meanSys: avg(dayPts, "sys"), meanDia: avg(dayPts, "dia") };
  const night = { n: nightPts.length, meanSys: avg(nightPts, "sys"), meanDia: avg(nightPts, "dia") };
  const dip = (d, ngt) => (d != null && ngt != null && d !== 0 ? ((d - ngt) / d) * 100 : null);
  return { points, day, night, dipping: { sys: dip(day.meanSys, night.meanSys), dia: dip(day.meanDia, night.meanDia), experimental: true } };
}
