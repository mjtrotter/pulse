// Change over time, stated carefully: a robust trend slope, "before vs after" a change the person logged (a new
// medication, a new routine), and which inputs moved a lab index between two draws. The language this supports
// is "changed after", never "caused by".
import { median, sd } from "./baseline.js?v=20260925173307";

const DAY = 864e5;
const dayNum = (date) => Math.round(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / DAY);

/** Theil–Sen line through [[x, y]]: the median of all pairwise slopes, so a few odd points barely move it
 *  (Sen 1968). Returns {slope, intercept, n} or null with fewer than 3 points. */
export function theilSen(points) {
  const P = (points ?? []).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (P.length < 3) return null;
  const slopes = [];
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) if (P[j][0] !== P[i][0]) slopes.push((P[j][1] - P[i][1]) / (P[j][0] - P[i][0]));
  if (!slopes.length) return null;
  const slope = median(slopes);
  return { slope, intercept: median(P.map(([x, y]) => y - slope * x)), n: P.length };
}

/** Theil–Sen slope of a dated series in units per year, plus the change from the first to the last value. */
export function trendPerYear(series) {
  const S = (series ?? []).filter((d) => d.value != null && Number.isFinite(d.value));
  const fit = theilSen(S.map((d) => [dayNum(d.date), d.value]));
  if (!fit) return null;
  const first = S[0], last = S[S.length - 1];
  return { perYear: fit.slope * 365.25, n: fit.n, spanDays: dayNum(last.date) - dayNum(first.date), change: last.value - first.value, pct: first.value ? (100 * (last.value - first.value)) / Math.abs(first.value) : null };
}

/**
 * Before vs after `eventDate` in a daily series [{date, value}] (nulls allowed, e.g. sick nights removed by the
 * caller). The shift is median(after) − median(before), also relative and in SDs of the before window. To judge
 * whether that shift is unusual for this person, the same comparison is repeated at every other date with enough
 * data on both sides ("placebo" dates, excluding any whose windows overlap the event's). `unusual` is the share of
 * placebo dates with a shift at least as large; it accounts for this person's own drift and noise, which a
 * textbook test on autocorrelated nightly data would not.
 */
export function beforeAfter(series, eventDate, { pre = 28, post = 28, minN = 7, gap = 0, minPlacebo = 20 } = {}) {
  const map = new Map();
  for (const d of series ?? []) if (d?.value != null && Number.isFinite(d.value)) map.set(dayNum(d.date), d.value);
  const window = (a, b) => { const v = []; for (let k = a; k <= b; k++) if (map.has(k)) v.push(map.get(k)); return v; };
  const shiftAt = (e) => {
    const B = window(e - pre, e - 1), A = window(e + gap, e + gap + post - 1);
    if (B.length < minN || A.length < minN) return null;
    const mb = median(B), ma = median(A);
    return { before: mb, after: ma, nBefore: B.length, nAfter: A.length, shift: ma - mb, sdBefore: sd(B) };
  };
  const e0 = dayNum(eventDate), r = shiftAt(e0);
  if (!r) {
    const nb = window(e0 - pre, e0 - 1).length, na = window(e0 + gap, e0 + gap + post - 1).length;
    return { ok: false, nBefore: nb, nAfter: na, need: `Needs ${minN} days on each side (${nb} before, ${na} after so far).` };
  }
  const keys = [...map.keys()], lo = Math.min(...keys), hi = Math.max(...keys), placebo = [];
  for (let e = lo + pre; e <= hi - post - gap + 1; e++) {
    if (Math.abs(e - e0) < pre + post + gap) continue;
    const z = shiftAt(e);
    if (z) placebo.push(Math.abs(z.shift));
  }
  const unusual = placebo.length >= minPlacebo ? placebo.filter((x) => x >= Math.abs(r.shift)).length / placebo.length : null;
  return { ok: true, ...r, relative: r.before ? (100 * r.shift) / Math.abs(r.before) : null, standardized: r.sdBefore ? r.shift / r.sdBefore : null, placebo: placebo.length, unusual };
}

/** Plain-language verdict for a beforeAfter result. */
export function verdict(r) {
  if (!r?.ok) return { label: "Not enough data yet", kind: "" };
  if (r.unusual == null) return { label: "Too little history to judge", kind: "" };
  if (r.unusual <= 0.05) return { label: "Clear change", kind: "strong" };
  if (r.unusual <= 0.2) return { label: "Possible change", kind: "some" };
  return { label: "Within your usual ups and downs", kind: "none" };
}

// ---------- which inputs moved a lab index ----------
/** Indices that are products of powers of their inputs, so the change in ln(index) splits exactly into each input's
 *  share: Δln I = Σ eᵢ·Δln xᵢ. `log: true` marks an index that is itself a log of such a product (TyG), where the
 *  index change splits the same way. */
export const POWER_FORMS = {
  fib4: { name: "FIB-4", exp: { age: 1, ast: 1, platelets: -1, alt: -0.5 } },
  homa_ir: { name: "HOMA-IR", exp: { glucose: 1, insulin: 1 } },
  apri: { name: "APRI", exp: { ast: 1, platelets: -1 } },
  tg_hdl: { name: "Triglyceride / HDL", exp: { tg: 1, hdl: -1 } },
  castelli1: { name: "TC / HDL", exp: { tc: 1, hdl: -1 } },
  castelli2: { name: "LDL / HDL", exp: { ldl: 1, hdl: -1 } },
  tyg: { name: "TyG index", exp: { tg: 1, glucose: 1 }, log: true },
};
/** Each input's share of the change in index `key` between two input sets (all inputs must be positive). Shares
 *  sum to 1; a negative share pulled the index the other way. Largest effect first. */
export function attributeChange(key, before, after) {
  const f = POWER_FORMS[key];
  if (!f) return null;
  const parts = [];
  for (const [k, e] of Object.entries(f.exp)) {
    const a = before?.[k], b = after?.[k];
    if (!(a > 0 && b > 0)) return null;
    parts.push({ input: k, effect: e * Math.log(b / a), pctChange: (100 * (b - a)) / a });
  }
  const total = parts.reduce((s, x) => s + x.effect, 0);
  if (Math.abs(total) < 1e-9) return { total: 0, parts: parts.map((x) => ({ ...x, share: 0 })) };
  return { total, parts: parts.map((x) => ({ ...x, share: x.effect / total })).sort((x, y) => Math.abs(y.effect) - Math.abs(x.effect)) };
}
