// Sleep: last night (or any night) in detail, then the two-week picture and regularity.
import { clockDiff, circularStats, sleepNeed, sleepRegularityIndex } from "../analytics/sleep.js?v=20260924145338";
import { addDaysStr, clock, clockFromMin, dayOf, stamp, toMs } from "../core/time.js?v=20260924145338";
import { fmtTempDelta, tempUnit } from "../core/units.js?v=20260924145338";
import { barChart, hypnogram, lineChart, sleepWindows } from "../ui/charts.js?v=20260924145338";
import { card, cardHead, chip, header, meterRow, ring, row, scoreStatus, section, stageBar } from "../ui/components.js?v=20260924145338";
import { h, icon } from "../ui/h.js?v=20260924145338";
import { dateLong, dateShort, dayLabel } from "./common.js?v=20260924145338";
import { stopBang, stopBangSheet } from "./you.js?v=20260924145338";

export const STAGE_COLORS = { deep: "var(--deep)", light: "var(--light)", rem: "var(--rem)", awake: "var(--awake)" };
const dur = (m) => { const r = Math.round(m); return `${Math.floor(r / 60)}h ${String(r % 60).padStart(2, "0")}m`; };

export default async function sleep(ctx, date = dayOf()) {
  const today = dayOf();
  const sums = await ctx.summaries(45, today);
  const s = sums.find((x) => x.date === date);
  const night = s?.night?.sleep ? s.night : null;
  const sc = s?.scores?.sleep;
  const age = ctx.profile.age ?? 40;

  const nav = h("div.datenav",
    h("button", { type: "button", "aria-label": "Previous night", onclick: () => ctx.nav(`sleep/${addDaysStr(date, -1)}`) }, icon("left")),
    h("span.d", date === today ? "Last night" : dateLong(date)),
    h("button", { type: "button", "aria-label": "Next night", disabled: date >= today, onclick: () => ctx.nav(`sleep/${addDaysStr(date, 1)}`) }, icon("right")));

  const screen = h("div.screen", header(date === today ? dateLong(date) : "Sleep", date === today ? "Sleep" : dateShort(date)), nav);

  if (!night) {
    screen.append(card(h("div.hero", ring(null, { size: 168, stroke: 14 }), h("p.sentence", date === today
      ? "No sleep recorded for last night yet. Wear the band to bed, then open Pulse in the morning to sync."
      : "No sleep was recorded for this night."))));
    screen.append(...(await trends(ctx, sums, today, age)));
    return screen;
  }

  const st = scoreStatus(sc?.score);
  const sl = night.sleep;
  screen.append(h("div.card.hero",
    ring(sc?.score ?? null, { size: 168, stroke: 14, color: "var(--sleep)", aria: `Sleep score ${sc?.score}` }),
    h("span.verdict", { style: { color: st.color } }, st.label),
    h("div.bignum", dur(sl.asleep)),
    h("p.sentence", `${clock(sl.onset)} – ${clock(sl.wake)} · ${Math.round(sl.efficiency)}% efficiency · ${sl.awakenings} awakening${sl.awakenings === 1 ? "" : "s"}`)));

  // Stages
  const parts = [["deep", "Deep"], ["rem", "REM"], ["light", "Light"], ["awake", "Awake"]].map(([k, label]) => ({ key: k, label, minutes: sl[k], color: STAGE_COLORS[k] }));
  const hourTicks = [];
  const t0 = toMs(night.stages[0][0]), t1 = toMs(night.stages[night.stages.length - 1][0]);
  for (let t = Math.ceil(t0 / 3600e3) * 3600e3; t < t1; t += 3600e3) if (new Date(t).getHours() % 2 === 0) hourTicks.push(t);
  screen.append(card(cardHead("Stages", "Band estimate"),
    hypnogram({ stages: night.stages, colors: STAGE_COLORS, toMs, fmtX: (ms) => clock(stamp(new Date(ms))).replace(":00", ""), ticks: hourTicks }),
    h("div", { style: { marginTop: "14px" } }, stageBar(parts)),
    h("div.stagelist", parts.map((p) => h("div",
      h("span.k", h("i", { style: { background: p.color } }), p.label),
      h("span.v", dur(p.minutes).replace(/^0h /, ""), h("small", p.key !== "awake" && sl.asleep ? `${Math.round((100 * p.minutes) / sl.asleep)}%` : ""))))),
    h("p.note", { style: { marginTop: "12px" } }, stageNote(sl, age))));

  // Contributors
  if (sc) screen.append(card(cardHead("What went into your score", `${sc.score}/100`), h("div.rows", sc.parts.map((p) => meterRow({
    label: p.label, sub: p.note, value: partValue(p), frac: p.frac, color: "var(--sleep)", points: `${p.points}/${p.max}` })))));

  // Overnight vitals
  const n = s.night;
  const vit = [];
  if (n.hr?.rhr) vit.push(row({ label: "Lowest heart rate", sub: `30-minute average, around ${clock(n.hr.rhr_time)}`, value: Math.round(n.hr.rhr), unit: "bpm", onClick: () => ctx.nav("metric/rhr") }));
  if (n.hr?.nadir_frac != null) vit.push(row({ label: "When your heart rate bottomed out", sub: n.hr.nadir_frac <= 0.5 ? "In the first half of the night, a sign of a restful night" : "Late in the night; late meals, alcohol or a hard evening push it later", value: `${Math.round(n.hr.nadir_frac * 100)}%`, unit: "into sleep" }));
  const hrvV = n.ppi?.rmssd ?? n.hrv?.median;
  if (hrvV) vit.push(row({ label: "Overnight HRV", sub: n.ppi?.rmssd ? `RMSSD from ${n.ppi.usable} pulse recordings` : "Band estimate", value: Math.round(hrvV), unit: "ms", onClick: () => ctx.nav("metric/hrv") }));
  if (n.resp) vit.push(row({ label: "Breathing rate", sub: `Estimated from your pulse rhythm (${n.resp.n} recordings)`, value: n.resp.rate.toFixed(1), unit: "/min", onClick: () => ctx.nav("metric/resp") }));
  if (n.spo2) vit.push(row({ label: "Blood oxygen", sub: `Lowest ${n.spo2.min}%${n.spo2.below90 ? ` · ${n.spo2.below90} reading${n.spo2.below90 > 1 ? "s" : ""} under 90%` : ""} · ${n.spo2.n} readings`, value: Math.round(n.spo2.median), unit: "%", onClick: () => ctx.nav("metric/spo2") }));
  const tb = sums.filter((x) => x.date < date).map((x) => x.night?.temp?.median).filter((v) => v != null);
  if (n.temp && tb.length >= 3) {
    const base = tb.slice(-14).sort((a, b) => a - b)[Math.floor(Math.min(14, tb.length) / 2)];
    vit.push(row({ label: "Skin temperature", sub: "vs your usual night", value: fmtTempDelta(n.temp.median - base), unit: tempUnit().slice(1), onClick: () => ctx.nav("metric/temp") }));
  }
  if (n.ppi?.rhythm?.screened) vit.push(row({ label: "Pulse rhythm", sub: `${n.ppi.rhythm.screened} recordings checked while you slept`, value: n.ppi.rhythm.flagged ? "Irregular" : "Regular", onClick: () => ctx.nav("ecg") }));
  if (vit.length) screen.append(card(cardHead("While you slept"), h("div.rows", vit)));

  // Overnight heart rate curve
  if (n.hr?.hourly?.length) {
    const pts = n.hr.hourly.map((v, i) => [toMs(sl.onset) + (i + 0.5) * 3600e3, v]).filter((p) => p[1] != null);
    screen.append(card(cardHead("Heart rate through the night", `lowest ${Math.round(n.hr.min)} bpm`),
      lineChart({ series: [{ points: pts, color: "var(--heart)", label: "Heart rate", dots: true }], height: 150,
        ticks: pts.map((p) => p[0]).filter((_, i) => i % 2 === 0), fmtX: (ms) => clock(stamp(new Date(ms))).replace(":00", "").replace(/:\d\d/, ""),
        fmtV: (v) => `${Math.round(v)} bpm`, fmtWhen: (ms) => `Hour starting ${clock(stamp(new Date(ms - 1800e3)))}`,
        table: { columns: ["Hour", "Avg bpm"], rows: pts.map((p) => [clock(stamp(new Date(p[0] - 1800e3))), Math.round(p[1])]) } })));
  }
  screen.append(breathingCard(ctx, sums, date));
  if (sl.naps?.length) screen.append(card(cardHead("Naps"), h("div.rows", sl.naps.map((x) => row({ label: `${clock(x.start)} – ${clock(x.end)}`, value: dur(x.minutes).replace(/^0h /, "") })))));

  screen.append(...(await trends(ctx, sums, date, age)));
  screen.append(h("p.fine", "Stages come from the band's own motion-and-heart-rate estimate. Timing and duration are reliable; stage minutes are approximate."));
  return screen;
}

