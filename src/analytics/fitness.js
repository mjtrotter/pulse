// Cardiovascular fitness & load analytics. Every formula here is cited to research/lit_cardio_fitness.md
// (§ numbers below refer to that file) and research/METRICS.md; nothing is shipped unless those files
// verify the paper and its coefficients. Where a coefficient could not be verified there — even one the
// task brief asked for — the model is left out and that is stated in the return value, not silently
// guessed. All functions are pure: same input, same output, no I/O.
//
// Omitted on purpose (see the final handoff report for the full reasoning):
//   - fitnessCategory(value, age, sex): the review verifies only two age-band 50th-percentile anchors
//     (Kaminsky 2015 FRIEND registry: 20-29y and 70-79y, by sex) plus a "~10%/decade" decline heuristic —
//     no percentile-band cutoffs (25th/75th/90th) are verified anywhere in lit_cardio_fitness.md, so any
//     "poor/fair/good/excellent" bucketing would invent thresholds the review doesn't supply. Not built.
//   - BMR (Mifflin-St Jeor 1990): not mentioned anywhere in lit_cardio_fitness.md or METRICS.md — no
//     formula, no coefficients, no citation to verify. energy() reports bmr: null rather than invent one.
//   - Steps-only calorie fallback: no verified steps→kcal coefficient exists in either file either.
import { median, clamp } from "./baseline.js?v=20260925173307";

// ---------------------------------------------------------------------------------------------
// §1 Non-exercise VO2max
// ---------------------------------------------------------------------------------------------

// Jackson AS, Blair SN, Mahar MT, Wier LT, Ross RM, Stuteville JE. "Prediction of functional aerobic
// capacity without exercise testing." Med Sci Sports Exerc. 1990;22(6):863-70. PMID 2287267.
const JACKSON_1990_BMI = { b0: 56.363, paR: 1.921, age: -0.381, bmi: -0.754, sexM: 10.987, see: 5.6 };

// The paper's PA-R predictor (0-7 self-reported activity rating) has no validated wearable substitute
// (lit_cardio_fitness.md §1: "has not been validated anywhere in the literature we found"). This proxy is
// OUR OWN construction, not the paper's: a straight line between the paper's stated endpoints — PA-R 0
// ("sedentary") and PA-R 7 (">10 mi/wk running or equivalent >3h/wk vigorous") — anchored to two verified
// step-cohort figures that sit at those same ends of the activity spectrum: Paluch et al. 2022's lowest
// quartile median (3,553 steps/day) and Saint-Maurice et al. 2020's top tier (≥12,000 steps/day, the
// lowest-mortality band in that cohort). This is NOT the ACSM PA-R table (its intermediate anchors are
// not given in the review) and has never been validated against true PA-R anywhere. Flagged as such below.
const PA_R_LOW_STEPS = 3553;
const PA_R_HIGH_STEPS = 12000;
const stepsToPaR = (steps) => clamp(7 * (steps - PA_R_LOW_STEPS) / (PA_R_HIGH_STEPS - PA_R_LOW_STEPS), 0, 7);

const NEED_STEP_DAYS = 14; // our own minimum for a stable trailing average, not a literature threshold —
                            // Quer 2020's "use a rolling baseline, not single days" logic applied to steps.

/**
 * Non-exercise VO2max estimate — Jackson et al. 1990 BMI-based N-Ex model (§1), the best-verified
 * non-exercise model in the review (Nes 2011 HUNT's coefficients are unretrievable/paywalled; Nes is
 * a better predictor set but not implementable — see METRICS.md "blocked-pending-primary-text").
 *   VO2max = 56.363 + 1.921·PA-R − 0.381·Age − 0.754·BMI + 10.987·Sex(M=1,F=0)
 * Coefficients are grade UNVERIFIED-B in the review (secondary-source reproduction; the primary
 * abstract gives only R=0.78 and SEE=5.6, not the coefficients) — shipped anyway per the task brief,
 * flagged here as such. Error band is the model's own published SEE (cross-validated SEE ran 4.6-5.4).
 * Molina-Garcia/INTERLIVE 2022 found this whole family (resting-input, non-exercise models) runs about
 * +2.17 mL·kg⁻¹·min⁻¹ high on average pooled across studies — treat `low`/`high` as still optimistic by
 * roughly that much on top of the SEE band.
 * Returns null if profile is incomplete or fewer than `need` days of `summaries[].day.steps` exist.
 */
