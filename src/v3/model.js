// Turns what's stored on the phone (day summaries, raw band rows, tags, ECG sessions, cuff readings, labs)
// into the model the screens draw: one entry per calendar date (the night that ended that morning, and that
// day's activity), minute-level detail for any night on demand, and today minute by minute.
import * as db from "../core/db.js?v=20260925225520";
import { dayOf, toMs } from "../core/time.js?v=20260925225520";
import { assembleBursts, burstHRV, burstRespiration, irregularity } from "../analytics/ppi.js?v=20260925225520";
import { detectWorkouts } from "../analytics/workouts.js?v=20260925225520";
import { hrMaxFor, minuteSteps } from "../analytics/summary.js?v=20260925225520";
import { stepGoal } from "../analytics/scores.js?v=20260925225520";
import { ASK_RATE, dateDraw, median, triggers } from "./stats.js?v=20260925225520";
import { chronotype, hrRhythm, nocturnalDip, sri, sriSeries, tempRhythm } from "../analytics/bodyclock.js?v=20260925225520";
import { cardiacCostSeries, energy, hrrTrend, vo2max, vo2maxUth, weeklyLoad } from "../analytics/fitness.js?v=20260925225520";
import { apneaRisk, cusumRHR, illnessWatch } from "../analytics/watch.js?v=20260925225520";
import { fit as bpFit, series as bpSeries } from "../analytics/bpmodel.js?v=20260925225520";
import { cycles as cycleList, cyclePrompt, cycleStatus, detectShifts, perimenopause } from "../analytics/cycle.js?v=20260925225520";

const DAYMS = 864e5;
const addDays = (date, n) => { const d = new Date(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) + n); return dayOf(d); };
const minOfDay = (t) => +t.slice(11, 13) * 60 + +t.slice(14, 16) + +t.slice(17, 19) / 60;
/** Minutes from the evening's midnight (the day before `date`) to timestamp t. */
const fromEve = (t, date) => (toMs(t) - toMs(`${addDays(date, -1)} 00:00:00`)) / 60e3;