/** Sleep apnea risk: STOP-Bang (validated questionnaire) plus what overnight SpO2 spot readings show.
 *  Spot readings can't measure apnea events (they last 10-40 s); this is a prompt to get tested, not a test. */
function breathingCard(ctx, sums, date) {
  const sb = stopBang(ctx.profile);
  const nights = sums.filter((x) => x.date > addDaysStr(date, -14) && x.date <= date && x.night?.spo2);
  const low = nights.reduce((a, x) => a + (x.night.spo2.below90 ?? 0), 0);
  const lowest = nights.length ? Math.min(...nights.map((x) => x.night.spo2.min)) : null;
  const rows = h("div.rows",
    row({ label: "STOP-Bang screening", sub: sb.answered ? "Questionnaire plus age, sex and BMI" : "4 quick questions", onClick: () => stopBangSheet(ctx),
      trailing: sb.answered ? chip(`${sb.score}/8 · ${sb.risk}`, sb.kind) : chip("Take it", "") }),
    nights.length ? row({ label: "Oxygen dips below 90%", sub: `${nights.length} nights · lowest reading ${lowest}%`, value: low, unit: low === 1 ? "reading" : "readings" }) : null);
  const advice = sb.answered && sb.score >= 3
    ? "A score of 3 or more catches about 9 in 10 people with moderate-to-severe sleep apnea (Nagappa 2015). If you also snore or feel sleepy in the day, ask your doctor about a home sleep test; it's simple and treatment helps the heart."
    : "The band checks your oxygen every few minutes, which can't measure apnea itself (pauses last 10–40 seconds). The questionnaire is the better screen.";
  return card(cardHead("Breathing during sleep"), rows, h("p.note", { style: { marginTop: "8px" } }, advice));
}

