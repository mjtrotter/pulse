// The band's own blood-pressure estimate, anchored to your cuff.
//
// The band stores a systolic/diastolic estimate with every HRV measurement (opcode 56; every 10 minutes on the dense
// schedule). The vendor's method is unknown and the band exposes no raw pulse waveform, so, like every cuffless
// estimate, it has to be calibrated per person (Mukkamala, IEEE TBME 2015; ESH cuffless statement, J Hypertens 2023).
// Each home cuff sitting is an anchor: Pulse pairs it with the band's readings from the same half hour and learns how
// far off the band runs for you (offset) and how much of its swing is real (slope).
//
// The fit is Bayesian. Before any anchor the band is taken as-is with a wide range. One reading moves the line part of
// the way, a handful pin the offset down, and the slope only leaves 1 once anchors cover a spread of band values.
// Anchors far in time from the moment being estimated count for less (half-life 60 days), because the band-to-cuff
// relationship drifts. Accuracy is measured the honest way: each anchor is predicted only from the anchors before it.
// Cuff readings stay the basis of every category, average and risk score; the calibrated line fills in between them.
import { toMs } from "../core/time.js?v=20261014180338";
import { sessions } from "./homebp.js?v=20261014180338";

/** Minutes either side of a cuff sitting that the band's readings are taken from. */
export const WIN = 30;
/** Days for an anchor's weight to halve with distance in time. */
export const HALF_LIFE = 60;
/** Prior per channel (mmHg): offset spread across people, slope spread around 1, and one anchor's scatter. The noise
 *  prior is worth NU0 anchors; the person's own scatter replaces it as anchors accumulate. */
export const PRIOR = { sys: { offsetSd: 15, slopeSd: 0.3, noise: 7 }, dia: { offsetSd: 10, slopeSd: 0.3, noise: 5 } };
const NU0 = 3;
/** z for an 80% two-sided range. */
export const Z80 = 1.2816;

const ok = (r) => r && r.sys > 0 && r.dia > 0 && r.sys > r.dia;

/** Band rows [{t, sys, dia}] → sorted [{t, ms, sys, dia}] (the band's failed measurements are dropped upstream). */
export function prepBand(rows) {
  return (rows ?? []).filter(ok).map((r) => ({ t: r.t, ms: r.ms ?? toMs(r.t), sys: r.sys, dia: r.dia })).sort((a, b) => a.ms - b.ms);
}
function lowerBound(B, ms) { let lo = 0, hi = B.length; while (lo < hi) { const m = (lo + hi) >> 1; if (B[m].ms < ms) lo = m + 1; else hi = m; } return lo; }

/** The band's estimate around `ms`: its readings within ±`win` minutes, nearer ones counting more (triangular
 *  weights). {sys, dia, n, dtMin} or null when the band has nothing that close. */
export function bandAt(B, ms, win = WIN) {
  const W = win * 60e3;
  let sw = 0, ss = 0, sd = 0, n = 0, near = Infinity;
  for (let i = lowerBound(B, ms - W); i < B.length && B[i].ms <= ms + W; i++) {
    const d = Math.abs(B[i].ms - ms), w = 1 - d / W;
    if (w <= 0) continue;
    sw += w; ss += w * B[i].sys; sd += w * B[i].dia; n++; near = Math.min(near, d);
  }
  return n ? { sys: ss / sw, dia: sd / sw, n, dtMin: near / 60e3 } : null;
}

/** Cuff sittings (readings within 10 minutes averaged, as the home protocol does), each with the band's estimate
 *  from the same half hour, oldest first. `band` is null for a sitting the band can't anchor. */
export function anchors(cuff, B) {
  return sessions(cuff).map((s) => { const ms = toMs(s.t); return { t: s.t, ms, sys: s.sys, dia: s.dia, n: s.n, band: bandAt(B, ms) }; });
}

const weightAt = (aMs, ms, halfLife) => 0.5 ** (Math.abs(ms - aMs) / (halfLife * 864e5));

/**
 * One channel: cuff − band = offset + (slope − 1)·(band − center) + noise, with a normal prior on offset (0) and
 * slope (1) and the noise level estimated from the anchors' own scatter. `pts` = [{x: band, y: cuff, w}].
 * Returns {offset, slope, center, cov (2×2 posterior covariance of [offset, slope−1]), sigma, n, w}.
 */