export function vo2max(profile, summaries) {
  if (!profile?.age || !profile?.sex || !profile?.height || !profile?.weight) return null;
  const days = [...(summaries ?? [])]
    .filter((s) => s.day?.steps != null)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 28);
  const n = days.length;
  if (n < NEED_STEP_DAYS) return null;
  const stepsTypical = median(days.map((s) => s.day.steps));
  const paR = stepsToPaR(stepsTypical);
  const bmi = profile.weight / (profile.height / 100) ** 2;
  const sexM = profile.sex === "male" ? 1 : 0;
  const value = JACKSON_1990_BMI.b0 + JACKSON_1990_BMI.paR * paR + JACKSON_1990_BMI.age * profile.age
    + JACKSON_1990_BMI.bmi * bmi + JACKSON_1990_BMI.sexM * sexM;
  return {
    value, low: value - JACKSON_1990_BMI.see, high: value + JACKSON_1990_BMI.see,
    method: "Jackson et al. 1990 N-Ex BMI model (Med Sci Sports Exerc 22(6):863-70, PMID 2287267): "
      + "56.363 + 1.921·PA-R − 0.381·Age − 0.754·BMI + 10.987·Sex(M=1). Coefficients UNVERIFIED-B "
      + "(secondary-source reproduction). PA-R is an unvalidated steps-derived proxy, not the paper's "
      + "self-report scale — see inputs.paMethod. Resting-input models like this one run ~+2.17 "
      + "mL·kg⁻¹·min⁻¹ high on average per pooled validation data (Molina-Garcia/INTERLIVE 2022).",
    inputs: {
      age: profile.age, sex: profile.sex, height: profile.height, weight: profile.weight, bmi, paR,
      paMethod: "UNVALIDATED: linear map of the trailing steps median onto the paper's 0-7 PA-R "
        + "endpoints, anchored at Paluch 2022's lowest-quartile median (3,553 steps/day → PA-R 0) and "
        + "Saint-Maurice 2020's ≥12,000 steps/day tier (→ PA-R 7). Not the ACSM PA-R table.",
      stepsTypical, n, need: NEED_STEP_DAYS,
    },
  };
}

// Uth N, Sørensen H, Overgaard K, Pedersen PK. "Estimation of VO2max from the ratio between HRmax and
// HRrest — the Heart Rate Ratio Method." Eur J Appl Physiol. 2004;91:111-115. DOI 10.1007/s00421-003-0988-y.
// Factor corrected to 15.3 per METRICS.md's verification notes (not 15.0).
const UTH_2004_FACTOR = 15.3;
const UTH_2004_ERROR_BAND = 0.15; // review states "±10-15%"; the wider bound is used here.

/**
 * Uth et al. 2004 HR-ratio VO2max estimate (§1): VO2max = 15.3 × HRmax/HRrest.
 * Validated only in well-trained male students aged 21-51 (n=45) — NOT validated in women, untrained
 * adults, 55+ populations, or beta-blocker users, which describes most of this app's userbase. Show
 * only for a closely-matching profile (e.g. the 29-year-old lifter), with a wide error band.
 * Pass a beta-blocker-adjusted hrmax (summary.js's hrMaxFor) if relevant; the ratio method itself has
 * no validated beta-blocker correction of its own.
 * Returns null if hrmax or rhr is missing or non-positive.
 */
export function vo2maxUth({ hrmax, rhr } = {}) {
  if (!hrmax || !rhr || rhr <= 0) return null;
  const value = UTH_2004_FACTOR * (hrmax / rhr);
  return {
    value, low: value * (1 - UTH_2004_ERROR_BAND), high: value * (1 + UTH_2004_ERROR_BAND),
    method: "Uth et al. 2004 (Eur J Appl Physiol 91:111-115): VO2max = 15.3 × HRmax/HRrest. Validated "
      + "only in well-trained male students aged 21-51 (n=45); population mismatch for most Pulse "
      + "users. Error band shown at the review's stated ±15% (upper end of ±10-15%).",
    inputs: { hrmax, rhr },
  };
}

