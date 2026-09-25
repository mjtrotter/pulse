// Measure: finger ECG rhythm checks and home cuff readings, each charted as recorded over time. A recording
// opens in a full-screen view with the strip, HRV, breathing from the ECG and the average beat, all computed
// on the phone by Pulse's analytics modules.
import { bandpass, ecgPeaks, ecgSummary, ECG_FS } from "../analytics/ecg.js?v=20260924214250";
import { advancedHRV } from "../analytics/hrv_advanced.js?v=20260924214250";
import { edrFusion, medianBeat, morphologyFilter } from "../analytics/edr.js?v=20260924214250";
import { toMs } from "../core/time.js?v=20260924214250";
import { clamp, mean, median, ols, sd } from "./stats.js?v=20260924214250";
import { bpCategory, bpSummary } from "./bp.js?v=20260924214250";
import { labsBlock } from "./labsui.js?v=20260924214250";
import { ampm, css, D, dname, empty, esc, header, MON, poly, S, sc, scrubbable, sign, smooth, st, uid } from "./kit.js?v=20260924214250";

const SETTLE = 5;
const AN = new Map();
const minOf = (t) => +t.slice(11, 13) * 60 + +t.slice(14, 16);
const dateOf = (t) => new Date(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10));
export const recWhen = (t) => { const a = Math.round((new Date(new Date().toDateString()) - dateOf(t)) / 864e5); return `${a === 0 ? "Today" : a === 1 ? "Yesterday" : dname(dateOf(t))} · ${ampm(minOf(t))}`; };

/** Full analysis of a stored session (cached by timestamp). */
export function analyze(sn) {
  if (AN.has(sn.t)) return AN.get(sn.t);
  const t0 = performance.now(), fs = sn.fs ?? ECG_FS;
  const raw = Array.from(sn.samples ?? []);
  const x = raw.slice(SETTLE * fs), durS = x.length / fs;
  let s = null, adv = null, edr = null, mb = null, mf = x;
  try {
    s = ecgSummary(raw, fs, SETTLE);
    const bp = bandpass(x);
    adv = s.rr.length > 10 ? advancedHRV(s.rr) : null;
    edr = s.rr.length > 10 ? edrFusion(s.peaks, s.good, bp, fs) : null;
    mf = morphologyFilter(x, fs);
    mb = s.rr.length > 10 ? medianBeat(mf, s.peaks, s.good, fs, mean(s.rr)) : null;
  } catch (e) { console.warn("ECG analysis", e); }
  const iv = [];
  if (s) {
    for (let i = 1; i < s.peaks.length; i++) iv.push({ t: s.peaks[i] / fs, v: ((s.peaks[i] - s.peaks[i - 1]) * 1000) / fs });
    iv.forEach((z, i) => { const nb = iv.slice(Math.max(0, i - 2), i + 3).map((q2) => q2.v).sort((a, b) => a - b), med = nb[nb.length >> 1]; z.ok = s.good[i] && s.good[i + 1] && z.v >= 300 && z.v <= 2000 && Math.abs(z.v - med) <= 0.2 * med; });
  }
  const hv = s?.hrv;
  const verdict = durS < 25 ? ["Too short to judge", "short", "Keep your finger on the plate for at least 30 seconds."]
    : !hv || (s.quality ?? 0) < 0.7 ? ["Inconclusive", "short", "Too much noise to read the rhythm. Rest your forearms on a table and touch the plate lightly."]
    : hv.hr < 50 || hv.hr > 120 ? ["Inconclusive", "short", `Heart rate ${Math.round(hv.hr)} bpm is outside the 50–120 range this check can classify.`]
    : hv.irregular ? ["Irregular rhythm", "bad", "Repeat it seated and still. If irregular results keep appearing, show these recordings to your doctor."]
    : ["Regular rhythm", "good", ""];
  const edrOk = !!edr && edr.rate != null && durS >= 55 && (edr.agreement ?? 0) >= 0.5;
  const E = { sn, fs, x: mf, s, adv, edr, edrOk, mb, iv, dur: durS, verdict, early: iv.filter((z) => !z.ok).length, ms: performance.now() - t0 };
  AN.set(sn.t, E);
  return E;
}
export const analyzed = (sn) => AN.has(sn.t);
export const current = () => { const sn = D.ecg.find((z) => z.t === st.recOpen) ?? D.ecg[D.ecg.length - 1]; return sn ? analyze(sn) : null; };

