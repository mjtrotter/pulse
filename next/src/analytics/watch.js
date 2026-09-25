// Longitudinal "watch" signals: a nightly CuSum change-point detector (secondary/confirmatory to the
// NightSignal already computed in scores.js), a multi-signal illness composite that combines it with
// NightSignal, temperature and sleep disruption, the sleep-onset wrist-temperature rise, an
// experimental cyclic-heart-rate (CVHR) apnea-pattern detector, and a STOP-Bang + objective-flags
// apnea-risk composite. Every threshold below is either quoted from the cited paper or explicitly
// flagged as our own engineering choice — never presented as validated when it isn't.
// Sources: ~/jcv8/research/lit_spo2_temp_illness.md (§2 STOP-Bang + composite, §3 temperature
// deviation, §4 NightSignal/CuSum/multi-signal composite, §6 sleep-onset temperature rise) and
// ~/jcv8/research/lit_sleep_circadian.md (§7.3 CVHR).
import { baseline, clamp, median } from "./baseline.js?v=20260924230628";

const toMs = (t) => Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10), +t.slice(11, 13), +t.slice(14, 16), +(t.slice(17, 19) || 0));
const fmt = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const round = (x, d = 2) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

/** Empirical percentile (linear interpolation between order statistics), or null if empty. */
function percentile(values, p) {
  const a = values.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const idx = clamp((p / 100) * (a.length - 1), 0, a.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (idx - lo);
}

/**
 * CuSum change-point detector on nightly resting heart rate — the secondary/confirmatory detector to
 * NightSignal (Mishra T et al., "Pre-symptomatic detection of COVID-19 from smartwatch data," Nat
 * Biomed Eng 2020;4:1208-1220; lit_spo2_temp_illness.md §4.2).
 *
 * The published algorithm is HOUR-STRATIFIED: for each hour of the day it builds a null distribution
 * of CuSum residuals from a 28-day baseline, thresholds at half the 90th percentile (short-term,
 * "yellow") and half the 99th percentile (long-term, "red") of that hour's baseline distribution
 * (p<0.01), and clears the alarm if the statistic stops climbing within 24h or returns to zero within
 * 48h. We only have ONE resting-HR value per NIGHT, not per hour, so hour-stratification can't be
 * built from this data. This is the NIGHTLY VARIANT the task brief asks for: the same one-sided CuSum
 * shape and the same "half a percentile of the baseline's own residuals" threshold rule, applied to
 * the nightly RHR series against a trailing personal baseline, with "24h" read as "the next night" and
 * "48h" as "the night after that." This is an adaptation, not the published algorithm — treat the
 * exact persistence/reset timing as approximate, and treat the whole function as the paper's own
 * grade (B, "fully specified, peer-reviewed... best used as corroboration") only for the *shape* of
 * the method, not for these exact nightly numbers.
 *
 * - Baseline: trailing up to `maxBaseline` (28, the paper's own window) nights' median + robust SD,
 *   from `baseline.js` (the same robust-baseline convention scores.js already uses).
 * - Slack `k = 0.5 × baseline SD`: the standard one-sided-CuSum "half the shift you want to detect
 *   quickly" allowance (Page 1954; Montgomery, *Introduction to Statistical Quality Control*) — the
 *   paper doesn't give a nightly `k`, so this is our own ordinary default, not a cited number.
 * - Threshold = half the 99th percentile of the baseline nights' own residuals (the paper's own
 *   "long-term" bar, reused here as the single alarm bar rather than a separate yellow/red pair).
 * - Alarm requires the statistic to stay above threshold for `persistNights` (2) consecutive nights —
 *   the nightly analogue of "stays elevated over the following 24h."
 * - Reset is inherent in the `max(0, …)` recursion: the statistic, and any alarm, fully clears once it
 *   returns to exactly 0 — the nightly analogue of the paper's "returns to zero" clearing rule.
 *
 * @param {Array} summaries per-day summaries (need `.date` and `.night.hr.rhr`); order-independent.
 * @param {{minN?:number, maxBaseline?:number, persistNights?:number}} [opts]
 * @returns {{alarm:boolean, series:Array<{date:string,s:number|null}>, startedOn:string|null, n:number, need?:number}}
 */
export function cusumRHR(summaries, opts = {}) {
  const { minN = 28, maxBaseline = 28, persistNights = 2 } = opts;
  const rows = [...(summaries ?? [])].filter((s) => s?.night?.hr?.rhr != null).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (rows.length < minN + 1) return { alarm: false, series: [], startedOn: null, n: rows.length, need: minN + 1 };

  const series = [];
  let s = 0, aboveStreak = 0, pendingSince = null, alarm = false, startedOn = null;
  for (let i = 0; i < rows.length; i++) {
    const priorVals = rows.slice(Math.max(0, i - maxBaseline), i).map((r) => r.night.hr.rhr);
    const b = baseline(priorVals, { minN, maxN: maxBaseline, minSpread: 1 });
    if (!b) { series.push({ date: rows[i].date, s: null }); continue; }
    const pool = priorVals.map((v) => v - b.center);
    const thresh = 0.5 * (percentile(pool, 99) ?? 0);
    const k = 0.5 * b.spread;
    const r = rows[i].night.hr.rhr - b.center;
    s = Math.max(0, s + r - k);
    series.push({ date: rows[i].date, s: round(s) });

    if (thresh > 0 && s > thresh) {
      aboveStreak++;
      if (aboveStreak === 1) pendingSince = rows[i].date;
    } else {
      aboveStreak = 0;
      pendingSince = null;
    }
    if (aboveStreak >= persistNights) { alarm = true; startedOn = startedOn ?? pendingSince; }
    if (s === 0) { alarm = false; startedOn = null; } // full return to baseline clears the alarm
  }
  return { alarm, series, startedOn: alarm ? startedOn : null, n: rows.length };
}

/**
 * Multi-signal illness composite (lit_spo2_temp_illness.md §4.3: combine RHR with temperature, sleep
 * and breathing rather than alerting on RHR alone — Natarajan 2020, Quer 2021). This REUSES the
 * NightSignal output scores.js's `illnessSignal()` already computed for the night (`s.scores.illness`)
 * rather than recomputing it: that function already requires temperature, sleep-disruption or
 * breathing-rate corroboration before it reports anything other than "none" (Alavi 2022, §4.1), so a
 * non-"none" `illness.level` here is already a single, internally-corroborated detector. This function
 * adds the CuSum secondary detector (§4.2) as the cross-check, folding both into one card rather than
 * two separate alerts (§4.2: "don't surface CuSum's own yellow/red separately... fold into one
 * combined alert card"):
 * - "alert": NightSignal (already corroborated) AND CuSum both agree — §4.2's own "2 of 2 detectors
 *   agree" framing.
 * - "watch": exactly one of {NightSignal, CuSum} fired, or NightSignal's uncorroborated "raw" RHR blip
 *   fired alone (worth watching, never alerted on per §4.3's "never alert on RHR alone").
 * - "none": neither detector saw anything.
 * `signals.tempDev` and `signals.sleepDisruption` are read straight off `illness` (which already
 * computed them); `signals.breathingDelta` is recomputed here with the same 1.5-breaths/min-above-
 * baseline convention scores.js's illnessSignal uses internally (Natarajan 2020's respiration-rate
 * finding), since illnessSignal keeps that value private rather than exporting it.
 * Evaluates the LAST (most recent, by date) entry of `summaries`; the rest is history/baseline.
 */
export function illnessWatch(summaries) {
  const rows = [...(summaries ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!rows.length) return { level: "none", reasons: [], signals: {}, evidence: [], n: 0, need: 1 };
  const today = rows[rows.length - 1];
  const prior = rows.slice(0, -1);
  const illness = today.scores?.illness ?? null;

  const cusum = cusumRHR(rows);
  const cusumFired = cusum.alarm;

  const tempDev = illness?.tempDev != null ? { value: round(illness.tempDev, 1), elevated: illness.tempDev >= 0.3 } : null;

  const rBase = baseline(prior.map((p) => p.night?.resp?.rate), { minN: 7, maxN: 28 });
  const rate = today.night?.resp?.rate ?? null;
  const breathingDelta = rate != null && rBase
    ? { value: round(rate - rBase.center, 1), elevated: rate - rBase.center >= 1.5 }
    : null;

  const sleepDisruption = { disrupted: !!illness?.disrupted };

  const nightSignalOn = !!illness && illness.level !== "none";
  const rawOnly = !!illness && !nightSignalOn && illness.raw && illness.raw !== "none";

  let level = "none";
  if (nightSignalOn && cusumFired) level = "alert";
  else if (nightSignalOn || cusumFired || rawOnly) level = "watch";

  const reasons = [];
  if (nightSignalOn) reasons.push(illness.text || "Overnight heart rate has been running above your usual.");
  else if (rawOnly) reasons.push("Overnight heart rate ran above your usual, but nothing else corroborates it yet.");
  if (cusumFired) reasons.push("A slower, trend-based check (CuSum) also flagged a sustained rise in your overnight resting heart rate.");
  if (tempDev?.elevated) reasons.push(`Skin temperature ${tempDev.value.toFixed(1)} °C above your usual.`);
  if (breathingDelta?.elevated) reasons.push(`Breathing rate ${breathingDelta.value.toFixed(1)} breaths/min above your usual.`);
  if (sleepDisruption.disrupted) reasons.push("Sleep was more disrupted than usual.");
  if (!reasons.length) reasons.push("Nothing corroborated right now.");

  const evidence = [
    { key: "nightSignal", label: "Overnight resting heart rate (NightSignal)", value: illness?.delta ?? null, note: illness?.text ?? "Not enough nights yet." },
    { key: "cusum", label: "CuSum change-point", value: cusum.series.at(-1)?.s ?? null, note: cusumFired ? `Sustained rise since ${cusum.startedOn}` : "No sustained change" },
    { key: "temp", label: "Skin temperature vs usual", value: tempDev?.value ?? null, note: tempDev ? (tempDev.elevated ? "Elevated" : "Within usual range") : "Not enough nights yet." },
    { key: "breathing", label: "Breathing rate vs usual", value: breathingDelta?.value ?? null, note: breathingDelta ? (breathingDelta.elevated ? "Elevated" : "Within usual range") : "Not enough nights yet." },
    { key: "sleep", label: "Sleep disruption", value: null, note: sleepDisruption.disrupted ? "More disrupted than usual" : "Typical" },
  ];

  return { level, reasons, signals: { nightSignal: illness, cusum, tempDev, breathingDelta, sleepDisruption }, evidence, n: rows.length };
}

/**
 * Sleep-onset wrist-temperature rise (distal vasodilation ahead of sleep onset: Kräuchi K et al.,
 * "Warm feet promote the rapid onset of sleep." Nature 1999;401:36-37 — warmer distal skin predicts
 * faster sleep onset; Sarabia JA et al., Physiol Behav 2008;95:570-580 — wrist temperature rises
 * roughly 60 min before core temperature starts falling toward sleep). Neither paper publishes a
 * numeric wrist-temperature threshold — lit_spo2_temp_illness.md §6 is explicit: "doesn't need the
 * Kräuchi/Sarabia numeric parameters to be correct, just their qualitative pattern" — so every
 * threshold below is our own descriptive choice, not a cited number. EXPERIMENTAL.
 * - `baseline`: median temperature between `baselineStartH` and `baselineEndH` hours before onset (a
 *   settled evening reading, taken before the pre-sleep rise typically begins).
 * - `rise`: the peak temperature within [onset−searchBeforeH, onset+searchAfterH] minus `baseline`.
 * - `riseAt`: the first time in that window the reading exceeds `baseline+margin` and stays there for
 *   `sustainMin` minutes (a sustained rise, not a single warm reading).
 * @param {Array<{t:string,c:number}>} tempRows 10-min wrist temperature readings.
 * @param {string} onset sleep onset "YYYY-MM-DD hh:mm:ss".
 * @param {string} wake wake time (unused for the window math but accepted for a consistent signature).
 */
export function tempOnsetRise(tempRows, onset, wake, opts = {}) {
  const { baselineStartH = 3, baselineEndH = 1.5, searchBeforeH = 2, searchAfterH = 1, margin = 0.2, sustainMin = 20 } = opts;
  if (!onset) return { rise: null, riseAt: null, baseline: null, n: 0, need: 1, experimental: true };
  const a = toMs(onset);
  const rows = (tempRows ?? []).filter((r) => r.c > 25 && r.c < 42).map((r) => [toMs(r.t), r.c]).sort((x, y) => x[0] - y[0]);
  const baseWin = rows.filter(([t]) => t >= a - baselineStartH * 3600e3 && t < a - baselineEndH * 3600e3);
  const searchWin = rows.filter(([t]) => t >= a - searchBeforeH * 3600e3 && t <= a + searchAfterH * 3600e3);
  if (baseWin.length < 2 || searchWin.length < 3) return { rise: null, riseAt: null, baseline: null, n: rows.length, need: 5, experimental: true };
  const base = median(baseWin.map(([, c]) => c));
  const need = Math.max(1, Math.round(sustainMin / 10)); // ~10-min cadence per the V8 spec
  let riseAt = null;
  for (let i = 0; i < searchWin.length; i++) {
    const w = searchWin.slice(i, i + need);
    if (w.length === need && w.every(([, c]) => c >= base + margin)) { riseAt = fmt(searchWin[i][0]); break; }
  }
  const peak = Math.max(...searchWin.map(([, c]) => c));
  return { rise: round(peak - base, 2), riseAt, baseline: round(base, 2), n: rows.length, experimental: true };
}

/**
 * EXPERIMENTAL cyclic-variation-of-heart-rate (CVHR) apnea-pattern detector, from raw ~5s HR samples
 * during sleep. CVHR is the bradycardia-during-apnea → abrupt-tachycardia-on-resumption cycle
 * (Guilleminault C et al., "Cyclical variation of the heart rate in sleep apnoea syndrome." Lancet
 * 1984;1:126-131 — N=400, the classic description from continuous ECG, absent in controls) at roughly
 * 20-90 s per cycle / ~0.011-0.05 Hz (Hayano J et al., "Screening for obstructive sleep apnea by
 * cyclic variation of heart rate." Circ Arrhythm Electrophysiol 2011;4:64-72 — their ACAT algorithm on
 * single-lead ECG scored AUC 0.913 for AHI≥15/h, validated in older subjects and cardiac dysfunction).
 *
 * Both source papers used continuous/beat-to-beat ECG, not ~5s-averaged wrist PPG. lit_sleep_
 * circadian.md §7.3's own Nyquist check says 5.5 s sampling is *in principle* fast enough (4-16
 * samples/cycle for a 20-90s cycle) but flags three unvalidated risks specific to this hardware: the
 * "5-s HR" value is very likely already a smoothed vendor output (blunting the sharp transition), PPG
 * quality degrades during the very arousals/movements CVHR looks for, and no published study has run
 * CVHR detection on averaged (rather than beat-to-beat) wrist-PPG HR at all — "Grade: C, and only
 * after we've actually looked at real overnight HR traces … to confirm the pattern is even visually
 * present at this sampling rate before shipping even the qualitative flag." This function is that
 * first-look detector: always experimental, never an AHI estimate or diagnosis.
 *
 * Detector (ours; not published anywhere — every step below is an explicit engineering choice):
 * 1. Restrict samples to `onset`..`wake`; if `stagesPerMinute` (`[[t, code]]`, code 1/2/3 = asleep,
 *    the same convention sleep.js's stage rows already use) is given, further restrict to asleep
 *    minutes only, since CVHR is a sleep phenomenon. Without stage data we fall back to the whole
 *    onset-wake window, which will over-count ordinary HR swings around spontaneous brief wake.
 * 2. No upsampling/interpolation: native ~5 s samples are used as-is. A gap of more than `MAX_GAP_S`
 *    (30 s) between consecutive samples ends the current run rather than being bridged — a longer gap
 *    likely means the band lost skin contact, and interpolating across it would fabricate a cycle.
 * 3. Detrend: subtract a centred rolling mean (±90 s, the upper edge of the cited cycle band) from
 *    each sample so oscillations inside the 20-90 s band stand out against slower overnight drift.
 * 4. Candidate troughs: local minima of the detrended residual (strictly lower than the previous
 *    sample, no higher than the next), de-duplicated to at most one every `MIN_PERIOD_S`/2.
 * 5. For each candidate trough, search forward up to `MAX_PERIOD_S` (90 s) for the highest subsequent
 *    RAW HR value (the "abrupt tachycardia on resumption"); `rise` = that peak minus the trough's own
 *    HR. A candidate only becomes an event if `rise >= MIN_RISE_BPM` AND it has a neighbouring
 *    qualifying candidate `MIN_PERIOD_S`-`MAX_PERIOD_S` s away — a single isolated dip isn't "cyclic";
 *    CVHR is defined by the repeating pattern (Guilleminault 1984).
 * 6. `MIN_RISE_BPM` (6 bpm) is an ARBITRARY choice — neither cited paper publishes a bpm amplitude
 *    cutoff (they work in ECG-derived instantaneous rate, not averaged bpm). It exists only to bound
 *    false positives from ordinary sample-to-sample PPG jitter; retune it against real traces from a
 *    snoring household member before trusting the count, per §7.3's own recommendation.
 * `index` = events per hour of actual HR-covered time (`hours`), not elapsed clock time.
 *
 * @param {Array<{t:string,bpm:number}>} hrRows ~5s heart-rate samples.
 * @param {string} onset @param {string} wake
 * @param {Array<[string,number]>} [stagesPerMinute] optional per-minute stage rows, sleep.js format.
 */
export function cvhr(hrRows, onset, wake, stagesPerMinute = null) {
  const MIN_PERIOD_S = 20, MAX_PERIOD_S = 90, MIN_RISE_BPM = 6, MAX_GAP_S = 30;
  if (!onset || !wake) return { index: null, events: [], hours: 0, n: 0, need: 1, experimental: true };
  const a = toMs(onset), b = toMs(wake);
  let asleepMin = null;
  if (stagesPerMinute && stagesPerMinute.length) {
    asleepMin = new Set();
    for (const [t, code] of stagesPerMinute) if (code >= 1 && code <= 3) asleepMin.add(t.slice(0, 16));
  }
  const pts = (hrRows ?? [])
    .filter((r) => r.bpm > 25 && r.bpm < 220 && r.t >= onset && r.t < wake && (!asleepMin || asleepMin.has(r.t.slice(0, 16))))
    .map((r) => [toMs(r.t), r.bpm])
    .filter(([t]) => t >= a && t < b)
    .sort((x, y) => x[0] - y[0]);
  if (pts.length < 120) return { index: null, events: [], hours: 0, n: pts.length, need: 120, experimental: true };

  // Coverage hours: each sample counts for the gap to the next one, capped at 10s (twice the native
  // ~5s cadence) — the same "cap a sample's width" convention overnight.js's sleepingHR() uses.
  let coveredMs = 0;
  for (let i = 0; i < pts.length; i++) coveredMs += Math.min(10e3, i + 1 < pts.length ? pts[i + 1][0] - pts[i][0] : 5e3);
  const hours = coveredMs / 3600e3;

  // Centred rolling mean over a ±90s time window (two-pointer; spacing isn't perfectly uniform).
  const half = 90e3;
  const resid = new Array(pts.length);
  let lo = 0, hi = 0, sum = 0, cnt = 0;
  for (let i = 0; i < pts.length; i++) {
    while (hi < pts.length && pts[hi][0] <= pts[i][0] + half) { sum += pts[hi][1]; cnt++; hi++; }
    while (lo < i && pts[i][0] - pts[lo][0] > half) { sum -= pts[lo][1]; cnt--; lo++; }
    resid[i] = pts[i][1] - sum / cnt;
  }

  const candidates = [];
  let lastCandidateT = -Infinity;
  for (let i = 1; i < pts.length - 1; i++) {
    if (pts[i][0] - pts[i - 1][0] > MAX_GAP_S * 1000 || pts[i + 1][0] - pts[i][0] > MAX_GAP_S * 1000) continue;
    if (!(resid[i] < resid[i - 1] && resid[i] <= resid[i + 1])) continue;
    if (pts[i][0] - lastCandidateT < (MIN_PERIOD_S / 2) * 1000) continue;
    lastCandidateT = pts[i][0];
    let peak = pts[i][1];
    for (let j = i + 1; j < pts.length && pts[j][0] - pts[i][0] <= MAX_PERIOD_S * 1000; j++) {
      if (pts[j][0] - pts[j - 1][0] > MAX_GAP_S * 1000) break;
      if (pts[j][1] > peak) peak = pts[j][1];
    }
    const rise = peak - pts[i][1];
    if (rise >= MIN_RISE_BPM) candidates.push({ t: pts[i][0], rise });
  }
  const isCyclic = candidates.map((c, i) => {
    const prevOk = i > 0 && withinPeriod(c.t - candidates[i - 1].t);
    const nextOk = i < candidates.length - 1 && withinPeriod(candidates[i + 1].t - c.t);
    return prevOk || nextOk;
  });
  function withinPeriod(deltaMs) {
    const s = deltaMs / 1000;
    return s >= MIN_PERIOD_S && s <= MAX_PERIOD_S;
  }
  const events = candidates.filter((_, i) => isCyclic[i]).map((c) => ({ t: fmt(c.t), rise: round(c.rise, 1) }));

  const index = hours > 0 ? round(events.length / hours, 2) : null;
  return { index, events, hours: round(hours, 2), n: pts.length, experimental: true };
}

/** Human labels for the STOP-Bang items, in the order Chung et al. present them. */
const STOPBANG_LABELS = {
  snore: "snoring loudly", tired: "daytime tiredness", observed: "observed apnea", pressure: "treated high blood pressure",
  neck: "neck circumference over 40cm", bmi35: "BMI over 35", age50: "age over 50", male: "male",
};

/**
 * STOP-Bang score (Chung F et al., "STOP questionnaire: a tool to screen patients for obstructive
 * sleep apnea." Anesthesiology 2008;108:812-821; Chung F et al., "High STOP-Bang score indicates a
 * high probability of obstructive sleep apnoea." Br J Anaesth 2012;108:768-775 — bands and odds
 * ratios; Nagappa M et al., meta-analysis, PLoS ONE 2015;10:e0143697, N=9,206 — sensitivity 90-96% at
 * score≥3 in sleep-clinic populations) plus the review's own §2.2 "novel composite": STOP-Bang first
 * (the only piece with real sensitivity/specificity numbers), objective band signals shown only as a
 * supporting "+objective flags" annotation — §2.2 is explicit that no published instrument fuses these
 * into one probability, and neither do we.
 *
 * - STOP-Bang items (1 point each, 0-8): snore/tired/observed-apnea/pressure/neck from
 *   `profile.stopbang`; BMI>35 (computed from height in cm + weight in kg), age>50 and male sex from
 *   the rest of `profile`. Bands (Chung 2012): 0-2 low, 3-4 intermediate, 5-8 high.
 * - `objective.spo2Low`: any night in `recentSummaries` with an overnight minimum SpO2 below 94%
 *   (spot-sampled trend flag only, §1 — not a desaturation index). `objective.cvhr`: whether the
 *   already-experimental `cvhrIndex` (§7.3, see `cvhr()`) found any candidate cyclic events at all.
 *   Both need ≥7 nights of data first (§2.2's own stated minimum baseline) — null ("not enough nights
 *   yet") before that, not `false`.
 * - `objective.breathing` (nocturnal breathing rate vs personal baseline, same 1.5 breaths/min
 *   convention as scores.js's illnessSignal / illnessWatch above) is NOT part of the review's §2.2 OSA
 *   composite — that section names only SpO2 dips and CVHR. It's surfaced here purely as extra
 *   observational context and does not affect `level`/`text`.
 * - `level`/`text` are the STOP-Bang band itself, annotated with which objective flags (if any) were
 *   seen — exactly §2.2's composite rule, no fused numeric score. `experimental: true` because that
 *   annotated-composite wrapper is a novel, unvalidated combination, even though the STOP-Bang score
 *   inside it is well-validated (grade A/B per the review).
 *
 * @param {{age?:number, sex?:string, height?:number, weight?:number, stopbang?:object}} profile
 * @param {Array} recentSummaries recent per-day summaries (need `.night.spo2`/`.night.resp`).
 * @param {number|null} cvhrIndex the `index` field from `cvhr()`.
 */
export function apneaRisk(profile, recentSummaries, cvhrIndex) {
  if (!profile?.stopbang) return { stopBang: null, objective: null, level: null, text: null, experimental: true, n: 0, need: 1 };
  const sb = profile.stopbang;
  const heightM = profile.height ? profile.height / 100 : null;
  const bmi = heightM && profile.weight ? profile.weight / (heightM * heightM) : null;
  const items = {
    snore: !!sb.snore, tired: !!sb.tired, observed: !!sb.observed, pressure: !!sb.pressure, neck: !!sb.neck,
    bmi35: bmi != null && bmi > 35, age50: profile.age != null && profile.age > 50, male: profile.sex === "male",
  };
  const score = Object.values(items).filter(Boolean).length;
  const risk = score <= 2 ? "low" : score <= 4 ? "intermediate" : "high";
  const drivers = Object.entries(items).filter(([, v]) => v).map(([k]) => STOPBANG_LABELS[k]);

  const rows = (recentSummaries ?? []).filter((s) => s?.night);
  const enough = rows.length >= 7;
  const spo2Low = enough ? rows.some((s) => s.night?.spo2?.min != null && s.night.spo2.min < 94) : null;
  const cvhrFlag = enough ? cvhrIndex != null && cvhrIndex > 0 : null;
  const rBase = enough ? baseline(rows.map((s) => s.night?.resp?.rate), { minN: 5, maxN: 28 }) : null;
  const lastResp = rows.at(-1)?.night?.resp?.rate ?? null;
  const breathing = rBase && lastResp != null ? lastResp - rBase.center >= 1.5 : enough ? false : null;

  const objectiveSeen = !!(spo2Low || cvhrFlag);
  const flagBits = [spo2Low && "some nights with low overnight oxygen", cvhrFlag && "a repeating heart-rate pattern noticed overnight"].filter(Boolean);
  const objectiveText = !enough ? "Objective flags need at least 7 nights of data."
    : objectiveSeen ? `Objective flags: ${flagBits.join(" and ")}.` : "No objective flags seen yet.";
  const text = `You scored ${score}/8 on STOP-Bang${drivers.length ? ` — driven by ${drivers.join(", ")}` : ""} (${risk} risk). `
    + `${objectiveText} This is a screening signal, not a diagnosis; consider discussing it with a doctor.`;

  return {
    stopBang: { score, risk, items, drivers },
    objective: { spo2Low, cvhr: cvhrFlag, breathing, n: rows.length, need: 7 },
    level: risk, text, experimental: true,
  };
}
