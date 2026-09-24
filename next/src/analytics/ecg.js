// ECG spot check: R-peaks, beat quality, and HRV. Line-for-line port of metrics.py
// (ecg_peaks, beat_quality, rr_clean, hrv, baevsky, rhythm, ecg_summary); golden-tested.

// 2nd-order Butterworth band-pass 5-20 Hz at fs = 256 Hz, identical to metrics.BP_B / BP_A.
const BP_B = [0.02670707213833987, 0.0, -0.05341414427667974, 0.0, 0.02670707213833987];
const BP_A = [1.0, -3.381742351812033, 4.385192840646837, -2.594899738363064, 0.5942807145442011];

export const ECG_FS = 256;
/** Vendor scaling (MSResolveUtil.processData): 24-bit ADC count to millivolts. */
export const toMillivolts = (raw) => ((raw - 0x1f0000) * 2.4 * 1000) / 4063232.0 / 20.6;

/** Samples (mV) from one 0x07 notification: 24-bit little-endian values from byte 2. */
export function decodeEcgPacket(p) {
  const out = [];
  for (let i = 2; i + 2 < p.length; i += 3) out.push(toMillivolts(p[i] | (p[i + 1] << 8) | (p[i + 2] << 16)));
  return out;
}

function movingMean(x, w) {
  const n = x.length, h = Math.floor(w / 2), pre = [0];
  for (const v of x) pre.push(pre[pre.length - 1] + v);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const hi = Math.min(n, i + h + 1), lo = Math.max(0, i - h);
    out[i] = (pre[hi] - pre[lo]) / (hi - lo);
  }
  return out;
}

function lfilter(b, a, x) {
  const y = new Array(x.length).fill(0);
  for (let n = 0; n < x.length; n++) {
    let acc = 0.0;
    for (let k = 0; k < b.length; k++) if (n - k >= 0) acc += b[k] * x[n - k];
    for (let k = 1; k < a.length; k++) if (n - k >= 0) acc -= a[k] * y[n - k];
    y[n] = acc;
  }
  return y;
}

export function bandpass(x) {
  const fwd = lfilter(BP_B, BP_A, x);
  return lfilter(BP_B, BP_A, fwd.slice().reverse()).reverse();
}

const median = (v) => { const m = v.length; return m % 2 ? v[Math.floor(m / 2)] : (v[m / 2 - 1] + v[m / 2]) / 2; };

export function ecgPeaks(x, fs = ECG_FS) {
  const n = x.length;
  if (n < fs * 2) return { peaks: [], bp: [] };
  const bp = bandpass(x);
  const d = [0.0];
  for (let i = 1; i < n; i++) d.push((bp[i] - bp[i - 1]) * (bp[i] - bp[i - 1]));
  const e = movingMean(d, Math.floor(0.15 * fs) | 1);
  const win = Math.floor(2 * fs), refr = Math.floor(0.25 * fs), snap = Math.floor(0.06 * fs), edge = Math.floor(0.5 * fs);
  const cands = [];
  let i = edge;
  while (i < n - edge) {
    const lo = Math.max(0, i - Math.floor(win / 2)), hi = Math.min(n, i + Math.floor(win / 2));
    let m = -Infinity;
    for (let k = lo; k < hi; k++) if (e[k] > m) m = e[k];
    const thr = 0.35 * m;
    if (e[i] > thr) {
      // Walk to the true energy maximum within the next 150 ms before committing.
      let j = i;
      for (let k = i; k < Math.min(n - edge, i + Math.floor(0.15 * fs)); k++) if (e[k] > e[j]) j = k;
      cands.push(j);
      i = j + refr;
    } else i += 1;
  }
  if (!cands.length) return { peaks: [], bp };
  // One polarity for the whole recording (R points up or down depending on the wrist).
  const win1 = (c) => bp.slice(Math.max(0, c - snap), Math.min(n, c + snap + 1));
  const ups = cands.map((c) => Math.max(...win1(c))).sort((a, b) => a - b);
  const downs = cands.map((c) => -Math.min(...win1(c))).sort((a, b) => a - b);
  const sign = median(ups) >= median(downs) ? 1.0 : -1.0;
  const peaks = [];
  for (const c of cands) {
    const a = Math.max(0, c - snap), b = Math.min(n, c + snap + 1);
    let r = a;
    for (let k = a; k < b; k++) if (sign * bp[k] > sign * bp[r]) r = k;
    if (!peaks.length || r - peaks[peaks.length - 1] >= refr) peaks.push(r);
  }
  return { peaks, bp };
}

