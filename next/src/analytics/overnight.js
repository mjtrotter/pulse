// Overnight physiology inside the main sleep period: sleeping heart rate, resting HR and when it
// happened, band HRV estimates, SpO2 spot readings and wrist temperature.
import { median } from "./baseline.js?v=20260924233355";

const ms = (t) => Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10), +t.slice(11, 13), +t.slice(14, 16), +t.slice(17, 19));

/**
 * Sleeping heart rate from 5-s samples [[t, bpm]] between onset and wake.
 * - mean: time-weighted mean (each sample stands until the next, capped at 60 s)
 * - rhr: lowest 30-minute rolling mean (the resting HR definition used throughout), and its time
 * - nadir_frac: where the lowest 30 minutes sit in the night (0 = at sleep onset, 1 = at wake).
 *   An early nadir usually means a well-recovered night; a late one follows late meals, alcohol,
 *   illness or hard evening training.
 * - coverage: fraction of the night with HR readings.
 */
export function sleepingHR(samples, onset, wake) {
  const a = ms(onset), b = ms(wake);
  const pts = samples.map(([t, v]) => [ms(t), v]).filter(([t]) => t >= a && t < b).sort((x, y) => x[0] - y[0]);
  if (pts.length < 30) return null;
  let wsum = 0, wtot = 0;
  for (let i = 0; i < pts.length; i++) {
    const w = Math.min(60e3, (i + 1 < pts.length ? pts[i + 1][0] : pts[i][0] + 5e3) - pts[i][0]);
    wsum += pts[i][1] * w; wtot += w;
  }
  let best = null, j = 0, tot = 0;
  for (let i = 0; i < pts.length; i++) {
    while (j < pts.length && pts[j][0] < pts[i][0] + 30 * 60e3) { tot += pts[j][1]; j++; }
    const n = j - i;
    if (n >= 30 && pts[j - 1][0] - pts[i][0] >= 20 * 60e3) {
      const m = tot / n;
      if (!best || m < best.m - 1e-9) best = { m, t: pts[i][0] };
    }
    tot -= pts[i][1];
  }
  const min = Math.min(...pts.map(([, v]) => v));
  const hourly = [];
  for (let t = a; t < b; t += 3600e3) {
    const w = pts.filter(([x]) => x >= t && x < t + 3600e3).map(([, v]) => v);
    hourly.push(w.length ? w.reduce((s, x) => s + x, 0) / w.length : null);
  }
  return {
    mean: wsum / wtot, min, rhr: best ? Math.round(best.m * 10) / 10 : null,
    rhr_time: best ? new Date(best.t + 15 * 60e3).toISOString().slice(0, 19).replace("T", " ") : null,
    nadir_frac: best ? (best.t + 15 * 60e3 - a) / (b - a) : null,
    coverage: Math.min(1, wtot / (b - a)), hourly,
  };
}

/** Median of the band's own HRV estimates (ms) during sleep; also its hourly values for the chart. */
export function sleepingBandHRV(rows, onset, wake) {
  // The band computes this from the same pulse bursts as our own RMSSD (they agree within a few ms on clean
  // bursts, 2026-09-24); records with hr = 0 are ones the band itself couldn't measure, so they're skipped.
  const w = rows.filter((r) => r.t >= onset && r.t < wake && r.hrv_ms > 0 && r.hr > 0);
  if (w.length < 2) return null;
  return { median: median(w.map((r) => r.hrv_ms)), n: w.length, values: w.map((r) => [r.t, r.hrv_ms]),
    bp_sys: median(w.map((r) => r.bp_sys).filter((x) => x > 0)), bp_dia: median(w.map((r) => r.bp_dia).filter((x) => x > 0)) };
}

/**
 * Overnight SpO2 from spot readings (every 10-30 min on the V8). Spot readings can't give an
 * oxygen desaturation index or time below 90% (those need ≥ 1 Hz); what they support is the
 * median, the lowest reading and how many readings fell below 90% (trend only; wrist SpO2 is
 * about ±3-4% and reads worse on darker skin, Sjoding 2020).
 */
export function sleepingSpO2(rows, onset, wake) {
  const v = rows.filter((r) => r.t >= onset && r.t < wake && r.pct >= 70 && r.pct <= 100);
  if (!v.length) return null;
  const pcts = v.map((r) => r.pct);
  return { median: median(pcts), min: Math.min(...pcts), n: v.length, below90: pcts.filter((p) => p < 90).length,
    below94: pcts.filter((p) => p < 94).length, values: v.map((r) => [r.t, r.pct]) };
}

/** Median wrist temperature while asleep (skipping the first 30 min while the wrist warms up). */
export function sleepingTemp(rows, onset, wake) {
  const start = new Date(ms(onset) + 30 * 60e3).toISOString().slice(0, 19).replace("T", " ");
  const v = rows.filter((r) => r.t >= start && r.t < wake && r.c > 25 && r.c < 42).map((r) => r.c);
  if (v.length < 3) return null;
  return { median: median(v), min: Math.min(...v), max: Math.max(...v), n: v.length };
}
