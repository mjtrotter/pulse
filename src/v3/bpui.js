// Measure → Blood pressure. The band's own estimate, charted continuously and calibrated to your cuff readings, which
// sit on the same chart as anchors (analytics/bpcal.js). Cuff readings alone set the home average, its category and
// heart risk (the AHA advises against cuffless readings for diagnosis); the calibrated line shows what happens between.
import { dip, series, Z80 } from "../analytics/bpcal.js?v=20261014195152";
import { toMs } from "../core/time.js?v=20261014195152";
import { bpCategory, bpSummary } from "./bp.js?v=20261014195152";
import { bpDetail } from "./riskui.js?v=20261014195152";
import { mean } from "./stats.js?v=20261014195152";
import { ampm, css, D, DAYS, hr12, MON, poly, relMin, S, sc, scrubbable, sign, smoothRuns, st, uid } from "./kit.js?v=20261014195152";

/** [days, label, bucket minutes] for each chart window. */
const WINS = [["1", "24H", 30], ["7", "7D", 120], ["30", "30D", 360], ["90", "90D", 1440]];
const r0 = (v) => Math.round(v);
const bpTxt = (s, d) => `${r0(s)}/${r0(d)}`;
const minOf = (ms) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
const dayName = (ms) => { const d = new Date(ms), a = Math.round((new Date(new Date().toDateString()) - new Date(d.toDateString())) / 864e5); return a === 0 ? "Today" : a === 1 ? "Yesterday" : `${DAYS[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}`; };
const when = (ms) => `${dayName(ms)} · ${ampm(minOf(ms))}`;
const signed = (v) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(r0(v))}`;

/** Sleep windows [startMs, endMs] from the nights on file. */
const sleepWindows = () => (D.hist ?? []).filter((h) => h.onsetT && h.wakeT).map((h) => [toMs(h.onsetT), toMs(h.wakeT)]);

/** Awake vs asleep averages of the calibrated line over the last `days` (at least the last night). */
export function bandDip(days = 7, now = Date.now()) {
  const R = D.advData?.bp;
  if (!R?.B?.length) return null;
  const from = now - Math.max(days, 1.5) * 864e5, wins = sleepWindows().filter(([a, b]) => b >= from && a <= now);
  return wins.length ? dip(series(R.B, R.A, from, now, 0), wins, now) : null;
}

/** Home thresholds (ACC/AHA 2017) as shaded zones: [upper bound, tier, label]. */
const SYS_Z = [[120, "good", "normal"], [130, "watch", "elevated"], [135, "watch", "stage 1"], [Infinity, "bad", "stage 2"]];
const DIA_Z = [[80, "good", "normal"], [85, "watch", "stage 1"], [Infinity, "bad", "stage 2"]];

/** Two stacked panels (systolic over diastolic) on one time axis: category zones, every corrected band reading as a
 *  dot, the corrected line through them, and your cuff readings as rings. One crosshair reads both. */
function chart(R, days, bucket, now) {
  const from = now - days * 864e5;
  const pts = R.B.length ? series(R.B, R.A, from, now, bucket) : [];
  const dots = R.B.length && days <= 7 ? series(R.B, R.A, from, now, 0) : pts;
  const cuff = R.A.filter((a) => a.ms >= from && a.ms <= now);
  if (!pts.length && !cuff.length) return `<p class="note">Nothing in this window yet.</p>`;
  const W0 = 340, X0 = 30, X1 = W0 - 46, S0 = 8, S1 = 122, D0 = 140, D1 = 214, H = 246;
  const sv = [...dots.map((p) => p.sys), ...cuff.map((a) => a.sys)], dv = [...dots.map((p) => p.dia), ...cuff.map((a) => a.dia)];
  const sLo = Math.min(105, ...sv) - 4, sHi = Math.max(142, ...sv) + 4, dLo = Math.min(62, ...dv) - 3, dHi = Math.max(90, ...dv) + 3;
  const x = sc(from, now, X0, X1), ys = sc(sLo, sHi, S1, S0), yd = sc(dLo, dHi, D1, D0);
  const cs = (v) => ys(Math.max(sLo, Math.min(sHi, v))), cd = (v) => yd(Math.max(dLo, Math.min(dHi, v)));
  let body = "";
  // Sleep: a thin strip under the panels on the short windows.
  if (days <= 7) for (const [a, b] of sleepWindows()) if (b > from && a < now) { const xa = x(Math.max(a, from)), xb = x(Math.min(b, now)); body += `<rect x="${xa.toFixed(1)}" y="${D1 + 4}" width="${Math.max(2, xb - xa).toFixed(1)}" height="5" rx="2.5" fill="${css("--sleep")}" opacity=".75"/>`; }
  // Category zones, named in the right margin (centred on the zone, when it's tall enough to hold a label).
  const zones = (Z, lo, hi, y) => { let prev = lo, out = ""; for (const [ub, tier, label] of Z) { const top = Math.min(ub, hi); if (top > prev) { const h = y(prev) - y(top); out += `<rect x="${X0}" y="${y(top).toFixed(1)}" width="${X1 - X0}" height="${h.toFixed(1)}" fill="${css(`--${tier}`)}" opacity="${tier === "good" ? 0.06 : 0.11}"/>`; if (h >= 12) out += `<text x="${X1 + 4}" y="${(y(top) + h / 2 + 3.5).toFixed(1)}" class="axis zl" fill="${css(`--${tier}`)}">${label}</text>`; } prev = Math.max(prev, ub); if (prev >= hi) break; } return out; };
  body += zones(SYS_Z, sLo, sHi, ys) + zones(DIA_Z, dLo, dHi, yd);
  const grid = (vals, y, lo, hi) => vals.filter((v) => v > lo && v < hi).map((v) => `<line x1="${X0}" x2="${X1}" y1="${y(v)}" y2="${y(v)}" stroke="${css("--grid")}"/><text x="${X0 - 4}" y="${y(v) + 4}" text-anchor="end" class="axis">${v}</text>`).join("");
  body += grid([100, 110, 120, 130, 140, 150, 160, 170], ys, sLo, sHi) + grid([60, 70, 80, 90, 100], yd, dLo, dHi);
  body += `<text x="${X0 + 3}" y="${S0 + 10}" class="axis pl">SYSTOLIC</text><text x="${X0 + 3}" y="${D0 + 10}" class="axis pl">DIASTOLIC</text>`;
  // Lines break where the band had no good reading for a while (not worn, or every attempt failed).
  const gap = Math.max(75, 2.5 * bucket) * 60e3, runs = [];
  pts.forEach((p, i) => { if (!i || p.ms - pts[i - 1].ms > gap) runs.push([]); runs[runs.length - 1].push(p); });
  const line = (f) => smoothRuns(runs.flatMap((r, i) => [...(i ? [null] : []), ...r.map((p) => [x(p.ms), f(p)])]), 0.14);
  const col = css("--heart"), dotR = dots.length > 400 ? 1.2 : 1.7;
  body += dots.map((p) => `<circle cx="${x(p.ms).toFixed(1)}" cy="${cs(p.sys).toFixed(1)}" r="${dotR}" fill="${col}" opacity=".4"/><circle cx="${x(p.ms).toFixed(1)}" cy="${cd(p.dia).toFixed(1)}" r="${dotR}" fill="${col}" opacity=".4"/>`).join("");
  body += `<path d="${line((p) => cs(p.sys))}" fill="none" stroke="${col}" stroke-width="2.4" stroke-linecap="round"/><path d="${line((p) => cd(p.dia))}" fill="none" stroke="${col}" stroke-width="2.4" stroke-linecap="round"/>`;
  const L = R.latest;
  if (L && L.ms >= from) body += `<circle cx="${x(L.ms).toFixed(1)}" cy="${cs(L.sys).toFixed(1)}" r="4.5" fill="${col}" stroke="${css("--bg")}" stroke-width="2"/><circle cx="${x(L.ms).toFixed(1)}" cy="${cd(L.dia).toFixed(1)}" r="4.5" fill="${col}" stroke="${css("--bg")}" stroke-width="2"/>`;
  // Cuff readings: solid rings when matched to the band, dashed when the band had nothing near.
  for (const a of cuff) {
    const ax = x(a.ms).toFixed(1), ring = (cy) => `<circle cx="${ax}" cy="${cy.toFixed(1)}" r="5" fill="${css("--bg")}" stroke="${css("--ink")}" stroke-width="2.2" ${a.band ? "" : `stroke-dasharray="2 2"`}/>`;
    body += ring(cs(a.sys)) + ring(cd(a.dia));
  }
  // Time axis.
  const ticks = [];
  if (days <= 1) { const d = new Date(from); d.setMinutes(0, 0, 0); d.setHours(Math.ceil(d.getHours() / 6) * 6); for (let t = d.getTime(); t < now; t += 6 * 36e5) ticks.push([t, hr12(new Date(t).getHours())]); }
  else if (days <= 7) { const d = new Date(from); d.setHours(12, 0, 0, 0); for (let t = d.getTime(); t < now; t += 864e5) if (t > from) ticks.push([t, DAYS[new Date(t).getDay()]]); }
  else for (const t of [from, (from + now) / 2, now]) { const d = new Date(t); ticks.push([t, t === now ? "today" : `${MON[d.getMonth()]} ${d.getDate()}`]); }
  body += ticks.map(([t, l], i) => `<text x="${x(t).toFixed(1)}" y="${H - 4}" text-anchor="${days > 7 ? ["start", "middle", "end"][i] : "middle"}" class="axis">${l}</text>`).join("");
  const per = bucket >= 1440 ? "day" : bucket >= 60 ? `${bucket / 60}-hour` : `${bucket}-min`;
  const scrub = [
    ...pts.map((p) => [x(p.ms), cs(p.sys), `${when(p.ms)} · <b>${bpTxt(p.sys, p.dia)}</b> mmHg ±${r0(Z80 * p.sysSd)} · ${p.n > 1 ? `${per} average of ${p.n} band readings` : "band reading"}`]),
    ...cuff.map((a) => [x(a.ms), cs(a.sys), `${when(a.ms)} · cuff <b>${bpTxt(a.sys, a.dia)}</b>${a.pulse ? ` · pulse ${r0(a.pulse)}` : ""} · ${a.band ? `band at that moment ≈ ${bpTxt(a.band.sys, a.band.dia)} before correction` : "no good band reading near it"}`]),
  ].sort((p, q) => p[0] - q[0]);
  const idle = `<span class="lgd"><i class="l"></i>Band, corrected to your cuff</span><span class="lgd"><i class="dt"></i>each band reading</span><span class="lgd"><i class="c"></i>your cuff</span>${days <= 7 ? `<span class="lgd"><i class="sl"></i>asleep</span>` : ""}`;
  return scrubbable(uid("s"), W0, H, body, scrub, idle);
}

/** The band's last few hours of BP attempts: filled = a good reading, hollow = failed (usually movement), dashed = next. */
function paceStrip(pc, now) {
  if (!pc) return "";
  const W0 = 340, H = 30, from = now - 3 * 36e5, to = pc.next + 4 * 60e3, x = sc(from, to, 8, W0 - 8);
  let body = `<line x1="8" x2="${W0 - 8}" y1="13" y2="13" stroke="${css("--grid")}"/>`;
  for (const a of pc.recent) body += `<circle cx="${x(a.ms).toFixed(1)}" cy="13" r="4" fill="${a.ok ? css("--heart") : css("--bg")}" stroke="${a.ok ? css("--bg") : css("--ink3")}" stroke-width="${a.ok ? 1.5 : 1.3}"/>`;
  body += `<circle cx="${x(pc.next).toFixed(1)}" cy="13" r="4.5" fill="none" stroke="${css("--ink")}" stroke-width="1.5" stroke-dasharray="2 2"/>`;
  body += `<text x="8" y="${H - 1}" class="axis">${ampm(minOf(from))}</text><text x="${x(now).toFixed(1)}" y="${H - 1}" text-anchor="middle" class="axis">now</text>`;
  const good = pc.recent.filter((a) => a.ok).length, nextAt = new Date(pc.next).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const msg = pc.recent.length
    ? `The band tries every ${pc.interval} minutes; <b>${good} of the last ${pc.recent.length}</b> worked (an arm that's moving makes it fail). Next at <b>${nextAt}</b>.`
    : `No band readings fetched in the last 3 hours. ${D.connected ? "Pulse is fetching them now." : "Connect the band to fetch them."} It tries every ${pc.interval} minutes; next at about <b>${nextAt}</b>.`;
  return `<div class="pace">${S(W0, H, body)}<p class="note">${msg}</p></div>`;
}

