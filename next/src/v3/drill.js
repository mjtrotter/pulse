// The metric catalog and the full-screen drill-down every tile opens: headline value, bands (population,
// your usual, what your sleep predicts), a plain-language read, then four views: the night/day itself,
// Over time, Your range and What affects it.
import { tempC } from "../core/units.js?v=20260925073227";
import { clamp, drivers, expected, MIN_MODEL, MIN_TAGGED, MIN_USUAL, mean, median, sd, TAGS, usualRange } from "./stats.js?v=20260925073227";
import { labContext } from "./labsui.js?v=20260925073227";
import { nightChannels } from "./nightmon.js?v=20260925073227";
import { dayMontage, workoutPrompts, workoutsList } from "./daymon.js?v=20260925073227";
import { ampm, cap1, clock, css, D, dname, dur, esc, eveOf, glow, glowDef, hm, hr12, isLatest, MON, nightName, ord, poly, q, S, sc, scrubbable, short, sign, smooth, smoothRuns, st, stageColor, stageName, tDelta, tUnit, uid, DAYS } from "./kit.js?v=20260925073227";

const ALL = ["sleep", "alcohol", "caffeine", "stress", "workout"];
const decade = (age) => Math.min(70, Math.max(20, Math.floor((age ?? 40) / 10) * 10));
// Approximate age bands for overnight RMSSD (ms): median ± ~1 SD from short-term and nocturnal adult
// samples (Nunan 2010; Voss 2015; Tegegne 2020). Placeholders until the published norm tables are pulled.
const HRV_NORM = { 20: [26, 74], 30: [21, 60], 40: [17, 48], 50: [14, 40], 60: [12, 34], 70: [10, 30] };
const decLbl = (age) => (decade(age) >= 70 ? "70+" : `${decade(age)}s`);

export const paceFrac = () => {
  if (!D.typical) return null;
  const tot = D.typical.reduce((a, b) => a + b, 0); if (!tot) return null;
  let c = 0; D.typical.forEach((v, hh) => { if (hh < D.T.nowH) c += v; else if (hh === D.T.nowH) c += (v * (D.T.now % 60)) / 60; });
  return c / tot;
};
export const M = {
  recovery: { lc: "recovery score", title: "Recovery", unit: "", color: "--good", get: (h) => h.rec, f: (v) => Math.round(v), better: 1, drivers: ALL, q: 4 },
  sleep: { lc: "sleep", title: "Sleep", unit: "", color: "--sleep", get: (h) => h.sleepH, f: (v) => hm(v), fa: (v) => v.toFixed(1), big: (v) => { const t = Math.round(v * 60); return `${Math.floor(t / 60)}<small>h</small> ${String(t % 60).padStart(2, "0")}<small>m</small>`; },
    pop: () => ((D.profile.age ?? 40) >= 65 ? [7, 8] : [7, 9]), popLbl: () => `Need (${(D.profile.age ?? 40) >= 65 ? "65+" : "18–64"})`, better: 1, drivers: ["alcohol", "caffeine", "stress", "workout", "steps"], q: 4 },
  hrv: { lc: "overnight HRV", title: "Overnight HRV", unit: "ms", color: "--hrv", get: (h) => h.hrv, f: (v) => v.toFixed(0), pop: () => HRV_NORM[decade(D.profile.age)], popLbl: () => `Typical ${decLbl(D.profile.age)} (approx.)`, model: true, better: 1, drivers: ALL, q: 4 },
  rhr: { lc: "resting heart rate", title: "Resting heart rate", unit: "bpm", color: "--heart", get: (h) => h.rhr, f: (v) => v.toFixed(1), fa: (v) => v.toFixed(0), pop: () => (D.profile.sex === "female" ? [51, 73] : [48, 70]), popLbl: () => "Typical asleep", model: true, better: -1, drivers: ALL, q: 5 },
  breath: { lc: "breathing rate", title: "Breathing rate asleep", unit: "/min", color: "--breath", get: (h) => h.br, f: (v) => v.toFixed(1), pop: () => [12, 20], popLbl: () => "Adults asleep", better: 0, drivers: ["alcohol", "sleep"], q: 3 },
  spo2: { lc: "oxygen level", title: "Oxygen asleep", unit: "%", color: "--spo2", get: (h) => h.spo2, f: (v) => v.toFixed(0), fa: (v) => v.toFixed(1), pop: () => [95, 100], popLbl: () => "Healthy adults", better: 1, drivers: ["alcohol", "sleep"], q: 3 },
  temp: { lc: "skin temperature", title: "Skin temperature", unit: "", color: "--temp", get: (h) => (h.tdev == null ? null : tDelta(h.tdev)), f: (v) => `${sign(v)}°`, pop: () => [tDelta(-0.5), tDelta(0.5)], popLbl: () => "Normal swing", better: -1, drivers: ["alcohol", "workout"], q: 4 },
  timing: { lc: "sleep midpoint", title: "Sleep timing", unit: "", color: "--sleep2", get: (h) => h.mid, f: (v) => clock(v), big: (v) => `${clock(v)}<small>${((v % 1440) + 1440) % 1440 >= 720 ? "PM" : "AM"}</small>`, fd: (v) => `${Math.round(v)} min`, noCv: true, better: 0, drivers: ["alcohol", "caffeine", "stress"], q: 4 },
  sri: { lc: "sleep regularity", title: "Sleep regularity (SRI)", unit: "", color: "--sleep2", get: (h) => h.sri7, f: (v) => Math.round(v).toString(), better: 1, drivers: ["alcohol", "caffeine", "stress"], q: 3 },
  dip: { lc: "night-time heart-rate dip", title: "Night-time heart-rate dip", unit: "%", color: "--heart", get: (h) => h.dipPct, f: (v) => v.toFixed(0), better: 1, drivers: ["alcohol", "workout", "sleep"], q: 2, xp: true },
  cvhr: { lc: "cyclic heart-rate index", title: "Cyclic heart-rate pattern", unit: "/h", color: "--breath", get: (h) => h.cvhrIndex, f: (v) => v.toFixed(1), better: -1, drivers: ["alcohol", "sleep"], q: 1, xp: true },
  ccost: { day: true, lc: "cardiac cost of walking", title: "Cardiac cost of walking", unit: "bpm", color: "--heart", get: (h) => h.ccost, today: () => D.latest?.ccost ?? null, frac: () => 1, f: (v) => v.toFixed(0), better: -1, drivers: ["sleep", "alcohol"], q: 2, xp: true },
  activity: { day: true, lc: "activity", title: "Activity", unit: "%", color: "--act", get: (h) => (h.steps != null ? (100 * h.steps) / D.goal : null), today: () => (D.T ? (100 * D.T.steps) / D.goal : null), frac: paceFrac, f: (v) => Math.round(v).toString(), pop: () => [100, 150], popLbl: () => "Daily goal", better: 1, drivers: ["sleep", "alcohol", "stress"], q: 5 },
  spo2d: { day: true, lc: "daytime oxygen", title: "Oxygen (daytime)", unit: "%", color: "--spo2", get: (h) => h.spo2Day, today: () => D.T?.latest?.spo2?.v ?? null, frac: () => 1, f: (v) => v.toFixed(0), fa: (v) => v.toFixed(1), pop: () => [95, 100], popLbl: () => "Healthy adults", better: 1, drivers: ["sleep"], q: 3, vit: "spo2" },
  tempd: { day: true, lc: "skin temperature", title: "Skin temperature (daytime)", unit: "", color: "--temp", get: (h) => (h.tempDay == null ? null : tempC(h.tempDay)), today: () => (D.T?.latest?.temp ? tempC(D.T.latest.temp.v) : null), frac: () => 1, f: (v) => `${v.toFixed(1)}°`, better: 0, drivers: ["alcohol", "stress"], q: 3, vit: "temp" },
  hrvd: { day: true, lc: "daytime HRV", title: "HRV spot checks (daytime)", unit: "ms", color: "--hrv", get: (h) => h.hrvDay, today: () => D.T?.latest?.hrv?.v ?? null, frac: () => 1, f: (v) => v.toFixed(0), better: 1, drivers: ["sleep", "alcohol", "stress"], q: 2, vit: "hrv" },
  breathd: { day: true, lc: "daytime breathing rate", title: "Breathing (daytime)", unit: "/min", color: "--breath", get: (h) => h.brDay, today: () => D.T?.latest?.br?.v ?? null, frac: () => 1, f: (v) => v.toFixed(1), better: 0, drivers: ["sleep"], q: 2, vit: "br" },
  stressd: { day: true, lc: "band stress score", title: "Stress (band score)", unit: "", color: "--watch", get: (h) => h.stressDay, today: () => D.T?.latest?.stress?.v ?? null, frac: () => 1, f: (v) => Math.round(v).toString(), better: -1, drivers: ["sleep", "alcohol", "stress"], q: 1, xp: true, vit: "stress" },
  steps: { day: true, lc: "steps", title: "Steps", unit: "", color: "--steps", get: (h) => h.steps, today: () => D.T?.steps, frac: paceFrac, f: (v) => Math.round(v).toLocaleString(), pop: () => [D.goal, D.goal * 1.5], popLbl: () => "Daily goal", better: 1, drivers: ["sleep", "alcohol", "stress"], q: 5 },
  hrday: { day: true, lc: "daytime heart rate", title: "Daytime heart rate", unit: "bpm", color: "--heart", get: (h) => h.dayHr, today: () => D.T?.dayHr, frac: () => 1, f: (v) => v.toFixed(0), pop: () => [60, 100], popLbl: () => "Adults at rest", better: -1, drivers: ["sleep", "alcohol", "stress"], q: 5 },
  mvpa: { day: true, lc: "brisk minutes", title: "Brisk minutes", unit: "min", color: "--act", get: (h) => h.mvpa, today: () => D.T?.mvpa, frac: paceFrac, f: (v) => Math.round(v).toString(), pop: () => [150 / 7, 300 / 7], popLbl: () => "Guideline pace", better: 1, drivers: ["sleep", "stress"], q: 4 },
  light: { day: true, lc: "light activity", title: "Light activity", unit: "min", color: "--act2", get: (h) => h.lightAct, today: () => D.T?.light, frac: paceFrac, f: (v) => Math.round(v).toString(), better: 1, drivers: ["sleep", "stress"], q: 4 },
  moveH: { day: true, lc: "moving hours", title: "Moving hours", unit: "h", color: "--breath", get: (h) => h.moveH, today: () => D.T?.moveH, frac: () => clamp((D.T.nowH - 7) / 15, 0.05, 1), f: (v) => Math.round(v).toString(), fa: (v) => v.toFixed(1), better: 1, drivers: ["sleep", "stress"], q: 4 },
};
export const popOf = (m) => (typeof m.pop === "function" ? m.pop() : m.pop) ?? null;
const popLbl = (m) => (typeof m.popLbl === "function" ? m.popLbl() : m.popLbl ?? "");
export const expOf = (key) => (M[key].model ? expected(D.H, M[key].get, D.last?.sleepH) : null);
const fa = (m) => m.fa ?? m.f;

