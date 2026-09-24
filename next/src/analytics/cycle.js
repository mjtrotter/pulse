// Menstrual-cycle temperature phases from nightly wrist temperature (opt-in, female profiles only).
// After ovulation, progesterone raises temperature ~0.3 °C for the luteal phase (Shilaih 2018: a sustained
// 3-day shift in 82% of cycles; early-luteal wrist temperature 0.33 °C above the fertile window).
// Coverline rule adapted from basal-temperature charting: a shift starts on the first of 3 consecutive
// nights all ≥ 0.2 °C above the mean of the preceding 6 nights. Retrospective only: it confirms that
// ovulation probably happened ~1 day before the shift; it can't predict it.

/** nights: [{date, temp}] oldest first (temp = nightly median °C, null when missing). */
export function detectShifts(nights, { rise = 0.2, before = 6, hold = 3 } = {}) {
  const v = nights.map((n) => n.temp);
  const shifts = [];
  for (let i = before; i + hold <= v.length; i++) {
    const prior = v.slice(i - before, i).filter((x) => x != null);
    if (prior.length < before - 1) continue;
    const base = prior.reduce((a, x) => a + x, 0) / prior.length;
    const next = v.slice(i, i + hold);
    if (next.every((x) => x != null && x >= base + rise)) {
      if (!shifts.length || i - shifts[shifts.length - 1].index >= 14) shifts.push({ index: i, date: nights[i].date, base, rise: next.reduce((a, x) => a + x, 0) / hold - base });
      i += hold;
    }
  }
  return shifts;
}

/** Current phase: "higher" since the last shift if temperature is still up, else "lower". */
export function currentPhase(nights) {
  const shifts = detectShifts(nights);
  const last = shifts[shifts.length - 1];
  if (!last) return { phase: "unknown", shifts };
  const since = nights.slice(last.index).map((n) => n.temp).filter((x) => x != null);
  const recent = since.slice(-2);
  const stillHigh = recent.length && recent.every((x) => x >= last.base + 0.1);
  return { phase: stillHigh ? "higher" : "lower", since: last.date, days: nights.length - last.index, base: last.base, rise: last.rise, shifts };
}
