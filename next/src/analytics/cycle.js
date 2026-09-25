// Menstrual-cycle temperature phases from nightly wrist temperature (opt-in, female profiles only).
// After ovulation, progesterone raises temperature ~0.3 °C for the luteal phase (Shilaih 2018: a sustained
// 3-day shift in 82% of cycles; early-luteal wrist temperature 0.33 °C above the fertile window).
// Coverline rule adapted from basal-temperature charting: a shift starts on the first of 3 consecutive
// nights all ≥ 0.2 °C above the mean of the preceding 6 nights. Retrospective only: it confirms that
// ovulation probably happened ~1 day before the shift; it can't predict it.
import { mean, sd } from "./baseline.js?v=20260925164715";

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

// ---------------------------------------------------------------------------------------------
// Cycle history, phase status, perimenopause staging, and logging prompts.
//
// Built on detectShifts/currentPhase above (both unchanged and still exported for any existing
// caller) plus ~/jcv8/research/lit_spo2_temp_illness.md §5:
//   - Shilaih 2018 (Biosci Rep, N=136/437 cycles): the 0.2-0.3 °C+ sustained wrist-temperature
//     shift used by detectShifts, and that it is retrospective — it confirms ovulation ~1-3 days
//     after the fact, it never predicts it in advance.
//   - Maijala 2019 (BMC Womens Health, Oura ring): menstruation-onset/ovulation detection from
//     nocturnal distal temperature is real but imperfect (71.9-86.5% / up to 83.3% sensitivity) —
//     grounds for treating every temperature-derived date here as an estimate, never a guarantee.
//   - Apple Women's Health Study 2025 (Hum Reprod, N=262/899 cycles, LH-confirmed): the same
//     wrist-temperature modality supports (a) a retrospective ovulation-day estimate and (b) a
//     next-menses prediction from a person's own cycle history — the two ideas behind ovulation{}
//     and nextPeriod{} below — but even that dedicated, larger study only gets next-menses within
//     ±3 days in 89.4% of cycles, so nextPeriod is shown as a [low, high] range, not a single date.
//   - Zhu 2021 (JMIR, N=57/193 cycles): wrist temperature detects ovulation more often than basal
//     body temperature (sensitivity 0.62 vs 0.23) but still misses roughly 4 in 10 cycles — another
//     reason ovulation/fertileWindow always carry confirmed/estimated flags instead of asserting a
//     single certain date.
//   - Shilaih 2017 (Sci Rep, N=91/274 cycles): nocturnal pulse rate rises ~+2.1 bpm in the fertile
//     window vs menses, with a further rise in the mid-luteal phase — used below as a small,
//     corroborating rhrLuteal signal (grade C standalone per the review; never used to *drive*
//     phase on its own).
//   - Hot flashes / vasomotor symptoms: §5.5 grades detection X on this hardware — the validated
//     signal is electrodermal activity (skin conductance), which this band does not measure, and
//     wrist-temperature-only detection is unvalidated (small proof-of-concept study, torso sensor,
//     not wrist). Nothing in this file attempts a hot-flash flag.
//
// Two rules below are standard clinical conventions that are NOT in lit_spo2_temp_illness.md, cited
// here individually and kept deliberately conservative per the task brief:
//   - Typical luteal-phase length ~12-14 days, comparatively fixed while the follicular phase varies
//     (Lenton EA, Landgren BM, Sexton L, "Normal variation in the length of the follicular phase of
//     the menstrual cycle: effect of chronological age," Br J Obstet Gynaecol 1984;91:685-9; Fehring
//     RJ, Schneider M, Barron ML, "Variability in the phases of the menstrual cycle," J Obstet Gynecol
//     Neonatal Nurs 2006;35:376-84, mean luteal length 12.4±2.0 days). We default to 14 days (the
//     traditional, longer end) until a person has ≥1 shift-confirmed cycle of their own, which always
//     overrides the default.
//   - STRAW+10 perimenopause staging (Harlow SD et al., "Executive summary of the Stages of
//     Reproductive Aging Workshop + 10," Climacteric/Menopause/Fertil Steril 2012): persistent ≥7-day
//     swings in consecutive cycle length flag the early transition; a ≥60-day gap between periods
//     flags the late transition; a ≥12-month (365-day) gap flags (possible) postmenopause. Applied
//     here only to gaps already present in the logged history (this module takes no `today` for
//     perimenopause(), so it cannot assess an still-ongoing gap) — descriptive only, every result is
//     framed as "talk to your clinician," never a diagnosis.
// ---------------------------------------------------------------------------------------------