/** Everything the screens need except per-night minute detail (see nightDetail). */
export async function buildModel(store, profile) {
  const today = dayOf();
  const sums = (await db.all(store, "summary")).sort((a, b) => (a.date < b.date ? -1 : 1));
  const tagRows = await db.all(store, "tags");
  const nightTags = new Map(tagRows.filter((r) => r.tag === "night").map((r) => [r.date, r]));
  const byDate = new Map(sums.map((s) => [s.date, s]));
  const first = sums.length ? sums[0].date : today;
  const hist = [];
  for (let d = first; d <= today; d = addDays(d, 1)) hist.push(entry(byDate.get(d), d, today));
  // Temperature deviation vs your prior nights (°C), and the previous day's steps and late workouts.
  hist.forEach((h, i) => {
    const prev = hist[i - 1];
    h.stepsPrev = prev?.steps ?? null;
    const late = (prev?.workouts ?? []).find((w) => minOfDay(w.start) >= 19 * 60);
    h.t = { alcohol: false, caffeine: false, stress: false, workout: !!late && h.hasNight };
    h.lateWorkoutAt = late ? minOfDay(late.start) : null;
    const priorT = hist.slice(Math.max(0, i - 28), i).map((p) => p.tempC).filter((v) => v != null);
    h.tdev = h.tempC != null && priorT.length >= 3 ? h.tempC - median(priorT) : null;
    h.sick = false;
  });
  // Answers the person gave (from prompts), then what would trigger a question for each night.
  hist.forEach((h, i) => {
    const a = nightTags.get(h.date);
    h.trig = triggers(hist, i);
    h.checkIn = h.hasNight && !h.trig.length && dateDraw(h.date) < ASK_RATE;
    if (a) {
      for (const k of a.tags ?? []) if (k === "sick") h.sick = true; else if (k in h.t) h.t[k] = true;
      h.asked = true; h.answered = true; h.answer = a;
      h.w = a.via === "checkin" ? 1 / ASK_RATE : 1;
    } else { h.asked = false; h.w = h.trig.length ? 1 : 1 / ASK_RATE; }
  });
  const workoutTags = new Map(tagRows.filter((r) => r.tag.startsWith("workout ")).map((r) => [r.tag.slice(8), r]));
  // Cycle (female profiles): logged periods + nightly temperature; the luteal temperature rise is expected,
  // so it must not count as a "warm nights" illness trigger.
  let cycle = null;
  if (profile.sex === "female") {
    const periods = ((await db.getSetting(store, "periods")) ?? []).filter((p) => p?.start).sort((a, b) => (a.start < b.start ? -1 : 1));
    const nights = hist.map((h) => ({ date: h.date, temp: h.tempC, rhr: h.rhr }));
    const status = cycleStatus({ periods, nights, today }), cl = cycleList(periods);
    cycle = { periods, status, stats: cl.stats, cyclesList: cl.cycles, peri: perimenopause({ periods, profile }), prompt: cyclePrompt({ periods, today, status }), open: periods.some((p) => !p.end) };
    const starts = periods.map((p) => p.start);
    for (const sh of detectShifts(nights)) {
      const nextStart = starts.find((d) => d > sh.date);
      for (let j = sh.index; j < Math.min(hist.length, sh.index + 17); j++) { if (nextStart && hist[j].date >= nextStart) break; hist[j].trig = (hist[j].trig ?? []).filter((t) => t.k !== "temp"); hist[j].luteal = true; }
    }
  }
  // Advanced per-day values the drill-downs can trend.
  const sriBy = new Map(sriSeries(sums).map((x) => [x.date, x.sri]));
  for (const h of hist) {
    const sm = h.summary;
    h.sri7 = sriBy.get(h.date) ?? null;
    h.dipPct = sm ? nocturnalDip(sm)?.dipPct ?? null : null;
    h.cvhrIndex = sm?.night?.cvhr?.index ?? null;
    h.ccost = sm?.day?.cardiac_cost?.bpmPer100spm ?? null;
    h.stageHr = sm?.night?.stage_hr ?? null;
  }
  const L = hist.length - 1;
  const typical = typicalHourly(hist.slice(0, L));
  const bands = (await db.all(store, "band")).sort((a, b) => (a.last_sync < b.last_sync ? 1 : -1));
  const band = bands[0] ?? null;
  const T = await todayData(store, profile, hist, band, workoutTags);
  const last = hist[L];
  if (T) Object.assign(last, { steps: Math.max(last.steps ?? 0, T.steps), mvpa: T.mvpa, lightAct: T.light, moveH: T.moveH, dayHr: T.dayHr ?? last.dayHr, workouts: T.sessionsRaw });
  const ecg = (await db.all(store, "ecg")).sort((a, b) => (a.t < b.t ? -1 : 1));
  const bp = (await db.all(store, "bp")).sort((a, b) => (a.t < b.t ? -1 : 1));
  const labs = ((await db.getSetting(store, "labs")) ?? []).sort((a, b) => (a.date < b.date ? -1 : 1));
  const events = ((await db.getSetting(store, "events")) ?? []).filter((e) => e?.date).sort((a, b) => (a.date < b.date ? -1 : 1));
  const bandBp = (await db.all(store, "hrv_vendor")).filter((r) => r.bp_sys > 0 && r.hr > 0).map((r) => ({ t: r.t, sys: r.bp_sys, dia: r.bp_dia }));
  const cache = new Map();
  const hrmax = hrMaxFor(profile), rhrUsual = median(hist.slice(-29).map((h) => h.rhr));
  const tagsForLoad = [...workoutTags.values()].filter((t) => t.rpe != null).map((t) => ({ date: t.date, start: t.tag.slice(8), rpe: t.rpe, minutes: t.minutes }));
  const adv = {
    illness: illnessWatch(sums), cusum: cusumRHR(sums),
    apnea: apneaRisk(profile, sums.slice(-14), median(sums.slice(-14).map((z) => z.night?.cvhr?.index))),
    sri: sri(sums), chrono: chronotype(sums), hrRhythm: hrRhythm(sums), tempRhythm: tempRhythm(sums),
    vo2: vo2max(profile, sums), uth: hrmax && rhrUsual ? vo2maxUth({ hrmax, rhr: rhrUsual }) : null,
    hrr: hrrTrend(sums), ccost: cardiacCostSeries(sums), load: weeklyLoad(sums, tagsForLoad),
    energy: T?.energy ?? null, bmr: mifflin(profile), bp: await fitBp(store, bp, bandBp, ecg),
  };
  return {
    adv, cycle,
    hist, L, typical, today: T, band, ecg, bp, labs, events, bandBp, workoutTags, goal: profile.step_goal || stepGoal(profile.age ?? 40),
    /** Minute-level detail for night i (cached). */
    async night(i) {
      if (!cache.has(i)) cache.set(i, await nightDetail(store, hist[i]));
      return cache.get(i);
    },
  };
}

