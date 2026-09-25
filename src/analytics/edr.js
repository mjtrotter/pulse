// ECG-derived respiration and beat morphology for finger-ECG spot checks (~256 Hz).
// Respiration: three channels per the research plan (RSA in the NN tachogram, R-peak amplitude, max QRS
// slope), each scored by spectral peak prominence, fused by a quality- and agreement-weighted median
// (Charlton 2016: fusion beats single features; QRS-slope EDR performs well on single leads).
// Morphology: an aligned median beat with QRS width and QT estimates (tangent method for T end) that
// are research-grade on a finger lead and must be reviewed visually (Garabelli 2016).

const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
const median = (v) => { const a = [...v].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

/** Dominant frequency (Hz) of an unevenly sampled series (times s, values) between lo and hi Hz,
 *  via linear resampling at 4 Hz, detrending, Hann window and a DFT scan. clarity = peak / median power. */
export function dominant(times, values, { lo = 0.1, hi = 0.5, step = 0.0025 } = {}) {
  if (times.length < 10 || times[times.length - 1] - times[0] < 20) return null;
  const fs = 4, x = [];
  for (let t = times[0], j = 0; t <= times[times.length - 1]; t += 1 / fs) {
    while (j + 1 < times.length && times[j + 1] < t) j++;
    const f = j + 1 < times.length ? (t - times[j]) / (times[j + 1] - times[j]) : 0;
    x.push(j + 1 < times.length ? values[j] + f * (values[j + 1] - values[j]) : values[j]);
  }
  const n = x.length, idx = x.map((_, i) => i), mi = (n - 1) / 2, mx = mean(x);
  const slope = idx.reduce((a, i) => a + (i - mi) * (x[i] - mx), 0) / idx.reduce((a, i) => a + (i - mi) ** 2, 0);
  const y = x.map((v, i) => (v - (mx + slope * (i - mi))) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))));
  const pw = [];
  let best = { f: null, p: -1 };
  for (let f = lo; f <= hi + 1e-12; f += step) {
    let c = 0, s = 0;
    for (let i = 0; i < n; i++) { const a = (2 * Math.PI * f * i) / fs; c += y[i] * Math.cos(a); s += y[i] * Math.sin(a); }
    const p = c * c + s * s;
    pw.push(p);
    if (p > best.p) best = { f, p };
  }
  const clarity = best.p / (median(pw) || 1);
  return { hz: best.f, rate: best.f * 60, clarity };
}

/**
 * Fused breathing rate from an ECG recording. peaks: R-peak sample indices; good: per-peak quality flags;
 * bp: the band-passed ECG; fs: sample rate. Returns {rate, channels: [{name, rate, clarity, weight}], agreement}.
 * Weights w_k = q_k · p_k · a_k (quality × prominence × agreement), fused with a weighted median.
 */
export function edrFusion(peaks, good, bp, fs = 256) {
  const ok = peaks.map((p, i) => ({ p, g: good[i] })).filter((b) => b.g);
  if (ok.length < 20) return null;
  const t = ok.map((b) => b.p / fs);
  const chans = [];
  // 1. RSA: beat-to-beat interval, timed at the interval's midpoint
  const rrT = [], rrV = [];
  for (let i = 1; i < ok.length; i++) { const d = (ok[i].p - ok[i - 1].p) / fs; if (d > 0.3 && d < 2) { rrT.push((t[i] + t[i - 1]) / 2); rrV.push(d * 1000); } }
  chans.push({ name: "Beat timing (RSA)", ...(dominant(rrT, rrV) ?? {}) });
  // 2. R amplitude
  chans.push({ name: "R-wave amplitude", ...(dominant(t, ok.map((b) => Math.abs(bp[b.p]))) ?? {}) });
  // 3. Max QRS slope within ±40 ms of R
  const w = Math.round(0.04 * fs);
  const slopes = ok.map((b) => { let m = 0; for (let k = Math.max(1, b.p - w); k < Math.min(bp.length, b.p + w); k++) m = Math.max(m, Math.abs(bp[k] - bp[k - 1])); return m; });
  chans.push({ name: "QRS slope", ...(dominant(t, slopes) ?? {}) });
  const valid = chans.filter((c) => c.rate != null && c.clarity >= 2);
  if (!valid.length) return { rate: null, channels: chans, agreement: 0 };
  const med = median(valid.map((c) => c.rate));
  for (const c of chans) {
    if (c.rate == null || c.clarity < 2) { c.weight = 0; continue; }
    const agree = Math.exp(-Math.abs(c.rate - med) / 2); // 2 breaths/min scale
    c.weight = Math.min(10, c.clarity) * agree;
  }
  const ws = chans.filter((c) => c.weight > 0).sort((a, b) => a.rate - b.rate);
  const tot = ws.reduce((a, c) => a + c.weight, 0);
  let acc = 0, rate = ws[0].rate;
  for (const c of ws) { acc += c.weight; if (acc >= tot / 2) { rate = c.rate; break; } }
  const spread = Math.max(...ws.map((c) => c.rate)) - Math.min(...ws.map((c) => c.rate));
  return { rate, channels: chans, agreement: ws.length >= 2 ? Math.max(0, 1 - spread / 6) : 0.4 };
}

