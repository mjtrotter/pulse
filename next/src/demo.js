// 30 days of synthetic data for ?demo (separate database). Deterministic, and shaped like a real
// 58-year-old wearer: a regular-ish sleeper with one late night, a mild illness 10-12 days ago,
// evening walks and two strength sessions a week.
import * as db from "./core/db.js?v=20260924145338";
import { ecgSummary, ECG_FS } from "./analytics/ecg.js?v=20260924145338";
import { stamp } from "./core/time.js?v=20260924145338";

const BAND = "DEMO";

export async function seedDemo(store) {
  if ((await db.counts(store)).hr) return false;
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return (u - 3) / Math.sqrt(0.5); };
  const now = new Date();
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const D = 30;
  const hr = [], sleep = [], spo2 = [], temp = [], hrv = [], activity = [], daily = [], ppi = [];

  for (let k = D; k >= 0; k--) {
    // Night ending on day `k` days ago.
    const wakeDay = new Date(today0.getFullYear(), today0.getMonth(), today0.getDate() - k);
    const ill = k >= 10 && k <= 12, late = k === 4, short = k === 17;
    const onsetMin = 23 * 60 + gauss() * 22 + (late ? 95 : 0) + (wakeDay.getDay() === 6 || wakeDay.getDay() === 0 ? 35 : 0);
    const durMin = Math.round(425 + gauss() * 28 - (late ? 70 : 0) - (short ? 110 : 0) + (ill ? 25 : 0));
    const onset = new Date(wakeDay.getTime() - 24 * 3600e3 + onsetMin * 60e3);
    const wake = new Date(onset.getTime() + durMin * 60e3);
    const rhrBase = 57 + (ill ? 5 : 0) + (late ? 6 : 0) + gauss() * 1.2;
    // Stages: ~90-min cycles, deep early, REM late; brief awakenings.
    const lead = 6 + Math.round(rnd() * 10);
    for (let m = -lead; m < durMin; m++) {
      const t = new Date(onset.getTime() + m * 60e3);
      let st;
      if (m < 0) st = m === -lead ? 15 : 4;
      else {
        const cyc = Math.floor(m / 92), ph = (m % 92) / 92, lateFrac = m / durMin;
        const deepEnd = Math.max(0.12, 0.5 - cyc * 0.11 - (late ? 0.12 : 0));
        const remStart = 0.78 - Math.min(0.3, lateFrac * 0.35);
        st = ph < 0.1 ? 2 : ph < deepEnd ? 1 : ph < remStart ? 2 : 3;
        if (rnd() < (ill || late ? 0.022 : 0.009)) st = 4;
      }
      sleep.push({ band: BAND, t: stamp(t), stage: st });
    }
    // Overnight HR every 30 s: falls to a nadir ~40% into the night (later on a bad night), then rises.
    const nadirAt = late ? 0.75 : 0.4;
    for (let m = 0; m < durMin; m += 0.5) {
      const f = m / durMin;
      const shape = f < nadirAt ? 8 * (1 - f / nadirAt) : 5 * ((f - nadirAt) / (1 - nadirAt));
      const bpm = rhrBase + shape + gauss() * 1.6 + (rnd() < 0.01 ? 8 : 0);
      hr.push({ band: BAND, t: stamp(new Date(onset.getTime() + m * 60e3)), bpm: Math.round(bpm), source: "auto" });
      if (m % 10 === 0) {
        const tt = stamp(new Date(onset.getTime() + m * 60e3));
        spo2.push({ band: BAND, t: tt, pct: Math.min(100, Math.round(97.2 + gauss() * 1 - (rnd() < 0.04 ? 3 : 0))) });
        temp.push({ band: BAND, t: tt, c: Math.round((34.7 + (ill ? 0.55 : 0) + (late ? 0.25 : 0) + gauss() * 0.18 + Math.min(1, m / 60) * 0.4 - 0.4) * 10) / 10 });
        // A pulse-interval burst like the band's (~80 s, RSA swing, a little optical noise).
        const rr0 = 60000 / (rhrBase + shape), amp = Math.max(6, 22 - (ill ? 8 : 0) - (late ? 9 : 0) + gauss() * 3), br = 4.1 + gauss() * 0.3 - (ill ? 0.6 : 0);
        const burst = [];
        for (let i = 0, acc = 0; acc < 80000; i++) { const v = Math.round(rr0 + amp * Math.sin((2 * Math.PI * i) / br) + gauss() * 6); burst.push(v); acc += v; }
        ppi.push({ band: BAND, t: tt, page: 0, pages: burst.length > 56 ? 2 : 1, ppi: burst.slice(0, 56) });
        if (burst.length > 56) ppi.push({ band: BAND, t: tt, page: 1, pages: 2, ppi: burst.slice(56) });
        hrv.push({ band: BAND, t: tt, hrv_ms: Math.max(12, Math.round(41 - (ill ? 9 : 0) - (late ? 11 : 0) + gauss() * 6)), vascular_aging: 0,
          hr: Math.round(rhrBase + 3), stress: 30, bp_sys: Math.round(117 + gauss() * 5), bp_dia: Math.round(75 + gauss() * 4) });
      }
    }
    if (k === 0) continue; // today: only the night so far, plus the morning below
    // Day `k` days ago, from wake until next onset (approx 22:50).
    const day = wakeDay;
    const walkAt = 17.5 + gauss() * 0.4, walks = !ill && rnd() > 0.2;
    const strength = !ill && (day.getDay() === 2 || day.getDay() === 4);
    let stepsTotal = 0;
    const wakeH = (wake - day) / 3600e3;
    for (let bin = 0; bin < 144; bin++) {
      const hh = bin / 6;
      let steps = 0;
      if (hh >= wakeH && hh < 22.8) {
        const busy = hh > 8 && hh < 12 ? 1.4 : hh > 13 && hh < 17 ? 1.1 : 0.6;
        steps = Math.max(0, Math.round((rnd() < 0.55 ? rnd() * 140 * busy : 0) * (ill ? 0.4 : 1)));
        if (walks && hh >= walkAt && hh < walkAt + 0.7) steps = Math.round(1050 + gauss() * 90);
      }
      stepsTotal += steps;
      if (steps) activity.push({ band: BAND, t: stamp(new Date(day.getTime() + bin * 600e3)), steps, minute: splitMinutes(steps, rnd) });
    }
    daily.push({ band: BAND, date: stamp(day).slice(0, 10), steps: stepsTotal, sport: 0, km: Math.round(stepsTotal * 0.074) / 100, kcal: Math.round(stepsTotal * 4) / 100 });
    for (let m = Math.ceil(wakeH * 60); m < 22.8 * 60; m += 0.5) {
      const hh = m / 60;
      let bpm = 70 + 6 * Math.sin(((hh - 9) / 24) * 2 * Math.PI) + gauss() * 2.5 + (ill ? 4 : 0);
      if (walks && hh >= walkAt && hh < walkAt + 0.7) bpm = 104 + 8 * Math.sin((hh - walkAt) * 4) + gauss() * 3;
      if (walks && hh >= walkAt + 0.7 && hh < walkAt + 0.75) bpm = 104 - (hh - walkAt - 0.7) * 20 * 30;
      if (strength && hh >= 7.5 && hh < 8.3) bpm = 96 + ((m * 2) % 6 < 2 ? 30 : 8) + gauss() * 4;
      if (rnd() < 0.002) continue;
      hr.push({ band: BAND, t: stamp(new Date(day.getTime() + m * 60e3)), bpm: Math.round(bpm), source: "auto" });
      if (m % 30 === 0) {
        const tt = stamp(new Date(day.getTime() + m * 60e3));
        spo2.push({ band: BAND, t: tt, pct: Math.min(100, Math.round(97.6 + gauss() * 0.8)) });
      }
      if (m % 10 === 0) temp.push({ band: BAND, t: stamp(new Date(day.getTime() + m * 60e3)), c: Math.round((32.4 + gauss() * 0.6) * 10) / 10 });
    }
  }
  // This morning since waking.
  const lastWake = sleep[sleep.length - 1].t;
  const w0 = new Date(lastWake.replace(" ", "T"));
  for (let t = w0.getTime(); t < now.getTime(); t += 30e3) {
    const hh = new Date(t).getHours() + new Date(t).getMinutes() / 60;
    hr.push({ band: BAND, t: stamp(new Date(t)), bpm: Math.round(68 + 5 * Math.sin(((hh - 9) / 24) * 2 * Math.PI) + gauss() * 2.5), source: "auto" });
  }
  let todaySteps = 0;
  for (let t = today0.getTime(); t < now.getTime(); t += 600e3) {
    const hh = new Date(t).getHours();
    const steps = t < w0.getTime() ? 0 : Math.round(rnd() * 160 * (hh > 8 && hh < 12 ? 1.3 : 0.7));
    todaySteps += steps;
    if (steps) activity.push({ band: BAND, t: stamp(new Date(t)), steps, minute: splitMinutes(steps, rnd) });
  }
  daily.push({ band: BAND, date: stamp(today0).slice(0, 10), steps: todaySteps, sport: 0, km: Math.round(todaySteps * 0.074) / 100, kcal: Math.round(todaySteps * 4) / 100 });

  for (const [store_, rows] of [["hr", hr], ["sleep", sleep], ["spo2", spo2], ["temp", temp], ["hrv_vendor", hrv], ["activity", activity], ["daily", daily], ["ppi", ppi]]) {
    await db.insert(store, store_, rows);
  }
  // Home blood-pressure log.
  const bp = [];
  for (const [k, hrs, s, d, p] of [[13, 7.5, 128, 82, 64], [13, 20, 124, 80, 66], [9, 7.4, 131, 84, 62], [9, 20.5, 126, 81, 67], [5, 7.6, 127, 83, 61], [5, 21, 123, 79, 65], [1, 7.3, 129, 82, 60], [1, 20.2, 125, 80, 66]]) {
    bp.push({ t: stamp(new Date(today0.getTime() - k * 864e5 + hrs * 3600e3)), sys: s, dia: d, pulse: p, arm: "left", note: "" });
  }
  await db.insert(store, "bp", bp);
  // Two rhythm checks (synthetic finger ECG).
  for (const [k, hrs] of [[6, 7.8], [1, 8.1]]) {
    const x = synthEcg(rnd, 0.86 + rnd() * 0.08);
    const res = ecgSummary(x, ECG_FS, 5);
    await db.put(store, "ecg", { band: BAND, t: stamp(new Date(today0.getTime() - k * 864e5 + hrs * 3600e3)), fs: ECG_FS, arrival_rate: 254, n: x.length,
      samples: Float32Array.from(x), result: { hrv: res.hrv, quality: res.quality, peaks: res.peaks, good: res.good } });
  }
  await db.put(store, "band", { mac: BAND, name: "JCV8B DEMO", firmware: "0.0.8.8", battery: 78,
    last_sync: stamp(new Date(now - 7 * 60e3)), snapshot: { steps: todaySteps, hr: 68, temp_c: 32.6 }, snapshot_at: stamp(new Date(now - 7 * 60e3)) });
  return true;
}

