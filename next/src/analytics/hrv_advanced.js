// Advanced HRV on clean NN intervals (ms) from a finger-ECG recording (or a long pulse burst).
// Each metric states the minimum recording it needs; callers show only what the data supports.
// Validated against NeuroKit2 (Makowski 2021) on a real 2-minute V8 strip (test/hrv_advanced.test.js).

const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
const sdev = (v, ddof = 1) => { const m = mean(v); return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - ddof)); };

/** Poincaré plot descriptors (Brennan 2001): SD1 = short-term, SD2 = long-term variability. */
export function poincare(nn) {
  if (nn.length < 10) return null;
  const x = nn.slice(0, -1), y = nn.slice(1);
  const d1 = x.map((v, i) => (y[i] - v) / Math.SQRT2), d2 = x.map((v, i) => (y[i] + v) / Math.SQRT2);
  const sd1 = sdev(d1), sd2 = sdev(d2);
  return { sd1, sd2, ratio: sd1 / sd2, area: Math.PI * sd1 * sd2, csi: sd2 / sd1, cvi: Math.log10(sd1 * sd2 * 16) };
}

/** Detrended fluctuation analysis, short-term exponent α1 over box sizes 4-16 beats (Peng 1995).
 *  Needs ≥ ~100 beats (≈ 1.5-2 min). α1 ≈ 1 healthy resting; → 0.5 random; drops with exercise intensity. */
export function dfaAlpha1(nn, nMin = 4, nMax = 16) {
  if (nn.length < 64) return null;
  const m = mean(nn);
  const y = []; let acc = 0;
  for (const v of nn) { acc += v - m; y.push(acc); }
  const xs = [], fs = [];
  for (let n = nMin; n <= nMax; n++) {
    const boxes = Math.floor(y.length / n);
    if (boxes < 2) break;
    let f2 = 0;
    for (let b = 0; b < boxes; b++) {
      // least-squares line within the box
      let sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (let k = 0; k < n; k++) { const yy = y[b * n + k]; sx += k; sy += yy; sxx += k * k; sxy += k * yy; }
      const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx), icpt = (sy - slope * sx) / n;
      for (let k = 0; k < n; k++) { const r = y[b * n + k] - (icpt + slope * k); f2 += r * r; }
    }
    xs.push(Math.log10(n)); fs.push(Math.log10(Math.sqrt(f2 / (boxes * n))));
  }
  const mx = mean(xs), mf = mean(fs);
  return xs.reduce((a, x, i) => a + (x - mx) * (fs[i] - mf), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
}

/** Sample entropy (Richman & Moorman 2000), m = 2, r = 0.2 × SD. Lower = more regular. Needs ≥ ~100 beats. */
export function sampleEntropy(nn, m = 2, rFrac = 0.2) {
  const N = nn.length;
  if (N < 60) return null;
  const r = rFrac * sdev(nn);
  const count = (mm) => {
    let c = 0;
    for (let i = 0; i < N - m; i++) for (let j = i + 1; j < N - m; j++) {
      let ok = true;
      for (let k = 0; k < mm; k++) if (Math.abs(nn[i + k] - nn[j + k]) > r) { ok = false; break; }
      if (ok) c++;
    }
    return c;
  };
  const B = count(m), A = count(m + 1);
  return A > 0 && B > 0 ? -Math.log(A / B) : null;
}

/** Heart-rate fragmentation (Costa 2017): PIP % inflection points, IALS inverse mean segment length,
 *  PSS % of NN in short (<3) segments, PAS % in alternating segments (≥4 intervals). Higher PIP = more
 *  fragmented (associated with ageing/CAD). Descriptive in this app. */
