// Cycle tracking (female profiles): logged periods + nightly wrist temperature and resting HR. Shows the
// cycle day and phase, the retrospective temperature shift (ovulation confirmed after the fact), estimated
// fertile window and next period, cycle history and perimenopause staging. Estimates only; never
// contraception-grade.
import { tempC } from "../core/units.js?v=20260924233355";
import { css, D, dname, esc, MON, S, sc, smooth, st, tUnit } from "./kit.js?v=20260924233355";

const PHASE = { period: ["Period", "--bad"], follicular: ["Follicular", "--breath"], fertile: ["Fertile window (estimate)", "--act"], luteal: ["Luteal", "--sleep"], late: ["Period late", "--watch"], unknown: ["Log a period to start", "--ink3"] };
const dt = (s) => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const short = (s) => { const d = dt(s); return `${MON[d.getMonth()]} ${d.getDate()}`; };
const days = (a, b) => Math.round((dt(b) - dt(a)) / 864e5);

export const cycleOn = () => D.profile?.sex === "female";

/** The Right now tile. */
export function cycleTile() {
  const c = D.cycle;
  if (!c) return "";
  const s = c.status, [label, color] = PHASE[s?.phase ?? "unknown"];
  const sub = s?.cycleDay ? `${label.toLowerCase()}${s.nextPeriod ? ` · period ~${short(s.nextPeriod.date)}` : ""}` : "tap to log your last period";
  return `<div class="card vital tap rise" style="--i:9;--tint:${css(color)}" data-cycle><div class="v-h"><i></i>Cycle</div><div class="v-v">${s?.cycleDay ? `Day ${s.cycleDay}` : "—"}<small></small></div><div class="v-s">${sub}</div><div class="v-sp">${miniRing(s, c.stats)}</div></div>`;
}
/** Trigger-based prompt (only when a start is due or a period has been open a while). */
export function cyclePromptCard() {
  const p = D.cycle?.prompt;
  if (!p?.ask || st.cycleDismiss === D.latest.date) return "";
  return p.ask === "start"
    ? `<div class="card prompt rise" style="--i:2"><p>${esc(p.text || "Did your period start?")}</p><div class="chips"><button class="chip" data-period="start-today">Yes, today</button><button class="chip" data-period="start-yday">Yesterday</button><button class="chip ghost" data-period="dismiss">Not yet</button></div></div>`
    : `<div class="card prompt rise" style="--i:2"><p>${esc(p.text || "Has your period ended?")}</p><div class="chips"><button class="chip" data-period="end-today">Yes, today</button><button class="chip" data-period="end-yday">Yesterday</button><button class="chip ghost" data-period="dismiss">Not yet</button></div></div>`;
}
function miniRing(s, stats) {
  const L = Math.round(stats?.meanLength ?? 28), W0 = 150, H = 26, x = sc(1, L, 4, W0 - 4);
  const seg = (a, b, col, op = 0.8) => `<rect x="${x(a).toFixed(1)}" y="10" width="${Math.max(2, x(b) - x(a)).toFixed(1)}" height="6" rx="3" fill="${css(col)}" opacity="${op}"/>`;
  let body = `<rect x="4" y="10" width="${W0 - 8}" height="6" rx="3" fill="${css("--track")}"/>` + seg(1, 5, "--bad");
  if (s?.fertileWindow && s.cycleDay) { const f0 = s.cycleDay + days(D.latest.date, s.fertileWindow.start), f1 = s.cycleDay + days(D.latest.date, s.fertileWindow.end); body += seg(f0, f1 + 1, "--act", 0.7); }
  if (s?.cycleDay) body += `<circle cx="${x(Math.min(L, s.cycleDay)).toFixed(1)}" cy="13" r="5" fill="${css("--ink")}" stroke="${css("--bg")}" stroke-width="2"/>`;
  return S(W0, H, body);
}

