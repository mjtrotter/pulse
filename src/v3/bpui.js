// Measure → Blood pressure. The band's own estimate, charted continuously and calibrated to your cuff readings, which
// sit on the same chart as anchors (analytics/bpcal.js). Cuff readings alone set the home average, its category and
// heart risk (the AHA advises against cuffless readings for diagnosis); the calibrated line shows what happens between.
import { dip, series, Z80 } from "../analytics/bpcal.js?v=20261014181550";
import { toMs } from "../core/time.js?v=20261014181550";
import { bpCategory, bpSummary } from "./bp.js?v=20261014181550";
import { bpDetail } from "./riskui.js?v=20261014181550";
import { mean } from "./stats.js?v=20261014181550";
import { ampm, css, D, DAYS, hr12, MON, poly, relMin, S, sc, scrubbable, sign, smoothRuns, st, uid } from "./kit.js?v=20261014181550";

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

function chart(R, days, bucket, now) {
  const from = now - days * 864e5, nCal = R.cal.n;
  const pts = R.B.length ? series(R.B, R.A, from, now, bucket) : [];
  const cuff = R.A.filter((a) => a.ms >= from && a.ms <= now);
  if (!pts.length && !cuff.length) return `<p class="note">Nothing in this window yet.</p>`;
  const W0 = 340, H = 200, X0 = 30, X1 = W0 - 6;
  const lo = Math.min(60, ...pts.map((p) => p.dia), ...cuff.map((a) => a.dia)) - 4, hi = Math.max(140, ...pts.map((p) => p.sys), ...cuff.map((a) => a.sys)) + 6;
  const x = sc(from, now, X0, X1), y = sc(lo, hi, H - 20, 6), cy = (v) => y(Math.max(lo, Math.min(hi, v)));
  // Lines break where the band wasn't worn (a gap of more than ~2.5 buckets).
  const gap = Math.max(45, 2.5 * bucket) * 60e3, runs = [];
  pts.forEach((p, i) => { if (!i || p.ms - pts[i - 1].ms > gap) runs.push([]); runs[runs.length - 1].push(p); });
  const line = (f) => smoothRuns(runs.flatMap((r, i) => [...(i ? [null] : []), ...r.map((p) => [x(p.ms), cy(f(p))])]), 0.14);
  const area = (fLo, fHi) => runs.filter((r) => r.length > 1).map((r) => `${poly(r.map((p) => [x(p.ms), cy(fHi(p))]))}L${r.slice().reverse().map((p) => `${x(p.ms).toFixed(1)},${cy(fLo(p)).toFixed(1)}`).join("L")}Z`).join("");
  let body = "";
  // Sleep, shaded on the short windows.
  if (days <= 7) for (const [a, b] of sleepWindows()) if (b > from && a < now) body += `<rect x="${x(Math.max(a, from)).toFixed(1)}" y="4" width="${(x(Math.min(b, now)) - x(Math.max(a, from))).toFixed(1)}" height="${H - 24}" fill="${css("--sleep")}" opacity=".09" rx="3"/>`;
  for (let v = 60; v <= 180; v += 20) if (v > lo && v < hi && v !== 80) body += `<line x1="${X0}" x2="${X1}" y1="${y(v)}" y2="${y(v)}" stroke="${css("--grid")}"/><text x="${X0 - 4}" y="${y(v) + 4}" text-anchor="end" class="axis">${v}</text>`;
  for (const v of [80, 130]) body += `<line x1="${X0}" x2="${X1}" y1="${y(v)}" y2="${y(v)}" stroke="${css("--watch")}" stroke-opacity=".55" stroke-dasharray="3 3"/><text x="${X0 - 4}" y="${y(v) + 4}" text-anchor="end" class="axis">${v}</text>`;
  if (pts.length) {
    if (nCal) body += `<path d="${area((p) => p.sys - Z80 * p.sysSd, (p) => p.sys + Z80 * p.sysSd)}" fill="${css("--heart")}" opacity=".13"/><path d="${area((p) => p.dia - Z80 * p.diaSd, (p) => p.dia + Z80 * p.diaSd)}" fill="${css("--heart")}" opacity=".08"/>`
      + `<path d="${line((p) => p.raw.sys)}" fill="none" stroke="${css("--ink3")}" stroke-width="1.2" stroke-dasharray="2 3"/><path d="${line((p) => p.raw.dia)}" fill="none" stroke="${css("--ink3")}" stroke-width="1.2" stroke-dasharray="2 3"/>`;
    body += `<path d="${line((p) => p.sys)}" fill="none" stroke="${css("--heart")}" stroke-width="2.2" stroke-linecap="round"/><path d="${line((p) => p.dia)}" fill="none" stroke="${css("--heart")}" stroke-width="1.8" stroke-linecap="round" opacity=".6"/>`;
  }
  // Cuff anchors: solid when the band had a reading to pair with, hollow when it didn't.
  for (const a of cuff) {
    const ax = x(a.ms).toFixed(1), fill = a.band ? css("--ink") : css("--bg");
    body += `<line x1="${ax}" x2="${ax}" y1="${cy(a.sys)}" y2="${cy(a.dia)}" stroke="${css("--ink")}" stroke-width="2.4" stroke-linecap="round"/>`
      + [a.sys, a.dia].map((v) => `<circle cx="${ax}" cy="${cy(v).toFixed(1)}" r="4.2" fill="${fill}" stroke="${a.band ? css("--bg") : css("--ink")}" stroke-width="${a.band ? 2 : 1.6}"/>`).join("");
  }
  // Time axis.
  const ticks = [];
  if (days <= 1) { const d = new Date(from); d.setMinutes(0, 0, 0); d.setHours(Math.ceil(d.getHours() / 6) * 6); for (let t = d.getTime(); t < now; t += 6 * 36e5) ticks.push([t, hr12(new Date(t).getHours())]); }
  else if (days <= 7) { const d = new Date(from); d.setHours(12, 0, 0, 0); for (let t = d.getTime(); t < now; t += 864e5) if (t > from) ticks.push([t, DAYS[new Date(t).getDay()]]); }
  else for (const t of [from, (from + now) / 2, now]) { const d = new Date(t); ticks.push([t, t === now ? "today" : `${MON[d.getMonth()]} ${d.getDate()}`]); }
  body += ticks.map(([t, l], i) => `<text x="${x(t).toFixed(1)}" y="${H - 4}" text-anchor="${days > 7 ? ["start", "middle", "end"][i] : "middle"}" class="axis">${l}</text>`).join("");
  const per = bucket >= 1440 ? "day" : bucket >= 60 ? `${bucket / 60} h` : `${bucket} min`;
  const scrub = [
    ...pts.map((p) => [x(p.ms), cy(p.sys), `${when(p.ms)} · ${per} average · band <b>${bpTxt(p.sys, p.dia)}</b>${nCal ? ` <span class="muted">(as measured ${bpTxt(p.raw.sys, p.raw.dia)}; 80% range ${r0(p.sys - Z80 * p.sysSd)}–${r0(p.sys + Z80 * p.sysSd)})</span>` : ""}`]),
    ...cuff.map((a) => [x(a.ms), cy(a.sys), `${when(a.ms)} · cuff <b>${bpTxt(a.sys, a.dia)}</b>${a.n > 1 ? ` (${a.n} readings)` : ""}${a.pulse ? ` · pulse ${r0(a.pulse)}` : ""} · ${a.band ? `band as measured ${bpTxt(a.band.sys, a.band.dia)}` : "no band reading within 30 min"}`]),
  ].sort((a, b) => a[0] - b[0]);
  const idle = nCal ? `<span class="lgd"><i class="l"></i>Band, calibrated to your cuff (shaded: 80% range)</span><span class="lgd"><i class="d"></i>As the band measured it</span><span class="lgd"><i class="c"></i>Cuff reading</span>`
    : `<span class="lgd"><i class="l"></i>Band, as measured (not calibrated yet)</span><span class="lgd"><i class="c"></i>Cuff reading</span>`;
  return scrubbable(uid("s"), W0, H, body, scrub, idle);
}