export function beatQuality(peaks, bp, fs = ECG_FS) {
  const pre = Math.floor(0.2 * fs), post = Math.floor(0.3 * fs), L = pre + post;
  const idx = peaks.filter((p) => p - pre >= 0 && p + post <= bp.length);
  const beats = idx.map((p) => bp.slice(p - pre, p + post));
  const q = new Map(peaks.map((p) => [p, 0.0]));
  if (beats.length < 5) return q;
  const template = [];
  for (let j = 0; j < L; j++) {
    const col = beats.map((b) => b[j]).sort((u, v) => u - v);
    const m = col.length;
    template.push(m % 2 ? col[Math.floor(m / 2)] : (col[m / 2 - 1] + col[m / 2]) / 2);
  }
  const sum = (arr) => arr.reduce((s, v) => s + v, 0);
  const corr = (u, v) => {
    const mu = sum(u) / L, mv = sum(v) / L;
    const su = Math.sqrt(sum(u.map((a) => (a - mu) * (a - mu))));
    const sv = Math.sqrt(sum(v.map((b) => (b - mv) * (b - mv))));
    if (su === 0 || sv === 0) return 0.0;
    return sum(u.map((a, k) => (a - mu) * (v[k] - mv))) / (su * sv);
  };
  idx.forEach((p, k) => q.set(p, corr(beats[k], template)));
  return q;
}

export function rrClean(peaks, fs = ECG_FS, good = null) {
  const rr = [];
  for (let i = 1; i < peaks.length; i++) rr.push(((peaks[i] - peaks[i - 1]) * 1000.0) / fs);
  const out = [];
  rr.forEach((v, i) => {
    if (good && !(good[i] && good[i + 1])) return;
    if (!(v >= 300 && v <= 2000)) return;
    const nb = rr.slice(Math.max(0, i - 2), i + 3).sort((a, b) => a - b);
    const med = nb[Math.floor(nb.length / 2)];
    if (Math.abs(v - med) <= 0.2 * med) out.push(v);
  });
  return { rr: out, raw: rr.length };
}

export function baevsky(rr) {
  const bins = new Map();
  for (const v of rr) { const k = Math.floor(v / 50); bins.set(k, (bins.get(k) ?? 0) + 1); }
  let bestK = null, bestC = -1;
  for (const [k, c] of [...bins].sort((a, b) => a[0] - b[0])) if (c > bestC) { bestK = k; bestC = c; }
  const mo = (bestK * 50 + 25) / 1000.0, amo = (100.0 * bestC) / rr.length;
  const mxdmn = (Math.max(...rr) - Math.min(...rr)) / 1000.0;
  return mxdmn > 0 ? amo / (2 * mo * mxdmn) : null;
}

export function rhythm(rr, mean, rmssd) {
  const nrmssd = rmssd / mean;
  const sorted = rr.slice().sort((a, b) => a - b);
  const trimmed = rr.length > 24 ? sorted.slice(8, -8) : sorted;
  const lo = trimmed[0], hi = trimmed[trimmed.length - 1];
  const counts = new Array(16).fill(0);
  for (const v of trimmed) counts[hi > lo ? Math.min(15, Math.floor(((v - lo) / (hi - lo)) * 16)) : 0] += 1;
  let shannon = 0;
  for (const c of counts) if (c) shannon += (c / trimmed.length) * Math.log(c / trimmed.length) / Math.log(16);
  shannon = -shannon;
  let tp = 0;
  for (let i = 1; i + 1 < rr.length; i++) {
    const [a, b, c] = [rr[i - 1], rr[i], rr[i + 1]];
    if ((b > a && b > c) || (b < a && b < c)) tp++;
  }
  return { nrmssd, shannon, tpr: tp / (rr.length - 2), irregular: nrmssd > 0.1 && shannon > 0.7 };
}

export function hrv(rr) {
  const n = rr.length;
  if (n < 10) return null;
  const mean = rr.reduce((s, v) => s + v, 0) / n;
  const sdnn = Math.sqrt(rr.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (n - 1));
  const diffs = rr.slice(1).map((b, i) => b - rr[i]);
  const rmssd = Math.sqrt(diffs.reduce((s, d) => s + d * d, 0) / diffs.length);
  const pnn50 = (100.0 * diffs.filter((d) => Math.abs(d) > 50).length) / diffs.length;
  return { hr: 60000.0 / mean, rmssd, ln_rmssd: Math.log(rmssd), sdnn, pnn50, n,
    stress_index: baevsky(rr), ...rhythm(rr, mean, rmssd) };
}

/** Full spot-check result; skips the first `settle` seconds (electrode settling). */
export function ecgSummary(samples, fs = ECG_FS, settle = 5.0) {
  const x = samples.slice(Math.floor(settle * fs));
  const { peaks, bp } = ecgPeaks(x, fs);
  const q = peaks.length ? beatQuality(peaks, bp, fs) : new Map();
  const good = peaks.map((p) => (q.get(p) ?? 0.0) >= 0.8);
  const { rr, raw } = rrClean(peaks, fs, good);
  return { peaks, good, rr, quality: raw ? rr.length / raw : 0.0, hrv: hrv(rr) };
}