const MS_DAY = 86400000;
const dateUTC = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const addDays = (d, n) => new Date(dateUTC(d) + n * MS_DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((dateUTC(b) - dateUTC(a)) / MS_DAY);

function sortPeriods(periods) {
  return (periods || [])
    .filter((p) => p && typeof p.start === "string")
    .map((p) => ({ start: p.start, end: p.end ?? null }))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

/**
 * cycles(periods) -> { cycles: [{start, end, length, periodDays}], stats }
 *   - length: days from this period's start to the next logged start ("cycle length"); null for
 *     the most recent (still-open, no next start yet) entry.
 *   - periodDays: days logged as bleeding (start..end inclusive); null until an end is logged.
 *   - stats: {meanLength, sdLength, minLength, maxLength, n} over every entry with a known length
 *     (baseline.js's mean/sd, so n<2 => sdLength is null, and n===0 => every stat is null).
 */
export function cycles(periods) {
  const list = sortPeriods(periods);
  const out = list.map((p, i) => {
    const next = list[i + 1];
    const length = next ? daysBetween(p.start, next.start) : null;
    const periodDays = p.end != null ? daysBetween(p.start, p.end) + 1 : null;
    return { start: p.start, end: p.end, length, periodDays };
  });
  const lens = out.map((c) => c.length).filter((x) => x != null);
  return {
    cycles: out,
    stats: {
      meanLength: mean(lens),
      sdLength: sd(lens),
      minLength: lens.length ? Math.min(...lens) : null,
      maxLength: lens.length ? Math.max(...lens) : null,
      n: lens.length,
    },
  };
}

/** Completed cycles as {start, endExclusive} windows (endExclusive === the next logged start). */
function completedCycles(periods, maxCycles = 6) {
  return cycles(periods)
    .cycles.filter((c) => c.length != null)
    .map((c) => ({ start: c.start, endExclusive: addDays(c.start, c.length) }))
    .slice(-maxCycles);
}

function nightsInRange(nights, start, endExclusive) {
  return (nights || [])
    .filter((x) => x && x.date != null && x.date >= start && (endExclusive == null || x.date < endExclusive))
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Last detected shift within [start, endExclusive), or null. Per Shilaih 2018/Maijala 2019, retrospective only. */
function shiftForWindow(nights, start, endExclusive) {
  const shifts = detectShifts(nightsInRange(nights, start, endExclusive));
  return shifts.length ? shifts[shifts.length - 1] : null;
}

const DEFAULT_LUTEAL_DAYS = 14; // Lenton 1984 / Fehring 2006 — see header comment; overridden by personalLuteal() below.

/** Shift-confirmed luteal lengths (ovulation date -> next period start) from up to the last N completed cycles. */
function personalLuteal(periods, nights, maxCycles = 6) {
  const out = [];
  for (const c of completedCycles(periods, maxCycles)) {
    const shift = shiftForWindow(nights, c.start, c.endExclusive);
    if (shift) out.push(daysBetween(addDays(shift.date, -1), c.endExclusive));
  }
  return out;
}

const MIN_RHR_NIGHTS = 5; // Our own conservative floor, not from Shilaih 2017 — its +2.1 bpm effect is small
// relative to ordinary night-to-night RHR noise, so a handful of nights per phase isn't enough to trust.

/** Pooled luteal-minus-follicular nightly RHR delta over shift-confirmed cycles (Shilaih 2017, corroborating only). */
function rhrLutealDelta(periods, nights, maxCycles = 6) {
  const foll = [], lut = [];
  let n = 0;
  for (const c of completedCycles(periods, maxCycles)) {
    const shift = shiftForWindow(nights, c.start, c.endExclusive);
    if (!shift) continue;
    const ov = addDays(shift.date, -1);
    const follRhr = nightsInRange(nights, c.start, addDays(ov, 1)).map((x) => x.rhr).filter((x) => x != null);
    const lutRhr = nightsInRange(nights, addDays(ov, 1), c.endExclusive).map((x) => x.rhr).filter((x) => x != null);
    if (follRhr.length || lutRhr.length) n++;
    foll.push(...follRhr);
    lut.push(...lutRhr);
  }
  if (foll.length < MIN_RHR_NIGHTS || lut.length < MIN_RHR_NIGHTS) return { delta: null, n };
  return { delta: mean(lut) - mean(foll), n };
}

function emptyCycleStatus(need) {
  return {
    cycleDay: null,
    phase: "unknown",
    phaseSource: null,
    ovulation: { date: null, confirmed: false, method: null },
    fertileWindow: null,
    nextPeriod: null,
    lateBy: null,
    tempShift: { detected: false, rise: null, since: null, dropping: false },
    rhrLuteal: { delta: null, n: 0 },
    need,
  };
}

/**
 * cycleStatus({periods, nights, today}) — today's cycle day, phase, and estimates.
 * phaseSource tells the UI how a phase was determined: "logged" (a period is actually logged as
 * open today), "temperature" (a detectShifts shift confirmed ovulation this cycle, Shilaih 2018),
 * or "calendar" (day-counted from personal cycle-length history / the fertile-window estimate).
 * ovulation/fertileWindow are always retrospective-or-estimated, never a prediction of the future
 * with certainty (Shilaih 2018, Maijala 2019, Zhu 2021 all describe real but incomplete detection).
 * nextPeriod needs >=2 completed cycles (Apple WHS 2025's own next-menses model is personal-history
 * based too); with fewer, it is null and `need` explains why.
 */
export function cycleStatus({ periods, nights, today } = {}) {
  const list = sortPeriods(periods);
  if (!list.length) return emptyCycleStatus(["Log at least one period start to begin cycle tracking."]);
  if (!today) return emptyCycleStatus(["A current date is required."]);

  let curIdx = -1;
  for (let i = 0; i < list.length; i++) {
    if (list[i].start <= today) curIdx = i;
    else break;
  }
  if (curIdx === -1) return emptyCycleStatus(["No logged period on or before today yet."]);

  const need = [];
  const cur = list[curIdx];
  const cycleStart = cur.start;
  const cycleDay = daysBetween(cycleStart, today) + 1;
  const onPeriod = cur.end != null ? today <= cur.end : true;

  const { stats } = cycles(periods);
  if (stats.n < 1) need.push("Log the start of a second period to estimate typical cycle length.");

  const nightsWin = nightsInRange(nights, cycleStart, addDays(today, 1));
  const shifts = detectShifts(nightsWin);
  const shift = shifts.length ? shifts[shifts.length - 1] : null;

  const lutealDays = personalLuteal(periods, nights);
  const lutealLength = lutealDays.length ? Math.round(mean(lutealDays)) : DEFAULT_LUTEAL_DAYS;

  let ovulation;
  if (shift) {
    ovulation = { date: addDays(shift.date, -1), confirmed: true, method: "temperature" };
  } else if (stats.meanLength != null) {
    const ovDay = Math.max(1, Math.round(stats.meanLength) - lutealLength);
    ovulation = { date: addDays(cycleStart, ovDay - 1), confirmed: false, method: "calendar" };
  } else {
    ovulation = { date: null, confirmed: false, method: null };
    need.push("Not enough temperature or cycle-length data yet to estimate ovulation.");
  }

  // ~6-day fertile window ending on the (confirmed or estimated) ovulation date. Always an
  // estimate, never contraception-grade — see Zhu 2021 / Maijala 2019 sensitivity figures above.
  const fertileWindow = ovulation.date ? { start: addDays(ovulation.date, -5), end: ovulation.date, estimated: true } : null;

  let nextPeriod = null;
  if (stats.n >= 2) {
    const spread = Math.max(1, Math.round(stats.sdLength || 0));
    const meanLen = Math.round(stats.meanLength);
    nextPeriod = { date: addDays(cycleStart, meanLen), low: addDays(cycleStart, meanLen - spread), high: addDays(cycleStart, meanLen + spread), method: "personal", n: stats.n };
  } else {
    need.push("Log at least 2 full cycles for a personalized next-period estimate.");
  }

  // "dropping" reuses currentPhase()'s own post-shift high/low classification: temperature back
  // down toward baseline after a confirmed luteal shift is one of cyclePrompt's two "did your
  // period start?" triggers.
  const dropping = shift ? currentPhase(nightsWin).phase === "lower" : false;
  const tempShift = { detected: !!shift, rise: shift ? shift.rise : null, since: shift ? shift.date : null, dropping };

  let phase, phaseSource, lateBy = null;
  if (onPeriod) {
    phase = "period"; phaseSource = "logged";
  } else if (nextPeriod && today > nextPeriod.high) {
    phase = "late"; phaseSource = "calendar"; lateBy = daysBetween(nextPeriod.date, today);
  } else if (ovulation.confirmed) {
    phase = "luteal"; phaseSource = "temperature";
  } else if (fertileWindow && today >= fertileWindow.start && today <= fertileWindow.end) {
    phase = "fertile"; phaseSource = "calendar";
  } else if (fertileWindow && today < fertileWindow.start) {
    phase = "follicular"; phaseSource = "calendar";
  } else if (fertileWindow && today > fertileWindow.end) {
    phase = "luteal"; phaseSource = "calendar";
  } else {
    phase = "unknown"; phaseSource = null;
  }

  const rhrLuteal = rhrLutealDelta(periods, nights);
  if (rhrLuteal.delta == null) need.push("Not enough nightly RHR data across confirmed cycles yet for a luteal-vs-follicular RHR comparison.");

  return { cycleDay, phase, phaseSource, ovulation, fertileWindow, nextPeriod, lateBy, tempShift, rhrLuteal, need };
}

/**
 * perimenopause({periods, profile}) — STRAW+10 (Harlow 2012) pattern check over logged cycle
 * lengths only (see header comment: no `today`, so this reads the log, not an ongoing gap).
 * Order checked most-severe first: a >=365-day logged gap outranks a >=60-day gap, which outranks
 * persistent (>=2 of the recent) >=7-day swings between consecutive cycle lengths.
 * profile.age is used only to add a caution, never to hide a pattern that's actually in the data.
 */
export function perimenopause({ periods, profile } = {}) {
  const list = sortPeriods(periods);
  const need = [];
  if (list.length < 2) return { stage: "insufficient data", reasons: [], need: ["Need at least two logged periods to assess cycle-length patterns."] };

  const lens = cycles(periods).cycles.map((c) => c.length).filter((x) => x != null);
  if (!lens.length) return { stage: "insufficient data", reasons: [], need: ["Need a completed cycle (two consecutive period starts) to assess cycle-length patterns."] };

  const reasons = [];
  let stage = "none";
  const gap365 = lens.filter((L) => L >= 365);
  const gap60 = lens.filter((L) => L >= 60);
  let flips = 0;
  for (let i = 1; i < lens.length; i++) if (Math.abs(lens[i] - lens[i - 1]) >= 7) flips++;

  if (gap365.length) {
    stage = "possible postmenopause";
    reasons.push(`A logged gap of ${Math.max(...gap365)} days between periods meets STRAW+10's ~12-month amenorrhea marker (Harlow 2012). Talk to your clinician.`);
  } else if (gap60.length) {
    stage = "late transition";
    reasons.push(`A logged gap of ${Math.max(...gap60)} days between periods meets STRAW+10's >=60-day marker for the late menopause transition (Harlow 2012). Talk to your clinician.`);
  } else if (flips >= 2) {
    stage = "early transition";
    reasons.push(`${flips} of the last ${lens.length - 1} consecutive cycle-length changes were >=7 days, STRAW+10's marker for the early menopause transition (Harlow 2012). Talk to your clinician.`);
  }

  if (stage !== "none" && profile && profile.age != null && profile.age < 40) {
    need.push("These patterns showed up in your logged cycles, but STRAW+10 (Harlow 2012) is intended for the perimenopausal age range — cycle changes below 40 have many other common causes. Still worth mentioning to a clinician.");
  }
  if (lens.length < 3) need.push("More logged cycles will make this pattern more reliable.");
  return { stage, reasons, need };
}

/**
 * cyclePrompt({periods, today, status}) — the two trigger-based nudges, no daily nagging otherwise.
 * "end": an open (unclosed) logged period that started >=4 days ago.
 * "start": only when no period is currently open, and either (a) the personal history predicts a
 * start within +/-2 days of today (status.nextPeriod, Apple WHS 2025-style personal estimate), or
 * (b) temperature has dropped back down after a confirmed luteal shift (status.tempShift.dropping).
 */
export function cyclePrompt({ periods, today, status } = {}) {
  const list = sortPeriods(periods);
  let open = null;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].end == null) { open = list[i]; break; }
  }
  if (open && today && open.start <= today && daysBetween(open.start, today) >= 3) {
    return { ask: "end", text: "Has your period ended?" };
  }

  if (status?.phase === "period") return { ask: null, text: null };
  const np = status?.nextPeriod;
  const windowHit = !!(np && np.date && today && Math.abs(daysBetween(np.date, today)) <= 2);
  const tempHit = !!(status?.tempShift?.detected && status?.tempShift?.dropping);
  if (windowHit || tempHit) return { ask: "start", text: "Did your period start?" };

  return { ask: null, text: null };
}