export function bandsOf(key) {
  const m = M[key];
  if (m.day) {
    const days = D.hist.slice(0, -1).filter((h) => m.get(h) != null), prior = days.slice(-28).map(m.get), f = m.frac();
    const u = usualRange(prior);
    return { m, ser: days, cur: m.today(), rcur: days.length ? m.get(days[days.length - 1]) : null, you: u && f != null ? [u.lo * f, u.hi * f] : null, full: u, frac: f, e: null };
  }
  const ser = D.H.filter((h) => m.get(h) != null), prior = D.H.slice(0, -1).map(m.get);
  const u = usualRange(prior);
  return { m, ser, cur: D.last ? m.get(D.last) : null, you: u ? [u.lo, u.hi] : null, full: u, frac: 1, e: expOf(key) };
}
function bandRow(lbl, b, style, cur, lo, hi, m) {
  const W0 = 230, x = sc(lo, hi, 5, W0 - 5);
  return `<div class="band"><span>${lbl}</span>${S(W0, 20, `<line x1="5" x2="${W0 - 5}" y1="10" y2="10" stroke="${css("--track")}" stroke-width="3" stroke-linecap="round"/><rect x="${x(b[0])}" y="4" width="${Math.max(4, x(b[1]) - x(b[0]))}" height="12" rx="6" fill="${style === "pop" ? css("--ink3") : css(m.color)}" opacity="${style === "pop" ? 0.25 : style === "exp" ? 0.5 : 0.28}"/>${cur != null ? `<circle cx="${clamp(x(cur), 5, W0 - 5)}" cy="10" r="5.5" fill="${css(m.color)}" stroke="${css("--bg")}" stroke-width="2"/>` : ""}`)}<span class="bv">${fa(m)(b[0])}–${fa(m)(b[1])}</span></div>`;
}
function havePrior(m) { return D.H.slice(0, -1).filter((h) => m.get(h) != null).length; }

function ctxText(key, B) {
  const { m, cur, you, e } = B, T = D.T, h = D.last;
  if (cur == null) return m.day ? `No ${m.lc} recorded yet today. Wear the band and sync to fill this in.` : `No ${m.lc} for ${isLatest() ? "last night" : "that night"}. ${h?.hasSleep ? "The band didn't record enough readings." : "The band didn't record sleep that night."}`;
  const need = MIN_USUAL - havePrior(m);
  const usualTxt = you ? "" : ` Your usual appears after ${MIN_USUAL} nights (${Math.max(1, need)} to go).`;
  if (e) {
    const dSleep = h.sleepH - median(D.H.slice(-29, -1).map((z) => z.sleepH));
    const inside = cur >= e.lo && cur <= e.hi, worse = m.better * (cur - e.center) < 0, askable = !h.asked && (h.trig?.length || h.checkIn);
    const per = `In your data each hour of sleep moves ${m.lc} by ${Math.abs(e.slope).toFixed(1)} ${m.unit} (±${(1.96 * e.slopeSe).toFixed(1)}), so ${isLatest() ? "expected tonight" : "expected that night"} was ${m.f(e.lo)}–${m.f(e.hi)} ${m.unit}.`;
    return `${Number.isFinite(dSleep) ? `You slept ${dur(dSleep)} ${dSleep < 0 ? "less" : "more"} than usual. ` : ""}${per} <b>${m.f(cur)} ${m.unit} is ${inside ? "inside that range" : cur < e.lo ? "below that range" : "above that range"}.</b>${!inside && worse ? ` Something besides sleep is likely involved.${askable ? ` <button class="chip" style="margin-top:8px" data-close data-goto="prompt">Answer Pulse's question</button>` : ""}` : ""}`;
  }
  if (key === "sleep") {
    const us = median(D.H.slice(-29, -1).map((z) => z.sleepH)), parts = (h.sleepParts ?? []).map((p) => `${p.label.toLowerCase()} ${p.points}/${p.max}`).join(", ");
    return `${hm(cur)} asleep${us != null ? `, ${dur(cur - us)} ${cur < us ? "under" : "over"} your usual ${hm(us)}` : ""}. Adults ${(D.profile.age ?? 40) >= 65 ? "65+ need 7–8 h" : "need 7–9 h"} (National Sleep Foundation).${h.sleepScore != null ? ` Sleep score ${h.sleepScore}: ${parts}.` : ""}`;
  }
  if (key === "recovery") return `A blend of up to four parts, each compared with your own last 28 nights. Open <b>${isLatest() ? "Last night" : "That night"}</b> to see every part and the math.`;
  if (key === "timing") { const um = median(D.H.slice(-15, -1).map((z) => z.mid)); return `Asleep ${ampm(h.onset)}, up ${ampm(h.wake)}.${um != null ? ` The middle of your sleep was ${Math.round(Math.abs(cur - um))} min ${cur >= um ? "later" : "earlier"} than your usual (${ampm(um)}).` : " Your usual timing appears after a few nights."}`; }
  if (key === "steps") return `${T.steps.toLocaleString()} so far today, ${Math.round((100 * T.steps) / D.goal)}% of ${D.goal.toLocaleString()}.${you ? ` By ${ampm(T.now)} you usually have ${m.f(you[0])}–${m.f(you[1])}.` : ""}${B.rcur != null ? ` Yesterday: <b>${m.f(B.rcur)}</b>.` : ""} Adults ${(D.profile.age ?? 40) >= 60 ? "60+ get most of the benefit by ~7,000" : "under 60 get most of the benefit by ~8,000"} a day (Paluch 2022).`;
  if (key === "hrday") return `Averaging <b>${cur.toFixed(0)} bpm</b> while awake and not exercising${you ? `, ${cur >= you[0] && cur <= you[1] ? "inside" : cur > you[1] ? "above" : "below"} your usual ${m.f(you[0])}–${m.f(you[1])}` : ""}.${T.hrNow ? ` Latest reading: ${Math.round(T.hrNow.bpm)} bpm.` : ""}${T.hrHi ? ` Highest today ${Math.round(T.hrHi)}.` : ""}`;
  if (key === "mvpa") return `<b>${T.mvpa} active minutes</b> today and ${D.week} over the last 7 days, toward the 150 a week of moderate activity adults need (AHA, WHO). Heart-rate sessions count, so strength work isn't missed.`;
  if (key === "activity") return `<b>${T.steps.toLocaleString()} steps</b> so far, ${Math.round(cur)}% of your ${D.goal.toLocaleString()} goal, with ${T.mvpa} brisk and ${T.light} light minutes${T.sessions.length ? ` and ${T.sessions.length} workout${T.sessions.length > 1 ? "s" : ""}` : ""}.${you ? ` By ${ampm(T.now)} you usually reach ${Math.round(you[0])}–${Math.round(you[1])}%.` : ""}`;
  if (M[key].vit) { const l = D.T?.latest?.[M[key].vit], ago = l ? Math.round((Date.now() - new Date(l.t.replace(" ", "T")).getTime()) / 60e3) : null; return `Latest reading <b>${m.f(cur)}${m.unit ? ` ${m.unit}` : ""}</b>${ago != null ? ` at ${ampm(+l.t.slice(11, 13) * 60 + +l.t.slice(14, 16))}` : ""}${key === "tempd" && D.T.usualTempNow != null ? `, ${sign(tDelta(D.T.latest.temp.v - D.T.usualTempNow))}° vs your usual for that hour` : ""}.${you ? ` Your usual daytime ${m.lc}: ${fa(m)(B.full.lo)}–${fa(m)(B.full.hi)}.` : " Your usual appears after 5 days."}${key === "hrvd" ? " Daytime HRV swings with posture, movement and stress; the overnight value on the Night tab is the steadier one." : key === "stressd" ? " This is the band's own score; its formula isn't published, so Pulse only tracks it against your own history." : key === "spo2d" ? " Wrist oxygen readings are about ±3–4%; brief lows during movement are common." : ""}`; }
  if (key === "light") return `<b>${T.light} minutes of light walking</b> today (60–99 steps a minute), plus ${T.mvpa} brisk. Any movement counts: light activity is linked with lower mortality even without brisk exercise (Ekelund 2019).`;
  if (key === "moveH") return `You moved (250+ steps) in <b>${T.moveH} of the ${Math.max(0, T.nowH - 7)} hours</b> since 7 AM. Longest still stretch today: ${short(T.longestStill)}. Short walking breaks during long sitting lower blood sugar and insulin after meals (Dunstan 2012).`;
  if (key === "spo2") return `Spot readings through the night${h.spo2N ? ` (${h.spo2N} of them, lowest ${h.spo2Min}%)` : ""}. These can show a low night but can't count breathing pauses; that needs a sleep study or a 1-second oximeter.${usualTxt}`;
  if (!you) return `${cap1(m.lc)} ${m.f(cur)}${m.unit ? ` ${m.unit}` : ""}.${usualTxt}`;
  const inside = cur >= you[0] && cur <= you[1];
  return `${inside ? "Inside" : cur < you[0] ? "Below" : "Above"} your usual range (median ± one typical swing, last 28 nights).`;
}

