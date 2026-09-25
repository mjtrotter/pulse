// Null-safe statistics and the "your own data" models behind the drill-downs: expected-from-sleep ranges,
// honest tag drivers (weighted for how nights were chosen for asking), and the triggers that decide when
// Pulse asks about a night.

const nums = (v) => v.filter((x) => x != null && Number.isFinite(x));
export const median = (v) => { const a = nums(v).sort((x, y) => x - y); if (!a.length) return null; const n = a.length >> 1; return a.length % 2 ? a[n] : (a[n - 1] + a[n]) / 2; };
export const mean = (v) => { const a = nums(v); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; };
export const sd = (v) => { const a = nums(v); if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

export const MIN_TAGGED = 8; // tagged nights before a tag's effect is shown
export const ASK_RATE = 0.25; // share of ordinary nights that get a one-tap check-in
export const MIN_USUAL = 5; // nights before "your usual" exists
export const MIN_MODEL = 20; // nights before the sleep → metric model is fitted

/** Your usual for a metric: median ± SD of up to 28 prior values (null until MIN_USUAL exist). */
export function usualRange(values, minN = MIN_USUAL) {
  const v = nums(values).slice(-28);
  if (v.length < minN) return null;
  const m = median(v), s = sd(v) ?? 0;
  return { lo: m - s, hi: m + s, center: m, sd: s, n: v.length };
}

/** (Weighted) least squares with standard errors. X rows include the intercept. Weights are inverse
 *  sampling probabilities, rescaled so the error variance uses the real number of nights. */
export function ols(X, y, w = null) {
  const n = X.length;
  if (!n) return null;
  const p = X[0].length, W = w ?? X.map(() => 1);
  if (n <= p) return null;
  const A = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => X.reduce((a, r, k) => a + W[k] * r[i] * r[j], 0)));
  const b = Array.from({ length: p }, (_, i) => X.reduce((a, r, k) => a + W[k] * r[i] * y[k], 0));
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
  const sw = W.reduce((a, v) => a + v, 0), s2 = (res.reduce((a, r, k) => a + W[k] * r * r, 0) / sw) * (n / Math.max(1, n - p));
  const scale = sw / n;
  return { beta, se: inv.map((r, i) => Math.sqrt(Math.max(0, s2 * r[i] * scale))), sigma: Math.sqrt(s2), n };
}

/** What a night's sleep predicts for a metric from your own prior (up to 120) nights, 80% range. */
export function expected(hist, get, sleepH) {
  if (sleepH == null) return null;
  const prior = hist.slice(-121, -1).filter((h) => !h.sick && h.sleepH != null && get(h) != null);
  if (prior.length < MIN_MODEL) return null;
  const fit = ols(prior.map((h) => [1, h.sleepH]), prior.map(get));
  if (!fit) return null;
  const c = fit.beta[0] + fit.beta[1] * sleepH, w = 1.2816 * fit.sigma;
  return { lo: c - w, hi: c + w, center: c, slope: fit.beta[1], slopeSe: fit.se[1], n: fit.n };
}

export const TAGS = [
  { key: "alcohol", label: "Alcohol" },
  { key: "caffeine", label: "Late caffeine" },
  { key: "stress", label: "Stress" },
  { key: "workout", label: "Late workout", auto: true }, // detected from heart rate, never asked
];

/**
 * Honest drivers. Continuous inputs use your last 120 nights. Asked tags use only the nights Pulse asked
 * about, weighted by how likely each was to be asked, and adjusted for sleep length. Detected tags use
 * every recorded night. A tag shows an effect only once it has MIN_TAGGED nights, and is called "clear"
 * only when its 95% interval excludes zero.
 */
