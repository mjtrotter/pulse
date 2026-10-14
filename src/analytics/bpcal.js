// The band's own blood-pressure estimate, anchored to your cuff.
//
// The band stores a systolic/diastolic estimate with every HRV measurement (opcode 56; every 10 minutes on the dense
// schedule, on a fixed grid such as :03, :13, :23 past the hour). Many daytime attempts fail (movement): those records
// carry hr = 0 and simply repeat the last good BP, so only good readings are used and the failed slots are kept for
// pacing. The vendor's method is unknown and the band exposes no raw pulse waveform, so, like every cuffless estimate,
// it has to be calibrated per person (Mukkamala, IEEE TBME 2015; ESH cuffless statement, J Hypertens 2023).
//
// Every cuff reading is an anchor. Pulse works out what the band would have read at that exact moment (interpolating
// between its good readings either side, up to 90 minutes away) and learns how far off the band runs for you (offset)
// and how much of its swing is real (slope). The fit uses the 30 cuff readings nearest in time (for "now", the 30 most
// recent); an anchor whose nearest band reading is far away counts for less, because the band value it is compared
// with is less certain. The fit is Bayesian: before any anchor the band is taken as-is with a wide range, one reading
// moves the line part of the way, and the slope only leaves 1 once anchors cover a spread of band values. Accuracy is
// measured the honest way: each reading is predicted only from cuff readings taken in earlier sittings.
// Cuff readings stay the basis of every category, average and risk score; the calibrated line fills in between them.
import { toMs } from "../core/time.js?v=20261014192250";

/** Most cuff readings a calibration uses (the nearest in time; for "now", the most recent). */
export const MAX_ANCHORS = 30;
/** Minutes: interpolate between good band readings up to this far either side of a cuff reading … */
export const PAIR_MAX = 90;
/** … or use a single good reading on one side up to this far away. */
export const ONE_SIDE = 45;
/** Weight of an anchor whose nearest good band reading is `gap` minutes away (1 at 0, ½ at 30, 0.2 at 60). */
export const pairWeight = (gap) => 1 / (1 + (gap / 30) ** 2);
/** Readings this close together (minutes) are one sitting. */
const SITTING = 10;
/** Prior per channel (mmHg): offset spread across people, slope spread around 1, and one anchor's scatter. The noise
 *  prior is worth NU0 anchors; the person's own scatter replaces it as anchors accumulate. */
export const PRIOR = { sys: { offsetSd: 15, slopeSd: 0.3, noise: 7 }, dia: { offsetSd: 10, slopeSd: 0.3, noise: 5 } };
const NU0 = 3;
/** z for an 80% two-sided range. */
export const Z80 = 1.2816;

const ok = (r) => r && r.sys > 0 && r.dia > 0 && r.sys > r.dia;

/** Good band readings [{t, sys, dia}] → sorted [{t, ms, sys, dia}] (failed attempts are dropped upstream). */
export function prepBand(rows) {
  return (rows ?? []).filter(ok).map((r) => ({ t: r.t, ms: r.ms ?? toMs(r.t), sys: r.sys, dia: r.dia })).sort((a, b) => a.ms - b.ms);
}
function lowerBound(B, ms) { let lo = 0, hi = B.length; while (lo < hi) { const m = (lo + hi) >> 1; if (B[m].ms < ms) lo = m + 1; else hi = m; } return lo; }

/** What the band would have read at `ms`: a straight line between its good readings just before and after (each
 *  within PAIR_MAX minutes), else the nearest good reading on one side within ONE_SIDE minutes, else null.
 *  {sys, dia, gap (minutes to the nearest reading), before, after (minutes, or null), how} */
export function bandAt(B, ms) {
  const i = lowerBound(B, ms), aft = B[i] ?? null, bef = i > 0 ? B[i - 1] : null;
  const gb = bef ? (ms - bef.ms) / 60e3 : Infinity, ga = aft ? (aft.ms - ms) / 60e3 : Infinity;
  if (bef && aft && gb <= PAIR_MAX && ga <= PAIR_MAX) {
    const f = gb / (gb + ga);
    return { sys: bef.sys + f * (aft.sys - bef.sys), dia: bef.dia + f * (aft.dia - bef.dia), gap: Math.min(gb, ga), before: gb, after: ga, how: ga === 0 ? "at" : "between" };
  }
  if (gb <= ONE_SIDE) return { sys: bef.sys, dia: bef.dia, gap: gb, before: gb, after: null, how: "before" };
  if (ga <= ONE_SIDE) return { sys: aft.sys, dia: aft.dia, gap: ga, before: null, after: ga, how: ga === 0 ? "at" : "after" };
  return null;
}

/** Every cuff reading, oldest first, with its sitting number, the band's value at that moment (or null) and its
 *  weight. [{t, ms, sys, dia, pulse, sit, band, w}] */
export function anchors(cuff, B) {
  const rs = (cuff ?? []).filter(ok).map((r) => ({ ...r, ms: toMs(r.t) })).sort((a, b) => a.ms - b.ms);
  let sit = -1, prev = -Infinity;
  return rs.map((r) => {
    if (r.ms - prev > SITTING * 60e3) sit++;
    prev = r.ms;
    const band = bandAt(B, r.ms);
    return { t: r.t, ms: r.ms, sys: r.sys, dia: r.dia, pulse: r.pulse ?? null, sit, band, w: band ? pairWeight(band.gap) : 0 };
  });
}

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
 * Calibration as of `ms` from the MAX_ANCHORS paired cuff readings nearest in time, each weighted by how close its
 * band value was. With `beforeSit`, only readings from earlier sittings count (used to score predictions honestly).
 * {n (anchors used), sys, dia}
 */
