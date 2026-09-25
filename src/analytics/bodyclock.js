// Circadian/body-clock metrics built on top of the per-day summaries (analytics/summary.js) and the
// sleep-period primitives in analytics/sleep.js: schedule regularity (SRI), chronotype/social jetlag
// (MCTQ), nonparametric rest-activity-rhythm analysis (IS/IV/RA/L5/M10) on any hourly channel, and a
// couple of simple overnight-HR passthroughs (nocturnal dip, nadir timing). Every formula below is
// cited to a specific section of ~/jcv8/research/lit_sleep_circadian.md or lit_cardio_fitness.md;
// nothing here is a coefficient invented for this module. Pure functions only; every function returns
// null (not a partial/garbage object) when there isn't enough data, and the non-null results carry
// their own day/night counts so callers can render "needs N more days" without re-deriving thresholds.
import { sleepRegularityIndex, circularStats, clockDiff } from "./sleep.js?v=20260925173307";

const MS_DAY = 86400000;
const dateUTC = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const addDays = (d, n) => new Date(dateUTC(d) + n * MS_DAY).toISOString().slice(0, 10);
const dowOf = (d) => new Date(dateUTC(d)).getUTCDay(); // 0 Sun .. 6 Sat

/**
 * A day's `states` string ('1' asleep / '0' awake / '.' unknown) to a 1440-slot array of 1/0/null,
 * for feeding sleep.js's sleepRegularityIndex(). A date with no summary at all (band not synced that
 * day, etc.) becomes an all-null day, which — per Phillips 2017's own missing-data rule (§3.1,
 * "only pairs of non-missing time-points were used") — drops only the day-pairs that touch it, not
 * the whole window.
 */
function statesArray(states) {
  const out = new Array(1440).fill(null);
  if (!states) return out;
  for (let i = 0; i < 1440 && i < states.length; i++) out[i] = states[i] === "1" ? 1 : states[i] === "0" ? 0 : null;
  return out;
}

/**
 * Sleep Regularity Index (Phillips, Clerx, O'Brien et al. 2017, Sci Rep 7:3216, DOI
 * 10.1038/s41598-017-03171-4): the probability that any two time-points 24 h apart share the same
 * asleep/awake state, rescaled y = 200(x − 1/2) to a −100..+100 range (100 = perfectly regular,
 * 0 = random, negative = systematically anti-correlated). lit_sleep_circadian.md §3.1.
 * Computed over the trailing `days` calendar days ending on the last summary's date (default 14 —
 * the review's practical "2-4 week" recommendation, itself an implementation choice, not literature-
 * validated: §3.1). Returns null if fewer than `minDays` of those days have any state data at all.
 */
export function sri(summaries, { days = 14, minDays = 5 } = {}) {
  if (!summaries.length) return null;
  const byDate = new Map(summaries.map((s) => [s.date, s]));
  const end = summaries[summaries.length - 1].date;
  const arrs = [];
  for (let i = days - 1; i >= 0; i--) arrs.push(statesArray(byDate.get(addDays(end, -i))?.states));
  const r = sleepRegularityIndex(arrs, minDays);
  return r ? { sri: r.sri, days: r.days, pairs: r.pairs } : null;
}

/**
 * SRI as a rolling series: one trailing `windowDays`-day (default 7) SRI per summary date, for a
 * "your regularity over time" trend chart (Phillips 2017; population median SRI ≈ 81 in a
 * near-identical 55+/cardiac-risk cohort — Windred, Burns, Lane et al. 2024, Sleep 47(1):zsad253 —
 * a useful reference line, not computed here). lit_sleep_circadian.md §3.1-3.2.
 */
export function sriSeries(summaries, { windowDays = 7, minDays = 5 } = {}) {
  if (!summaries.length) return [];
  const byDate = new Map(summaries.map((s) => [s.date, s]));
  return summaries.map((s) => {
    const arrs = [];
    for (let i = windowDays - 1; i >= 0; i--) arrs.push(statesArray(byDate.get(addDays(s.date, -i))?.states));
    const r = sleepRegularityIndex(arrs, minDays);
    return { date: s.date, sri: r ? r.sri : null };
  });
}