function entry(s, date, today) {
  const d = new Date(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)), dow = d.getDay(), eve = (dow + 6) % 7;
  const n = s?.night, sl = n?.sleep, day = s?.day, sc = s?.scores ?? {};
  const h = { date, d, dow, eve, wkend: eve === 5 || eve === 6, isToday: date === today, summary: s ?? null,
    hasNight: !!(sl || n?.hr?.rhr != null), hasSleep: !!sl, fallback: !!n?.fallback };
  if (sl) {
    Object.assign(h, { sleepH: sl.asleep / 60, onsetT: sl.onset, wakeT: sl.wake, onset: fromEve(sl.onset, date), wake: fromEve(sl.wake, date),
      waso: sl.waso, efficiency: sl.efficiency, awakenings: sl.awakenings, stagesRaw: n.stages ?? null, deep: sl.deep, rem: sl.rem, light: sl.light, naps: sl.naps ?? [] });
    h.mid = (h.onset + h.wake) / 2 - 1440;
  } else Object.assign(h, { sleepH: null, onset: null, wake: null, mid: null });
  h.rhr = n?.hr?.rhr ?? null; h.rhrTime = n?.hr?.rhr_time ?? null; h.nadirFrac = n?.hr?.nadir_frac ?? null; h.hrMeanNight = n?.hr?.mean ?? null;
  h.hrv = n?.ppi?.rmssd ?? n?.hrv?.median ?? null; h.hrvSrc = n?.ppi?.rmssd != null ? "ppi" : n?.hrv?.median != null ? "band" : null;
  h.hrvN = n?.ppi?.usable ?? n?.hrv?.n ?? 0; h.hrvOf = n?.ppi?.bursts ?? n?.hrv?.n ?? 0;
  h.br = n?.resp?.rate ?? null; h.spo2 = n?.spo2?.median ?? null; h.spo2Min = n?.spo2?.min ?? null; h.spo2N = n?.spo2?.n ?? 0; h.spo2Below90 = n?.spo2?.below90 ?? 0;
  h.tempC = n?.temp?.median ?? null; h.rhythm = n?.ppi?.rhythm ?? null;
  h.sleepScore = sc.sleep?.score ?? null; h.sleepParts = sc.sleep?.parts ?? [];
  h.rec = sc.recovery?.ready ? sc.recovery.score : null; h.recParts = sc.recovery?.parts ?? []; h.recNights = sc.recovery?.nights ?? 0; h.recNeed = sc.recovery?.need ?? 5;
  h.illness = sc.illness ?? null;
  h.steps = day?.steps ?? null; h.moveH = day?.activity?.active_hours ?? null; h.dayHr = day?.hr_mean_awake ?? null; h.workouts = day?.workouts ?? [];
  const wMin = (day?.workouts ?? []).reduce((a, w) => a + w.minutes, 0);
  h.mvpa = day ? Math.round(Math.max(day.activity?.mvpa_min ?? 0, wMin)) : null;
  h.lightAct = day?.activity?.light_min ?? null;
  h.trimp = day?.trimp ?? null;
  h.hourlySteps = day?.activity?.hourly ?? null; h.wear = day?.wear_min ?? null;
  const v = day?.vitals ?? {};
  h.spo2Day = v.spo2?.median ?? null; h.tempDay = v.temp?.median ?? null; h.hrvDay = v.hrv?.median ?? null; h.stressDay = v.stress?.median ?? null; h.brDay = v.resp?.rate ?? null;
  h.tempHourly = day?.temp_hourly ?? null;
  return h;
}

/** Resting energy, Mifflin–St Jeor (Mifflin et al., Am J Clin Nutr 1990;51:241-7): kcal/day. */
export function mifflin(p) {
  if (!p?.weight || !p?.height || !p?.age || !p?.sex) return null;
  return 10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === "male" ? 5 : -161);
}