function ring(s, stats) {
  const L = Math.max(21, Math.round(stats?.meanLength ?? 28)), W0 = 240, c = 120, r = 92, a = (d) => -Math.PI / 2 + ((d - 1) / L) * Math.PI * 2;
  const arc = (d0, d1, col, w = 16, op = 0.9) => { const a0 = a(d0), a1 = a(Math.min(L + 1, d1)); const p = (t) => [c + r * Math.cos(t), c + r * Math.sin(t)]; const [x0, y0] = p(a0), [x1, y1] = p(a1); return `<path d="M${x0.toFixed(1)},${y0.toFixed(1)}A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(1)},${y1.toFixed(1)}" fill="none" stroke="${css(col)}" stroke-width="${w}" stroke-linecap="round" opacity="${op}"/>`; };
  let body = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${css("--track")}" stroke-width="16"/>`;
  body += arc(1, 6, "--bad");
  if (s?.fertileWindow && s.cycleDay) { const f0 = s.cycleDay + days(D.latest.date, s.fertileWindow.start), f1 = s.cycleDay + days(D.latest.date, s.fertileWindow.end) + 1; body += arc(Math.max(1, f0), f1, "--act", 16, 0.75); }
  if (s?.ovulation?.date && s.cycleDay) { const od = s.cycleDay + days(D.latest.date, s.ovulation.date); if (od >= 1 && od <= L) { body += arc(od + 1, L + 1, "--sleep", 16, 0.45); const t = a(od); body += `<circle cx="${(c + r * Math.cos(t)).toFixed(1)}" cy="${(c + r * Math.sin(t)).toFixed(1)}" r="7" fill="${s.ovulation.confirmed ? css("--ink") : "none"}" stroke="${css("--ink")}" stroke-width="2"/>`; } }
  if (s?.cycleDay) { const t = a(Math.min(L, s.cycleDay)); body += `<line x1="${(c + (r - 22) * Math.cos(t)).toFixed(1)}" y1="${(c + (r - 22) * Math.sin(t)).toFixed(1)}" x2="${(c + (r + 22) * Math.cos(t)).toFixed(1)}" y2="${(c + (r + 22) * Math.sin(t)).toFixed(1)}" stroke="${css("--ink")}" stroke-width="3" stroke-linecap="round"/>`; }
  const [label, col] = PHASE[s?.phase ?? "unknown"];
  return `<div class="cring">${S(W0, W0, body)}<div class="cr-c"><div class="lbl">Cycle day</div><div class="num big2">${s?.cycleDay ?? "—"}</div><div class="cr-p" style="color:${css(col)}">${label}</div></div></div>`;
}
function tempChart(s) {
  const periods = D.cycle.periods, starts = periods.map((p) => p.start).sort();
  const cur = starts[starts.length - 1], prev = starts[starts.length - 2];
  if (!cur) return "";
  const series = (from, to) => D.hist.filter((h) => h.date >= from && (!to || h.date < to) && h.tempC != null).map((h) => [days(from, h.date) + 1, tempC(h.tempC)]);
  const a = series(cur), b = prev ? series(prev, cur) : [];
  if (a.length + b.length < 3) return `<p class="note">The temperature chart fills in as nights are recorded this cycle.</p>`;
  const W0 = 340, H = 170, all = [...a, ...b].map((p) => p[1]), maxDay = Math.max(28, ...a.map((p) => p[0]), ...b.map((p) => p[0])), x = sc(1, maxDay, 30, W0 - 6), y = sc(Math.min(...all) - 0.2, Math.max(...all) + 0.2, H - 22, 10);
  const shiftDay = s?.tempShift?.detected && s.tempShift.since ? days(cur, s.tempShift.since) + 1 : null;
  const body = (b.length >= 2 ? `<path d="${smooth(b.map((p) => [x(p[0]), y(p[1])]), 0.12)}" fill="none" stroke="${css("--ink3")}" stroke-width="1.5" opacity=".6"/>` : "")
    + (a.length >= 2 ? `<path d="${smooth(a.map((p) => [x(p[0]), y(p[1])]), 0.12)}" fill="none" stroke="${css("--temp")}" stroke-width="2.2"/>` : "") + a.map((p) => `<circle cx="${x(p[0]).toFixed(1)}" cy="${y(p[1]).toFixed(1)}" r="2.6" fill="${css("--temp")}"/>`).join("")
    + (shiftDay ? `<line x1="${x(shiftDay)}" x2="${x(shiftDay)}" y1="8" y2="${H - 22}" stroke="${css("--sleep")}" stroke-dasharray="3 3"/><text x="${x(shiftDay) + 4}" y="18" class="axis">shift</text>` : "")
    + [1, 7, 14, 21, 28].filter((d) => d <= maxDay).map((d) => `<text x="${x(d)}" y="${H - 4}" text-anchor="middle" class="axis">day ${d}</text>`).join("");
  return S(W0, H, body) + `<p class="note"><span class="key" style="--k:${css("--temp")}">this cycle</span>${b.length ? `<span class="key" style="--k:${css("--ink3")}">last cycle</span>` : ""} Nightly wrist temperature (${tUnit()}). After ovulation, progesterone raises it about 0.3 °C for the rest of the cycle; a sustained 3-night rise confirms ovulation after the fact (Shilaih 2018).</p>`;
}

