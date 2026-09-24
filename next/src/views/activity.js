// Activity: steps vs an age-based goal (Paluch 2022), brisk minutes (≥ 100 steps/min, Tudor-Locke)
// toward 150 a week (WHO 2020), heart-rate workouts you can tag with type and effort (session-RPE load,
// Foster 2001 — the validated load measure for lifting), and two weeks of steps.
import { stepGoal } from "../analytics/scores.js?v=20260924162635";
import * as db from "../core/db.js?v=20260924162635";
import { addDaysStr, clock, dayOf } from "../core/time.js?v=20260924162635";
import { distUnit, km } from "../core/units.js?v=20260924162635";
import { barChart } from "../ui/charts.js?v=20260924162635";
import { card, cardHead, closeSheet, detailHeader, header, ring, row, section, sheet, toast } from "../ui/components.js?v=20260924162635";
import { h, icon } from "../ui/h.js?v=20260924162635";
import { dateLong, dateShort, dayLabel, fmtInt } from "./common.js?v=20260924162635";
import { npcra } from "../analytics/circadian.js?v=20260924162635";

const KINDS = [["walk", "Walk"], ["run", "Run"], ["strength", "Strength"], ["cycle", "Cycling"], ["other", "Other"]];

export default async function activity(ctx, date = dayOf()) {
  const today = dayOf();
  const sums = await ctx.summaries(30, today);
  const by = new Map(sums.map((x) => [x.date, x]));
  const s = by.get(date);
  const p = ctx.profile;
  const goal = p.step_goal || stepGoal(p.age ?? 40);
  const steps = s?.day?.steps ?? 0;
  const tags = await db.all(ctx.store, "tags");
  const tagFor = (w) => tags.find((t) => t.tag === `workout ${w.start}`);

  const screen = h("div.screen", date === today ? header(dateLong(date), "Activity") : detailHeader(() => ctx.back()));
  if (date !== today) screen.append(h("header.head", h("div.titles", h("span.eyebrow", dateLong(date)), h("h1", "Activity"))));

  const pct = Math.round(Math.min(100, (100 * steps) / goal));
  screen.append(h("div.card.hero",
    ring(pct, { size: 168, stroke: 14, color: "var(--act)", suffix: "%", aria: `${pct}% of your step goal` }),
    h("div.bignum", fmtInt(steps), h("small", "steps")),
    h("p.sentence", `Goal ${goal.toLocaleString()} for your age${s?.day?.km ? ` · ${km(s.day.km).toFixed(1)} ${distUnit()}` : ""}`)));

  // Brisk minutes: today and the last 7 days.
  const mvpaOf = (x) => Math.max(x?.day?.activity?.mvpa_min ?? 0, (x?.day?.workouts ?? []).reduce((a, w) => a + w.minutes, 0));
  const week = Array.from({ length: 7 }, (_, i) => addDaysStr(date, i - 6));
  const weekMin = Math.round(week.reduce((a, d) => a + mvpaOf(by.get(d)), 0));
  screen.append(card(cardHead("Active minutes", `${weekMin} of 150 this week`),
    h("div.meter", { style: { height: "10px", borderRadius: "5px", marginTop: 0 } }, h("i", { style: { width: `${Math.min(100, (100 * weekMin) / 150)}%`, background: "var(--act)", borderRadius: "5px" } })),
    h("div.rows", { style: { marginTop: "8px" } },
      row({ label: "Brisk walking", sub: "Minutes at 100+ steps a minute", value: s?.day?.activity?.mvpa_min ?? 0, unit: "min today" }),
      row({ label: "Heart-rate workouts", sub: "10+ minutes at moderate effort or more (40% of heart-rate reserve)", value: Math.round((s?.day?.workouts ?? []).reduce((a, w) => a + w.minutes, 0)), unit: "min today" }),
      s?.day?.activity?.peak30 ? row({ label: "Best 30-minute pace", sub: "Average of your 30 busiest minutes", value: Math.round(s.day.activity.peak30), unit: "steps/min" }) : null),
    h("p.note", { style: { marginTop: "6px" } }, "The WHO recommends 150–300 minutes of moderate activity a week. Brisk walking counts from about 100 steps a minute at any age from 21 to 85.")));

  // Steps by hour today
  if (s?.day?.activity?.hourly) {
    const hourly = s.day.activity.hourly;
    screen.append(card(cardHead("Steps by hour", `${s.day.activity.active_hours} active hours`),
      barChart({ bars: hourly.map((v, i) => ({ label: i % 6 === 0 ? clock(`2000-01-01 ${String(i).padStart(2, "0")}:00:00`).replace(":00", "") : "", v, sub: `${clock(`2000-01-01 ${String(i).padStart(2, "0")}:00:00`)}` })),
        color: "var(--act)", height: 140, fmtV: (v) => `${fmtInt(v)} steps`, maxLabels: 24,
        table: { columns: ["Hour", "Steps"], rows: hourly.map((v, i) => [clock(`2000-01-01 ${String(i).padStart(2, "0")}:00:00`), v]).filter((r) => r[1] > 0) } })));
  }

  // Workouts (last 7 days)
  const ws = week.flatMap((d) => (by.get(d)?.day?.workouts ?? []).map((w) => ({ ...w, date: d }))).reverse();
  screen.append(section("Workouts", h("span", { style: { color: "var(--ink-3)", fontSize: "14px" } }, "last 7 days")));
  if (!ws.length) screen.append(card(h("p.note", p.age && p.sex ? "None yet. A workout is 10+ minutes with your heart rate at moderate effort or more (a brisk walk, a jog, a lifting session)." : "Add your age and sex (You → Profile) to detect workouts.")));
  else screen.append(card(h("div.rows", ws.map((w) => {
    const t = tagFor(w);
    const kind = t?.type ? KINDS.find((k) => k[0] === t.type)?.[1] : null;
    return row({ label: `${kind ?? "Heart-rate workout"} · ${dayLabel(w.date)} ${clock(w.start)}`,
      sub: `${Math.round(w.minutes)} min · avg ${Math.round(w.mean)}, peak ${w.peak} bpm${w.hrr60 != null ? ` · 1-min drop ${Math.round(w.hrr60)}` : ""}${t?.rpe != null ? ` · load ${Math.round(t.rpe * w.minutes)}` : ""}`,
      lead: h("span", { style: { width: "36px", height: "36px", borderRadius: "12px", display: "grid", placeItems: "center", background: "var(--surface-2)", color: "var(--act)", flex: "none" } }, icon(t?.type === "strength" ? "dumbbell" : "activity")),
      value: t ? null : "Tag", onClick: () => tagSheet(ctx, w, t) });
  })), h("p.note", { style: { marginTop: "8px" } }, "Tag a workout with what it was and how hard it felt (0–10). Effort × minutes is a validated training load, including for weights, which heart rate alone undercounts.")));

  // Two weeks of steps
  const days = Array.from({ length: 14 }, (_, i) => addDaysStr(date, i - 13));
  const bars = days.map((d) => ({ label: dayLabel(d).slice(0, 1), v: by.get(d)?.day?.steps ?? null, sub: `${dateShort(d)} · ${fmtInt(by.get(d)?.day?.steps)} steps` }));
  const have = bars.filter((b) => b.v != null);
  screen.append(section("Last 14 days"));
  screen.append(card(cardHead("Steps", `${have.length ? `avg ${fmtInt(have.reduce((a, b) => a + b.v, 0) / have.length)} · ` : ""}goal ${goal.toLocaleString()}`),
    barChart({ bars, color: "var(--act)", goal, goalLabel: "", height: 170, fmtV: (v) => fmtInt(v), fmtTick: (v) => (v >= 1000 ? `${v / 1000}k` : v), labelIndex: 13, maxLabels: 14,
      table: { columns: ["Day", "Steps"], rows: [...have].reverse().map((b) => [b.sub.split(" · ")[0], fmtInt(b.v)]) } }),
    h("p.note", { style: { marginTop: "8px" } }, (p.age ?? 40) >= 60
      ? "For adults over 60, the benefit of more steps levels off around 6,000–8,000 a day (Paluch 2022, 15 studies, 47,000 people)."
      : "For adults under 60, the benefit of more steps levels off around 8,000–10,000 a day (Paluch 2022, 15 studies, 47,000 people).")));

  // Body clock (7-14 days of hourly steps)
  const hist = Array.from({ length: 14 }, (_, i) => addDaysStr(date, i - 14)).map((d) => by.get(d)?.day)
    .filter((d) => d?.activity?.hourly && d?.hr_hourly).map((d) => ({ hourly: d.activity.hourly, worn: d.hr_hourly.map((e) => e != null) }));
  const nc = npcra(hist);
  if (nc) {
    const hr = (k) => clock(`2000-01-01 ${String(k).padStart(2, "0")}:00:00`).replace(":00", "");
    screen.append(card(cardHead("Body clock", `${nc.days} days`),
      barChart({ bars: nc.profile.map((v, k) => ({ label: k % 6 === 0 ? hr(k) : "", v: Math.round(v), sub: `${hr(k)} average` })), color: "var(--act)", height: 120,
        fmtV: (v) => `${fmtInt(v)} steps`, maxLabels: 24 }),
      h("div.rows", { style: { marginTop: "6px" } },
        row({ label: "Most active hours", sub: "Your busiest 10-hour stretch on an average day", value: `${hr(nc.m10_start)}–${hr((nc.m10_start + 10) % 24)}` }),
        row({ label: "Day-to-day steadiness", sub: "How alike your days' activity patterns are (0–1)", value: nc.is.toFixed(2) })),
      h("p.note", { style: { marginTop: "6px" } }, "Interdaily stability (Van Someren 1999): steadier daily patterns go with a sturdier body clock and, in large studies, better sleep and mood. Compare with your own number over time; regular wake times, morning daylight and daytime activity raise it.")));
  }

  // Zones today
  const zm = s?.day?.zone_minutes;
  if (zm && zm.some((m) => m > 0)) {
    const names = ["Easy", "Moderate", "Aerobic", "Hard", "Maximum"];
    const max = Math.max(...zm);
    screen.append(card(cardHead("Heart-rate zones today"), h("div.rows", zm.map((m, i) => h("div.row", { style: { minHeight: "44px" } },
      h("div.rl", h("b", `Zone ${i + 1} · ${names[i]}`)), h("div.rr", `${Math.round(m)}`, h("small", "min")),
      h("div.meter", { style: { flexBasis: "100%" } }, h("i", { style: { width: `${max ? (100 * m) / max : 0}%`, background: "var(--heart)", opacity: String(0.45 + 0.11 * i) } }))))),
      h("p.note", { style: { marginTop: "6px" } }, p.betablocker ? "Zones use a heart-rate maximum adjusted for beta-blockers (Brawner 2004)." : "Zones use your heart-rate reserve (Karvonen) with a maximum estimated from age (Tanaka 2001).")));
  }
  return screen;
}

