// Personal baselines: every score compares a person with their own recent history
// (Shaffer & Ginsberg 2017; Plews 2013). Robust statistics so one odd night doesn't move the baseline.

export const median = (v) => {
  const a = v.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
export const mean = (v) => { const a = v.filter((x) => x != null && Number.isFinite(x)); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; };
export const sd = (v) => {
  const a = v.filter((x) => x != null && Number.isFinite(x));
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
/** Median absolute deviation scaled to SD units for normal data (×1.4826). */
export const madSd = (v) => {
  const m = median(v);
  if (m == null) return null;
  const d = median(v.filter((x) => x != null).map((x) => Math.abs(x - m)));
  return d == null ? null : 1.4826 * d;
};

/**
 * Baseline for one metric from prior values (oldest first, excluding today). Returns
 * {center, spread, n} using the median and a robust SD, floored at `minSpread` so a very stable
 * baseline can't make tiny changes look huge. null until `minN` values exist.
 */
export function baseline(values, { minN = 5, maxN = 28, minSpread = 0 } = {}) {
  const v = values.filter((x) => x != null && Number.isFinite(x)).slice(-maxN);
  if (v.length < minN) return null;
  const center = median(v);
  const spread = Math.max(minSpread, madSd(v) || sd(v) || 0);
  return { center, spread, n: v.length };
}

/** z-score against a baseline, or null. */
export const z = (x, b) => (x == null || !b || !b.spread ? null : (x - b.center) / b.spread);

export const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));

/** Rolling mean of the last `k` non-null values ending at each index. */
export function rolling(values, k = 7, minN = 3) {
  return values.map((_, i) => {
    const w = values.slice(Math.max(0, i - k + 1), i + 1).filter((x) => x != null);
    return w.length >= minN ? w.reduce((s, x) => s + x, 0) / w.length : null;
  });
}
