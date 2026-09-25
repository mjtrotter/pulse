// Advanced groups on the Trends tab: illness & apnea watch, body clock, heart fitness, energy, the
// experimental cuff-calibrated BP estimate, and metabolic context from labs. Every row states how solid it
// is; experimental ones carry a badge. Rows open a drill-down (daily series) or an explanation sheet.
import { derived } from "../analytics/labs.js?v=20260924230628";
import { mean, ols } from "./stats.js?v=20260924230628";
import { ampm, clock, D, esc, sign } from "./kit.js?v=20260924230628";
import { bmiOf, latestLabs } from "./labsui.js?v=20260924230628";

const XP = `<span class="xp">experimental</span>`;
const row = ({ key, drill, sheet, label, value, unit = "", text, xp = false }) => ({
  ready: !(value == null || value === "—"), label, need: text,
  html: `<div class="adv-row" ${drill ? `data-open="${drill}"` : sheet ? `data-advinfo="${sheet}"` : key ? `data-advinfo="${key}"` : ""}><b>${label}${xp ? XP : ""}</b><span class="av">${value}${unit ? `<small>${unit}</small>` : ""}</span>${text ? `<p>${text}</p>` : ""}</div>` });
const needTxt = (n, need, what) => `${n ?? 0} of ${need} ${what} so far`;
const card = (rows) => rows;
const cta = (html) => ({ ready: true, html });

function watchCard(A) {
  const h = D.latest, iw = A.illness, ap = A.apnea, rows = [];
  const lvl = { none: "All clear", watch: "Watch", alert: "Alert" }[iw?.level ?? "none"];
  const nights = D.hist.filter((z) => z.hasNight).length;
  rows.push(row({ key: "illness", label: "Illness watch", value: nights >= 7 ? lvl : "—", text: nights < 7 ? `Compares each night's heart rate, temperature, breathing and sleep with your own usual; ready after 7 nights (${nights} so far).` : iw?.reasons?.length ? esc(iw.reasons.join("; ")) : "Overnight heart rate, temperature and breathing are within your usual. Two independent detectors (NightSignal and a CuSum change detector) must agree before an alert." }));
  const sb = ap?.stopBang;
  rows.push(sb ? row({ key: "apnea", label: "Sleep apnea screen", value: `${sb.score}<small>/8</small>`, text: `STOP-Bang ${sb.risk} risk${ap.objective?.spo2Low ? "; oxygen dipped low on some nights" : ""}${ap.objective?.cvhr ? "; cyclic heart-rate pattern seen" : ""}. A questionnaire plus supporting signals, not a sleep study.` })
    : cta(`<div class="adv-row" data-sheet="stopbang"><b>Sleep apnea screen</b><span class="av">›</span><p>Answer 5 quick questions (STOP-Bang). Pulse then adds your overnight oxygen and heart-rate pattern as supporting evidence.</p></div>`));
  rows.push(row({ drill: "cvhr", label: "Cyclic heart-rate pattern", value: h.cvhrIndex != null ? h.cvhrIndex.toFixed(1) : "—", unit: h.cvhrIndex != null ? "/h" : "", xp: true, text: "Repeating heart-rate surges during sleep, a pattern seen with breathing pauses (Guilleminault 1984). Validated on ECG, not on this band's 5-second wrist heart rate; REM sleep and brief awakenings also cause surges, so the number runs high and isn't comparable to a sleep study. Watch your own trend." }));
  if (h.spo2Min != null) rows.push(row({ drill: "spo2", label: "Lowest oxygen last night", value: `${h.spo2Min}`, unit: "%", text: `${h.spo2Below90 ? `${h.spo2Below90} reading${h.spo2Below90 > 1 ? "s" : ""} under 90%. ` : ""}Spot readings every 10 minutes; they can show a low night but can't count breathing pauses.` }));
  return card(rows);
}