function bandCard(R) {
  const now = Date.now(), win = WINS.find((w) => w[0] === st.bpAgg) ?? WINS[1], days = +win[0], nCal = R.cal.n, L = R.latest;
  const cuffSum = bpSummary(D.bp ?? []), cat = cuffSum ? bpCategory(cuffSum.sys, cuffSum.dia) : null;
  const first = (D.bp ?? [])[0], vsFirst = cuffSum && first && toMs(first.t) < now - 21 * 864e5 ? cuffSum.sys - mean(D.bp.filter((r) => toMs(r.t) < toMs(first.t) + 7 * 864e5).map((r) => r.sys)) : null;
  const ago = L ? (now - L.ms) / 60e3 : null, connected = !!D.connected;
  const head = L
    ? `<div class="lbl">Band · latest reading <button class="xi" data-explain="bpest" aria-label="How the band's estimate is corrected">i</button></div>
      <div class="num big2">${r0(L.sys)}<span class="slash">/</span>${r0(L.dia)}<small>mmHg</small></div>
      <div class="bp-sub">${ampm(minOf(L.ms))}${ago < 1440 ? ` · ${relMin(ago)}` : ` · ${dayName(L.ms)}`} · ${nCal ? `±${r0(Z80 * L.sysSd)} · corrected with ${nCal} cuff reading${nCal > 1 ? "s" : ""}` : "as the band measured it (no cuff readings yet)"}</div>
      ${ago > 25 ? `<div class="bp-sub">${connected ? "Pulse fetches each new band reading while it's open." : "Connect the band to fetch its newer readings."}</div>` : ""}`
    : `<div class="lbl">Band</div><div class="num big2">—</div><div class="bp-sub">No band reading yet</div>`;
  const cuffRow = `<div class="bp-cuff" data-explain="bp"><span><span class="lbl">Cuff · 7-day average</span>${vsFirst != null ? `<span class="bp-sub">${sign(vsFirst, 0)} systolic vs your first week</span>` : (D.bp ?? []).length && !cuffSum ? `<span class="bp-sub">appears after 2 readings</span>` : ""}</span>
      <b class="num">${cuffSum ? bpTxt(cuffSum.sys, cuffSum.dia) : "—"}</b>${cat ? `<span class="badge ${cat[1]}">${cat[0].replace(" range", "")}</span>` : ""}</div>`;
  const dd = bandDip(Math.min(days, 14), now);
  const stats = dd && !dd.need
    ? `<div class="stat3"><div><b>${bpTxt(dd.daySys, dd.dayDia)}</b><span>awake average${days > 1 ? `, ${Math.min(days, 14)} days` : ""}</span></div><div><b>${bpTxt(dd.nightSys, dd.nightDia)}</b><span>asleep average</span></div><div data-explain="bpdip" class="tap"><b>${r0(dd.sys)}%</b><span>night-time dip (10–20% is typical) ›</span></div></div>`
    : R.B.length ? `<p class="note">Awake and asleep averages appear after a night with the band on.</p>` : "";
  const noBand = !R.B.length ? `<p class="note">The band hasn't sent a blood-pressure reading yet. It takes one with every HRV measurement while it's worn, and they arrive when Pulse syncs.</p>` : "";
  return `<div class="card rise" style="--i:6"><div class="bp-band">${head}</div>${paceStrip(R.pace, now)}${cuffRow}
      <div class="agg">${WINS.map(([k, l]) => `<button data-bpagg="${k}" class="${st.bpAgg === k ? "on" : ""}">${l}</button>`).join("")}</div>
      ${noBand}${chart(R, days, win[2], now)}${stats}
      <button class="cta ghost" data-sheet="bp" style="margin-top:12px">Log a cuff reading</button></div>`;
}

