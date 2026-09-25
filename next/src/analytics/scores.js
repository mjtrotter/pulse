// Daily scores. Each returns {score 0-100, parts: [{key, label, value, points, max, note}], ready}
// so the UI can show exactly what went into it. Weights are ours and stated; inputs are the
// robust parts of the band's data (timing, duration, continuity, resting HR, temperature).
import { baseline, clamp, median, z } from "./baseline.js?v=20260924233355";
import { circularStats, clockDiff, sleepNeed } from "./sleep.js?v=20260924233355";

const prevDay = (date) => new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) - 1)).toISOString().slice(0, 10);
const part = (key, label, frac, max, value, note) => ({ key, label, value, points: Math.round(frac * max), max, frac, note });
const total = (parts) => Math.round(parts.reduce((s, p) => s + p.frac * p.max, 0) / parts.reduce((s, p) => s + p.max, 0) * 100);

/**
 * Sleep score for one night (0-100, rarely 100: every part has to be excellent).
 * - Duration 35: full marks from 30 min above the bottom of the age-specific recommendation up to its
 *   top (NSF 2015: 7-9 h, 7-8 h at 65+); linear to 0 at 4 h; beyond the range + 1 h a gentle taper
 *   (long sleep is a marker, not a cause).
 * - Efficiency 15: full at 92%+, 0 at 70% (85% is the conventional "good sleep" threshold).
 * - Continuity 15: time awake after falling asleep, full at ≤ 10 min, 0 at 90 min.
 * - Regularity 20: midpoint within 15 min of your 14-night average is full, 0 at 2 h off
 *   (irregular timing predicts mortality independent of duration: Windred 2024).
 * - Deep + REM 15: 45%+ of sleep full, 0 at 20% (the band's staging is approximate, so low weight).
 */
export function sleepScore(night, prior, profile = {}) {
  const s = night?.sleep;
  if (!s) return null;
  const need = sleepNeed(profile.age ?? 40);
  const tst = s.asleep, full = need.min + 30;
  const dur = tst >= full ? (tst <= need.max + 60 ? 1 : clamp(1 - (tst - need.max - 60) / 180, 0.6, 1)) : clamp((tst - 240) / (full - 240));
  const eff = s.efficiency == null ? null : clamp((s.efficiency - 70) / 22);
  const cont = clamp(1 - (s.waso - 10) / 80);
  const mids = prior.map((p) => p.night?.sleep?.midpoint_min).filter((m) => m != null).slice(-14);
  const circ = mids.length >= 3 ? circularStats(mids) : null;
  const off = circ ? Math.abs(clockDiff(s.midpoint_min, circ.mean)) : null;
  const reg = off == null ? null : clamp(1 - (off - 15) / 105);
  const restor = s.pct ? clamp((s.pct.deep + s.pct.rem - 20) / 25) : null;
  const parts = [
    part("duration", "Time asleep", dur, 35, tst, `${need.min / 60}–${need.max / 60} h recommended for your age`),
    eff != null && part("efficiency", "Efficiency", eff, 15, s.efficiency, "Share of time in bed spent asleep"),
    part("continuity", "Awake during the night", cont, 15, s.waso, "10 minutes or less is excellent"),
    reg != null && part("regularity", "Regular timing", reg, 20, off, "Midpoint of sleep vs your usual"),
    restor != null && part("restoration", "Deep + REM", restor, 15, s.pct.deep + s.pct.rem, "Band estimate; 45%+ of sleep is excellent"),
  ].filter(Boolean);
  return { score: total(parts), parts, ready: true };
}

/**
 * Recovery: tonight vs your own baseline (median and robust SD of up to 28 prior nights; ≥ 5 needed).
 * - Resting HR 30: lower than usual is better; −1.5 SD or better is full, +2.5 SD is 0.
 * - Overnight HRV (band estimate) 30: higher than usual is better (ln scale).
 * - Temperature 15: only warmer-than-usual counts against you; +0.2 °C full, +0.8 °C or more 0
 *   (TemPredict: fever-range deviations start around +0.5 °C at the wrist).
 * - Sleep 25: tonight's sleep score.
 * Contributors with no baseline yet are left out and their weight is spread over the rest.
 */
