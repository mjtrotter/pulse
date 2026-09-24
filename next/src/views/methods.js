// Methods & sources: what each number is, how Pulse computes it, and the research behind it.
import { card, cardHead, detailHeader, section } from "../ui/components.js?v=20260924162635";
import { h } from "../ui/h.js?v=20260924162635";

const M = [
  ["Sleep", [
    ["Sleep score", "Time asleep against the recommendation for your age (7–9 h; 7–8 h from 65), efficiency, time awake after falling asleep, timing regularity and deep + REM share. Weights are shown on the Sleep screen.", "Hirshkowitz 2015 (National Sleep Foundation); Watson 2015 (AASM/SRS); Windred 2024, Sleep"],
    ["Sleep stages", "The band's own estimate from motion and heart rate. Wrist devices get timing and duration right but miss short awakenings and blur stages, so stages carry little weight.", "Chinoy 2021, Sleep"],
    ["Sleep Regularity Index", "The probability of being in the same state (asleep or awake) at the same minute on consecutive days, scaled to −100…100. Needs 7 days.", "Phillips 2017, Scientific Reports; Windred 2024 (61,000 UK Biobank adults)"],
    ["Breathing during sleep", "STOP-Bang questionnaire (score ≥ 3: ~90% of moderate-to-severe sleep apnea) plus the band's overnight oxygen spot readings. The band cannot measure apnea events.", "Chung 2008/2016; Nagappa 2015 meta-analysis"],
  ]],
  ["Recovery", [
    ["Recovery score", "Last night against your own usual (median ± a robust spread of up to 28 nights): resting heart rate 30 points, overnight HRV 30, temperature 15, sleep 25. Starts after 5 nights.", "Plews 2013; Buchheit 2014; Shaffer & Ginsberg 2017"],
    ["Early-warning check", "Average overnight heart rate 3+ bpm above your usual (or 4+ two nights running), shown only when temperature, breathing rate or restless sleep agree.", "Alavi 2022, Nature Medicine (NightSignal); Natarajan 2020; Quer 2021; Mishra 2020"],
  ]],
  ["Heart", [
    ["Resting heart rate", "Lowest 30-minute average while asleep, from readings every ~5 seconds. Night-to-night noise is about 3 bpm.", "Quer 2020, PLOS ONE (92,000 wearable users); Zhang 2016, CMAJ"],
    ["Overnight HRV", "RMSSD from the band's beat-to-beat pulse recordings (~80 s each, up to every 10 minutes) during sleep, after removing movement artifacts; the night's median. At rest, pulse-rate variability tracks ECG HRV closely.", "Schäfer & Vagedes 2013; Munoz 2015; Lipponen & Tarvainen 2019"],
    ["Heart-rate zones & workouts", "Heart-rate reserve (Karvonen) with maximum 208 − 0.7 × age, or 164 − 0.7 × age if you take a beta-blocker. Workouts: 10+ minutes at 40%+ of reserve.", "Tanaka 2001; Brawner 2004; ACSM"],
    ["Recovery after effort", "Heart-rate drop in the minute after a workout, compared with your own typical drop.", "Cole 1999, NEJM"],
    ["Daily rhythm", "A 24-hour cosine fit to your hourly heart rate: average, swing and peak time.", "Cornelissen 2014 (cosinor method)"],
  ]],
  ["Rhythm", [
    ["Rhythm check (ECG)", "Finger ECG at ~256 Hz. Beats found in the waveform, noisy beats removed by shape, then beat-to-beat irregularity (normalized RMSSD, Shannon entropy, turning points). Inconclusive outside 50–120 bpm or with a noisy strip. A screen, not a diagnosis.", "Dash 2009, Annals of Biomedical Engineering; Orphanidou 2015; Perez 2019 (Apple Heart Study); Baek 2015"],
    ["Overnight pulse check", "The same irregularity measures on each sleeping pulse recording, without artifact correction. A night is flagged only when most recordings are irregular, like smartwatch irregular-rhythm notifications.", "Dash 2009; Perez 2019, NEJM"],
  ]],
  ["Activity", [
    ["Step goal", "7,000 a day from 60, 8,000 under 60: where the mortality benefit of more steps levels off.", "Paluch 2022, Lancet Public Health (15 cohorts, 47,000 adults)"],
    ["Active minutes", "Minutes at 100+ steps a minute (moderate intensity from age 21 to 85) or in heart-rate workouts, toward 150 a week.", "Tudor-Locke 2018/2021 (CADENCE-Adults); WHO 2020"],
    ["Workout load", "What you tag a workout as and how hard it felt (0–10) × minutes: the validated load measure for any exercise, including weights.", "Foster 2001; Sweet 2004"],
    ["Body clock", "Interdaily stability of your hourly activity over up to 14 days.", "Van Someren 1999"],
  ]],
  ["Breathing, oxygen & temperature", [
    ["Breathing rate", "The breathing rhythm in your heartbeat timing (respiratory sinus arrhythmia) within each sleeping pulse recording; the night's median.", "Charlton 2016/2018, Physiological Measurement"],
    ["Blood oxygen", "The band's spot readings while asleep. Typically within ±3–4% of a finger oximeter and less accurate on darker skin, so it's shown as a trend.", "Sjoding 2020, NEJM"],
    ["Skin temperature", "Median wrist temperature asleep, compared with your usual. Rises of ~0.5 °C often come with illness.", "Smarr 2020 and Mason 2022, Scientific Reports (TemPredict)"],
    ["Cycle phase (optional)", "Three nights in a row ≥ 0.2 °C above the previous six marks the post-ovulation rise. Retrospective only.", "Shilaih 2018; Maijala 2019; Human Reproduction 2025 (Apple Women's Health Study)"],
  ]],
  ["Blood pressure", [
    ["Home average", "Readings from your own cuff, averaged over 7 days (first day dropped once there are 4+ days), with the American Heart Association categories.", "Whelton 2017 ACC/AHA guideline (categories kept in 2025); Muntner 2019 AHA home-monitoring statement"],
  ]],
];

export default async function methods(ctx) {
  const screen = h("div.screen", detailHeader(() => ctx.back()), h("header.head", h("div.titles", h("span.eyebrow", "How Pulse works"), h("h1", "Methods & sources"))));
  screen.append(h("p.note", { style: { padding: "0 4px" } }, "Every number is computed on your phone from the band's raw readings. Scores compare you with yourself. Where the band can't support a measurement, Pulse leaves it out."));
  for (const [title, items] of M) {
    screen.append(section(title));
    screen.append(card(h("div.rows", items.map(([name, how, src]) => h("div.row", { style: { display: "block" } },
      h("b", { style: { display: "block", fontWeight: 600, marginBottom: "4px" } }, name),
      h("p.note", how),
      h("p", { style: { fontSize: "13px", color: "var(--ink-3)", marginTop: "4px" } }, src))))));
  }
  screen.append(section("What Pulse doesn't do"));
  screen.append(card(h("p.note", "Diagnose anything; estimate blood pressure from the band (it isn't accurate enough); measure sleep apnea events or oxygen dips second by second; estimate VO₂max; score \"strain\" (no validated method exists); detect hot flashes (needs a skin-conductance sensor).")));
  return screen;
}