export function drill(key, backLabel) {
  const B = bandsOf(key), { m, cur, you, e } = B, pop = popOf(m), T = D.T, h = D.last;
  const cands = [cur, ...(you ?? []), ...(pop ?? []), ...(e ? [e.lo, e.hi] : [])].filter((v) => v != null && Number.isFinite(v));
  const span = cands.length ? Math.max(...cands) - Math.min(...cands) || 1 : 1;
  const lo = cands.length ? Math.min(...cands) - span * 0.1 : 0, hi = cands.length ? Math.max(...cands) + span * 0.1 : 1;
  const views = [["now", m.day ? "Today" : isLatest() ? "Last night" : "That night"], ["time", "Over time"], ["range", "Your range"], ["affects", "What affects it"]];
  const status = cur == null ? "" : e ? (cur >= e.lo && cur <= e.hi ? "within expected" : cur < e.lo ? "below expected" : "above expected") : you ? (cur >= you[0] && cur <= you[1] ? "within your usual" : cur < you[0] ? "below your usual" : "above your usual") : "building your usual";
  const ev = h ? eveOf(h) : null;
  const meta = m.day ? `Today so far · ${ampm(T.now)}<br>${key === "steps" ? `${Math.round((100 * T.steps) / D.goal)}% of daily goal` : key === "mvpa" ? `${D.week} min over 7 days` : key === "light" ? `${T.mvpa} brisk as well` : key === "hrday" ? (T.hrNow ? `latest ${Math.round(T.hrNow.bpm)} bpm` : "no reading yet") : `${Math.max(0, T.nowH - 7)} hours so far`}<br>${status}`
    : `Night of ${MON[ev.getMonth()]} ${ev.getDate()} → ${h.d.getDate()}<br>${["hrv", "breath"].includes(key) && h.hrvOf ? `${h.hrvN} of ${h.hrvOf} recordings usable` : key === "spo2" && h.spo2N ? `${h.spo2N} readings` : h.hasSleep ? `${ampm(h.onset)} – ${ampm(h.wake)}` : "no sleep record"}<br>${status}`;
  const bandsHtml = key === "timing" || cur == null ? "" : `<div class="bands">${pop ? bandRow(popLbl(m), pop, "pop", cur, lo, hi, m) : ""}${you ? bandRow(m.day && B.frac < 1 ? `Usual by ${clock(T.now)}` : "Your usual", you, "you", cur, lo, hi, m) : ""}${e ? bandRow(isLatest() ? "Expected tonight" : "Expected", [e.lo, e.hi], "exp", cur, lo, hi, m) : ""}</div>`;
  return `<div class="aurora"><i class="a"></i><i class="b"></i><i class="c"></i></div><div class="inner">
    <div class="m-top"><button class="back" data-close>‹ ${backLabel}</button>${q(m.q)}</div>
    <div class="lbl m-lbl">${m.title}${m.xp ? ' <span class="xp">experimental</span>' : ""}${m.day ? " · today" : isLatest() ? "" : ` · ${nightName(h)}`}</div>
    <div class="m-hero"><div class="m-big">${cur == null ? "—" : m.big ? m.big(cur) : `${m.f(cur)}<small>${m.unit}</small>`}</div><div class="m-meta">${meta}</div></div>
    ${bandsHtml}
    <div class="ctx">${ctxText(key, B)}</div>
    ${D.profile?.sex === "female" && D.last?.luteal && !M[key].day && ["temp", "rhr", "hrv", "recovery"].includes(key) ? `<div class="labctx"><span class="lbl">Cycle</span><p>This was in your luteal phase, when skin temperature normally runs about 0.3 °C higher and resting heart rate about 2 bpm higher (Shilaih 2017, 2018). Pulse doesn't count that rise as a sign of illness.</p></div>` : ""}
    ${labContext(key)}
    <div class="seg">${views.map(([k, l]) => `<button data-view="${k}" class="${st.view === k ? "on" : ""}">${l}</button>`).join("")}</div>
    ${st.view === "time" || st.view === "range" ? `<div class="agg">${st.view === "time" ? `<button data-split class="ov ${st.split ? "on" : ""}">Weekday vs weekend</button><button data-showtags class="ov ${st.showTags ? "on" : ""}">Tags</button><span class="grow"></span>` : ""}${[["30", "30D"], ["90", "90D"], ["365", "1Y"]].map(([k, l]) => `<button data-agg="${k}" class="${st.agg === k ? "on" : ""}">${l}</button>`).join("")}</div>` : ""}
    <div class="card viz">${renderView(key, B)}</div>
    ${(key === "recovery" || key === "sleep") && st.view === "now" && D.nt ? `<div class="sec"><h2>Across the night</h2></div>${nightChannels("data-open2")}` : ""}
    ${key === "activity" && st.view === "now" && D.T?.hasData ? `<div class="sec"><h2>Across the day</h2></div>${dayMontage("data-open2")}<div class="sec"><h2>Workouts</h2><span class="lbl">detected from heart rate</span></div>${workoutPrompts() ? `<div class="stack">${workoutPrompts()}</div>` : ""}<div class="card">${workoutsList()}</div>` : ""}
    ${explain(key)}</div>`;
}

function explain(key) {
  const T = D.T, h = D.last;
  const txt = {
    hrv: h?.hrvSrc === "band" ? `The band's own HRV estimate (RMSSD) from its ~80-second pulse recordings while you sleep; the night's value is their median. Pulse computes its own RMSSD when the pulse-interval records are available.` : `RMSSD (beat-to-beat variation) computed on your phone from the band's own ~80-second pulse recordings while you sleep. Movement artifacts are removed beat by beat (Lipponen & Tarvainen 2019); recordings with more than 20% corrected beats are dropped. The night's value is the median of the usable ones.`,
    rhr: `The lowest 30-minute average of the band's 5-second heart rate while asleep. Timing of the low point matters too: a late low often follows alcohol, a late meal or illness.`,
    breath: `Breaths per minute from the rhythmic speed-up and slow-down of your pulse with each breath (respiratory sinus arrhythmia), measured in each clean pulse recording; the night's value is their median. A rise of 1.5/min or more over your usual can come with illness.`,
    spo2: `The band's own blood-oxygen spot readings while you sleep. Healthy adults usually stay at 95% or above; brief dips to the low 90s happen. Wrist SpO2 is about ±3–4% and can read low with movement or a loose band.`,
    temp: `Wrist skin temperature while asleep (skipping the first 30 minutes), compared with your usual. Two or more warm nights can come before a cold; alcohol and a warm room also raise it.`,
    sleep: `Sleep stages come from the band's own classifier (movement + heart rate). Stage minutes from wrist bands are rough; total sleep, timing and regularity are the reliable parts.`,
    recovery: `Recovery weights resting heart rate 30, overnight HRV 30, temperature 15 and sleep 25, each scored against your own median and spread over up to 28 prior nights (5 needed). Parts without a baseline yet are left out and the rest re-weighted.`,
    timing: `The midpoint is halfway between falling asleep and waking. Regular timing matters on its own: in about 60,000 UK Biobank adults, sleep regularity predicted mortality better than sleep length did (Windred 2024).`,
    steps: `Per-minute step counts from the band. Walking briskly is about 100+ steps a minute (Tudor-Locke 2018). "Usual by now" scales your usual day by how much of it you normally have done by this time.`,
    hrday: `The band's 5-second heart rate while you're awake, leaving out workouts and walking. A daytime average that creeps up over several days can come with poor sleep, illness or dehydration.`,
    light: `Minutes of walking at 60–99 steps a minute: slower than brisk, but still movement. Light activity is linked with lower mortality on its own, with most of the benefit in the first hours a day (Ekelund 2019, BMJ meta-analysis of accelerometer studies). Brisk minutes are counted separately.`,
    mvpa: `A minute counts when you walk at 100+ steps a minute (Tudor-Locke 2018), or when your heart rate is at or above 40% of your heart-rate reserve during a detected session (${Math.round(T?.hrr40 ?? 0)}+ bpm for you; max heart rate from ${D.profile.betablocker ? "Brawner 2004 for beta-blockers" : "208 − 0.7 × age, Tanaka 2001"}).`,
    sri: `Sleep Regularity Index (Phillips 2017): the chance you're in the same state (asleep or awake) at any two moments 24 hours apart, over the last 7 days, scaled to 0–100. In about 60,000 UK Biobank adults, regularity predicted mortality more strongly than sleep length (Windred 2024).`,
    dip: `How much lower your heart rate runs asleep than awake: (awake average − sleeping average) ÷ awake average. Experimental: blood-pressure research defines "dipping" categories, but no validated cut-off exists for heart rate, so this is tracked against your own trend only.`,
    cvhr: `Experimental. Counts repeating heart-rate surges during sleep (20–90 seconds apart, at least 6 bpm), a pattern that accompanies breathing pauses (Guilleminault 1984; Hayano 2011 validated it on ECG). This band reports heart rate about every 5 seconds from the wrist, which hasn't been validated for this, so treat it as a trend that might prompt a real sleep study.`,
    ccost: `Experimental. Your average heart rate during steady walking (80–120 steps a minute) minus your resting heart rate, per 100 steps a minute. A cadence-only adaptation of the physiological cost index; lower means walking costs your heart less, and it tends to fall as fitness improves.`,
    activity: `Activity is today's steps as a share of your age-based goal (Paluch 2022: most of the benefit by ~8,000 a day under 60, ~7,000 at 60+). Brisk minutes (100+ steps/min or heart-rate sessions) count toward the 150 a week guideline; light walking (60–99 steps/min) is counted separately. Workouts are detected from heart rate, so strength sessions show up even without steps.`,
    spo2d: `The band's blood-oxygen spot readings while you're awake. Healthy adults usually read 95–100%. The night value (Night tab) is taken at rest and is the one to trend for breathing problems.`,
    tempd: `Wrist skin temperature while awake. It follows your daily rhythm (lower by day, higher in the evening and asleep) and your surroundings, so Pulse compares it with your usual for the same hour.`,
    hrvd: `The band's own HRV reading (RMSSD) from its ~80-second pulse recordings during the day. Daytime values are noisier than overnight ones because posture and movement change them.`,
    breathd: `Breaths per minute from the rhythm of your pulse in each clean daytime recording. Movement usually spoils daytime recordings, so there may be few of these.`,
    stressd: `The band's own stress score, reported with each of its HRV readings. The vendor hasn't published how it's computed, so treat it as experimental and compare it only with your own history.`,
    moveH: `An hour counts as moving when it has 250+ steps, about two or three minutes of walking. Hours from 7 AM to 10 PM count.`,
  }[key];
  const nt = D.nt;
  const ev = key === "hrv" || key === "breath" ? nt?.bursts : key === "spo2" ? nt?.spo2 : key === "temp" ? nt?.temp : null;
  const row = (b) => key === "hrv" || key === "breath"
    ? `<div class="b"><span>${clock(nt.onsetMin + b.m)}</span><span>${b.beats ? `${b.beats} beats` : "band"}</span><span class="${b.ok ? "" : "rej"}">${key === "hrv" ? (b.rmssd != null ? `${b.rmssd.toFixed(1)} ms` : "—") : b.br != null ? `${b.br.toFixed(1)}/min` : "—"}</span><span><span class="pill">${b.ok ? "kept" : "movement"}</span></span></div>`
    : key === "spo2" ? `<div class="b"><span>${clock(nt.onsetMin + b.m)}</span><span></span><span>${b.pct}%</span><span></span></div>` : `<div class="b"><span>${clock(nt.onsetMin + b.m)}</span><span></span><span>${tempC(b.c).toFixed(1)} ${tUnit()}</span><span></span></div>`;
  return `<div class="sec"><h2>How it's measured</h2></div><div class="card explain"><p>${txt}</p><p>${key === "timing" ? "Your usual: the median midpoint of your previous 14 nights. Spread is the standard deviation of those midpoints; under about 30 minutes is regular." : M[key].day ? "Bands: a guideline or population range where one exists, and your own usual for this time of day (median ± a typical swing, last 28 days)." : "Bands: a population range for your age and sex where one exists, your own usual (median ± a typical swing, last 28 nights), and, for HRV and resting HR, what that night's sleep predicts from your own history (80% range, after 20 nights)."}</p></div>
    ${ev?.length ? `<div class="sec"><h2>Raw evidence</h2><span class="lbl">${ev.length} readings</span></div><div class="card bursts">${ev.slice(0, 10).map(row).join("")}${ev.length > 10 ? `<p class="note">…and ${ev.length - 10} more</p>` : ""}</div>` : ""}`;
}

