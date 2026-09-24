// Pulse-interval (PPI) bursts from the band's own optical sensor (history 0x63): ~80 s of consecutive
// pulse-to-pulse intervals per measurement (hourly by default, every 10 min when the band's HRV
// schedule is set to 10). Two uses, deliberately kept separate:
//  1. Overnight pulse-rate variability: RMSSD on artifact-corrected intervals, quality-gated.
//     At rest and asleep, PRV tracks ECG HRV closely (Schäfer & Vagedes 2013); RMSSD is valid from
//     ultra-short windows (Munoz 2015). It is labeled "overnight HRV" in the UI with this caveat.
//  2. An irregular-rhythm screen on the *uncorrected* intervals (artifact correction would erase
//     exactly the irregularity AF produces). Dash et al. 2009 criteria per burst; a night is flagged
//     only when most still-sleep bursts are irregular (cf. Apple's 5-of-6 tachogram rule).

const median = (v) => { const a = [...v].sort((x, y) => x - y); const m = a.length >> 1; return a.length ? (a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) : null; };
const quartileDev = (v) => {
  const a = [...v].sort((x, y) => x - y);
  if (a.length < 4) return 0;
  const q = (p) => a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))];
  return (q(0.75) - q(0.25)) / 2;
};

/** Joins the pages of each burst (same t) in page order; returns [{t, ppi}] sorted by t. */
export function assembleBursts(rows) {
  const by = new Map();
  for (const r of rows) {
    const e = by.get(r.t) ?? [];
    e.push(r);
    by.set(r.t, e);
  }
  return [...by].sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([t, pages]) => ({ t, ppi: pages.sort((a, b) => a.page - b.page).flatMap((p) => p.ppi) }));
}

/**
 * Artifact / ectopic detection after Lipponen & Tarvainen (2019), simplified for ~50-100 beat bursts:
 * a beat is flagged when its successive difference, or its deviation from the local median interval,
 * exceeds a threshold scaled by the burst's own spread (5.2 × quartile deviation, floored at 60 ms),
 * or when it lies outside 300-2000 ms. Flagged intervals are removed (not interpolated) before RMSSD,
 * and successive differences are only taken between two kept, adjacent intervals.
 */
export function cleanIntervals(ppi) {
  const n = ppi.length;
  const inRange = ppi.map((v) => v >= 300 && v <= 2000);
  const dRR = ppi.map((v, i) => (i ? v - ppi[i - 1] : 0));
  // Spread-scaled thresholds, clamped so a burst that is noisy throughout can't raise its own bar.
  const thDiff = Math.min(200, Math.max(60, 5.2 * quartileDev(dRR.slice(1).filter((_, i) => inRange[i] && inRange[i + 1]))));
  const med = ppi.map((_, i) => median(ppi.slice(Math.max(0, i - 5), i + 6).filter((v, k) => inRange[Math.max(0, i - 5) + k])));
  const mRR = ppi.map((v, i) => v - (med[i] ?? v));
  const thMed = Math.min(250, Math.max(60, 5.2 * quartileDev(mRR.filter((_, i) => inRange[i]))));
  const keep = ppi.map((v, i) => inRange[i] && Math.abs(mRR[i]) <= thMed && !(i > 0 && Math.abs(dRR[i]) > thDiff && Math.abs(mRR[i]) > thMed / 2));
  return { keep, flagged: keep.filter((k) => !k).length, n };
}

/** Time-domain PRV for one burst. null if fewer than 30 usable intervals or >20% flagged. */
export function burstHRV(ppi) {
  const { keep, flagged, n } = cleanIntervals(ppi);
  if (n < 30 || flagged / n > 0.2) return null;
  const kept = ppi.filter((_, i) => keep[i]);
  const diffs = [];
  for (let i = 1; i < n; i++) if (keep[i] && keep[i - 1]) diffs.push(ppi[i] - ppi[i - 1]);
  if (diffs.length < 20) return null;
  const mean = kept.reduce((s, x) => s + x, 0) / kept.length;
  const rmssd = Math.sqrt(diffs.reduce((s, d) => s + d * d, 0) / diffs.length);
  const sdnn = Math.sqrt(kept.reduce((s, x) => s + (x - mean) ** 2, 0) / (kept.length - 1));
  if (rmssd > 200 || rmssd / mean > 0.2) return null; // not resting sinus data: movement, or a rhythm the screen handles
  return { hr: 60000 / mean, mean_rr: mean, rmssd, ln_rmssd: Math.log(rmssd), sdnn, n: kept.length, flagged, artifact_pct: (100 * flagged) / n };
}

/**
 * Dash et al. 2009 irregularity measures on raw intervals (only the 300-2000 ms range filter):
 * normalized RMSSD, Shannon entropy of a 16-bin histogram after trimming the 8 longest and 8 shortest
 * intervals, and the turning-point ratio. irregular = nRMSSD > 0.1 AND Shannon > 0.8 (stricter than
 * the ECG screen's 0.7, since optical intervals carry more noise), with TPR inside the random-sequence band (0.54-0.77) as a third requirement
 * so a smooth breathing-driven swing isn't called irregular.
 */