/** Spreads a 10-minute step count over its minutes: a brisk block is even, a pottering one lumpy. */
function splitMinutes(steps, rnd) {
  if (steps >= 800) return Array.from({ length: 10 }, (_, i) => Math.round(steps / 10 + (rnd() - 0.5) * 10));
  const w = Array.from({ length: 10 }, () => (rnd() < 0.4 ? rnd() : 0));
  w[0] = Math.max(w[0], 0.3);
  const tot = w.reduce((s, x) => s + x, 0);
  return w.map((x) => Math.round((steps * x) / tot));
}

function synthEcg(rnd, rr0) {
  const x = [], fs = ECG_FS;
  const g = (t, c, w, a) => a * Math.exp(-(((t - c) / w) ** 2));
  const beats = [];
  for (let b = 0.4; b < 35; b += rr0 + 0.05 * Math.sin(b * 1.5) + (rnd() - 0.5) * 0.035) beats.push(b);
  for (let i = 0; i < 35 * fs; i++) {
    const t = i / fs;
    let v = 0.25 * Math.sin(t * 0.6) + (rnd() - 0.5) * 0.05;
    for (const b of beats) if (Math.abs(t - b) < 0.5) v += g(t, b - 0.16, 0.025, 0.1) + g(t, b, 0.012, 1.05) - g(t, b + 0.03, 0.012, 0.25) + g(t, b + 0.26, 0.05, 0.24);
    x.push(v);
  }
  return x;
}