function clockCard(A) {
  const rows = [], s = A.sri, c = A.chrono, hr = A.hrRhythm, tp = A.tempRhythm;
  rows.push(row({ drill: "sri", label: "Sleep regularity (SRI)", value: s ? Math.round(s.sri) : "—", text: s ? `How alike your sleep–wake timing is from one day to the next (0–100; Phillips 2017). In 60,000 UK Biobank adults, higher regularity predicted lower mortality, more strongly than sleep length (Windred 2024).` : "Needs 5 days with sleep records." }));
  rows.push(row({ key: "chrono", label: "Chronotype", value: c ? clock(c.msfsc ?? c.msf) : "—", unit: c ? ampm(c.msfsc ?? c.msf).slice(-2) : "", text: c ? `Mid-sleep on free days${c.msfsc != null ? ", corrected for weekday sleep debt" : ""} (MCTQ, Roenneberg 2004). Social jetlag: <b>${Math.round(c.socialJetlag)} min</b> between weekday and weekend timing (Wittmann 2006).` : `Needs 2 weekend and 3 weekday nights (${needTxt(D.hist.filter((z) => z.hasSleep).length, 5, "nights")}).` }));
  rows.push(row({ key: "rhythm", label: "Daily rhythm strength", value: hr ? hr.ra.toFixed(2) : "—", unit: hr ? "RA" : "", text: hr ? `Heart-rate rhythm: amplitude ${hr.ra.toFixed(2)}, day-to-day stability ${hr.is.toFixed(2)}${tp ? `; skin-temperature rhythm stability ${tp.is.toFixed(2)}` : ""} (Van Someren 1999). Stronger, more stable rhythms go with better health in older adults.` : "Needs 3 days of all-day heart rate." }));
  const dips = D.hist.slice(-14).map((z) => z.dipPct).filter((v) => v != null);
  rows.push(row({ drill: "dip", label: "Night-time heart-rate dip", value: D.latest.dipPct != null ? `${D.latest.dipPct.toFixed(0)}` : "—", unit: D.latest.dipPct != null ? "%" : "", xp: true, text: `How far your heart rate falls asleep vs awake${dips.length >= 3 ? ` (14-night median ${mean(dips).toFixed(0)}%)` : ""}. Tracked against your own trend; no validated cut-off exists for heart rate (the dipping categories come from blood-pressure research).` }));
  return card(rows);
}

function fitnessCard(A) {
  const rows = [], v = A.vo2, u = A.uth;
  rows.push(row({ key: "vo2", label: "Cardio fitness (VO₂max)", value: v ? v.value.toFixed(0) : "—", unit: v ? "ml/kg/min" : "", xp: true, text: v ? `Estimate ${v.low.toFixed(0)}–${v.high.toFixed(0)} from age, sex, BMI and your typical steps (Jackson 1990 non-exercise model). Wide error band; the trend matters more than the number.${u ? ` Heart-rate ratio method: ${u.value.toFixed(0)} (Uth 2004, validated in trained men).` : ""}` : "Needs your profile and 14 days of steps." }));
  const r = D.hist.slice(-30).map((z, i) => [i, z.rhr]).filter((p) => p[1] != null);
  const f = r.length >= 10 ? ols(r.map((p) => [1, p[0]]), r.map((p) => p[1])) : null;
  rows.push(row({ drill: "rhr", label: "Resting heart rate trend", value: f ? sign(f.beta[1] * 30, 1) : "—", unit: f ? "bpm/mo" : "", text: f ? `Slope of your resting heart rate over the last 30 nights (±${(1.96 * f.se[1] * 30).toFixed(1)}). A falling resting heart rate usually tracks improving fitness.` : "Needs 10 nights." }));
  const hrr = A.hrr;
  rows.push(row({ key: "hrr", label: "Heart-rate recovery", value: hrr?.latest?.hrr60 != null ? Math.round(hrr.latest.hrr60) : "—", unit: hrr?.latest?.hrr60 != null ? "bpm/min" : "", text: hrr?.ready ? `How fast your heart rate drops in the minute after a workout, vs your usual ${hrr.baseline?.hrr60 != null ? Math.round(hrr.baseline.hrr60) : "—"}. Faster recovery goes with better fitness (Cole 1999); tracked against your own history only.` : `Measured after each detected workout; needs ${hrr?.need ?? 3} workouts (${hrr?.n ?? 0} so far).` }));
  const cc = A.ccost;
  rows.push(row({ drill: "ccost", label: "Cardiac cost of walking", value: cc?.latest?.bpmPer100spm != null ? cc.latest.bpmPer100spm.toFixed(0) : "—", unit: cc?.latest?.bpmPer100spm != null ? "bpm" : "", xp: true, text: cc?.ready ? `Heart-rate rise per 100 steps/min of steady walking, vs your usual ${cc.baseline?.toFixed(0) ?? "—"}. Lower means walking costs your heart less. A cadence-only adaptation of the physiological cost index; personal trend only.` : `Needs ${cc?.need ?? 7} days with steady walking (${cc?.n ?? 0} so far).` }));
  const sh = D.latest.stageHr;
  if (sh) rows.push(row({ drill: "rhr", label: "Heart rate by sleep stage", value: sh.deep != null ? Math.round(sh.deep) : "—", unit: "deep", text: `Last night: deep ${sh.deep != null ? Math.round(sh.deep) : "—"}, light ${sh.light != null ? Math.round(sh.light) : "—"}, REM ${sh.rem != null ? Math.round(sh.rem) : "—"}, awake ${sh.awake != null ? Math.round(sh.awake) : "—"} bpm. Heart rate is normally lowest and steadiest in deep sleep.` }));
  const L = A.load;
  if (L?.thisWeek) rows.push(row({ key: "load", label: "Training load this week", value: Math.round(L.thisWeek.trimp ?? 0), unit: "TRIMP", text: `${L.lastWeek ? `Last week ${Math.round(L.lastWeek.trimp ?? 0)}. ` : ""}Heart-rate load (Banister TRIMP)${L.thisWeek.sessionLoad ? ` plus ${Math.round(L.thisWeek.sessionLoad)} from tagged sessions (effort × minutes, Foster 2001)` : ""}. Kept separate: no combined "strain" score is validated.` }));
  return card(rows);
}

