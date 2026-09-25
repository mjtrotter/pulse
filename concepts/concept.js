// Pulse v3 concept: dashboard + drill-down in three visual directions. Synthetic data only.
const $ = (s, r = document) => r.querySelector(s);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const root = document.documentElement;

// ---------- synthetic data (deterministic) ----------
let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return (u - 3) / Math.sqrt(0.5); };
const ONSET = 23 * 60 + 8, WAKE = 30 * 60 + 41; // minutes from previous midnight
const NIGHT = WAKE - ONSET;
const stages = [];
for (let m = 0; m < NIGHT; m++) {
  const cyc = Math.floor(m / 94), ph = (m % 94) / 94;
  const deepEnd = Math.max(0.12, 0.5 - cyc * 0.12), remStart = 0.76 - Math.min(0.28, (m / NIGHT) * 0.32);
  let s = ph < 0.1 ? 2 : ph < deepEnd ? 1 : ph < remStart ? 2 : 3;
  if (rnd() < 0.012) s = 4;
  stages.push(s);
}
const hr = Array.from({ length: NIGHT }, (_, m) => { const f = m / NIGHT; return 60 + (f < 0.38 ? 9 * (1 - f / 0.38) : 5 * ((f - 0.38) / 0.62)) + gauss() * 1.4; });
const bursts = [];
for (let m = 6; m < NIGHT; m += 10) {
  const f = m / NIGHT, clean = rnd() > 0.07;
  bursts.push({ m, rmssd: 36 + 7 * Math.sin(f * 3.1) + gauss() * 3.2, br: 15.2 + gauss() * 0.6, spo2: Math.min(100, Math.round(97.3 + gauss() * 0.9 - (rnd() < 0.05 ? 2.5 : 0))),
    temp: 34.2 + 1.05 * Math.min(1, f * 3) + gauss() * 0.07, ok: clean, beats: 84 + Math.round(gauss() * 6), irregular: false });
}
const good = bursts.filter((b) => b.ok);
const median = (v) => { const a = [...v].sort((x, y) => x - y); const n = a.length >> 1; return a.length % 2 ? a[n] : (a[n - 1] + a[n]) / 2; };
const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
const sd = (v) => { const m = mean(v); return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1)); };
const tonight = { hrv: median(good.map((b) => b.rmssd)), rhr: 60.6, br: median(good.map((b) => b.br)), spo2: median(bursts.map((b) => b.spo2)), spo2min: Math.min(...bursts.map((b) => b.spo2)), temp: 0.12 };

// 365 nights of history with drivers: sleep hours, alcohol, late workout, temperature deviation.
const hist = [];
const today = new Date(2026, 8, 24);
for (let i = 364; i >= 0; i--) {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
  const dow = d.getDay();
  const sleepH = 7.3 + gauss() * 0.55 - (dow === 1 ? 0.35 : 0) + (dow === 0 || dow === 6 ? 0.3 : 0);
  const alcohol = rnd() < ((dow === 5 || dow === 6) ? 0.3 : 0.06), late = rnd() < 0.14, ill = i > 60 && i < 64;
  const tdev = gauss() * 0.1 + (ill ? 0.55 : 0) + (alcohol ? 0.15 : 0);
  const season = 2 * Math.sin((i / 365) * 2 * Math.PI);
  const hrv = 38 + 4.2 * (sleepH - 7.3) - (alcohol ? 7 : 0) - (late ? 3 : 0) - (ill ? 9 : 0) + season + gauss() * 3.4;
  const rhr = 59.5 - 1.1 * (sleepH - 7.3) + (alcohol ? 3.4 : 0) + (ill ? 5 : 0) - season * 0.3 + gauss() * 1.3;
  hist.push({ d, dow, sleepH, alcohol, late, tdev, hrv: i === 0 ? tonight.hrv : hrv, rhr: i === 0 ? tonight.rhr : rhr, br: 15.3 + gauss() * 0.45 + (ill ? 1.6 : 0), steps: Math.max(800, 6800 + gauss() * 2200) });
}
const stepsHour = Array.from({ length: 24 }, (_, h) => (h < 7 || h > 10 ? 0 : Math.round(rnd() * 900 + (h === 8 ? 700 : 0))));
// Your typical day (14-day average by hour), drawn faintly behind today.
const typicalHour = Array.from({ length: 24 }, (_, h) => (h < 7 || h > 22 ? 0 : Math.round(260 + 380 * Math.exp(-(((h - 12.5) / 3.2) ** 2)) + (h === 18 ? 820 : 0) + (h === 8 ? 300 : 0))));

// ---------- tiny SVG helpers ----------
const S = (w, h, body, extra = "") => `<svg viewBox="0 0 ${w} ${h}" ${extra}>${body}</svg>`;
const path = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
const scale = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
const glow = (id, color) => (css("--glow") === "1" ? `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` : "");
const useGlow = (id) => (css("--glow") === "1" ? `filter="url(#${id})"` : "");
const arc = (cx, cy, r, a0, a1) => { const p = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)]; const [x0, y0] = p(a0), [x1, y1] = p(a1); return `M${x0},${y0}A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1},${y1}`; };
const stageColor = (s) => css({ 1: "--deep", 2: "--light", 3: "--rem", 4: "--awake" }[s]);
const inst = () => root.dataset.dir === "instrument";

