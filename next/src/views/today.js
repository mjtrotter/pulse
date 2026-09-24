// Today: three daily scores, one plain-English line, vitals tiles, today's heart rate, quick actions.
import * as db from "../core/db.js?v=20260924162635";
import { addDaysStr, clock, dayOf, hhmm, relTime, stamp, toMs } from "../core/time.js?v=20260924162635";
import { fmtTemp, fmtTempDelta, tempDelta, tempUnit } from "../core/units.js?v=20260924162635";
import { headline } from "../analytics/scores.js?v=20260924162635";
import { banner, card, cardHead, deltaChip, header, ring, scoreStatus, section, sparkline, tile } from "../ui/components.js?v=20260924162635";
import { lineChart } from "../ui/charts.js?v=20260924162635";
import { h, icon } from "../ui/h.js?v=20260924162635";
import { dateLong, fmtInt, greeting, series, syncPill, vsUsual } from "./common.js?v=20260924162635";

export default async function today(ctx) {
  const date = dayOf();
  const sums = await ctx.summaries(40, date);
  const s = sums.find((x) => x.date === date) ?? null;
  const p = ctx.profile;
  const initial = (p.name ?? "").trim().charAt(0).toUpperCase() || "•";

  const screen = h("div.screen",
    header(dateLong(date), greeting(p.name), h("button.iconbtn.avatar", { type: "button", "aria-label": "You and settings", onclick: () => ctx.nav("you") }, initial)),
    syncPill(ctx));

  for (const b of await banners(ctx, sums, s)) screen.append(b);

  // --- Scores ---
  const sc = s?.scores ?? {};
  const cell = (key, label, value, color, sub, route, suffix = "") => h("div.ringcell", { role: "button", tabindex: 0, onclick: () => ctx.nav(route),
    onkeydown: (e) => { if (e.key === "Enter") ctx.nav(route); }, "aria-label": `${label} ${value ?? "not available"}` },
    ring(value, { size: 92, stroke: 8, color, suffix: value != null ? suffix : "", aria: `${label} score ${value ?? "not ready"}` }),
    h("span.rlabel", label), h("span.rsub", sub));
  const sl = sc.sleep, rec = sc.recovery, act = sc.activity;
  const recSub = rec?.ready ? (rec.parts.find((x) => x.key === "rhr") ? `RHR ${Math.round(rec.parts.find((x) => x.key === "rhr").value)}` : scoreStatus(rec.score).label)
    : rec ? `Night ${Math.min(rec.nights + 1, rec.need)} of ${rec.need}` : "Wear overnight";
  // Today's steps: the band's live counter (read at every sync) runs ahead of its stored daily total.
  const bandRow = (await db.all(ctx.store, "band")).sort((a, b) => (a.last_sync < b.last_sync ? 1 : -1))[0];
  const live = bandRow?.snapshot_at?.slice(0, 10) === date ? bandRow.snapshot?.steps ?? null : null;
  const steps = s?.day?.steps != null || live != null ? Math.max(s?.day?.steps ?? 0, live ?? 0) : null;
  const actPct = act ? Math.round(Math.min(100, (100 * (steps ?? 0)) / act.goal)) : null;
  const scores = h("div.card.scores",
    h("div.rings",
      cell("sleep", "Sleep", sl?.score ?? null, "var(--sleep)", s?.night?.sleep ? fmtDur(s.night.sleep.asleep) : "No data", `sleep/${date}`),
      cell("recovery", "Recovery", rec?.ready ? rec.score : null, scoreStatus(rec?.ready ? rec.score : null).color, recSub, `recovery/${date}`),
      cell("activity", "Activity", actPct, "var(--act)", steps != null ? `${fmtInt(steps)} steps` : "No steps yet", `activity/${date}`, "%")));
  const line = headline(s, sums.filter((x) => x.date < date));
  scores.append(h("p.headline", line ?? (s?.night ? "Your overview updates each time the band syncs." : "Wear the band tonight and sync in the morning to see your first scores.")));
  screen.append(scores);

  // --- Vitals ---
  screen.append(section("Vitals", h("button.link", { type: "button", onclick: () => ctx.nav("heart") }, "Heart")));
  const rhr = vsUsual(sums, date, (x) => x.night?.hr?.rhr, { minN: 5, minSpread: 1.5 });
  const hrvOf = (x) => x.night?.ppi?.rmssd ?? x.night?.hrv?.median ?? null;
  const hrv = vsUsual(sums, date, hrvOf, { minN: 5, minSpread: 2 });
  const spo = s?.night?.spo2;
  const tmp = vsUsual(sums, date, (x) => x.night?.temp?.median, { minN: 3, minSpread: 0.15 });
  const tempDev = tmp.value != null && tmp.usual != null ? tmp.value - tmp.usual : null;
  screen.append(h("div.tiles",
    tile({ label: "Resting HR", color: "var(--heart)", value: rhr.value != null ? Math.round(rhr.value) : null, unit: "bpm",
      sub: rhr.usual != null ? `Usual ${Math.round(rhr.usual)}` : "Lowest 30 min asleep", chipEl: deltaChip(rhr.z, { goodWhen: "down", delta: rhr.value - rhr.usual, minAbs: 2 }),
      spark: sparkline(series(sums, date, (x) => x.night?.hr?.rhr), "var(--heart)"), onClick: () => ctx.nav("metric/rhr") }),
    tile({ label: "Overnight HRV", color: "var(--hrv)", value: hrv.value != null ? Math.round(hrv.value) : null, unit: "ms",
      sub: hrv.usual != null ? `Usual ${Math.round(hrv.usual)}` : "RMSSD while asleep", chipEl: deltaChip(hrv.z, { goodWhen: "up", delta: hrv.value - hrv.usual, minAbs: 3 }),
      spark: sparkline(series(sums, date, hrvOf), "var(--hrv)"), onClick: () => ctx.nav("metric/hrv") }),
    tile({ label: "Blood oxygen", color: "var(--spo2)", value: spo ? Math.round(spo.median) : null, unit: "%",
      sub: spo ? `Lowest ${spo.min}% · ${spo.n} readings` : "Overnight readings", chipEl: spo && spo.min < 90 ? h("span.chip.watch", "Dips below 90") : null,
      spark: sparkline(series(sums, date, (x) => x.night?.spo2?.median), "var(--spo2)"), onClick: () => ctx.nav("metric/spo2") }),
    tile({ label: "Skin temp", color: "var(--temp)", value: tempDev != null ? fmtTempDelta(tempDev) : tmp.value != null ? fmtTemp(tmp.value) : null,
      unit: tempDev != null ? tempUnit().slice(1) : null, sub: tempDev != null ? "vs your usual at night" : tmp.value != null ? "Baseline after 3 nights" : "Overnight average",
      chipEl: tempDev != null ? (tempDev >= 0.5 ? h("span.chip.attention", "Warmer") : tempDev >= 0.3 ? h("span.chip.watch", "A bit warm") : h("span.chip", "Typical")) : null,
      spark: sparkline(series(sums, date, (x) => x.night?.temp?.median), "var(--temp)"), onClick: () => ctx.nav("metric/temp") })));

  // --- Heart rate today ---
  screen.append(section("Heart rate today"));
  screen.append(await hrTodayCard(ctx, s));

  // --- Quick actions ---
  const ecgs = (await db.all(ctx.store, "ecg")).sort((a, b) => (a.t < b.t ? 1 : -1));
  const lastEcg = ecgs[0];
  const bps = (await db.all(ctx.store, "bp")).sort((a, b) => (a.t < b.t ? 1 : -1));
  screen.append(h("div.tiles",
    tile({ label: "Rhythm check", color: "var(--heart)", value: lastEcg?.result?.hrv ? (lastEcg.result.hrv.irregular ? "Irregular" : "Regular") : "ECG",
      sub: lastEcg ? `Last ${relTime(lastEcg.t)}` : "30-second finger ECG", onClick: () => ctx.nav("ecg"),
      spark: h("div", { style: { marginTop: "auto" } }, h("span.chip", icon("ecg"), "Take one")) }),
    tile({ label: "Blood pressure", color: "var(--heart)", value: bps[0] ? `${bps[0].sys}/${bps[0].dia}` : "Log", unit: null,
      sub: bps[0] ? `Cuff · ${relTime(bps[0].t)}` : "From a home cuff", onClick: () => ctx.nav("bp"),
      spark: h("div", { style: { marginTop: "auto" } }, h("span.chip", icon("plus"), "Add reading")) })));

  // This week vs the week before
  const wk = weekCompare(sums, date);
  if (wk.some((r) => r.cur != null)) {
    screen.append(section("This week"));
    screen.append(card(h("div.rows", wk.filter((r) => r.cur != null).map((r) => {
      const d = r.prev != null ? r.cur - r.prev : null;
      const arrow = d == null || Math.abs(d) < r.flat ? "" : d > 0 ? "↑ " : "↓ ";
      return h("div.row", h("div.rl", h("b", r.label), h("span", r.prev != null ? `Last week ${r.fmt(r.prev)}` : "7-day average")),
        h("div.rr", `${arrow}${r.fmt(r.cur)}`));
    })), h("p.fine", { style: { textAlign: "left", padding: "6px 0 0" } }, "Averages of the last 7 days, compared with the 7 days before.")));
  }

  screen.append(h("p.fine", "Everything is computed on this phone from your band's readings. Nothing leaves it."));
  return screen;
}

