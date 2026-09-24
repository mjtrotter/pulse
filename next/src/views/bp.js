// Home blood-pressure log. Averages follow the home-monitoring protocol (AHA 2019 / ESH): readings on
// several days, morning and evening, averaged; categories are the 2017 ACC/AHA ones, which the 2025
// AHA/ACC guideline kept. A band BP estimate is never shown as a number here (it isn't validated).
import * as db from "../core/db.js?v=20260924162635";
import { clock, dayOf, relTime, stamp, toMs } from "../core/time.js?v=20260924162635";
import { lineChart } from "../ui/charts.js?v=20260924162635";
import { banner, card, cardHead, chip, detailHeader, row, section, toast } from "../ui/components.js?v=20260924162635";
import { h } from "../ui/h.js?v=20260924162635";
import { dateShort } from "./common.js?v=20260924162635";

/** 2017 ACC/AHA categories (unchanged in 2025). */
export function bpCategory(sys, dia) {
  if (sys > 180 || dia > 120) return { key: "crisis", label: "Very high", kind: "attention" };
  if (sys >= 140 || dia >= 90) return { key: "stage2", label: "High (stage 2)", kind: "attention" };
  if (sys >= 130 || dia >= 80) return { key: "stage1", label: "High (stage 1)", kind: "watch" };
  if (sys >= 120) return { key: "elevated", label: "Elevated", kind: "watch" };
  return { key: "normal", label: "Normal", kind: "good" };
}

/** Average of the last 7 days' readings (ignoring the first day when there are 4+ days, per protocol). */
export function bpSummary(rows, now = Date.now()) {
  const recent = rows.filter((r) => toMs(r.t) >= now - 7 * 864e5);
  const days = [...new Set(recent.map((r) => r.t.slice(0, 10)))].sort();
  const use = days.length >= 4 ? recent.filter((r) => r.t.slice(0, 10) !== days[0]) : recent;
  if (use.length < 2) return null;
  const avg = (k) => use.reduce((s, r) => s + r[k], 0) / use.length;
  return { sys: avg("sys"), dia: avg("dia"), pulse: use.some((r) => r.pulse) ? avg("pulse") : null, n: use.length, days: days.length };
}

export default async function bp(ctx) {
  const rows = (await db.all(ctx.store, "bp")).sort((a, b) => (a.t < b.t ? 1 : -1));
  const sum = bpSummary(rows);
  const screen = h("div.screen", detailHeader(() => ctx.back()), h("header.head", h("div.titles", h("span.eyebrow", "Home cuff"), h("h1", "Blood pressure"))));

  const sys = h("input", { inputmode: "numeric", pattern: "[0-9]*", placeholder: "120", "aria-label": "Systolic", autocomplete: "off" });
  const dia = h("input", { inputmode: "numeric", pattern: "[0-9]*", placeholder: "80", "aria-label": "Diastolic", autocomplete: "off" });
  const pulse = h("input", { inputmode: "numeric", pattern: "[0-9]*", placeholder: "Optional", "aria-label": "Pulse", autocomplete: "off" });
  const save = async (e) => {
    e.preventDefault();
    const s = parseInt(sys.value, 10), d = parseInt(dia.value, 10), p = parseInt(pulse.value, 10);
    if (!(s >= 70 && s <= 260 && d >= 30 && d <= 160 && d < s)) { toast("That reading looks off. Check the top and bottom numbers."); return; }
    await db.put(ctx.store, "bp", { t: stamp(), sys: s, dia: d, pulse: Number.isFinite(p) ? p : null, arm: null, note: "" });
    toast("Saved");
    ctx.refresh();
  };
  screen.append(card(cardHead("Add a reading"),
    h("form.form", { onsubmit: save },
      h("label", "Top (systolic)", sys), h("label", "Bottom (diastolic)", dia),
      h("label.full", "Pulse", pulse),
      h("button.btn.primary.full", { type: "submit" }, "Save reading")),
    h("p.note", { style: { marginTop: "10px" } }, "Sit quietly for 5 minutes, back supported, feet flat, arm at heart level. Take two readings a minute apart, morning and evening.")));

  if (sum) {
    const cat = bpCategory(sum.sys, sum.dia);
    screen.append(card(cardHead("Your 7-day average", `${sum.n} readings`),
      h("div", { style: { display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" } },
        h("div.bignum", { style: { fontSize: "44px" } }, `${Math.round(sum.sys)}/${Math.round(sum.dia)}`, h("small", "mmHg")), chip(cat.label, cat.kind)),
      h("p.note", { style: { marginTop: "6px" } }, "Doctors judge blood pressure on averages like this, not single readings. Categories follow the American Heart Association (normal under 120/80; high from 130/80).")));
    if (cat.key === "crisis") screen.append(banner({ title: "Very high reading", body: "If you have chest pain, shortness of breath, weakness or trouble speaking, call 911. Otherwise, rest 5 minutes and measure again, and contact your doctor.", kind: "attention", iconName: "alert" }));
  }

  if (rows.length >= 2) {
    const asc = [...rows].reverse();
    screen.append(card(cardHead("Readings", `${rows.length} logged`),
      lineChart({ series: [
        { points: asc.map((r) => [toMs(r.t), r.sys]), color: "var(--heart)", label: "Systolic", dots: true },
        { points: asc.map((r) => [toMs(r.t), r.dia]), color: "var(--spo2)", label: "Diastolic", dots: true }],
      height: 170, legend: true, fmtV: (v) => `${Math.round(v)}`, fmtWhen: (ms) => `${dateShort(dayOf(new Date(ms)))} ${clock(stamp(new Date(ms)))}`, matchMs: 60e3,
      ticks: asc.filter((_, i) => i % Math.ceil(asc.length / 4) === 0).map((r) => toMs(r.t)), fmtX: (ms) => dateShort(dayOf(new Date(ms))) })));
  }
  if (rows.length) {
    screen.append(section("History"));
    screen.append(card(h("div.rows", rows.slice(0, 40).map((r) => row({ label: `${r.sys}/${r.dia}`, sub: `${dateShort(r.t.slice(0, 10))} · ${clock(r.t)}${r.pulse ? ` · pulse ${r.pulse}` : ""}`,
      trailing: chip(bpCategory(r.sys, r.dia).label, bpCategory(r.sys, r.dia).kind) })))));
  }
  return screen;
}

export { relTime };