// ---------- dashboard ----------
function sleepArc(score, W = 124) {
  const c = W / 2, r = W * 0.4, a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, span = a1 - a0;
  let body = `<defs>${glow("gs", css("--sleep"))}</defs><path d="${arc(c, c, r, a0, a1)}" stroke="${css("--grid")}" stroke-width="${W * 0.072}" fill="none" stroke-linecap="round"/>`;
  // Stage segments along the arc, from bedtime to wake.
  let start = 0;
  for (let i = 1; i <= stages.length; i++) {
    if (i === stages.length || stages[i] !== stages[start]) {
      const s0 = a0 + (start / NIGHT) * span, s1 = a0 + (i / NIGHT) * span;
      body += `<path d="${arc(c, c, r, s0, Math.max(s0 + 0.004, s1 - 0.006))}" stroke="${stageColor(stages[start])}" stroke-width="${W * 0.072}" fill="none" ${useGlow("gs")}/>`;
      start = i;
    }
  }
  body += `<text x="${c}" y="${c + W * 0.03}" text-anchor="middle" class="num" style="font-size:${W * 0.29}px;fill:${css("--ink")}">${score}</text>`;
  body += `<text x="${c}" y="${c + W * 0.18}" text-anchor="middle" style="font-size:${Math.max(11, W * 0.085)}px;fill:${css("--ink3")}">7h 33m</text>`;
  return S(W, W, body);
}
function recoveryGauge(score, lo = 58, hi = 82, W = 124) {
  const c = W / 2, r = W * 0.4, a0 = Math.PI * 0.8, a1 = Math.PI * 2.2, span = a1 - a0;
  const at = (v) => a0 + (v / 100) * span;
  const zone = [[0, 55, "--bad"], [55, 70, "--watch"], [70, 100, "--good"]];
  let body = `<defs>${glow("gr", css("--good"))}</defs>`;
  for (const [z0, z1, col] of zone) body += `<path d="${arc(c, c, r, at(z0) + 0.02, at(z1) - 0.02)}" stroke="${css(col)}" stroke-opacity=".28" stroke-width="${W * 0.056}" fill="none"/>`;
  body += `<path d="${arc(c, c, r + W * 0.075, at(lo), at(hi))}" stroke="${css("--ink3")}" stroke-width="${Math.max(2, W * 0.016)}" fill="none" stroke-linecap="round"/>`;
  body += `<path d="${arc(c, c, r, a0, at(score))}" stroke="${css(score >= 70 ? "--good" : score >= 55 ? "--watch" : "--bad")}" stroke-width="${W * 0.056}" fill="none" stroke-linecap="round" ${useGlow("gr")}/>`;
  const p = [c + r * Math.cos(at(score)), c + r * Math.sin(at(score))];
  body += `<circle cx="${p[0]}" cy="${p[1]}" r="${W * 0.048}" fill="${css("--ink")}" stroke="${css("--bg")}" stroke-width="2.5"/>`;
  body += `<text x="${c}" y="${c + W * 0.05}" text-anchor="middle" class="num" style="font-size:${W * 0.29}px;fill:${css("--ink")}">${score}</text>`;
  body += `<text x="${c}" y="${c + W * 0.19}" text-anchor="middle" style="font-size:${Math.max(11, W * 0.085)}px;fill:${css("--ink3")}">usual ${lo}–${hi}</text>`;
  return S(W, W, body);
}
function activityClock(pct, W = 124) {
  const c = W / 2, r0 = W * 0.24, r1 = W * 0.45, max = Math.max(...stepsHour, ...typicalHour, 1);
  let body = `<defs>${glow("ga", css("--act"))}</defs><circle cx="${c}" cy="${c}" r="${r0 - 4}" fill="none" stroke="${css("--grid")}" stroke-width="1"/>`;
  for (let h = 0; h < 24; h++) {
    const a = -Math.PI / 2 + (h / 24) * Math.PI * 2, tl = typicalHour[h] ? 5 + (typicalHour[h] / max) * (r1 - r0 - 5) : 0;
    if (tl) { const q0 = [c + r0 * Math.cos(a), c + r0 * Math.sin(a)], q1 = [c + (r0 + tl) * Math.cos(a), c + (r0 + tl) * Math.sin(a)]; body += `<line x1="${q0[0]}" y1="${q0[1]}" x2="${q1[0]}" y2="${q1[1]}" stroke="${css("--ink3")}" stroke-opacity=".22" stroke-width="${W * 0.032}" stroke-linecap="round"/>`; }
    const len = stepsHour[h] ? 5 + (stepsHour[h] / max) * (r1 - r0 - 5) : 2;
    const p0 = [c + r0 * Math.cos(a), c + r0 * Math.sin(a)], p1 = [c + (r0 + len) * Math.cos(a), c + (r0 + len) * Math.sin(a)];
    body += `<line x1="${p0[0]}" y1="${p0[1]}" x2="${p1[0]}" y2="${p1[1]}" stroke="${stepsHour[h] ? css("--act") : css("--grid")}" stroke-width="${W * 0.032}" stroke-linecap="round" ${stepsHour[h] ? useGlow("ga") : ""}/>`;
  }
  const now = -Math.PI / 2 + (10.4 / 24) * Math.PI * 2;
  body += `<line x1="${c}" y1="${c}" x2="${c + (r0 - 8) * Math.cos(now)}" y2="${c + (r0 - 8) * Math.sin(now)}" stroke="${css("--ink3")}" stroke-width="1.5" stroke-linecap="round"/>`;
  body += `<text x="${c}" y="${c + W * 0.05}" text-anchor="middle" class="num" style="font-size:${W * 0.17}px;fill:${css("--ink")}">${pct}%</text>`;
  return S(W, W, body);
}