/**
 * Chronotype from a simplified, band-derived MCTQ (Munich ChronoType Questionnaire):
 *   - Roenneberg, Wirz-Justice & Merrow 2003, J Biol Rhythms 18:80 — MSW/MSF mid-sleep definitions.
 *   - Roenneberg, Kuehnle, Pramstaller et al. 2004, Curr Biol 14:R1038 — the MSFsc sleep-debt
 *     correction.
 *   - Wittmann, Dinich, Merrow & Roenneberg 2006, Chronobiol Int 23:497 — social jetlag = |MSF−MSW|.
 * lit_sleep_circadian.md §4.1-4.2. Free days = nights whose wake date (`s.date`) is a Saturday or
 * Sunday (i.e. Friday- and Saturday-evening sleep onsets); every other night counts as a workday.
 * This fixed Sat/Sun split is our own simplification of the review's retiree-oriented heuristics
 * (§4.1 offers data-driven day clustering, or dropping the correction entirely, as alternatives) —
 * grade it like the review grades its own heuristic, **C**, even though the MSF/MSW/MSFsc/social-
 * jetlag arithmetic itself is the primary-sourced, **A**-grade part.
 *   MSW = circular mean of workday sleep midpoints; MSF = circular mean of free-day sleep midpoints
 *     (`night.sleep.midpoint_min`, already the band's "onset + span/2" sleep-midpoint field — §1.3).
 *   SDweek = (SDw·5 + SDf·2) / 7, with Dw=5/Df=2 the standard MCTQ weekly split, SDw/SDf the mean
 *     TST (`night.sleep.asleep`) on work/free nights.
 *   MSFsc = MSF − (SDf − SDweek)/2 when SDf > SDweek (catch-up sleep observed on free days),
 *     else MSFsc = MSF (no correction).
 *   Social jetlag = |MSF − MSW|, using sleep.js's circular clockDiff so it can't be inflated by
 *     wrapping past midnight.
 * All of msf/msw/msfsc are minutes after midnight; sdFree/sdWork are the circular SD (minutes) of
 * the free/work-night midpoints (§3.4's "SD of sleep midpoint" companion stat, split by day type).
 * Returns null if fewer than `minFree` free nights or `minWork` work nights have a recorded main
 * sleep this window.
 */
export function chronotype(summaries, { minFree = 2, minWork = 3 } = {}) {
  const free = [], work = [];
  for (const s of summaries) {
    const sl = s.night?.sleep;
    if (!sl || sl.midpoint_min == null || sl.asleep == null) continue;
    ([0, 6].includes(dowOf(s.date)) ? free : work).push(sl);
  }
  if (free.length < minFree || work.length < minWork) return null;
  const cf = circularStats(free.map((n) => n.midpoint_min));
  const cw = circularStats(work.map((n) => n.midpoint_min));
  const sdf = free.reduce((a, n) => a + n.asleep, 0) / free.length;
  const sdw = work.reduce((a, n) => a + n.asleep, 0) / work.length;
  const sdWeek = (sdw * 5 + sdf * 2) / 7;
  const msf = cf.mean, msw = cw.mean;
  const msfsc = sdf > sdWeek ? (((msf - (sdf - sdWeek) / 2) % 1440) + 1440) % 1440 : msf;
  return {
    msf, msw, msfsc, socialJetlag: Math.abs(clockDiff(msf, msw)),
    sdFree: cf.sd, sdWork: cw.sd, nFree: free.length, nWork: work.length,
  };
}