/** Bland–Altman limits for the band as measured and after calibration (systolic), once there are 3 pairs. */
function agreeLine(v) {
  const a = v.agree?.raw, c = v.agree?.cal, rng = (z) => `${signed(z.lo)} to ${signed(z.hi)}`;
  if (!a) return "";
  return `<p class="note">95% limits of agreement with your cuff (systolic): before correction <b>${rng(a)}</b> mmHg${c ? `; corrected <b>${rng(c)}</b>` : ""}. A narrower span means a single reading can be trusted more, not just the average (Bland & Altman 1986).</p>`;
}

/** The leave-one-out check of whether heart rate, skin temperature, activity and time of day add anything. */
function contextBlock(C) {
  if (!C) return "";
  if (C.need > 0) return `<p class="note">With 14 cuff readings Pulse also tests whether your heart rate, skin temperature, recent steps and time of day add anything beyond the band's own estimate (${C.n} of 14 so far).</p>`;
  const M = Object.fromEntries((C.models ?? []).map((z) => [z.name, z]));
  if (!M.ridge || !M.bandCalibrated) return "";
  const gain = M.bandCalibrated.maeSys - M.ridge.maeSys, f = (z) => (z?.maeSys != null ? z.maeSys.toFixed(1) : "—");
  return `<div class="sub-h">Could other signals help?</div>
    <div class="kv">${[["Your average cuff reading", f(M.mean)], ["Your previous cuff reading", f(M.lastCuff)], ["Band, straight-line fit", f(M.bandCalibrated)], ["Band + heart rate, skin temp, steps, time of day", f(M.ridge)]].map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join("")}</div>
    <p class="note">Average systolic miss in mmHg over ${C.n} cuff readings, each left out in turn and predicted from the rest (ridge regression for the last row). ${gain >= 2 ? `For you these signals cut the miss by ${gain.toFixed(1)} mmHg, so they carry real information about your blood pressure.` : "For you they don't yet improve on the band's own estimate by the 2 mmHg it takes to count, so the line above uses the band alone."}</p>`;
}