function montage() {
  const W = 300, H = 28, x = scale(0, NIGHT, 0, W);
  const rows = [];
  // Stage band: step line
  const lv = { 4: 2, 3: 6, 2: 13, 1: 22 };
  let st = "";
  let start = 0;
  for (let i = 1; i <= stages.length; i++) if (i === stages.length || stages[i] !== stages[start]) {
    st += `<rect x="${x(start)}" y="${lv[stages[start]]}" width="${Math.max(0.8, x(i) - x(start))}" height="${stages[start] === 4 ? 4 : 5}" rx="1.5" fill="${stageColor(stages[start])}"/>`; start = i;
  }
  rows.push(["Stages", S(W, H, st, 'preserveAspectRatio="none"'), `1h41 deep<small>1h47 REM</small>`]);
  const yh = scale(52, 74, H - 2, 2);
  rows.push(["Heart", S(W, H, `<path d="${path(hr.map((v, i) => [x(i), yh(v)]).filter((_, i) => i % 3 === 0))}" fill="none" stroke="${css("--heart")}" stroke-width="1.6"/>`, 'preserveAspectRatio="none"'), `low 58<small>at 2:59</small>`]);
  const yv = scale(20, 55, H - 3, 3);
  rows.push(["HRV", S(W, H, bursts.map((b) => `<circle cx="${x(b.m)}" cy="${yv(b.rmssd)}" r="${b.ok ? 2.3 : 1.6}" fill="${b.ok ? css("--hrv") : "none"}" stroke="${b.ok ? "none" : css("--ink3")}"/>`).join("")), `${tonight.hrv.toFixed(0)} ms<small>${good.length}/${bursts.length} clean</small>`]);
  const yb = scale(12, 19, H - 3, 3);
  rows.push(["Breath", S(W, H, `<path d="${path(good.map((b) => [x(b.m), yb(b.br)]))}" fill="none" stroke="${css("--breath")}" stroke-width="1.6"/>`, 'preserveAspectRatio="none"'), `${tonight.br.toFixed(1)}/min<small>±0.6</small>`]);
  const ys = scale(92, 100, H - 2, 2);
  rows.push(["SpO₂", S(W, H, `<line x1="0" x2="${W}" y1="${ys(95)}" y2="${ys(95)}" stroke="${css("--grid")}"/>` + bursts.map((b) => `<rect x="${x(b.m) - 1.2}" y="${ys(b.spo2) - 1.2}" width="2.4" height="2.4" fill="${css("--spo2")}"/>`).join("")), `${tonight.spo2}%<small>low ${tonight.spo2min}</small>`]);
  const yt = scale(34, 35.6, H - 2, 2);
  rows.push(["Temp", S(W, H, `<path d="${path(bursts.map((b) => [x(b.m), yt(b.temp)]))}L${W},${H}L0,${H}Z" fill="${css("--temp")}" fill-opacity=".16"/><path d="${path(bursts.map((b) => [x(b.m), yt(b.temp)]))}" fill="none" stroke="${css("--temp")}" stroke-width="1.6"/>`, 'preserveAspectRatio="none"'), `+0.1°<small>vs usual</small>`]);
  rows.push(["Rhythm", S(W, H, bursts.map((b) => `<rect x="${x(b.m) - 1}" y="8" width="2" height="12" rx="1" fill="${b.ok ? css("--good") : css("--ink3")}" opacity="${b.ok ? 0.9 : 0.4}"/>`).join("")), `regular<small>${good.length}/${good.length} checked</small>`]);
  const ticks = [0, 1, 2, 3, 4, 5, 6, 7].map((h) => (24 + h) * 60 - ONSET).filter((m) => m > 0 && m < NIGHT);
  const tax = S(W, 14, ticks.map((m) => `<text x="${x(m)}" y="11" text-anchor="middle" class="axis">${((24 * 60 + m + ONSET) / 60 % 24 | 0) || 12}${inst() ? "" : ""}</text>`).join(""));
  return `<div class="card montage tap" data-open="night">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px"><span class="lbl">Last night · 11:08 PM – 6:41 AM</span><span class="lbl">Tap to expand</span></div>
    ${rows.map(([n, s, v]) => `<div class="ch"><span class="ch-name">${n}</span>${s}<span class="ch-val">${v}</span></div>`).join("")}
    <div class="taxis"><span></span>${tax}<span></span></div></div>`;
}