function partValue(p) {
  if (p.key === "duration") return dur(p.value);
  if (p.key === "efficiency" || p.key === "restoration") return `${Math.round(p.value)}%`;
  if (p.key === "continuity") return `${Math.round(p.value)} min`;
  if (p.key === "regularity") return `${Math.round(p.value)} min off`;
  return String(p.value);
}

function stageNote(sl, age) {
  const deep = sl.pct?.deep ?? 0, rem = sl.pct?.rem ?? 0;
  const typical = age >= 60 ? "Deep sleep usually shrinks with age; 10–15% is common after 60." : "Adults typically spend about 15–20% in deep sleep and 20–25% in REM.";
  return `Deep ${Math.round(deep)}% · REM ${Math.round(rem)}%. ${typical}`;
}

async function trends(ctx, sums, date, age) {
  const out = [section("Last 14 nights")];
  const nights = [];
  for (let i = 13; i >= 0; i--) {
    const d = addDaysStr(date, -i);
    nights.push({ date: d, s: sums.find((x) => x.date === d)?.night?.sleep ?? null });
  }
  const need = sleepNeed(age);
  const have = nights.filter((x) => x.s);
  const avg = have.length ? have.reduce((a, x) => a + x.s.asleep, 0) / have.length : null;
  out.push(card(cardHead("Time asleep", avg != null ? `avg ${dur(avg)}` : null),
    barChart({ bars: nights.map((x) => ({ label: dayLabel(x.date).slice(0, 1), v: x.s ? x.s.asleep / 60 : null, sub: `${dateShort(x.date)} · ${x.s ? dur(x.s.asleep) : "no data"}` })),
      color: "var(--sleep)", band: { lo: need.min / 60, hi: need.max / 60 }, height: 160, fmtV: (v) => dur(v * 60), fmtTick: (v) => `${v}h`,
      labelIndex: nights.length - 1, maxLabels: 14,
      table: { columns: ["Night", "Asleep", "Bedtime", "Wake"], rows: [...have].reverse().map((x) => [dateShort(x.date), dur(x.s.asleep), clock(x.s.onset), clock(x.s.wake)]) } }),
    h("p.note", { style: { marginTop: "8px" } }, `The shaded band is the ${need.min / 60}–${need.max / 60} hours recommended for your age.`)));

  const on = circularStats(have.map((x) => ((x.s.onset_min % 1440) + 1440) % 1440));
  const wk = circularStats(have.map((x) => x.s.wake_min % 1440));
  const rel = (m) => (m < 18 * 60 ? m + 1440 : m); // onset minutes relative to previous midnight, evening → >1440 wrap
  out.push(card(cardHead("Bedtime and wake time", on ? `usually ${clockFromMin(on.mean)} – ${clockFromMin(wk.mean)}` : null),
    sleepWindows({ nights: nights.map((x) => ({ label: dayLabel(x.date).slice(0, 1), onset_min: x.s ? rel(x.s.onset_min) : null,
      wake_min: x.s ? rel(x.s.onset_min) + (x.s.wake_min - x.s.onset_min) : null, sub: dateShort(x.date) })),
      color: "var(--sleep)", fmtClock: (m) => clockFromMin(m).replace(":00", ""), from: 20 * 60, to: 34 * 60, height: 190 })));

  // Regularity
  // SRI compares each minute with the same minute 24 h later, so days must be consecutive calendar days:
  // a missing day stays in place as unknown rather than being dropped.
  const nullDay = new Array(1440).fill(null);
  const states = Array.from({ length: 14 }, (_, i) => addDaysStr(date, i - 13)).map((d) => {
    const x = sums.find((y) => y.date === d);
    return x?.states ? [...x.states].map((c) => (c === "." ? null : +c)) : nullDay;
  });
  const sri = sleepRegularityIndex(states, 7);
  const sdMid = have.length >= 5 ? circularStats(have.map((x) => ((x.s.midpoint_min % 1440) + 1440) % 1440)).sd : null;
  out.push(card(cardHead("Regularity", sri ? `${sri.days} days` : null),
    sri ? h("div", { style: { display: "flex", alignItems: "center", gap: "16px" } },
      ring(Math.max(0, sri.sri), { size: 84, stroke: 8, color: "var(--sleep)", animate: false, aria: `Sleep regularity ${Math.round(sri.sri)}` }),
      h("div", h("b", { style: { fontSize: "17px" } }, sri.sri >= 80 ? "Very regular" : sri.sri >= 70 ? "Fairly regular" : sri.sri >= 60 ? "Somewhat irregular" : "Irregular"),
        h("p.note", `Sleep Regularity Index ${Math.round(sri.sri)}. The chance you're in the same state (asleep or awake) at the same clock time on consecutive days.`)))
      : h("p.note", `Needs 7 nights with the band on. ${have.length} so far.`),
    sdMid != null ? h("p.note", { style: { marginTop: "10px" } }, `Your sleep midpoint varies by about ±${Math.round(sdMid)} minutes night to night.`) : null,
    h("p.fine", { style: { textAlign: "left", padding: "10px 0 0" } }, "In 61,000 UK Biobank adults (average age 63), people in the most regular fifth had 20–48% lower mortality than the least regular, more than sleep length explained (Windred 2024).")));
  return out;
}
