// "How to read this": a plain-language guide behind every advanced number. Each guide says what the number is,
// where it sits (a ladder of optimal / borderline / risk zones with your value on it), what moves it and when to
// act. Zones come only from published cut-offs; where none exist (most HRV and wearable-derived measures) the
// guide says so and judges the number against YOUR OWN usual instead. Rows and tiles open a guide with
// data-explain="<key>"; the guide reads the current value itself, so callers pass nothing else.
import { usualRange, HRV_NORM, decade } from "./stats.js?v=20261014195152";
import { advBody } from "./advanced.js?v=20261014195152";
import { analyze, analyzed, current } from "./measure.js?v=20261014195152";
import { bpCategory, bpSummary } from "./bp.js?v=20261014195152";
import { bandDip } from "./bpui.js?v=20261014195152";
import { ANALYTES, bmiOf, labLabel, latestLabs, preventResult } from "./labsui.js?v=20261014195152";
import { LABGUIDE } from "./labguide.js?v=20261014195152";
import { tierChip, whatMoved } from "./riskui.js?v=20261014195152";
import { calibrateAt, Z80 } from "../analytics/bpcal.js?v=20261014195152";
import { bodyIndices } from "../analytics/body.js?v=20261014195152";
import { metabolicSyndrome } from "../analytics/riskctx.js?v=20261014195152";
import { sleepNeed } from "../analytics/sleep.js?v=20261014195152";
import { homeBP, sessions } from "../analytics/homebp.js?v=20261014195152";
import { toMs } from "../core/time.js?v=20261014195152";
import { derived } from "../analytics/labs.js?v=20261014195152";
import { PHENO_AGE_YEARS, PHENO_REF, phenoChange, phenoParts, preventGroups, workings, zonesFor } from "../analytics/labcalc.js?v=20261014195152";
import { preventBreakdown } from "../analytics/prevent.js?v=20261014195152";
import { isUS } from "../core/units.js?v=20261014195152";
import { ampm, clock, css, D, esc, S, sc, tDelta, tUnit } from "./kit.js?v=20261014195152";

const TIER = { good: "Optimal", watch: "Borderline", bad: "Risk" };
const num = (v) => v != null && Number.isFinite(v);
const sex = () => D.profile?.sex ?? null;
const age = () => D.profile?.age ?? null;
const nightH = () => (D.last?.hasNight ? D.last : D.nights?.length ? D.hist[D.nights[D.nights.length - 1]] : null);
const priorNights = (get) => { const h = nightH(), i = h ? D.hist.indexOf(h) : -1; return (i < 0 ? [] : D.hist.slice(0, i)).filter((z) => z.hasNight).map(get); };
const ecgNow = () => { try { return D.ecg?.length ? current() : null; } catch { return null; } };
const ecgPrior = (get) => { const open = ecgNow()?.sn?.t; return (D.ecg ?? []).filter((sn) => sn.t !== open && analyzed(sn)).map((sn) => { const E = analyze(sn); return E.verdict[1] === "short" ? null : get(E); }); };
const f = (v, d = 0) => (num(v) ? v.toFixed(d) : "—");

/** Guide fields
 *  title, xp (experimental badge), unit, fmt(v)
 *  live(): { v, text?, zone? }      the reading right now (v may be null)
 *  scale: [min, max], zones(): [[upperBound, tier, label, note?], …] ascending (last bound Infinity)
 *  soft: zones are orientation only (no validated cut-off for this exact measure), personal judgement leads
 *  personal: { values(), better: 1 | -1 | 0 }   judged against your own usual
 *  calc(): HTML for "How it's calculated": the inputs, the formula and the arithmetic with your own numbers
 *  what, read, moves, act, caveat, cite, adv (key of advanced.js details to append) */
