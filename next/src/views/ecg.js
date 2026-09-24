// Rhythm check: a finger ECG on the band's outer plate (≈ Lead I, ~256 Hz).
// Result states the rhythm first (regular / irregular / inconclusive), then heart rate and HRV.
// Inconclusive outside 50-120 bpm or with a noisy strip, as cleared consumer ECGs do. HRV measures are
// shown only when the recording is long enough to support them (Baek 2015: RMSSD from 30 s, pNN50 from
// 60 s, SDNN needs ~4 min).
import { bandpass, ecgPeaks, ecgSummary, ECG_FS } from "../analytics/ecg.js?v=20260924145338";
import * as db from "../core/db.js?v=20260924145338";
import { clock, relTime, stamp } from "../core/time.js?v=20260924145338";
import { card, cardHead, chip, detailHeader, row, section, segmented, sheet, toast } from "../ui/components.js?v=20260924145338";
import { h, icon } from "../ui/h.js?v=20260924145338";
import { dateShort } from "./common.js?v=20260924145338";

const SETTLE = 5;
let duration = 30;
let running = null; // {stop: bool}

/** Classifies a stored or fresh session. */
export function verdict(session) {
  const r = session.result, hv = r?.hrv;
  const secs = (session.n ?? 0) / (session.fs ?? ECG_FS) - SETTLE;
  if (!hv || (r.quality ?? 0) < 0.7) return { key: "noisy", label: "Inconclusive", sub: "Too much noise to read the rhythm", kind: "" , secs };
  if (hv.hr < 50 || hv.hr > 120) return { key: "range", label: "Inconclusive", sub: `Heart rate ${Math.round(hv.hr)} bpm is outside the 50–120 range this check can classify`, kind: "", secs };
  if (hv.irregular) return { key: "irregular", label: "Irregular rhythm", sub: "Beat-to-beat timing was irregular in this recording", kind: "watch", secs };
  return { key: "regular", label: "Regular rhythm", sub: "Beats arrived at a steady rhythm", kind: "good", secs };
}

/** Early beats: an interval < 80% of the local median followed by one > 115% (a premature beat and
 *  its pause). Common and usually harmless on their own; counted, never diagnosed. */
export function earlyBeats(peaks, fs = ECG_FS) {
  const rr = peaks.slice(1).map((p, i) => ((p - peaks[i]) * 1000) / fs);
  let n = 0;
  for (let i = 2; i + 3 < rr.length; i++) {
    const loc = [...rr.slice(i - 2, i), ...rr.slice(i + 2, i + 4)].sort((a, b) => a - b);
    const med = (loc[1] + loc[2]) / 2;
    if (rr[i] < 0.8 * med && rr[i + 1] > 1.15 * med) { n++; i++; }
  }
  return n;
}