export function irregularity(ppi) {
  const rr = ppi.filter((v) => v >= 300 && v <= 2000);
  if (rr.length < 40) return null;
  const mean = rr.reduce((s, x) => s + x, 0) / rr.length;
  const d = rr.slice(1).map((v, i) => v - rr[i]);
  const rmssd = Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length);
  const nrmssd = rmssd / mean;
  const trimmed = [...rr].sort((a, b) => a - b).slice(8, -8);
  const lo = trimmed[0], hi = trimmed[trimmed.length - 1];
  const counts = new Array(16).fill(0);
  for (const v of trimmed) counts[hi > lo ? Math.min(15, Math.floor(((v - lo) / (hi - lo)) * 16)) : 0]++;
  const shannon = -counts.filter((c) => c).reduce((s, c) => s + (c / trimmed.length) * (Math.log(c / trimmed.length) / Math.log(16)), 0);
  let tp = 0;
  for (let i = 1; i + 1 < rr.length; i++) if ((rr[i] > rr[i - 1] && rr[i] > rr[i + 1]) || (rr[i] < rr[i - 1] && rr[i] < rr[i + 1])) tp++;
  const tpr = tp / (rr.length - 2);
  return { nrmssd, shannon, tpr, irregular: nrmssd > 0.1 && shannon > 0.8 && tpr >= 0.54 && tpr <= 0.77, n: rr.length };
}

/**
 * Night summary from bursts inside [onset, wake): median RMSSD and mean lnRMSSD over usable bursts,
 * mean pulse rate, and the rhythm screen (needs ≥ 4 screenable bursts; flagged when ≥ 60% irregular
 * and at least 3 irregular). Returns null when no bursts fall in the window.
 */
export function nightPPI(rows, onset, wake) {
  const bursts = assembleBursts(rows.filter((r) => r.t >= onset && r.t < wake));
  if (!bursts.length) return null;
  const hrv = [], screen = [];
  for (const b of bursts) {
    const m = burstHRV(b.ppi);
    if (m) hrv.push({ t: b.t, ...m });
    const ir = irregularity(b.ppi);
    if (ir) screen.push({ t: b.t, ...ir });
  }
  const irregular = screen.filter((x) => x.irregular).length;
  return {
    bursts: bursts.length, usable: hrv.length,
    rmssd: hrv.length ? median(hrv.map((x) => x.rmssd)) : null,
    ln_rmssd: hrv.length ? hrv.reduce((s, x) => s + x.ln_rmssd, 0) / hrv.length : null,
    hr: hrv.length ? hrv.reduce((s, x) => s + x.hr, 0) / hrv.length : null,
    values: hrv.map((x) => [x.t, Math.round(x.rmssd * 10) / 10]),
    rhythm: { screened: screen.length, irregular, flagged: screen.length >= 4 && irregular >= 3 && irregular / screen.length >= 0.6 },
  };
}

/**
 * Breathing rate from one burst via respiratory sinus arrhythmia: the tachogram (interval vs time) is
 * resampled at 4 Hz, detrended, Hann-windowed, and the strongest frequency between 0.15 and 0.5 Hz
 * (9-30 breaths/min) is taken; a peak on the band's lower edge is rejected because the ~0.1 Hz
 * blood-pressure (Mayer) rhythm leaks in there, not breathing (Charlton 2016/2018: RR-interval modulation is among the best-performing
 * single features; fusion across windows improves it). Needs ≥ 45 s of clean intervals and a clear
 * peak (≥ 3× the median spectral power); returns {rate, clarity} or null.
 */
export function burstRespiration(ppi) {
  const { keep } = cleanIntervals(ppi);
  const t = [], v = [];
  let acc = 0;
  for (let i = 0; i < ppi.length; i++) {
    acc += ppi[i] / 1000;
    if (keep[i]) { t.push(acc); v.push(ppi[i]); }
  }
  if (v.length < 30 || t[t.length - 1] - t[0] < 45) return null;
  const fs = 4, x = [];
  for (let s = t[0], j = 0; s <= t[t.length - 1]; s += 1 / fs) {
    while (j + 1 < t.length && t[j + 1] < s) j++;
    const f = j + 1 < t.length ? (s - t[j]) / (t[j + 1] - t[j]) : 0;
    x.push(j + 1 < t.length ? v[j] + f * (v[j + 1] - v[j]) : v[j]);
  }
  const n = x.length, idx = x.map((_, i) => i);
  const mi = (n - 1) / 2, mx = x.reduce((a, b) => a + b, 0) / n;
  const sxx = idx.reduce((a, i) => a + (i - mi) ** 2, 0);
  const slope = idx.reduce((a, i) => a + (i - mi) * (x[i] - mx), 0) / sxx;
  const y = x.map((val, i) => (val - (mx + slope * (i - mi))) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))));
  const powers = [];
  let best = null;
  for (let f = 0.15; f <= 0.5 + 1e-9; f += 0.005) {
    let c = 0, sn = 0;
    for (let i = 0; i < n; i++) { const a = (2 * Math.PI * f * i) / fs; c += y[i] * Math.cos(a); sn += y[i] * Math.sin(a); }
    const p = c * c + sn * sn;
    powers.push(p);
    if (!best || p > best.p) best = { f, p };
  }
  const med = [...powers].sort((a, b) => a - b)[powers.length >> 1];
  const clarity = med > 0 ? best.p / med : 0;
  if (clarity < 3 || best.f < 0.16) return null;
  return { rate: best.f * 60, clarity };
}

/** Nightly breathing rate: median of the clear bursts inside [onset, wake); needs ≥ 3. */
export function nightRespiration(rows, onset, wake) {
  const bursts = assembleBursts(rows.filter((r) => r.t >= onset && r.t < wake));
  const est = bursts.map((b) => burstRespiration(b.ppi)).filter(Boolean);
  if (est.length < 3) return null;
  const rates = est.map((e) => e.rate).sort((a, b) => a - b);
  return { rate: rates[rates.length >> 1], n: est.length, of: bursts.length, iqr: [rates[Math.floor(rates.length / 4)], rates[Math.floor((3 * rates.length) / 4)]] };
}
