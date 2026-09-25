// Synthetic finger-lead ECG for the concept (no real recordings ever ship in a public page).
// Beat timing: mean RR with respiratory sinus arrhythmia, a 0.1 Hz Mayer wave and jitter.
// Waveform: a sum of Gaussians per beat (P, Q, R, S, T; after McSharry 2003), with QT scaled by √RR,
// breathing-modulated R amplitude and baseline, one premature wide beat, and sensor noise.

export function synthEcg({ seconds = 125, fs = 256, hr = 62, breath = 13.8, seed = 13, rsa = 0.021, pvcAt = 66 } = {}) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return (u - 3) / Math.sqrt(0.5); };
  const fr = breath / 60, rr0 = 60 / hr;
  const beats = [];
  let t = 0.4, ar = 0;
  while (t < seconds - 0.8) {
    ar = 0.975 * ar + gauss() * 0.0085;
    let rr = rr0 + rsa * Math.sin(2 * Math.PI * fr * t) + 0.024 * Math.sin(2 * Math.PI * 0.085 * t + 1.1) + ar;
    const pvc = beats.length === pvcAt;
    if (pvc) rr = rr0 * 0.62;
    beats.push({ t, rr, pvc });
    t += pvc ? rr : rr;
    if (pvc) { beats.push({ t, rr: rr0 * 1.38, pvc: false, post: true }); t += rr0 * 1.38; }
  }
  const n = Math.round(seconds * fs), x = new Float64Array(n);
  const wave = (i0, center, amp, w) => { const a = Math.max(0, Math.floor((center - 4 * w) * fs)), b = Math.min(n, Math.ceil((center + 4 * w) * fs)); for (let i = a; i < b; i++) { const d = i / fs - center; x[i] += amp * Math.exp(-(d * d) / (2 * w * w)); } };
  for (const b of beats) {
    const k = Math.sqrt(Math.max(0.4, b.rr)), resp = 1 + 0.09 * Math.sin(2 * Math.PI * fr * b.t + 0.6);
    if (b.pvc) { wave(0, b.t, 0.95, 0.03); wave(0, b.t + 0.07, -0.35, 0.03); wave(0, b.t + 0.32, -0.3, 0.07); continue; }
    wave(0, b.t - 0.16 * k, 0.07, 0.024);
    wave(0, b.t - 0.026, -0.06, 0.008);
    wave(0, b.t, 0.62 * resp * (1 + gauss() * 0.035), 0.0105);
    wave(0, b.t + 0.03, -0.13 * resp, 0.011);
    wave(0, b.t + 0.3 * k, 0.17, 0.05);
  }
  for (let i = 0; i < n; i++) {
    const tt = i / fs;
    x[i] += 0.05 * Math.sin(2 * Math.PI * fr * tt) + 0.03 * Math.sin(2 * Math.PI * 0.04 * tt + 2) + gauss() * 0.008;
  }
  // a short movement burst (the kind a finger shift makes)
  for (let i = Math.round(92 * fs); i < Math.round(93.1 * fs); i++) x[i] += gauss() * 0.12 + 0.2 * Math.sin(i / 9);
  return { x: Array.from(x), fs, beats };
}