/** Full-screen cycle view (drill-down). */
export function cycleView() {
  const c = D.cycle, s = c.status, stats = c.stats, peri = c.peri;
  const next = s?.nextPeriod, rows = [];
  if (next) rows.push(["Next period", `${short(next.date)}`, `likely ${short(next.low)}–${short(next.high)} (${next.method ?? "your history"})`]);
  else rows.push(["Next period", "—", `Needs ${Math.max(1, 2 - (stats?.n ?? 0))} more logged cycle${2 - (stats?.n ?? 0) > 1 ? "s" : ""} for a personal estimate`]);
  if (s?.fertileWindow) rows.push(["Fertile window", `${short(s.fertileWindow.start)}–${short(s.fertileWindow.end)}`, "estimate from your cycle length; not for contraception"]);
  if (s?.ovulation?.date) rows.push(["Ovulation", short(s.ovulation.date), s.ovulation.confirmed ? "confirmed by the temperature shift (after the fact)" : "estimated from the calendar"]);
  if (s?.lateBy > 0) rows.push(["Late by", `${s.lateBy} day${s.lateBy > 1 ? "s" : ""}`, "past the expected range"]);
  if (s?.rhrLuteal?.delta != null) rows.push(["Resting HR, luteal vs follicular", `${s.rhrLuteal.delta > 0 ? "+" : ""}${s.rhrLuteal.delta.toFixed(1)} bpm`, "typically rises ~2 bpm after ovulation (Shilaih 2017)"]);
  const hist = (c.cyclesList ?? []).slice().reverse().slice(0, 12);
  return `<div class="aurora"><i class="a"></i><i class="b"></i><i class="c"></i></div><div class="inner">
    <div class="m-top"><button class="back" data-close>‹ Live</button><span class="lbl">cycle</span></div>
    ${ring(s, stats)}
    <div class="chips" style="justify-content:center;margin-top:10px"><button class="chip" data-sheet="period">Log a period</button>${c.open ? `<button class="chip" data-period="end-today">Period ended today</button>` : ""}</div>
    <div class="card" style="margin-top:18px"><div class="kv">${rows.map(([a, b, e]) => `<div><span>${a}</span><b>${esc(b)}</b><em>${esc(e)}</em></div>`).join("")}</div></div>
    <div class="sec"><h2>Temperature this cycle</h2></div><div class="card">${tempChart(s)}</div>
    <div class="sec"><h2>Your cycles</h2><span class="lbl">${stats?.n ? `avg ${stats.meanLength.toFixed(0)} days${stats.sdLength != null ? ` ± ${stats.sdLength.toFixed(0)}` : ""}` : ""}</span></div>
    <div class="card">${hist.length ? `<div class="kv">${hist.map((z) => `<div><span>${dname(dt(z.start))}</span><b>${z.length ? `${z.length} days` : "current"}</b><em>${z.periodDays ? `period ${z.periodDays} days` : "period end not logged"}</em></div>`).join("")}</div>` : `<p class="note" style="margin:0">Log your periods here (or answer the prompt when one is due). Estimates get personal after two cycles.</p>`}</div>
    ${peri && peri.stage !== "none" ? `<div class="sec"><h2>Perimenopause</h2><span class="lbl">STRAW+10</span></div><div class="card"><div class="kv"><div><span>Stage</span><b>${esc(peri.stage)}</b></div></div>${peri.reasons?.length ? `<p class="note">${esc(peri.reasons.join(" "))}</p>` : ""}${peri.need?.length ? `<p class="note">${esc(peri.need.join(" "))}</p>` : ""}<p class="note">Staging follows STRAW+10 (Harlow 2012) from your logged cycle lengths. It's descriptive; talk to your clinician about symptoms. Hot flashes can't be detected from this band (that needs a skin-conductance sensor).</p></div>` : ""}
    <div class="sec"><h2>How it works</h2></div><div class="card explain"><p>Pulse combines the periods you log with your nightly wrist temperature. A sustained rise of about 0.3 °C over 3 nights marks the luteal phase and confirms ovulation roughly a day earlier; this catches the shift in about 8 of 10 cycles (Shilaih 2018; Apple Women's Health Study 2025: ovulation within ±2 days in 80% of cycles, next period within ±3 days in 89%). Before a shift is seen, phases are estimated from your average cycle length. During the luteal phase your skin temperature and resting heart rate normally run higher, so Pulse doesn't treat that rise as a sign of illness.</p><p>Estimates only: not a contraceptive method and not a diagnosis.</p></div>
  </div>`;
}
/** Trends (Body) row. */
export function cycleRow() {
  const c = D.cycle;
  if (!c) return null;
  const s = c.status, n = c.stats?.n ?? 0;
  return { ready: true, label: "Cycle", html: `<div class="adv-row" data-cycle><b>Cycle</b><span class="av">${s?.cycleDay ? `Day ${s.cycleDay}` : "—"}</span><p>${s?.cycleDay ? `${PHASE[s.phase]?.[0] ?? ""}. ${n ? `Average ${c.stats.meanLength.toFixed(0)} days over ${n} cycle${n > 1 ? "s" : ""}${c.stats.sdLength != null ? `, varying ± ${c.stats.sdLength.toFixed(0)}` : ""}.` : "Averages appear after your second logged period."}` : "Log your last period to start cycle tracking. Pulse adds your nightly temperature to confirm ovulation after the fact."}</p></div>` };
}