function renderView(key, B) {
  if (st.view === "now") return viewNow(key, B);
  if (st.view === "time") return viewTime(key, B);
  if (st.view === "range") return viewRange(key, B);
  return viewAffects(key, B);
}
function stageLanes(x, y0, laneH, gap, op = 0.9) {
  let out = "", start = 0; const lv = { 4: 0, 3: 1, 2: 2, 1: 3 }, stg = D.nt.stages;
  for (let i = 1; i <= stg.length; i++) if (i === stg.length || stg[i] !== stg[start]) {
    out += `<rect x="${x(start).toFixed(1)}" y="${(y0 + lv[stg[start]] * (laneH + gap)).toFixed(1)}" width="${Math.max(0.8, x(i) - x(start)).toFixed(1)}" height="${laneH}" rx="${Math.min(3, laneH / 2)}" fill="${stageColor(stg[start])}" opacity="${op}"/>`; start = i;
  }
  return out;
}

function viewNowDay(key) {
  const T = D.T, W0 = 340, sid = uid("s"), col = css(M[key].color), x = sc(6 * 60, 22 * 60, 30, W0 - 6);
  if (!T?.hasData) return `<p class="note" style="margin:0">Nothing recorded yet today. Sync with your band to see today's detail.</p>`;
  const fut = (H) => `<rect x="${x(T.now).toFixed(1)}" y="0" width="${Math.max(0, W0 - 6 - x(T.now)).toFixed(1)}" height="${H - 18}" fill="${css("--ink3")}" opacity=".06"/>`;
  const taxis = (H) => [6, 9, 12, 15, 18, 21].map((hh) => `<text x="${x(hh * 60)}" y="${H - 4}" text-anchor="middle" class="axis">${hr12(hh)}</text>`).join("");
  if (key === "activity") return viewNowDay("steps");
  if (M[key].vit) {
    const list = (T.vit?.[M[key].vit] ?? []).map((r) => ({ m: r.m, v: key === "tempd" ? tempC(r.v) : r.v }));
    if (!list.length) return `<p class="note" style="margin:0">No ${M[key].lc} readings yet today.</p>`;
    const H = 180, vals = list.map((r) => r.v), u = bandsOf(key).full, lo0 = Math.min(...vals, ...(u ? [u.lo] : [])), hi0 = Math.max(...vals, ...(u ? [u.hi] : [])), pad = (hi0 - lo0) * 0.15 || 1, y = sc(lo0 - pad, hi0 + pad, H - 22, 10);
    let usualLine = "";
    if (key === "tempd") { const byH = Array.from({ length: 24 }, (_, hh) => median(D.hist.slice(-29, -1).map((z) => z.tempHourly?.[hh]).filter((x) => x != null))); const pts = byH.map((v, hh) => (v == null ? null : [x(hh * 60 + 30), y(tempC(v))])); if (pts.filter(Boolean).length >= 3) usualLine = `<path d="${smoothRuns(pts)}" fill="none" stroke="${css("--ink3")}" stroke-dasharray="4 3" stroke-width="1.5"/>`; }
    const body = fut(H) + (u && key !== "tempd" ? `<rect x="30" width="${W0 - 36}" y="${y(u.hi)}" height="${Math.max(0, y(u.lo) - y(u.hi))}" fill="${col}" opacity=".1"/>` : "") + usualLine
      + [lo0, (lo0 + hi0) / 2, hi0].map((v) => `<text x="24" y="${y(v) + 4}" text-anchor="end" class="axis">${fa(M[key])(v).replace("°", "")}</text>`).join("")
      + (list.length >= 2 ? `<path d="${smooth(list.map((r) => [x(r.m), y(r.v)]), 0.12)}" fill="none" stroke="${col}" stroke-width="1.5" opacity=".6"/>` : "") + list.map((r) => `<circle cx="${x(r.m).toFixed(1)}" cy="${y(r.v).toFixed(1)}" r="3.2" fill="${col}" stroke="${css("--bg")}" stroke-width="1.2"/>`).join("") + taxis(H);
    return scrubbable(sid, W0, H, body, list.map((r) => [x(r.m), y(r.v), `${ampm(r.m)} · <b>${M[key].f(r.v)}${M[key].unit ? ` ${M[key].unit}` : ""}</b>`]), `Each reading since you woke up.${key === "tempd" && usualLine ? " Dashed: your usual for each hour." : u ? " Shaded: your usual daytime range." : ""}`)
      + `<div class="stat3"><div><b>${M[key].f(vals[vals.length - 1])}</b><span>latest</span></div><div><b>${fa(M[key])(median(vals))}</b><span>median today</span></div><div><b>${list.length}</b><span>readings today</span></div></div>`;
  }
  if (key === "steps") {
    const typ = D.typical ?? new Array(24).fill(0);
    const H = 170, bw = (W0 - 36) / 24, max = Math.max(...T.hourly, ...typ, 1), y = sc(0, max, H - 22, 10), xs = (i) => 30 + i * bw;
    let cum = 0, ct = 0; const cumPts = [], typPts = [];
    const tot = typ.reduce((a, b) => a + b, 0), yc = sc(0, Math.max(tot, T.steps * 1.1, 1), H - 22, 10);
    typ.forEach((v, i) => { ct += v; typPts.push([xs(i + 1), yc(ct)]); });
    T.hourly.forEach((v, i) => { if (i <= T.nowH) { cum += v; cumPts.push([xs(i + 1), yc(cum)]); } });
    const body = typ.map((v, i) => (v ? `<rect x="${(xs(i) + 1.5).toFixed(1)}" y="${y(v).toFixed(1)}" width="${(bw - 3).toFixed(1)}" height="${(y(0) - y(v)).toFixed(1)}" rx="2" fill="${css("--ink3")}" opacity=".18"/>` : "")).join("")
      + T.hourly.map((v, i) => (v ? `<rect x="${(xs(i) + 1.5).toFixed(1)}" y="${y(v).toFixed(1)}" width="${(bw - 3).toFixed(1)}" height="${(y(0) - y(v)).toFixed(1)}" rx="2" fill="${col}"/>` : "")).join("")
      + (D.typical ? `<path d="${poly(typPts)}" fill="none" stroke="${css("--ink3")}" stroke-dasharray="3 3" stroke-width="1.3"/>` : "") + `<path d="${poly(cumPts)}" fill="none" stroke="${css("--act")}" stroke-width="2.2"/>`
      + [0, 6, 12, 18].map((hh) => `<text x="${xs(hh)}" y="${H - 6}" class="axis">${hr12(hh)}</text>`).join("");
    const pts = T.hourly.map((v, i) => [xs(i + 0.5), y(Math.max(v, typ[i])), `${hr12(i)} · <b>${i <= T.nowH ? v.toLocaleString() : "—"}</b> steps${D.typical ? ` · typical ${typ[i].toLocaleString()}` : ""}`]);
    return scrubbable(sid, W0, H, body, pts, D.typical ? `Bars: steps each hour today. Grey: your typical day. Green line: today's running total vs typical (dashed).` : `Bars: steps each hour today. Green line: running total. Your typical day appears after a couple of days.`);
  }
  if (key === "hrday") {
    const H = 200, vals = T.hr.filter((v) => v != null), lo = Math.min(50, ...vals) - 2, hi = Math.max(T.hrr60 + 10, ...vals) + 4, y = sc(lo, hi, H - 22, 8), pts = [], sp = [];
    for (let k = 0; k < T.n; k += 3) { const w = T.hr.slice(k, k + 3).filter((v) => v != null), t = T.wake + k + 1.5; const v = w.length ? mean(w) : null; pts.push(v == null ? null : [x(t), y(v)]); if (v != null) { const ss = T.sessions.find((s) => t >= s.a && t < s.b); sp.push([x(t), y(v), `${ampm(t)} · <b>${Math.round(v)} bpm</b>${ss ? ` · ${ss.kind ? "brisk walk" : ss.tag?.type?.toLowerCase() ?? "workout"}` : ""}`]); } }
    const zone = (a, b, c, l) => `<rect x="30" width="${W0 - 36}" y="${y(Math.min(b, hi))}" height="${Math.max(0, y(a) - y(Math.min(b, hi)))}" fill="${css(c)}" opacity=".07"/><text x="${W0 - 8}" y="${y(Math.min(b, hi)) + 11}" text-anchor="end" class="axis">${l}</text>`;
    const grid = [60, 80, 100, 120, 140].filter((v) => v > lo && v < hi).map((v) => `<line x1="30" x2="${W0 - 6}" y1="${y(v)}" y2="${y(v)}" stroke="${css("--grid")}"/><text x="24" y="${y(v) + 4}" text-anchor="end" class="axis">${v}</text>`).join("");
    const body = zone(T.hrr40, T.hrr60, "--watch", "moderate") + zone(T.hrr60, hi, "--heart", "vigorous")
      + T.sessions.map((s) => `<rect x="${x(s.a).toFixed(1)}" y="8" width="${(x(s.b) - x(s.a)).toFixed(1)}" height="${H - 30}" fill="${css("--heart")}" opacity=".08" rx="3"/>`).join("") + fut(H) + grid
      + `<path d="${smoothRuns(pts, 0.1)}" fill="none" stroke="${col}" stroke-width="1.6"/>` + taxis(H);
    return scrubbable(sid, W0, H, body, sp.length ? sp : [[0, 0, ""]], `Drag across the day. Shaded: detected workouts.`) + `<div class="stat3"><div><b>${T.hrNow ? Math.round(T.hrNow.bpm) : "—"}</b><span>latest</span></div><div><b>${T.dayHr != null ? T.dayHr.toFixed(0) : "—"}</b><span>daytime average</span></div><div><b>${T.hrHi != null ? Math.round(T.hrHi) : "—"}</b><span>highest</span></div></div>`;
  }
  if (key === "mvpa" || key === "light") {
    const cB = css("--act"), cL = css("--act2");
    const H = 70, body = fut(H) + T.stepsMin.map((v, k) => { const xx = x(T.wake + k).toFixed(1); if (T.brisk[k]) return `<rect x="${xx}" y="10" width="1.3" height="36" fill="${cB}"/>`; if (T.lightMin[k]) return `<rect x="${xx}" y="22" width="1.3" height="24" fill="${cL}" opacity=".85"/>`; return v > 0 ? `<rect x="${xx}" y="${46 - Math.min(20, v / 3)}" width="1" height="${Math.min(20, v / 3)}" fill="${css("--ink3")}" opacity=".35"/>` : ""; }).join("") + taxis(H);
    const sp = []; for (let k = 0; k < T.n; k += 2) sp.push([x(T.wake + k), 28, `${ampm(T.wake + k)} · ${T.stepsMin[k]} steps/min${T.brisk[k] ? " · <b>brisk</b>" : T.lightMin[k] ? " · <b>light</b>" : ""}`]);
    const days = [...D.hist.slice(-7, -1).map((h) => [h.d, h.mvpa, h.lightAct]), [D.latest.d, T.mvpa, T.light]], wmax = Math.max(50, ...days.map((d) => (d[1] ?? 0) + (d[2] ?? 0))), bw = (W0 - 36) / 7, yb = sc(0, wmax, 118, 10);
    const week = S(W0, 136, `<line x1="30" x2="${W0 - 6}" y1="${yb(150 / 7)}" y2="${yb(150 / 7)}" stroke="${css("--ink3")}" stroke-dasharray="3 3"/>` + days.map(([d, b, l], i) => { const cx = 30 + i * bw + bw / 2, x0 = (30 + i * bw + 5).toFixed(1), w = (bw - 10).toFixed(1); if (b == null && l == null) return `<text x="${cx.toFixed(1)}" y="112" text-anchor="middle" class="axis">—</text><text x="${cx.toFixed(1)}" y="132" text-anchor="middle" class="axis">${i === 6 ? "today" : DAYS[d.getDay()]}</text>`; const bb = b ?? 0, ll = l ?? 0; return `<rect x="${x0}" y="${yb(bb).toFixed(1)}" width="${w}" height="${Math.max(0, yb(0) - yb(bb)).toFixed(1)}" rx="3" fill="${cB}" opacity="${i === 6 ? 1 : 0.6}"/><rect x="${x0}" y="${yb(bb + ll).toFixed(1)}" width="${w}" height="${Math.max(0, yb(bb) - yb(bb + ll)).toFixed(1)}" rx="3" fill="${cL}" opacity="${i === 6 ? 0.9 : 0.45}"/><text x="${cx.toFixed(1)}" y="${yb(bb + ll) - 4}" text-anchor="middle" class="axis">${key === "light" ? ll : bb}</text><text x="${cx.toFixed(1)}" y="132" text-anchor="middle" class="axis">${i === 6 ? "today" : DAYS[d.getDay()]}</text>`; }).join(""));
    const wkL = days.reduce((a, d) => a + (d[2] ?? 0), 0);
    return scrubbable(sid, W0, H, body, sp, `<span class="key" style="--k:${cB}">brisk (100+ steps/min or HR sessions)</span><span class="key" style="--k:${cL}">light (60–99 steps/min)</span>`) + `<div class="sub-h">Last 7 days · dashed = 150 a week brisk pace</div>${week}<div class="stat3"><div><b>${T.mvpa} · ${T.light}</b><span>brisk · light today</span></div><div><b>${D.week}</b><span>brisk of 150, 7 days</span></div><div><b>${wkL}</b><span>light minutes, 7 days</span></div></div>`;
  }
  if (key === "ccost") {
    const pts = []; for (let k = 1; k < T.n; k++) { const c = T.stepsMin[k]; if (c >= 60 && c <= 135 && T.hr[k] != null && T.stepsMin[k - 1] >= 60) pts.push([c, T.hr[k]]); }
    if (pts.length < 3) return `<p class="note" style="margin:0">No steady walking recorded yet today. The trend uses days with at least 3 minutes of steady walking.</p>`;
    const H = 200, x = sc(55, 140, 36, W0 - 6), hv = pts.map((p2) => p2[1]), y = sc(Math.min(...hv, T.rest) - 5, Math.max(...hv) + 5, H - 24, 10);
    const body = `<line x1="36" x2="${W0 - 6}" y1="${y(T.rest)}" y2="${y(T.rest)}" stroke="${css("--ink3")}" stroke-dasharray="3 3"/><text x="${W0 - 6}" y="${y(T.rest) - 4}" text-anchor="end" class="axis">resting ${Math.round(T.rest)}</text>`
      + `<rect x="${x(80)}" y="8" width="${x(120) - x(80)}" height="${H - 32}" fill="${col}" opacity=".06"/>` + pts.map(([c, v]) => `<circle cx="${x(c).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" fill="${col}" opacity=".7"/>`).join("")
      + [60, 80, 100, 120, 140].map((c) => `<text x="${x(c)}" y="${H - 4}" text-anchor="middle" class="axis">${c}</text>`).join("");
    return S(W0, H, body) + `<p class="note">Each dot is a minute of walking today: cadence (steps/min, across) against heart rate. The shaded band (80–120 steps/min) is what the index uses.</p>`;
  }
  const H = 112, cw = (W0 - 36) / 15, body = [], xh = sc(7 * 60, 22 * 60, 30, W0 - 6);
  for (let hh = 7; hh < 22; hh++) { const i = hh - 7, done = hh < T.nowH, on = done && T.hourly[hh] >= 250, curH = hh === T.nowH; body.push(`<rect x="${(30 + i * cw + 2).toFixed(1)}" y="12" width="${(cw - 4).toFixed(1)}" height="40" rx="7" fill="${on ? col : "none"}" stroke="${on ? "none" : css("--ink3")}" stroke-opacity="${done || curH ? 0.6 : 0.2}" ${curH ? `stroke-dasharray="3 3"` : ""}/>${i % 3 === 0 ? `<text x="${(30 + i * cw + cw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle" class="axis">${hr12(hh)}</text>` : ""}`); }
  let run = 0, runs = "";
  for (let k = 0; k <= T.n; k++) { if (k < T.n && T.stepsMin[k] < 10 && T.hr[k] != null) run++; else { if (run >= 30) { const a0 = Math.max(7 * 60, T.wake + k - run), b0 = T.wake + k; if (b0 > a0) runs += `<rect x="${xh(a0).toFixed(1)}" y="72" width="${Math.max(3, xh(b0) - xh(a0)).toFixed(1)}" height="10" rx="5" fill="${run === T.longestStill ? css("--watch") : css("--ink3")}" opacity="${run === T.longestStill ? 0.9 : 0.4}"/>`; } run = 0; } }
  const sp = []; for (let hh = 7; hh < 22; hh++) sp.push([30 + (hh - 7 + 0.5) * cw, 32, `${hr12(hh)}–${hr12(hh + 1)} · ${hh < T.nowH ? `<b>${T.hourly[hh].toLocaleString()}</b> steps${T.hourly[hh] >= 250 ? " · moving" : ""}` : hh === T.nowH ? "this hour so far" : "later today"}`]);
  return scrubbable(sid, W0, H, body.join("") + `<text x="30" y="67" class="axis">still 30+ min</text>${runs}`, sp, `Filled: hours with 250+ steps. Bars below: stretches of 30+ minutes without walking; amber is the longest.`)
    + `<div class="stat3"><div><b>${T.moveH} of ${Math.max(0, T.nowH - 7)}</b><span>moving hours</span></div><div><b>${short(T.longestStill)}</b><span>longest still stretch</span></div><div><b>${short(T.stillNow)}</b><span>still right now</span></div></div>`;
}

