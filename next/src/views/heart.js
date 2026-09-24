// Heart: resting HR and overnight HRV trends against your own baseline, heart rate over time,
// rhythm checks (overnight pulse screen + ECG), blood pressure, daily rhythm and recovery after effort.
import { baseline, median } from "../analytics/baseline.js?v=20260924162635";
import { cosinor } from "../analytics/metrics.js?v=20260924162635";
import * as db from "../core/db.js?v=20260924162635";
import { addDaysStr, clock, clockFromMin, dayOf, DAY, hhmm, relTime, stamp, toMs } from "../core/time.js?v=20260924162635";
import { lineChart } from "../ui/charts.js?v=20260924162635";
import { card, cardHead, deltaChip, header, row, section, segmented } from "../ui/components.js?v=20260924162635";
import { h, icon } from "../ui/h.js?v=20260924162635";
import { bpCategory, bpSummary } from "./bp.js?v=20260924162635";
import { dateShort, dayLabel } from "./common.js?v=20260924162635";

let range = "day";

export default async function heart(ctx) {
  const date = dayOf();
  const sums = await ctx.summaries(60, date);
  const by = new Map(sums.map((x) => [x.date, x]));
  const days30 = Array.from({ length: 30 }, (_, i) => addDaysStr(date, i - 29));
  const screen = h("div.screen", header("Your heart", "Heart"));

  // Resting heart rate
  const rhrPts = days30.map((d) => [toMs(`${d} 12:00:00`), by.get(d)?.night?.hr?.rhr ?? null]).filter((p) => p[1] != null);
  const last = rhrPts[rhrPts.length - 1];
  const bR = baseline(rhrPts.slice(0, -1).map((p) => p[1]), { minN: 5, minSpread: 1.5 });
  const zR = last && bR ? (last[1] - bR.center) / bR.spread : null;
  screen.append(h("div.card.tap", { onclick: () => ctx.nav("metric/rhr") },
    h("div.card-head", h("h2", "Resting heart rate"), icon("chev", "chev")),
    h("div", { style: { display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" } },
      h("div.bignum", { style: { fontSize: "44px" } }, last ? Math.round(last[1]) : "—", h("small", "bpm")),
      deltaChip(zR, { goodWhen: "down", delta: last && bR ? last[1] - bR.center : null, minAbs: 2 })),
    h("p.cap", { style: { margin: "4px 0 10px" } }, bR ? `Your usual range ${Math.round(bR.center - bR.spread)}–${Math.round(bR.center + bR.spread)} bpm (${bR.n} nights)` : "Lowest 30-minute average while asleep"),
    trend(rhrPts, bR, "var(--heart)", "bpm", days30)));

  // Overnight HRV
  const hrvOf = (x) => x?.night?.ppi?.rmssd ?? x?.night?.hrv?.median ?? null;
  const hPts = days30.map((d) => [toMs(`${d} 12:00:00`), hrvOf(by.get(d))]).filter((p) => p[1] != null);
  const hl = hPts[hPts.length - 1];
  const bH = baseline(hPts.slice(0, -1).map((p) => p[1]), { minN: 5, minSpread: 2 });
  screen.append(h("div.card.tap", { onclick: () => ctx.nav("metric/hrv") },
    h("div.card-head", h("h2", "Overnight HRV"), icon("chev", "chev")),
    h("div", { style: { display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" } },
      h("div.bignum", { style: { fontSize: "44px" } }, hl ? Math.round(hl[1]) : "—", h("small", "ms")),
      deltaChip(hl && bH ? (hl[1] - bH.center) / bH.spread : null, { goodWhen: "up", delta: hl && bH ? hl[1] - bH.center : null, minAbs: 3 })),
    h("p.cap", { style: { margin: "4px 0 10px" } }, bH ? `Your usual range ${Math.round(bH.center - bH.spread)}–${Math.round(bH.center + bH.spread)} ms` : "Beat-to-beat variation (RMSSD) while you sleep. Higher than your usual generally means better recovered."),
    trend(hPts, bH, "var(--hrv)", "ms", days30)));

  // Heart rate over time
  screen.append(section("Heart rate", segmented([["day", "24H"], ["week", "7D"]], range, (v) => { range = v; ctx.refresh(); })));
  screen.append(await hrCard(ctx, range, by));

  // Rhythm
  screen.append(section("Rhythm"));
  const nights = days30.slice(-7).map((d) => by.get(d)?.night?.ppi?.rhythm).filter((r) => r?.screened >= 4);
  const flagged = nights.filter((r) => r.flagged).length;
  const ecgs = (await db.all(ctx.store, "ecg")).sort((a, b) => (a.t < b.t ? 1 : -1));
  const le = ecgs[0];
  screen.append(card(
    h("div.rows",
      row({ label: "Overnight pulse check", sub: nights.length ? `${nights.length} night${nights.length > 1 ? "s" : ""} checked this week` : "Checks your pulse rhythm automatically while you sleep",
        value: nights.length ? (flagged ? `${flagged} irregular` : "Regular") : "—" }),
      row({ label: "ECG rhythm check", sub: le ? `${clock(le.t)} ${dayLabel(le.t.slice(0, 10))} · ${le.result?.hrv ? `${Math.round(le.result.hrv.hr)} bpm` : "too noisy"}` : "Hold the band's silver plate for 30 seconds",
        value: le?.result?.hrv ? (le.result.hrv.irregular ? "Irregular" : "Regular") : null, onClick: () => ctx.nav("ecg") })),
    h("button.btn.full", { type: "button", style: { marginTop: "10px" }, onclick: () => ctx.nav("ecg") }, icon("ecg"), "Take a rhythm check"),
    flagged ? h("p.note", { style: { marginTop: "10px", color: "var(--watch)" } }, "Your pulse looked irregular on at least one night. A 30-second ECG while seated and still is the best next step; if it also shows an irregular rhythm, share it with your doctor.") : null));

  // Blood pressure
  const bps = (await db.all(ctx.store, "bp")).sort((a, b) => (a.t < b.t ? 1 : -1));
  const sum = bpSummary(bps);
  screen.append(h("div.card.tap", { onclick: () => ctx.nav("bp") },
    h("div.card-head", h("h2", "Blood pressure"), icon("chev", "chev")),
    bps.length ? h("div",
      h("div.bignum", { style: { fontSize: "40px" } }, sum ? `${Math.round(sum.sys)}/${Math.round(sum.dia)}` : `${bps[0].sys}/${bps[0].dia}`, h("small", "mmHg")),
      h("p.cap", { style: { marginTop: "4px" } }, sum ? `${sum.n}-reading average, last 7 days · ${bpCategory(sum.sys, sum.dia).label}` : `Last reading ${relTime(bps[0].t)}`))
      : h("p.note", "Log readings from a home cuff. Pulse averages them the way doctors recommend (morning and evening, 7 days).")));

  // Daily rhythm (cosinor over the last 3 days)
  // From the summaries' hourly means (cheap on a phone), last 3 full days + today.
  const hourly = [];
  for (const d of days30.slice(-4)) (by.get(d)?.day?.hr_hourly ?? []).forEach((e, k) => { if (e) hourly.push([`${d} ${String(k).padStart(2, "0")}:30:00`, e[0]]); });
  const cz = hourly.length ? cosinor(hourly, `${days30[days30.length - 4]} 00:00:00`, stamp(), 60) : null;
  if (cz) {
    const byHour = new Array(24).fill(0).map(() => [0, 0]);
    for (const [t, v] of hourly) { const k = +t.slice(11, 13); byHour[k][0] += v; byHour[k][1]++; }
    const base = toMs(`${date} 00:00:00`);
    const pts = byHour.map(([s, n], k) => [base + (k + 0.5) * 3600e3, n ? s / n : null]).filter((p) => p[1] != null);
    const fit = Array.from({ length: 49 }, (_, i) => [base + i * 1800e3, cz.mesor + cz.amplitude * Math.cos((2 * Math.PI * (i / 2 - cz.acrophase_h)) / 24)]);
    screen.append(card(cardHead("Daily rhythm", "last 3 days"),
      h("p.cap", { style: { marginTop: "-6px", marginBottom: "8px" } }, `Peaks around ${clockFromMin(cz.acrophase_h * 60)}, lowest around ${clockFromMin(((cz.acrophase_h + 12) % 24) * 60)}. Swings ±${cz.amplitude.toFixed(0)} bpm around ${cz.mesor.toFixed(0)}.`),
      lineChart({ series: [{ points: pts, color: "var(--heart)", label: "Hourly average", dots: true }, { points: fit, color: "var(--ink-3)", label: "24-hour fit" }], height: 150,
        x0: base, x1: base + 24 * 3600e3, ticks: [0, 6, 12, 18].map((k) => base + k * 3600e3), fmtX: (ms) => clock(stamp(new Date(ms))).replace(":00", ""),
        fmtV: (v) => `${Math.round(v)} bpm`, fmtWhen: (ms) => `${clock(stamp(new Date(ms - 1800e3)))} hour`, legend: true,
        table: { columns: ["Hour", "Avg bpm"], rows: pts.map((p) => [clock(stamp(new Date(p[0] - 1800e3))), Math.round(p[1])]) } })));
  }

  // Heart-rate recovery after workouts
  const ws = sums.flatMap((x) => (x.day?.workouts ?? []).map((w) => ({ ...w, date: x.date }))).filter((w) => w.hrr60 != null).slice(-6).reverse();
  if (ws.length) {
    const typical = median(ws.map((w) => w.hrr60));
    screen.append(card(cardHead("Recovery after effort", `typical −${Math.round(typical)} bpm`),
      h("div.rows", ws.map((w) => row({ label: `${dayLabel(w.date)} ${clock(w.start)}`, sub: `${Math.round(w.minutes)} min · peak ${w.peak} bpm`, value: `−${Math.round(w.hrr60)}`, unit: "bpm in 1 min" }))),
      h("p.note", { style: { marginTop: "8px" } }, "How far your heart rate falls in the minute after a workout ends. Compare against your own typical drop; a faster drop over weeks usually means better fitness.")));
  }

  screen.append(h("p.fine", "Resting heart rate is one of the most consistently reproduced markers of long-term heart health: each sustained 10 bpm is associated with about 8–9% higher cardiovascular mortality in large studies (Zhang 2016). Your own trend matters more than any single day."));
  return screen;
}

function trend(pts, b, color, unit, days) {
  return lineChart({ series: [{ points: pts, color, label: unit, dots: pts.length < 12 }], height: 120,
    band: b ? { lo: b.center - b.spread, hi: b.center + b.spread } : null,
    x0: toMs(`${days[0]} 12:00:00`), x1: toMs(`${days[days.length - 1]} 12:00:00`),
    ticks: days.filter((_, i) => i % 7 === 1).map((d) => toMs(`${d} 12:00:00`)), fmtX: (ms) => dateShort(dayOf(new Date(ms))),
    fmtV: (v) => `${Math.round(v)} ${unit}`, fmtWhen: (ms) => dateShort(dayOf(new Date(ms))), empty: "Builds up as you wear the band at night" });
}

async function hrCard(ctx, range, by) {
  const now = Date.now();
  const span = range === "day" ? 864e5 : 7 * 864e5, bucket = range === "day" ? 300e3 : 3600e3;
  let pts;
  if (range === "week") {
    // Hourly means straight from the day summaries (no need to read a week of 5-s samples).
    pts = [];
    for (let i = 7; i >= 0; i--) {
      const d = dayOf(new Date(now - i * 864e5));
      (by.get(d)?.day?.hr_hourly ?? []).forEach((e, k) => { if (e) { const t = toMs(`${d} ${String(k).padStart(2, "0")}:30:00`); if (t >= now - span) pts.push([t, e[0], e[1], e[2]]); } });
    }
  } else {
    const rows = await db.range(ctx.store, "hr", stamp(new Date(now - span)), stamp(new Date(now)));
    const m = new Map();
    for (const r of rows) {
      const k = Math.floor(toMs(r.t) / bucket) * bucket;
      const e = m.get(k) ?? [0, 0, 999, 0];
      e[0] += r.bpm; e[1]++; e[2] = Math.min(e[2], r.bpm); e[3] = Math.max(e[3], r.bpm);
      m.set(k, e);
    }
    pts = [...m].sort((a, b) => a[0] - b[0]).map(([t, e]) => [t + bucket / 2, e[0] / e[1], e[2], e[3]]);
  }
  const ticks = [];
  if (range === "day") { const t = new Date(now - span); t.setMinutes(0, 0, 0); while (t.getTime() < now) { t.setHours(t.getHours() + 1); if (t.getHours() % 6 === 0) ticks.push(t.getTime()); } }
  else for (let i = 6; i >= 0; i--) { const d = new Date(now - i * 864e5); d.setHours(12, 0, 0, 0); ticks.push(d.getTime()); }
  const shades = [];
  for (const s of by.values()) if (s.night?.sleep && toMs(s.night.sleep.wake) > now - span) shades.push({ x0: toMs(s.night.sleep.onset), x1: toMs(s.night.sleep.wake), label: range === "day" ? "Asleep" : null });
  const vals = pts.map((p) => p[1]);
  return card(
    cardHead(vals.length ? `${Math.round(Math.min(...pts.map((p) => p[2])))}–${Math.round(Math.max(...pts.map((p) => p[3])))} bpm` : "No readings", range === "day" ? "last 24 hours" : "last 7 days"),
    lineChart({ series: [{ points: pts.map((p) => [p[0], p[1]]), color: "var(--heart)", label: "Heart rate", area: true }], x0: now - span, x1: now, shades, ticks,
      gapMs: bucket * 4, height: 180, fmtX: (ms) => (range === "day" ? clock(stamp(new Date(ms))).replace(":00", "") : DAY[new Date(ms).getDay()]),
      fmtV: (v) => `${Math.round(v)} bpm`, fmtWhen: (ms) => `${range === "week" ? DAY[new Date(ms).getDay()] + " " : ""}${clock(stamp(new Date(ms)))} · ${range === "day" ? "5-min" : "hourly"} average`,
      table: { columns: ["Time", "Avg", "Min", "Max"], rows: [...pts].reverse().map((p) => [`${range === "week" ? DAY[new Date(p[0]).getDay()] + " " : ""}${hhmm(stamp(new Date(p[0])))}`, Math.round(p[1]), p[2], p[3]]) } }));
}
