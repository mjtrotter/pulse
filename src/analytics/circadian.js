// Non-parametric circadian rhythm analysis (Van Someren et al. 1999) on hourly step counts:
//   IS  interdaily stability: how alike the days are (0-1; higher = steadier daily pattern)
//   IV  intradaily variability: how fragmented the day is (0-2; higher = more fragmented; resolution-dependent,
//       so it's only compared with your own history)
//   RA  relative amplitude: (M10 − L5) / (M10 + L5), where M10 = most active 10 h and L5 = least active 5 h of the
//       average day. Low RA was linked to depression, mood instability and poorer wellbeing in 91,000 UK Biobank
//       adults (Lyall 2018, Lancet Psychiatry).
// Input: days = [{hourly: [24 step counts], worn: [24 booleans]}], oldest first. Unworn hours are missing.

export function npcra(days, { minDays = 7 } = {}) {
  const x = []; // hourly series with nulls
  for (const d of days) for (let h = 0; h < 24; h++) x.push(d.worn?.[h] === false ? null : d.hourly?.[h] ?? null);
  const valid = x.filter((v) => v != null);
  const fullDays = days.filter((d) => (d.worn ?? []).filter(Boolean).length >= 16).length;
  if (fullDays < minDays || valid.length < 24 * minDays * 0.7) return null;
  const mean = valid.reduce((a, v) => a + v, 0) / valid.length;
  const total = valid.reduce((a, v) => a + (v - mean) ** 2, 0);
  if (total === 0) return null;
  // Average 24-h profile
  const prof = Array.from({ length: 24 }, (_, h) => {
    const vals = x.filter((v, i) => i % 24 === h && v != null);
    return vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : null;
  });
  if (prof.some((v) => v == null)) return null;
  const N = valid.length;
  const is = (N * prof.reduce((a, v) => a + (v - mean) ** 2, 0)) / (24 * total);
  let num = 0, pairs = 0;
  for (let i = 1; i < x.length; i++) if (x[i] != null && x[i - 1] != null) { num += (x[i] - x[i - 1]) ** 2; pairs++; }
  const iv = pairs ? (N * num) / ((pairs) * total) : null;
  const win = (len) => Array.from({ length: 24 }, (_, s) => { let a = 0; for (let k = 0; k < len; k++) a += prof[(s + k) % 24]; return { s, avg: a / len }; });
  const m10 = win(10).reduce((a, b) => (b.avg > a.avg ? b : a));
  const l5 = win(5).reduce((a, b) => (b.avg < a.avg ? b : a));
  const ra = m10.avg + l5.avg > 0 ? (m10.avg - l5.avg) / (m10.avg + l5.avg) : null;
  return { is, iv, ra, m10: m10.avg, m10_start: m10.s, l5: l5.avg, l5_start: l5.s, days: fullDays, profile: prof };
}