export function drivers(hist, get, list) {
  const out = [];
  const ok = (h) => !h.sick && get(h) != null;
  const recent = hist.slice(-121, -1).filter((h) => ok(h) && h.sleepH != null);
  const asked = hist.filter((h) => h.asked && ok(h) && h.sleepH != null), seen = hist.filter((h) => h.hasNight && ok(h) && h.sleepH != null);
  for (const d of list) {
    if (d === "sleep" || d === "steps") {
      const rows = d === "sleep" ? recent : recent.filter((h) => h.stepsPrev != null);
      if (rows.length < MIN_MODEL) { out.push({ key: d, label: d === "sleep" ? "1 h less sleep" : "+1,000 steps the day before", n: rows.length, state: "needs", need: MIN_MODEL - rows.length, unit: "nights" }); continue; }
      const f = ols(rows.map((h) => [1, d === "sleep" ? h.sleepH : h.stepsPrev / 1000]), rows.map(get));
      if (!f) continue;
      const eff = d === "sleep" ? -f.beta[1] : f.beta[1];
      out.push({ key: d, label: d === "sleep" ? "1 h less sleep" : "+1,000 steps the day before", note: `${rows.length} ${d === "sleep" ? "nights" : "days"}`, effect: eff, ci: 1.96 * f.se[1], n: rows.length, state: Math.abs(f.beta[1]) > 1.96 * f.se[1] ? "clear" : "unclear" });
      continue;
    }
    const tag = TAGS.find((t) => t.key === d), rows = tag.auto ? seen : asked;
    const n = rows.filter((h) => h.t[d]).length;
    if (n < MIN_TAGGED || rows.length - n < 3) { out.push({ key: d, label: tag.label, n, state: "needs", need: Math.max(1, MIN_TAGGED - n), auto: tag.auto, unit: tag.auto ? "detected" : "tagged" }); continue; }
    const useSleep = list.includes("sleep");
    const f = ols(rows.map((h) => (useSleep ? [1, h.sleepH, h.t[d] ? 1 : 0] : [1, h.t[d] ? 1 : 0])), rows.map(get), tag.auto ? null : rows.map((h) => h.w ?? 1));
    if (!f) continue;
    const k = useSleep ? 2 : 1;
    out.push({ key: d, label: tag.label, note: `${n} ${tag.auto ? "detected" : "tagged"} nights`, effect: f.beta[k], ci: 1.96 * f.se[k], n, state: Math.abs(f.beta[k]) > 1.96 * f.se[k] ? "clear" : "unclear", auto: tag.auto });
  }
  const rank = { clear: 0, unclear: 1, needs: 2 };
  return out.sort((a, b) => rank[a.state] - rank[b.state] || Math.abs(b.effect ?? 0) - Math.abs(a.effect ?? 0));
}

/** Why Pulse would ask about night i (each against your own prior nights). */
export function triggers(hist, i) {
  const h = hist[i];
  if (!h?.hasNight) return [];
  const prior = hist.slice(Math.max(0, i - 28), i).filter((p) => !p.sick && p.hasNight);
  const u = (k, minN = MIN_USUAL) => usualRange(prior.map((p) => p[k]), minN);
  const out = [];
  const e = expected(hist.slice(0, i + 1), (z) => z.hrv, h.sleepH);
  const uh = u("hrv");
  if (h.hrv != null && e && h.hrv < e.lo) out.push({ k: "hrv", txt: `HRV was lower than your sleep predicts (${h.hrv.toFixed(0)} ms vs ${e.lo.toFixed(0)}–${e.hi.toFixed(0)})` });
  else if (h.hrv != null && !e && uh && h.hrv < uh.center - 1.5 * Math.max(uh.sd, 2)) out.push({ k: "hrv", txt: `HRV was well below your usual (${h.hrv.toFixed(0)} ms vs about ${uh.center.toFixed(0)})` });
  const ur = u("rhr", 7);
  if (h.rhr != null && ur && h.rhr >= ur.center + 3) out.push({ k: "rhr", txt: `resting heart rate ran ${(h.rhr - ur.center).toFixed(0)} bpm over your usual` });
  const ub = u("br");
  if (h.br != null && ub && h.br >= ub.center + 1.5) out.push({ k: "breath", txt: `breathing was ${(h.br - ub.center).toFixed(1)}/min faster than usual` });
  const prev = hist[i - 1];
  if (h.tdev != null && h.tdev >= 0.2 && prev?.tdev != null && prev.tdev >= 0.2) out.push({ k: "temp", txt: `skin temperature was above your usual two nights running` });
  if (h.illness?.level && h.illness.level !== "none" && !out.length) out.push({ k: "illness", txt: `overnight heart rate ran high, with other signs agreeing` });
  return out;
}

/** Deterministic per-date draw in [0, 1): the random 1-in-4 check-in, stable across reloads. */
export function dateDraw(date, salt = "pulse") {
  let x = 2166136261;
  for (const c of `${salt}:${date}`) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); }
  x ^= x >>> 13; x = Math.imul(x, 0x5bd1e995); x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}