function viewNow(key, B) {
  if (M[key].day) return viewNowDay(key);
  const { m, you } = B, W0 = 340, col = css(m.color), id = uid("v"), sid = uid("s"), nt = D.nt, h = D.last;
  if (key === "recovery") {
    if (!h.recParts.length) return `<p class="note" style="margin:0">Recovery needs a night with heart-rate data and at least ${h.recNeed} prior nights to compare against (${h.recNights} so far).</p>`;
    const x = sc(0, 1, 0, 150), tot = h.recParts.reduce((a, p) => a + p.max, 0);
    const det = (p) => p.key === "rhr" ? `${p.value.toFixed(1)} bpm · ${p.note.toLowerCase()}` : p.key === "hrv" ? `${p.value.toFixed(0)} ms · ${p.note.toLowerCase()}` : p.key === "temp" ? `${sign(tDelta(p.value))}° vs usual` : `score ${Math.round(p.value)}`;
    return `${h.rec == null ? `<p class="lead">Building your baseline: night ${Math.min(h.recNights + 1, h.recNeed)} of ${h.recNeed}. These parts are ready so far:</p>` : ""}${h.recParts.map((p) => `<div class="part" data-open2="${p.key === "temp" ? "temp" : p.key}"><div><b>${esc(p.label)}</b><span>${det(p)}</span></div>${S(150, 16, `<rect x="0" y="4" width="150" height="8" rx="4" fill="${css("--track")}"/><rect x="0" y="4" width="${x(p.frac).toFixed(1)}" height="8" rx="4" fill="${css(p.frac >= 0.6 ? "--good" : p.frac >= 0.45 ? "--watch" : "--bad")}"/>`)}<em>${p.points}<small>of ${p.max}</small></em></div>`).join("")}
      ${h.rec != null ? `<div class="sum">= (${h.recParts.map((p) => p.points).join(" + ")}) ÷ ${tot} × 100 = <b>${h.rec}</b></div>` : ""}
      <p class="note">Each bar is how much of that part's points you earned against your own usual. Tap a part for its own detail.</p>`;
  }
  if (key === "timing") {
    const hs = D.H.slice(-14).filter((z) => z.hasSleep);
    if (!hs.length) return `<p class="note" style="margin:0">No sleep timing recorded yet.</p>`;
    const H = 210, bw = (W0 - 40) / 14, y = sc(21 * 60, 33 * 60, 8, H - 30), mids = hs.slice(0, -1).map((z) => z.mid), um = mids.length >= 3 ? median(mids) + 1440 : null, off = 14 - hs.length;
    const body = [22, 24, 26, 28, 30, 32].map((hh) => `<line x1="36" x2="${W0 - 4}" y1="${y(hh * 60)}" y2="${y(hh * 60)}" stroke="${css("--grid")}"/><text x="30" y="${y(hh * 60) + 4}" text-anchor="end" class="axis">${hr12(hh)}</text>`).join("")
      + (um != null ? `<line x1="36" x2="${W0 - 4}" y1="${y(um)}" y2="${y(um)}" stroke="${css("--ink2")}" stroke-dasharray="4 3"/>` : "")
      + hs.map((z, j) => { const i = j + off; return `<rect x="${(36 + i * bw + 3).toFixed(1)}" y="${y(clamp(z.onset, 21 * 60, 33 * 60)).toFixed(1)}" width="${(bw - 6).toFixed(1)}" height="${Math.max(2, y(clamp(z.wake, 21 * 60, 33 * 60)) - y(clamp(z.onset, 21 * 60, 33 * 60))).toFixed(1)}" rx="5" fill="${col}" opacity="${j === hs.length - 1 ? 1 : 0.35}"/><circle cx="${(36 + i * bw + bw / 2).toFixed(1)}" cy="${y(z.mid + 1440).toFixed(1)}" r="2.4" fill="${css("--ink")}" opacity=".8"/><text x="${(36 + i * bw + bw / 2).toFixed(1)}" y="${H - 12}" text-anchor="middle" class="axis">${DAYS[eveOf(z).getDay()][0]}</text>`; }).join("");
    const sp = hs.map((z, j) => [36 + (j + off) * bw + bw / 2, y(z.mid + 1440), `${nightName(z)} · ${ampm(z.onset)} – ${ampm(z.wake)} · midpoint <b>${ampm(z.mid)}</b>`]);
    const all = hs.map((z) => z.mid);
    return scrubbable(sid, W0, H, body, sp, `Each bar is a night, from falling asleep to waking. Dots: midpoints.${um != null ? " Dashed: your usual midpoint." : ""}`)
      + `<div class="stat3"><div><b>${clock(h.onset)}</b><span>asleep</span></div><div><b>${clock(h.wake)}</b><span>awake</span></div><div><b>${all.length >= 3 ? `±${Math.round(sd(all))} min` : "—"}</b><span>midpoint spread</span></div></div>`;
  }
  if (key === "sri") {
    const days = D.H.slice(-7), H = 22 * days.length + 26, x = sc(0, 1440, 40, W0 - 4);
    const body = days.map((z, i) => { const st0 = z.summary?.states ?? ""; let out = `<text x="0" y="${i * 22 + 15}" class="axis">${DAYS[z.d.getDay()]}</text><rect x="40" y="${i * 22 + 4}" width="${W0 - 44}" height="14" rx="4" fill="${css("--track")}"/>`; let run = 0; for (let k = 0; k <= 1440; k++) { if (k < 1440 && st0[k] === "1") run++; else { if (run) out += `<rect x="${x(k - run).toFixed(1)}" y="${i * 22 + 4}" width="${Math.max(0.8, x(k) - x(k - run)).toFixed(1)}" height="14" rx="3" fill="${col}"/>`; run = 0; } } return out; }).join("")
      + [0, 6, 12, 18, 24].map((hh) => `<text x="${x(hh * 60)}" y="${H - 4}" text-anchor="middle" class="axis">${hr12(hh % 24)}</text>`).join("");
    return S(W0, H, body) + `<p class="note">Each row is a calendar day, midnight to midnight; filled = asleep. The more the rows line up, the higher the index.</p>`;
  }
  if (key === "dip") {
    const hs = D.H.slice(-14).filter((z) => z.summary?.night?.hr?.mean != null && z.summary?.day?.hr_mean_awake != null);
    if (!hs.length) return `<p class="note" style="margin:0">Needs a night and the day before with heart rate.</p>`;
    const H = 180, bw = (W0 - 40) / 14, vals = hs.flatMap((z) => [z.summary.night.hr.mean, z.summary.day.hr_mean_awake]), y = sc(Math.min(...vals) - 5, Math.max(...vals) + 5, H - 24, 10), off = 14 - hs.length;
    const body = hs.map((z, j) => { const i = j + off, cx = 40 + i * bw, a0 = z.summary.day.hr_mean_awake, n0 = z.summary.night.hr.mean; return `<line x1="${(cx + bw / 2).toFixed(1)}" x2="${(cx + bw / 2).toFixed(1)}" y1="${y(a0)}" y2="${y(n0)}" stroke="${col}" stroke-width="3" stroke-linecap="round" opacity="${j === hs.length - 1 ? 1 : 0.5}"/><circle cx="${(cx + bw / 2).toFixed(1)}" cy="${y(a0)}" r="3.5" fill="${css("--watch")}"/><circle cx="${(cx + bw / 2).toFixed(1)}" cy="${y(n0)}" r="3.5" fill="${css("--sleep")}"/>${z.dipPct != null ? `<text x="${(cx + bw / 2).toFixed(1)}" y="${y(n0) + 14}" text-anchor="middle" class="axis">${z.dipPct.toFixed(0)}</text>` : ""}`; }).join("")
      + [Math.round(Math.min(...vals)), Math.round(Math.max(...vals))].map((v) => `<text x="30" y="${y(v) + 4}" text-anchor="end" class="axis">${v}</text>`).join("");
    return S(W0, H, body) + `<p class="note"><span class="key" style="--k:${css("--watch")}">awake average</span><span class="key" style="--k:${css("--sleep")}">asleep average</span> Numbers under each night: the dip in %.</p>`;
  }
  if (!nt) return `<p class="note" style="margin:0">No minute-level data for this night.</p>`;
  if (key === "cvhr") return viewNow("rhr", { ...B, m: M.rhr, you: null }) + `<p class="note">The index counts repeating 20–90 second surges in this heart-rate trace while asleep. REM sleep and brief awakenings also make surges, so the number runs high and isn't comparable to a sleep study's apnea–hypopnea index; watch your own trend.</p>`;
  if (key === "sleep") {
    if (!nt.stages) return `<p class="note" style="margin:0">The band didn't record sleep stages this night.</p>`;
    const H = 150, x = sc(0, nt.N, 44, W0 - 6), laneH = 22, gap = 8;
    const body = stageLanes(x, 8, laneH, gap, 0.95) + ["Awake", "REM", "Light", "Deep"].map((n, i) => `<text x="0" y="${8 + i * (laneH + gap) + 15}" class="axis">${n}</text>`).join("")
      + [0, 2, 4, 6, 8].map((hh) => { const t = nt.onsetMin + hh * 60; return hh * 60 < nt.N ? `<text x="${x(hh * 60)}" y="${H - 4}" text-anchor="middle" class="axis">${clock(Math.round(t / 60) * 60).replace(":00", "")}</text>` : ""; }).join("");
    const pts = []; for (let i = 0; i < nt.N; i += 3) pts.push([x(i), 8 + ({ 4: 0, 3: 1, 2: 2, 1: 3 }[nt.stages[i]]) * (laneH + gap) + laneH / 2, `${ampm(nt.onsetMin + i)} · <b>${stageName[nt.stages[i]]}</b>`]);
    const cnt = (s) => nt.stages.filter((v) => v === s).length, tot = Math.max(1, cnt(1) + cnt(2) + cnt(3));
    return scrubbable(sid, W0, H, body, pts, `Drag across the night to read each stage.`) + `<div class="stat4">${[[1, "Deep"], [3, "REM"], [2, "Light"], [4, "Awake"]].map(([s, n]) => `<div><i style="background:${stageColor(s)}"></i><b>${short(cnt(s))}</b><span>${n}${s !== 4 ? ` · ${Math.round((100 * cnt(s)) / tot)}%` : ` · ${h.awakenings ?? 0}×`}</span></div>`).join("")}</div>
      <div class="stat3"><div><b>${h.efficiency != null ? `${h.efficiency.toFixed(0)}%` : "—"}</b><span>efficiency</span></div><div><b>${h.waso ?? "—"} min</b><span>awake after onset</span></div><div><b>${h.sleepScore ?? "—"}</b><span>sleep score</span></div></div>`;
  }
  const H = 180, x = sc(0, nt.N, 30, W0 - 6);
  const raw = key === "hrv" ? nt.bursts.filter((b) => b.rmssd != null).map((b) => [b.m, b.rmssd, b.ok]) : key === "rhr" ? nt.hr.map((v, i) => (v == null ? null : [i, v, true])).filter((p, i) => p && i % 3 === 0) : key === "breath" ? nt.bursts.filter((b) => b.br != null).map((b) => [b.m, b.br, b.ok]) : key === "spo2" ? nt.spo2.map((r) => [r.m, r.pct, true]) : nt.temp.map((r) => [r.m, tempC(r.c), true]);
  if (!raw.length) return `<p class="note" style="margin:0">No ${m.lc} readings recorded this night.</p>`;
  const vals = raw.map((p) => p[1]), lo0 = Math.min(...vals), hi0 = Math.max(...vals), pad = (hi0 - lo0) * 0.15 || 1;
  const ys = key === "spo2" ? [Math.min(88, lo0 - 1), 100] : [lo0 - pad, hi0 + pad];
  const y = sc(ys[0], ys[1], H - 32, 10), lv = { 4: 0, 3: 1, 2: 2, 1: 3 };
  let bg = "";
  if (nt.stages) { let start = 0; for (let i = 1; i <= nt.stages.length; i++) if (i === nt.stages.length || nt.stages[i] !== nt.stages[start]) { bg += `<rect x="${x(start).toFixed(1)}" y="${H - 26 + lv[nt.stages[start]] * 5}" width="${Math.max(0.8, x(i) - x(start)).toFixed(1)}" height="4" rx="1.5" fill="${stageColor(nt.stages[start])}" opacity=".9"/>`; start = i; } }
  const fmtV = key === "temp" ? (v) => v.toFixed(1) : m.f;
  const grid = [0, 1, 2, 3].map((k) => { const v = ys[0] + (k / 3) * (ys[1] - ys[0]); return `<line x1="30" x2="${W0 - 6}" y1="${y(v)}" y2="${y(v)}" stroke="${css("--grid")}"/><text x="24" y="${y(v) + 4}" text-anchor="end" class="axis">${fmtV(v)}</text>`; }).join("");
  const okPts = raw.filter((p) => p[2]).map((p) => [x(p[0]), y(p[1])]);
  const band = key === "spo2" ? `<rect x="30" width="${W0 - 36}" y="${y(100)}" height="${y(95) - y(100)}" fill="${col}" opacity=".08"/>` : key !== "temp" && you ? `<rect x="30" width="${W0 - 36}" y="${y(clamp(you[1], ys[0], ys[1]))}" height="${Math.max(0, y(clamp(you[0], ys[0], ys[1])) - y(clamp(you[1], ys[0], ys[1])))}" fill="${col}" opacity=".1"/>` : "";
  const body = `<defs>${glowDef(id, 2.4)}</defs>${grid}${band}${bg}
      ${key === "spo2" || okPts.length < 2 ? "" : `<path class="draw" style="--len:900" d="${key === "rhr" ? smoothRuns(nt.hr.map((v, i) => (v == null ? null : [x(i), y(v)])).filter((_, i) => i % 2 === 0)) : smooth(okPts)}" fill="none" stroke="${col}" stroke-width="${key === "rhr" ? 2 : 1.4}" stroke-opacity="${key === "rhr" ? 1 : 0.55}" ${key === "rhr" ? glow(id) : ""}/>`}
      ${key === "rhr" ? "" : raw.map((p) => `<circle cx="${x(p[0]).toFixed(1)}" cy="${y(p[1]).toFixed(1)}" r="${p[2] ? 3.3 : 2.6}" fill="${p[2] ? col : "none"}" stroke="${p[2] ? css("--bg") : css("--ink3")}" stroke-width="${p[2] ? 1.5 : 1}" class="fadein"/>`).join("")}`;
  const sp = raw.map((p) => [x(p[0]), y(p[1]), `${ampm(nt.onsetMin + p[0])} · <b>${fmtV(p[1])} ${key === "temp" ? tUnit() : m.unit}</b>${nt.stages ? ` · ${stageName[nt.stages[Math.min(nt.N - 1, Math.max(0, p[0]))]]}` : ""}${p[2] ? "" : " · dropped (movement)"}`]);
  return scrubbable(sid, W0, H, body, sp, `Drag across the chart to read any moment.`)
    + `<p class="note">${key === "rhr" ? "Heart rate minute by minute" : key === "temp" ? `Skin temperature (${tUnit()})` : key === "spo2" ? "Each spot reading" : "Each pulse recording"} across the night${nt.stages ? ", over your sleep stages" : ""}${key === "hrv" ? ". Hollow dots were dropped for movement" : ""}${you && key !== "temp" && key !== "spo2" ? "; the shaded band is your usual" : ""}.</p>`;
}