export function fragmentation(nn) {
  if (nn.length < 20) return null;
  const d = nn.slice(1).map((v, i) => v - nn[i]);
  const sign = d.map((x) => (x > 0 ? 1 : x < 0 ? -1 : 0));
  let infl = 0;
  for (let i = 1; i < sign.length; i++) if (sign[i] * sign[i - 1] <= 0) infl++;
  // segments of same-sign increments
  const segs = []; let len = 1;
  for (let i = 1; i < sign.length; i++) { if (sign[i] === sign[i - 1] && sign[i] !== 0) len++; else { segs.push(len); len = 1; } }
  segs.push(len);
  const short = segs.filter((l) => l < 3).reduce((a, l) => a + l, 0);
  // alternating runs: consecutive segments of length 1, at least 4 in a row
  let alt = 0, run = 0;
  for (const l of segs) { if (l === 1) run++; else { if (run >= 4) alt += run; run = 0; } }
  if (run >= 4) alt += run;
  return { pip: (100 * infl) / (sign.length - 1), ials: segs.length / sign.length, pss: (100 * short) / sign.length, pas: (100 * alt) / sign.length };
}

/**
 * Lomb-Scargle power spectrum of the NN series (no resampling needed for uneven beat times).
 * Bands (Task Force 1996): LF 0.04-0.15 Hz, HF 0.15-0.40 Hz. HF needs ≥ 1 min, LF ≥ 2 min (Baek 2015).
 * Returns absolute powers (ms²), ln powers, LF/HF (descriptive only; not an autonomic balance meter,
 * Billman 2013), normalized units and the HF peak frequency (≈ breathing rate when it lies in HF).
 */
export function spectrum(nn, { fmin = 0.0033, fmax = 0.5, df = 0.0025 } = {}) {
  if (nn.length < 40) return null;
  const t = []; let acc = 0;
  for (const v of nn) { acc += v / 1000; t.push(acc); }
  const dur = t[t.length - 1] - t[0];
  const mu = mean(nn), y = nn.map((v) => v - mu), variance = sdev(nn) ** 2;
  const freqs = [], pow = [];
  for (let f = fmin; f <= fmax + 1e-12; f += df) {
    const w = 2 * Math.PI * f;
    let s2 = 0, c2 = 0;
    for (const ti of t) { s2 += Math.sin(2 * w * ti); c2 += Math.cos(2 * w * ti); }
    const tau = Math.atan2(s2, c2) / (2 * w);
    let yc = 0, ys = 0, cc = 0, ss = 0;
    for (let i = 0; i < t.length; i++) { const a = w * (t[i] - tau), c = Math.cos(a), s = Math.sin(a); yc += y[i] * c; ys += y[i] * s; cc += c * c; ss += s * s; }
    freqs.push(f); pow.push(0.5 * (yc * yc / cc + ys * ys / ss));
  }
  // Scale the periodogram so its integral equals the NN variance (ms²).
  const total = pow.reduce((a, p) => a + p, 0) * df;
  const k = total > 0 ? variance / total : 0;
  const band = (lo, hi) => pow.reduce((a, p, i) => a + (freqs[i] >= lo && freqs[i] < hi ? p * k * df : 0), 0);
  const lf = band(0.04, 0.15), hf = band(0.15, 0.4), vlf = band(0.0033, 0.04);
  let hfPeak = null, best = -1;
  for (let i = 0; i < freqs.length; i++) if (freqs[i] >= 0.15 && freqs[i] < 0.4 && pow[i] > best) { best = pow[i]; hfPeak = freqs[i]; }
  return { duration: dur, vlf, lf, hf, lnLf: Math.log(lf), lnHf: Math.log(hf), lfhf: lf / hf, lfnu: (100 * lf) / (lf + hf), hfnu: (100 * hf) / (lf + hf), hfPeak,
    lfValid: dur >= 110, hfValid: dur >= 55, freqs, psd: pow.map((p) => p * k) };
}

/** Everything the app shows for a recording, gated by duration (seconds of clean NN). */
export function advancedHRV(nn) {
  const dur = nn.reduce((a, v) => a + v, 0) / 1000;
  const out = { beats: nn.length, duration: dur };
  out.poincare = poincare(nn);
  if (dur >= 90) { out.dfa1 = dfaAlpha1(nn); out.sampen = sampleEntropy(nn); }
  out.fragmentation = fragmentation(nn);
  if (dur >= 55) out.spectrum = spectrum(nn);
  out.cvnn = (100 * sdev(nn)) / mean(nn);
  return out;
}