/** The experimental cuff-calibrated BP model: gathers heart rate, temperature and steps around each cuff
 *  reading, runs the model ladder, and (only when a model is usable) estimates across the last 24 h. */
async function fitBp(store, cuff, bandBp, ecg) {
  if (cuff.length < 2) return { n: cuff.length, need: 14 - cuff.length, usable: false };
  const iso = (ms) => { const d = new Date(ms), p2 = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };
  const hr = [], temp = [], acts = new Map();
  for (const r of cuff.slice(-60)) {
    const t = toMs(r.t);
    hr.push(...(await db.range(store, "hr", iso(t - 12 * 60e3), iso(t + 60e3))));
    temp.push(...(await db.range(store, "temp", iso(t - 35 * 60e3), iso(t + 35 * 60e3))));
    const date = r.t.slice(0, 10);
    if (!acts.has(date)) acts.set(date, minuteSteps(await db.range(store, "activity", `${date} 00:00:00`, `${date} 23:59:59`)));
  }
  const ecgRows = ecg.map((e) => ({ t: e.t, hr: e.result?.hrv?.hr ?? null, qtc: null }));
  const ctx = { bandBp, hr, temp, ecg: ecgRows, stepsByMinute: (date, minute) => acts.get(date)?.get(minute) ?? 0 };
  const model = bpFit(cuff.slice(-60), ctx, { minN: 14 }); // 7 features: at least 2 readings each before trusting a fit
  const out = { ...model, models: model.models?.map(({ predict, ...m }) => m) };
  if (model.usable) {
    const now = Date.now(), from = iso(now - 864e5), to = iso(now);
    const hr24 = await db.range(store, "hr", from, to), temp24 = await db.range(store, "temp", from, to);
    const d0 = from.slice(0, 10), d1 = to.slice(0, 10);
    for (const d of [d0, d1]) if (!acts.has(d)) acts.set(d, minuteSteps(await db.range(store, "activity", `${d} 00:00:00`, `${d} 23:59:59`)));
    out.series = bpSeries(model, from, to, { ...ctx, hr: hr24, temp: temp24 });
  }
  return out;
}

/** Your usual steps for each clock hour (median of up to 28 prior days with step data), or null. */
function typicalHourly(prior) {
  const days = prior.filter((h) => h.hourlySteps && h.steps).slice(-28);
  if (days.length < 2) return null;
  return Array.from({ length: 24 }, (_, hh) => Math.round(median(days.map((h) => h.hourlySteps[hh])) ?? 0));
}

/** Minute detail for one night: stages, heart rate, the band's pulse recordings, SpO2 and temperature. */
export async function nightDetail(store, h) {
  if (!h?.hasNight) return null;
  const on = h.onsetT ?? `${h.date} 00:00:00`, wk = h.wakeT ?? `${h.date} 06:00:00`;
  const [hr, ppi, spo2, temp, hrv] = await Promise.all(["hr", "ppi", "spo2", "temp", "hrv_vendor"].map((s) => db.range(store, s, on, wk)));
  const t0 = toMs(on), N = Math.max(1, Math.round((toMs(wk) - t0) / 60e3));
  const at = (t) => Math.floor((toMs(t) - t0) / 60e3);
  let stages = null;
  if (h.stagesRaw?.length) {
    stages = new Array(N).fill(null);
    for (const [t, c] of h.stagesRaw) { const m = at(t); if (m >= 0 && m < N) stages[m] = c >= 1 && c <= 3 ? c : 4; }
    for (let m = 0; m < N; m++) if (stages[m] == null) stages[m] = m ? stages[m - 1] : 2;
  }
  const acc = Array.from({ length: N }, () => [0, 0]);
  for (const r of hr) { const m = at(r.t); if (m >= 0 && m < N) { acc[m][0] += r.bpm; acc[m][1]++; } }
  const hrMin = acc.map(([s, c]) => (c ? s / c : null));
  let bursts = assembleBursts(ppi).map((b) => {
    const m = at(b.t), v = burstHRV(b.ppi), r = burstRespiration(b.ppi), ir = irregularity(b.ppi);
    return { m, t: b.t, rmssd: v?.rmssd ?? null, ok: !!v, br: r?.rate ?? null, beats: b.ppi.length, irregular: !!ir?.irregular, screened: !!ir };
  }).filter((b) => b.m >= 0 && b.m < N);
  const src = bursts.length ? "ppi" : "band";
  if (!bursts.length) bursts = hrv.filter((r) => r.hrv_ms > 0 && r.hr > 0).map((r) => ({ m: at(r.t), t: r.t, rmssd: r.hrv_ms, ok: true, br: null, beats: null, irregular: false, screened: false }));
  return { N, onset: on, wake: wk, stages, hr: hrMin, bursts, good: bursts.filter((b) => b.ok), src,
    spo2: spo2.filter((r) => r.pct >= 70 && r.pct <= 100).map((r) => ({ m: at(r.t), pct: r.pct })),
    temp: temp.filter((r) => r.c > 25 && r.c < 42).map((r) => ({ m: at(r.t), c: r.c })),
    asleepMin: h.hasSleep ? Math.round(h.sleepH * 60) : null, onsetMin: h.onset ?? fromEve(on, h.date), wakeMin: h.wake ?? fromEve(wk, h.date) };
}