function tagColor(k) { return css({ alcohol: "--bad", caffeine: "--watch", stress: "--breath", workout: "--act" }[k]); }
const tagsKnown = (h) => TAGS.filter((t) => (t.auto ? h.hasNight : h.asked) && h.t?.[t.key]);
function viewTime(key, B) {
  const { m } = B, W0 = 340, col = css(m.color), id = uid("v"), sid = uid("s"), pop = popOf(m), fd = m.fd ?? fa(m);
  const end = m.day ? D.hist.length - 2 : D.i, span = +st.agg, startI = Math.max(0, end - span + 1);
  const win = (m.day ? D.hist : D.H).slice(startI, end + 1), pts = win.map((h, j) => [j, m.get(h), h]).filter((p) => p[1] != null);
  if (pts.length < 2) return `<p class="note" style="margin:0">${pts.length ? "One" : "No"} ${m.day ? "complete day" : "night"} so far. Trends appear here as ${m.day ? "days" : "nights"} add up.</p>`;
  const H = 206, tagRow = st.showTags ? 18 : 0, ser = pts.map((p) => p[1]);
  const u = B.full, you2 = u ? [u.lo, u.hi] : null;
  const yl = [...ser, ...(pop && !m.day ? pop : [])], lo = Math.min(...yl), hi = Math.max(...yl), pad = (hi - lo) * 0.08 || 1;
  const x = sc(0, Math.max(1, win.length - 1), 30, W0 - 6), y = sc(lo - pad, hi + pad, H - 26 - tagRow, 10), clip = (v) => clamp(v, lo - pad, hi + pad);
  const roll = pts.map((_, i) => mean(pts.slice(Math.max(0, i - 6), i + 1).map((p) => p[1])));
  const wk = pts.map((p) => (m.day ? p[2].dow === 0 || p[2].dow === 6 : p[2].wkend));
  let body = `<defs>${glowDef(id, 2.6)}</defs>${pop && !m.day ? `<rect x="30" width="${W0 - 36}" y="${y(clip(pop[1]))}" height="${Math.max(0, y(clip(pop[0])) - y(clip(pop[1])))}" fill="${css("--ink3")}" opacity=".07"/>` : ""}
      ${you2 ? `<rect x="30" width="${W0 - 36}" y="${y(clip(you2[1]))}" height="${Math.max(0, y(clip(you2[0])) - y(clip(you2[1])))}" fill="${col}" opacity=".13"/>` : ""}
      ${[lo, (lo + hi) / 2, hi].map((v) => `<text x="24" y="${y(v) + 4}" text-anchor="end" class="axis">${fa(m)(v)}</text>`).join("")}`;
  const dotR = win.length > 100 ? 1.3 : 2.2;
  if (st.split && pts.length >= 6) {
    const a = ser.filter((_, i) => !wk[i]), b = ser.filter((_, i) => wk[i]);
    body += pts.map((p, i) => `<circle cx="${x(p[0]).toFixed(1)}" cy="${y(p[1]).toFixed(1)}" r="${dotR + 0.3}" fill="${wk[i] ? css("--watch") : col}" opacity="${wk[i] ? 0.85 : 0.45}"/>`).join("")
      + (a.length ? `<line x1="30" x2="${W0 - 6}" y1="${y(mean(a))}" y2="${y(mean(a))}" stroke="${col}" stroke-width="2"/>` : "") + (b.length ? `<line x1="30" x2="${W0 - 6}" y1="${y(mean(b))}" y2="${y(mean(b))}" stroke="${css("--watch")}" stroke-width="2"/>` : "");
  } else {
    body += pts.map((p) => `<circle cx="${x(p[0]).toFixed(1)}" cy="${y(p[1]).toFixed(1)}" r="${dotR}" fill="${col}" opacity="${pts.length >= 7 ? 0.4 : 0.85}"/>`).join("")
      + (pts.length >= 7 ? `<path class="draw" style="--len:1400" d="${smooth(pts.map((p, i) => [x(p[0]), y(roll[i])]), 0.12)}" fill="none" stroke="${col}" stroke-width="2.4" ${glow(id)}/>` : `<path d="${poly(pts.map((p) => [x(p[0]), y(p[1])]))}" fill="none" stroke="${col}" stroke-width="1.4" opacity=".5"/>`);
  }
  if (!m.day) { const lastP = pts[pts.length - 1]; if (lastP[2] === D.last) body += `<circle cx="${x(lastP[0])}" cy="${y(lastP[1])}" r="4.5" fill="${col}" stroke="${css("--bg")}" stroke-width="2"/>`; }
  if (st.showTags) {
    const ty = H - 22 - tagRow + 6;
    body += `<text x="24" y="${ty + 5}" text-anchor="end" class="axis">tags</text>` + win.map((h, j) => tagsKnown(h).map((t, k) => `<rect x="${(x(j) - 1.2).toFixed(1)}" y="${ty - 2 + k * 3}" width="2.4" height="${win.length > 100 ? 5 : 7}" rx="1" fill="${tagColor(t.key)}"/>`).join("")).join("");
  }
  for (const lab of D.labs ?? []) { const j = win.findIndex((h) => h.date >= lab.date); if (j > 0 || (j === 0 && win[0].date === lab.date)) body += `<line x1="${x(j)}" x2="${x(j)}" y1="12" y2="${H - 22}" stroke="${css("--ink")}" stroke-opacity=".35" stroke-dasharray="2 3"/><text x="${x(j)}" y="9" text-anchor="middle" class="axis">labs</text>`; }
  const step = win.length > 100 ? 91 : win.length > 45 ? 30 : win.length > 14 ? 7 : Math.max(1, Math.ceil(win.length / 4));
  for (let j = win.length - 1; j >= 0; j -= step) body += `<text x="${x(j)}" y="${H - 4}" text-anchor="middle" class="axis">${MON[win[j].d.getMonth()]} ${win[j].d.getDate()}</text>`;
  const sp = pts.map((p) => [x(p[0]), y(p[1]), `${m.day ? dname(p[2].d) : `${nightName(p[2])} ${MON[p[2].d.getMonth()]} ${p[2].d.getDate()}`} · <b>${m.f(p[1])} ${m.unit}</b>${tagsKnown(p[2]).map((t) => ` · ${t.label}`).join("")}${p[2].sick ? " · Sick" : ""}`]);
  const a = ser.filter((_, i) => !wk[i]), b = ser.filter((_, i) => wk[i]), dW = a.length && b.length ? mean(b) - mean(a) : null, unitWord = m.day ? "days" : "nights";
  const s = sd(ser), mu = mean(ser);
  const spread = m.noCv ? `<div><b>${s != null ? `±${fd(s)}` : "—"}</b><span>${m.day ? "day" : "night"}-to-${m.day ? "day" : "night"} spread</span></div>` : `<div><b>${s != null && mu ? `${((100 * s) / Math.abs(mu)).toFixed(0)}%` : "—"}</b><span>${m.day ? "day" : "night"}-to-${m.day ? "day" : "night"} CV</span></div>`;
  return scrubbable(sid, W0, H, body, sp, `Dots are ${unitWord}${pts.length >= 7 ? `; the line is the 7-${m.day ? "day" : "night"} average` : ""}.`)
    + `<div class="stat3"><div><b>${fa(m)(mu)}</b><span>average</span></div>${spread}<div><b>${dW == null ? "—" : m.noCv ? `${sign(dW, 0)} min` : sign(dW, m.day ? 0 : 1)}</b><span>weekend vs weekday</span></div></div>
      <p class="note">${m.day ? "Complete days only; today is still in progress. " : ""}${you2 ? "Colored band: your usual. " : ""}${pop && !m.day ? `Grey: ${popLbl(m).toLowerCase()}.` : ""}${st.showTags ? " Tag ticks: " + TAGS.map((t) => `<span class="key" style="--k:${tagColor(t.key)}">${t.label.toLowerCase()}</span>`).join(" ") : ""}</p>`;
}
function viewRange(key, B) {
  const { m } = B, W0 = 340, col = css(m.color), pop = popOf(m), f = fa(m), fd = m.fd ?? f;
  const n0 = +st.agg, ser = B.ser.slice(-n0).map(m.get), n = ser.length;
  if (n < 7) return `<p class="note" style="margin:0">Your range needs at least 7 ${m.day ? "days" : "nights"} (${n} so far).</p>`;
  const H = 190, bins = Math.min(16, Math.max(6, Math.round(n / 3))), you = B.full ? [B.full.lo, B.full.hi] : null;
  const lo = Math.min(...ser), hi = Math.max(...ser), bw = (hi - lo) / bins || 1, counts = new Array(bins).fill(0);
  ser.forEach((v) => counts[Math.min(bins - 1, Math.floor((v - lo) / bw))]++);
  const x = sc(lo, hi, 20, W0 - 10), cmax = Math.max(...counts), y = sc(0, cmax, H - 50, 18), sorted = [...ser].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(n * 0.25)], q3 = sorted[Math.floor(n * 0.75)], md = median(ser), cur = m.day ? B.rcur : B.cur;
  const p = cur != null ? Math.round((100 * sorted.filter((v) => v <= cur).length) / n) : null;
  const clampX = (v) => clamp(x(v), 20, W0 - 10), rowY = H - 30, who = m.day ? "yesterday" : isLatest() ? "last night" : "that night";
  return S(W0, H, counts.map((c, i) => `<rect x="${(x(lo + i * bw) + 1).toFixed(1)}" y="${y(c).toFixed(1)}" width="${Math.max(1, x(lo + bw) - x(lo) - 2).toFixed(1)}" height="${(y(0) - y(c)).toFixed(1)}" rx="3" fill="${col}" opacity="${lo + (i + 0.5) * bw >= q1 && lo + (i + 0.5) * bw <= q3 ? 0.8 : 0.3}"/>`).join("")
    + `<line x1="${x(md)}" x2="${x(md)}" y1="14" y2="${H - 48}" stroke="${css("--ink2")}" stroke-width="1.2"/><text x="${x(md)}" y="11" text-anchor="middle" class="axis">median ${f(md)}</text>`
    + (pop ? `<rect x="${clampX(pop[0])}" y="${rowY - 4}" width="${Math.max(2, clampX(pop[1]) - clampX(pop[0]))}" height="8" rx="4" fill="${css("--ink3")}" opacity=".3"/>` : "")
    + (you ? `<rect x="${clampX(you[0])}" y="${rowY + 8}" width="${Math.max(2, clampX(you[1]) - clampX(you[0]))}" height="8" rx="4" fill="${col}" opacity=".45"/>` : "")
    + (cur != null ? `<circle cx="${clampX(cur)}" cy="${rowY + 6}" r="6" fill="${col}" stroke="${css("--bg")}" stroke-width="2"/><text x="${clampX(cur)}" y="${H - 2}" text-anchor="middle" class="axis">${who}</text>` : ""))
    + `<div class="stat3"><div><b>${f(q1)}–${f(q3)}</b><span>your middle half</span></div><div><b>${fd(sd(ser))}</b><span>typical swing (SD)</span></div><div><b>${p != null ? ord(p) : "—"}</b><span>percentile</span></div></div>
      <p class="note">Your last ${n} ${m.day ? "complete days" : "nights"}.${p != null ? ` ${cap1(who)} sits at the <b>${ord(p)} percentile</b> of your own history.` : ""}${pop ? ` The grey bar is the ${popLbl(m).toLowerCase()} range${you ? "; the colored one is your usual" : ""}.` : ""}</p>`;
}
function viewAffects(key, B) {
  const { m } = B, W0 = 340, H = 180, hist = m.day ? D.hist : D.H;
  const list = drivers(hist, m.get, m.drivers);
  const nights = hist.filter((h) => h.hasNight), asked = nights.filter((h) => h.asked), trig = asked.filter((h) => h.trig?.length).length;
  const shown = list.filter((d) => d.state !== "needs");
  const ext = Math.max(0.5, ...shown.map((d) => Math.abs(d.effect) + d.ci)), xs = sc(-ext, ext, 2, 118);
  const good = (e) => (m.better === 0 ? null : m.better * e > 0);
  const dp = key === "sleep" ? 2 : key === "steps" || key === "timing" ? 0 : 1, unit = key === "sleep" ? "h" : key === "timing" ? "min" : m.unit;
  const row = (d) => {
    if (d.state === "needs") {
      const total = d.unit === "nights" ? MIN_MODEL : MIN_TAGGED, have = Math.min(d.n, total), cells = Math.min(total, 10), on = Math.round((have / total) * cells);
      return `<div class="drv needs"><span>${d.label}<span class="n">${d.n} of ${total} ${d.unit === "nights" ? "nights" : `${d.unit} nights`}</span></span><span class="meter">${Array.from({ length: cells }, (_, i) => `<i class="${i < on ? "on" : ""}"></i>`).join("")}</span><span class="e muted">${d.need} more</span></div>`;
    }
    const g = good(d.effect), fill = d.state === "clear" ? css(g == null ? "--ink2" : g ? "--good" : "--bad") : css("--ink3");
    return `<div class="drv ${d.state}"><span>${d.label}<span class="n">${d.note}${d.state === "unclear" ? " · no clear effect yet" : ""}</span></span>${S(120, 14, `<line x1="60" x2="60" y1="0" y2="14" stroke="${css("--grid")}"/><line x1="${xs(d.effect - d.ci)}" x2="${xs(d.effect + d.ci)}" y1="7" y2="7" stroke="${css("--ink3")}" stroke-width="1.5"/>${d.state === "clear" ? `<rect x="${Math.min(60, xs(d.effect))}" y="2.5" width="${Math.abs(xs(d.effect) - 60)}" height="9" rx="3" fill="${fill}" opacity=".9"/>` : `<circle cx="${xs(d.effect)}" cy="7" r="3.5" fill="none" stroke="${fill}" stroke-width="1.5"/>`}`)}<span class="e ${d.state === "clear" ? "" : "muted"}">${d.state === "clear" ? `${sign(d.effect, dp)}<small>${unit}</small>` : "±" + d.ci.toFixed(dp)}</span></div>`;
  };
  let scatter = "";
  if (m.drivers.includes("sleep")) {
    const sc2 = hist.slice(-121, -1).filter((h) => !h.sick && h.sleepH != null && m.get(h) != null);
    if (sc2.length >= 8) {
      const vy = sc2.map(m.get), sxLo = Math.min(5, ...sc2.map((h) => h.sleepH)), sxHi = Math.max(9, ...sc2.map((h) => h.sleepH)), sx = sc(sxLo, sxHi, 30, W0 - 6), sy = sc(Math.min(...vy), Math.max(...vy), H - 22, 10);
      const xm = mean(sc2.map((h) => h.sleepH)), ym = mean(vy), den = sc2.reduce((a, h) => a + (h.sleepH - xm) ** 2, 0), b = den ? sc2.reduce((a, h, i) => a + (h.sleepH - xm) * (vy[i] - ym), 0) / den : 0;
      const sid = uid("s"), alc = (h) => h.asked && h.t.alcohol;
      const body = sc2.map((h, i) => `<circle cx="${sx(h.sleepH).toFixed(1)}" cy="${sy(vy[i]).toFixed(1)}" r="2.6" fill="${alc(h) ? css("--bad") : css(m.color)}" opacity="${alc(h) ? 0.9 : 0.5}"/>`).join("")
        + `<path d="M${sx(sxLo)},${sy(ym + b * (sxLo - xm))}L${sx(sxHi)},${sy(ym + b * (sxHi - xm))}" stroke="${css("--ink")}" stroke-opacity=".6" stroke-width="1.6"/>` + [5, 6, 7, 8, 9].filter((hh) => hh >= sxLo && hh <= sxHi).map((hh) => `<text x="${sx(hh)}" y="${H - 4}" text-anchor="middle" class="axis">${hh}h</text>`).join("")
        + [Math.min(...vy), Math.max(...vy)].map((v) => `<text x="24" y="${sy(v) + 4}" text-anchor="end" class="axis">${fa(m)(v)}</text>`).join("");
      scatter = `<div class="sub-h">${m.day ? "Last night's sleep vs the next day's" : "Sleep length vs"} ${m.lc}</div>` + scrubbable(sid, W0, H, body, sc2.map((h, i) => [sx(h.sleepH), sy(vy[i]), `${dname(h.d)} · ${hm(h.sleepH)} sleep · <b>${m.f(vy[i])} ${m.unit}</b>${alc(h) ? " · alcohol" : ""}`]), `Each dot is a ${m.day ? "day" : "night"}. <span class="key" style="--k:${css("--bad")}">alcohol-tagged</span>`);
    }
  }
  if (list.every((d) => d.state === "needs")) return `<p class="lead" style="margin:0">Not enough data yet. Sleep length effects appear after ${MIN_MODEL} nights, and each tag's effect after ${MIN_TAGGED} tagged nights (Pulse asks after unusual nights and on a random 1 in 4 ordinary ones). ${nights.length} night${nights.length === 1 ? "" : "s"} recorded so far.</p>`;
  return `<p class="lead">Pulse has asked about <b>${asked.length}</b> of your ${nights.length} nights so far: every unusual one (${trig}) plus a random 1 in 4 of the ordinary ones, which count 4× so answers don't over-represent bad nights. Late workouts are detected from heart rate.</p>
    <div>${list.map(row).join("")}</div>
    <p class="note">Effect on your ${m.lc} ${m.day ? "the day after a" : "per"} tagged night${m.drivers.includes("sleep") && key !== "sleep" ? ", adjusted for sleep length" : ""}, with 95% ranges. An effect is called clear only when its range stays on one side of zero. From your own data: associations, not proof of cause. Sick nights are left out.</p>
    ${scatter ? `<div style="margin-top:14px">${scatter}</div>` : ""}`;
}