export function calibrateAt(A, ms, { beforeSit = null, prior = PRIOR } = {}) {
  let use = A.filter((a) => a.band && (beforeSit == null || a.sit < beforeSit));
  if (use.length > MAX_ANCHORS) use = [...use].sort((x, y) => Math.abs(x.ms - ms) - Math.abs(y.ms - ms)).slice(0, MAX_ANCHORS);
  const pts = (k) => use.map((a) => ({ x: a.band[k], y: a[k], w: a.w }));
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
 * Time-ordered check: each cuff reading is predicted three ways from what was known before its sitting — the band
 * as-is, the band calibrated on readings from earlier sittings only, and the previous sitting's average — and the misses
 * are compared on the same readings (those with a band value and at least one earlier calibrated anchor). Returns the
 * per-reading rows (newest last), mean absolute misses {raw, cal, last} for systolic and diastolic, the band's raw bias
 * over every pair, and systolic 95% limits of agreement {raw, cal} (Bland & Altman, Lancet 1986).
 */
export function validate(A) {
  const rows = [], sits = new Map();
  for (const a of A) { if (!sits.has(a.sit)) sits.set(a.sit, []); sits.get(a.sit).push(a); }
  const avg = (rs, k) => rs.reduce((s, r) => s + r[k], 0) / rs.length;
  for (const a of A) {
    const p = sits.get(a.sit - 1), last = p ? { sys: avg(p, "sys"), dia: avg(p, "dia") } : null;
    const base = { t: a.t, ms: a.ms, sit: a.sit, w: a.w, pair: a.band, cuff: { sys: a.sys, dia: a.dia }, last };
    if (!a.band) { rows.push({ ...base, raw: null, cal: null, before: 0 }); continue; }
    const c = calibrateAt(A, a.ms, { beforeSit: a.sit });
    rows.push({ ...base, raw: { sys: a.band.sys, dia: a.band.dia }, cal: c.n ? apply(c, a.band) : null, before: c.n });
  }
  const scored = rows.filter((r) => r.raw && r.cal && r.last);
  const miss = (k, src) => meanAbs(scored.map((r) => r[src][k] - r.cuff[k]));
  const paired = rows.filter((r) => r.raw), predicted = rows.filter((r) => r.cal);
  // Bland–Altman 95% limits of agreement (bias ± 1.96 SD of the differences); needs 3 differences.
  const loa = (d) => { if (d.length < 3) return null; const m = meanOf(d), sd = Math.sqrt(d.reduce((s2, x) => s2 + (x - m) ** 2, 0) / (d.length - 1)); return { bias: m, lo: m - 1.96 * sd, hi: m + 1.96 * sd, n: d.length }; };
  return {
    rows, n: scored.length, pairs: paired.length,
    sys: { raw: miss("sys", "raw"), cal: miss("sys", "cal"), last: miss("sys", "last") },
    dia: { raw: miss("dia", "raw"), cal: miss("dia", "cal"), last: miss("dia", "last") },
    bias: { sys: meanOf(paired.map((r) => r.raw.sys - r.cuff.sys)), dia: meanOf(paired.map((r) => r.raw.dia - r.cuff.dia)) },
    agree: { raw: loa(paired.map((r) => r.raw.sys - r.cuff.sys)), cal: loa(predicted.map((r) => r.cal.sys - r.cuff.sys)) },
  };
}

/**
 * The calibrated line between `from` and `to` (ms): band readings averaged into `bucketMin`-minute buckets (0 = every
 * reading), each calibrated with the cuff readings nearest that day (calibrateAt). Returns
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

/**
 * How the band paces its BP measurements, from every attempt [{t, ok}] (ok = a good reading; failed ones have hr = 0):
 * {interval (min), last (ms of the newest attempt), lastGood (ms), next (ms of the next expected slot after `now`),
 *  recent: [{ms, ok}] attempts in the last `hours`, okShare (good share of attempts in the last 24 h)} or null.
 */
export function pacing(attempts, now = Date.now(), hours = 3) {
  const at = (attempts ?? []).map((r) => ({ ms: r.ms ?? toMs(r.t), ok: !!r.ok })).sort((a, b) => a.ms - b.ms);
  if (!at.length) return null;
  const recent2d = at.filter((a) => a.ms >= now - 2 * 864e5), gaps = [];
  for (let i = 1; i < recent2d.length; i++) gaps.push(Math.round((recent2d[i].ms - recent2d[i - 1].ms) / 60e3));
  gaps.sort((a, b) => a - b);
  const interval = gaps.length ? Math.max(5, gaps[gaps.length >> 1]) : 10, last = at[at.length - 1].ms;
  let next = last + interval * 60e3;
  while (next <= now) next += interval * 60e3;
  const day = at.filter((a) => a.ms >= now - 864e5), good = [...at].reverse().find((a) => a.ok);
  return { interval, last, lastGood: good ? good.ms : null, next, recent: at.filter((a) => a.ms >= now - hours * 36e5), okShare: day.length ? day.filter((a) => a.ok).length / day.length : null };
}

/** Everything the BP screens need, in one pass. `bandRows` are good readings; `attempts` (optional) every slot. */
export function bpBand(cuff, bandRows, { now = Date.now(), attempts = null } = {}) {
  const B = prepBand(bandRows), A = anchors(cuff ?? [], B), cal = calibrateAt(A, now), last = B[B.length - 1] ?? null;
  return { B, A, cal, check: validate(A), pace: pacing(attempts ?? B.map((b) => ({ ms: b.ms, ok: true })), now),
    latest: last ? { t: last.t, ms: last.ms, raw: { sys: last.sys, dia: last.dia }, ...apply(calibrateAt(A, last.ms), last) } : null };
}