/** Today from waking to now: per-minute heart rate and steps, detected sessions, active and moving time. */
async function todayData(store, profile, hist, band, workoutTags) {
  const date = dayOf(), now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
  const L = hist.length - 1, h = hist[L];
  const [hrRows, act, spo2Rows, tempRows, hrvRows, ppiRows] = await Promise.all(["hr", "activity", "spo2", "temp", "hrv_vendor", "ppi"].map((st) => db.range(store, st, `${date} 00:00:00`, `${date} 23:59:59`)));
  const daily = (await db.all(store, "daily")).filter((r) => r.date === date).sort((a, b) => (b.steps ?? 0) - (a.steps ?? 0))[0];
  let wake = h.wakeT && h.wakeT.slice(0, 10) === date ? minOfDay(h.wakeT) : null;
  if (wake == null) { const firstHr = hrRows.find((r) => minOfDay(r.t) >= 300); wake = firstHr ? minOfDay(firstHr.t) : 7 * 60; }
  wake = Math.min(Math.floor(wake), nowMin - 1);
  const n = Math.max(1, nowMin - wake);
  const acc = Array.from({ length: n }, () => [0, 0]);
  for (const r of hrRows) { const k = Math.floor(minOfDay(r.t)) - wake; if (k >= 0 && k < n) { acc[k][0] += r.bpm; acc[k][1]++; } }
  const hr = acc.map(([s, c]) => (c ? s / c : null));
  const mins = minuteSteps(act), stepsMin = Array.from({ length: n }, (_, k) => mins.get(wake + k) ?? 0);
  const worn = hr.map((v, k) => v != null || hr.slice(Math.max(0, k - 3), k + 4).some((x) => x != null));
  const priorRhr = median(hist.slice(Math.max(0, L - 28), L).map((z) => z.rhr));
  const rest = h.rhr ?? priorRhr ?? 62, hrMax = hrMaxFor(profile) ?? 185;
  const hrr40 = rest + 0.4 * (hrMax - rest), hrr60 = rest + 0.6 * (hrMax - rest);
  const raw = profile.sex ? detectWorkouts(hrRows.filter((r) => minOfDay(r.t) >= wake).map((r) => [r.t, r.bpm]), rest, hrMax, { sex: profile.sex }) : [];
  const sessions = raw.map((w) => {
    const a = Math.floor(minOfDay(w.start)), b = Math.ceil(minOfDay(w.end)), seg = hr.slice(a - wake, b - wake).filter((v) => v != null);
    const st = stepsMin.slice(a - wake, b - wake), spm = st.reduce((x, y) => x + y, 0) / Math.max(1, b - a);
    const tag = workoutTags.get(w.start);
    return { a, b, start: w.start, min: Math.round(w.minutes), avg: w.mean ?? (seg.length ? seg.reduce((x, y) => x + y, 0) / seg.length : null), max: w.peak, spm,
      kind: spm >= 60 ? (spm >= 140 ? "run" : "walk") : null, tag, trimp: w.trimp ?? 0, hrr60: w.hrr60,
      zone: [seg.filter((v) => v < hrr60).length, seg.filter((v) => v >= hrr60).length] };
  });
  const inSession = (k) => sessions.some((s) => wake + k >= s.a && wake + k < s.b);
  const brisk = stepsMin.map((v, k) => v >= 100 || (inSession(k) && (hr[k] ?? 0) >= hrr40));
  const light = stepsMin.map((v, k) => !brisk[k] && v >= 60);
  const hourly = new Array(24).fill(0);
  for (const [m, v] of mins) hourly[Math.floor(m / 60)] += v;
  const nowH = now.getHours();
  const moveH = hourly.filter((v, hh) => hh >= 7 && hh < nowH && v >= 250).length;
  const still = []; let run = 0;
  for (let k = 0; k < n; k++) { if (worn[k] && stepsMin[k] < 10) run++; else { if (run) still.push(run); run = 0; } }
  const restHr = hr.filter((v, k) => v != null && !brisk[k] && stepsMin[k] < 20 && !inSession(k));
  const lastHr = hrRows[hrRows.length - 1];
  const snap = band?.snapshot?.hr && band.snapshot_at?.slice(0, 10) === date ? { bpm: band.snapshot.hr, t: band.snapshot_at } : null;
  const hrNow = snap && (!lastHr || snap.t > lastHr.t) ? snap : lastHr ? { bpm: lastHr.bpm, t: lastHr.t } : null;
  const perMin = stepsMin.reduce((a, b) => a + b, 0);
  const steps = Math.max(perMin, daily?.steps ?? 0, band?.snapshot_at?.slice(0, 10) === date ? band.snapshot?.steps ?? 0 : 0);
  const lastData = [lastHr?.t, act.length ? act[act.length - 1].t : null].filter(Boolean).sort().pop();
  const vals = hr.filter((v) => v != null);
  const en = energy(profile, { hrRows: hrRows, minuteSteps: mins, date, rhr: rest, hrmax: hrMax });
  // Daytime spot readings (since waking) and the latest of each, for the "Right now" grid.
  const aw = (t) => minOfDay(t) >= wake;
  const vit = {
    spo2: spo2Rows.filter((r) => aw(r.t) && r.pct >= 70 && r.pct <= 100).map((r) => ({ m: minOfDay(r.t), v: r.pct, t: r.t })),
    temp: tempRows.filter((r) => aw(r.t) && r.c > 25 && r.c < 42).map((r) => ({ m: minOfDay(r.t), v: r.c, t: r.t })),
    hrv: hrvRows.filter((r) => aw(r.t) && r.hrv_ms > 0 && r.hr > 0).map((r) => ({ m: minOfDay(r.t), v: r.hrv_ms, t: r.t })),
    stress: hrvRows.filter((r) => aw(r.t) && r.stress > 0 && r.hr > 0).map((r) => ({ m: minOfDay(r.t), v: r.stress, t: r.t })),
    br: assembleBursts(ppiRows.filter((r) => aw(r.t))).map((b) => ({ m: minOfDay(b.t), v: burstRespiration(b.ppi)?.rate ?? null, t: b.t })).filter((z) => z.v != null),
  };
  const latestOf = (k) => (vit[k].length ? vit[k][vit[k].length - 1] : null);
  const usualTempByHour = Array.from({ length: 24 }, (_, hh) => { const v = hist.slice(Math.max(0, L - 28), L).map((z) => z.tempHourly?.[hh]).filter((x) => x != null); return v.length >= 3 ? median(v) : null; });
  const lt = latestOf("temp"), usualTempNow = lt ? usualTempByHour[+lt.t.slice(11, 13)] : null;
  return { energy: en, vit, latest: { spo2: latestOf("spo2"), temp: latestOf("temp"), hrv: latestOf("hrv"), stress: latestOf("stress"), br: latestOf("br") }, usualTempNow, usualTempByHour, wake, now: nowMin, n, hr, stepsMin, sessions, sessionsRaw: raw, brisk, hourly, hrr40, hrr60, hrMax, rest, nowH, steps,
    mvpa: brisk.filter(Boolean).length, light: light.filter(Boolean).length, lightMin: light, moveH, stillNow: run, longestStill: Math.max(run, 0, ...still),
    dayHr: restHr.length >= 10 ? restHr.reduce((a, b) => a + b, 0) / restHr.length : null, hrNow,
    hrLo: vals.length ? Math.min(...vals) : null, hrHi: vals.length ? Math.max(...vals) : null,
    dataEnd: lastData && lastData.slice(0, 10) === date ? minOfDay(lastData) : null, hasData: vals.length > 0 || perMin > 0 };
}

export { DAYMS };