/** Your cuff's 7-day average over the last 90 days (sittings averaged first, at least 2 in the window). */
function cuffTrend() {
  const now = Date.now(), from = now - 90 * 864e5;
  const A = (D.advData?.bp?.A ?? []).filter((a) => a.ms >= from - 7 * 864e5);
  if (A.length < 3) return "";
  const pts = [];
  for (let t = Math.max(from, A[0].ms + 864e5); t <= now; t += 864e5) {
    const w = A.filter((a) => a.ms > t - 7 * 864e5 && a.ms <= t);
    if (w.length >= 2) pts.push({ t, sys: mean(w.map((a) => a.sys)), dia: mean(w.map((a) => a.dia)), n: w.length });
  }
  if (pts.length < 2) return "";
  const W0 = 340, H = 120, X0 = 30, x = sc(pts[0].t, now, X0, W0 - 6), lo = Math.min(70, ...pts.map((p) => p.dia)) - 4, hi = Math.max(140, ...pts.map((p) => p.sys)) + 4, y = sc(lo, hi, H - 18, 6);
  let body = [80, 130].map((v) => `<line x1="${X0}" x2="${W0 - 6}" y1="${y(v)}" y2="${y(v)}" stroke="${css("--watch")}" stroke-opacity=".55" stroke-dasharray="3 3"/><text x="${X0 - 4}" y="${y(v) + 4}" text-anchor="end" class="axis">${v}</text>`).join("");
  body += `<path d="${smoothRuns(pts.map((p) => [x(p.t), y(p.sys)]), 0.14)}" fill="none" stroke="${css("--ink")}" stroke-width="2"/><path d="${smoothRuns(pts.map((p) => [x(p.t), y(p.dia)]), 0.14)}" fill="none" stroke="${css("--ink")}" stroke-width="1.7" opacity=".55"/>`;
  body += [pts[0].t, now].map((t, i) => { const d = new Date(t); return `<text x="${x(t)}" y="${H - 3}" text-anchor="${i ? "end" : "start"}" class="axis">${i ? "today" : `${MON[d.getMonth()]} ${d.getDate()}`}</text>`; }).join("");
  return `<div class="sub-h">Cuff 7-day average over time</div>${scrubbable(uid("s"), W0, H, body, pts.map((p) => [x(p.t), y(p.sys), `${dayName(p.t)} · 7-day average <b>${bpTxt(p.sys, p.dia)}</b> from ${p.n} sittings`]), "Each point averages your cuff sittings in the 7 days before it. Dashed: the 130/80 home stage-1 line.")}`;
}

