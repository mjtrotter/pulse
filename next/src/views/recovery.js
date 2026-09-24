// Recovery: tonight vs your own baseline, with every contributor shown against your usual range.
import { baseline } from "../analytics/baseline.js?v=20260924145338";
import { addDaysStr, dayOf, toMs } from "../core/time.js?v=20260924145338";
import { fmtTempDelta, tempC, tempUnit } from "../core/units.js?v=20260924145338";
import { barChart, lineChart } from "../ui/charts.js?v=20260924145338";
import { building, card, cardHead, detailHeader, rangeBar, ring, scoreStatus, section } from "../ui/components.js?v=20260924145338";
import { h, icon } from "../ui/h.js?v=20260924145338";
import { dateLong, dateShort, dayLabel } from "./common.js?v=20260924145338";

const lnHrv = (n) => n?.ppi?.ln_rmssd ?? (n?.hrv?.median > 0 ? Math.log(n.hrv.median) : null);

export default async function recovery(ctx, date = dayOf()) {
  const today = dayOf();
  const sums = await ctx.summaries(60, today);
  const s = sums.find((x) => x.date === date);
  const rec = s?.scores?.recovery;
  const prior = sums.filter((x) => x.date < date).slice(-28);

  const screen = h("div.screen", detailHeader(() => ctx.back()),
    h("header.head", h("div.titles", h("span.eyebrow", dateLong(date)), h("h1", "Recovery"))),
    h("div.datenav",
      h("button", { type: "button", "aria-label": "Previous day", onclick: () => ctx.nav(`recovery/${addDaysStr(date, -1)}`) }, icon("left")),
      h("span.d", date === today ? "This morning" : dateShort(date)),
      h("button", { type: "button", "aria-label": "Next day", disabled: date >= today, onclick: () => ctx.nav(`recovery/${addDaysStr(date, 1)}`) }, icon("right"))));

  if (!rec?.ready) {
    screen.append(h("div.card.hero", ring(null, { size: 168, stroke: 14 }),
      building(rec?.nights ?? prior.filter((x) => x.night?.hr?.rhr).length, 5,
        "Recovery compares each night with your own usual. It needs about five nights of wear to learn what's normal for you. Your sleep and heart numbers work from the first night.")));
  } else {
    const st = scoreStatus(rec.score);
    screen.append(h("div.card.hero",
      ring(rec.score, { size: 168, stroke: 14, color: st.color, aria: `Recovery ${rec.score}` }),
      h("span.verdict", { style: { color: st.color } }, st.label),
      h("p.sentence", rec.score >= 70 ? "Your body looks well recovered. A good day for your usual activity or a harder session."
        : rec.score >= 55 ? "Somewhat below your best. Keep effort moderate and get to bed on time."
          : "Your body is showing strain. Take it easy today if you can.")));

    // Contributors with your usual range.
    const rows = [];
    for (const p of rec.parts) {
      let bar = null, value = "", usual = "";
      if (p.key === "rhr") {
        const b = baseline(prior.map((x) => x.night?.hr?.rhr), { minN: 5, minSpread: 1.5 });
        value = `${Math.round(p.value)} bpm`; usual = b ? `usual ${Math.round(b.center - b.spread)}–${Math.round(b.center + b.spread)}` : "";
        if (b) bar = rangeBar({ value: p.value, center: b.center, spread: b.spread, lo: b.center - 4 * b.spread, hi: b.center + 4 * b.spread, color: "var(--heart)" });
      } else if (p.key === "hrv") {
        const b = baseline(prior.map((x) => lnHrv(x.night)), { minN: 5, minSpread: 0.05 });
        value = `${Math.round(p.value)} ms`; usual = b ? `usual ${Math.round(Math.exp(b.center - b.spread))}–${Math.round(Math.exp(b.center + b.spread))}` : "";
        if (b) bar = rangeBar({ value: Math.log(p.value), center: b.center, spread: b.spread, lo: b.center - 4 * b.spread, hi: b.center + 4 * b.spread, color: "var(--hrv)" });
      } else if (p.key === "temp") {
        value = `${fmtTempDelta(p.value)}${tempUnit().slice(1)}`; usual = "vs your usual night";
        const sp = 0.25;
        bar = rangeBar({ value: p.value, center: 0, spread: sp, lo: -1, hi: 1, color: "var(--temp)" });
      } else if (p.key === "sleep") {
        value = `${p.value}/100`; usual = "Sleep score";
      }
      rows.push(h("div.row", { style: { flexWrap: "wrap", rowGap: "2px" } },
        h("div.rl", h("b", p.label), h("span", usual)),
        h("div.rr", value, h("small", ` · ${p.points}/${p.max}`)),
        h("div", { style: { flexBasis: "100%" } }, bar ?? h("div.meter", h("i", { style: { width: `${Math.round(p.frac * 100)}%`, background: "var(--sleep)" } })))));
    }
    screen.append(card(cardHead("What went into it", `${rec.score}/100`), h("div.rows", rows),
      h("p.note", { style: { marginTop: "10px" } }, "The grey band is your usual range (typical night ± one typical swing), the dot is last night.")));
  }

  // Illness signal
  const ill = s?.scores?.illness;
  if (ill?.ready) {
    screen.append(card(cardHead("Early-warning check", ill.level === "none" ? "No signal" : ill.level === "red" ? "Signal" : "Watch"),
      h("p.note", `Overnight heart rate ${ill.delta >= 0 ? "+" : "−"}${Math.abs(ill.delta).toFixed(1)} bpm vs your usual. An alert needs +3 bpm with a warmer-than-usual or restless night; +4 bpm two nights running is stronger.`),
      h("p.fine", { style: { textAlign: "left", padding: "8px 0 0" } }, "Method: NightSignal (Alavi et al., Nature Medicine 2022), which flagged infections a median of 3 days before symptoms. It also reacts to alcohol, travel and stress.")));
  }

  // Trends
  screen.append(section("Last 14 days"));
  const days = Array.from({ length: 14 }, (_, i) => addDaysStr(date, i - 13));
  const by = new Map(sums.map((x) => [x.date, x]));
  const recBars = days.map((d) => { const r = by.get(d)?.scores?.recovery; return { label: dayLabel(d).slice(0, 1), v: r?.ready ? r.score : null, color: scoreStatus(r?.ready ? r.score : null).color, sub: `${dateShort(d)} · ${r?.ready ? scoreStatus(r.score).label : "no score"}` }; });
  screen.append(card(cardHead("Recovery"), barChart({ bars: recBars, height: 150, yMax: 100, fmtV: (v) => `${v}`, labelIndex: 13, maxLabels: 14,
    table: { columns: ["Day", "Recovery"], rows: days.map((d, i) => [dateShort(d), recBars[i].v ?? "—"]).reverse() } })));
  screen.append(trendCard("Resting heart rate", days, by, (x) => x.night?.hr?.rhr, "var(--heart)", "bpm", { minSpread: 1.5 }));
  screen.append(trendCard("Overnight HRV", days, by, (x) => x.night?.ppi?.rmssd ?? x.night?.hrv?.median, "var(--hrv)", "ms", { minSpread: 2 }));
  screen.append(trendCard("Skin temperature at night", days, by, (x) => x.night?.temp?.median != null ? tempC(x.night.temp.median) : null, "var(--temp)", tempUnit(), { minSpread: 0.1, digits: 1 }));
  return screen;
}