function energyCard(A) {
  const e = A.energy, bmr = A.bmr, T = D.T, rows = [];
  const frac = T ? T.now / 1440 : 1, restSoFar = bmr ? bmr * frac : null;
  const bandKcal = D.latest.summary?.day?.kcal ?? null;
  rows.push(row({ key: "energy", label: "Resting energy", value: bmr ? Math.round(bmr).toLocaleString() : "—", unit: bmr ? "kcal/day" : "", text: bmr ? "What your body burns at rest, from weight, height, age and sex (Mifflin–St Jeor 1990; about ±10% for most adults)." : "Needs height, weight, age and sex in Profile." }));
  rows.push(row({ key: "energy", label: "Active energy today", value: e?.active != null ? Math.round(e.active).toLocaleString() : "0", unit: "kcal", xp: true, text: `From heart rate during minutes above 30% of your heart-rate reserve (Keytel 2005). Wrist calorie estimates miss by 27–93% in studies (Shcherbina 2017), so read it as a rough guide.${bandKcal != null ? ` The band's own step-based estimate: ${Math.round(bandKcal)} kcal.` : ""}` }));
  if (restSoFar) rows.push(row({ key: "energy", label: "Total so far today", value: Math.round(restSoFar + (e?.active ?? 0)).toLocaleString(), unit: "kcal", text: `Resting energy up to ${ampm(T.now)} plus active energy.` }));
  return card(rows);
}

function bpCard(A) {
  const m = A.bp ?? { n: 0, need: 10 }, rows = [];
  if (!m.usable) {
    const best = m.models?.find((z) => z.name === m.best), last = m.models?.find((z) => z.name === "lastCuff");
    const total = (m.n ?? 0) + (m.need ?? 14);
    rows.push(row({ key: "bp", label: "Estimated blood pressure", value: "—", xp: true, text: (m.need ?? 14) > 0
      ? `Pulse learns your personal relationship between the band's signals and your cuff. Log ${m.need ?? 14} more cuff readings (${m.n ?? 0} of ${total}). It only shows an estimate once it predicts your cuff better than simply reusing your last reading.`
      : `Not yet: the best model misses your cuff by ${best?.maeSys?.toFixed(1) ?? "—"} mmHg vs ${last?.maeSys?.toFixed(1) ?? "—"} for your last reading, so no estimate is shown. Keep logging morning and evening readings.` }));
  } else {
    const pts = m.series?.points ?? [], lastP = pts[pts.length - 1];
    const best = m.models?.find((z) => z.name === m.best);
    rows.push(row({ key: "bp", label: "Estimated blood pressure", value: lastP ? `${Math.round(lastP.sys)}/${Math.round(lastP.dia)}` : "—", unit: "mmHg", xp: true, text: `Personal model (${esc(m.best)}) calibrated to ${m.n} cuff readings; misses by about ${best?.maeSys?.toFixed(1)} mmHg on readings it hadn't seen. Not for diagnosis (AHA); use your cuff for decisions.` }));
    if (m.series?.dipping?.sys != null) rows.push(row({ key: "bp", label: "Estimated night-time BP dip", value: m.series.dipping.sys.toFixed(0), unit: "%", xp: true, text: "Day vs night estimated systolic. Blood pressure normally falls 10–20% at night (a non-dipping pattern is linked with higher cardiovascular risk), but this is a model estimate, not an ambulatory reading." }));
  }
  return card(rows);
}

function metabolicCard() {
  const L = latestLabs();
  if (!Object.keys(L).length) return [cta(`<div class="adv-row" data-golabs2><b>Labs</b><span class="av">›</span><p>Import a lab PDF in Measure to see insulin resistance (HOMA-IR, TyG), lipid ratios, biological age and heart risk, each tied back to your band data.</p></div>`)];
  const d = derived(Object.fromEntries(Object.entries(L).map(([k, x]) => [k, x.value])), { bmi: bmiOf(D.profile) });
  const pick = ["homa_ir", "tyg", "tg_hdl", "remnant"].map((k) => d.find((z) => z.key === k)).filter(Boolean);
  const rows = pick.map((z) => row({ key: "labs", sheet: "labs", label: z.name, value: z.value, unit: z.unit, text: `${z.band[0]}. ${z.cite}` }));
  if (L.a1c) rows.push(row({ sheet: "labs", label: "HbA1c", value: L.a1c.value, unit: "%", text: "Average blood sugar over about 3 months. Pulse can't measure glucose from the band; this comes from your lab report." }));
  return card(rows.length ? rows : [row({ sheet: "labs", label: "Labs on file", value: Object.keys(L).length, text: "Add glucose, insulin, triglycerides and cholesterol to see metabolic indices." })]);
}

/** Rows for each Trends topic (each row: {ready, html, label, need}). */
export function topicRows() {
  const A = D.advData ?? {};
  const [illness, apnea, cvhr, lowO2] = watchCard(A), [sri, chrono, rhythm, dip] = clockCard(A);
  const fit = fitnessCard(A), en = energyCard(A), bp = bpCard(A), met = metabolicCard();
  const byLabel = (rows, l) => rows.find((r) => r.label === l);
  const heartFit = fit.filter((r) => r.label !== "Training load this week");
  return {
    sleep: [sri, chrono, apnea, cvhr, lowO2].filter(Boolean),
    heart: [illness, ...heartFit, dip, ...bp].filter(Boolean),
    activity: [byLabel(fit, "Training load this week"), ...en].filter(Boolean),
    body: [...met, rhythm].filter(Boolean),
    watch: illness,
  };
}

/** Explanation sheets for rows without a daily series. */
export function advSheet(key) {
  const A = D.advData ?? {}, p = (t) => `<p>${t}</p>`;
  const body = {
    illness: p("Two detectors watch your overnight heart rate against your own usual: NightSignal (Alavi 2022: +3 bpm for a night, or +4 bpm two nights running, shown only when temperature, breathing or disrupted sleep agree) and a CuSum change detector adapted from Mishra 2020. An alert needs both. Alcohol, travel, stress and hard evening exercise can also raise overnight heart rate.") + (A.illness?.reasons?.length ? p(`<b>Now:</b> ${esc(A.illness.reasons.join("; "))}`) : ""),
    apnea: p("STOP-Bang (Chung 2008/2012): snoring, tiredness, observed pauses, blood pressure, BMI over 35, age over 50, neck size and male sex. 0–2 low, 3–4 intermediate, 5–8 high risk of moderate-to-severe sleep apnea. Pulse adds low oxygen readings and the cyclic heart-rate pattern as supporting signs only; a sleep study is the test.") + (A.apnea?.text ? p(esc(A.apnea.text)) : ""),
    chrono: p("Chronotype is the middle of your sleep on free days (weekends here), corrected for the extra sleep people catch up on (Munich ChronoType Questionnaire; Roenneberg 2004). Social jetlag is the gap between weekday and weekend timing; larger gaps are associated with worse metabolic health (Wittmann 2006; Roenneberg 2012).") + (A.chrono ? p(`Free-day mid-sleep ${ampm(A.chrono.msf)}, weekday ${ampm(A.chrono.msw)}; ${A.chrono.nFree} free and ${A.chrono.nWork} work nights.`) : ""),
    rhythm: p("Non-parametric rhythm measures (Witting 1990; Van Someren 1999) on your hourly heart rate and skin temperature: interdaily stability (how alike each day is, 0–1), intradaily variability (how fragmented the rhythm is) and relative amplitude (active vs rest contrast). L5 and M10 are your quietest 5 and most active 10 hours.") + (A.hrRhythm ? p(`Heart rate: IS ${A.hrRhythm.is.toFixed(2)}, IV ${A.hrRhythm.iv.toFixed(2)}, RA ${A.hrRhythm.ra.toFixed(2)}; quietest 5 h from ${clock(A.hrRhythm.l5.start * 60)}, most active 10 h from ${clock(A.hrRhythm.m10.start * 60)}. ${A.hrRhythm.days} days.`) : ""),
    vo2: p("VO₂max (cardio fitness) is the strongest single fitness predictor of longevity, but measuring it needs a treadmill test. Pulse uses the Jackson 1990 non-exercise model: age, sex, BMI and an activity rating, which Pulse approximates from your typical steps (not validated for that). Its error is about ±5.6 ml/kg/min, and such models tend to read about 2 units high (Molina-Garcia 2022).") + (A.vo2 ? p(`Inputs: BMI ${A.vo2.inputs.bmi.toFixed(1)}, activity rating ${A.vo2.inputs.paR.toFixed(1)} from ${Math.round(A.vo2.inputs.stepsTypical).toLocaleString()} typical steps.`) : ""),
    hrr: p("Heart-rate recovery: how much your heart rate falls in the first minute after a detected workout ends. Faster recovery goes with better fitness and lower risk (Cole 1999). Free-living workouts end unevenly, so Pulse compares you only with yourself.") + (A.hrr?.series?.length ? p(A.hrr.series.slice(-6).map((z) => `${z.date.slice(5)}: ${z.hrr60 != null ? Math.round(z.hrr60) : "—"} bpm`).join(" · ")) : ""),
    load: p("Training load adds up heart-rate effort (Banister TRIMP, from your detected sessions) and, for sessions you tagged, effort × minutes (session RPE; Foster 2001). The two are shown separately because no combined 'strain' score has been validated."),
    energy: p("Resting energy uses Mifflin–St Jeor (1990). Active energy uses Keytel 2005's heart-rate equation during minutes above 30% of your heart-rate reserve. Wrist-worn calorie estimates carry large errors (27–93% in Shcherbina 2017), so these are for trends, not precise counting."),
    bp: p("There is no raw pulse waveform on this band, so the usual cuffless method (pulse arrival time) isn't possible. Instead Pulse fits a personal model on your cuff readings using the band's own BP estimate, heart rate, skin temperature, recent steps and time of day, and tests it on readings it hasn't seen (leave-one-out). It must beat both your average and your last cuff reading by at least 2 mmHg before any estimate is shown (Mukkamala 2015 on why calibration alone can mislead).") + (A.bp?.models ? `<div class="kv">${A.bp.models.map((z) => `<div><span>${esc(z.name)}</span><b>${z.maeSys != null ? `±${z.maeSys.toFixed(1)} mmHg` : "—"}</b></div>`).join("")}</div>` : ""),
    labs: p("Metabolic indices come from your lab panels with each paper's own formula (see Measure → Labs). The band can't measure blood glucose; nothing in its sensors tracks it reliably."),
  }[key] ?? p("No details yet.");
  const title = { illness: "Illness watch", apnea: "Sleep apnea screen", chrono: "Chronotype", rhythm: "Daily rhythm strength", vo2: "Cardio fitness", hrr: "Heart-rate recovery", load: "Training load", energy: "Energy", bp: "Blood pressure estimate", labs: "Metabolic health" }[key] ?? "Details";
  return `<div class="sh-h"><b>${title}</b><button class="back" data-sheetclose>Done</button></div>${body}`;
}