// ---------- the strip, HRV, breathing, beat (recording view) ----------
export function ecgTrace() {
  const E = current(), W0 = 340, H = 150, win = 8, fs = E.fs, a = Math.round(st.ecgStart * fs), b = Math.min(E.x.length, a + win * fs);
  const seg = E.x.slice(a, b), sorted = [...seg].sort((p, q2) => p - q2), lo = Math.min(-0.45, sorted[Math.floor(sorted.length * 0.005)] ?? -0.45), hi = Math.max(0.85, sorted[Math.ceil(sorted.length * 0.995) - 1] ?? 0.85);
  const x = sc(0, win, 0, W0), y = sc(lo, hi, H, 0);
  let grid = "";
  for (let t = 0; t <= win + 1e-9; t += 0.2) grid += `<line x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="0" y2="${H}" stroke="${css("--heart")}" stroke-opacity="${Math.abs(t - Math.round(t)) < 1e-6 ? 0.32 : 0.12}"/>`;
  for (let v = Math.ceil(lo * 10) / 10; v <= hi + 1e-9; v += 0.1) grid += `<line x1="0" x2="${W0}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${css("--heart")}" stroke-opacity="${Math.abs(v * 2 - Math.round(v * 2)) < 1e-6 ? 0.32 : 0.12}"/>`;
  const pts = []; for (let i = a; i < b; i++) pts.push([x((i - a) / fs), y(clamp(E.x[i], lo, hi))]);
  const marks = E.s ? E.s.peaks.map((p, k) => [p, k]).filter(([p]) => p >= a && p < b).map(([p, k]) => `<circle cx="${x((p - a) / fs).toFixed(1)}" cy="8" r="3" fill="${E.s.good[k] ? css("--good") : css("--bad")}"/>`).join("") : "";
  const early = E.iv.find((r) => !r.ok && r.t >= st.ecgStart && r.t < st.ecgStart + win);
  return `<div class="ecg">${S(W0, H, `${grid}<path d="${poly(pts)}" fill="none" stroke="${css("--ink")}" stroke-width="1.3" stroke-linejoin="round"/>${marks}`)}</div>
    <div class="ecg-cap"><span>${st.ecgStart.toFixed(0)}–${(st.ecgStart + win).toFixed(0)} s</span><span>1 s · 0.5 mV per large square</span></div>
    ${early ? `<p class="flag">Red dot: a beat that didn't match the others (often an early beat, or movement). It and its neighbours are left out of HRV.</p>` : ""}`;
}
export function ecgOverview() {
  const E = current(), W0 = 340, H = 44, n = E.x.length, per = Math.max(1, Math.floor(n / W0));
  let top = "", bot = "";
  for (let c = 0; c < W0; c++) { let mn = Infinity, mx = -Infinity; for (let i = c * per; i < Math.min(n, (c + 1) * per); i++) { mn = Math.min(mn, E.x[i]); mx = Math.max(mx, E.x[i]); } if (!Number.isFinite(mn)) continue; top += `${top ? "L" : "M"}${c},${sc(-0.5, 0.9, H - 4, 4)(clamp(mx, -0.5, 0.9)).toFixed(1)}`; bot = `L${c},${sc(-0.5, 0.9, H - 4, 4)(clamp(mn, -0.5, 0.9)).toFixed(1)}` + bot; }
  const x = sc(0, E.dur, 0, W0), flags = E.iv.filter((r) => !r.ok).map((r) => `<rect x="${(x(r.t) - 1).toFixed(1)}" y="0" width="2" height="${H}" fill="${css("--bad")}" opacity=".6"/>`).join("");
  return `<div class="ov-strip" data-ecgov>${S(W0, H, `<path d="${top}${bot}Z" fill="${css("--ink3")}" opacity=".55"/>${flags}<rect class="win" x="${x(st.ecgStart).toFixed(1)}" y="1" width="${(x(Math.min(8, E.dur)) - x(0)).toFixed(1)}" height="${H - 2}" rx="5" fill="${css("--heart")}" fill-opacity=".12" stroke="${css("--heart")}" stroke-width="1.5"/>`)}</div>
    <div class="ecg-cap"><span>Drag the window · ${Math.round(E.dur + SETTLE)} s</span>${E.iv.some((z) => !z.ok) ? `<span>Jump to <button class="link" data-jump="early">flagged beat</button></span>` : ""}</div>`;
}
const stats = (arr) => `<div class="stat6">${arr.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join("")}</div>`;
const f1 = (v, d = 1) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(d));
export function hrvPanel() {
  const E = current(), a = E.adv, h = E.s?.hrv, W0 = 340;
  if (!h || !a) return `<p class="note">Not enough clean beats for HRV in this recording.</p>`;
  const tabs = [["time", "Beat to beat"], ["spectrum", "Rhythms"], ["poincare", "Poincaré"], ["complexity", "Complexity"]];
  let body = "";
  if (st.hrvTab === "time") {
    const H = 150, ok = E.iv.filter((r) => r.ok), x = sc(0, E.dur, 30, W0 - 4), lo = Math.min(...ok.map((r) => r.v)) - 40, hi = Math.max(...ok.map((r) => r.v)) + 40, y = sc(lo, hi, H - 18, 6);
    const svgb = [lo + 40, (lo + hi) / 2, hi - 40].map((v) => `<line x1="30" x2="${W0 - 4}" y1="${y(v)}" y2="${y(v)}" stroke="${css("--grid")}"/><text x="26" y="${y(v) + 4}" text-anchor="end" class="axis">${v.toFixed(0)}</text>`).join("")
      + `<path d="${poly(ok.map((r) => [x(r.t), y(r.v)]))}" fill="none" stroke="${css("--hrv")}" stroke-width="1.4"/>` + E.iv.filter((r) => !r.ok).map((r) => `<circle cx="${x(r.t).toFixed(1)}" cy="${y(clamp(r.v, lo, hi)).toFixed(1)}" r="3" fill="none" stroke="${css("--bad")}" stroke-width="1.4"/>`).join("")
      + [0, 30, 60, 90].filter((t) => t < E.dur).map((t) => `<text x="${x(t)}" y="${H - 2}" text-anchor="middle" class="axis">${t}s</text>`).join("");
    body = scrubbable(uid("s"), W0, H, svgb, E.iv.map((r) => [x(r.t), y(clamp(r.v, lo, hi)), `${r.t.toFixed(1)} s · <b>${r.v.toFixed(0)} ms</b> (${(60000 / r.v).toFixed(0)} bpm)${r.ok ? "" : " · left out"}`]), `Time between beats (ms). The wave is your breathing speeding and slowing the heart.`)
      + stats([[f1(h.rmssd), "RMSSD ms"], [E.dur >= 60 ? f1(h.sdnn) : "—", "SDNN ms"], [E.dur >= 60 ? `${f1(h.pnn50)}%` : "—", "pNN50"], [`${f1(a.cvnn)}%`, "CVNN"], [f1(h.stress_index, 0), "Baevsky SI"], [f1(h.hr, 0), "mean bpm"]]);
  } else if (st.hrvTab === "spectrum") {
    const sp = a.spectrum;
    if (!sp) body = `<p class="note">Rhythm analysis needs at least a minute of clean beats (Baek 2015). This recording has ${Math.round(a.duration)} s; use the 2-minute option.</p>`;
    else {
      const H = 160, x = sc(0, 0.5, 30, W0 - 4), pmax = Math.max(...sp.psd.filter((_, i) => sp.freqs[i] > 0.035)), y = sc(0, pmax * 1.1, H - 20, 8);
      const pts = sp.freqs.map((f, i) => [x(f), y(Math.min(pmax * 1.1, sp.psd[i]))]);
      const zone = (a0, a1, c, l) => `<rect x="${x(a0)}" y="8" width="${x(a1) - x(a0)}" height="${H - 28}" fill="${css(c)}" opacity=".09"/><text x="${(x(a0) + x(a1)) / 2}" y="20" text-anchor="middle" class="axis">${l}</text>`;
      const svgb = zone(0.0033, 0.04, "--ink3", "VLF") + zone(0.04, 0.15, "--temp", "LF") + zone(0.15, 0.4, "--breath", "HF")
        + `<path d="${poly(pts)}L${x(0.5)},${y(0)}L${x(0)},${y(0)}Z" fill="${css("--hrv")}" opacity=".18"/><path d="${poly(pts)}" fill="none" stroke="${css("--hrv")}" stroke-width="1.6"/>`
        + (sp.hfPeak ? `<line x1="${x(sp.hfPeak)}" x2="${x(sp.hfPeak)}" y1="26" y2="${H - 20}" stroke="${css("--breath")}" stroke-width="1.2"/><text x="${x(sp.hfPeak) + 4}" y="36" class="axis">${(sp.hfPeak * 60).toFixed(1)} breaths/min</text>` : "")
        + [0, 0.1, 0.2, 0.3, 0.4, 0.5].map((f) => `<text x="${x(f)}" y="${H - 4}" text-anchor="middle" class="axis">${f}</text>`).join("");
      body = scrubbable(uid("s"), W0, H, svgb, sp.freqs.filter((_, i) => i % 2 === 0).map((f) => { const i = sp.freqs.indexOf(f); return [x(f), y(Math.min(pmax * 1.1, sp.psd[i])), `${f.toFixed(3)} Hz (${(f * 60).toFixed(1)}/min) · <b>${sp.psd[i].toFixed(0)} ms²/Hz</b>`]; }), `Power by rhythm speed (Hz). HF = breathing; LF = slower blood-pressure waves.`)
        + stats([[f1(sp.lnHf, 2), "ln HF (ms²)"], [f1(sp.lnLf, 2), "ln LF (ms²)"], [f1(sp.lfhf, 2), "LF/HF"], [f1(sp.hfnu, 0), "HF n.u."], [sp.hfPeak ? f1(sp.hfPeak * 60) : "—", "HF peak /min"], [`${Math.round(sp.duration)} s`, "clean length"]])
        + `<p class="note">Lomb-Scargle spectrum of the beat intervals. HF needs 1 min and LF 2 min of clean beats (Baek 2015): ${sp.hfValid ? "✓" : "✗"} HF, ${sp.lfValid ? "✓" : "✗"} LF. LF/HF is shown for completeness; it is not a reliable "stress balance" meter (Billman 2013).</p>`;
    }
  } else if (st.hrvTab === "poincare") {
    const rr = E.s.rr, H = 250, lo = Math.min(...rr) - 30, hi = Math.max(...rr) + 30, x = sc(lo, hi, 36, W0 - 60), y = sc(lo, hi, H - 20, 10), p = a.poincare, m = mean(rr), k = (x(hi) - x(lo)) / (hi - lo);
    body = S(W0, H, `<line x1="${x(lo)}" y1="${y(lo)}" x2="${x(hi)}" y2="${y(hi)}" stroke="${css("--grid")}" stroke-width="1.5"/>`
      + rr.slice(0, -1).map((v, i) => `<circle cx="${x(v).toFixed(1)}" cy="${y(rr[i + 1]).toFixed(1)}" r="2.6" fill="${css("--hrv")}" opacity=".55"/>`).join("")
      + `<ellipse cx="${x(m)}" cy="${y(m)}" rx="${(p.sd2 * k * 1.5).toFixed(1)}" ry="${(p.sd1 * k * 1.5).toFixed(1)}" transform="rotate(-45 ${x(m)} ${y(m)})" fill="${css("--hrv")}" fill-opacity=".08" stroke="${css("--hrv")}" stroke-width="1.5"/>`
      + `<text x="${x(hi)}" y="${y(hi) - 6}" text-anchor="end" class="axis">RRₙ₊₁ = RRₙ</text><text x="${x(lo)}" y="${H - 4}" class="axis">RRₙ (ms) →</text>`)
      + stats([[f1(p.sd1), "SD1 ms (short-term)"], [f1(p.sd2), "SD2 ms (long-term)"], [f1(p.ratio, 2), "SD1/SD2"], [f1(p.csi, 2), "CSI"], [f1(p.cvi, 2), "CVI"], [`${f1(p.area / 1000)}k`, "ellipse ms²"]])
      + `<p class="note">Each dot plots one beat interval against the next. The ellipse's width (SD1) is quick beat-to-beat change; its length (SD2) is slower drift (Brennan 2001).</p>`;
  } else if (a.dfa1 == null) {
    body = `<p class="note">Complexity measures need about 1.5–2 minutes of clean beats. This recording has ${Math.round(a.duration)} s; use the 2-minute option to see them.</p>`;
  } else {
    const scale = (lbl, v, lo, hi, marks, txt, fmt = (z) => z.toFixed(2)) => { const x = sc(lo, hi, 6, 214); return `<div class="scale"><div class="sc-h"><b>${lbl}</b><em>${fmt(v)}</em></div>${S(220, 26, `<rect x="6" y="9" width="208" height="6" rx="3" fill="${css("--track")}"/>${marks.map(([a0, a1, c]) => `<rect x="${x(a0)}" y="9" width="${x(a1) - x(a0)}" height="6" rx="3" fill="${css(c)}" opacity=".55"/>`).join("")}<circle cx="${clamp(x(v), 6, 214)}" cy="12" r="6" fill="${css("--ink")}" stroke="${css("--bg")}" stroke-width="2"/><text x="6" y="26" class="axis">${lo}</text><text x="214" y="26" text-anchor="end" class="axis">${hi}</text>`)}<p>${txt}</p></div>`; };
    body = scale("DFA α1", a.dfa1, 0.3, 1.7, [[0.75, 1.25, "--good"]], `Fractal pattern of the beat intervals over 4–16 beats (Peng 1995). About 1.0 at healthy rest; drifts toward 0.5 (random) with exertion or irregular beats.`)
      + scale("Sample entropy", a.sampen, 0, 3, [[1, 2.2, "--good"]], `How unpredictable the rhythm is (Richman & Moorman 2000). Lower means more regular. Compare with your own recordings.`)
      + scale("Fragmentation (PIP)", a.fragmentation.pip, 30, 80, [], `Share of beats where the speed-up/slow-down direction flips (Costa 2017). Higher values are linked with ageing and heart disease; tracked against your own.`, (z) => `${z.toFixed(0)}%`)
      + `<p class="note">Each of these needs about 1.5–2 minutes of clean beats; Pulse hides them on shorter recordings.</p>`;
  }
  return `<div class="seg small">${tabs.map(([k, l]) => `<button data-hrvtab="${k}" class="${st.hrvTab === k ? "on" : ""}">${l}</button>`).join("")}</div>${body}`;
}
function breathingPanel() {
  const E = current(), e = E.edr, W0 = 300, H = 26, win = Math.min(60, E.dur);
  if (!e?.channels || E.dur < 55) return `<p class="note">Breathing from the ECG needs about a minute of clean beats; use the 2-minute option.</p>`;
  const ok = E.s.peaks.map((p, i) => ({ p, g: E.s.good[i] })).filter((b) => b.g && b.p / E.fs < win);
  const sig = [ok.slice(1).map((b, i) => [b.p / E.fs, (b.p - ok[i].p) / E.fs]), ok.map((b) => [b.p / E.fs, Math.abs(E.x[b.p])]), ok.map((b) => { let m = 0; for (let k = Math.max(1, b.p - 10); k < b.p + 10 && k < E.x.length; k++) m = Math.max(m, Math.abs(E.x[k] - E.x[k - 1])); return [b.p / E.fs, m]; })];
  const maxW = Math.max(...e.channels.map((c) => c.weight ?? 0), 1);
  return `<div class="fuse">${e.channels.map((c, i) => { const v = sig[i].map((p) => p[1]), x = sc(0, win, 0, W0), y = sc(Math.min(...v), Math.max(...v), H - 3, 3);
    return `<div class="fch"><div class="fch-h"><b>${c.name}</b><em>${c.rate != null ? `${c.rate.toFixed(1)}/min` : "—"}</em></div>${S(W0, H, `<path d="${smooth(sig[i].map((p) => [x(p[0]), y(p[1])]), 0.15)}" fill="none" stroke="${css("--breath")}" stroke-width="1.4"/>`, 'preserveAspectRatio="none"')}
      <div class="fch-w"><span>clarity ${(c.clarity ?? 0) > 99 ? "99+" : (c.clarity ?? 0).toFixed(0)}×</span><span class="wbar"><i style="width:${(100 * (c.weight ?? 0)) / maxW}%"></i></span><span>weight ${(c.weight ?? 0).toFixed(1)}</span></div></div>`; }).join("")}
    <div class="fused"><div><div class="lbl">Fused breathing rate</div><div class="num big2">${E.edrOk ? e.rate.toFixed(1) : "—"}<small>/min</small></div></div><div class="agree"><b>${e.channels.filter((c) => c.weight > 0).length} of 3</b> channels used<br>agreement ${Math.round((e.agreement ?? 0) * 100)}%</div></div>
    <p class="note">Three signals in the ECG move with each breath: beat timing, R-wave height and QRS steepness. Each is scored by how clear its rhythm is, and the rate is their weighted median, so one noisy signal can't drag it (Charlton 2016).${E.edrOk ? "" : " The channels disagree in this recording, so no rate is shown."}${D.latest?.br != null ? ` Asleep last night, your pulse recordings gave ${D.latest.br.toFixed(1)}/min.` : ""}</p></div>`;
}
function beatPanel() {
  const E = current(), b = E.mb;
  if (!b?.template) return `<p class="note">Not enough clean beats to build an average beat.</p>`;
  const W0 = 340, H = 170, L = b.template.length, ms = (k) => ((k - b.pre) * 1000) / b.fs;
  const x = sc(ms(0), ms(L - 1), 10, W0 - 10), lo = Math.min(...b.template), hi = Math.max(...b.template), y = sc(lo - 0.05, hi + 0.05, H - 22, 8);
  const vl = (k, lbl) => (k == null ? "" : `<line x1="${x(ms(k))}" x2="${x(ms(k))}" y1="8" y2="${H - 22}" stroke="${css("--ink3")}" stroke-dasharray="3 3"/><text x="${x(ms(k))}" y="${H - 8}" text-anchor="middle" class="axis">${lbl}</text>`);
  return S(W0, H, (b.qrsOn != null && b.qrsOff != null ? `<rect x="${x(ms(b.qrsOn))}" y="8" width="${x(ms(b.qrsOff)) - x(ms(b.qrsOn))}" height="${H - 30}" fill="${css("--heart")}" opacity=".12"/>` : "")
    + (b.qrsOn != null && b.tEnd != null ? `<rect x="${x(ms(b.qrsOn))}" y="${H - 34}" width="${x(ms(b.tEnd)) - x(ms(b.qrsOn))}" height="3" rx="1.5" fill="${css("--temp")}" opacity=".8"/>` : "")
    + `<path d="${poly(b.template.map((v, k) => [x(ms(k)), y(v)]))}" fill="none" stroke="${css("--ink")}" stroke-width="2" stroke-linejoin="round"/>`
    + vl(b.qrsOn, "Q") + vl(b.qrsOff, "J") + vl(b.tPeak, "T") + vl(b.tEnd, "T end"))
    + stats([[`${f1(b.qrs_ms, 0)} ms`, `QRS${b.qrs_ms != null ? (b.qrs_ms < 120 ? " · under 120" : " · wide") : ""}`], [`${f1(b.qt_ms, 0)} ms`, "QT"], [`${f1(b.qtcF, 0)} ms`, `QTc Fridericia${b.qtcF != null && b.qtcF < 450 ? " · under 450" : ""}`], [`${f1(b.rAmp, 2)} mV`, "R height"], [`${f1(b.tAmp, 2)} mV`, "T height"], [b.beats ?? "—", "beats averaged"]])
    + `<p class="note">The median of ${b.beats} aligned beats, so noise cancels out. QRS edges are where the slope becomes significant; T end uses the tangent method; QTc uses Fridericia (Luo 2004). A finger lead is not a 12-lead: check the markers by eye, and treat these as estimates.</p>`;
}
export function recView() {
  const E = current(), sn = E.sn, h = E.s?.hrv, tooShort = E.dur < 25 || !E.s;
  return `<div class="aurora"><i class="a"></i><i class="b"></i><i class="c"></i></div><div class="inner">
    <div class="m-top"><button class="back" data-close>‹ Measure</button><span class="lbl">finger lead · ${sn.fs ?? ECG_FS} Hz</span></div>
    <div class="card hero-ecg v-${E.verdict[1]}" style="margin-top:16px"><div class="rhythm"><div class="pulse-dot ${E.verdict[1]}"></div><div><div class="lbl">Heart rhythm check · ${recWhen(sn.t)}</div><div class="r-verdict">${E.verdict[0]}</div><div class="r-sub">${Math.round(E.dur + SETTLE)} s${E.s ? ` · ${Math.round(E.s.quality * 100)}% clean beats` : ""}${E.early ? ` · ${E.early} interval${E.early > 1 ? "s" : ""} set aside` : ""}</div></div></div>
      <div class="r-stats"><div><b>${f1(h?.hr, 0)}</b><span>bpm</span></div><div><b>${f1(h?.rmssd, 0)}</b><span>RMSSD ms</span></div><div><b>${E.edrOk ? E.edr.rate.toFixed(1) : "—"}</b><span>breaths/min</span></div><div><b>${f1(E.mb?.qtcF, 0)}</b><span>QTc ms</span></div></div>
      <p class="note">${E.verdict[2] ? `${E.verdict[2]} ` : ""}${h ? `Irregularity screen (Dash 2009): normalised RMSSD ${h.nrmssd.toFixed(3)} (flag above 0.1), entropy ${h.shannon.toFixed(2)}, turning points ${h.tpr.toFixed(2)}. ` : ""}A screening check, not a diagnosis.</p></div>
    <div class="sec"><h2>The recording</h2><span class="lbl">${Math.round(E.dur + SETTLE)} s</span></div>
    <div class="card" id="ecgcard">${ecgTrace()}${ecgOverview()}</div>
    ${tooShort ? "" : `<div class="sec"><h2>Heart rate variability</h2><span class="lbl">${E.s.rr.length} clean beats</span></div>
    <div class="card" id="hrvcard">${hrvPanel()}</div>
    <div class="sec"><h2>Breathing from the ECG</h2><span class="lbl">3-signal fusion</span></div>
    <div class="card">${breathingPanel()}</div>
    <div class="sec"><h2>Average beat</h2><span class="lbl">estimates · check by eye</span></div>
    <div class="card">${beatPanel()}</div>`}
    <button class="cta ghost" data-delrec="${esc(sn.t)}" style="margin-top:18px">Delete this recording</button>
    <p class="note foot">Analysed on this phone in ${E.ms.toFixed(0)} ms.</p></div>`;
}