export function trendCard(title, days, by, f, color, unit, { minSpread = 0, digits = 0 } = {}) {
  const pts = days.map((d) => [toMs(`${d} 12:00:00`), f(by.get(d) ?? {})]).filter((p) => p[1] != null);
  const b = baseline(pts.slice(0, -1).map((p) => p[1]), { minN: 3, minSpread });
  const last = pts[pts.length - 1];
  return card(cardHead(title, last ? `${last[1].toFixed(digits)} ${unit}` : null),
    lineChart({ series: [{ points: pts, color, label: title, dots: true }], height: 140,
      band: b ? { lo: b.center - b.spread, hi: b.center + b.spread, label: "Usual" } : null,
      ticks: days.filter((_, i) => i % 3 === 1).map((d) => toMs(`${d} 12:00:00`)), fmtX: (ms) => dayLabel(dayOf(new Date(ms))),
      x0: toMs(`${days[0]} 12:00:00`), x1: toMs(`${days[days.length - 1]} 12:00:00`),
      fmtV: (v) => `${v.toFixed(digits)} ${unit}`, fmtWhen: (ms) => dateShort(dayOf(new Date(ms))), fmtTick: (v) => v.toFixed(digits),
      table: { columns: ["Day", title], rows: [...pts].reverse().map((p) => [dateShort(dayOf(new Date(p[0]))), p[1].toFixed(digits)]) } }));
}