export function fitChannel(pts, P) {
  const W = pts.reduce((a, p) => a + p.w, 0);
  const m = W > 0 ? pts.reduce((a, p) => a + p.w * p.x, 0) / W : null;
  let s2 = P.noise ** 2, mu = [0, 0], C = [[P.offsetSd ** 2, 0], [0, P.slopeSd ** 2]];
  if (!(W > 0)) return { offset: 0, slope: 1, center: null, cov: C, sigma: P.noise, n: 0, w: 0 };
  for (let it = 0; it < 4; it++) {
    // Posterior precision and mean for the given noise level.
    let a = 1 / P.offsetSd ** 2, b = 0, d = 1 / P.slopeSd ** 2, g0 = 0, g1 = 0;
    for (const p of pts) { const z1 = p.x - m, r = p.y - p.x, k = p.w / s2; a += k; b += k * z1; d += k * z1 * z1; g0 += k * r; g1 += k * z1 * r; }
    const det = a * d - b * b;
    C = [[d / det, -b / det], [-b / det, a / det]];
    mu = [C[0][0] * g0 + C[0][1] * g1, C[1][0] * g0 + C[1][1] * g1];
    const ssr = pts.reduce((acc, p) => acc + p.w * (p.y - p.x - mu[0] - mu[1] * (p.x - m)) ** 2, 0);
    s2 = (NU0 * P.noise ** 2 + ssr) / (NU0 + W);
  }
  return { offset: mu[0], slope: 1 + mu[1], center: m, cov: C, sigma: Math.sqrt(s2), n: pts.length, w: W };
}

/** What a cuff would read given band value `x`: {v, sd} (sd covers the calibration's uncertainty and one reading's
 *  scatter, so an 80% range is v ± 1.28·sd). */
export function predict(fit, x) {
  const z1 = fit.center == null ? 0 : x - fit.center;
  const v = x + fit.offset + (fit.slope - 1) * z1;
  const C = fit.cov, varC = C[0][0] + 2 * z1 * C[0][1] + z1 * z1 * C[1][1];
  return { v, sd: Math.sqrt(fit.sigma ** 2 + varC) };
}

/**
 * Calibration as of `ms`: every anchor with a band pair, weighted by its distance in time from `ms`. With
 * `before: true` only anchors strictly earlier count (used to score predictions honestly).
 */
export function calibrateAt(A, ms, { before = false, halfLife = HALF_LIFE, prior = PRIOR } = {}) {
  const use = A.filter((a) => a.band && (!before || a.ms < ms));
  const pts = (k) => use.map((a) => ({ x: a.band[k], y: a[k], w: weightAt(a.ms, ms, halfLife) }));
  return { n: use.length, sys: fitChannel(pts("sys"), prior.sys), dia: fitChannel(pts("dia"), prior.dia) };
}

/** Band reading → calibrated {sys, dia, sysSd, diaSd}. */
export function apply(cal, b) {
  const s = predict(cal.sys, b.sys), d = predict(cal.dia, b.dia);
  return { sys: s.v, dia: d.v, sysSd: s.sd, diaSd: d.sd };
}

const meanAbs = (xs) => (xs.length ? xs.reduce((a, x) => a + Math.abs(x), 0) / xs.length : null);
const meanOf = (xs) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null);

/**
 * Time-ordered check: each anchor is predicted three ways from what was known just before it — the band as-is, the
 * band calibrated on earlier anchors only, and the previous cuff sitting — and the misses are compared on the same
 * anchors (those with a band pair and at least one earlier calibrated anchor). Returns the per-anchor rows (newest
 * last) and mean absolute misses {raw, cal, last} for systolic and diastolic, plus the band's raw bias over every pair.
 */