// ---------- live recording ----------
export function liveView(ctx) {
  const connected = !!ctx.band?.connected;
  return `<div class="aurora"><i class="a"></i><i class="b"></i><i class="c"></i></div><div class="inner">
    <div class="m-top"><button class="back" data-close data-stoprec>‹ Measure</button><span class="lbl">rhythm check</span></div>
    <h1 class="m-title">Heart rhythm check</h1>
    <ol class="steps"><li>Sit down and rest both forearms on a table.</li><li>Touch the <b>silver plate on the outside of the band</b> lightly with a fingertip of your other hand.</li><li>Stay still and quiet until it finishes.</li></ol>
    <div class="seg small inline" style="margin:4px 0 14px">${[["30", "30 seconds"], ["120", "2 minutes"]].map(([k, l]) => `<button data-reclen="${k}" class="${String(st.recLen ?? 30) === k ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="card live-ecg"><div class="ecg-head"><b id="recClock">0 s</b><span id="recBpm"></span></div><canvas class="ecg-canvas" id="recCanvas" height="190"></canvas><div class="progress"><i id="recProg" style="width:0%"></i></div></div>
    <p class="note" id="recStatus" style="text-align:center;min-height:22px">${connected ? "Ready when you are." : "Connect your band first."}</p>
    ${connected ? `<button class="cta" id="recGo" data-recgo>Start</button>` : `<button class="cta" data-connect>Connect band</button>`}
  </div>`;
}
export function drawEcg(canvas, x, { peaks = [], fs = ECG_FS } = {}) {
  const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth || 340, H = 190;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const secs = x.length / fs;
  for (let t = 0; t <= secs + 1e-9; t += 0.2) {
    const px = Math.round((t / Math.max(secs, 0.01)) * W) + 0.5;
    g.strokeStyle = css("--heart"); g.globalAlpha = Math.abs(t - Math.round(t)) < 1e-6 ? 0.3 : 0.1; g.lineWidth = 1;
    g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H); g.stroke();
  }
  g.globalAlpha = 1;
  if (x.length < 2) return;
  const sorted = [...x].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.005)], hi = sorted[Math.ceil(sorted.length * 0.995) - 1];
  const span = Math.max(hi - lo, 0.2), pad = span * 0.15;
  const y = (v) => H - 10 - ((v - (lo - pad)) / (span + 2 * pad)) * (H - 20);
  g.strokeStyle = css("--ink"); g.lineWidth = 1.6; g.lineJoin = "round"; g.lineCap = "round";
  g.beginPath();
  x.forEach((v, i) => { const px = (i / (x.length - 1)) * W; i ? g.lineTo(px, y(v)) : g.moveTo(px, y(v)); });
  g.stroke();
  g.fillStyle = css("--good");
  for (const p of peaks) { const px = (p / (x.length - 1)) * W; g.beginPath(); g.arc(px, 9, 3, 0, 7); g.fill(); }
}
/** Runs a live recording in the open live view; resolves with the saved session or null. */
export async function runRecording(ctx, dbm, stamp) {
  const $ = (id) => document.getElementById(id);
  const canvas = $("recCanvas"), status = $("recStatus"), clockEl = $("recClock"), bpmEl = $("recBpm"), prog = $("recProg"), btn = $("recGo");
  if (!canvas || !ctx.band?.connected) return null;
  const duration = +(st.recLen ?? 30), total = SETTLE + duration, samples = [];
  let firstAt = null, lastAt = null, packets = 0, stoppedEarly = false;
  const run = { stop: false };
  st.recRun = run;
  btn.textContent = "Stop"; btn.dataset.recgo = "stop";
  status.textContent = "Waiting for your finger on the silver plate…";
  const t0 = Date.now();
  const tick = setInterval(() => {
    if (!firstAt) { if (Date.now() - t0 > 20e3) { run.stop = true; status.textContent = "No signal. Is your fingertip on the silver plate?"; } return; }
    const secs = (Date.now() - firstAt) / 1000;
    clockEl.textContent = `${Math.min(total, Math.floor(secs))} / ${total} s`;
    prog.style.width = `${Math.min(100, (100 * secs) / total)}%`;
    status.textContent = secs < SETTLE ? "Settling… keep still" : "Recording… keep still";
    const tail = samples.slice(-8 * ECG_FS);
    if (tail.length >= 4 * ECG_FS) { const { peaks } = ecgPeaks(tail); if (peaks.length > 2) bpmEl.textContent = `${Math.round((60 * ECG_FS * (peaks.length - 1)) / (peaks[peaks.length - 1] - peaks[0]))} bpm`; }
    if (secs >= total) run.stop = true;
    const quiet = lastAt ? Date.now() - lastAt : 0;
    if (quiet > 1500) status.textContent = "Keep your fingertip on the silver plate…";
    if (quiet > 6000) { run.stop = true; stoppedEarly = secs < total - 2; }
  }, 500);
  let frame = 0;
  const draw = () => { if (run.done) return; if (frame++ % 2 === 0 && samples.length > 64) drawEcg(canvas, bandpass(samples.slice(-4 * ECG_FS))); requestAnimationFrame(draw); };
  requestAnimationFrame(draw);
  try {
    await ctx.band.ecg((mv) => { if (!firstAt) { firstAt = Date.now(); ctx.log("ECG signal"); } lastAt = Date.now(); packets++; samples.push(...mv); }, () => run.stop, total + 25);
  } catch (e) { ctx.log(`ECG stopped: ${e.message}`, true); }
  finally { clearInterval(tick); run.done = true; st.recRun = null; }
  const rate = packets > 1 ? samples.length / ((lastAt - firstAt) / 1000) : 0;
  ctx.log(`ECG ended: ${samples.length} samples, ≈${rate.toFixed(0)}/s`);
  if (samples.length < (SETTLE + 10) * ECG_FS) {
    status.textContent = samples.length ? "Too short to read. Keep your finger on until it finishes." : status.textContent;
    btn.textContent = "Start again"; btn.dataset.recgo = "";
    return null;
  }
  const res = ecgSummary(samples, ECG_FS, SETTLE);
  const session = { band: ctx.mac ?? "unknown", t: stamp(), fs: ECG_FS, arrival_rate: rate, n: samples.length, samples: Float32Array.from(samples),
    result: { hrv: res.hrv, quality: res.quality, peaks: res.peaks, good: res.good } };
  await dbm.put(ctx.store, "ecg", session);
  if (stoppedEarly) ctx.log(`ECG: signal stopped after ${(samples.length / ECG_FS).toFixed(0)} s`);
  return session;
}

// ---------- history ----------
const ECGM = { hr: ["Heart rate", "bpm", (E) => E.s?.hrv?.hr, 0], rmssd: ["HRV", "ms", (E) => E.s?.hrv?.rmssd, 1], breath: ["Breathing", "/min", (E) => (E.edrOk ? E.edr.rate : null), 1], qtc: ["QTc", "ms", (E) => E.mb?.qtcF, 0] };
function ecgHistory() {
  const list = D.ecg;
  if (list.length < 2) return "";
  if (!list.every(analyzed)) return `<div class="card rise" style="--i:3"><p class="note" style="margin:0">Analysing ${list.length} recordings on this phone… ${list.filter(analyzed).length}/${list.length}</p></div>`;
  const [, unit, get, dp] = ECGM[st.ecgMetric], W0 = 340, H = 190, col = css({ hr: "--heart", rmssd: "--hrv", breath: "--breath", qtc: "--temp" }[st.ecgMetric]);
  const rows = list.map((sn) => { const E = analyze(sn); return { sn, E, ms: toMs(sn.t), v: E.verdict[1] === "short" ? null : get(E) ?? null }; });
  const okRows = rows.filter((z) => z.v != null);
  if (okRows.length < 2) return "";
  const vals = okRows.map((z) => z.v), lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.25 || 1;
  const t0 = rows[0].ms, t1 = Math.max(rows[rows.length - 1].ms, t0 + 864e5), x = sc(t0, t1, 34, W0 - 10), y = sc(lo - pad, hi + pad, H - 24, 12);
  const fit = okRows.length >= 3 ? ols(okRows.map((z) => [1, (z.ms - t1) / 864e5]), okRows.map((z) => z.v)) : null;
  const body = [lo, (lo + hi) / 2, hi].map((v) => `<line x1="34" x2="${W0 - 10}" y1="${y(v)}" y2="${y(v)}" stroke="${css("--grid")}"/><text x="28" y="${y(v) + 4}" text-anchor="end" class="axis">${v.toFixed(dp)}</text>`).join("")
    + (fit ? `<path d="M${x(t0)},${y(fit.beta[0] + (fit.beta[1] * (t0 - t1)) / 864e5)}L${x(t1)},${y(fit.beta[0])}" stroke="${col}" stroke-opacity=".45" stroke-width="1.5" stroke-dasharray="5 4"/>` : "")
    + `<path d="${smooth(okRows.map((z) => [x(z.ms), y(z.v)]), 0.12)}" fill="none" stroke="${col}" stroke-width="2"/>`
    + rows.map((z) => (z.v == null ? `<circle cx="${x(z.ms)}" cy="${H - 30}" r="3.5" fill="none" stroke="${css("--ink3")}" stroke-width="1.4"/>` : `<circle cx="${x(z.ms)}" cy="${y(z.v)}" r="4.5" fill="${css(z.E.verdict[1] === "good" ? "--good" : "--bad")}" stroke="${css("--bg")}" stroke-width="2"/>`)).join("")
    + [t0, (t0 + t1) / 2, t1].map((ms, i) => { const d = new Date(ms); return `<text x="${x(ms)}" y="${H - 4}" text-anchor="${["start", "middle", "end"][i]}" class="axis">${MON[d.getMonth()]} ${d.getDate()}</text>`; }).join("");
  const sp = rows.map((z) => [x(z.ms), z.v == null ? H - 30 : y(z.v), `${recWhen(z.sn.t)} · ${z.v == null ? "not measured" : `<b>${z.v.toFixed(dp)} ${unit}</b>`} · ${z.E.verdict[0].toLowerCase()}`]);
  const slope = fit ? fit.beta[1] * 30 : null;
  return `<div class="card rise" style="--i:3"><div class="seg small">${Object.entries(ECGM).map(([k, [l]]) => `<button data-ecgm="${k}" class="${st.ecgMetric === k ? "on" : ""}">${l}</button>`).join("")}</div>
    ${scrubbable(uid("s"), W0, H, body, sp, `Each dot is a recording, coloured by its rhythm result. Hollow: too short or noisy to measure.`)}
    <div class="stat3"><div><b>${okRows[okRows.length - 1].v.toFixed(dp)}</b><span>latest ${unit}</span></div><div><b>${median(vals).toFixed(dp)}</b><span>median of ${vals.length}</span></div><div><b>${slope != null ? sign(slope, dp) : "—"}</b><span>trend per 30 days</span></div></div>
    <p class="note">Morning recordings are the most comparable: same time, seated, before coffee.</p></div>`;
}
function recList() {
  const list = [...D.ecg].reverse(), shown = st.allRecs ? list : list.slice(0, 5);
  return `<div class="card rise reclist" style="--i:4">${shown.map((sn) => {
    const E = analyzed(sn) ? analyze(sn) : null, hv = sn.result?.hrv;
    return `<button class="rec-row" data-rec="${esc(sn.t)}"><i class="${E ? E.verdict[1] : ""}"></i><span class="rr-w"><b>${recWhen(sn.t)}</b><span>${E ? E.verdict[0] : "analysing…"} · ${Math.round((sn.n ?? 0) / (sn.fs ?? ECG_FS))} s</span></span><span class="rr-v">${hv?.hr ? `${Math.round(hv.hr)}<small>bpm</small> ${Math.round(hv.rmssd)}<small>ms</small>` : "—"}</span><span class="chev">›</span></button>`;
  }).join("")}${list.length > 5 ? `<button class="more" data-allrecs>${st.allRecs ? "Show fewer" : `Show all ${list.length} recordings`}</button>` : ""}</div>`;
}

// ---------- blood pressure ----------
function bpSection() {
  const all = D.bp, now = Date.now();
  if (!all.length) return `<div class="card rise" style="--i:6"><p class="note" style="margin:0 0 12px">No readings yet. A week of morning and evening readings gives a reliable home average (AHA), and it feeds your heart-risk estimate.</p><button class="cta" data-sheet="bp">Log a reading</button></div>`;
  const sum = bpSummary(all), n = +st.bpAgg, rows = all.filter((r) => toMs(r.t) >= now - n * 864e5);
  const cat = sum ? bpCategory(sum.sys, sum.dia) : null;
  const W0 = 340, H = 180, x = sc(now - n * 864e5, now, 30, W0 - 8), lo = Math.min(70, ...rows.map((r) => r.dia)) - 4, hi = Math.max(150, ...rows.map((r) => r.sys)) + 4, y = sc(lo, hi, H - 22, 8), bw = Math.max(1.6, Math.min(6, ((W0 - 40) / n) * 0.36));
  const roll = []; for (let d = n - 1; d >= 0; d--) { const endT = now - d * 864e5, w = all.filter((r) => toMs(r.t) > endT - 7 * 864e5 && toMs(r.t) <= endT); if (w.length >= 4) roll.push([x(endT), y(mean(w.map((r) => r.sys))), y(mean(w.map((r) => r.dia)))]); }
  const am = (r) => +r.t.slice(11, 13) < 12;
  const body = [80, 130].map((v) => `<line x1="30" x2="${W0 - 6}" y1="${y(v)}" y2="${y(v)}" stroke="${css("--watch")}" stroke-opacity=".6"/><text x="26" y="${y(v) + 4}" text-anchor="end" class="axis">${v}</text>`).join("")
    + [100, 140].filter((v) => v > lo && v < hi).map((v) => `<line x1="30" x2="${W0 - 6}" y1="${y(v)}" y2="${y(v)}" stroke="${css("--grid")}"/><text x="26" y="${y(v) + 4}" text-anchor="end" class="axis">${v}</text>`).join("")
    + rows.map((r) => `<line x1="${x(toMs(r.t)).toFixed(1)}" x2="${x(toMs(r.t)).toFixed(1)}" y1="${y(r.sys)}" y2="${y(r.dia)}" stroke="${css("--heart")}" stroke-width="${bw.toFixed(1)}" stroke-linecap="round" opacity="${am(r) ? 0.9 : 0.5}"/>`).join("")
    + (roll.length >= 2 ? `<path d="${smooth(roll.map((p) => [p[0], p[1]]), 0.12)}" fill="none" stroke="${css("--ink")}" stroke-width="1.8" opacity=".75"/><path d="${smooth(roll.map((p) => [p[0], p[2]]), 0.12)}" fill="none" stroke="${css("--ink")}" stroke-width="1.8" opacity=".45"/>` : "")
    + [n, n / 2, 0].map((d, i) => { const dt = new Date(now - d * 864e5); return `<text x="${x(now - d * 864e5)}" y="${H - 4}" text-anchor="${["start", "middle", "end"][i]}" class="axis">${d === 0 ? "today" : `${MON[dt.getMonth()]} ${dt.getDate()}`}</text>`; }).join("");
  // Band estimate vs cuff: pair each cuff reading with the band's nearest BP estimate (±60 min).
  const pairs = all.map((r) => { const t = toMs(r.t); let best = null; for (const b of D.bandBp) { const d = Math.abs(toMs(b.t) - t); if (d <= 3600e3 && (!best || d < best.d)) best = { ...b, d }; } return best ? { cuff: r.sys, band: best.sys } : null; }).filter(Boolean);
  let cmp = "";
  if (pairs.length >= 3) {
    const diffs = pairs.map((p) => p.band - p.cuff), bias = mean(diffs), sdd = sd(diffs) ?? 0, maeBand = mean(diffs.map(Math.abs));
    const seq = all.map((r) => r.sys), maeLast = seq.length >= 2 ? mean(seq.slice(1).map((v, i) => Math.abs(v - seq[i]))) : null;
    const X = sc(0, Math.max(maeBand, maeLast ?? 0) * 1.15 || 1, 0, 170);
    cmp = `<div class="card rise" style="--i:7"><div class="lbl" style="margin-bottom:10px">Can the band estimate your BP?</div>
      <div class="cmp"><div><span>Band's estimate</span>${S(170, 12, `<rect x="0" y="2" width="${X(maeBand)}" height="8" rx="4" fill="${css("--bad")}" opacity=".8"/>`)}<b>${maeBand.toFixed(1)}</b></div>
        ${maeLast != null ? `<div><span>Your previous cuff reading</span>${S(170, 12, `<rect x="0" y="2" width="${X(maeLast)}" height="8" rx="4" fill="${css("--good")}" opacity=".8"/>`)}<b>${maeLast.toFixed(1)}</b></div>` : ""}</div>
      <p class="note">Average miss in systolic mmHg over ${pairs.length} readings paired with the band's own estimate. The band reads ${Math.abs(bias).toFixed(0)} mmHg ${bias < 0 ? "low" : "high"} on average (95% within ${(bias - 1.96 * sdd).toFixed(0)} to ${(bias + 1.96 * sdd).toFixed(0)}). Pulse shows cuff numbers only; the AHA advises against cuffless readings for diagnosis.</p></div>`;
  }
  const first = all[0], diff = sum && toMs(first.t) < now - 21 * 864e5 ? sum.sys - mean(all.filter((r) => toMs(r.t) < toMs(first.t) + 7 * 864e5).map((r) => r.sys)) : null;
  return `<div class="card rise" style="--i:6"><div class="bp-h"><div><div class="lbl">Home average · last 7 days</div><div class="num big2">${sum ? `${sum.sys.toFixed(0)}<span class="slash">/</span>${sum.dia.toFixed(0)}` : "—"}<small>mmHg</small></div></div>${cat ? `<span class="badge ${cat[1]}">${cat[0]}</span>` : ""}</div>
      <div class="agg">${[["14", "2W"], ["30", "30D"], ["90", "90D"]].map(([k, l]) => `<button data-bpagg="${k}" class="${st.bpAgg === k ? "on" : ""}">${l}</button>`).join("")}</div>
      ${rows.length ? scrubbable(uid("s"), W0, H, body, rows.map((r) => [x(toMs(r.t)), y(r.sys), `${recWhen(r.t)} · <b>${r.sys}/${r.dia}</b>${r.pulse ? ` · pulse ${r.pulse}` : ""}`]), `Bars: each cuff reading, systolic to diastolic (morning solid).${roll.length >= 2 ? " Lines: 7-day averages." : ""}`) : `<p class="note">No readings in this window.</p>`}
      <div class="stat3"><div><b>${diff != null ? sign(diff, 0) : "—"}</b><span>systolic vs first week</span></div><div><b>${all.filter((r) => toMs(r.t) >= now - 7 * 864e5).length}</b><span>readings this week</span></div><div><b>${all.length}</b><span>readings logged</span></div></div>
      <p class="note">${sum ? "" : "The average appears after 2 readings. "}ACC/AHA home thresholds: stage 1 from 130/80, stage 2 from 135/85.</p>
      <button class="cta ghost" data-sheet="bp" style="margin-top:6px">Log a reading</button></div>${cmp}`;
}

