// Drill-down for one nightly/daily metric: 30 or 90 days against your usual range, how it's measured,
// what's typical, and a table.
import { baseline, median } from "../analytics/baseline.js?v=20260924162635";
import { addDaysStr, dayOf, toMs } from "../core/time.js?v=20260924162635";
import { tempC, tempUnit, tempDelta } from "../core/units.js?v=20260924162635";
import { lineChart, barChart } from "../ui/charts.js?v=20260924162635";
import { card, cardHead, detailHeader, segmented } from "../ui/components.js?v=20260924162635";
import { h } from "../ui/h.js?v=20260924162635";
import { dateShort } from "./common.js?v=20260924162635";
import { currentPhase } from "../analytics/cycle.js?v=20260924162635";

let span = 30;

const METRICS = {
  rhr: { title: "Resting heart rate", color: "var(--heart)", unit: () => "bpm", digits: 0, minSpread: 1.5, goodWhen: "down",
    get: (s) => s.night?.hr?.rhr,
    how: "The lowest 30-minute average of your heart rate while you slept. The band samples your pulse every few seconds all night.",
    typical: "Night-time resting heart rate for adults is typically 50–80 bpm for men and 53–82 bpm for women (Quer 2020, 92,000 wearable users). Night-to-night swings of about 3 bpm are normal. A rise of 3+ bpm for a couple of nights often comes before or with illness, and also follows alcohol, late meals, stress and hard training." },
  hrv: { title: "Overnight HRV", color: "var(--hrv)", unit: () => "ms", digits: 0, minSpread: 2, goodWhen: "up",
    get: (s) => s.night?.ppi?.rmssd ?? s.night?.hrv?.median,
    how: "RMSSD: how much the time between heartbeats varies from one beat to the next. Pulse computes it from the band's own beat-to-beat pulse recordings while you sleep, after removing movement artifacts, and takes the night's median.",
    typical: "HRV falls steadily with age and varies a lot between people, so compare only with yourself. A drop below your usual range for several nights often comes with illness, stress, poor sleep or overtraining. Beta-blockers tend to raise it." },
  spo2: { title: "Blood oxygen at night", color: "var(--spo2)", unit: () => "%", digits: 0, minSpread: 0.5, goodWhen: "up",
    get: (s) => s.night?.spo2?.median, getLow: (s) => s.night?.spo2?.min,
    how: "Spot readings of oxygen saturation (SpO₂) the band takes while you sleep; the chart shows each night's median and lowest.",
    typical: "Healthy adults usually read 95–100%. Wrist readings are spot checks, typically within ±3–4% of a finger oximeter, and are less accurate on darker skin. One low reading means little. Repeated readings below 90% during sleep, especially with loud snoring or daytime sleepiness, are worth mentioning to a doctor." },
  temp: { title: "Skin temperature at night", color: "var(--temp)", unit: () => tempUnit(), digits: 1, minSpread: 0.1, goodWhen: null,
    get: (s) => (s.night?.temp?.median != null ? tempC(s.night.temp.median) : null),
    how: "The median of the band's wrist temperature readings while you sleep (it measures every 10 minutes).",
    typical: "Wrist temperature is not core body temperature; what matters is the change from your usual. A rise of about 0.5 °C (0.9 °F) or more for a couple of nights often accompanies illness; alcohol, a warm room or heavy bedding also raise it (TemPredict, Smarr 2020)." },
  resp: { title: "Breathing rate asleep", color: "var(--spo2)", unit: () => "/min", digits: 1, minSpread: 0.5, goodWhen: null,
    get: (s) => s.night?.resp?.rate,
    how: "Your heart speeds up slightly as you breathe in and slows as you breathe out. Pulse finds that rhythm in the band's beat-to-beat pulse recordings while you sleep and takes the night's median.",
    typical: "Adults usually breathe 12–20 times a minute asleep, and each person's rate is very steady night to night. A rise of 1–2 breaths a minute above your usual, especially with a higher resting heart rate or temperature, often comes with an infection (Miller 2021). This is an estimate from pulse timing, not a direct measurement." },
  steps: { title: "Steps", color: "var(--act)", unit: () => "steps", digits: 0, minSpread: 500, goodWhen: "up", bars: true,
    get: (s) => s.day?.steps,
    how: "The band's step count for each day.",
    typical: "The benefit of more daily steps levels off around 6,000–8,000 for adults over 60 and 8,000–10,000 under 60 (Paluch 2022, 47,000 people in 15 studies)." },
};