const q = (n) => `<span class="q">${[0, 1, 2, 3, 4].map((i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</span>`;
function tile(key, label, color, value, unit, delta, viz, quality = 4, grade = "B") {
  return `<div class="card tile tap" data-open="${key}" style="--tint:${css(color)}">
    <div class="t-h"><span class="lbl" style="display:flex;align-items:center;gap:6px"><i style="width:7px;height:7px;border-radius:2px;background:${css(color)}"></i>${label}</span><span>${q(quality)}<span class="grade">${grade}</span></span></div>
    <div class="tv">${value}<small>${unit}</small></div><div class="delta">${delta}</div>${viz}</div>`;
}
function rangeStrip(value, pop, you, lo, hi, color) {
  const W = 150, H = 44, x = scale(lo, hi, 4, W - 4);
  const past = hist.slice(-15, -1).map((h) => h.rhr);
  return S(W, H, `<rect x="${x(pop[0])}" y="18" width="${x(pop[1]) - x(pop[0])}" height="8" rx="4" fill="${css("--ink3")}" opacity=".16"/>
    <rect x="${x(you[0])}" y="16" width="${x(you[1]) - x(you[0])}" height="12" rx="6" fill="${css(color)}" opacity=".22"/>
    ${past.map((v) => `<line x1="${x(v)}" x2="${x(v)}" y1="12" y2="32" stroke="${css(color)}" stroke-opacity=".35" stroke-width="1"/>`).join("")}
    <circle cx="${x(value)}" cy="22" r="6" fill="${css(color)}" stroke="${css("--bg")}" stroke-width="2"/>
    <text x="4" y="42" class="axis">${lo}</text><text x="${W - 4}" y="42" text-anchor="end" class="axis">${hi}</text>`);
}
function dotTrend(vals, band, color, pop) {
  const W = 150, H = 44, x = scale(0, vals.length - 1, 4, W - 4), lo = Math.min(...vals, pop[0]) - 2, hi = Math.max(...vals, pop[1]) + 2, y = scale(lo, hi, H - 4, 4);
  return S(W, H, `<rect x="0" width="${W}" y="${y(pop[1])}" height="${y(pop[0]) - y(pop[1])}" fill="${css("--ink3")}" opacity=".08"/>
    <rect x="0" width="${W}" y="${y(band[1])}" height="${y(band[0]) - y(band[1])}" fill="${css(color)}" opacity=".14" rx="3"/>
    <path d="${path(vals.map((v, i) => [x(i), y(v)]))}" fill="none" stroke="${css(color)}" stroke-width="1.2" stroke-opacity=".5"/>
    ${vals.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="${i === vals.length - 1 ? 4 : 2.2}" fill="${css(color)}" ${i === vals.length - 1 ? `stroke="${css("--bg")}" stroke-width="2"` : ""}/>`).join("")}`);
}
function divBars(vals, color) {
  const W = 150, H = 44, bw = W / vals.length, y0 = H / 2, k = 18 / 0.6;
  return S(W, H, `<line x1="0" x2="${W}" y1="${y0}" y2="${y0}" stroke="${css("--grid")}"/>` + vals.map((v, i) => { const h = Math.max(1.5, Math.abs(v) * k); return `<rect x="${i * bw + 1.5}" y="${v >= 0 ? y0 - h : y0}" width="${bw - 3}" height="${h}" rx="1.5" fill="${css(v >= 0.3 ? "--bad" : color)}" opacity="${i === vals.length - 1 ? 1 : 0.55}"/>`; }).join(""));
}
function hourBars() {
  const W = 150, H = 44, bw = W / 24, max = Math.max(...stepsHour, ...typicalHour, 1);
  return S(W, H, typicalHour.map((v, i) => { const h = v ? 3 + (v / max) * (H - 8) : 0; return h ? `<rect x="${i * bw + 0.8}" y="${H - h}" width="${bw - 1.6}" height="${h}" rx="1.2" fill="${css("--ink3")}" opacity=".18"/>` : ""; }).join("")
    + stepsHour.map((v, i) => { const h = v ? 3 + (v / max) * (H - 8) : 1.5; return `<rect x="${i * bw + 0.8}" y="${H - h}" width="${bw - 1.6}" height="${h}" rx="1.2" fill="${v ? css("--steps") : css("--grid")}"/>`; }).join(""));
}
function breathLine(vals, color) {
  const W = 150, H = 44, x = scale(0, vals.length - 1, 4, W - 4), y = scale(13.5, 18, H - 4, 4);
  return S(W, H, `<path d="${path(vals.map((v, i) => [x(i), y(v)]))}" fill="none" stroke="${css(color)}" stroke-width="2" stroke-linejoin="round"/><circle cx="${x(vals.length - 1)}" cy="${y(vals[vals.length - 1])}" r="3.5" fill="${css(color)}"/>`);
}
function spo2Strip() {
  const W = 150, H = 44, x = scale(0, NIGHT, 4, W - 4), y = scale(92, 100, H - 4, 4);
  return S(W, H, `<rect x="0" width="${W}" y="${y(100)}" height="${y(95) - y(100)}" fill="${css("--spo2")}" opacity=".09" rx="3"/>` + bursts.map((b) => `<circle cx="${x(b.m)}" cy="${y(b.spo2)}" r="2.2" fill="${css("--spo2")}" opacity="${b.spo2 === tonight.spo2min ? 1 : 0.7}"/>`).join(""));
}

function hero() {
  const dir = root.dataset.dir;
  if (dir === "luminous") return `<div class="lum-hero">
      <div class="orb"></div>
      <div class="score" data-open="recovery">${recoveryGauge(71, 58, 82, 230)}<span class="s-l">Recovery</span><span class="s-s">Ready for your usual day</span></div>
      <div class="lum-row">
        <div class="score" data-open="sleep">${sleepArc(84, 120)}<span class="s-l">Sleep</span><span class="s-s">on schedule</span></div>
        <div class="score" data-open="activity">${activityClock(38, 120)}<span class="s-l">Activity</span><span class="s-s">2,640 steps</span></div>
      </div></div>`;
  if (dir === "instrument") {
    const W = 170;
    const scaleBar = (v, lo, hi) => S(W, 26, Array.from({ length: 21 }, (_, i) => `<line x1="${4 + i * (W - 8) / 20}" x2="${4 + i * (W - 8) / 20}" y1="${i % 5 ? 14 : 10}" y2="20" stroke="${css("--ink3")}" stroke-width="1"/>`).join("")
      + `<rect x="${4 + (lo / 100) * (W - 8)}" y="21" width="${((hi - lo) / 100) * (W - 8)}" height="3" fill="${css("--ink2")}"/><path d="M${4 + (v / 100) * (W - 8)},20 l-5,-9 h10 z" fill="${css(v >= 70 ? "--good" : "--watch")}"/>`);
    const stageStrip = S(W, 26, (() => { const x = scale(0, NIGHT, 4, W - 4); let out = "", st = 0; const lv = { 4: 3, 3: 8, 2: 13, 1: 18 }; for (let i = 1; i <= stages.length; i++) if (i === stages.length || stages[i] !== stages[st]) { out += `<rect x="${x(st)}" y="${lv[stages[st]]}" width="${Math.max(0.8, x(i) - x(st))}" height="4" fill="${stageColor(stages[st])}"/>`; st = i; } return out; })());
    const hrs = S(W, 26, stepsHour.map((v, i) => `<rect x="${4 + i * (W - 8) / 24}" y="${22 - (v ? 4 + (v / 1600) * 16 : 1)}" width="${(W - 8) / 24 - 1.5}" height="${v ? 4 + (v / 1600) * 16 : 1}" fill="${v ? css("--act") : css("--grid")}"/>`).join(""));
    const row = (k, lbl, val, viz, sub) => `<div class="i-row" data-open="${k}"><span class="i-l">${lbl}</span><span class="i-v num">${val}</span>${viz}<span class="i-s">${sub}</span></div>`;
    return `<div class="i-hero">${row("sleep", "Sleep", "084", stageStrip, "7h33 · on schedule")}${row("recovery", "Recovery", "071", scaleBar(71, 58, 82), "usual 58–82")}${row("activity", "Activity", "038%", hrs, "2,640 / 8,000 steps")}</div>`;
  }
  return `<div class="hero">
    <div class="score" data-open="sleep">${sleepArc(84)}<span class="s-l">Sleep</span><span class="s-s">on schedule</span></div>
    <div class="score" data-open="recovery">${recoveryGauge(71)}<span class="s-l">Recovery</span><span class="s-s">HRV holding</span></div>
    <div class="score" data-open="activity">${activityClock(38)}<span class="s-l">Activity</span><span class="s-s">2,640 steps</span></div>
  </div>`;
}

function dashboard() {
  const last14 = hist.slice(-14);
  return `
  <div class="hd"><div><div class="lbl">Thursday · Sep 24</div><h1>Good morning, Alex</h1></div><div class="avatar">A</div></div>
  <div class="sync" style="margin:-4px 2px 14px"><i></i>Synced 4 min ago · V5 Alex · 92%</div>
  <div class="card hero-card">${hero()}
  <p class="summary"><b>Recovered, with a slightly short night.</b> Resting heart rate is at your usual 60; HRV ${tonight.hrv.toFixed(0)} ms is within what short sleep predicts for you.<span class="why">Biggest driver today: sleep 22 min below your usual.</span></p></div>
  <div class="sec"><h2>Last night</h2><span class="lbl">7 channels</span></div>
  ${montage()}
  <div class="sec"><h2>Vitals</h2><span class="lbl">vs norms & your usual</span></div>
  <div class="tiles">
    ${tile("rhr", "Resting HR", "--heart", "60.6", "bpm", `usual 57–62 · men 25–34: 52–72`, rangeStrip(60.6, [52, 72], [57, 62], 48, 78, "--heart"), 5, "A")}
    ${tile("hrv", "Overnight HRV", "--hrv", tonight.hrv.toFixed(0), "ms", `<span class="up">▲ 2</span> vs expected tonight`, dotTrend(last14.map((h) => h.hrv), [33, 44], "--hrv", [28, 58]), 4, "B")}
    ${tile("breath", "Breathing", "--breath", tonight.br.toFixed(1), "/min", `steady · usual 14.8–15.9`, breathLine(last14.map((h) => h.br), "--breath"), 3, "C")}
    ${tile("spo2", "Oxygen asleep", "--spo2", tonight.spo2, "%", `lowest ${tonight.spo2min}% · 45 readings`, spo2Strip(), 3, "C")}
    ${tile("temp", "Skin temp", "--temp", "+0.1", "°F", `no warming trend`, divBars(last14.map((h) => h.tdev), "--temp"), 4, "B")}
    ${tile("steps", "Steps today", "--steps", "2,640", "", `goal 8,000 · 3 active hrs`, hourBars(), 5, "A")}
  </div>
  <div class="sec"><h2>Tag last night</h2><span class="lbl">optional · improves the model</span></div>
  <div class="tags">${["Alcohol", "Late caffeine", "Stress", "Sick", "Travel", "Meds change", "Late workout"].map((t, i) => `<button class="tag ${i === 5 ? "" : ""}">${t}</button>`).join("")}</div>
  <div class="sec"><h2>Labs</h2><span class="lbl">Quest · Sep 3</span></div>
  <div class="labs">
    <div class="lab"><div class="n">LDL-C</div><div class="v num">148</div><div class="f flag-h">High · ↓ from 161</div></div>
    <div class="lab"><div class="n">HDL-C</div><div class="v num">44</div><div class="f flag-ok">Normal · ↑ from 41</div></div>
    <div class="lab"><div class="n">hs-CRP</div><div class="v num">0.8</div><div class="f">Lower risk</div></div>
    <div class="lab"><div class="n">HbA1c</div><div class="v num">5.4</div><div class="f flag-ok">Normal</div></div>
  </div>
  <p class="note-sm" style="margin:14px 4px 0">Concept with synthetic data. Tap the night, any tile or a score.</p>`;
}

// ---------- drill-down ----------
const METRIC = {
  hrv: { title: "Overnight HRV", unit: "ms", color: "--hrv", get: (h) => h.hrv, pop: [28, 58], popLbl: "Men 25–34", fmt: (v) => v.toFixed(0), grade: "B", q: 4 },
  rhr: { title: "Resting heart rate", unit: "bpm", color: "--heart", get: (h) => h.rhr, pop: [52, 72], popLbl: "Men 25–34", fmt: (v) => v.toFixed(1), grade: "A", q: 5 },
  breath: { title: "Breathing rate asleep", unit: "/min", color: "--breath", get: (h) => h.br, pop: [12, 20], popLbl: "Adults", fmt: (v) => v.toFixed(1), grade: "C", q: 3 },
  temp: { title: "Skin temperature", unit: "°F", color: "--temp", get: (h) => h.tdev * 1.8, pop: [-0.9, 0.9], popLbl: "Typical swing", fmt: (v) => (v >= 0 ? "+" : "") + v.toFixed(1), grade: "B", q: 4 },
};
let view = "night", agg = "90";

function drill(key) {
  const m = METRIC[key] ?? METRIC.hrv;
  const vals = hist.map(m.get), prior = vals.slice(-29, -1);
  const you = [median(prior) - sd(prior), median(prior) + sd(prior)];
  const cur = vals[vals.length - 1];
  const ctx = key === "hrv" ? [33.2, 42.6] : [you[0], you[1]];
  const lo = Math.min(m.pop[0], you[0], ctx[0], cur) - (m.pop[1] - m.pop[0]) * 0.15, hi = Math.max(m.pop[1], you[1], ctx[1], cur) + (m.pop[1] - m.pop[0]) * 0.15;
  const band = (lbl, b, col, note) => { const W = 220, x = scale(lo, hi, 4, W - 4); return `<div class="band-row"><span>${lbl}</span>${S(W, 18, `<line x1="4" x2="${W - 4}" y1="9" y2="9" stroke="${css("--grid")}" stroke-width="2"/><rect x="${x(b[0])}" y="4" width="${x(b[1]) - x(b[0])}" height="10" rx="5" fill="${css(col)}" opacity="${col === "--ink3" ? 0.28 : 0.3}"/><circle cx="${x(cur)}" cy="9" r="5" fill="${css(m.color)}" stroke="${css("--bg")}" stroke-width="2"/>`)}<span class="bv">${m.fmt(b[0])}–${m.fmt(b[1])}</span></div>`; };
  return `
  <div class="m-top"><button class="back" data-close>‹ Home</button><span>${q(m.q)}<span class="grade">grade ${m.grade}</span></span></div>
  <div class="lbl" style="margin-top:10px">${m.title}</div>
  <div class="m-hero"><div class="big">${m.fmt(cur)}<small>${m.unit}</small></div><div class="meta">Night of Sep 23 → 24<br>${good.length} of ${bursts.length} pulse recordings clean<br>updated 6:52 AM</div></div>
  <div class="expect">
    ${band(m.popLbl, m.pop, "--ink3")}
    ${band("Your usual", you, m.color)}
    ${band("Expected tonight", ctx, m.color)}
  </div>
  ${key === "hrv" ? `<div class="ctxnote"><b>Why "expected tonight" is lower:</b> you slept 22 minutes less than usual. In your own data, each hour of lost sleep lowers overnight HRV by about 4 ms (±1.1), so tonight's expected range shifts down. ${m.fmt(cur)} ms is right in it.</div>` : ""}
  <div class="seg" role="tablist">${[["night", "Night"], ["trend", "Trend"], ["spread", "Spread"], ["drivers", "Drivers"], ["patterns", "Patterns"]].map(([k, l]) => `<button data-view="${k}" class="${view === k ? "on" : ""}">${l}</button>`).join("")}</div>
  ${view === "trend" || view === "spread" ? `<div class="agg">${[["30", "30D"], ["90", "90D"], ["365", "1Y"]].map(([k, l]) => `<button data-agg="${k}" class="${agg === k ? "on" : ""}">${l}</button>`).join("")}</div>` : ""}
  <div class="viz card">${renderView(key, m, vals, you)}</div>
  <div class="sec"><h2>How it's measured</h2><span class="lbl">method</span></div>
  <div class="card explain"><p>RMSSD, the beat-to-beat variation between heartbeats, computed on this phone from the band's own ~80-second pulse recordings, taken every 10 minutes while you sleep. Movement artifacts are removed beat by beat (Lipponen & Tarvainen 2019); recordings with more than 20% corrected beats are discarded. The night's value is the median of the clean recordings.</p>
    <p>Population band: overnight RMSSD for healthy men 25–34 (illustrative in this concept; the build uses published norms). Your usual: median ± one typical swing over your last 28 nights.</p></div>
  <div class="sec"><h2>Raw evidence</h2><span class="lbl">${bursts.length} recordings</span></div>
  <div class="card bursts">${bursts.slice(0, 12).map((b) => `<div class="b"><span>${clock(b.m)}</span><span>${b.beats} beats</span><span class="${b.ok ? "" : "rej"}">${b.rmssd.toFixed(1)} ms</span><span><span class="pill">${b.ok ? "kept" : "movement"}</span></span></div>`).join("")}<p class="note-sm">…${bursts.length - 12} more</p></div>`;
}
const clock = (m) => { const t = (ONSET + m) % 1440; const h = Math.floor(t / 60), mm = t % 60; return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, "0")}`; };