/**
 * Nonparametric circadian-rhythm variables (Witting et al. 1990 as codified/applied by Van Someren,
 * Swaab, Colenda et al. 1999, Chronobiol Int 16:505, DOI 10.3109/07420529908998724; methodological
 * review Gonçalves, Adamowicz, Louzada et al. 2015, Sleep Med Rev 20:84). lit_sleep_circadian.md §6.2.
 * `hourlyByDay` is one 24-length array per day (oldest first; a day can be a shorter/partial array),
 * each slot an hourly mean or null for an unworn/missing hour.
 *   IS  interdaily stability (0-1): how alike the 24-h pattern is from day to day (coupling to
 *       zeitgebers). IS = [N·Σ_h(x̄_h−x̄)²] / [24·Σ_i(x_i−x̄)²].
 *   IV  intradaily variability (0-2): hour-to-hour fragmentation. IV = [N·Σ(x_i−x_{i−1})²] /
 *       [(N−1)·Σ(x_i−x̄)²]. Resolution-dependent (§6.3) — compare only against the wearer's own
 *       history, never a published norm.
 *   RA  relative amplitude = (M10−L5)/(M10+L5), M10/L5 = the mean of the 10/5 (clock-)consecutive
 *       hours of highest/lowest average value in the day-averaged profile. Low RA (on activity) was
 *       linked to worse mood/wellbeing/loneliness in 91,105 UK Biobank adults (Lyall, Cullen, Ferguson
 *       et al. 2018, Lancet Psychiatry 5:507).
 * `invert` (for signals that peak at night, e.g. wrist skin temperature) swaps which extreme-window
 * search plays which role, so M10 stays the "active-phase" marker and L5 the "rest-phase" marker on
 * every channel, matching activity's convention. Sarabia, Rol, Mendiola & Madrid 2008 (Physiol Behav
 * 95:570) found wrist temperature is phase-inverted relative to activity/core temperature — it rises
 * before and through sleep — so the 10-consecutive-hour window with the *lowest* wrist temperature is
 * the daytime/active-phase analogue of activity's M10, and the 5-consecutive-hour window with the
 * *highest* temperature is the nighttime/rest analogue of L5. §6.5 explicitly calls out this "sign
 * flip when adapting these formulas to temperature," though its own prose about which window ends up
 * "warm" reads inconsistently with the Sarabia finding it cites in the same paragraph — this
 * implementation follows the physiology as stated (warm wrist = rest/night), not that ambiguous
 * restatement; flagging the discrepancy rather than silently picking one reading.
 * Returns null if fewer than `minDays` days have any data, or if any of the 24 clock hours has no
 * data at all anywhere in the window (the averaged 24-h profile needs every slot filled).
 */
export function nonparametric(hourlyByDay, { minDays = 3, invert = false } = {}) {
  const validDays = hourlyByDay.filter((d) => (d ?? []).some((v) => v != null)).length;
  if (validDays < minDays) return null;
  const flat = hourlyByDay.flat();
  const valid = flat.filter((v) => v != null);
  if (!valid.length) return null;
  const mean = valid.reduce((a, v) => a + v, 0) / valid.length;
  const totalSS = valid.reduce((a, v) => a + (v - mean) ** 2, 0);
  const prof = Array.from({ length: 24 }, (_, h) => {
    const vals = hourlyByDay.map((d) => d?.[h]).filter((v) => v != null);
    return vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : null;
  });
  if (prof.some((v) => v == null)) return null;
  const win = (len, findMax) => {
    let best = null;
    for (let s = 0; s < 24; s++) {
      let a = 0;
      for (let k = 0; k < len; k++) a += prof[(s + k) % 24];
      const avg = a / len;
      if (!best || (findMax ? avg > best.avg : avg < best.avg)) best = { s, avg };
    }
    return best;
  };
  const m10 = win(10, !invert), l5 = win(5, invert);
  const ra = m10.avg + l5.avg !== 0 ? (m10.avg - l5.avg) / (m10.avg + l5.avg) : 0;
  const m10Out = { value: m10.avg, start: m10.s }, l5Out = { value: l5.avg, start: l5.s };
  if (totalSS === 0) return { is: 0, iv: 0, ra, l5: l5Out, m10: m10Out, days: validDays }; // no variance anywhere: nothing rhythmic to detect
  const N = valid.length;
  const is = (N * prof.reduce((a, v) => a + (v - mean) ** 2, 0)) / (24 * totalSS);
  let sumDiff2 = 0, pairs = 0;
  for (let i = 1; i < flat.length; i++) {
    const a = flat[i - 1], b = flat[i];
    if (a != null && b != null) { sumDiff2 += (b - a) ** 2; pairs++; }
  }
  const iv = pairs ? (N * sumDiff2) / (pairs * totalSS) : null;
  return { is, iv, ra, l5: l5Out, m10: m10Out, days: validDays };
}

/** nonparametric() on overnight-to-overnight hourly heart rate (`day.hr_hourly` means; §6.5). */
export function hrRhythm(summaries, opts = {}) {
  const hourlyByDay = summaries.map((s) => (s.day?.hr_hourly ?? Array(24).fill(null)).map((h) => (h ? h[0] : null)));
  return nonparametric(hourlyByDay, opts);
}