export default async function metric(ctx, key = "rhr") {
  const m = METRICS[key] ?? METRICS.rhr;
  const date = dayOf();
  const sums = await ctx.summaries(span + 30, date);
  const by = new Map(sums.map((x) => [x.date, x]));
  const days = Array.from({ length: span }, (_, i) => addDaysStr(date, i - span + 1));
  const pts = days.map((d) => [toMs(`${d} 12:00:00`), by.has(d) ? m.get(by.get(d)) ?? null : null]).filter((p) => p[1] != null);
  const b = baseline(pts.slice(0, -1).map((p) => p[1]), { minN: 3, minSpread: key === "temp" ? tempDelta(0.1) : m.minSpread, maxN: span });
  const last = pts[pts.length - 1];
  const screen = h("div.screen", detailHeader(() => ctx.back()),
    h("header.head", h("div.titles", h("span.eyebrow", "Trend"), h("h1", m.title))));

  screen.append(h("div.card",
    h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "12px", marginBottom: "10px" } },
      h("div", h("div.bignum", { style: { fontSize: "46px" } }, last ? (key === "steps" ? Math.round(last[1]).toLocaleString() : last[1].toFixed(m.digits)) : "—", h("small", m.unit())),
        h("p.cap", b ? `Usual ${fmt(b.center - b.spread, m)}–${fmt(b.center + b.spread, m)} · median ${fmt(b.center, m)}` : "Your usual range appears after a few nights")),
      segmented([[30, "30D"], [90, "90D"]], span, (v) => { span = v; ctx.refresh(); })),
    m.bars
      ? barChart({ bars: days.map((d) => ({ label: dateShort(d).split(" ")[1], v: by.get(d) ? m.get(by.get(d)) : null, sub: dateShort(d) })), color: m.color, height: 190,
        fmtV: (v) => Math.round(v).toLocaleString(), fmtTick: (v) => (v >= 1000 ? `${v / 1000}k` : v), maxLabels: 6,
        table: { columns: ["Day", m.title], rows: [...pts].reverse().map((p) => [dateShort(dayOf(new Date(p[0]))), Math.round(p[1]).toLocaleString()]) } })
      : lineChart({ series: [{ points: pts, color: m.color, label: m.title, dots: span <= 30 },
          ...(m.getLow ? [{ points: days.map((d) => [toMs(`${d} 12:00:00`), by.has(d) ? m.getLow(by.get(d)) ?? null : null]).filter((p) => p[1] != null), color: "var(--ink-3)", label: "Lowest reading", dots: true }] : [])],
        band: b ? { lo: b.center - b.spread, hi: b.center + b.spread, label: "Usual" } : null, height: 200, legend: !!m.getLow,
        x0: toMs(`${days[0]} 12:00:00`), x1: toMs(`${days[days.length - 1]} 12:00:00`),
        ticks: days.filter((_, i) => i % Math.ceil(span / 4) === Math.floor(span / 8)).map((d) => toMs(`${d} 12:00:00`)), fmtX: (ms) => dateShort(dayOf(new Date(ms))),
        fmtV: (v) => `${fmt(v, m)} ${m.unit()}`, fmtWhen: (ms) => dateShort(dayOf(new Date(ms))), fmtTick: (v) => v.toFixed(m.digits),
        table: { columns: ["Night", m.title], rows: [...pts].reverse().map((p) => [dateShort(dayOf(new Date(p[0]))), fmt(p[1], m)]) } })));

  const vals = pts.map((p) => p[1]);
  if (vals.length >= 3) {
    screen.append(card(cardHead(`Last ${span} days`), h("div.rows",
      h("div.row", h("div.rl", h("b", "Median")), h("div.rr", fmt(median(vals), m), h("small", m.unit()))),
      h("div.row", h("div.rl", h("b", m.getLow ? "Lowest single reading" : "Lowest")), h("div.rr", fmt(m.getLow ? Math.min(...days.map((d) => (by.has(d) ? m.getLow(by.get(d)) : null)).filter((v) => v != null)) : Math.min(...vals), m), h("small", m.unit()))),
      h("div.row", h("div.rl", h("b", "Highest")), h("div.rr", fmt(Math.max(...vals), m), h("small", m.unit()))),
      h("div.row", h("div.rl", h("b", "Nights with data")), h("div.rr", String(vals.length))))));
  }
  if (key === "temp" && ctx.profile.sex === "female" && ctx.profile.cycle) {
    const nights = days.map((d) => ({ date: d, temp: by.get(d)?.night?.temp?.median ?? null }));
    const ph = currentPhase(nights);
    screen.append(card(cardHead("Cycle phase", "from temperature"), h("p.note", ph.phase === "unknown"
      ? "No temperature shift found yet. It shows up after ovulation as a few nights in a row about 0.3 °C (0.5 °F) warmer than the week before."
      : ph.phase === "higher"
        ? `Higher-temperature phase since ${dateShort(ph.since)} (${ph.days} nights). This usually follows ovulation by about a day; a period typically starts 10–16 days after the shift.`
        : `Your last temperature shift was on ${dateShort(ph.since)}; temperature has since dropped back, which usually happens around a period.`),
      h("p.fine", { style: { textAlign: "left", padding: "8px 0 0" } }, "Confirms ovulation after the fact; it can't predict it or be used as contraception. Wrist-temperature methods estimate ovulation within about 1.2–1.6 days (Apple Women's Health Study, Human Reproduction 2025).")));
  }
  screen.append(card(cardHead("How it's measured"), h("p.note", m.how)));
  screen.append(card(cardHead("What's typical"), h("p.note", m.typical)));
  return screen;
}

const fmt = (v, m) => (m.digits ? v.toFixed(m.digits) : Math.round(v).toLocaleString());