export default async function ecg(ctx) {
  const sessions = (await db.all(ctx.store, "ecg")).sort((a, b) => (a.t < b.t ? 1 : -1));
  const screen = h("div.screen", detailHeader(() => { if (running) running.stop = true; ctx.back(); }),
    h("header.head", h("div.titles", h("span.eyebrow", "30-second ECG"), h("h1", "Rhythm check"))));

  const canvas = h("canvas.ecg-canvas", { height: 190 });
  const status = h("p.note", { style: { textAlign: "center", minHeight: "22px" } });
  const clockEl = h("b", "0 s"), bpmEl = h("span");
  const progress = h("i", { style: { width: "0%" } });
  const live = card(h("div.ecg-head", clockEl, bpmEl), canvas, h("div.progress", { style: { marginTop: "10px" } }, progress));
  live.hidden = true;
  const result = h("div");
  const startBtn = h("button.btn.primary.full", { type: "button" }, icon("ecg"), "Start");
  const connected = !!ctx.band?.connected;

  screen.append(card(
    h("ol.stepslist",
      h("li", "Sit down and rest both forearms on a table."),
      h("li", "Touch the ", h("strong", "silver plate on the outside of the band"), " lightly with a fingertip of your other hand."),
      h("li", "Stay still and quiet until it finishes.")),
    h("div", { style: { display: "flex", justifyContent: "center", marginBottom: "12px" } },
      segmented([[30, "30 seconds"], [120, "2 minutes"]], duration, (v) => { duration = v; ctx.refresh(); }, "Length")),
    startBtn, status));
  status.textContent = ctx.demo ? "Demo mode: showing saved recordings only." : connected ? "Ready when you are." : "Connect your band first.";
  startBtn.disabled = ctx.demo || !connected;
  if (!connected && !ctx.demo) {
    const cb = h("button.btn.full", { type: "button", style: { marginTop: "10px" } }, icon("bt"), "Connect band");
    cb.onclick = async () => { cb.disabled = true; if (await ctx.connect()) ctx.refresh(); else cb.disabled = false; };
    status.after(cb);
  }
  screen.append(live, result);

  startBtn.onclick = async () => {
    if (running) { running.stop = true; return; }
    const samples = [];
    let firstAt = null, lastAt = null, packets = 0, stoppedEarly = false;
    running = { stop: false };
    startBtn.replaceChildren("Stop");
    live.hidden = false; result.replaceChildren();
    status.textContent = "Waiting for your finger on the silver plate…";
    const total = SETTLE + duration;
    const t0 = Date.now();
    const tick = setInterval(() => {
      if (!firstAt) { if (Date.now() - t0 > 20e3) { running.stop = true; status.textContent = "No signal. Is your fingertip on the silver plate?"; } return; }
      const secs = (Date.now() - firstAt) / 1000;
      clockEl.textContent = `${Math.min(total, Math.floor(secs))} / ${total} s`;
      progress.style.width = `${Math.min(100, (100 * secs) / total)}%`;
      status.textContent = secs < SETTLE ? "Settling… keep still" : "Recording… keep still";
      const tail = samples.slice(-8 * ECG_FS);
      if (tail.length >= 4 * ECG_FS) {
        const { peaks } = ecgPeaks(tail);
        if (peaks.length > 2) bpmEl.textContent = `${Math.round((60 * ECG_FS * (peaks.length - 1)) / (peaks[peaks.length - 1] - peaks[0]))} bpm`;
      }
      if (secs >= total) running.stop = true;
      // The band streams only while a finger touches the plate (verified: 170 s continuous, 2026-09-24).
      // A short lift pauses it; warn, then finish with what we have after 6 s without signal.
      const quiet = lastAt ? Date.now() - lastAt : 0;
      if (quiet > 1500) status.textContent = "Keep your fingertip on the silver plate…";
      if (quiet > 6000) { running.stop = true; stoppedEarly = secs < total - 2; }
    }, 500);
    let frame = 0;
    const draw = () => { if (!running) return; if (frame++ % 2 === 0 && samples.length > 64) drawEcg(canvas, bandpass(samples.slice(-4 * ECG_FS))); requestAnimationFrame(draw); };
    requestAnimationFrame(draw);
    try {
      await ctx.band.ecg((mv) => { if (!firstAt) { firstAt = Date.now(); ctx.log("ECG signal"); } lastAt = Date.now(); packets++; samples.push(...mv); },
        () => running.stop, total + 25);
    } catch (e) { ctx.log(`ECG stopped: ${e.message}`, true); }
    finally { clearInterval(tick); running = null; startBtn.replaceChildren(icon("ecg"), "Start again"); }
    const rate = packets > 1 ? samples.length / ((lastAt - firstAt) / 1000) : 0;
    ctx.log(`ECG ended: ${samples.length} samples, ≈${rate.toFixed(0)}/s`);
    if (samples.length < (SETTLE + 10) * ECG_FS) { status.textContent = samples.length ? "Too short to read. Keep your finger on until it finishes." : status.textContent; return; }
    const res = ecgSummary(samples, ECG_FS, SETTLE);
    const session = { band: ctx.mac ?? "unknown", t: stamp(), fs: ECG_FS, arrival_rate: rate, n: samples.length, samples: Float32Array.from(samples),
      result: { hrv: res.hrv, quality: res.quality, peaks: res.peaks, good: res.good } };
    await db.put(ctx.store, "ecg", session);
    status.textContent = stoppedEarly ? `Your finger left the plate, so the recording stopped after ${Math.round(samples.length / ECG_FS)} seconds. Saved on this phone.` : "Saved on this phone.";
    if (stoppedEarly) ctx.log(`ECG: signal stopped after ${(samples.length / ECG_FS).toFixed(0)} s`);
    result.replaceChildren(resultCard(session));
    requestAnimationFrame(() => showStrip(canvas, session));
  };

  if (sessions.length) {
    screen.append(section("Past checks"));
    screen.append(card(h("div.rows", sessions.slice(0, 30).map((sn) => {
      const v = verdict(sn);
      return row({ label: `${dateShort(sn.t.slice(0, 10))} · ${clock(sn.t)}`, sub: sn.result?.hrv ? `${Math.round(sn.result.hrv.hr)} bpm · HRV ${Math.round(sn.result.hrv.rmssd)} ms` : v.sub,
        trailing: chip(v.key === "regular" ? "Regular" : v.key === "irregular" ? "Irregular" : "Unclear", v.kind), onClick: () => openSession(sn) });
    }))));
  }
  screen.append(h("p.fine", "A screening check, not a diagnosis. Movement, a loose band or a pressing finger can make a strip look irregular; repeat it seated and still. If irregular results keep appearing, show them to your doctor."));
  return screen;
}