export const GUIDE = {
  // ---------------------------------------------------------------- ECG: shape of the beat
  qtc: {
    title: "QT and QTc", unit: "ms", scale: [320, 540], fmt: (v) => v.toFixed(0),
    live() {
      const b = ecgNow()?.mb;
      if (!num(b?.qtcF)) return { v: null };
      const rr = 1000 * (b.qt_ms / b.qtcF) ** 3;
      return { v: b.qtcF, text: `This recording: QT <b>${f(b.qt_ms)} ms</b> with a beat every <b>${f(rr)} ms</b> (${f(60000 / rr)} bpm). Fridericia QTc <b>${f(b.qtcF)} ms</b>${num(b.qtcB) ? `; Bazett would give <b>${f(b.qtcB)} ms</b>` : ""}.` };
    },
    zones: () => (sex() === "female"
      ? [[350, "watch", "Short", "Unusual; on a one-lead finger ECG usually a marker error. Recheck."], [450, "good", "Optimal"], [470, "watch", "Borderline"], [500, "bad", "Prolonged"], [Infinity, "bad", "High risk", "Over 500 ms is where dangerous rhythm trouble becomes a concern."]]
      : [[350, "watch", "Short", "Unusual; on a one-lead finger ECG usually a marker error. Recheck."], [430, "good", "Optimal"], [450, "watch", "Borderline"], [500, "bad", "Prolonged"], [Infinity, "bad", "High risk", "Over 500 ms is where dangerous rhythm trouble becomes a concern."]]),
    what: "<b>QT</b> is the time, in milliseconds, from the start of the Q wave to the end of the T wave: how long the lower chambers take to fire and then electrically reset. The heart resets faster when it beats faster, so a raw QT is only meaningful beside a heart rate; the same heart gives a shorter QT at 90 bpm than at 55. <b>QTc</b> is QT corrected to what it would be at 60 bpm, so recordings at different heart rates can be compared. Pulse uses <b>Fridericia</b> (QT ÷ ∛RR). The older <b>Bazett</b> formula (QT ÷ √RR) over-corrects when the heart is fast, making QTc look longer than it is, which is why the two can disagree by 10–20 ms.",
    read: "The zones are for QTc in adults (women run about 20 ms longer, so Pulse uses the set for the sex in your profile). More useful than any single number is <b>change from your own baseline</b>: a rise of more than 60 ms, or a QTc over 500 ms, is the point where clinicians act. Below about 340 ms is the range used to suspect short-QT syndrome, but on a one-lead recording a very short QT is far more likely a marker slip.",
    moves: "QT-prolonging medicines (some antibiotics, antidepressants, antipsychotics and anti-nausea drugs), low potassium, magnesium or calcium (vomiting, diarrhea, some diuretics), some inherited conditions, and slow heart rates. Time of day and a recent large meal can shift it by 10–20 ms.",
    act: "QTc over 500 ms on repeated seated recordings, or any QTc concern together with fainting, near-fainting or palpitations: see a clinician soon and ask for a 12-lead ECG. Never stop a prescribed medicine because of this number alone.",
    caveat: "A one-lead finger ECG is not a 12-lead. The end of the T wave is the hardest point to find and Pulse's marker can be off by 20 ms or more. Trust the median of several seated recordings, and the change from your own baseline, over any one reading.",
    cite: "Bands: Goldenberg, J Electrocardiol 2006. Fridericia vs Bazett: Luo, J Electrocardiol 2004. >500 ms or +60 ms: Drew, Circulation 2010. Short QT: Priori, Eur Heart J 2015.",
  },
  qrs: {
    title: "QRS width", unit: "ms", scale: [60, 160], fmt: (v) => v.toFixed(0),
    live: () => ({ v: ecgNow()?.mb?.qrs_ms ?? null }),
    zones: () => [[100, "good", "Typical"], [120, "watch", "Mildly widened", "Often harmless; can be a partial bundle-branch pattern."], [Infinity, "bad", "Wide", "A wide QRS means the signal is spreading through the lower chambers more slowly than normal."]],
    what: "The QRS is the sharp spike of each beat: the electrical wave spreading through the lower chambers. Its width is how many milliseconds that takes, measured from the start of Q to the end of the spike (J point). A healthy heart conducts quickly along its own wiring, so the spike is narrow.",
    read: "Under 100 ms is typical. 100–119 ms is borderline and frequently normal. 120 ms or more is called a wide QRS (bundle-branch block or another conduction delay). A wide QRS can be a lifelong quirk, but it is new information worth a 12-lead ECG, especially with breathlessness, fainting or chest symptoms.",
    moves: "Bundle-branch block, some heart-muscle conditions, certain medicines and high potassium. It barely changes beat to beat, so a stable value across your recordings is expected.",
    act: "If it is 120 ms or more on repeated recordings and you did not know, mention it at your next appointment; with fainting or breathlessness, sooner.",
    caveat: "Both edges are found from the slope of a finger-lead signal that has been filtered, so expect an error of around 10 ms. Treat a one-off reading as an estimate.",
    cite: "AHA/ACCF/HRS ECG standardization Part III, Surawicz, JACC 2009 (wide QRS ≥120 ms).",
  },
  amp: {
    title: "R and T height", unit: "mV", fmt: (v) => v.toFixed(2),
    live: () => { const b = ecgNow()?.mb; return { v: null, text: b?.template ? `This recording: R <b>${f(b.rAmp, 2)} mV</b>, T <b>${f(b.tAmp, 2)} mV</b>.` : "" }; },
    what: "R height is the peak of the main spike; T height is the peak of the slower wave after it. They are measured on the average beat, in millivolts.",
    read: "There is no good or bad range, because the size of a finger-lead trace depends on how the electrodes touch your skin and on filtering, not just your heart. A 12-lead ECG measures amplitude very differently. These two numbers are here so you can see whether the markers for QRS and QT sit on real peaks; a very small T wave makes QT harder to measure.",
    moves: "Finger pressure, dry or cold skin, posture and breathing.",
    caveat: "Do not compare these with the millivolt values on a clinical 12-lead ECG, and do not compare recordings made with very different pressure.",
  },
  // ---------------------------------------------------------------- ECG: rhythm and variability
  irreg: {
    title: "Irregularity screen", unit: "", scale: [0, 0.3], fmt: (v) => v.toFixed(3),
    live() {
      const h = ecgNow()?.s?.hrv;
      if (!h) return { v: null };
      return { v: h.nrmssd, text: `This recording: normalised RMSSD <b>${h.nrmssd.toFixed(3)}</b>, entropy <b>${h.shannon.toFixed(2)}</b>, turning points <b>${h.tpr.toFixed(2)}</b>. ${h.irregular ? "Both flags tripped." : "Not flagged."}` };
    },
    zones: () => [[0.1, "good", "Regular"], [Infinity, "watch", "Beat intervals vary a lot", "Only flagged as irregular when the entropy measure agrees (above 0.7)."]],
    what: "A quick check on whether the gaps between beats look like a steady rhythm. <b>Normalised RMSSD</b> is the beat-to-beat change divided by the average gap, so it does not depend on heart rate. <b>Entropy</b> measures how scattered the gaps are, and <b>turning points</b> is how often the gaps flip from lengthening to shortening (completely random intervals flip about two-thirds of the time). Pulse flags an irregular rhythm only when normalised RMSSD is above 0.1 <i>and</i> entropy is above 0.7.",
    read: "An irregular result does not mean atrial fibrillation. A few early beats (very common and usually harmless), movement, or a poor contact produce the same pattern. Repeat the check seated, forearms resting, finger light on the plate. A single irregular result with no symptoms is a reason to retest; repeated irregular results are a reason to show your recordings to a clinician.",
    moves: "Early beats (ectopics), atrial fibrillation, strong breathing waves in young people, caffeine, movement and a loose finger.",
    act: "Repeated irregular results, or any irregular result with palpitations, dizziness, chest discomfort or breathlessness: contact a clinician. Chest pain, fainting or severe breathlessness: call emergency services.",
    caveat: "This is a screening check, not a diagnosis. Phone-style single-lead screens catch most atrial fibrillation in studies but also flag harmless early beats.",
    cite: "Dash, Ann Biomed Eng 2009 (RMSSD/mean, Shannon entropy, turning-point rate for atrial-fibrillation screening).",
  },
  ecg_hr: {
    title: "Heart rate (rhythm check)", unit: "bpm", scale: [35, 130], fmt: (v) => v.toFixed(0),
    live: () => ({ v: ecgNow()?.s?.hrv?.hr ?? null }),
    zones: () => [[50, "watch", "Slow", "Normal in well-trained people. With dizziness or fainting, see a clinician."], [75, "good", "Optimal"], [100, "watch", "Higher than ideal"], [Infinity, "bad", "Fast", "Above 100 bpm while seated and rested."]],
    what: "Your average heart rate across the recording, taken seated and awake, with the finger on the plate.",
    read: "The standard adult resting range is 60–100 bpm. Large studies show the risk of dying climbs steadily with resting rate (about 9% higher per 10 bpm), so lower inside the normal range is generally better provided you feel well, and 50–59 bpm is common in fit people. A rhythm check usually runs 5–15 bpm above your overnight resting heart rate (you just sat down, caffeine, nerves), so compare it with your own earlier checks, not with the sleep number.",
    moves: "Fitness (lowers it), caffeine, nicotine, dehydration, fever, anxiety, thyroid problems, anaemia, some medicines (beta-blockers lower it).",
    act: "Seated heart rate over 100 bpm that does not settle after five minutes, or under 50 bpm with dizziness or fainting: tell a clinician.",
    caveat: "Pulse can only classify the rhythm between 50 and 120 bpm; outside that the result is shown as inconclusive.",
    cite: "AHA normal range 60–100 bpm; Zhang, CMAJ 2016 (resting heart rate and mortality).",
    personal: { values: () => ecgPrior((E) => E.s?.hrv?.hr), better: -1 },
  },
  rmssd: {
    title: "HRV from the rhythm check (RMSSD)", unit: "ms", fmt: (v) => v.toFixed(0),
    live: () => ({ v: ecgNow()?.s?.hrv?.rmssd ?? null }),
    what: "RMSSD is the typical beat-to-beat change in the gap between heartbeats: the square root of the average squared difference between neighbouring gaps. It mostly reflects the vagus nerve slowing and releasing the heart with each breath, the part of your nervous system that handles rest and recovery.",
    read: "There is no cut-off that separates healthy from unhealthy. Adults at rest in 5-minute recordings average about 40 ms with a spread of roughly 15 ms either way, and it falls with age, so a 60-year-old and a 25-year-old are not comparable. Read it against your own earlier checks: same time of day, seated, before coffee. A sustained drop of more than one usual swing is the signal; a single low day is noise. Very high values can also come from an irregular rhythm, which inflates RMSSD, so read it together with the rhythm result.",
    moves: "Higher: fitness, good sleep, calm, slow breathing. Lower: alcohol, poor sleep, illness, stress, overtraining, a recent hard workout, heat, caffeine and dehydration.",
    caveat: "A 30-second window is noisy; 2 minutes is steadier. Seated daytime RMSSD runs lower than your overnight number and the two cannot be compared.",
    cite: "Nunan, Pacing Clin Electrophysiol 2010 (short-term norms); Shaffer & Ginsberg, Front Public Health 2017.",
    personal: { values: () => ecgPrior((E) => E.s?.hrv?.rmssd), better: 1 },
  },
  sdnn: {
    title: "SDNN", unit: "ms", fmt: (v) => v.toFixed(0),
    live: () => ({ v: ecgNow()?.s?.hrv?.sdnn ?? null }),
    what: "SDNN is the overall spread of the gaps between beats: the standard deviation of all of them. Unlike RMSSD it includes slow drifts (breathing, blood-pressure waves, the heart rate settling), so it grows with recording length.",
    read: "The well-known cut-offs (under 50 ms high risk, 50–100 ms compromised, over 100 ms healthy) are for <b>24-hour</b> recordings and do not apply to a 1–2 minute check. For a short seated recording adults average about 50 ms with a spread of roughly 16 ms. Compare it only with your own recordings of the same length.",
    moves: "The same things as RMSSD, plus how long you record: a 2-minute check will read higher than a 1-minute one.",
    caveat: "Pulse shows SDNN only for recordings of a minute or more.",
    cite: "Kleiger, Am J Cardiol 1987 and Task Force, Circulation 1996 (24-hour SDNN); Nunan 2010 (short-term norms).",
    personal: { values: () => ecgPrior((E) => (E.dur >= 60 ? E.s?.hrv?.sdnn : null)), better: 1 },
  },
  pnn50: {
    title: "pNN50", unit: "%", fmt: (v) => v.toFixed(1),
    live: () => ({ v: ecgNow()?.dur >= 60 ? ecgNow()?.s?.hrv?.pnn50 ?? null : null }),
    what: "The share of neighbouring beat gaps that differ by more than 50 ms. It is a coarser cousin of RMSSD: both measure quick beat-to-beat change, but pNN50 only counts the big jumps.",
    read: "No validated healthy range. It is strongly age dependent (it falls quickly through the decades and is often near zero in older adults, which is normal), and it is 0% for many athletes' fast heart rates. Use RMSSD as the main number; pNN50 is a cross-check that moves with it.",
    moves: "The same things as RMSSD.",
    personal: { values: () => ecgPrior((E) => (E.dur >= 60 ? E.s?.hrv?.pnn50 : null)), better: 1 },
  },
  cvnn: {
    title: "CVNN", unit: "%", fmt: (v) => v.toFixed(1),
    live: () => ({ v: ecgNow()?.adv?.cvnn ?? null }),
    what: "SDNN divided by the average gap between beats, as a percentage. Because it is a ratio, a slower and a faster heart can be compared fairly, which plain SDNN cannot do.",
    read: "No validated healthy range; use it to compare recordings made at different heart rates, and judge it against your own history.",
    personal: { values: () => ecgPrior((E) => E.adv?.cvnn), better: 1 },
  },
  baevsky: {
    title: "Baevsky stress index", unit: "", scale: [0, 900], fmt: (v) => v.toFixed(0), soft: true,
    live: () => ({ v: ecgNow()?.s?.hrv?.stress_index ?? null }),
    zones: () => [[150, "good", "Relaxed", "50–150 at rest in the original work."], [500, "watch", "Loaded", "Seen with effort, tiredness or ageing."], [Infinity, "bad", "Strained", "500–900 was reported with psychological overload."]],
    what: "A measure from Russian space medicine of how concentrated your beat gaps are. If almost every gap is the same length, your heart is being held to a steady pace by the sympathetic (\"fight or flight\") side and the index is high; if the gaps spread out, it is low. It is calculated as the share of beats at the most common gap, divided by twice that gap (in seconds) times the range of gaps.",
    read: "The orientation bands come from the original literature, which used 5-minute recordings. A 30-second seated check with few beats tends to read higher, so the bands are a rough guide, and the number is much more useful as a trend in your own recordings. A lower value over weeks generally means more relaxed, more variable beats.",
    moves: "Higher: stress, effort, poor sleep, caffeine, nerves about the test itself. Lower: calm, slow breathing, recovery.",
    caveat: "The result depends on how the gaps are binned (Pulse uses 50 ms) and on recording length, so values are not comparable with other apps.",
    cite: "Baevsky & Chernikova, Cardiometry 2017.",
    personal: { values: () => ecgPrior((E) => E.s?.hrv?.stress_index), better: -1 },
  },
  spectrum: {
    title: "Rhythm spectrum (LF, HF, LF/HF)", unit: "", fmt: (v) => v.toFixed(2),
    live() {
      const sp = ecgNow()?.adv?.spectrum;
      return { v: null, text: sp ? `This recording: ln HF <b>${f(sp.lnHf, 2)}</b>, ln LF <b>${f(sp.lnLf, 2)}</b>, LF/HF <b>${f(sp.lfhf, 2)}</b>, HF n.u. <b>${f(sp.hfnu)}</b>${sp.hfPeak ? `, HF peak <b>${f(sp.hfPeak * 60, 1)}/min</b>` : ""}.` : "" };
    },
    what: "The beat gaps are a wave, and this splits the wave by speed. <b>HF</b> (0.15–0.4 Hz, a wave every 2.5–7 seconds) is your breathing: the heart speeds up as you breathe in and slows as you breathe out. <b>LF</b> (0.04–0.15 Hz) is slower waves, partly from blood-pressure control. <b>ln</b> is the natural log of the power, which keeps the numbers manageable. <b>HF n.u.</b> is HF as a share of HF plus LF. The <b>HF peak</b> is the breathing rate in breaths per minute.",
    read: "No cut-offs separate healthy from unhealthy. Adults at rest average an LF/HF near 2–3 with a very wide spread. <b>LF/HF is not a reliable \"stress balance\" meter</b>: LF is not a pure sympathetic signal, and slow breathing changes all of it. Use HF as the breathing-linked, rest-and-recover part of variability, and judge everything against your own seated recordings at the same breathing pace.",
    moves: "Slow, deep breathing raises HF and moves energy into it. Posture, caffeine, stress and recording length all matter.",
    caveat: "HF needs about a minute of clean beats and LF about two. Pulse shows these only when the recording is long enough.",
    cite: "Task Force, Circulation 1996; Billman, Front Physiol 2013 (LF/HF); Baek, Physiol Meas 2015 (minimum lengths).",
  },
  poincare: {
    title: "Poincaré plot (SD1, SD2, CSI, CVI)", unit: "", fmt: (v) => v.toFixed(1),
    live() {
      const p = ecgNow()?.adv?.poincare;
      return { v: null, text: p ? `This recording: SD1 <b>${f(p.sd1, 1)} ms</b>, SD2 <b>${f(p.sd2, 1)} ms</b>, SD1/SD2 <b>${f(p.ratio, 2)}</b>.` : "" };
    },
    what: "Each beat gap is plotted against the next one. A calm, healthy rhythm makes an ellipse along the diagonal. <b>SD1</b> is the width of the ellipse (quick beat-to-beat change; mathematically SD1 = RMSSD ÷ 1.41, so it carries the same information as RMSSD). <b>SD2</b> is its length (slower drift). <b>SD1/SD2</b> is how round the cloud is, and <b>CSI</b> (SD2 ÷ SD1) and <b>CVI</b> are the same shape expressed other ways. <b>Ellipse area</b> is SD1 × SD2 × π.",
    read: "No validated healthy ranges. A fatter, rounder cloud means more beat-to-beat variability; a thin diagonal streak means the beats are very similar. Scattered islands of dots away from the cloud usually mean early beats or noise. Compare it with your own plots.",
    personal: { values: () => ecgPrior((E) => E.adv?.poincare?.sd1), better: 1 },
  },
  dfa: {
    title: "DFA α1", unit: "", scale: [0.3, 1.7], fmt: (v) => v.toFixed(2), soft: true,
    live: () => ({ v: ecgNow()?.adv?.dfa1 ?? null }),
    zones: () => [[0.5, "bad", "Random-like", "Beat intervals have lost their pattern."], [0.75, "watch", "Reduced"], [1.25, "good", "Typical at rest"], [Infinity, "watch", "Very rigid", "Unusually regular, often a very slow or paced rhythm."]],
    what: "Healthy heart rhythm has a pattern that repeats at every time scale (fractal correlation): a slow beat is more likely to be followed by another slow one. DFA α1 measures how strong that pattern is over windows of 4–16 beats. It is about 1.0 at healthy rest, falls toward 0.5 when the pattern disappears (random beats), and above 1.5 means a very smooth, rigid rhythm.",
    read: "The bands are for resting recordings. In people recovering from a heart attack, an α1 below 0.75 predicted death better than the usual HRV numbers. In exercise physiology 0.75 and 0.5 mark the aerobic and anaerobic thresholds. Neither of those is a verdict on a healthy person's seated check: effort, early beats, stress and a short or noisy window all drive α1 down. Treat it as a pattern to follow in your own recordings.",
    moves: "Lower: exertion, early beats, noise, stress, illness. Higher: calm, slow paced breathing.",
    caveat: "Needs about 2 minutes of clean beats to be stable; Pulse hides it on shorter recordings.",
    cite: "Peng, Chaos 1995; Huikuri, Circulation 2000 (post-MI); Rogers & Gronwald, Front Physiol 2022 (thresholds in exercise).",
    personal: { values: () => ecgPrior((E) => E.adv?.dfa1), better: 0 },
  },
  sampen: {
    title: "Sample entropy", unit: "", scale: [0, 3], fmt: (v) => v.toFixed(2), soft: true,
    live: () => ({ v: ecgNow()?.adv?.sampen ?? null }),
    zones: () => [[1, "watch", "Very regular"], [2.2, "good", "Typical"], [Infinity, "watch", "Very unpredictable"]],
    what: "How hard the next beat gap is to predict from the last few. A low value means the rhythm repeats itself closely; a high value means it is irregular and surprising. It is a measure of complexity, not of how fast or how variable the heart is.",
    read: "Both extremes are less healthy: too regular can mean a stiff, low-variability rhythm, and too unpredictable usually means early beats, atrial fibrillation or noise. The middle band is a rough orientation from resting recordings, and the value depends on the analysis settings, so it is not comparable with other apps. Follow your own trend.",
    caveat: "Needs about 2 minutes of clean beats.",
    cite: "Richman & Moorman, Am J Physiol 2000.",
    personal: { values: () => ecgPrior((E) => E.adv?.sampen), better: 0 },
  },
  pip: {
    title: "Heart-rhythm fragmentation (PIP)", unit: "%", fmt: (v) => v.toFixed(0),
    live: () => ({ v: ecgNow()?.adv?.fragmentation?.pip ?? null }),
    what: "The percentage of beats where the rhythm changes direction (speeding up, then slowing down, or the reverse) instead of drifting smoothly. A very choppy rhythm has a high percentage.",
    read: "No validated cut-off. Higher fragmentation has been seen with older age and heart disease in research, because a healthy rhythm drifts in longer sweeps. Short recordings and early beats push it up. Use it only as a trend within your own recordings.",
    cite: "Costa, Front Physiol 2017.",
    personal: { values: () => ecgPrior((E) => E.adv?.fragmentation?.pip), better: -1 },
  },
  edr: {
    title: "Breathing from the ECG", unit: "/min", scale: [6, 30], fmt: (v) => v.toFixed(1),
    live() { const E = ecgNow(); return { v: E?.edrOk ? E.edr.rate : null }; },
    zones: () => [[12, "watch", "Slow", "Normal during slow-breathing practice; unusual otherwise."], [17, "good", "Optimal"], [21, "watch", "Upper normal"], [Infinity, "bad", "Fast", "Above 20 breaths a minute at rest."]],
    what: "Each breath leaves three marks on the ECG: the beat timing speeds and slows, the R wave gets taller and shorter, and the QRS steepness changes. Pulse reads all three, scores each by how clear its rhythm is, and takes their weighted median, so one noisy signal cannot drag the answer.",
    read: "Adults at rest breathe 12–20 times a minute. Seated and awake in a check, 12–16 is typical. Counting your breaths consciously changes them, so try to breathe naturally. Fast breathing at rest is an early sign of fever, infection, anxiety, or heart or lung trouble.",
    caveat: "Needs about a minute of clean beats and agreement between the three signals; Pulse shows no rate when they disagree.",
    cite: "Charlton, Physiol Meas 2016; Cretikos, Med J Aust 2008 (normal range).",
    personal: { values: () => ecgPrior((E) => (E.edrOk ? E.edr.rate : null)), better: 0 },
  },
  beats: {
    title: "Beats averaged", unit: "", fmt: (v) => v.toFixed(0),
    live: () => ({ v: ecgNow()?.mb?.beats ?? null }),
    what: "How many clean, aligned beats were stacked to make the average beat shape. Stacking cancels random noise, so more beats give smoother edges and steadier QRS and QT markers.",
    read: "There is no pass mark. A 30-second recording averages about 25–40 beats and a 2-minute one about four times that. If the average beat looks ragged or the QT jumps between recordings, a longer recording usually fixes it.",
  },
  quality: {
    title: "Clean beats", unit: "%", scale: [0, 100], fmt: (v) => v.toFixed(0),
    live() { const E = ecgNow(); return { v: E?.s ? E.s.quality * 100 : null }; },
    zones: () => [[70, "bad", "Too noisy", "Pulse will not read the rhythm below 70%."], [Infinity, "good", "Readable"]],
    what: "The share of detected beats that matched the others closely enough to trust. Beats that look odd (early beats, movement, a slipped finger) are set aside and left out of the HRV and QT numbers.",
    read: "At 70% or more Pulse reads the rhythm. Higher is steadier, but a low-ish value is normal if you have many early beats. Rest your forearms on a table, touch the plate lightly and stay quiet to raise it.",
  },
  // ---------------------------------------------------------------- overnight vitals
  rhr: {
    title: "Resting heart rate (asleep)", unit: "bpm", scale: [38, 100], fmt: (v) => v.toFixed(0),
    calc() {
      const h = nightH(), hr = h?.summary?.night?.hr;
      if (!hr?.rhr) return "<p>Needs a night with heart rate.</p>";
      return worked([`lowest 30-minute average between ${h.fallback ? "midnight and 6 AM (no sleep record that night)" : "falling asleep and waking"} = ${hr.rhr.toFixed(1)} bpm`, ...(h.rhrTime ? [`reached ${ampm(+h.rhrTime.slice(11, 13) * 60 + +h.rhrTime.slice(14, 16))}${h.nadirFrac != null ? `, ${Math.round(h.nadirFrac * 100)}% of the way through your sleep` : ""}`] : []), ...(hr.mean != null ? [`for comparison, your average while asleep: ${hr.mean.toFixed(1)} bpm`] : [])])
        + `<p class="calc-n">A heart rate that bottoms out early in the night is typical of good recovery; a late low point often follows alcohol, a late meal or late exercise.</p>`;
    },
    live: () => ({ v: nightH()?.rhr ?? null }),
    zones: () => [[40, "watch", "Very low", "Fine in endurance athletes; with dizziness or fainting, ask a clinician."], [70, "good", "Optimal"], [80, "watch", "Higher than ideal"], [Infinity, "bad", "High"]],
    what: "Your lowest steady heart rate while asleep: the lowest 30-minute average between falling asleep and waking (midnight to 6 AM on a night the band has no sleep record). It is the cleanest daily read of how hard your heart works at rest, and it is stable enough that small changes mean something.",
    read: "A lower resting rate generally goes with better fitness and lower mortality (about 9% higher all-cause mortality per 10 bpm in large studies), within the healthy range. What matters most is <b>your own baseline</b>: a rise of 3 bpm over your usual for a night, or 4 bpm two nights running, is the pattern behind Pulse's illness watch. Falling slowly over months usually tracks improving fitness.",
    moves: "Lower: aerobic fitness, good sleep, cool room. Higher: alcohol (strongly), late meals, late hard exercise, fever and infection, stress, dehydration, heat, poor sleep, caffeine, some medicines; in the second half of the menstrual cycle it runs about 2 bpm higher.",
    act: "A resting rate that stays 10 or more bpm above your usual for several days without an obvious reason, especially with fever, breathlessness or chest discomfort, is worth a call.",
    caveat: "A wrist sensor at night reads close to a chest strap in most people, but movement and a loose band add error. The zones are population ranges, not your personal target.",
    cite: "Zhang, CMAJ 2016; Alavi, Nat Med 2022 (illness watch pattern).",
    personal: { values: () => priorNights((h) => h.rhr), better: -1 },
  },
  rhrtrend: {
    title: "Resting heart rate trend", unit: "bpm/mo", fmt: (v) => v.toFixed(1),
    calc() {
      const r = D.hist.slice(-30).map((z, i) => [i, z.rhr]).filter((p) => p[1] != null);
      if (r.length < 10) return "<p>Needs 10 nights in the last 30.</p>";
      const n = r.length, mx = r.reduce((a, p) => a + p[0], 0) / n, my = r.reduce((a, p) => a + p[1], 0) / n, sxx = r.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
      const b = r.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / sxx, se = Math.sqrt(r.reduce((a, p) => a + (p[1] - (my + b * (p[0] - mx))) ** 2, 0) / (n - 2) / sxx);
      return formula("slope = Σ(day − mean day)(RHR − mean RHR) ÷ Σ(day − mean day)²")
        + worked([`${n} nights, average ${my.toFixed(1)} bpm`, `slope ${b >= 0 ? "+" : "−"}${Math.abs(b).toFixed(3)} bpm a night × 30 = ${b >= 0 ? "+" : "−"}${Math.abs(b * 30).toFixed(1)} bpm a month`, `95% range ±${(1.96 * se * 30).toFixed(1)} bpm a month`])
        + `<p class="calc-n">${Math.abs(b * 30) < 1.96 * se * 30 ? "The range crosses zero, so this isn't a real trend yet." : "The range doesn't cross zero, so the trend is more than night-to-night noise."}</p>`;
    },
    live() {
      const r = D.hist.slice(-30).map((z, i) => [i, z.rhr]).filter((p) => p[1] != null);
      if (r.length < 10) return { v: null };
      const n = r.length, mx = r.reduce((a, p) => a + p[0], 0) / n, my = r.reduce((a, p) => a + p[1], 0) / n;
      const b = r.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / r.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
      return { v: b * 30, text: `Over the last ${n} nights your resting heart rate has moved <b>${(b * 30 > 0 ? "+" : "") + (b * 30).toFixed(1)} bpm</b> per month.` };
    },
    what: "The slope of a straight line through your last 30 nights of resting heart rate, expressed per month, with the uncertainty of that slope.",
    read: "Falling by 1–3 bpm over a few months is typical when fitness improves. Rising steadily without a reason (more stress, less sleep, more alcohol, less training, a new medicine, or illness building) is worth noticing. There is no good or bad number; if the uncertainty is larger than the slope, the trend is not real yet. Illness, travel and alcohol cause short spikes, so look at months, not days.",
    moves: "Training status, weight change, sleep, alcohol, stress, season, medicines and illness.",
  },
  hrv: {
    title: "Overnight HRV (RMSSD)", unit: "ms", fmt: (v) => v.toFixed(0),
    calc() {
      const h = nightH();
      if (h?.hrv == null) return "<p>Needs a night with the band's pulse-interval recordings.</p>";
      return formula("RMSSD = √(average of (gap − previous gap)²) over each ~80-second pulse recording")
        + worked(h.hrvSrc === "ppi" ? [`${h.hrvOf} pulse recordings overnight; ${h.hrvN} clean enough to use (movement and dropped beats rejected)`, `median RMSSD across them = ${h.hrv.toFixed(1)} ms`] : [`the band's own HRV estimate (median of ${h.hrvN} readings) = ${h.hrv.toFixed(1)} ms`, "Pulse's own calculation needs the band's pulse-interval recordings, which weren't available for this night"]);
    },
    get scale() { const n = HRV_NORM[decade(age())]; return [0, Math.round(n[1] * 1.7)]; },
    live: () => ({ v: nightH()?.hrv ?? null }),
    zones() { const n = HRV_NORM[decade(age())]; return [[n[0], "watch", "Below typical for your age"], [n[1], "good", "Typical for your age"], [Infinity, "good", "Above typical", "Common in younger or very fit people, but see the note on irregular rhythm below."]]; },
    soft: true,
    what: "The overnight beat-to-beat variability of your heart (RMSSD, in ms), measured from the band's pulse recordings while you sleep. It mostly reflects your vagus nerve, the rest-and-recover side of your nervous system, so it is the most sensitive everyday signal of how well you have recovered.",
    read: "The bands are rough age-group ranges (median ± about one spread) from published adult samples, shown for orientation only; wrist overnight HRV differs from a chest-strap or morning measurement. No clinical cut-off separates healthy from unhealthy. What counts is <b>your own trend</b>: a drop of more than one usual swing for several nights means your body is under strain (illness coming, alcohol, poor sleep, hard training, stress). Pulse also compares it with what that night's sleep length predicts. A very high reading is not automatically good: an irregular rhythm inflates HRV.",
    moves: "Higher: fitness, good and consistent sleep, calm evenings. Lower: alcohol (strongly), late meals, late hard exercise, short sleep, illness, stress, heat, dehydration.",
    caveat: "Values are not comparable between devices, between wrist and strap, or between overnight and daytime spot checks.",
    cite: "Nunan 2010; Voss 2015; Shaffer & Ginsberg 2017. Age bands are approximate.",
    personal: { values: () => priorNights((h) => h.hrv), better: 1 },
  },
  breath: {
    title: "Breathing rate (asleep)", unit: "/min", scale: [8, 26], fmt: (v) => v.toFixed(1),
    calc() {
      const h = nightH(), r = h?.summary?.night?.resp;
      if (h?.br == null) return "<p>Needs a night with the band's pulse-interval recordings.</p>";
      return worked([`each clean ~80-second pulse recording: the strongest rhythm in the beat-to-beat gaps between 9 and 30 a minute (your breathing speeds and slows the heart)`, `median across ${r?.n ?? "the"} recordings with a clear rhythm (3 needed) = ${h.br.toFixed(1)} breaths a minute`]);
    },
    live: () => ({ v: nightH()?.br ?? null }),
    zones: () => [[12, "watch", "Slow"], [17, "good", "Optimal"], [21, "watch", "Upper normal"], [Infinity, "bad", "Fast", "Above 20 breaths a minute at rest."]],
    what: "How many breaths you take per minute while asleep, estimated from the way your pulse speeds and slows with each breath (respiratory sinus arrhythmia) in the band's overnight recordings.",
    read: "Adults at rest take 12–20 breaths a minute, and asleep most settle at 12–16. It is a very steady personal number, so a rise of 1–2 per minute over your usual is meaningful: breathing rate is one of the earliest changes with infection, fever and fluid in the lungs. A rate that stays low and steady is normal.",
    moves: "Higher: infection and fever, alcohol, a stuffy nose, altitude, stress, sleep apnea, heart or lung problems. Lower: fitness, relaxation.",
    act: "Over 20 per minute asleep for several nights, particularly with breathlessness, fever or a new cough, is worth contacting a clinician about.",
    caveat: "This is an estimate from pulse timing, not airflow, so it cannot detect breathing pauses.",
    cite: "Cretikos, Med J Aust 2008; Charlton 2016.",
    personal: { values: () => priorNights((h) => h.br), better: -1 },
  },
  spo2: {
    title: "Oxygen while asleep", unit: "%", scale: [84, 100], fmt: (v) => v.toFixed(0),
    calc() {
      const h = nightH();
      if (h?.spo2 == null) return "<p>Needs a night with oxygen readings.</p>";
      return worked([`${h.spo2N} spot readings while asleep (one every 10 minutes on Pulse's schedule)`, `median ${h.spo2}%, lowest ${h.spo2Min}%${h.spo2Below90 ? `, ${h.spo2Below90} under 90%` : ""}`]);
    },
    live() { const h = nightH(); return { v: h?.spo2 ?? null, text: h?.spo2Min != null ? `Lowest spot reading <b>${h.spo2Min}%</b>${h.spo2Below90 ? `, with ${h.spo2Below90} reading${h.spo2Below90 > 1 ? "s" : ""} under 90%` : ""}.` : "" }; },
    zones: () => [[90, "bad", "Low", "Sustained readings under 90% are the range clinicians call low oxygen."], [95, "watch", "Borderline", "Low-normal; common at altitude and with some lung conditions."], [Infinity, "good", "Optimal"]],
    what: "The percentage of your blood's oxygen-carrying capacity that is actually loaded with oxygen, read by shining light through the skin of your wrist every ten minutes through the night. The headline is the median; the lowest reading is shown separately.",
    read: "At sea level healthy people sit at 95–100%. Single readings dip a little during the night and that is normal. The pattern matters: a median below 95%, or repeated readings under 90% on several nights, deserves attention. This is a spot reading every ten minutes, so it can show a low night but it cannot count breathing pauses; that needs a sleep study.",
    moves: "Lower: altitude, sleep apnea, lung disease, heavy snoring, a cold or infection, alcohol before bed, cold hands, a loose band. Higher: nothing; 100% is the ceiling.",
    act: "Repeated nights with readings under 90%, loud snoring, gasping or unrefreshing sleep: ask about a sleep study. Low oxygen together with breathlessness or confusion while awake: seek care.",
    caveat: "Optical wrist oximetry is typically off by 2–4 points and worse with movement, cold skin and a loose fit. Pulse oximeters can also overestimate oxygen on darker skin, so a normal reading is less reassuring there.",
    cite: "O'Driscoll, Thorax 2017 (BTS oxygen guideline); Sjoding, N Engl J Med 2020 (skin tone).",
    personal: { values: () => priorNights((h) => h.spo2), better: 1 },
  },
  temp: {
    title: "Skin temperature", unit: "", scale: [-1, 1], fmt: (v) => `${tDelta(v) >= 0 ? "+" : ""}${tDelta(v).toFixed(1)}°`,
    calc() {
      const h = nightH();
      if (h?.tdev == null || h.tempC == null) return "<p>Needs a night with temperature readings and a few earlier nights to compare.</p>";
      const usual = h.tempC - h.tdev, T = (c) => (tUnit() === "°F" ? `${(c * 1.8 + 32).toFixed(1)} °F` : `${c.toFixed(1)} °C`);
      return worked([`last night's median wrist temperature ${T(h.tempC)}`, `minus your usual (median of the previous 28 nights) ${T(usual)}`, `= ${tDelta(h.tdev) >= 0 ? "+" : "−"}${Math.abs(tDelta(h.tdev)).toFixed(2)}${tUnit()}`]);
    },
    live() { const h = nightH(); return { v: h?.tdev ?? null }; },
    zones: () => [[-0.5, "watch", "Cooler than usual", "Often room, bedding or a loose band."], [0.2, "good", "Within your usual swing"], [0.5, "watch", "Warm", "A second warm night in a row is what Pulse flags."], [Infinity, "bad", "Running hot"]],
    what: "Wrist skin temperature overnight, shown as the difference from <i>your own</i> typical night (the median of your previous four weeks). The absolute number depends on the room, the bedding and where the band sits, so only the change is meaningful. It is not core body temperature.",
    read: `Most nights land within about ±0.5 °C of your usual. Pulse flags a night when it runs 0.2 °C or more above your usual two nights running, because wrist temperature rises before many fevers show on a thermometer. Alone it proves nothing: read it with resting heart rate and breathing. Zone limits are in °C and shown in ${tUnit()} here.`,
    moves: "Warmer: infection, ovulation and the second half of the menstrual cycle (about 0.3 °C higher; Pulse does not count that as illness), alcohol, a warm room or heavy bedding, late exercise. Cooler: a cool room, a loose band.",
    act: "Several warm nights with a high resting heart rate and fast breathing: take your temperature with a thermometer, rest, and see a clinician if it persists or you feel unwell.",
    caveat: "Wrist skin temperature tracks core temperature only loosely.",
    cite: "Smarr, Sci Rep 2020 (wearable temperature and fever); Shilaih, Biosci Rep 2018 (cycle).",
    personal: { values: () => priorNights((h) => h.tdev), better: -1 },
  },
  // ---------------------------------------------------------------- sleep and body clock
  sri: {
    title: "Sleep regularity (SRI)", unit: "", scale: [40, 100], fmt: (v) => v.toFixed(0),
    calc() {
      const r = D.advData?.sri;
      if (!r) return "<p>Needs 5 days with sleep records.</p>";
      const share = (r.sri + 100) / 200;
      return formula("SRI = 200 × (share of minutes in the same state as 24 hours later) − 100")
        + worked([`${r.pairs.toLocaleString()} minute pairs, each exactly 24 h apart, over ${r.days} days`, `in the same state (both asleep or both awake): ${(share * 100).toFixed(1)}%`, `200 × ${share.toFixed(3)} − 100 = ${r.sri.toFixed(0)}`])
        + `<p class="calc-n">Asleep or awake for each minute comes from the band's sleep record. Pulse uses your last 14 days.</p>`;
    },
    live: () => ({ v: D.advData?.sri?.sri ?? null }),
    zones: () => [[74, "watch", "Irregular", "The least regular quarter of 60,000 adults."], [86, "good", "Typical"], [Infinity, "good", "Very regular", "The most regular quarter."]],
    what: "The chance that you are in the same state (asleep or awake) at any two moments exactly 24 hours apart, scaled 0–100. 100 means identical every day; about 0 means no pattern at all. Unlike \"hours slept\", it catches shifting bedtimes and weekend catch-up.",
    read: "In 60,000 UK adults the middle half scored about 74–86, and the median was 81. Higher regularity went with lower risk of dying from any cause, heart disease and cancer, more strongly than sleep duration did: the most regular fifth had about 30% lower mortality than the least regular. There is no cliff; the risk eases steadily as regularity rises, so a gain of 5–10 points is worth having.",
    moves: "Lower: late weekends, shift work, travel, variable alarm times, naps at odd times. Higher: the same bedtime and wake time every day, including weekends, and morning light.",
    caveat: "Pulse calculates it from the band's detected sleep, not from wrist movement across 24 hours, so a handful of nights can swing it.",
    cite: "Phillips, Sci Rep 2017 (SRI); Windred, Sleep 2024 (UK Biobank: median 81, IQR 73.8–86.3).",
    personal: { values: () => D.hist.slice(0, -1).map((h) => h.sri7), better: 1 },
  },
  chrono: {
    title: "Social jetlag and chronotype", unit: "min", scale: [0, 180], fmt: (v) => v.toFixed(0),
    calc() {
      const c = D.advData?.chrono;
      if (!c) return "<p>Needs 2 weekend and 3 weekday nights with sleep records.</p>";
      return worked([`mid-sleep on free nights (weekends): ${ampm(c.msf)}, average of ${c.nFree} nights`, `mid-sleep on work nights: ${ampm(c.msw)}, average of ${c.nWork} nights`, `social jetlag = the gap between them = ${Math.round(c.socialJetlag)} min`,
        c.msfsc != null && Math.abs(c.msfsc - c.msf) >= 1 ? `chronotype, corrected for weekend catch-up sleep (free-night mid-sleep minus half the extra sleep you get on free nights compared with your weekly average): ${ampm(c.msfsc)}` : "chronotype: no weekend catch-up sleep to correct for, so it's the free-night mid-sleep"])
        + `<p class="calc-n">Mid-sleep is halfway between falling asleep and waking. Averages are taken around the clock, so 11:30 PM and 12:30 AM average to midnight.</p>`;
    },
    live() { const c = D.advData?.chrono; return { v: c ? c.socialJetlag : null, text: c ? `Your free-day mid-sleep is about <b>${clock(c.msfsc ?? c.msf)}</b>; weekdays run <b>${Math.round(c.socialJetlag)} min</b> off it.` : "" }; },
    zones: () => [[60, "good", "Under 1 hour"], [120, "watch", "1–2 hours"], [Infinity, "bad", "Over 2 hours", "Linked in cohort studies with worse metabolic health."]],
    what: "<b>Chronotype</b> is where your body clock naturally sits: the middle of your sleep on days with no alarm (early \"lark\" or late \"owl\"). <b>Social jetlag</b> is how far your weekday sleep timing is from that natural timing, as if you flew a time zone every Friday and flew back on Monday.",
    read: "Chronotype itself is neither good nor bad; owls are not unhealthy, only mismatched with early schedules. Social jetlag is the part with health consequences: the bigger the gap between weekdays and weekends, the more, on average, in cohort studies, of obesity, poorer blood-sugar control and low mood. Under an hour is small; over two is large. Most people living on an alarm clock have one to two hours.",
    moves: "Early alarms with late nights, weekend lie-ins, shift work. Morning light moves a late clock earlier; evening light and late meals move it later.",
    cite: "Roenneberg, Curr Biol 2012; Wittmann, Chronobiol Int 2006; Roenneberg, J Biol Rhythms 2004 (MCTQ).",
    adv: "chrono",
  },
  rhythm: {
    title: "Daily rhythm strength", unit: "RA", fmt: (v) => v.toFixed(2),
    calc() {
      const r = D.advData?.hrRhythm;
      if (!r) return "<p>Needs 3 days of all-day heart rate.</p>";
      const m = r.m10.value, l = r.l5.value;
      return formula("RA = (M10 − L5) ÷ (M10 + L5)")
        + worked([`M10, your busiest 10 hours (from ${ampm(r.m10.start * 60)}): ${m.toFixed(1)} bpm`, `L5, your quietest 5 hours (from ${ampm(r.l5.start * 60)}): ${l.toFixed(1)} bpm`, `(${m.toFixed(1)} − ${l.toFixed(1)}) ÷ (${m.toFixed(1)} + ${l.toFixed(1)}) = ${r.ra.toFixed(2)}`])
        + kvRows([["Interdaily stability (IS)", r.is.toFixed(2), `how alike your hourly heart-rate pattern is across ${r.days} days (variance of the average day ÷ total variance)`], ["Intradaily variability (IV)", r.iv.toFixed(2), "hour-to-hour jumps relative to the overall spread; higher means more fragmented"]]);
    },
    live() { const r = D.advData?.hrRhythm; return { v: r?.ra ?? null, text: r ? `Heart rate: relative amplitude <b>${r.ra.toFixed(2)}</b>, stability <b>${r.is.toFixed(2)}</b>, fragmentation <b>${r.iv.toFixed(2)}</b>.` : "" }; },
    what: "Three numbers describing how strong and steady your 24-hour rhythm is, from your hourly heart rate. <b>Relative amplitude (RA, 0–1)</b>: how different your busiest ten hours are from your quietest five. <b>Interdaily stability (IS, 0–1)</b>: how alike each day is to the others. <b>Intradaily variability (IV)</b>: how fragmented the day is (more breaks between rest and activity means higher).",
    read: "No validated cut-offs. In research on older adults, a stronger (higher RA), steadier (higher IS) and less fragmented (lower IV) rhythm goes with better health and slower decline, and a weak, irregular rhythm with worse. Compare yourself with yourself over months.",
    moves: "Regular sleep and meal times, daylight in the morning, daily activity, and shift work or travel (which flatten it).",
    cite: "Witting, Biol Psychiatry 1990; Van Someren, Chronobiol Int 1999.",
    adv: "rhythm",
  },
  dip: {
    title: "Night-time heart-rate dip", unit: "%", fmt: (v) => v.toFixed(0),
    calc() {
      const h = nightH(), n = h?.summary?.night?.hr?.mean, d = h?.summary?.day?.hr_mean_awake;
      if (n == null || !d) return "<p>Needs a night with heart rate and the waking hours around it.</p>";
      return worked([`(awake average ${d.toFixed(1)} − asleep average ${n.toFixed(1)}) ÷ awake ${d.toFixed(1)} × 100`, `= ${(((d - n) / d) * 100).toFixed(1)}%`]);
    },
    live: () => ({ v: nightH()?.dipPct ?? null }),
    what: "How far your heart rate falls while you sleep compared with the same day awake, as a percentage. In a healthy body the heart rests deeply at night.",
    read: "There is no validated cut-off for heart rate. The familiar \"dipper\" categories (a 10–20% fall is normal) come from blood-pressure research and do not transfer to heart rate, so Pulse does not colour the number as good or bad and judges it against your own nights. A shrinking dip over weeks can accompany illness, heavy alcohol, poor sleep, sleep apnea or stress; a flat one can also appear if your daytime heart rate is simply low.",
    moves: "Alcohol, a late meal, late exercise, short or fragmented sleep, illness and stress all raise sleeping heart rate and shrink the dip.",
    cite: "Dipping categories from blood-pressure research: O'Brien, J Hypertens 2013.",
    personal: { values: () => priorNights((h) => h.dipPct), better: 1 },
    xp: true,
  },
  cvhr: {
    title: "Cyclic heart-rate pattern", unit: "/h", fmt: (v) => v.toFixed(1),
    calc() {
      const c = nightH()?.summary?.night?.cvhr;
      if (!c) return "<p>Needs a night with heart rate and sleep stages.</p>";
      return worked([`${c.events} surge-and-fall cycles over ${c.hours} hours asleep`, `= ${(+c.index).toFixed(1)} per hour`]) + `<p class="calc-n">A cycle counts when heart rate dips and then climbs at least 6 bpm within 90 seconds, and another such dip follows 20–90 seconds away (a single dip isn't cyclic). Hours are the asleep hours with heart-rate data. The 6 bpm bar is Pulse's own choice; the method was published on ECG, not wrist heart rate.</p>`;
    },
    live: () => ({ v: nightH()?.cvhrIndex ?? null }),
    what: "How many times per hour your heart rate surged and fell back in a repeating cycle while you slept. During breathing pauses the heart slows and then speeds up when breathing restarts, leaving this pattern.",
    read: "This is a screening hint, not an apnea index. The method was proven on ECG, not on this band's 5-second wrist heart rate; REM sleep and brief awakenings also cause surges, so the number runs high and cannot be compared with a sleep-study score. Do not read it against clinical cut-offs. Use it as a trend, and with the oxygen readings, the STOP-Bang questions and your partner's report.",
    moves: "Higher: sleep apnea, alcohol, sleeping on your back, nasal congestion, lots of REM. Lower: weight loss, side sleeping, no alcohol.",
    act: "A consistently high pattern together with snoring, gasping, morning headaches or daytime sleepiness: ask about a sleep study.",
    cite: "Guilleminault, Lancet 1984 (cyclic variation of heart rate in sleep apnoea).",
    personal: { values: () => priorNights((h) => h.cvhrIndex), better: -1 },
    xp: true,
  },
  apnea: {
    title: "Sleep apnea screen (STOP-Bang)", unit: "/8", scale: [0, 8], fmt: (v) => v.toFixed(0),
    calc() {
      const A = D.advData?.apnea, s = A?.stopBang;
      if (!s) return "<p>Answer the five STOP-Bang questions in Profile; age, sex and BMI come from your profile.</p>";
      const L = [["snore", "S · Snoring loudly"], ["tired", "T · Tired during the day"], ["observed", "O · Someone saw you stop breathing"], ["pressure", "P · Treated high blood pressure"], ["bmi35", "B · BMI over 35"], ["age50", "A · Age over 50"], ["neck", "N · Neck over 40 cm"], ["male", "G · Male"]];
      const o = A.objective;
      return kvRows(L.map(([k, l]) => [l, s.items[k] ? "1" : "0", ""])) + worked([`${L.map(([k]) => (s.items[k] ? 1 : 0)).join(" + ")} = ${s.score} of 8 (${s.risk} risk)`])
        + `<p class="calc-n">Supporting signals from the band (not part of the score): ${o?.n >= 7 ? `a night with oxygen under 94%: ${o.spo2Low ? "yes" : "no"}; repeating heart-rate pattern: ${o.cvhr ? "yes" : "no"}; breathing 1.5/min or more above your usual last night: ${o.breathing ? "yes" : "no"}` : `need 7 nights (${o?.n ?? 0} so far)`}.</p>`;
    },
    live() { const s = D.advData?.apnea?.stopBang; return { v: s ? s.score : null }; },
    zones: () => [[3, "good", "Low risk", "0–2 points"], [5, "watch", "Intermediate risk", "3–4 points"], [Infinity, "bad", "High risk", "5–8 points; a sleep study is advised."]],
    what: "STOP-Bang is a one-minute questionnaire: <b>S</b>noring, <b>T</b>ired, <b>O</b>bserved breathing pauses, <b>P</b>ressure (high blood pressure), then <b>B</b>MI over 35, <b>A</b>ge over 50, <b>N</b>eck over 40 cm and male sex. Each yes is a point, out of 8.",
    read: "It estimates the chance of moderate-to-severe obstructive sleep apnea. 0–2 is low risk, 3–4 intermediate, 5–8 high. It is a screening tool: it catches most people who have apnea but flags many who do not. Pulse adds your overnight oxygen and heart-rate pattern as supporting evidence only. Untreated apnea raises blood pressure, heart-rhythm and stroke risk and is very treatable.",
    act: "A score of 5 or more, or 3–4 with low oxygen or loud snoring and sleepiness: ask your clinician about a sleep study.",
    cite: "Chung, Anesthesiology 2008; Chung, Chest 2016.",
    adv: "apnea",
  },
  illness: {
    title: "Illness watch", unit: "",
    calc() {
      const I = D.advData?.illness;
      if (!I?.evidence?.length) return "<p>Needs 7 nights with heart rate.</p>";
      const val = (e) => (e.value == null ? "—" : e.key === "temp" ? `${e.value > 0 ? "+" : ""}${tDelta(e.value).toFixed(1)}°` : `${e.value > 0 ? "+" : ""}${(+e.value).toFixed(1)}${{ nightSignal: " bpm", cusum: " bpm", breathing: "/min" }[e.key] ?? ""}`);
      return kvRows(I.evidence.map((e) => [e.label, val(e), e.note]))
        + `<p class="calc-n">NightSignal is last night's average heart rate while asleep minus your usual (the median of up to 28 earlier nights): a watch at +3 bpm, more at +4 bpm two nights running, counted only when temperature (+0.3 °C), breathing (+1.5/min) or disrupted sleep agree. CuSum works on your resting heart rate: it adds up each night's excess over your usual minus a slack of half your usual swing, and fires when that running sum stays above its threshold two nights running. One detector = <b>watch</b>; both = <b>alert</b>.</p>`;
    },
    live() { const l = D.advData?.illness?.level ?? "none"; return { v: null, zone: { none: 0, watch: 1, alert: 2 }[l] ?? 0 }; },
    zones: () => [[1, "good", "All clear", "Overnight heart rate, temperature and breathing are within your usual."], [2, "watch", "Watch", "One detector, or a small shift. Rest and watch how you feel."], [Infinity, "bad", "Alert", "Both detectors agree that something is off."]],
    what: "Two independent detectors watch your overnight heart rate against your own usual. One looks for a night 3 bpm higher, or two nights 4 bpm higher, and only counts it when temperature, breathing or disrupted sleep agree. The other is a running-sum change detector for a slow drift. An alert needs both.",
    read: "It has no \"healthy range\": it only says whether tonight's signals look unusual for you. Illness often shows in resting heart rate, temperature and breathing a day or two before symptoms. But alcohol, hard late exercise, travel and stress cause the same pattern, so a watch or alert is a nudge to rest and look at how you feel, not a diagnosis.",
    act: "An alert plus fever, a new cough, breathlessness or chest pain: contact a clinician. A watch with no symptoms: an easy day, fluids and an early night.",
    cite: "Alavi, Nat Med 2022; Mishra, Nat Biomed Eng 2020.",
    adv: "illness",
  },
  // ---------------------------------------------------------------- fitness and energy
  vo2: {
    title: "Cardio fitness (VO₂max)", unit: "ml/kg/min", xp: true, fmt: (v) => v.toFixed(0),
    live() { const v = D.advData?.vo2; return { v: v?.value ?? null, text: v ? `Estimate <b>${v.low.toFixed(0)}–${v.high.toFixed(0)}</b>. ${fitTable() ? "Read your zone as the one on either side too." : "Add your age and sex in Profile to compare with people your age."}` : "" }; },
    get scale() { const t = fitTable(); return t ? [Math.floor(t[0] - 6), Math.ceil(t[4] + 8)] : [10, 70]; },
    zones() { const t = fitTable(); return t ? [[t[0], "bad", "Low", "Bottom 10% for your age and sex."], [t[1], "watch", "Below average", "Bottom 10–25%."], [t[3], "good", "Average", "Middle half for your age and sex."], [Infinity, "good", "High", "Top quarter."]] : []; },
    what: "How much oxygen your body can use at full effort, per kilogram of body weight per minute. It is the best single measure of cardiovascular fitness, and the strongest fitness predictor of how long you will live. Pulse cannot test it directly: it estimates it from your age, sex, weight and typical steps (and a second estimate from heart rate).",
    read: "The zones compare your estimate with healthy adults of your age and sex (the FRIEND registry's treadmill tests). The gain is largest for people moving up from the lowest group: each extra 3.5 ml/kg/min (1 MET) went with about 13% lower all-cause mortality and 15% lower cardiovascular mortality. The estimate's typical error is ±5.6 ml/kg/min and such models read about 2 units high, so use it for direction over months. Fitness can change 10–20% with 8–12 weeks of consistent training.",
    moves: "Raised by regular brisk aerobic exercise, especially intervals. Reduced by age (about 10% per decade), inactivity and weight gain.",
    caveat: "A non-exercise estimate, not a test. A measured value needs a graded exercise test.",
    cite: "Kaminsky, Mayo Clin Proc 2015 (FRIEND percentiles); Kodama, JAMA 2009; Jackson, Med Sci Sports Exerc 1990; Uth, Eur J Appl Physiol 2004.",
    calc() {
      const v = D.advData?.vo2, u = D.advData?.uth;
      if (!v) return "<p>Needs your age, sex, height and weight in Profile and 14 days of steps.</p>";
      const i = v.inputs, male = i.sex === "male" ? 1 : 0, t = [56.363, 1.921 * i.paR, -0.381 * i.age, -0.754 * i.bmi, 10.987 * male];
      return kvRows([["Age", `${i.age}`, "Profile"], ["Sex", i.sex, "Profile"], ["BMI", i.bmi.toFixed(1), `${fmtW(i.weight)} at ${fmtH(i.height)}, Profile`], ["Typical steps", `${Math.round(i.stepsTypical).toLocaleString()} a day`, `median of your last ${i.n} days with steps`]])
        + formula("VO₂max = 56.363 + 1.921 × activity rating − 0.381 × age − 0.754 × BMI + 10.987 × (1 if male)")
        + worked([`activity rating = 7 × (steps − 3,553) ÷ (12,000 − 3,553), kept within 0–7`, `= 7 × (${Math.round(i.stepsTypical).toLocaleString()} − 3,553) ÷ 8,447 = ${i.paR.toFixed(2)}`,
          `56.363 + 1.921 × ${i.paR.toFixed(2)} − 0.381 × ${i.age} − 0.754 × ${i.bmi.toFixed(1)} + 10.987 × ${male}`, `= ${t.map((x, k) => (k ? `${x < 0 ? "− " : "+ "}${Math.abs(x).toFixed(2)}` : x.toFixed(3))).join(" ")}`,
          `= ${v.value.toFixed(1)} ml/kg/min (model error ±5.6: ${v.low.toFixed(0)}–${v.high.toFixed(0)})`])
        + `<p class="calc-n">The activity rating is Pulse's own bridge from steps to the paper's 0–7 self-rating (3,553 steps a day, the least active quarter in Paluch 2022, as 0; 12,000, the lowest-mortality group in Saint-Maurice 2020, as 7). It has not been validated, which is why this estimate is marked experimental.</p>`
        + (u ? `<h5 class="calc-h">Second method: heart-rate ratio (Uth 2004)</h5>${worked([`15.3 × maximum heart rate ${Math.round(u.inputs.hrmax)} ÷ resting heart rate ${Math.round(u.inputs.rhr)}`, `= 15.3 × ${(u.inputs.hrmax / u.inputs.rhr).toFixed(3)}`, `= ${u.value.toFixed(1)} ml/kg/min (±15%: ${u.low.toFixed(0)}–${u.high.toFixed(0)})`])}<p class="calc-n">${D.profile?.hrmax ? "Maximum heart rate is the one set in your profile" : D.profile?.betablocker ? "Maximum heart rate is estimated from age for someone on a beta-blocker (Brawner: 164 − 0.7 × age)" : "Maximum heart rate is estimated from age (Tanaka: 208 − 0.7 × age)"}; resting heart rate is your median overnight resting rate. Validated only in trained men aged 21–51, so read it as a cross-check.</p>` : "");
    },
    adv: "vo2",
  },
  hrr: {
    title: "Heart-rate recovery", unit: "bpm", scale: [0, 50], fmt: (v) => v.toFixed(0), soft: true,
    calc() {
      const H = D.advData?.hrr;
      if (!H?.series?.length) return "<p>Measured after each detected workout (10+ minutes at 40% of your heart-rate reserve or more).</p>";
      return formula("recovery = heart rate over the last 10 s of the workout − heart rate 60 s later")
        + kvRows(H.series.slice(-6).reverse().map((z) => [z.date, `${z.hrr60 != null ? Math.round(z.hrr60) : "—"} bpm`, z.hrr120 != null ? `after 2 minutes: ${Math.round(z.hrr120)} bpm` : ""]))
        + (H.baseline?.hrr60 != null ? `<p class="calc-n">Your usual: ${Math.round(H.baseline.hrr60)} bpm, the median of your earlier workouts.</p>` : "");
    },
    live() { const h = D.advData?.hrr?.latest; return { v: h?.hrr60 ?? null }; },
    zones: () => [[13, "bad", "Abnormal range", "12 bpm or less in the first minute in the original study."], [Infinity, "good", "Typical or better"]],
    what: "How many beats per minute your heart rate falls in the first minute after a workout ends. A fit heart hands control back to the vagus nerve quickly, so it drops fast.",
    read: "In the original study a fall of 12 bpm or less in the first minute after a graded treadmill test predicted a higher risk of death. That study used a standard protocol and Pulse measures free-living workouts that end unevenly (you stop, stand, talk, keep walking), so the 12 bpm line is for orientation only, and your own recoveries over time are the fair comparison. Faster recovery follows training; slower follows illness, a hard prior day, heat, dehydration or poor sleep.",
    moves: "Faster: aerobic fitness, rested state. Slower: fatigue, illness, heat, stimulants, dehydration, beta-blockers (which also blunt the peak).",
    cite: "Cole, N Engl J Med 1999.",
    personal: { values: () => (D.advData?.hrr?.series ?? []).slice(0, -1).map((z) => z.hrr60), better: 1 },
    adv: "hrr",
  },
  ccost: {
    title: "Cardiac cost of walking", unit: "bpm", fmt: (v) => v.toFixed(0), xp: true,
    calc() {
      const h = [...(D.hist ?? [])].reverse().find((z) => z.summary?.day?.cardiac_cost), c = h?.summary?.day?.cardiac_cost;
      if (!c) return "<p>Needs a day with steady walking (sustained walking cadence) and a resting heart rate.</p>";
      const rest = c.walkingHr - (c.bpmPer100spm * c.cadence) / 100;
      return formula("cost = (walking heart rate − resting heart rate) ÷ (steps per minute ÷ 100)")
        + worked([`${h.date}: ${c.minutes} minutes of steady walking`, `(${c.walkingHr} − resting ${rest.toFixed(0)}) ÷ (${c.cadence} ÷ 100)`, `= ${(+c.bpmPer100spm).toFixed(1)} bpm per 100 steps a minute`]);
    },
    live: () => ({ v: D.advData?.ccost?.latest?.bpmPer100spm ?? null }),
    what: "How much your heart rate rises for each 100 steps per minute of steady walking. It is a cadence-only version of the physiological cost index: a fitter heart gets more walking for less effort.",
    read: "No cut-off. A lower number means walking costs your heart less. A rise over weeks, with no change in routes or hills, can mean lower fitness, tiredness, heat, illness or a new medicine; a fall goes with improving fitness. Compare only with your own steady walks.",
    moves: "Hills, heat, carrying weight, tiredness, caffeine, illness and fitness.",
    caveat: "It ignores stride length, slope and speed, so it is rough.",
    personal: { values: () => (D.advData?.ccost?.series ?? []).slice(0, -1).map((z) => z.bpmPer100spm), better: -1 },
  },
  load: {
    title: "Training load", unit: "TRIMP", fmt: (v) => v.toFixed(0),
    calc() {
      const L = D.advData?.load, w = L?.thisWeek, f = D.profile?.sex === "female", k = f ? [0.86, 1.67] : [0.64, 1.92];
      if (!w) return "<p>Needs heart rate from the band.</p>";
      const ex = 30 * 0.7 * k[0] * Math.exp(k[1] * 0.7);
      return formula(`TRIMP = Σ minutes × HRR × ${k[0]} × e^(${k[1]} × HRR), over minutes at 50% of your heart-rate reserve or more (${f ? "women's" : "men's"} weighting)`)
        + worked([`HRR = (heart rate − resting) ÷ (maximum − resting)`, `for example, 30 min at 70% HRR = 30 × 0.7 × ${k[0]} × e^(${k[1]} × 0.7) = ${ex.toFixed(0)}`, `this week (${w.days} day${w.days === 1 ? "" : "s"}): ${Math.round(w.trimp ?? 0)}${L.lastWeek ? `; last week ${Math.round(L.lastWeek.trimp ?? 0)}` : ""}`,
          w.sessions ? `tagged sessions: effort × minutes, summed over ${w.sessions} = ${Math.round(w.sessionLoad)}` : "no tagged sessions this week (tag a workout's effort to add session load)"])
        + zoneMinutes();
    },
    live() { const L = D.advData?.load?.thisWeek; return { v: L ? L.trimp ?? 0 : null }; },
    what: "TRIMP (training impulse) adds up heart-rate effort over each workout: minutes spent at higher percentages of your heart-rate reserve count for more. Pulse also adds session RPE (how hard it felt × minutes) for sessions you tagged, shown separately.",
    read: "No cut-offs: a load that is right for one person is too much or too little for another. The useful questions are whether this week is far above your recent weeks (a big jump raises the chance of injury and illness) and whether you are recovering between hard days. Meanwhile the guidelines are at least 150 minutes of moderate activity a week.",
    moves: "Duration, intensity, frequency; weight lifting is under-counted by heart rate.",
    cite: "Banister 1991; Foster, J Strength Cond Res 2001.",
    adv: "load",
  },
  energy: {
    title: "Energy: resting and active", unit: "kcal", fmt: (v) => v.toFixed(0),
    live: () => ({ v: null }),
    what: "<b>Resting energy</b> is what your body burns doing nothing, estimated from weight, height, age and sex (Mifflin–St Jeor). <b>Active energy</b> is the extra from movement, estimated from heart rate in the minutes above 30% of your heart-rate reserve (Keytel).",
    read: "No good or bad: these are budgets. Resting energy is typically within about ±10% of a lab measurement for most adults, and it is the larger part of the day. Wrist-based active energy misses by 27–93% in studies, so use it for how today compares with other days, not to count calories.",
    cite: "Mifflin, Am J Clin Nutr 1990; Keytel, J Sports Sci 2005; Shcherbina, J Pers Med 2017.",
    calc() {
      const p = D.profile ?? {}, e = D.advData?.energy, male = p.sex === "male";
      if (!(p.weight && p.height && p.age && p.sex)) return "<p>Needs your age, sex, height and weight in Profile.</p>";
      const bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + (male ? 5 : -161);
      return `<h5 class="calc-h">Resting energy (Mifflin–St Jeor)</h5>${worked([`10 × weight ${p.weight.toFixed(1)} kg + 6.25 × height ${Math.round(p.height)} cm − 5 × age ${p.age} ${male ? "+ 5 (men)" : "− 161 (women)"}`,
          `= ${(10 * p.weight).toFixed(0)} + ${(6.25 * p.height).toFixed(0)} − ${5 * p.age} ${male ? "+ 5" : "− 161"}`, `= ${Math.round(bmr).toLocaleString()} kcal a day`])}
        <h5 class="calc-h">Active energy (Keytel)</h5>${formula(male ? "kcal per minute = (−55.0969 + 0.6309 × heart rate + 0.1988 × weight + 0.2017 × age) ÷ 4.184" : "kcal per minute = (−20.4022 + 0.4472 × heart rate − 0.1263 × weight + 0.074 × age) ÷ 4.184")}
        ${worked([`at 120 bpm for you: ${((male ? -55.0969 + 0.6309 * 120 + 0.1988 * p.weight + 0.2017 * p.age : -20.4022 + 0.4472 * 120 - 0.1263 * p.weight + 0.074 * p.age) / 4.184).toFixed(1)} kcal a minute`,
          e?.n ? `today: ${e.n} minute${e.n > 1 ? "s" : ""} at or above 30% of your heart-rate reserve, summed = ${Math.round(e.active ?? 0)} kcal` : "today: no minutes yet at or above 30% of your heart-rate reserve"])}
        <p class="calc-n">Only minutes at or above 30% of your heart-rate reserve count, because the formula was built from exercise and badly overstates calories at rest.</p>`;
    },
    adv: "energy",
  },
  // ---------------------------------------------------------------- blood pressure
  bp: {
    title: "Home blood pressure", unit: "mmHg", scale: [95, 160], fmt: (v) => v.toFixed(0),
    live() { const s = D.bp?.length ? bpSummary(D.bp) : null, cat = s ? bpCategory(s.sys, s.dia)[0] : null; return { v: s?.sys ?? null, zone: cat == null ? undefined : cat.startsWith("Stage 2") ? 3 : cat.startsWith("Stage 1") ? 2 : cat === "Elevated" ? 1 : 0, text: s ? `Your 7-day home average is <b>${s.sys.toFixed(0)}/${s.dia.toFixed(0)}</b> from ${s.n} readings. The ladder follows the top (systolic) number; the bottom number (80 / 85) sets the category too.` : "" }; },
    zones: () => [[120, "good", "Normal", "Under 120 and under 80."], [130, "watch", "Elevated", "120–129 with a bottom number under 80."], [135, "watch", "Stage 1", "130–134 or 80–84 at home."], [Infinity, "bad", "Stage 2", "135 or higher, or 85 or higher, at home."]],
    what: "Blood pressure is the force of blood on your artery walls. The top number (systolic) is the peak as the heart squeezes and the bottom (diastolic) is the pressure between beats. Averaged over a week of home readings it predicts risk better than a single clinic reading.",
    read: "Home thresholds from the 2017 ACC/AHA guideline: stage 1 starts at 130/80 and stage 2 at 135/85 (home numbers run a little lower than clinic). Each 20 mmHg of systolic above 115 about doubles the risk of heart disease and stroke. A single high reading is not hypertension: it takes a pattern across several days. The average uses the last 7 days, dropping the first day when there are four or more.",
    moves: "Salt, alcohol, weight, activity, sleep (apnea!), stress, caffeine, pain and medicines. Measuring after a walk, a coffee or with a full bladder reads high.",
    act: "Over 180/120: rest five minutes and measure again; if still that high, call your clinician, and with chest pain, breathlessness, weakness or trouble speaking call 911. Averages in stage 1 or 2 across a week: book an appointment.",
    caveat: "A validated upper-arm cuff, seated, back supported, arm at heart level, after five minutes' rest and two readings a minute apart gives the reading to trust.",
    cite: "Whelton, Hypertension 2018 (ACC/AHA 2017 guideline, home thresholds); Lewington, Lancet 2002.",
  },
  bpest: {
    title: "Band blood pressure, corrected", unit: "mmHg", xp: true, fmt: (v) => v.toFixed(0),
    live() {
      const R = D.advData?.bp, L = R?.latest;
      return { v: null, shown: L ? `${Math.round(L.sys)}/${Math.round(L.dia)}<small>mmHg</small>` : undefined, text: L ? `80% range ${Math.round(L.sys - Z80 * L.sysSd)}–${Math.round(L.sys + Z80 * L.sysSd)} systolic. The band itself read ${Math.round(L.raw.sys)}/${Math.round(L.raw.dia)} at ${ampm(new Date(L.ms).getHours() * 60 + new Date(L.ms).getMinutes())}${R.cal.n ? `; calibrated to ${R.cal.n} cuff reading${R.cal.n > 1 ? "s" : ""}` : "; no cuff readings to calibrate it yet"}.` : "" };
    },
    keyNote: "<b>Judge blood pressure by your cuff.</b> The cuff's 7-day average sets your category (Measure → Blood pressure); this line is the trend between cuff readings.",
    what: "The band records its own blood-pressure estimate with every HRV measurement (every 10 minutes on Pulse's schedule). How it computes that is the maker's secret, and like every cuffless estimate it is off by a different amount for each person. Your home cuff readings are the anchors: for each one Pulse works out what the band read at that exact moment (a straight line between its good readings either side), then learns how far off the band runs for you (the <b>offset</b>) and how much of its rise and fall shows up on your cuff (the <b>slope</b>).",
    read: "Read the line as a trend between cuff readings: if it climbs and stays up, check with your cuff. The ± is the range 80% of cuff readings would be expected to fall in given what Pulse knows; it narrows as you add cuff readings. Accuracy is measured honestly: each cuff reading is predicted only from the readings before it, and compared with the band as measured and with simply reusing your previous cuff reading. Your home cuff average, not this line, sets your blood-pressure category and feeds your heart-risk estimate.",
    moves: "Real changes (activity, stress, salt, alcohol, sleep, medicines) and things that fool the sensor: a loose band, cold hands, arm position and movement. A new band or a firmware update can shift the offset, so log a few cuff readings after either. The band's own reading fails when the arm is moving, so on active days there can be an hour or two between good readings.",
    act: "Use your cuff for decisions. If the band's line runs high for several days, take a week of morning and evening cuff readings and look at that average.",
    caveat: "Cuffless blood pressure is not validated for diagnosis, and this band exposes no raw pulse waveform, so the estimate is only as good as the band's own signal plus your anchors. The European Society of Hypertension and the AHA advise against using cuffless readings to diagnose or treat high blood pressure.",
    cite: "Mukkamala, IEEE Trans Biomed Eng 2015 (cuffless BP needs per-person calibration); Stergiou, J Hypertens 2023 (ESH recommendations for validating cuffless devices); Muntner, Hypertension 2019 (AHA statement on BP measurement).",
    calc() {
      const R = D.advData?.bp, L = R?.latest;
      if (!L) return "<p>No band reading yet. The band records one with every HRV measurement while it's worn; they arrive when it syncs.</p>";
      const c = calibrateAt(R.A, L.ms), r = Math.round, sg = (v) => `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(1)}`;
      const chan = (name, raw, f) => (f.center == null
        ? [`${name}: as measured ${r(raw)}; no anchors yet, so it stays ${r(raw)} with a wide range (±${r(Z80 * Math.hypot(f.sigma, Math.sqrt(f.cov[0][0])))})`]
        : [`${name}: as measured ${raw.toFixed(1)}`, `+ offset ${sg(f.offset)}`, `+ (slope ${f.slope.toFixed(2)} − 1) × (${raw.toFixed(1)} − the band's usual ${f.center.toFixed(1)}) = ${sg((f.slope - 1) * (raw - f.center))}`, `= ${(raw + f.offset + (f.slope - 1) * (raw - f.center)).toFixed(1)}`]);
      const v = R.check;
      return `<p>The latest band reading (${new Date(L.ms).toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${ampm(new Date(L.ms).getHours() * 60 + new Date(L.ms).getMinutes())}), worked through with your calibration:</p>`
        + formula("cuff ≈ band + offset + (slope − 1) × (band − band's usual)")
        + worked(chan("Systolic", L.raw.sys, c.sys)) + worked(chan("Diastolic", L.raw.dia, c.dia))
        + (c.n ? kvRows([["Cuff readings used", `${c.n}`, "the newest 30 matched to the band; each counts by how close the band's nearest good reading was (fully within a few minutes, half at 30 minutes)"], ["Offset, systolic", `${sg(c.sys.offset)} ± ${Math.sqrt(c.sys.cov[0][0]).toFixed(1)}`, "positive means the band reads low for you"], ["Slope, systolic", `${c.sys.slope.toFixed(2)} ± ${Math.sqrt(c.sys.cov[1][1]).toFixed(2)}`, "starts at 1 (trust the band's swings) and moves only once anchors cover a spread"], ["Scatter of one reading", `±${c.sys.sigma.toFixed(1)} / ±${c.dia.sigma.toFixed(1)}`, "how far a single cuff sitting lands from the line, systolic / diastolic"]]) : "")
        + (v.n ? `<p class="calc-n">On ${v.n} reading${v.n > 1 ? "s" : ""} it hadn't seen, the calibrated band missed your cuff by <b>${v.sys.cal.toFixed(1)}</b> mmHg systolic on average, vs ${v.sys.raw.toFixed(1)} for the band as measured and ${v.sys.last.toFixed(1)} for your previous cuff reading.</p>` : "")
        + `<p class="calc-n">Before any anchor, Pulse assumes the band could be off by about ±15 mmHg systolic (±10 diastolic) and that its swings are right (slope 1 ± 0.3). Each anchor updates both in proportion to how much it tells; the scatter is learned from your own anchors.</p>`;
    },
  },
  bpdip: {
    title: "Estimated night-time BP dip", unit: "%", scale: [-10, 30], fmt: (v) => v.toFixed(0), soft: true, xp: true,
    live() { const d = bandDip(7); return { v: d && !d.need ? d.sys : null, text: d && !d.need ? `Last 7 days on the band's calibrated line: <b>${Math.round(d.daySys)}/${Math.round(d.dayDia)}</b> awake, <b>${Math.round(d.nightSys)}/${Math.round(d.nightDia)}</b> asleep.` : "" }; },
    zones: () => [[0, "bad", "Reverse dipper", "Pressure higher at night than by day."], [10, "watch", "Non-dipper", "Less than a 10% fall."], [20.001, "good", "Dipper", "A 10–20% fall is normal."], [Infinity, "watch", "Extreme dipper", "More than 20%."]],
    what: "Blood pressure normally falls by 10–20% during sleep. Pulse compares the average of the band's calibrated line while you were asleep (from your sleep record) with the average while you were awake.",
    read: "In ambulatory (24-hour cuff) studies, a smaller dip (non-dipper) or a rise (reverse dipper) goes with a higher risk of heart disease and stroke. Pulse's version rests on the band's calibrated estimate, not a 24-hour cuff, so the categories are for orientation. Apnea, alcohol, salt, poor sleep and some medicines reduce the dip.",
    calc() { const d = bandDip(7); return d && !d.need ? worked([`(awake ${d.daySys.toFixed(1)} − asleep ${d.nightSys.toFixed(1)}) ÷ awake ${d.daySys.toFixed(1)} × 100`, `= ${d.sys.toFixed(1)}% systolic (${d.dia.toFixed(1)}% diastolic)`, `from ${d.nDay} awake and ${d.nNight} asleep band readings`]) : "<p>Needs a night with the band on: at least 6 readings asleep and 12 awake.</p>"; },
    cite: "O'Brien, J Hypertens 2013 (ESH dipping categories).",
  },
  // ---------------------------------------------------------------- Pulse's own scores
  recovery: {
    title: "Recovery score", unit: "", scale: [0, 100], fmt: (v) => v.toFixed(0), soft: true,
    live: () => ({ v: nightH()?.rec ?? null }),
    zones: () => [[50, "bad", "Low"], [67, "watch", "Moderate"], [Infinity, "good", "Recovered"]],
    keyNote: "<b>Pulse's own score.</b> The colours are the bands the app uses, not clinical cut-offs.",
    what: "How rested your body looks this morning compared with your own recent nights. It blends four things your body does when it has recovered: a lower resting heart rate, higher overnight HRV, no unusual rise in temperature, and a good night's sleep.",
    read: "Read it against yourself, not other people: 50 is not a fail and 90 is not a prize. A run of low scores, or one well below your usual, is worth a lighter day. Pulse leaves out any part that has no baseline yet (it needs 5 earlier nights) and spreads its weight over the rest.",
    moves: "Lower: alcohol, a late meal, late hard exercise, short or broken sleep, illness, stress, heat. Higher: a regular sleep schedule, a cool room, rest days after hard training.",
    caveat: "The weights are Pulse's, chosen to favour the most reliable signals; no wearable recovery score is clinically validated.",
    cite: "Inputs follow Alavi, Nat Med 2022 (overnight heart rate), Shaffer & Ginsberg 2017 (HRV), Smarr, Sci Rep 2020 (temperature).",
    calc() { const h = nightH(); return h?.recParts?.length ? scoreParts(h.recParts, h.rec, "recovery") : "<p>Needs 5 nights to learn your usual.</p>"; },
  },
  sleep: {
    title: "Sleep score", unit: "", scale: [0, 100], fmt: (v) => v.toFixed(0), soft: true,
    live: () => ({ v: nightH()?.sleepScore ?? null }),
    zones: () => [[50, "bad", "Poor"], [67, "watch", "Fair"], [Infinity, "good", "Good"]],
    keyNote: "<b>Pulse's own score.</b> The colours are the bands the app uses, not clinical cut-offs.",
    what: "One number for last night's sleep: how long you slept against the recommendation for your age, how much of your time in bed was sleep, how long you lay awake during the night, how close your timing was to your usual, and how much was deep and REM sleep.",
    read: "It rarely reaches 100, because every part has to be excellent. Duration and regularity carry the most weight because they are the most reliable things a wrist band measures and the strongest links to long-term health; deep and REM count least because band staging is approximate.",
    moves: "Bedtime and wake time (the biggest lever), alcohol, caffeine after noon, a warm room, screens late, naps late in the day, stress and pain.",
    cite: "Hirshkowitz, Sleep Health 2015 (NSF duration); Windred, Sleep 2024 (regularity).",
    calc() { const h = nightH(); return h?.sleepParts?.length ? scoreParts(h.sleepParts, h.sleepScore, "sleep") : "<p>Needs a night with a sleep record.</p>"; },
  },
  metsyn: {
    title: "Metabolic syndrome", unit: "of 5", scale: [0, 5], fmt: (v) => v.toFixed(0),
    live() { const m = metNow(); return { v: m ? m.met : null, text: m ? `${m.met} of 5 criteria met, ${m.assessed} of 5 assessable.` : "" }; },
    zones: () => [[3, "good", "Not met", "Fewer than 3 criteria."], [Infinity, "bad", "Metabolic syndrome", "3 or more of the 5."]],
    what: "A cluster of five common findings that together raise the risk of heart disease and type 2 diabetes more than each alone: a large waist, high triglycerides, low HDL cholesterol, raised blood pressure and raised fasting glucose. Any three of the five make the diagnosis under the international harmonised definition.",
    read: "It's a yes/no definition: 3 or more criteria is metabolic syndrome. Each criterion counts as met if you're treated for it (blood-pressure medicine, diabetes). The 2018 and 2026 cholesterol guidelines list it as a risk-enhancing factor, a reason to take a borderline heart-risk number more seriously.",
    moves: "Losing fat around the middle improves almost every criterion at once; so do regular aerobic activity, cutting alcohol and refined carbohydrates, and treating blood pressure.",
    act: "If you meet 3 or more, raise it at your next check-up, especially with a borderline or intermediate heart-risk estimate.",
    cite: "Alberti, Circulation 2009 (harmonised definition; AHA/NHLBI waist cut-points); Grundy, Circulation 2019 (risk enhancer).",
    calc() {
      const m = metNow();
      if (!m) return "<p>Needs lab results or a waist measurement.</p>";
      return kvRows(m.criteria.map((c) => [`${c.name} · ${c.rule}`, c.met == null ? "not on file" : c.met ? "met" : "not met", c.value == null ? (c.key === "waist" ? "add your waist in Profile" : "") : `yours: ${typeof c.value === "number" ? +c.value.toFixed(1) : c.value}${typeof c.value !== "number" ? "" : c.key === "waist" ? " cm" : " mg/dL"}`]))
        + worked([`${m.met} met of ${m.assessed} assessable → ${m.present === true ? "metabolic syndrome" : m.present === false ? "not met" : "can't tell yet"}`]) + `<p class="calc-n">Labs use your newest result for each test; blood pressure is your cuff's 7-day average.</p>`;
    },
  },
  // ---------------------------------------------------------------- home cuff detail (30 days of sittings)
  pp: {
    title: "Pulse pressure", unit: "mmHg", scale: [20, 90], fmt: (v) => v.toFixed(0), soft: true,
    live: () => ({ v: hb()?.pp ?? null }),
    zones: () => [[60, "good", "Typical"], [Infinity, "watch", "Wide", "60 or more in people over 60 is a sign of stiffer large arteries."]],
    what: "The gap between your top (systolic) and bottom (diastolic) numbers. Each heartbeat pushes a pulse of blood into the large arteries; when they are elastic they absorb it and the gap stays modest. As they stiffen with age, the top number rises, the bottom number stays or falls, and the gap widens.",
    read: "Typical adult values are around 40–50 mmHg. The ESC/ESH guideline treats 60 mmHg or more in older people as a marker of stiff large arteries and higher cardiovascular risk. In young adults a wide gap can be harmless (a strong, elastic heart and aorta), which is why the band is shaded as orientation only.",
    moves: "Age, long-standing high blood pressure, diabetes, smoking and kidney disease widen it. Aerobic fitness and lowering a high systolic pressure narrow it.",
    cite: "Williams, Eur Heart J 2018 (ESC/ESH guideline: pulse pressure ≥60 mmHg in older people).",
    calc() { const r = hb(); return r ? worked([`average systolic ${hbMean("sys")} − average diastolic ${hbMean("dia")}`, `= ${r.pp} mmHg over ${r.sessions} sitting${r.sessions > 1 ? "s" : ""} in the last 30 days`]) + `<p class="calc-n">Each sitting's readings are averaged first, as the home protocol asks.</p>` : "<p>Needs a cuff reading in the last 30 days.</p>"; },
  },
  map: {
    title: "Mean arterial pressure", unit: "mmHg", fmt: (v) => v.toFixed(0),
    live: () => ({ v: hb()?.map ?? null }),
    what: "The average pressure in your arteries across a whole heartbeat. The heart spends about two-thirds of each beat relaxing, so the average sits closer to the bottom number: diastolic plus a third of the pulse pressure. It's roughly the pressure that pushes blood through your organs.",
    read: "Most healthy adults sit between about 70 and 100 mmHg at rest. Clinicians use it mainly in hospital (below about 65 the organs may not get enough blood). At home it adds little beyond your two numbers, which already set your category; it's here because some devices and papers report it.",
    moves: "Everything that moves blood pressure: salt, alcohol, weight, activity, sleep, stress and medicines.",
    cite: "Standard physiology (diastolic + ⅓ pulse pressure at resting heart rates).",
    calc() { const r = hb(); return r ? formula("MAP = diastolic + (systolic − diastolic) ÷ 3") + worked([`each sitting: diastolic + (systolic − diastolic) ÷ 3, then averaged over ${r.sessions} sitting${r.sessions > 1 ? "s" : ""}`, `≈ ${hbMean("dia")} + (${hbMean("sys")} − ${hbMean("dia")}) ÷ 3`, `= ${r.map} mmHg`]) : "<p>Needs a cuff reading in the last 30 days.</p>"; },
  },
  bpvar: {
    title: "Day-to-day blood pressure swing", unit: "mmHg", fmt: (v) => v.toFixed(1),
    live: () => ({ v: hb()?.variability?.sd ?? null }),
    what: "How much your daily average systolic pressure varies from one day to the next. Pulse shows the standard deviation of your daily averages, and the average real variability (ARV): the average size of the change from one day to the next, which ignores slow drifts.",
    read: "There's no agreed cut-off for home readings. In the Ohasama study, people whose home systolic pressure swung more from day to day had higher cardiovascular risk, whatever their average. Read it against your own past months: a swing that grows is worth noticing, especially with a new medicine or irregular dosing.",
    moves: "Irregular medicine timing, alcohol, salt, poor sleep, stress, pain, measuring at different times or positions, and stiffer arteries.",
    caveat: "Needs readings on 7 different days. Measuring at the same times each day keeps technique from inflating it.",
    cite: "Kikuya, Hypertension 2008 (Ohasama, day-by-day home BP variability); Mena, J Hypertens 2005 (ARV).",
    calc() { const r = hb(), v = r?.variability; if (!v) return `<p>${esc(r?.need?.variability ?? "Needs readings on 7 different days.")}</p>`;
      const d = r.dayRows.map((x) => x.sys);
      return worked([`daily systolic averages over ${v.days} days: ${d.map((x) => x.toFixed(0)).join(", ")}`, `standard deviation = ±${v.sd} mmHg (coefficient of variation ${v.cv}%)`, `average change from one day to the next (ARV) = ${v.arv} mmHg`, `range = ${v.range} mmHg; diastolic SD ±${v.sdDia}`]); },
  },
  morneve: {
    title: "Morning vs evening", unit: "mmHg", fmt: (v) => `${v > 0 ? "+" : ""}${v.toFixed(0)}`,
    live: () => ({ v: hb()?.mornEve?.diff ?? null }),
    what: "Your average morning systolic pressure minus your average evening one, from cuff sittings before and after noon.",
    read: "Most people read a little higher in the morning: blood pressure rises in the hours after waking. A large morning excess has been linked with stroke risk in some cohorts, and morning readings taken before medicines show whether a once-daily tablet lasts the full 24 hours. There's no single agreed cut-off, so read it with your clinician if your mornings run well above your evenings.",
    moves: "Medicine timing, sleep apnea, alcohol the night before, caffeine and when after waking you measure (the protocol is within an hour of waking, before medicines, coffee and exercise).",
    cite: "Muntner, Hypertension 2019 (AHA home-monitoring protocol); Kario, Circulation 2003 (morning surge).",
    calc() { const m = hb()?.mornEve; return m ? worked([`morning ${m.am.toFixed(1)}/${m.amDia.toFixed(1)} over ${m.nAm} sittings`, `evening ${m.pm.toFixed(1)}/${m.pmDia.toFixed(1)} over ${m.nPm} sittings`, `systolic difference = ${m.diff > 0 ? "+" : ""}${m.diff}`]) : `<p>${esc(hb()?.need?.mornEve ?? "Needs 3 morning and 3 evening sittings.")}</p>`; },
  },
  firstsecond: {
    title: "First vs second reading", unit: "mmHg", fmt: (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`,
    live: () => ({ v: hb()?.firstReading?.diff ?? null }),
    what: "In sittings where you took two readings a minute apart, the first systolic minus the second.",
    read: "The first reading is often a few mmHg higher (the cuff itself, settling down). That's why the AHA asks for two readings and why Pulse averages each sitting. If your first reading regularly runs much higher, rest a full five minutes before starting, or take a third reading.",
    cite: "Muntner, Hypertension 2019 (AHA statement on BP measurement).",
    calc() { const f = hb()?.firstReading; return f ? worked([`average of (first − second) over ${f.n} paired sittings = ${f.diff > 0 ? "+" : ""}${f.diff} mmHg`, `median ${f.median > 0 ? "+" : ""}${f.median}`]) : `<p>${esc(hb()?.need?.firstReading ?? "Needs 3 sittings with two readings.")}</p>`; },
  },
  // ---------------------------------------------------------------- biological age, heart risk, body
  phenoage: {
    title: "Biological age (PhenoAge)", unit: "years", fmt: (v) => v.toFixed(1),
    keyNote: "<b>No cut-offs.</b> Read the gap from your real age, and its direction across your panels.",
    live() { const r = phenoNow(); return { v: r ? r.total : null, text: r ? `${Math.abs(r.total - r.age) < 0.05 ? "The same as" : `<b>${Math.abs(r.total - r.age).toFixed(1)} years ${r.total < r.age ? "younger" : "older"}</b> than`} your age (${r.age}).` : "" }; },
    ...LABGUIDE.phenoage,
    cite: "Levine, Aging (Albany NY) 2018; Liu, PLoS Med 2018.",
    calc() {
      const r = phenoNow();
      if (!r) return "<p>Needs albumin, creatinine, glucose, hs-CRP, lymphocyte %, MCV, RDW, alkaline phosphatase and white cell count.</p>";
      const L = latestLabs(), ref = phenoParts(PHENO_REF, r.age).total, rows = [...r.parts].sort((a, b) => Math.abs(b.pull) - Math.abs(a.pull)), max = Math.max(1, ...rows.map((p) => Math.abs(p.pull)));
      const pullSum = rows.reduce((a, p) => a + p.pull, 0);
      let out = `<p>PhenoAge is a weighted sum of the nine markers and your age, so it splits exactly. With every marker at a mid-range reference value, someone aged ${r.age} scores <b>${ref.toFixed(1)}</b>. Your markers then add or remove years:</p>
        <div class="pull">${rows.map((p) => `<div><span>${esc(p.name)}<em>${p.value} ${esc(p.unit)} · ref ${PHENO_REF[p.key]}${L[p.key] ? ` · ${short(L[p.key].date)}` : ""}</em></span>${divBar(p.pull, max)}<b class="${p.pull > 0.05 ? "hi" : p.pull < -0.05 ? "ok" : ""}">${p.pull >= 0 ? "+" : "−"}${Math.abs(p.pull).toFixed(1)}</b></div>`).join("")}</div>`
        + worked([`${ref.toFixed(1)} ${pullSum >= 0 ? "+" : "−"} ${Math.abs(pullSum).toFixed(1)} = ${r.total.toFixed(1)} years`]);
      const ch = phenoHistory();
      if (ch) {
        const top = ch.c.parts.filter((p) => Math.abs(p.years) >= 0.1).sort((a, b) => Math.abs(b.years) - Math.abs(a.years));
        out += `<h5 class="calc-h">Since your previous complete panel</h5><p>From ${short(ch.a)} to ${short(ch.b)} it moved <b>${ch.c.total >= 0 ? "+" : "−"}${Math.abs(ch.c.total).toFixed(1)} years</b>: ${top.map((p) => `${esc(p.name)} ${p.from} → ${p.to} (${p.years >= 0 ? "+" : "−"}${Math.abs(p.years).toFixed(1)})`).join(", ") || "no marker moved it much"}${Math.abs(ch.c.ageing) >= 0.05 ? `, and ageing between the draws ${ch.c.ageing >= 0 ? "+" : "−"}${Math.abs(ch.c.ageing).toFixed(1)}` : ""}.</p>`;
      }
      return out + `<p class="calc-n">Units are converted to the paper's (albumin g/L, creatinine µmol/L, glucose mmol/L, CRP as the log of mg/dL). Each year of age adds ${PHENO_AGE_YEARS.toFixed(2)} years. The reference values are mid-range adult results chosen by Pulse to make the pulls readable; they don't change the total.</p>`;
    },
  },
  prevent: {
    title: "Heart risk (AHA PREVENT)", unit: "%", scale: [0, 20], fmt: (v) => String(Math.round(v * 10) / 10),
    live() { const res = preventNow(); return res?.R ? { v: res.R.ascvd10 * 100, text: `Your 10-year chance of a heart attack or stroke (ASCVD). Total cardiovascular events including heart failure: <b>${(res.R.cvd10 * 100).toFixed(1)}%</b>; 30-year ASCVD: <b>${(res.R.ascvd30 * 100).toFixed(1)}%</b>.` } : { v: null, text: res?.reason ? esc(res.reason) : "" }; },
    zones: () => [[3, "good", "Low"], [5, "watch", "Borderline"], [10, "bad", "Intermediate"], [Infinity, "bad", "High"]],
    ...LABGUIDE.prevent,
    cite: "Khan, Circulation 2024 (PREVENT equations, Supplemental Table S12); 2026 ACC/AHA dyslipidemia guideline (categories).",
    calc() {
      const res = preventNow();
      if (!res?.R) return `<p>${esc(res?.reason ?? "Not computable yet.")}</p>`;
      const { inp } = res, model = inp.hba1c != null ? "a1c" : "base", G = preventGroups(preventBreakdown(inp, { model, horizon: 10, outcome: "ascvd" })), L = latestLabs(), yn = (b) => (b ? "yes" : "no");
      const val = { Age: `${inp.age}`, Cholesterol: `total ${inp.totalChol}, HDL ${inp.hdl} mg/dL${inp.statin ? ", on a statin" : ""}`, "Blood pressure": `${inp.sbp} mmHg${inp.bpTreatment ? ", treated" : ""}`, "Diabetes and HbA1c": `${inp.diabetes ? "diabetes" : "no diabetes"}${inp.hba1c != null ? `, HbA1c ${inp.hba1c}%` : ""}`, Smoking: yn(inp.smoker), BMI: inp.bmi.toFixed(1), "Kidney function": `eGFR ${inp.egfr}` };
      const lmax = Math.max(0.1, ...G.groups.map((g) => Math.abs(g.logOdds)));
      return kvRows([["Age, sex", `${inp.age}, ${inp.sex}`, "Profile"], ["Total / HDL cholesterol", `${inp.totalChol} / ${inp.hdl} mg/dL`, L.tc ? `Lab · ${short(L.tc.date)}` : ""], ["Systolic blood pressure", `${inp.sbp} mmHg`, "home cuff, 7-day average"], ["BMI", inp.bmi.toFixed(1), "Profile"], ["eGFR", `${inp.egfr}`, L.egfr ? `Lab · ${short(L.egfr.date)}` : ""], ["HbA1c", inp.hba1c != null ? `${inp.hba1c}%` : "not on file", inp.hba1c != null && L.a1c ? `Lab · ${short(L.a1c.date)}` : "adds precision when on file"], ["Diabetes · smoker · BP medicine · statin", `${yn(inp.diabetes)} · ${yn(inp.smoker)} · ${yn(inp.bpTreatment)} · ${yn(inp.statin)}`, "Profile"]])
        + `<p>The equation starts from a reference person: age 55, non-HDL cholesterol 135 mg/dL, HDL 50 mg/dL, systolic 130, BMI 25, eGFR 90, no diabetes, non-smoker, no medicines. Their 10-year risk${model === "a1c" ? " (with an HbA1c of 5.3%)" : ""} is <b>${(G.ref * 100).toFixed(1)}%</b>. Each of your inputs then multiplies the odds:</p>
        <div class="pull">${G.groups.map((g) => `<div><span>${esc(g.name)}<em>${esc(val[g.name] ?? "")}</em></span>${divBar(g.logOdds, lmax)}<b class="${g.odds > 1.005 ? "hi" : g.odds < 0.995 ? "ok" : ""}">×${g.odds.toFixed(2)}</b></div>`).join("")}</div>`
        + worked([`odds ${(G.ref / (1 - G.ref)).toFixed(4)} × ${G.groups.map((g) => g.odds.toFixed(2)).join(" × ")} = ${(res.R.ascvd10 / (1 - res.R.ascvd10)).toFixed(4)}`, `= ${(res.R.ascvd10 * 100).toFixed(1)}% risk`])
        + `<p class="calc-n">${model === "a1c" ? "The HbA1c version of the equations is used because an HbA1c is on file. " : ""}Interactions with age (for example, cholesterol matters less at older ages) are counted with the other factor, because age itself can't change. Neighbourhood deprivation is part of the full model but isn't collected, so it's treated as unknown. ×1.00 means no effect.</p>`;
    },
  },
  bmi: {
    title: "Body mass index (BMI)", unit: "kg/m²", scale: [15, 42], fmt: (v) => v.toFixed(1),
    live: () => ({ v: bmiOf(D.profile ?? {}) }),
    zones: () => [[18.5, "watch", "Underweight"], [25, "good", "Healthy weight"], [30, "watch", "Overweight"], [Infinity, "bad", "Obesity"]],
    ...LABGUIDE.bmi,
    cite: "WHO, Technical Report Series 894 (2000); WHO Expert Consultation, Lancet 2004 (Asian populations).",
    calc() { const p = D.profile ?? {}; if (!(p.height && p.weight)) return "<p>Needs height and weight in Profile.</p>"; const m = p.height / 100;
      return worked([`weight ${p.weight.toFixed(1)} kg ÷ (height ${m.toFixed(2)} m)²`, `= ${p.weight.toFixed(1)} ÷ ${(m * m).toFixed(3)}`, `= ${(p.weight / (m * m)).toFixed(1)}`]) + (isUS() ? `<p class="calc-n">${fmtW(p.weight)} and ${fmtH(p.height)}, converted to kilograms and metres.</p>` : ""); },
  },
  whtr: {
    title: "Waist-to-height ratio", unit: "", scale: [0.35, 0.75], fmt: (v) => v.toFixed(2),
    live: () => ({ v: bodyIndices(D.profile ?? {}).find((z) => z.key === "whtr")?.value ?? null }),
    zones: () => [[0.5, "good", "No increased risk"], [0.6, "watch", "Increased health risk"], [Infinity, "bad", "High health risk"]],
    ...LABGUIDE.whtr,
    cite: "Ashwell, Obes Rev 2012; NICE CG189 (2022 update).",
    calc() { const p = D.profile ?? {}; return p.waist && p.height ? worked([`waist ${fmtLen(p.waist)} ÷ height ${fmtLen(p.height)}`, `= ${(p.waist / p.height).toFixed(3)}`]) : "<p>Needs your waist and height in Profile.</p>"; },
  },
  rfm: {
    title: "Relative fat mass", unit: "% body fat", fmt: (v) => v.toFixed(1),
    live: () => ({ v: bodyIndices(D.profile ?? {}).find((z) => z.key === "rfm")?.value ?? null }),
    ...LABGUIDE.rfm,
    cite: "Woolcott & Bergman, Sci Rep 2018.",
    calc() { const p = D.profile ?? {}; if (!(p.waist && p.height && (p.sex === "female" || p.sex === "male"))) return "<p>Needs your sex, waist and height in Profile.</p>"; const f = p.sex === "female";
      return worked([`64 − 20 × (height ${Math.round(p.height)} cm ÷ waist ${Math.round(p.waist)} cm)${f ? " + 12 (women)" : ""}`, `= 64 − 20 × ${(p.height / p.waist).toFixed(3)}${f ? " + 12" : ""}`, `= ${(64 - 20 * (p.height / p.waist) + (f ? 12 : 0)).toFixed(1)}%`]); },
  },
};