function bandCard(R) {
  const now = Date.now(), win = WINS.find((w) => w[0] === st.bpAgg) ?? WINS[1], days = +win[0], nCal = R.cal.n, L = R.latest;
  const cuffSum = bpSummary(D.bp ?? []), cat = cuffSum ? bpCategory(cuffSum.sys, cuffSum.dia) : null;
  const first = (D.bp ?? [])[0], vsFirst = cuffSum && first && toMs(first.t) < now - 21 * 864e5 ? cuffSum.sys - mean(D.bp.filter((r) => toMs(r.t) < toMs(first.t) + 7 * 864e5).map((r) => r.sys)) : null;
  const ago = L ? (now - L.ms) / 60e3 : null;
  const head = L
    ? `<div class="lbl">Band${ago < 180 ? ` · ${relMin(ago)}` : ` · ${when(L.ms)}`} <button class="xi" data-explain="bpest" aria-label="How the band's estimate is calibrated">i</button></div>
      <div class="num big2">${r0(L.sys)}<span class="slash">/</span>${r0(L.dia)}<small>mmHg</small></div>
      <div class="bp-sub">${nCal ? `±${r0(Z80 * L.sysSd)} · calibrated to ${nCal} cuff reading${nCal > 1 ? "s" : ""}` : "as the band measured it · not calibrated yet"}</div>`
    : `<div class="lbl">Band</div><div class="num big2">—</div><div class="bp-sub">No band reading yet</div>`;
  const cuffRow = `<div class="bp-cuff" data-explain="bp"><span><span class="lbl">Cuff · 7-day average</span>${vsFirst != null ? `<span class="bp-sub">${sign(vsFirst, 0)} systolic vs your first week</span>` : (D.bp ?? []).length && !cuffSum ? `<span class="bp-sub">appears after 2 readings</span>` : ""}</span>
      <b class="num">${cuffSum ? bpTxt(cuffSum.sys, cuffSum.dia) : "—"}</b>${cat ? `<span class="badge ${cat[1]}">${cat[0].replace(" range", "")}</span>` : ""}</div>`;
  const dd = bandDip(Math.min(days, 14), now);
  const stats = dd && !dd.need
    ? `<div class="stat3"><div><b>${bpTxt(dd.daySys, dd.dayDia)}</b><span>band awake${days > 1 ? `, last ${Math.min(days, 14)} days` : ""}</span></div><div><b>${bpTxt(dd.nightSys, dd.nightDia)}</b><span>band asleep</span></div><div data-explain="bpdip" class="tap"><b>${r0(dd.sys)}%</b><span>night-time dip (10–20% is typical) ›</span></div></div>`
    : R.B.length ? `<p class="note">Awake vs asleep averages appear after a night with the band on.</p>` : "";
  const noBand = !R.B.length ? `<p class="note">The band hasn't sent a blood-pressure estimate yet. It records one with every HRV measurement (every 10 minutes on Pulse's schedule) while it's worn, and they arrive when it syncs.</p>` : "";
  return `<div class="card rise" style="--i:6"><div class="bp-band">${head}</div>${cuffRow}
      <div class="agg">${WINS.map(([k, l]) => `<button data-bpagg="${k}" class="${st.bpAgg === k ? "on" : ""}">${l}</button>`).join("")}</div>
      ${noBand}${chart(R, days, win[2], now)}${stats}
      <button class="cta ghost" data-sheet="bp" style="margin-top:12px">Log a cuff reading</button></div>`;
}