function tagSheet(ctx, w, existing) {
  let type = existing?.type ?? null, rpe = existing?.rpe ?? null;
  const kinds = h("div.choice", { style: { flexDirection: "row", flexWrap: "wrap", gap: "8px" } });
  const rpes = h("div", { style: { display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "8px" } });
  const paint = () => {
    kinds.replaceChildren(...KINDS.map(([k, label]) => h("button", { type: "button", class: type === k ? "on" : "", style: { flex: "1 0 30%", justifyContent: "center", minHeight: "48px" }, onclick: () => { type = k; paint(); } }, label)));
    rpes.replaceChildren(...Array.from({ length: 11 }, (_, i) => h("button.btn", { type: "button", style: { minWidth: 0, padding: 0, background: rpe === i ? "var(--accent)" : null, color: rpe === i ? "var(--accent-ink)" : null }, onclick: () => { rpe = i; paint(); } }, String(i))));
  };
  paint();
  sheet(`${clock(w.start)} workout`,
    h("p.note", `${Math.round(w.minutes)} minutes · average ${Math.round(w.mean)} bpm · peak ${w.peak} bpm`),
    h("h3", { style: { fontSize: "15px", margin: "16px 0 8px" } }, "What was it?"), kinds,
    h("h3", { style: { fontSize: "15px", margin: "16px 0 8px" } }, "How hard did it feel? (0 rest · 5 hard · 10 maximal)"), rpes,
    h("button.btn.primary.full", { type: "button", style: { marginTop: "18px" }, onclick: async () => {
      await db.put(ctx.store, "tags", { date: w.start.slice(0, 10), tag: `workout ${w.start}`, type, rpe, minutes: w.minutes });
      closeSheet(); toast("Saved"); ctx.refresh();
    } }, "Save"));
}