/** Gentle morphology filter: remove baseline wander (subtract a 0.4 s moving average) and smooth lightly
 *  (3-sample moving average ≈ 12 ms at 256 Hz). Keeps P/QRS/T shape, unlike the 5-20 Hz detector band. */
export function morphologyFilter(x, fs = 256) {
  const w = Math.round(0.4 * fs) | 1, h = w >> 1, n = x.length, pre = [0];
  for (const v of x) pre.push(pre[pre.length - 1] + v);
  const base = x.map((_, i) => { const a = Math.max(0, i - h), b = Math.min(n, i + h + 1); return (pre[b] - pre[a]) / (b - a); });
  const y = x.map((v, i) => v - base[i]);
  return y.map((_, i) => (y[Math.max(0, i - 1)] + y[i] + y[Math.min(n - 1, i + 1)]) / 3);
}

/**
 * Median beat (−250..+550 ms around each good R peak) of the gently filtered ECG, and fiducials on it:
 * QRS onset/offset = first/last sample with a slope ≥ 8% of the steepest QRS slope (so the S upstroke counts);
 * T peak = largest excursion 80-450 ms after QRS end; T end by the tangent method (tangent at the steepest
 * post-peak slope meets the baseline). QTc by Fridericia (QT / RR^(1/3)), preferred over Bazett (Luo 2004).
 * Research-grade on a finger lead: always shown with the template so it can be checked by eye.
 */
export function medianBeat(x, peaks, good, fs = 256, rrMs = null) {
  const pre = Math.round(0.25 * fs), post = Math.round(0.55 * fs);
  const beats = peaks.filter((p, i) => good[i] && p - pre >= 0 && p + post < x.length).map((p) => x.slice(p - pre, p + post));
  if (beats.length < 8) return null;
  const L = pre + post;
  const tpl = Array.from({ length: L }, (_, j) => median(beats.map((b) => b[j])));
  const base = median(tpl.slice(0, Math.round(0.06 * fs)));
  let y = tpl.map((v) => v - base);
  if (y[pre] < 0) y = y.map((v) => -v); // show R upright whatever the finger/wrist polarity
  const d = y.map((v, i) => (i ? v - y[i - 1] : 0)), a = d.map(Math.abs);
  const w60 = Math.round(0.06 * fs), w100 = Math.round(0.1 * fs);
  // QRS = the span where the slope is significant (≥ 8% of the steepest QRS slope): the first such sample
  // up to 100 ms before R, and the last one up to 120 ms after R (so the S-wave upstroke is included).
  let amax = 0;
  for (let i = pre - w60; i <= pre + w60; i++) amax = Math.max(amax, a[i]);
  const thr = 0.08 * amax, w120 = Math.round(0.12 * fs);
  let on = pre, off = pre;
  for (let i = pre - w100; i <= pre; i++) if (a[i] > thr) { on = i - 1; break; }
  for (let i = pre + w120; i >= pre; i--) if (a[i] > thr) { off = i; break; }
  const tA = off + Math.round(0.08 * fs), tB = Math.min(L - 2, pre + Math.round(0.45 * fs));
  let tPk = tA;
  for (let i = tA; i <= tB; i++) if (Math.abs(y[i]) > Math.abs(y[tPk])) tPk = i;
  const sign = Math.sign(y[tPk]) || 1;
  let steep = tPk;
  for (let i = tPk; i < Math.min(L - 1, tPk + Math.round(0.16 * fs)); i++) if (sign * d[i] < sign * d[steep]) steep = i;
  const slope = d[steep];
  const tEnd = slope !== 0 ? Math.min(L - 1, Math.max(steep, Math.round(steep - y[steep] / slope))) : null;
  const ms = (k) => (k * 1000) / fs;
  const qrs = ms(off - on), qt = tEnd != null ? ms(tEnd - on) : null;
  return {
    template: y, fs, pre, beats: beats.length, qrsOn: on, qrsOff: off, tPeak: tPk, tEnd, tAmp: y[tPk], rAmp: y[pre],
    qrs_ms: qrs, qt_ms: qt, qtcF: qt && rrMs ? qt / Math.cbrt(rrMs / 1000) : null, qtcB: qt && rrMs ? qt / Math.sqrt(rrMs / 1000) : null,
  };
}