/** Bland–Altman limits for the band as measured and after calibration (systolic), once there are 3 pairs. */
function agreeLine(v) {
  const a = v.agree?.raw, c = v.agree?.cal, rng = (z) => `${signed(z.lo)} to ${signed(z.hi)}`;
  if (!a) return "";
  return `<p class="note">95% limits of agreement with your cuff (systolic): as measured <b>${rng(a)}</b> mmHg${c ? `; calibrated <b>${rng(c)}</b>` : ""}. A narrower span means individual readings can be trusted more, not just the average (Bland & Altman 1986).</p>`;
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

function calCard(R) {
  const v = R.check, n = R.cal.n, cuffN = (D.bp ?? []).length;
  const head = `<div class="lbl" style="margin-bottom:8px">How your cuff anchors the band <button class="xi" data-explain="bpest" aria-label="How the calibration works">i</button></div>`;
  if (!cuffN) return `<div class="card rise" style="--i:7">${head}<p class="note" style="margin:0">Take a cuff reading while wearing the band. Pulse pairs it with the band's readings from the same half hour and learns how far off the band runs for you. One reading moves the line part of the way; 5–10 at different times of day pin it down.</p></div>`;
  if (!n && !R.B.length) return `<div class="card rise" style="--i:7">${head}<p class="note" style="margin:0">Your cuff readings are saved. They'll anchor the band once it sends its own blood-pressure estimates, which it records with every HRV measurement while worn and hands over at each sync.</p></div>`;
  if (!n) return `<div class="card rise" style="--i:7">${head}<p class="note" style="margin:0">None of your ${cuffN} cuff reading${cuffN > 1 ? "s" : ""} had a band reading within 30 minutes, so none can anchor it yet. Wear the band during your next cuff reading; it measures every 10 minutes and the reading arrives at the next sync.</p></div>`;
  const s = R.cal.sys, d = R.cal.dia;
  const off = (o, what) => `${Math.abs(o) < 1 ? `close to right on ${what}` : `<b>${r0(Math.abs(o))} ${o > 0 ? "low" : "high"}</b> on ${what}`}`;
  const slopeKnown = Math.sqrt(s.cov[1][1]) < 0.15 && Math.abs(s.slope - 1) >= 0.1;
  let acc = "";
  if (v.n) {
    const X = sc(0, Math.max(v.sys.raw, v.sys.cal, v.sys.last) * 1.12 || 1, 0, 170);
    const bar = (label, val, col) => `<div><span>${label}</span>${S(170, 12, `<rect x="0" y="2" width="${Math.max(2, X(val)).toFixed(1)}" height="8" rx="4" fill="${css(col)}" opacity=".85"/>`)}<b>${val.toFixed(1)}</b></div>`;
    acc = `<div class="cmp">${bar("Band as measured", v.sys.raw, "--bad")}${bar("Band, calibrated", v.sys.cal, "--good")}${bar("Your previous cuff reading", v.sys.last, "--ink3")}</div>
      <p class="note">Average miss in systolic mmHg over ${v.n} reading${v.n > 1 ? "s" : ""}, each predicted only from the readings before it. Diastolic: ${v.dia.raw.toFixed(1)} as measured, ${v.dia.cal.toFixed(1)} calibrated, ${v.dia.last.toFixed(1)} for the previous cuff reading.${v.sys.cal >= v.sys.last ? " The calibrated band isn't yet closer than simply reusing your last cuff reading; more anchors at different times of day help it learn your swings." : ""}</p>
      ${agreeLine(v)}`;
  } else acc = `<p class="note">Accuracy appears from your second anchored reading: each new cuff reading becomes a test the band hasn't seen.</p>`;
  const rows = v.rows.filter((r) => r.raw).reverse(), open = st.open.has("bp-anchors"), shown = open ? rows : rows.slice(0, 4);
  const anc = shown.map((r) => {
    const miss = r.cal ? [r.cal.sys - r.cuff.sys, r.cal.dia - r.cuff.dia] : null, worst = miss ? Math.max(Math.abs(miss[0]), Math.abs(miss[1])) : null;
    return `<div><span>${when(r.ms)}${minOf(r.ms) < 720 ? " · morning" : minOf(r.ms) < 1020 ? " · afternoon" : " · evening"}</span><b>${bpTxt(r.cuff.sys, r.cuff.dia)}</b><em>Band as measured ${bpTxt(r.raw.sys, r.raw.dia)}${r.cal ? `; calibrated from the ${r.before} reading${r.before > 1 ? "s" : ""} before it: ${bpTxt(r.cal.sys, r.cal.dia)} <span class="${worst <= 5 ? "ok" : worst <= 10 ? "lo" : "hi"}">(off by ${signed(miss[0])}/${signed(miss[1])})</span>` : " (first anchor: nothing earlier to predict it from)"}</em></div>`;
  }).join("");
  return `<div class="card rise" style="--i:7">${head}
      <p class="cal-sum">For you the band reads ${off(s.offset, "systolic")} and ${off(d.offset, "diastolic")}; Pulse adds that back.${slopeKnown ? ` Your cuff moves about ${s.slope.toFixed(1)}× as much as the band does, so its swings are ${s.slope > 1 ? "stretched" : "shrunk"} to match.` : ""}</p>
      ${acc}
      ${contextBlock(R.context)}
      <div class="sub-h">Anchors<span>${n} of ${cuffN} sitting${cuffN > 1 ? "s" : ""} paired</span></div>
      <div class="kv anc">${anc}</div>
      ${rows.length > 4 ? `<button class="more" data-expand="bp-anchors">${open ? "Show fewer" : `Show all ${rows.length}`}</button>` : ""}
      <p class="note">Each anchor narrows the shaded range. Readings at different times of day (morning, evening, after a walk) teach Pulse how much of the band's swing is real. Older anchors count for less (their weight halves every 60 days) because the band can drift, so a reading every week or two keeps it honest. Your cuff alone sets the home average, the category and your heart risk; the AHA advises against cuffless readings for diagnosis.</p></div>`;
}

/** The whole Blood pressure section of Measure. */
export function bpBlock() {
  const R = D.advData?.bp ?? { B: [], A: [], cal: { n: 0 }, check: { rows: [], n: 0 }, latest: null };
  if (!R.B.length && !(D.bp ?? []).length) return `<div class="card rise" style="--i:6"><p class="note" style="margin:0 0 12px">No readings yet. The band records a blood-pressure estimate every 10 minutes while worn; log a few home cuff readings to anchor it to you. A week of morning and evening cuff readings also gives a reliable home average (AHA) for your heart-risk estimate.</p><button class="cta" data-sheet="bp">Log a cuff reading</button></div>`;
  return bandCard(R) + calCard(R) + bpDetail(D.profile ?? {}, cuffTrend());
}