export function measure(ctx) {
  const lastSn = D.ecg[D.ecg.length - 1], E = lastSn && analyzed(lastSn) ? analyze(lastSn) : null;
  const ecgIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 13h4l2-5 3 10 3-13 2 8h6"/></svg>`;
  const bpIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="7"/><path d="M12 13l3-3M12 6V4M9 3h6"/></svg>`;
  const bandName = ctx.band?.name ?? D.band?.name;
  return `${header("ECG · blood pressure · labs", "Measure", `<button class="hchip btn ${ctx.band?.connected ? "on" : ""}" data-syncchip><i></i><span>${ctx.band?.connected ? esc(bandName ?? "Connected") : "Connect"}</span></button>`)}
    <div class="acts rise" style="--i:1">
      <div class="card act" style="--tint:${css("--heart")}"><span class="act-i">${ecgIcon}</span><b>Heart rhythm</b><span>30 s – 2 min, finger on the silver plate</span><button class="cta" data-record>Start</button></div>
      <div class="card act" style="--tint:${css("--spo2")}"><span class="act-i">${bpIcon}</span><b>Blood pressure</b><span>Log a reading from your home cuff</span><button class="cta" data-sheet="bp">Log</button></div>
    </div>
    ${E ? `<button class="card latest rise" style="--i:2" data-rec="${esc(lastSn.t)}"><span class="pulse-dot ${E.verdict[1]}"></span><span class="lt-t"><span class="lbl">Latest · ${recWhen(lastSn.t)}</span><b>${E.verdict[0]}</b><span>${E.s?.hrv ? `${E.s.hrv.hr.toFixed(0)} bpm · HRV ${E.s.hrv.rmssd.toFixed(0)} ms` : ""}${E.mb?.qtcF ? ` · QTc ${E.mb.qtcF.toFixed(0)} ms` : ""}${E.edrOk ? ` · breathing ${E.edr.rate.toFixed(1)}/min` : ""}</span></span><span class="chev">›</span></button>` : ""}
    ${D.ecg.length ? `<div class="sec rise" style="--i:3"><h2>Rhythm checks over time</h2><span class="lbl">${D.ecg.length} recording${D.ecg.length > 1 ? "s" : ""}</span></div>${ecgHistory()}<div class="sec rise" style="--i:4"><h2>Recordings</h2><span class="lbl">tap to open</span></div>${recList()}` : `<div class="sec rise" style="--i:3"><h2>Rhythm checks</h2></div>${empty("No recordings yet", "A 30-second check shows your rhythm, heart rate and HRV. Morning checks, seated and before coffee, are the most comparable over time.", 3)}`}
    <div class="sec rise" style="--i:5"><h2>Blood pressure over time</h2><span class="lbl">home cuff</span></div>
    ${bpSection()}
    ${labsBlock(ctx)}
    <p class="note foot">A screening tool, not a diagnosis. Everything is analysed and stored on this phone.</p>`;
}
export { bpCategory, bpSummary };