/** How a cuff reading was matched to the band (or why it couldn't be). */
function pairText(r, now) {
  const b = r.pair;
  if (!b) return now - r.ms < 90 * 60e3 ? "waiting for the band's next good reading to match it" : "no good band reading within 90 minutes (not worn, or every attempt failed), so it can't anchor";
  const m = (v) => `${r0(v)} min`;
  const where = b.how === "at" ? "taken at the same moment" : b.how === "between" ? `between its readings ${m(b.before)} before and ${m(b.after)} after` : b.how === "before" ? `from its reading ${m(b.before)} before${now - r.ms < 90 * 60e3 ? " (the next one will refine it)" : ""}` : `from its reading ${m(b.after)} after`;
  return `band at that moment ≈ ${bpTxt(b.sys, b.dia)}, ${where}${r.w < 0.9 ? ` · counts ${r.w < 0.35 ? "a little" : "about half"}` : ""}`;
}

function calCard(R) {
  const v = R.check, n = R.cal.n, cuffN = R.A.length, paired = R.A.filter((a) => a.band).length, now = Date.now();
  const head = `<div class="lbl" style="margin-bottom:8px">How your cuff corrects the band <button class="xi" data-explain="bpest" aria-label="How the correction works">i</button></div>`;
  if (!cuffN) return `<div class="card rise" style="--i:7">${head}<p class="note" style="margin:0">Take a cuff reading while wearing the band. Pulse works out what the band read at that exact moment and learns how far off it runs for you. One reading moves the line part of the way; 5–10 at different times of day pin it down.</p></div>`;
  if (!R.B.length) return `<div class="card rise" style="--i:7">${head}<p class="note" style="margin:0">Your cuff readings are saved. They'll correct the band once it sends its own blood-pressure readings, which it takes with every HRV measurement while worn and hands over when Pulse syncs.</p></div>`;
  const s = R.cal.sys, d = R.cal.dia;
  const off = (o, what) => `${Math.abs(o) < 1 ? `close to right on ${what}` : `<b>${r0(Math.abs(o))} ${o > 0 ? "low" : "high"}</b> on ${what}`}`;
  const slopeKnown = Math.sqrt(s.cov[1][1]) < 0.15 && Math.abs(s.slope - 1) >= 0.1;
  let acc = "";
  if (v.n) {
    const X = sc(0, Math.max(v.sys.raw, v.sys.cal, v.sys.last) * 1.12 || 1, 0, 170);
    const bar = (label, val, col) => `<div><span>${label}</span>${S(170, 12, `<rect x="0" y="2" width="${Math.max(2, X(val)).toFixed(1)}" height="8" rx="4" fill="${css(col)}" opacity=".85"/>`)}<b>${val.toFixed(1)}</b></div>`;
    acc = `<div class="cmp">${bar("Band before correction", v.sys.raw, "--bad")}${bar("Band, corrected", v.sys.cal, "--good")}${bar("Reusing your last cuff check", v.sys.last, "--ink3")}</div>
      <p class="note">Average miss in systolic mmHg over ${v.n} cuff reading${v.n > 1 ? "s" : ""}, each predicted only from earlier sittings. Diastolic: ${v.dia.raw.toFixed(1)} before correction, ${v.dia.cal.toFixed(1)} corrected, ${v.dia.last.toFixed(1)} reusing your last check.${v.sys.cal >= v.sys.last ? " The corrected band isn't yet closer than reusing your last cuff check; readings at different times of day help it learn your swings." : ""}</p>
      ${agreeLine(v)}`;
  } else acc = n ? `<p class="note">Accuracy appears once a cuff reading from a later sitting can be predicted from earlier ones.</p>` : "";
  const rows = [...v.rows].reverse(), open = st.open.has("bp-anchors"), shown = open ? rows : rows.slice(0, 5);
  const anc = shown.map((r) => {
    const miss = r.cal ? [r.cal.sys - r.cuff.sys, r.cal.dia - r.cuff.dia] : null, worst = miss ? Math.max(Math.abs(miss[0]), Math.abs(miss[1])) : null;
    return `<div><span>${when(r.ms)}</span><b>${bpTxt(r.cuff.sys, r.cuff.dia)}</b><em>${pairText(r, now)}${r.cal ? `; predicted from earlier sittings ${bpTxt(r.cal.sys, r.cal.dia)} <span class="${worst <= 5 ? "ok" : worst <= 10 ? "lo" : "hi"}">(off by ${signed(miss[0])}/${signed(miss[1])})</span>` : ""}</em></div>`;
  }).join("");
  return `<div class="card rise" style="--i:7">${head}
      ${n ? `<p class="cal-sum">For you the band reads ${off(s.offset, "systolic")} and ${off(d.offset, "diastolic")}; Pulse adds that back.${slopeKnown ? ` Your cuff moves about ${s.slope.toFixed(1)}× as much as the band does, so its swings are ${s.slope > 1 ? "stretched" : "shrunk"} to match.` : ""}</p>` : `<p class="cal-sum">None of your cuff readings has a good band reading near it yet.</p>`}
      ${acc}
      ${contextBlock(R.context)}
      <div class="sub-h">Your cuff readings<span>${paired} of ${cuffN} matched${cuffN > 30 ? "; the 30 most recent correct the band" : ""}</span></div>
      <div class="kv anc">${anc}</div>
      ${rows.length > 5 ? `<button class="more" data-expand="bp-anchors">${open ? "Show fewer" : `Show all ${rows.length}`}</button>` : ""}
      <p class="note">Every cuff reading counts, compared with what the band read at that exact moment: Pulse draws a straight line between the band's good readings either side (up to 90 minutes away). One with a band reading close by counts fully; one with the nearest band reading half an hour away counts half. The newest 30 readings set the correction now. Readings at different times of day (morning, evening, after a walk) teach Pulse how much of the band's swing is real. Your cuff alone sets the home average, the category and your heart risk; the AHA advises against cuffless readings for diagnosis.</p></div>`;
}

/** The whole Blood pressure section of Measure. */
export function bpBlock() {
  const R = D.advData?.bp ?? { B: [], A: [], cal: { n: 0 }, check: { rows: [], n: 0 }, latest: null };
  if (!R.B.length && !(D.bp ?? []).length) return `<div class="card rise" style="--i:6"><p class="note" style="margin:0 0 12px">No readings yet. The band records a blood-pressure estimate every 10 minutes while worn; log a few home cuff readings to anchor it to you. A week of morning and evening cuff readings also gives a reliable home average (AHA) for your heart-risk estimate.</p><button class="cta" data-sheet="bp">Log a cuff reading</button></div>`;
  return bandCard(R) + calCard(R) + bpDetail(D.profile ?? {}, cuffTrend());
}