export function validate(A) {
  const rows = [];
  A.forEach((a, i) => {
    const prev = i > 0 ? A[i - 1] : null;
    if (!a.band) { rows.push({ t: a.t, ms: a.ms, cuff: { sys: a.sys, dia: a.dia }, raw: null, cal: null, last: prev ? { sys: prev.sys, dia: prev.dia } : null, before: 0 }); return; }
    const c = calibrateAt(A, a.ms, { before: true });
    rows.push({ t: a.t, ms: a.ms, cuff: { sys: a.sys, dia: a.dia }, raw: { sys: a.band.sys, dia: a.band.dia }, cal: c.n ? apply(c, a.band) : null, last: prev ? { sys: prev.sys, dia: prev.dia } : null, before: c.n });
  });
  const scored = rows.filter((r) => r.raw && r.cal && r.last);
  const miss = (k, src) => meanAbs(scored.map((r) => r[src][k] - r.cuff[k]));
  const paired = rows.filter((r) => r.raw);
  return {
    rows, n: scored.length, pairs: paired.length,
    sys: { raw: miss("sys", "raw"), cal: miss("sys", "cal"), last: miss("sys", "last") },
    dia: { raw: miss("dia", "raw"), cal: miss("dia", "cal"), last: miss("dia", "last") },
    bias: { sys: meanOf(paired.map((r) => r.raw.sys - r.cuff.sys)), dia: meanOf(paired.map((r) => r.raw.dia - r.cuff.dia)) },
  };
}

/**
 * The calibrated line between `from` and `to` (ms): band readings averaged into `bucketMin`-minute buckets (0 = every
 * reading), each calibrated with the anchors weighted by their distance from that bucket in time. Returns
 * [{ms, raw: {sys, dia}, sys, dia, sysSd, diaSd, n}].
 */
export function series(B, A, from, to, bucketMin = 0) {
  const out = [], i0 = lowerBound(B, from), cache = new Map();
  const calFor = (ms) => { const day = Math.floor(ms / 864e5); if (!cache.has(day)) cache.set(day, calibrateAt(A, day * 864e5 + 432e5)); return cache.get(day); };
  const push = (ms, sys, dia, n) => { const c = apply(calFor(ms), { sys, dia }); out.push({ ms, raw: { sys, dia }, ...c, n }); };
  if (!bucketMin) { for (let i = i0; i < B.length && B[i].ms <= to; i++) push(B[i].ms, B[i].sys, B[i].dia, 1); return out; }
  // Buckets follow local time (a daily bucket runs midnight to midnight where the phone is).
  const bw = bucketMin * 60e3, local = (ms) => ms - new Date(ms).getTimezoneOffset() * 60e3;
  let key = null, ss = 0, sd = 0, sm = 0, n = 0;
  const flush = () => { if (n) push(sm / n, ss / n, sd / n, n); ss = sd = sm = n = 0; };
  for (let i = i0; i < B.length && B[i].ms <= to; i++) {
    const k = Math.floor(local(B[i].ms) / bw);
    if (k !== key) { flush(); key = k; }
    ss += B[i].sys; sd += B[i].dia; sm += B[i].ms; n++;
  }
  flush();
  return out;
}

/**
 * Estimated night-time dip from the calibrated line: mean systolic/diastolic while asleep vs awake, over sleep
 * windows [[startMs, endMs], …] and the waking hours between them (from the first window's start to `to`). Needs 6
 * asleep and 12 awake readings. The ESH dipping categories come from 24-hour cuff studies, so this is orientation only.
 */
export function dip(points, windows, to) {
  if (!windows.length) return null;
  const from = Math.min(...windows.map((w) => w[0])), inSleep = (ms) => windows.some(([a, b]) => ms >= a && ms <= b);
  const pts = points.filter((p) => p.ms >= from && p.ms <= to);
  const night = pts.filter((p) => inSleep(p.ms)), day = pts.filter((p) => !inSleep(p.ms));
  if (night.length < 6 || day.length < 12) return { need: true, nNight: night.length, nDay: day.length };
  const m = (xs, k) => meanOf(xs.map((p) => p[k]));
  const daySys = m(day, "sys"), nightSys = m(night, "sys"), dayDia = m(day, "dia"), nightDia = m(night, "dia");
  return { daySys, nightSys, dayDia, nightDia, sys: ((daySys - nightSys) / daySys) * 100, dia: ((dayDia - nightDia) / dayDia) * 100, nNight: night.length, nDay: day.length };
}

/** Everything the BP screens need, in one pass. `now` in ms. */
export function bpBand(cuff, bandRows, { now = Date.now() } = {}) {
  const B = prepBand(bandRows), A = anchors(cuff ?? [], B), cal = calibrateAt(A, now), last = B[B.length - 1] ?? null;
  return { B, A, cal, check: validate(A), latest: last ? { t: last.t, ms: last.ms, raw: { sys: last.sys, dia: last.dia }, ...apply(calibrateAt(A, last.ms), last) } : null };
}