function renderView(key, m, vals, you) {
  const W = 340;
  if (view === "night") {
    const H = 170, x = scale(0, NIGHT, 30, W - 6), ys = key === "hrv" ? [22, 54] : key === "rhr" ? [52, 74] : key === "breath" ? [12, 19] : [-1, 1];
    const y = scale(ys[0], ys[1], H - 30, 12);
    let bg = "", start = 0;
    const lv = { 4: 0, 3: 1, 2: 2, 1: 3 };
    for (let i = 1; i <= stages.length; i++) if (i === stages.length || stages[i] !== stages[start]) { bg += `<rect x="${x(start)}" y="${H - 24 + lv[stages[start]] * 5}" width="${Math.max(0.8, x(i) - x(start))}" height="4" fill="${stageColor(stages[start])}" opacity=".85"/>`; start = i; }
    const series = key === "hrv" ? bursts.map((b) => [b.m, b.rmssd, b.ok]) : key === "rhr" ? hr.map((v, i) => [i, v, true]).filter((_, i) => i % 4 === 0) : key === "breath" ? good.map((b) => [b.m, b.br, true]) : bursts.map((b) => [b.m, (b.temp - 35) * 1.8, true]);
    const grid = [0, 1, 2, 3].map((k) => { const v = ys[0] + (k / 3) * (ys[1] - ys[0]); return `<line x1="30" x2="${W - 6}" y1="${y(v)}" y2="${y(v)}" stroke="${css("--grid")}"/><text x="24" y="${y(v) + 4}" text-anchor="end" class="axis">${Math.round(v * (key === "temp" ? 10 : 1)) / (key === "temp" ? 10 : 1)}</text>`; }).join("");
    const pts = series.filter((s) => s[2]);
    return S(W, H, `${grid}<rect x="30" width="${W - 36}" y="${y(you[1])}" height="${y(you[0]) - y(you[1])}" fill="${css(m.color)}" opacity=".1"/>${bg}
      <path d="${path(pts.map((s) => [x(s[0]), y(s[1])]))}" fill="none" stroke="${css(m.color)}" stroke-width="${key === "rhr" ? 1.6 : 1.2}" stroke-opacity="${key === "rhr" ? 1 : 0.45}"/>
      ${key === "rhr" ? "" : series.map((s) => `<circle cx="${x(s[0])}" cy="${y(s[1])}" r="${s[2] ? 3.2 : 2.6}" fill="${s[2] ? css(m.color) : "none"}" stroke="${s[2] ? css("--bg") : css("--ink3")}" stroke-width="${s[2] ? 1.5 : 1}"/>`).join("")}`)
      + `<p class="note-sm">Every ${key === "rhr" ? "minute" : "pulse recording"} through the night over your sleep stages; hollow = rejected for movement. Shaded: your usual range.</p>`;
  }
  const n = +agg, series = vals.slice(-n), H = 180;
  if (view === "trend") {
    const x = scale(0, n - 1, 30, W - 6), lo = Math.min(...series, m.pop[0]), hi = Math.max(...series, m.pop[1]), y = scale(lo, hi, H - 20, 10);
    const roll = series.map((_, i) => mean(series.slice(Math.max(0, i - 6), i + 1)));
    const cv = (100 * sd(series)) / mean(series.map(Math.abs));
    return S(W, H, `<rect x="30" width="${W - 36}" y="${y(m.pop[1])}" height="${y(m.pop[0]) - y(m.pop[1])}" fill="${css("--ink3")}" opacity=".07"/>
      <rect x="30" width="${W - 36}" y="${y(you[1])}" height="${y(you[0]) - y(you[1])}" fill="${css(m.color)}" opacity=".13"/>
      ${[lo, (lo + hi) / 2, hi].map((v) => `<text x="24" y="${y(v) + 4}" text-anchor="end" class="axis">${m.fmt(v)}</text>`).join("")}
      ${series.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="${n > 100 ? 1.2 : 2}" fill="${css(m.color)}" opacity=".45"/>`).join("")}
      <path d="${path(roll.map((v, i) => [x(i), y(v)]))}" fill="none" stroke="${css(m.color)}" stroke-width="2.2" ${useGlow("gt")}/><defs>${glow("gt")}</defs>`)
      + `<div class="stat3"><div><b>${m.fmt(mean(series))}</b><span>average</span></div><div><b>${cv.toFixed(0)}%</b><span>night-to-night CV</span></div><div><b>${m.fmt(Math.min(...series))}–${m.fmt(Math.max(...series))}</b><span>range</span></div></div>
      <p class="note-sm">Dots: nights · line: 7-night average · colored band: your usual · grey: ${m.popLbl.toLowerCase()} norm.</p>`;
  }
  if (view === "spread") {
    const bins = 16, lo = Math.min(...series), hi = Math.max(...series), bw = (hi - lo) / bins, counts = new Array(bins).fill(0);
    series.forEach((v) => counts[Math.min(bins - 1, Math.floor((v - lo) / bw))]++);
    const x = scale(lo, hi, 20, W - 10), cmax = Math.max(...counts), y = scale(0, cmax, H - 26, 16), sorted = [...series].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(n * 0.25)], q3 = sorted[Math.floor(n * 0.75)], md = median(series), cur = series[series.length - 1];
    return S(W, H, counts.map((c, i) => `<rect x="${x(lo + i * bw) + 1}" y="${y(c)}" width="${x(lo + bw) - x(lo) - 2}" height="${y(0) - y(c)}" rx="2" fill="${css(m.color)}" opacity="${lo + (i + 0.5) * bw >= q1 && lo + (i + 0.5) * bw <= q3 ? 0.75 : 0.35}"/>`).join("")
      + `<line x1="${x(md)}" x2="${x(md)}" y1="10" y2="${H - 22}" stroke="${css("--ink2")}" stroke-width="1.2"/><text x="${x(md)}" y="9" text-anchor="middle" class="axis">median ${m.fmt(md)}</text>
      <circle cx="${x(cur)}" cy="${H - 14}" r="5" fill="${css(m.color)}" stroke="${css("--bg")}" stroke-width="2"/><text x="${x(cur)}" y="${H - 1}" text-anchor="middle" class="axis">last night</text>
      <text x="20" y="${H - 1}" class="axis">${m.fmt(lo)}</text><text x="${W - 10}" y="${H - 1}" text-anchor="end" class="axis">${m.fmt(hi)}</text>`)
      + `<div class="stat3"><div><b>${m.fmt(q1)}–${m.fmt(q3)}</b><span>middle half</span></div><div><b>${m.fmt(sd(series))}</b><span>SD</span></div><div><b>${Math.round((100 * sorted.filter((v) => v <= cur).length) / n)}th</b><span>percentile</span></div></div>
      <p class="note-sm">Your last ${n} nights. The middle half is where you usually are; last night sits at the ${Math.round((100 * sorted.filter((v) => v <= cur).length) / n)}th percentile of your own history.</p>`;
  }
  if (view === "drivers") {
    const effects = key === "rhr" ? [["Alcohol (tagged)", 3.4, 0.8], ["Sleep −1 h", 1.1, 0.4], ["Illness (Aug)", 5.0, 1.5], ["Late workout", 0.6, 0.7]] : [["Alcohol (tagged)", -7.1, 1.4], ["Sleep −1 h", -4.2, 1.1], ["Late workout", -3.0, 1.3], ["Warm night (+0.3°)", -2.4, 1.6]];
    const emax = 10, xs = scale(-emax, emax, 0, 120);
    const sc = hist.slice(-120), sx = scale(5.8, 8.8, 30, W - 6), vy = sc.map(m.get), sy = scale(Math.min(...vy), Math.max(...vy), H - 22, 10);
    const lr = (() => { const xm = mean(sc.map((h) => h.sleepH)), ym = mean(vy); const b = sc.reduce((a, h, i) => a + (h.sleepH - xm) * (vy[i] - ym), 0) / sc.reduce((a, h) => a + (h.sleepH - xm) ** 2, 0); return [b, ym - b * xm]; })();
    return `<div>${effects.map(([l, e, ci]) => `<div class="drv"><span>${l}</span>${S(120, 12, `<line x1="60" x2="60" y1="0" y2="12" stroke="${css("--grid")}"/><line x1="${xs(e - ci)}" x2="${xs(e + ci)}" y1="6" y2="6" stroke="${css("--ink3")}" stroke-width="1.5"/><rect x="${Math.min(60, xs(e))}" y="2" width="${Math.abs(xs(e) - 60)}" height="8" rx="2" fill="${css(e < 0 === (key !== "rhr") ? "--bad" : "--good")}" opacity=".8"/>`)}<span class="e">${e > 0 ? "+" : ""}${e.toFixed(1)}</span></div>`).join("")}</div>
      <p class="note-sm">Effect on your ${m.title.toLowerCase()} (${m.unit}) from a model fitted on your own last 120 nights, with 95% intervals.</p>
      <div style="margin-top:14px">${S(W, H, sc.map((h, i) => `<circle cx="${sx(h.sleepH)}" cy="${sy(vy[i])}" r="2.4" fill="${css(h.alcohol ? "--bad" : m.color)}" opacity=".55"/>`).join("") + `<path d="M${sx(5.8)},${sy(lr[1] + lr[0] * 5.8)}L${sx(8.8)},${sy(lr[1] + lr[0] * 8.8)}" stroke="${css("--ink2")}" stroke-width="1.6"/>` + [6, 7, 8].map((hh) => `<text x="${sx(hh)}" y="${H - 4}" text-anchor="middle" class="axis">${hh} h</text>`).join(""))}
      <p class="note-sm">Each dot a night: sleep length vs ${m.title.toLowerCase()}. Red: nights tagged alcohol.</p></div>`;
  }
  // patterns
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const by = days.map((_, d) => hist.slice(-120).filter((h) => h.dow === d).map(m.get));
  const all = by.flat(), lo = Math.min(...all), hi = Math.max(...all), x = scale(0, 6, 34, W - 14), y = scale(lo, hi, H - 22, 10);
  return S(W, H, by.map((v, d) => v.map((val) => `<circle cx="${x(d) + (rnd() - 0.5) * 18}" cy="${y(val)}" r="2" fill="${css(m.color)}" opacity=".35"/>`).join("") + `<line x1="${x(d) - 14}" x2="${x(d) + 14}" y1="${y(mean(v))}" y2="${y(mean(v))}" stroke="${css("--ink")}" stroke-width="2.4" stroke-linecap="round"/><text x="${x(d)}" y="${H - 4}" text-anchor="middle" class="axis">${days[d]}</text>`).join(""))
    + `<p class="note-sm">Last 120 nights by weekday (bar = average). Weekend nights run ${m.fmt(Math.abs(mean([...by[5], ...by[6]]) - mean(by.slice(1, 5).flat())))} ${m.unit} ${mean([...by[5], ...by[6]]) < mean(by.slice(1, 5).flat()) ? "lower" : "higher"} than weekdays.</p>`;
}

// ---------- modal with expand animation ----------
let modal = null, origin = null, openKey = null;
function openDrill(el, key) {
  origin = el; openKey = key;
  const r = el.getBoundingClientRect();
  modal = document.createElement("div");
  modal.className = "modal";
  Object.assign(modal.style, { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px`, transition: "none" });
  modal.innerHTML = `<div class="inner">${drill(key)}</div>`;
  document.body.append(modal);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    modal.style.transition = "top .42s cubic-bezier(.2,.85,.2,1), left .42s cubic-bezier(.2,.85,.2,1), width .42s cubic-bezier(.2,.85,.2,1), height .42s cubic-bezier(.2,.85,.2,1), border-radius .42s";
    Object.assign(modal.style, { top: "0px", left: "0px", width: "100vw", height: "100vh", borderRadius: "0px" });
    setTimeout(() => modal?.classList.add("full"), 380);
  }));
}
function closeDrill() {
  if (!modal) return;
  const r = origin.getBoundingClientRect();
  modal.classList.remove("full");
  modal.scrollTop = 0;
  Object.assign(modal.style, { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: css("--r") });
  const m = modal; modal = null;
  setTimeout(() => m.remove(), 430);
}
document.addEventListener("click", (e) => {
  const v = e.target.closest("[data-view]"), a = e.target.closest("[data-agg]");
  if (modal && (v || a)) { if (v) view = v.dataset.view; if (a) agg = a.dataset.agg; const st = modal.scrollTop; modal.querySelector(".inner").innerHTML = drill(openKey); modal.scrollTop = st; return; }
  if (e.target.closest("[data-close]")) { closeDrill(); return; }
  const t = e.target.closest(".tag"); if (t) { t.classList.toggle("on"); return; }
  const o = e.target.closest("[data-open]");
  if (o && !modal) openDrill(o, METRIC[o.dataset.open] ? o.dataset.open : "hrv");
});