function weekCompare(sums, date) {
  const avg = (from, to, f) => { const v = sums.filter((x) => x.date > from && x.date <= to).map(f).filter((x) => x != null); return v.length >= 3 ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const d7 = addDaysStr(date, -7), d14 = addDaysStr(date, -14);
  const rows = [
    ["Sleep", (x) => x.night?.sleep?.asleep ?? null, (v) => fmtDur(v), 10],
    ["Resting heart rate", (x) => x.night?.hr?.rhr ?? null, (v) => `${Math.round(v)} bpm`, 1],
    ["Overnight HRV", (x) => x.night?.ppi?.rmssd ?? x.night?.hrv?.median ?? null, (v) => `${Math.round(v)} ms`, 2],
    ["Steps", (x) => x.day?.steps ?? null, (v) => Math.round(v).toLocaleString(), 500],
  ];
  return rows.map(([label, f, fmt, flat]) => ({ label, fmt, flat, cur: avg(d7, date, f), prev: avg(d14, d7, f) }));
}

const fmtDur = (m) => { const r = Math.round(m); return `${Math.floor(r / 60)}h ${String(r % 60).padStart(2, "0")}m`; };

async function banners(ctx, sums, s) {
  const out = [];
  if (!ctx.demo && !navigator.bluetooth) {
    const android = /android/i.test(navigator.userAgent);
    out.push(banner({ title: android ? "Open Pulse in Chrome" : "Open Pulse in Bluefy", kind: "watch", iconName: "bt",
      body: android ? "This browser can't reach your band. Open mjtrotter.github.io/pulse in Google Chrome."
        : "Safari can't reach your band. Open the Bluefy app and go to mjtrotter.github.io/pulse. Your readings live there." }));
  }
  const band = (await db.all(ctx.store, "band"))[0];
  if (!ctx.demo && band?.last_sync && Date.now() - toMs(band.last_sync) > 36 * 3600e3) {
    out.push(banner({ title: "It's been a while since the last sync", body: `Last synced ${relTime(band.last_sync)}. Open Pulse near your band so it can catch up.`, kind: "watch", iconName: "sync" }));
  }
  if (band?.battery != null && band.battery <= 20) {
    out.push(banner({ title: `Band battery ${band.battery}%`, body: "Charge it for about an hour, ideally in the evening before bed.", kind: "watch", iconName: "band" }));
  }
  // Backups: IndexedDB can be cleared with the browser's data, so nudge every two weeks once there's history.
  const lastBackup = await db.getSetting(ctx.store, "last_backup");
  const nights = sums.filter((x) => x.night).length;
  if (!ctx.demo && nights >= 10 && (!lastBackup || Date.now() - Date.parse(lastBackup) > 14 * 864e5)) {
    out.push(banner({ title: "Back up your history", body: "Save a copy to Files or email it to yourself, so a phone reset can't erase it.", kind: "accent", iconName: "download",
      action: h("button.link", { type: "button", onclick: () => ctx.nav("you") }, "Back up now") }));
  }
  const ill = s?.scores?.illness;
  if (ill?.level === "red" || ill?.level === "yellow") {
    out.push(banner({ title: ill.level === "red" ? "Your body may be fighting something" : "Resting heart rate is up", body: ill.text, kind: ill.level === "red" ? "attention" : "watch", iconName: "alert" }));
  }
  return out;
}

async function hrTodayCard(ctx, s) {
  const now = new Date();
  const start = new Date(now.getTime() - 24 * 3600e3);
  const rows = await db.range(ctx.store, "hr", stamp(start), stamp(now));
  // 5-minute means keep the line readable and the SVG light.
  const buckets = new Map();
  for (const r of rows) {
    const k = Math.floor(toMs(r.t) / 300e3) * 300e3;
    const e = buckets.get(k) ?? [0, 0, 999, 0];
    e[0] += r.bpm; e[1]++; e[2] = Math.min(e[2], r.bpm); e[3] = Math.max(e[3], r.bpm);
    buckets.set(k, e);
  }
  const pts = [...buckets].sort((a, b) => a[0] - b[0]).map(([t, e]) => [t + 150e3, e[0] / e[1], e[2], e[3]]);
  const ticks = [];
  const t = new Date(start); t.setMinutes(0, 0, 0);
  while (t < now) { t.setHours(t.getHours() + 1); if (t.getHours() % 6 === 0) ticks.push(t.getTime()); }
  const shades = s?.night?.sleep ? [{ x0: toMs(s.night.sleep.onset), x1: toMs(s.night.sleep.wake), label: "Asleep" }] : [];
  const vals = pts.map((p) => p[1]);
  const lo = vals.length ? Math.round(Math.min(...pts.map((p) => p[2]))) : null, hi = vals.length ? Math.round(Math.max(...pts.map((p) => p[3]))) : null;
  const latest = rows.length ? rows.reduce((a, b) => (a.t > b.t ? a : b)) : null;
  return card(
    cardHead(latest ? `${latest.bpm} bpm` : "No readings yet", latest ? `at ${clock(latest.t)}` : null),
    h("p.cap", { style: { marginTop: "-8px", marginBottom: "8px" } }, lo != null ? `Range ${lo}–${hi} bpm in the last 24 hours` : "Readings appear after the band syncs"),
    lineChart({ series: [{ points: pts.map((p) => [p[0], p[1]]), color: "var(--heart)", label: "Heart rate", area: true }],
      x0: start.getTime(), x1: now.getTime(), shades, ticks, gapMs: 20 * 60e3, height: 170,
      fmtX: (ms) => clock(stamp(new Date(ms))).replace(":00", ""), fmtV: (v) => `${Math.round(v)} bpm`,
      fmtWhen: (ms, p) => `${clock(stamp(new Date(ms)))} · 5-min average`,
      table: { columns: ["Time", "Avg", "Min", "Max"], rows: hourlyRows(pts) } }));
}

function hourlyRows(pts) {
  const by = new Map();
  for (const [t, v, lo, hi] of pts) {
    const k = Math.floor(t / 3600e3) * 3600e3;
    const e = by.get(k) ?? [0, 0, 999, 0];
    e[0] += v; e[1]++; e[2] = Math.min(e[2], lo); e[3] = Math.max(e[3], hi);
    by.set(k, e);
  }
  return [...by].sort((a, b) => b[0] - a[0]).map(([t, e]) => [hhmm(stamp(new Date(t))), Math.round(e[0] / e[1]), e[2], e[3]]);
}

export { fmtDur, tempDelta };