/** nonparametric() on wrist skin temperature (`day.temp_hourly`), inverted per Sarabia 2008 (§6.5). */
export function tempRhythm(summaries, opts = {}) {
  const hourlyByDay = summaries.map((s) => s.day?.temp_hourly ?? Array(24).fill(null));
  return nonparametric(hourlyByDay, { ...opts, invert: true });
}

/**
 * Hourly means of an arbitrary field for one calendar date: `rows` are timestamped records
 * [{t: "YYYY-MM-DD hh:mm:ss", <key>: value}, ...]. Returns a 24-slot array (hour 0..23) of the mean
 * of `key` for rows on `date` that fall in that clock hour, or null where there were none — the same
 * shape as summary.js's own hourlyMeans() for HR, so e.g. a future wrist-temperature stream can be
 * turned into `day.temp_hourly` for tempRhythm() the same way.
 */
export function hourlyMeans(rows, date, key) {
  const d0 = `${date} 00:00:00`, d1 = `${date} 23:59:59`;
  const sums = Array(24).fill(0), counts = Array(24).fill(0);
  for (const r of rows) {
    if (r.t < d0 || r.t > d1) continue;
    const v = r[key];
    if (v == null) continue;
    const h = +r.t.slice(11, 13);
    sums[h] += v; counts[h]++;
  }
  return sums.map((s, h) => (counts[h] ? s / counts[h] : null));
}

/**
 * Nocturnal HR dipping %: (DaytimeMeanHR − NocturnalMeanHR) / DaytimeMeanHR × 100 — a direct
 * adaptation of the nocturnal blood-pressure dipping definition to heart rate, from `night.hr.mean`
 * (sleeping HR, time-weighted) vs `day.hr_mean_awake`. lit_cardio_fitness.md §3. The review found no
 * study validating a "dipping percent" computed from continuous optical HR — only the separate,
 * far-better-studied nocturnal *blood-pressure* dipping literature uses this formula shape — so treat
 * `dipPct` as Grade C / directional only, never as a clinical risk flag (§3's own "cannot be derived"
 * list explicitly warns against importing BP-dipping's risk framing onto HR).
 * `category` uses the conventional dipper / non-dipper / reverse-dipper / extreme-dipper bucket names
 * and their usual 0% / 10% / 20% cut-points from the BP-dipping literature, applied here purely as
 * familiar labels for the UI. **These specific percentages do not appear in lit_cardio_fitness.md and
 * are not validated for HR** — they are included, clearly flagged, rather than silently guessed;
 * drop/relabel them if a stricter "review-only numbers" policy is wanted.
 */
export function nocturnalDip(s) {
  const sleepMean = s?.night?.hr?.mean ?? null;
  const awakeMean = s?.day?.hr_mean_awake ?? null;
  if (sleepMean == null || awakeMean == null || !awakeMean) return null;
  const dipPct = ((awakeMean - sleepMean) / awakeMean) * 100;
  const category = dipPct < 0 ? "reverse dipper" : dipPct < 10 ? "non-dipper" : dipPct < 20 ? "dipper" : "extreme dipper";
  return { dipPct, sleepMean, awakeMean, category };
}

/** nocturnalDip() over a run of days, for a "your dip % over time" chart. Null fields when a day lacks the inputs. */
export function dipSeries(summaries) {
  return summaries.map((s) => ({ date: s.date, ...(nocturnalDip(s) ?? { dipPct: null, sleepMean: null, awakeMean: null, category: null }) }));
}

/**
 * Passthrough/interpretation of the overnight HR nadir already computed in `night.hr`
 * (overnight.js's sleepingHR): `frac` is where the lowest 30-min HR window sits within the sleep
 * period (0 = at onset, 1 = at wake); `time` is its clock time. An early nadir (frac < 0.5) typically
 * falls within an early-night, slow-wave-sleep-dominant cycle, since NREM is when HR is lowest and
 * most stable (Snyder, Hobson, Morrison & Goldfrank 1964, J Appl Physiol 19:417) — lit_sleep_circadian
 * .md §7.1, itself Grade B (the physiological direction is verified; no modern large-N nadir-timing
 * study was found in the review).
 */
export function nadirTiming(s) {
  const hr = s?.night?.hr;
  if (!hr || hr.nadir_frac == null) return null;
  return { frac: hr.nadir_frac, time: hr.rhr_time ?? null, early: hr.nadir_frac < 0.5 };
}