function resultCard(sn) {
  const v = verdict(sn), hv = sn.result?.hrv;
  const secs = Math.round(v.secs);
  const rows = [];
  if (hv && v.key !== "noisy") {
    rows.push(row({ label: "Heart rate", value: Math.round(hv.hr), unit: "bpm" }));
    rows.push(row({ label: "HRV (RMSSD)", sub: "Beat-to-beat variation; compare with your own mornings", value: Math.round(hv.rmssd), unit: "ms" }));
    if (secs >= 60) rows.push(row({ label: "pNN50", value: `${Math.round(hv.pnn50)}%` }));
    if (secs >= 240) rows.push(row({ label: "SDNN", value: Math.round(hv.sdnn), unit: "ms" }));
    const eb = earlyBeats(sn.result.peaks, sn.fs);
    rows.push(row({ label: "Extra beats", sub: eb ? "Early beats are common and usually harmless on their own" : "None seen in this recording", value: eb }));
  }
  rows.push(row({ label: "Signal quality", sub: `${secs} seconds analysed`, value: `${Math.round((sn.result?.quality ?? 0) * 100)}%` }));
  return card(
    h("div", { style: { display: "flex", alignItems: "center", gap: "12px", marginBottom: "6px" } },
      h("span", { style: { width: "44px", height: "44px", borderRadius: "14px", display: "grid", placeItems: "center", flex: "none",
        background: v.kind === "good" ? "var(--good-bg)" : v.kind === "watch" ? "var(--watch-bg)" : "var(--surface-2)",
        color: v.kind === "good" ? "var(--good)" : v.kind === "watch" ? "var(--watch)" : "var(--ink-3)" } }, icon(v.kind === "good" ? "check" : v.kind === "watch" ? "alert" : "info")),
      h("div", h("h2", { style: { fontSize: "20px" } }, v.label), h("p.cap", v.sub))),
    h("div.rows", rows),
    v.key === "irregular" ? h("p.note", { style: { marginTop: "8px" } }, "Repeat the check seated and still. If it keeps showing an irregular rhythm, share these recordings with your doctor; an irregular rhythm such as atrial fibrillation is common after 60 and very treatable.") : null);
}

function openSession(sn) {
  const canvas = h("canvas.ecg-canvas", { height: 190 });
  sheet(`${dateShort(sn.t.slice(0, 10))} · ${clock(sn.t)}`, canvas, h("p.fine", { style: { textAlign: "left", padding: "4px 0 10px" } }, "8 seconds from the middle of the recording"), resultCard(sn));
  requestAnimationFrame(() => showStrip(canvas, sn));
}

function showStrip(canvas, sn) {
  const x = Array.from(sn.samples).slice(SETTLE * sn.fs);
  const mid = Math.max(0, Math.floor(x.length / 2 - 4 * sn.fs));
  const strip = bandpass(x).slice(mid, mid + 8 * sn.fs);
  drawEcg(canvas, strip, { peaks: (sn.result?.peaks ?? []).filter((p) => p >= mid && p < mid + 8 * sn.fs).map((p) => p - mid) });
}

export function drawEcg(canvas, x, { peaks = [], fs = ECG_FS } = {}) {
  const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth || 340, H = 190;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement);
  g.fillStyle = css.getPropertyValue("--surface-2"); g.fillRect(0, 0, W, H);
  // ECG-paper grid: fine line every 0.2 s, stronger every second.
  const secs = x.length / fs;
  for (let t = 0; t <= secs + 1e-9; t += 0.2) {
    const px = Math.round((t / secs) * W) + 0.5;
    g.strokeStyle = css.getPropertyValue(Math.abs(t - Math.round(t)) < 1e-6 ? "--line-2" : "--line"); g.lineWidth = 1;
    g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H); g.stroke();
  }
  if (x.length < 2) return;
  const sorted = [...x].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.005)], hi = sorted[Math.ceil(sorted.length * 0.995) - 1];
  const span = Math.max(hi - lo, 0.2), pad = span * 0.15;
  const y = (v) => H - 10 - ((v - (lo - pad)) / (span + 2 * pad)) * (H - 20);
  g.strokeStyle = css.getPropertyValue("--heart"); g.lineWidth = 2; g.lineJoin = "round"; g.lineCap = "round";
  g.beginPath();
  x.forEach((v, i) => { const px = (i / (x.length - 1)) * W; i ? g.lineTo(px, y(v)) : g.moveTo(px, y(v)); });
  g.stroke();
  g.fillStyle = css.getPropertyValue("--ink-3");
  for (const p of peaks) { const px = (p / (x.length - 1)) * W; g.beginPath(); g.arc(px, 9, 3, 0, 7); g.fill(); }
}

export { relTime, toast };
