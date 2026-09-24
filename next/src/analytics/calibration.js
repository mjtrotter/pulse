// Pairs reference-device readings (cuff, oximeter) with the band's nearest reading.
// The band's BP estimate arrives in its HRV history records; SpO2 in its SpO2 records.

const ms = (t) => Date.parse(t.replace(" ", "T"));

/** Nearest band record within `withinMin` minutes of t, or null. */
export function nearest(rows, t, withinMin = 15) {
  let best = null;
  for (const r of rows) {
    const d = Math.abs(ms(r.t) - ms(t));
    if (d <= withinMin * 60e3 && (!best || d < best.d)) best = { d, r };
  }
  return best?.r ?? null;
}

export function stats(diffs) {
  if (diffs.length < 2) return null;
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const sd = Math.sqrt(diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / (diffs.length - 1));
  return { n: diffs.length, mean, sd };
}

/** Band-minus-reference errors for every logged pair that has a nearby band reading. */
export function summarize(pairs, hrvRows, spo2Rows) {
  const sys = [], dia = [], spo2 = [];
  for (const p of pairs) {
    const bp = p.ref_sys ? nearest(hrvRows.filter((r) => r.bp_sys), p.t) : null;
    if (bp) { sys.push(bp.bp_sys - p.ref_sys); if (p.ref_dia) dia.push(bp.bp_dia - p.ref_dia); }
    const ox = p.ref_spo2 ? nearest(spo2Rows, p.t) : null;
    if (ox) spo2.push(ox.pct - p.ref_spo2);
  }
  return { sys: stats(sys), dia: stats(dia), spo2: stats(spo2), matched: { bp: sys.length, spo2: spo2.length } };
}