// ---------------------------------------------------------------------------------------------
// §5 Heart-rate recovery trend
// ---------------------------------------------------------------------------------------------

const HRR_TREND_NEED = 3; // our own minimum for a usable personal baseline, not a literature threshold.

/**
 * Self-baselined heart-rate-recovery trend (§5) from workouts already detected in `summaries[].day.workouts`
 * (hrr60/hrr120, computed per Cole 1999's protocol shape but on free-living data — an informal detector,
 * not the clinical protocol). The review is explicit that the clinical ≤12 bpm cutoff does not transfer
 * to this measurement context: never compare against it, only against the person's own history.
 * `series` is every dated {hrr60, hrr120} in order; `latest` is the most recent; `baseline` is the median
 * of everything before it. `ready` is false (baseline/latest null) until `need` workouts exist.
 */
export function hrrTrend(summaries, { need = HRR_TREND_NEED } = {}) {
  const series = [];
  for (const s of [...(summaries ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    for (const w of s.day?.workouts ?? []) {
      if (w.hrr60 != null || w.hrr120 != null) series.push({ date: s.date, hrr60: w.hrr60 ?? null, hrr120: w.hrr120 ?? null });
    }
  }
  const n = series.length;
  const ready = n >= need;
  const latest = ready ? series[n - 1] : null;
  const base = ready && n > 1
    ? { hrr60: median(series.slice(0, -1).map((x) => x.hrr60)), hrr120: median(series.slice(0, -1).map((x) => x.hrr120)) }
    : null;
  return { latest, baseline: base, series, n, need, ready };
}

// ---------------------------------------------------------------------------------------------
// §10 "HR over steps" — cardiac cost of movement (cadence-only Physiological Cost Index proxy)
// ---------------------------------------------------------------------------------------------

// Physiological Cost Index: Raj R, Mojazi Amiri H, Wang H, Nugent KM. "The repeatability of gait speed
// and physiological cost index measurements in working adults." J Prim Care Community Health.
// 2014;5(2):128-33. PCI (beats/m) = (HR_walking − HR_resting) / walking speed (m/min). The band gives us
// no per-bin distance, only cadence (steps/min), which the review explicitly grades one letter down as a
// "step-length-blind proxy for speed — reasonable for one person's own trend... not comparable across
// people or against the published beats/meter norms" (§10). We report bpm per 100 steps/min instead of
// beats/m for that reason: it is a Pulse-defined index, not a reproduction of the published PCI unit.
const CADENCE_LOW = 80, CADENCE_HIGH = 120; // steady walking band, per the task brief.
const CARDIAC_COST_NEED = 3; // minutes; single- or double-minute means are too noisy to trust.

function hrPerMinuteFor(hrRows, date) {
  const sums = new Map();
  for (const { t, bpm } of hrRows ?? []) {
    if (t.slice(0, 10) !== date) continue;
    const m = +t.slice(11, 13) * 60 + +t.slice(14, 16);
    const e = sums.get(m) ?? [0, 0];
    e[0] += bpm; e[1] += 1;
    sums.set(m, e);
  }
  const out = new Map();
  for (const [m, [s, c]] of sums) out.set(m, s / c);
  return out;
}

/**
 * Cardiac cost of movement for one day (§10, cadence-only adaptation — Grade C in the review, personal
 * trend only). Averages HR and cadence over steady walking minutes (cadence 80-120 steps/min) that also
 * follow another such minute, so the minute right after a cadence change (walk starts/stops/surges) is
 * excluded — that minute's HR is still catching up, per §5/§10's general caution about lag between a
 * workload change and the HR response. `bpmPer100spm` = (walkingHr − rhr) / (cadence/100).
 * Returns null if fewer than `need` qualifying minutes are found.
 */
export function cardiacCost(hrRows, minuteSteps, date, rhr, { need = CARDIAC_COST_NEED } = {}) {
  if (rhr == null || !minuteSteps) return null;
  const hrMin = hrPerMinuteFor(hrRows, date);
  const inBand = (m) => { const c = minuteSteps.get(m); return c != null && c >= CADENCE_LOW && c <= CADENCE_HIGH; };
  let sumHr = 0, sumCad = 0, n = 0;
  for (let m = 1; m < 1440; m++) {
    if (!inBand(m) || !inBand(m - 1)) continue; // steady-state only
    const hr = hrMin.get(m);
    if (hr == null) continue;
    sumHr += hr; sumCad += minuteSteps.get(m); n += 1;
  }
  if (n < need) return null;
  const walkingHr = sumHr / n, cadence = sumCad / n;
  return { bpmPer100spm: (walkingHr - rhr) / (cadence / 100), walkingHr, cadence, minutes: n, n, need };
}

const CARDIAC_SERIES_NEED = 7;

/**
 * Trend over cardiacCost()'s daily output. cardiacCost() itself needs raw 5-s HR rows and per-minute
 * steps for the day, which per-day summaries don't retain — so to trend this across days, store
 * cardiacCost()'s return value on the per-day summary once at build time, e.g.
 *   s.day.cardiac_cost = cardiacCost(dayHrRows, minuteSteps(act), date, rhr)
 * in computeDay() (analytics/summary.js). This function then just reads `summaries[].day.cardiac_cost`.
 */
export function cardiacCostSeries(summaries, { need = CARDIAC_SERIES_NEED } = {}) {
  const series = [...(summaries ?? [])]
    .filter((s) => s.day?.cardiac_cost?.bpmPer100spm != null)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((s) => ({ date: s.date, bpmPer100spm: s.day.cardiac_cost.bpmPer100spm, minutes: s.day.cardiac_cost.minutes }));
  const n = series.length;
  const ready = n >= need;
  const latest = ready ? series[n - 1] : null;
  const base = ready && n > 1 ? median(series.slice(0, -1).map((x) => x.bpmPer100spm)) : null;
  return { series, n, need, ready, latest, baseline: base };
}

// ---------------------------------------------------------------------------------------------
// §7 Energy expenditure from HR (Keytel 2005)
// ---------------------------------------------------------------------------------------------

// Keytel LR, Goedecke JH, Noakes TD, Hiiloskorpi H, Laukkanen R, van der Merwe L, Lambert EV. "Prediction
// of energy expenditure from heart rate monitoring during submaximal exercise." J Sports Sci.
// 2005;23(3):289-97. PMID 15966347. "Without VO2max" variant (R²=73.4%), the realistic case for us.
// Coefficients are the commonly-reproduced secondary-source set; the review marks them UNVERIFIED against
// Keytel's primary text (paywalled, not in the abstract) — kept only because METRICS.md's Tier-2 table
// already plans this metric at "Low" confidence and the review keeps the population/error figures, which
// ARE verified (Shcherbina 2017: device HR-calorie error runs 27-93%).
function keytelKcalPerMin(hr, weightKg, ageYr, sex) {
  return sex === "female"
    ? (-20.4022 + 0.4472 * hr - 0.1263 * weightKg + 0.074 * ageYr) / 4.184
    : (-55.0969 + 0.6309 * hr + 0.1988 * weightKg + 0.2017 * ageYr) / 4.184;
}
const KEYTEL_POPULATION_ERROR = "Device-estimated HR-based calorie burn error runs 27-93% even with "
  + "vendor-proprietary algorithms (Shcherbina 2017); expect the same or worse outside Keytel's own "
  + "18-45-year-old, regularly-exercising validation cohort, and systematic underestimation for "
  + "beta-blocker users (their HR response to a given workload is blunted).";
// Borrowed from Apple's 2021 white paper (§4): its VO2max algorithm requires exertion reaching ≥30% of
// the HRrest-to-HRmax range before trusting an HR-vs-workload estimate. Keytel's own paper states no
// minimum HR for its model, but its validation cohort was always measured during genuine submaximal
// exercise, not incidental daily HR fluctuation — this threshold is our own way of approximating "really
// exercising" from continuous HR alone, not a Keytel-specified cutoff.
const ENERGY_HRR_FRACTION = 0.30;

/**
 * Daily energy expenditure. `bmr` is always null: Mifflin-St Jeor 1990 is not present anywhere in
 * lit_cardio_fitness.md or METRICS.md (no formula, coefficients, or citation), so it is left out rather
 * than invented, per the brief's own override rule. `active` is Keytel et al. 2005's HR-based kcal/min
 * model (§7), summed over minutes at/above `ENERGY_HRR_FRACTION` of heart-rate reserve (see comment
 * above for why that threshold). `total` is null because it would otherwise silently imply a real BMR
 * went into it. The steps-based fallback the brief asked for was not built: no verified steps→kcal
 * coefficient exists in either research file, and inventing one would violate the brief's own rule.
 * Never null itself — there is always something to report, even if only why a part is missing.
 */
export function energy(profile, { hrRows = [], minuteSteps, date, rhr, hrmax } = {}) {
  const notes = ["BMR omitted: Mifflin-St Jeor 1990 is not in the provided research files (no formula, "
    + "coefficients, or citation to verify) — left out rather than invented."];
  let active = null, n = 0;
  const need = 1;
  const canKeytel = rhr != null && hrmax != null && date != null && profile?.weight != null
    && profile?.age != null && profile?.sex != null;
  if (canKeytel) {
    const threshold = rhr + ENERGY_HRR_FRACTION * (hrmax - rhr);
    const hrMin = hrPerMinuteFor(hrRows, date);
    let kcal = 0;
    for (const hr of hrMin.values()) {
      if (hr >= threshold) { kcal += keytelKcalPerMin(hr, profile.weight, profile.age, profile.sex); n += 1; }
    }
    if (n > 0) active = kcal;
    notes.push(`Active energy: Keytel et al. 2005 HR-based model, sex-specific "without VO2max" variant `
      + `(J Sports Sci 23(3):289-97; R²=73.4%; coefficients UNVERIFIED against primary text). Applied only `
      + `to minutes at/above ${Math.round(ENERGY_HRR_FRACTION * 100)}% heart-rate reserve `
      + `(≥${threshold.toFixed(1)} bpm here) — see the ENERGY_HRR_FRACTION comment in this file for why.`);
  } else {
    notes.push("Active energy not computed: needs rhr, hrmax, date, profile.weight, profile.age and profile.sex.");
  }
  notes.push("No verified steps-only calorie formula exists in either research file; the steps-based "
    + "fallback the brief called for was left out rather than invented (see file header).");
  void minuteSteps; // kept in the signature for interface parity; unused until a verified fallback exists.
  return { bmr: null, active, total: null, method: notes.join(" "), error: KEYTEL_POPULATION_ERROR, n, need };
}

// ---------------------------------------------------------------------------------------------
// Heart rate by sleep stage
// ---------------------------------------------------------------------------------------------

const STAGE_KEYS = { 1: "deep", 2: "light", 3: "rem" }; // 4 and any other code = awake, matching metrics.js.

function minuteEntries(x) {
  if (x instanceof Map) return [...x.entries()];
  if (Array.isArray(x)) return x.map((v, i) => [i, v]);
  return Object.entries(x ?? {}).map(([k, v]) => [+k, v]);
}

/**
 * Mean heart rate per band sleep-stage code (1 deep, 2 light, 3 REM, 4/other awake), from parallel
 * per-minute inputs (Array, Map, or plain {minute: value} object, keyed/indexed the same way for both
 * arguments). Purely descriptive grouping, no cited formula beyond the band's own stage codes
 * (METRICS.md's SLEEP_STAGES convention) — null-safe: a stage with no minutes, or minutes with no HR
 * sample, contributes nothing rather than throwing or producing NaN.
 */
export function hrByStage(stagesPerMinute, hrPerMinute) {
  const stages = minuteEntries(stagesPerMinute);
  const hr = new Map(minuteEntries(hrPerMinute));
  const sums = { deep: [0, 0], light: [0, 0], rem: [0, 0], awake: [0, 0] };
  for (const [m, code] of stages) {
    const v = hr.get(m);
    if (v == null) continue;
    const key = STAGE_KEYS[code] ?? "awake";
    sums[key][0] += v; sums[key][1] += 1;
  }
  const out = {}, n = {};
  for (const k of ["deep", "light", "rem", "awake"]) {
    const [s, c] = sums[k];
    out[k] = c ? s / c : null;
    n[k] = c;
  }
  return { ...out, n };
}

// ---------------------------------------------------------------------------------------------
// §11 Weekly training load (TRIMP + session-RPE, kept separate — no composite "strain" score)
// ---------------------------------------------------------------------------------------------

function isoWeekKey(dateStr) {
  const d = new Date(Date.UTC(+dateStr.slice(0, 4), +dateStr.slice(5, 7) - 1, +dateStr.slice(8, 10)));
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - dow + 3); // that week's Thursday decides the ISO year
  const isoYear = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Dow = (jan4.getUTCDay() + 6) % 7;
  const week1Mon = new Date(jan4); week1Mon.setUTCDate(jan4.getUTCDate() - jan4Dow);
  const week = Math.round((d - week1Mon) / (7 * 864e5)) + 1;
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}
const addDays = (dateStr, delta) => new Date(Date.UTC(+dateStr.slice(0, 4), +dateStr.slice(5, 7) - 1, +dateStr.slice(8, 10) + delta))
  .toISOString().slice(0, 10);

const emptyWeek = (week) => ({ week, trimp: 0, sessionLoad: 0, days: 0, sessions: 0 });

/**
 * Weekly training load, ISO-week bucketed (Monday-Sunday, ISO 8601). Two figures per week, deliberately
 * never combined into one score (the review found no independently validated composite "strain" number
 * for any vendor or research group — §11, graded X — so this module doesn't build one):
 *   - trimp: sum of `summaries[].day.trimp` (Banister TRIMP, already computed in metrics.js/summary.js).
 *   - sessionLoad: Σ RPE × minutes (Foster 2001 / Sweet 2004, §9) for workouts that have a matching tag.
 * `tags` is an array (or Map) of {date, start, rpe, minutes?, type?} records, matched to a summary's
 * `day.workouts[].start` by exact (date, start) — the caller's own post-session RPE prompts, not
 * something derivable from HR+steps alone (§9: no validated HR-only resistance-training load exists).
 * If a tag omits `minutes`, the matching workout's own detected duration is used instead.
 * `thisWeek`/`lastWeek` are the ISO weeks of the latest date in `summaries` and the week exactly 7 days
 * before it (always the prior ISO week, regardless of where the latest date falls in its own week).
 */
export function weeklyLoad(summaries, tags = []) {
  const tagIndex = new Map(tags instanceof Map ? [...tags.entries()] : tags.map((t) => [`${t.date}|${t.start}`, t]));
  const weeks = new Map();
  for (const s of [...(summaries ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const wk = isoWeekKey(s.date);
    const e = weeks.get(wk) ?? { trimp: 0, sessionLoad: 0, days: new Set(), sessions: 0 };
    if (s.day?.trimp != null) e.trimp += s.day.trimp;
    for (const w of s.day?.workouts ?? []) {
      const tag = tagIndex.get(`${s.date}|${w.start}`);
      const minutes = tag?.minutes ?? w.minutes;
      if (tag?.rpe != null && minutes != null) { e.sessionLoad += tag.rpe * minutes; e.sessions += 1; }
    }
    e.days.add(s.date);
    weeks.set(wk, e);
  }
  const pack = (wk, e) => ({ week: wk, trimp: e.trimp, sessionLoad: e.sessionLoad, days: e.days.size, sessions: e.sessions });
  const series = [...weeks.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([wk, e]) => pack(wk, e));
  const sorted = [...(summaries ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!sorted.length) return { thisWeek: null, lastWeek: null, series };
  const latestDate = sorted[sorted.length - 1].date;
  const thisKey = isoWeekKey(latestDate), lastKey = isoWeekKey(addDays(latestDate, -7));
  return {
    thisWeek: weeks.has(thisKey) ? pack(thisKey, weeks.get(thisKey)) : emptyWeek(thisKey),
    lastWeek: weeks.has(lastKey) ? pack(lastKey, weeks.get(lastKey)) : emptyWeek(lastKey),
    series,
  };
}