export function recoveryScore(night, prior, sleep) {
  if (!night) return null;
  const nightsWith = (f) => prior.map(f).filter((x) => x != null);
  const bRhr = baseline(nightsWith((p) => p.night?.hr?.rhr), { minN: 5, minSpread: 1.5 });
  // Overnight HRV: our own RMSSD from the band's pulse intervals when available, else the band's estimate.
  const lnHrv = (n) => n?.ppi?.ln_rmssd ?? (n?.hrv?.median > 0 ? Math.log(n.hrv.median) : null);
  const bHrv = baseline(nightsWith((p) => lnHrv(p.night)), { minN: 5, minSpread: 0.05 });
  const bTemp = baseline(nightsWith((p) => p.night?.temp?.median), { minN: 5, minSpread: 0.15 });
  const n = Math.max(bRhr?.n ?? 0, bTemp?.n ?? 0);
  const parts = [];
  const rhr = night.hr?.rhr;
  if (rhr != null && bRhr) {
    const zz = z(rhr, bRhr);
    parts.push(part("rhr", "Resting heart rate", clamp((2.5 - zz) / 4), 30, rhr, `Your usual ${bRhr.center.toFixed(0)} bpm`));
  }
  const lh = lnHrv(night);
  if (lh != null && bHrv) {
    const zz = z(lh, bHrv);
    parts.push(part("hrv", "Overnight HRV", clamp((zz + 2.5) / 4), 30, Math.exp(lh), `Your usual ${Math.exp(bHrv.center).toFixed(0)} ms`));
  }
  const temp = night.temp?.median;
  if (temp != null && bTemp) {
    const dev = temp - bTemp.center;
    parts.push(part("temp", "Temperature", clamp(1 - (dev - 0.2) / 0.6), 15, dev, "Warmer than usual can mean illness, alcohol or a warm room"));
  }
  if (sleep) parts.push(part("sleep", "Sleep", sleep.score / 100, 25, sleep.score, "Tonight's sleep score"));
  const ready = !!(bRhr || bTemp) && parts.length >= 2;
  return { score: ready ? total(parts) : null, parts, ready, nights: n, need: 5 };
}

/** Daily step goal by age, from the steps-vs-mortality curve (Paluch 2022): benefit levels off
 *  around 6,000-8,000/day at 60+ and 8,000-10,000 under 60. */
export const stepGoal = (age) => (age >= 60 ? 7000 : 8000);

/**
 * Activity: steps vs the age-based goal (60), moderate-to-vigorous minutes vs 22/day, i.e.
 * 150/week (WHO 2020) (40). MVPA counts brisk-walking 10-minute bins (≥ 100 steps/min) plus
 * workout minutes detected from heart rate (so lifting and cycling count).
 */
export function activityScore(day, profile = {}) {
  if (!day) return null;
  const goal = profile.step_goal || stepGoal(profile.age ?? 40);
  const steps = day.steps ?? 0;
  const workoutMin = (day.workouts ?? []).reduce((s, w) => s + w.minutes, 0);
  const mvpa = Math.max(day.activity?.mvpa_min ?? 0, workoutMin);
  const parts = [
    part("steps", "Steps", clamp(steps / goal), 60, steps, `Goal ${goal.toLocaleString()} for your age`),
    part("mvpa", "Active minutes", clamp(mvpa / 22), 40, mvpa, "22 a day adds up to the recommended 150 a week"),
  ];
  return { score: total(parts), parts, ready: true, goal, mvpa };
}

/**
 * Illness early warning. NightSignal (Alavi et al. 2022, Nat Med): average overnight heart rate vs the
 * running median of your previous nights; yellow at ≥ 3 bpm above, red at ≥ 4 bpm above two nights in
 * a row (80% sensitivity, 87.7% specificity for COVID-19, alerts ~3 days before symptoms). Heart rate
 * alone also fires for alcohol, travel, stress and poor sleep (~1 alert per 3 weeks in healthy people),
 * so we only *show* an alert when temperature or disrupted sleep agrees (Natarajan 2020; Quer 2021).
 */