// ---------- direction / theme switcher ----------
function render() { $("#app").innerHTML = dashboard(); }
function setDir(dir, theme) {
  root.dataset.dir = dir; root.dataset.theme = theme;
  try { localStorage.setItem("pulse_concept", JSON.stringify({ dir, theme })); } catch { /* ignore */ }
  for (const b of document.querySelectorAll(".switch [data-dir]")) b.classList.toggle("on", b.dataset.dir === dir);
  $(".switch [data-theme-toggle]").textContent = theme === "dark" ? "☾" : "☀";
  seed = 42; // same "random" jitter each render
  render();
}
let saved = { dir: "hybrid", theme: "dark" };
try { saved = JSON.parse(localStorage.getItem("pulse_concept")) ?? saved; } catch { /* ignore */ }
const params = new URLSearchParams(location.search);
if (params.get("dir")) saved.dir = params.get("dir");
if (params.get("theme")) saved.theme = params.get("theme");
document.querySelector(".switch").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.dir) setDir(b.dataset.dir, root.dataset.theme);
  else setDir(root.dataset.dir, root.dataset.theme === "dark" ? "light" : "dark");
});
setDir(saved.dir, saved.theme);
if (params.get("open")) setTimeout(() => { const el = document.querySelector(`[data-open="${params.get("open")}"]`); if (el) { view = params.get("view") ?? "night"; openDrill(el, params.get("open")); } }, 300);