// Tiles that share a guide.
const ALIAS = { qt: "qtc", lfhf: "spectrum", lnhf: "spectrum", lnlf: "spectrum", hfnu: "spectrum", hfpeak: "spectrum", sd1: "poincare", sd2: "poincare", csi: "poincare", cvi: "poincare", o2low: "spo2" };
export const hasGuide = (k) => !!(GUIDE[ALIAS[k] ?? k] || (k.startsWith("lab:") && LABGUIDE[k.slice(4)]));

// ---------- "How it's calculated" pieces ----------
const short = (date) => labLabel(date).replace(/, \d{4}$/, "");
const fmtW = (kg) => (isUS() ? `${Math.round(kg / 0.45359237)} lb` : `${Math.round(kg)} kg`);
const fmtH = (cm) => (isUS() ? `${Math.floor(cm / 30.48)}′${Math.round((cm / 2.54) % 12)}″` : `${Math.round(cm)} cm`);
const fmtLen = (cm) => (isUS() ? `${(cm / 2.54).toFixed(1)} in` : `${Math.round(cm)} cm`);
const formula = (f) => `<p class="calc-f"><span>Formula</span><code>${esc(f)}</code></p>`;
const worked = (lines) => `<div class="calc-w">${lines.map((l) => `<div>${esc(l)}</div>`).join("")}</div>`;
const kvRows = (rows) => `<div class="kv calc-in">${rows.map(([a, b, c]) => `<div><span>${esc(a)}</span><b>${esc(b)}</b>${c ? `<em>${esc(c)}</em>` : ""}</div>`).join("")}</div>`;
/** A small diverging bar: right (warm) for values that raise the result, left (green) for values that lower it. */
function divBar(v, max) {
  const W = 110, mid = W / 2, w = Math.min(mid - 2, (Math.abs(v) / max) * (mid - 2));
  return S(W, 12, `<line x1="${mid}" x2="${mid}" y1="0" y2="12" stroke="${css("--ink3")}" stroke-opacity=".5"/><rect x="${(v >= 0 ? mid : mid - w).toFixed(1)}" y="3" width="${Math.max(1, w).toFixed(1)}" height="6" rx="3" fill="${css(v >= 0 ? "--bad" : "--good")}" opacity=".8"/>`);
}
const labValues = () => Object.fromEntries(Object.entries(latestLabs()).map(([k, x]) => [k, x.value]));
const labCtx = () => { const p = D.profile ?? {}; return { bmi: bmiOf(p), sex: p.sex ?? null, age: p.age ?? null, diabetes: !!p.diabetes }; };
function phenoNow() { const age = D.profile?.age; if (!age) return null; const r = phenoParts(labValues(), age); return r ? { ...r, age } : null; }
/** The two newest panels with all nine PhenoAge markers, each scored at the age at its draw. */
function phenoHistory() {
  const age = D.profile?.age; if (!age) return null;
  const at = (date) => age - (Date.now() - new Date(`${date}T12:00:00`)) / (365.25 * 864e5);
  const full = (D.labs ?? []).map((p) => ({ date: p.date, r: phenoParts(p.v ?? {}, at(p.date)) })).filter((x) => x.r);
  if (full.length < 2) return null;
  const a = full[full.length - 2], b = full[full.length - 1];
  return { a: a.date, b: b.date, c: phenoChange(a.r, b.r) };
}
function preventNow() { try { return preventResult(D.profile ?? {}); } catch { return null; } }
function metNow() {
  const L = latestLabs(), p = D.profile ?? {}, bp = D.bp?.length ? bpSummary(D.bp) : null;
  const m = metabolicSyndrome({ tg: L.tg?.value ?? null, hdl: L.hdl?.value ?? null, glucose: L.glucose?.value ?? null, sys: bp?.sys ?? null, dia: bp?.dia ?? null, waist: p.waist ?? null }, { sex: p.sex ?? null, bpMeds: !!p.bpMeds, diabetes: !!p.diabetes });
  return m.assessed ? m : null;
}
/** How each part of a Pulse score turned into points (the rule for each part, then the weighted total). */
const SCORE_RULE = {
  duration: () => { const n = sleepNeed(D.profile?.age ?? 40); return `full marks from ${hmStr(n.min + 30)} to ${hmStr(n.max + 60)} for your age (${n.min / 60}–${n.max / 60} h recommended), tapering a little beyond; none at 4 h`; },
  efficiency: () => "none at 70%, full at 92%",
  continuity: () => "full at 10 minutes awake or less, none at 90",
  regularity: () => "full within 15 min of your 14-night average midpoint, none at 2 h off",
  restoration: () => "none at 20% of sleep, full at 45%",
  rhr: (p) => { const zz = 2.5 - 4 * p.frac; return p.frac > 0 && p.frac < 1 ? `${Math.abs(zz).toFixed(1)} usual swings ${zz < 0 ? "below" : "above"} your usual: (2.5 − ${paren(zz)}) ÷ 4 of the points` : p.frac >= 1 ? "1.5 or more usual swings below your usual: full" : "2.5 or more usual swings above your usual: none"; },
  hrv: (p) => { const zz = 4 * p.frac - 2.5; return p.frac > 0 && p.frac < 1 ? `${Math.abs(zz).toFixed(1)} usual swings ${zz < 0 ? "below" : "above"} your usual (on a log scale): (${paren(zz)} + 2.5) ÷ 4 of the points` : p.frac >= 1 ? "1.5 or more usual swings above your usual: full" : "2.5 or more usual swings below your usual: none"; },
  temp: () => "full up to +0.2 °C over your usual, none at +0.8 °C (cooler never counts against you)",
  sleep: () => "your sleep score for the night",
};
const SCORE_VAL = { duration: (v) => hmStr(v), efficiency: (v) => `${Math.round(v)}%`, continuity: (v) => `${Math.round(v)} min`, regularity: (v) => `${Math.round(v)} min off`, restoration: (v) => `${Math.round(v)}%`, rhr: (v) => `${Math.round(v)} bpm`, hrv: (v) => `${Math.round(v)} ms`, temp: (v) => `${tDelta(v) >= 0 ? "+" : "−"}${Math.abs(tDelta(v)).toFixed(1)}${tUnit()} vs usual`, sleep: (v) => `${Math.round(v)}` };
const paren = (v) => (v < 0 ? `(−${Math.abs(v).toFixed(1)})` : v.toFixed(1));
const hmStr = (min) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, "0")} min`;
function scoreParts(parts, score) {
  const tot = parts.reduce((a, x) => a + x.max, 0), got = parts.reduce((a, x) => a + x.frac * x.max, 0);
  return `<div class="pull">${parts.map((x) => `<div><span>${esc(x.label)}<em>${SCORE_VAL[x.key]?.(x.value) ?? ""} · ${SCORE_RULE[x.key]?.(x) ?? ""}${x.note && /usual/i.test(x.note) ? ` · ${esc(x.note)}` : ""}</em></span>${S(110, 12, `<rect x="0" y="3" width="110" height="6" rx="3" fill="${css("--track")}"/><rect x="0" y="3" width="${(110 * x.frac).toFixed(1)}" height="6" rx="3" fill="${css(x.frac >= 0.67 ? "--good" : x.frac >= 0.34 ? "--watch" : "--bad")}"/>`)}<b>${(x.frac * x.max).toFixed(0)}<small>/${x.max}</small></b></div>`).join("")}</div>`
    + worked([`${parts.map((x) => (x.frac * x.max).toFixed(1)).join(" + ")} = ${got.toFixed(1)} of ${tot}`, `${got.toFixed(1)} ÷ ${tot} × 100 = ${score ?? Math.round((got / tot) * 100)}`])
    + (tot < 100 ? `<p class="calc-n">Parts without enough history yet are left out, so the total is out of ${tot} and rescaled to 100.</p>` : "");
}
/** This week's minutes in Karvonen heart-rate zones 1–5 (50–60 … 90%+ of reserve), from the daily summaries. */
function zoneMinutes() {
  const now = new Date(), dow = (now.getDay() + 6) % 7, monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow).toISOString().slice(0, 10);
  const z = [0, 0, 0, 0, 0];
  for (const h of D.hist ?? []) if (h.date >= monday) (h.summary?.day?.zone_minutes ?? []).forEach((m, i) => { z[i] += m ?? 0; });
  if (!z.some((m) => m > 0.5)) return "";
  return `<h5 class="calc-h">Minutes in each heart-rate zone this week</h5>${kvRows(["50–60%", "60–70%", "70–80%", "80–90%", "90%+"].map((l, i) => [`Zone ${i + 1} · ${l} of reserve`, `${Math.round(z[i])} min`, ""]))}<p class="calc-n">Higher zones count for more in TRIMP: a minute at 85% weighs about ${(0.85 * Math.exp(1.92 * 0.85) / (0.55 * Math.exp(1.92 * 0.55))).toFixed(1)}× a minute at 55%.</p>`;
}
/** Home cuff detail over the last 30 days (null without readings), and a sitting-weighted average of one channel. */
function hb() { const r = D.bp?.length ? homeBP(D.bp) : null; return r?.sessions ? r : null; }
function hbMean(k) { const ss = sessions(D.bp ?? []).filter((x) => toMs(x.t) >= Date.now() - 30 * 864e5); return ss.length ? (ss.reduce((a, x) => a + x[k], 0) / ss.length).toFixed(1) : "—"; }

/** A guide for one lab-derived index (labs.js), built from your current results: the paper's zones, the formula
 *  worked with your numbers, the index at each draw and what moved it. */
function labGuide(key) {
  const ctx = labCtx(), vals = labValues(), d = derived(vals, ctx).find((z) => z.key === key), text = LABGUIDE[key] ?? {};
  if (!d) return null;
  const zs = zonesFor(key, ctx), w = workings(key, vals, ctx), L = latestLabs(), fmt = (v) => String(+(+v).toFixed(3)).replace("-", "−");
  const trail = (D.labs ?? []).map((panel) => [panel.date, derived(panel.v ?? {}, ctx).find((z) => z.key === key)?.value]).filter(([, v]) => v != null);
  const zone = zs ? zs.zones.findIndex((z) => z[2] === d.band[0]) : -1;
  const NAME = { age: ["Age", "years", "Profile"], sex: ["Sex", "", "Profile"], bmi: ["BMI", "", "Profile (height and weight)"], diabetes: ["Diabetes or fasting glucose ≥100", "", "Profile and labs"] };
  const inputs = w ? w.inputs.map(([k, v]) => { const a = ANALYTES.find((z) => z.k === k), nm = NAME[k];
    return [a?.n ?? nm?.[0] ?? k, `${k === "diabetes" ? (v ? "yes" : "no") : typeof v === "number" ? fmt(v) : v}${(a?.u ?? nm?.[1]) ? ` ${a?.u ?? nm[1]}` : ""}`, nm ? nm[2] : L[k] ? `Lab · ${short(L[k].date)}` : ""]; }) : [];
  return {
    title: d.name, unit: d.unit, fmt, scale: zs?.scale,
    live: () => ({ v: d.value, zone: zone >= 0 ? zone : undefined, text: !zs && d.band[0] ? `${esc(d.band[0])}.` : "" }),
    zones: () => zs?.zones ?? [],
    what: text.what, read: text.read, moves: text.moves, act: text.act, caveat: [text.caveat, esc(d.note)].filter(Boolean).join(" "), cite: esc(d.cite),
    calc: () => `${kvRows(inputs)}${formula(d.formula)}${w ? worked(w.lines) : ""}${trail.length > 1 ? `<p class="calc-n">At each draw: ${trail.map(([dt, v]) => `${short(dt)} <b>${fmt(v)}</b>`).join(" → ")}</p>` : ""}${whatMoved(key, D.profile?.age)}${tierChip(key) ? `<p class="calc-n">How much weight this number can bear: ${tierChip(key)}</p>` : ""}`,
  };
}

/** FRIEND registry treadmill VO₂max percentiles for the profile's age and sex: [p10, p25, p50, p75, p90]. */
const FRIEND = { male: { 20: [32.1, 40.1, 48.0, 55.2, 61.8], 30: [30.2, 35.9, 42.4, 49.2, 56.5], 40: [26.8, 31.9, 37.8, 45.0, 52.1], 50: [22.8, 27.1, 32.6, 39.7, 45.6], 60: [19.8, 23.7, 28.2, 34.5, 40.3], 70: [17.1, 20.4, 24.4, 30.4, 36.6] },
  female: { 20: [23.9, 30.5, 37.6, 44.7, 51.3], 30: [20.9, 25.3, 30.2, 36.1, 41.4], 40: [18.8, 22.1, 26.7, 32.4, 38.4], 50: [17.3, 19.9, 23.4, 27.6, 32.0], 60: [14.6, 17.2, 20.0, 23.8, 27.0], 70: [13.6, 15.6, 18.3, 20.8, 23.1] } };
function fitTable() { const s = sex(), a = age(); return (s === "male" || s === "female") && a ? FRIEND[s][decade(a)] : null; }

/** Which zone a value falls in (index), or -1. */
export function zoneIndex(zones, v) { return num(v) ? zones.findIndex((z) => v < z[0]) : -1; }

/** Judge a value against your own usual: median ± one typical swing of your last 28 values. */
export function personalTier(values, v, better) {
  const u = usualRange(values.filter(num));
  if (!u || !num(v)) return null;
  const sdv = Math.max(u.sd, Math.abs(u.center) * 0.02, 1e-6), z = (v - u.center) / sdv, bad = better !== 0 && z * better < 0, good = better !== 0 && z * better > 0;
  const tier = Math.abs(z) <= 1 ? ["good", "Within your usual"] : Math.abs(z) <= 2 ? (good ? ["good", "Better than your usual"] : ["watch", bad ? "Outside your usual, the less favourable way" : "Outside your usual"]) : good ? ["good", "Much better than your usual"] : [bad ? "bad" : "watch", "Far outside your usual"];
  return { tier: tier[0], label: tier[1], u, z };
}

function ladder(g, zones, v) {
  const W = 320, H = 46, [lo, hi] = g.scale, x = sc(lo, hi, 4, W - 4), at = (b) => Math.min(hi, Math.max(lo, b));
  let a = lo, body = "";
  zones.forEach((z, i) => {
    const b = at(z[0] === Infinity ? hi : z[0]);
    if (b > a) body += `<rect x="${x(a).toFixed(1)}" y="14" width="${(x(b) - x(a)).toFixed(1)}" height="12" fill="${css("--" + z[1])}" opacity="${g.soft ? 0.32 : 0.62}" ${i === 0 ? 'rx="6"' : ""}/>`;
    if (z[0] !== Infinity && z[0] > lo && z[0] < hi) body += `<line x1="${x(z[0]).toFixed(1)}" x2="${x(z[0]).toFixed(1)}" y1="12" y2="28" stroke="${css("--bg")}" stroke-width="2"/><text x="${x(z[0]).toFixed(1)}" y="42" text-anchor="middle" class="axis">${g.fmt(z[0])}</text>`;
    a = Math.max(a, b);
  });
  body += `<text x="4" y="42" class="axis">${g.fmt(lo)}</text><text x="${W - 4}" y="42" text-anchor="end" class="axis">${g.fmt(hi)}</text>`;
  if (num(v)) body += `<circle cx="${x(at(v)).toFixed(1)}" cy="20" r="8" fill="${css("--ink")}" stroke="${css("--bg")}" stroke-width="3"/>`;
  return S(W, H, body);
}
const rangeText = (g, zones, i) => { const lo = i ? zones[i - 1][0] : null, hi = zones[i][0]; return lo == null ? `under ${g.fmt(hi)}` : hi === Infinity ? `${g.fmt(lo)}+` : `${g.fmt(lo)}–${g.fmt(hi)}`; };

/** The "How to read this" sheet for a guide key, or null when none exists. */
export function explainSheet(key) {
  const k = ALIAS[key] ?? key, g = k.startsWith("lab:") ? labGuide(k.slice(4)) : GUIDE[k];
  if (!g) return null;
  const L = g.live?.() ?? { v: null }, v = L.v, zones = g.zones?.() ?? [], fmt = g.fmt ?? ((x) => String(x));
  const gg = { ...g, fmt, scale: g.scale };
  const idx = L.zone ?? zoneIndex(zones, v), z = idx >= 0 ? zones[idx] : null;
  const pv = g.personal?.values?.() ?? [], pt = g.personal && num(v) ? personalTier(pv, v, g.personal.better) : null;
  // Headline verdict: a validated zone leads; for "soft" zones, or none, your own usual does.
  const verdict = z && !g.soft ? { tier: z[1], label: z[2] } : pt ? { tier: pt.tier, label: pt.label } : z ? { tier: z[1], label: z[2] } : null;
  const shown = L.shown ?? (num(v) ? `${fmt(v)}${g.unit ? `<small>${g.unit}</small>` : ""}` : "—");
  const hasNum = !!g.scale && zones.length && g.scale[0] != null;
  const sec = (h, t) => (t ? `<h4 class="xz-h">${h}</h4><p>${t}</p>` : "");
  return `<div class="sh-h"><b>${g.title}${g.xp ? ' <span class="xp">experimental</span>' : ""}</b><button class="back" data-sheetclose>Done</button></div>
    <div class="xz-now"><div><span class="xz-v">${shown}</span><span class="xz-l">${num(v) || L.shown ? "your latest reading" : L.zone != null ? "right now" : "no reading yet"}</span></div>${verdict ? `<span class="badge ${verdict.tier}">${esc(verdict.label)}</span>` : ""}</div>
    ${L.text ? `<p class="xz-live">${L.text}</p>` : ""}
    ${zones.length ? `<h4 class="xz-h">Where it sits</h4>${hasNum ? ladder(gg, zones, v) : ""}
      <div class="xz-zones">${zones.map((zz, i) => `<div class="xz-z ${i === idx ? "on" : ""}"><i style="background:var(--${zz[1]})"></i><span><b>${zz[2]}</b>${hasNum ? `<em>${rangeText(gg, zones, i)}${g.unit && g.unit !== "RA" ? ` ${g.unit}` : ""}</em>` : ""}${zz[3] ? `<small>${zz[3]}</small>` : ""}</span></div>`).join("")}</div>
      <p class="xz-key">${g.keyNote && g.soft ? g.keyNote : g.soft ? `<b>For orientation only.</b> No validated cut-off exists for this exact measure, so these ranges are rough and ${g.personal ? "your own usual (below) is the fairer judge." : "the trend in your own readings matters more."}` : `<span class="key" style="--k:${css("--good")}">${TIER.good}</span> <span class="key" style="--k:${css("--watch")}">${TIER.watch}</span> <span class="key" style="--k:${css("--bad")}">${TIER.bad}</span> Published cut-offs; read together with how you feel, never alone.`}</p>` : `<p class="xz-key">${g.keyNote ?? `<b>No good-or-bad range.</b> ${g.personal ? "No validated cut-off exists, so Pulse judges it against your own usual." : "This one is context, not a score."}`}</p>`}
    ${g.calc ? `<h4 class="xz-h">How it's calculated</h4><div class="calc">${g.calc()}</div>` : ""}
    ${g.personal ? `<h4 class="xz-h">Against your own usual</h4>${pt ? `<div class="xz-own"><span class="badge ${pt.tier}">${esc(pt.label)}</span><span>Your usual is <b>${fmt(pt.u.lo)}–${fmt(pt.u.hi)}${g.unit ? ` ${g.unit}` : ""}</b> (median ${fmt(pt.u.center)}, last ${pt.u.n} readings). That range is the median plus or minus one typical swing; outside two swings is unusual for you.</span></div>` : `<p>${num(v) ? `Pulse needs at least 5 earlier readings (${pv.filter(num).length} so far) to know your usual.` : "Appears once you have a reading and 5 earlier ones."}</p>`}` : ""}
    ${sec("What it is", g.what)}${sec("How to read it", g.read)}${sec("What moves it", g.moves)}${sec("When to act", g.act)}
    ${g.caveat ? `<div class="xz-cav"><b>Keep in mind</b> ${g.caveat}</div>` : ""}
    ${g.adv ? `<h4 class="xz-h">Method and your numbers</h4>${advBody(g.adv)}` : ""}
    ${g.cite ? `<p class="xz-cite">${g.cite}</p>` : ""}
    <p class="xz-cite">Pulse is a wellness tool, not a medical device. These guides explain numbers; they do not diagnose.</p>`;
}