export function illnessSignal(night, prevNight, prior) {
  const hr = night?.hr?.mean;
  const base = median(prior.map((p) => p.night?.hr?.mean));
  const n = prior.filter((p) => p.night?.hr?.mean != null).length;
  if (hr == null || base == null || n < 7) return { level: "none", ready: false, nights: n, need: 7 };
  const d = hr - base;
  const dPrev = prevNight?.hr?.mean != null ? prevNight.hr.mean - base : null;
  const raw = d >= 4 && dPrev != null && dPrev >= 4 ? "red" : d >= 3 ? "yellow" : "none";
  const tBase = median(prior.map((p) => p.night?.temp?.median));
  const tempDev = night.temp?.median != null && tBase != null ? night.temp.median - tBase : null;
  const effBase = median(prior.map((p) => p.night?.sleep?.efficiency));
  const wakeBase = median(prior.map((p) => p.night?.sleep?.awakenings));
  const s = night.sleep;
  const disrupted = s && effBase != null && (s.efficiency < effBase - 5 || s.awakenings > (wakeBase ?? 0) + 3);
  const warm = tempDev != null && tempDev >= 0.3;
  // Breathing rate is very stable asleep; ~1+ breaths/min above usual accompanies infection (Miller 2021).
  const rBase = median(prior.map((p) => p.night?.resp?.rate));
  const fastBreathing = night.resp?.rate != null && rBase != null && night.resp.rate - rBase >= 1.5;
  const corroborated = warm || !!disrupted || fastBreathing;
  const level = raw !== "none" && corroborated ? raw : "none";
  const why = [warm && `skin temperature ${tempDev.toFixed(1)} °C above usual`, disrupted && "restless sleep", fastBreathing && "faster breathing than usual"].filter(Boolean).join(" and ");
  const text = level === "red"
    ? `Your heart rate overnight has been ${d.toFixed(0)} bpm above your usual two nights running, with ${why}. Take it easy; if you feel unwell, consider checking in with your doctor.`
    : level === "yellow" ? `Last night your heart rate ran ${d.toFixed(0)} bpm above your usual, with ${why}. Alcohol, a late meal or stress can do this too.` : null;
  return { level, raw, delta: d, tempDev, disrupted: !!disrupted, ready: true, text };
}

/** Adds scores to each summary using the ones before it as baseline. rows sorted by date. */
export function scoreDays(rows, profile = {}) {
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : 1));
  return sorted.map((s, i) => {
    const prior = sorted.slice(Math.max(0, i - 28), i);
    const sleep = sleepScore(s.night, prior, profile);
    const recovery = recoveryScore(s.night, prior, sleep);
    const activity = activityScore(s.day, profile);
    const prevNight = i > 0 && sorted[i - 1].date === prevDay(s.date) ? sorted[i - 1].night : null;
    const illness = illnessSignal(s.night, prevNight, prior);
    return { ...s, scores: { sleep, recovery, activity, illness } };
  });
}

/** One plain-English line for the Today screen. */
export function headline(s, prior) {
  const r = s?.scores?.recovery, sl = s?.scores?.sleep;
  const bits = [];
  if (sl) bits.push(sl.score >= 85 ? "You slept well" : sl.score >= 70 ? "Decent sleep" : "A short or broken night");
  const rhr = r?.parts.find((p) => p.key === "rhr");
  if (rhr) {
    const usual = median(prior.map((p) => p.night?.hr?.rhr));
    const d = rhr.value - usual;
    if (Math.abs(d) >= 2) bits.push(`resting heart rate is ${Math.abs(d).toFixed(0)} bpm ${d < 0 ? "below" : "above"} your usual`);
    else bits.push("resting heart rate is right at your usual");
  }
  const t = r?.parts.find((p) => p.key === "temp");
  if (t && t.value >= 0.5) bits.push("and you're running warm");
  if (!bits.length) return null;
  const line = bits.join(bits.length > 1 && !bits[bits.length - 1].startsWith("and") ? "; " : " ");
  return line.charAt(0).toUpperCase() + line.slice(1) + ".";
}
