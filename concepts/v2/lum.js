// Pulse Luminous v2 concept (synthetic data). Two scenarios show how the dashboard adapts.
const root = document.documentElement;
const $ = (s, r = document) => r.querySelector(s);
const css = (v) => getComputedStyle(root).getPropertyValue(v).trim();
const dark = () => root.dataset.theme !== "light";

// ---------- data ----------
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return (u - 3) / Math.sqrt(0.5); };
const median = (v) => { const a = [...v].sort((x, y) => x - y); const n = a.length >> 1; return a.length % 2 ? a[n] : (a[n - 1] + a[n]) / 2; };
const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
const sd = (v) => { const m = mean(v); return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1)); };

const SCEN = {
  good: { onset: 23 * 60 + 8, wake: 30 * 60 + 41, sleep: 84, rec: 71, state: "good", verdict: "Recovered", hrvBase: 38, rhr: 60.6, nadir: 0.38, temp: 0.1, br: 15.3, awake: 0.012, steps: 2640, pct: 33, ghost: 0.3,
    headline: "Recovered, with a slightly short night.", why: "Sleep ran 22 min under your usual, and HRV landed right where that predicts." },
  rough: { onset: 24 * 60 + 41, wake: 30 * 60 + 39, sleep: 61, rec: 48, state: "bad", verdict: "Take it easy", hrvBase: 24, rhr: 64.2, nadir: 0.74, temp: 0.4, br: 16.4, awake: 0.035, steps: 1210, pct: 15, ghost: 0.3,
    headline: "A short, unsettled night. Your body is working harder.", why: "Resting HR 4 bpm over your usual, heart rate bottomed out late, and HRV below what short sleep alone explains." },
};
let scen = "good";
let D = null;
function build() {
  seed = 7;
  const s = SCEN[scen], N = s.wake - s.onset;
  const stages = [];
  for (let m = 0; m < N; m++) {
    const cyc = Math.floor(m / 92), ph = (m % 92) / 92;
    const deepEnd = Math.max(0.1, 0.48 - cyc * 0.12 - (scen === "rough" ? 0.1 : 0)), remStart = 0.76 - Math.min(0.28, (m / N) * 0.32);
    let st = ph < 0.1 ? 2 : ph < deepEnd ? 1 : ph < remStart ? 2 : 3;
    if (rnd() < s.awake) st = 4;
    stages.push(st);
  }
  const hr = Array.from({ length: N }, (_, m) => { const f = m / N; return s.rhr - 1 + (f < s.nadir ? 9 * (1 - f / s.nadir) : 5 * ((f - s.nadir) / (1 - s.nadir))) + gauss() * 1.3; });
  const bursts = [];
  for (let m = 6; m < N; m += 10) {
    const f = m / N, ok = rnd() > (scen === "rough" ? 0.12 : 0.06);
    bursts.push({ m, rmssd: s.hrvBase + 6 * Math.sin(f * 3.1) + gauss() * 3, br: s.br + gauss() * 0.55, spo2: Math.min(100, Math.round(97.2 + gauss() * 0.9 - (rnd() < 0.05 ? 2.5 : 0))),
      temp: 34.3 + s.temp * 0.55 + 1.0 * Math.min(1, f * 3) + gauss() * 0.06, ok, beats: 82 + Math.round(gauss() * 6) });
  }
  const good = bursts.filter((b) => b.ok);
  const hist = [];
  seed = 99;
  const today = new Date(2026, 8, 24);
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i), dow = d.getDay();
    const sleepH = 7.3 + gauss() * 0.55 - (dow === 1 ? 0.35 : 0) + (dow === 0 || dow === 6 ? 0.3 : 0);
    const alcohol = rnd() < (dow === 5 || dow === 6 ? 0.3 : 0.06), late = rnd() < 0.14, ill = i > 60 && i < 64;
    const tdev = gauss() * 0.1 + (ill ? 0.55 : 0) + (alcohol ? 0.15 : 0) + (i === 1 && scen === "rough" ? 0.3 : 0);
    const season = 2 * Math.sin((i / 365) * 2 * Math.PI);
    hist.push({ d, dow, sleepH, alcohol, late, tdev,
      hrv: 38 + 4.2 * (sleepH - 7.3) - (alcohol ? 7 : 0) - (late ? 3 : 0) - (ill ? 9 : 0) + season + gauss() * 3.3,
      rhr: 59.5 - 1.1 * (sleepH - 7.3) + (alcohol ? 3.4 : 0) + (ill ? 5 : 0) - season * 0.3 + gauss() * 1.3, br: 15.3 + gauss() * 0.45 + (ill ? 1.6 : 0) });
  }
  const last = hist[hist.length - 1];
  last.hrv = median(good.map((b) => b.rmssd)); last.rhr = s.rhr; last.tdev = s.temp / 1.8; last.br = median(good.map((b) => b.br)); last.sleepH = (N - stages.filter((x) => x === 4).length) / 60;
  const stepsHour = Array.from({ length: 24 }, (_, h) => (h < 7 || h > 10 ? 0 : Math.round((rnd() * 800 + (h === 8 ? 600 : 0)) * (scen === "rough" ? 0.45 : 1))));
  const typical = Array.from({ length: 24 }, (_, h) => (h < 7 || h > 22 ? 0 : Math.round(260 + 380 * Math.exp(-(((h - 12.5) / 3.2) ** 2)) + (h === 18 ? 820 : 0) + (h === 8 ? 300 : 0))));
  D = { s, N, stages, hr, bursts, good, hist, stepsHour, typical, hrv: last.hrv };
  root.dataset.state = s.state;
  root.style.setProperty("--breath-s", `${(60 / s.br).toFixed(2)}s`);
}

// ---------- svg helpers ----------
const S = (w, h, body, extra = "") => `<svg viewBox="0 0 ${w} ${h}" ${extra}>${body}</svg>`;
const sc = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
/** Smooth path through points (Catmull-Rom → cubic Bézier). */
function smooth(pts, t = 0.18) {
  if (pts.length < 3) return pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) * t, p1[1] + (p2[1] - p0[1]) * t], c2 = [p2[0] - (p3[0] - p1[0]) * t, p2[1] - (p3[1] - p1[1]) * t];
    d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}
const glowDef = (id, dev = 3) => (dark() ? `<filter id="${id}" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="${dev}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` : "");
const glow = (id) => (dark() ? `filter="url(#${id})"` : "");
const arcPath = (cx, cy, r, a0, a1) => { const p = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)]; const [x0, y0] = p(a0), [x1, y1] = p(a1); return `M${x0.toFixed(2)},${y0.toFixed(2)}A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`; };
const stageColor = (s) => css({ 1: "--deep", 2: "--light", 3: "--rem", 4: "--awake" }[s]);
const clock = (m) => { const t = ((m % 1440) + 1440) % 1440; const h = Math.floor(t / 60), mm = t % 60; return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, "0")}`; };
let uid = 0;

// ---------- hero ----------
function gauge() {
  const s = D.s, W = 260, c = 130, cy = 122, r = 104, a0 = Math.PI * 0.78, a1 = Math.PI * 2.22, span = a1 - a0, at = (v) => a0 + (v / 100) * span;
  const len = r * span, prog = (s.rec / 100) * len, id = `g${uid++}`, gid = `gg${uid++}`;
  const col = css("--state");
  const knob = [c + r * Math.cos(at(s.rec)), cy + r * Math.sin(at(s.rec))];
  return `<div class="gauge" data-open="recovery"><div class="halo"></div>${S(W, 230, `<defs><linearGradient id="${gid}" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${col}" stop-opacity=".55"/><stop offset="1" stop-color="${col}"/></linearGradient>${glowDef(id, 5)}</defs>
    <path d="${arcPath(c, cy, r, a0, a1)}" fill="none" stroke="${css("--track")}" stroke-width="16" stroke-linecap="round"/>
    <path d="${arcPath(c, cy, r, at(58), at(82))}" fill="none" stroke="${css("--ink")}" stroke-opacity=".10" stroke-width="16"/>
    <path class="arc" d="${arcPath(c, cy, r, a0, a1)}" fill="none" stroke="url(#${gid})" stroke-width="16" stroke-linecap="round" stroke-dasharray="${len.toFixed(1)}" stroke-dashoffset="${len.toFixed(1)}" data-to="${(len - prog).toFixed(1)}" ${glow(id)}/>
    <circle cx="${knob[0].toFixed(1)}" cy="${knob[1].toFixed(1)}" r="6" fill="${css("--bg")}" stroke="${col}" stroke-width="3" class="fadein" style="--i:6"/>`)}
    <div class="center"><div class="lbl">Recovery</div><div class="big num" data-count="${s.rec}">${s.rec}</div><div class="verdict">${s.verdict}</div></div><div class="cap">your usual range 58–82</div></div>`;
}
function sleepClock() {
  const s = D.s, W = 74, c = 37, r = 29, toA = (min) => ((min % 720) / 720) * Math.PI * 2 - Math.PI / 2;
  let a0 = toA(s.onset), a1 = toA(s.wake); if (a1 <= a0) a1 += Math.PI * 2;
  const id = `s${uid++}`;
  const ticks = [0, 3, 6, 9].map((k) => { const a = (k / 12) * Math.PI * 2 - Math.PI / 2; return `<line x1="${c + (r - 11) * Math.cos(a)}" y1="${c + (r - 11) * Math.sin(a)}" x2="${c + (r - 7) * Math.cos(a)}" y2="${c + (r - 7) * Math.sin(a)}" stroke="${css("--ink3")}" stroke-width="1.5" stroke-linecap="round"/>`; }).join("");
  return S(W, W, `<defs>${glowDef(id, 2.5)}</defs><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${css("--track")}" stroke-width="7"/>${ticks}
    <path class="draw" style="--len:${(r * (a1 - a0)).toFixed(0)}" d="${arcPath(c, c, r, a0, a1)}" fill="none" stroke="${css("--sleep")}" stroke-width="7" stroke-linecap="round" ${glow(id)}/>
    <text x="${c}" y="${c - r + 17}" text-anchor="middle" class="axis" style="font-size:8.5px">12</text><text x="${c}" y="${c + r - 11}" text-anchor="middle" class="axis" style="font-size:8.5px">6</text>`);
}
function actRing() {
  const s = D.s, W = 74, c = 37, r = 29, len = 2 * Math.PI * r, id = `a${uid++}`, gid = `ag${uid++}`;
  const pace = s.ghost; // where your typical day is by this time
  const pa = pace * Math.PI * 2 - Math.PI / 2;
  return S(W, W, `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${css("--act")}"/><stop offset="1" stop-color="${css("--act2")}"/></linearGradient>${glowDef(id, 2.5)}</defs>
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${css("--track")}" stroke-width="7"/>
    <circle class="arc" cx="${c}" cy="${c}" r="${r}" fill="none" stroke="url(#${gid})" stroke-width="7" stroke-linecap="round" transform="rotate(-90 ${c} ${c})" stroke-dasharray="${len.toFixed(1)}" stroke-dashoffset="${len.toFixed(1)}" data-to="${(len * (1 - s.pct / 100)).toFixed(1)}" ${glow(id)}/>
    <line x1="${c + (r - 6) * Math.cos(pa)}" y1="${c + (r - 6) * Math.sin(pa)}" x2="${c + (r + 6) * Math.cos(pa)}" y2="${c + (r + 6) * Math.sin(pa)}" stroke="${css("--ink")}" stroke-width="2" stroke-linecap="round" opacity=".7"/>`);
}
function hero() {
  const s = D.s, asleep = D.N - D.stages.filter((x) => x === 4).length;
  return `<div class="card hero rise" style="--i:1">${gauge()}
    <div class="minis">
      <div class="mini" data-open="sleep">${sleepClock()}<div class="t"><em>Sleep</em><b>${s.sleep}</b><span>${Math.floor(asleep / 60)}h ${String(asleep % 60).padStart(2, "0")}m asleep</span><span>${clock(s.onset)}–${clock(s.wake)}</span></div></div>
      <div class="mini" data-open="activity">${actRing()}<div class="t"><em>Activity</em><b>${s.pct}%</b><span>${s.steps.toLocaleString()} steps</span><span>${s.pct >= s.ghost * 100 ? "on pace" : "behind pace"}</span></div></div>
    </div>
    <p class="summary">${s.headline}<span class="why">${s.why}</span></p></div>`;
}

// ---------- outlier prompts ----------
function prompts() {
  if (scen !== "rough") return "";
  return `<div class="card prompt rise" style="--i:2" data-prompt>
      <p>Your HRV was <b>lower than expected</b> last night: <b>${D.hrv.toFixed(0)} ms</b>, below the ${M.hrv.exp()[0]}–${M.hrv.exp()[1]} ms your short sleep predicts. Anything that might explain it?</p>
      <div class="chips">${["Alcohol", "Late meal", "Stress", "Feeling sick", "Late workout"].map((t) => `<button class="chip">${t}</button>`).join("")}<button class="chip ghost">Nothing unusual</button></div></div>
    <div class="card prompt rise" style="--i:3; margin-top:12px" data-prompt>
      <p>Your skin temperature has been <b>above your usual two nights running</b> (+0.4 °F last night). That can come a day or two before a cold. How are you feeling?</p>
      <div class="chips"><button class="chip">A bit run-down</button><button class="chip">Warm room</button><button class="chip ghost">Fine</button></div></div>`;
}

// ---------- montage ----------
function montage() {
  const W = 300, H = 30, N = D.N, x = sc(0, N, 0, W);
  const rows = [];
  const lv = { 4: 2, 3: 8, 2: 15, 1: 23 };
  let st = "", start = 0;
  for (let i = 1; i <= D.stages.length; i++) if (i === D.stages.length || D.stages[i] !== D.stages[start]) {
    st += `<rect x="${x(start).toFixed(1)}" y="${lv[D.stages[start]]}" width="${Math.max(0.8, x(i) - x(start)).toFixed(1)}" height="${D.stages[start] === 4 ? 4 : 5}" rx="2" fill="${stageColor(D.stages[start])}"/>`; start = i;
  }
  const deep = D.stages.filter((v) => v === 1).length, rem = D.stages.filter((v) => v === 3).length;
  rows.push(["Stages", `<g class="fadein" style="--i:0">${st}</g>`, `${Math.floor(deep / 60)}h${String(deep % 60).padStart(2, "0")} deep<small>${Math.floor(rem / 60)}h${String(rem % 60).padStart(2, "0")} REM</small>`]);
  const line = (pts, color, i, fill = false) => { const id = `m${uid++}`; const d = smooth(pts); return `<defs>${glowDef(id, 1.8)}</defs>${fill ? `<path d="${d}L${W},${H}L0,${H}Z" fill="${color}" fill-opacity=".14" class="fadein" style="--i:${i}"/>` : ""}<path class="draw" style="--i:${i};--len:600" d="${d}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" ${glow(id)}/>`; };
  const hrPts = [];
  for (let i = 0; i < D.hr.length; i += 8) { const w = D.hr.slice(i, i + 8); hrPts.push([x(i + w.length / 2), sc(D.s.rhr - 6, D.s.rhr + 14, H - 2, 2)(mean(w))]); }
  const low = Math.min(...D.hr), lowAt = D.hr.indexOf(low);
  rows.push(["Heart", line(hrPts, css("--heart"), 1) + `<circle cx="${x(lowAt)}" cy="${sc(D.s.rhr - 6, D.s.rhr + 14, H - 2, 2)(low)}" r="2.6" fill="${css("--heart")}" class="fadein" style="--i:3"/>`, `low ${Math.round(low)}<small>at ${clock(D.s.onset + lowAt)}</small>`]);
  const yv = sc(16, 52, H - 3, 3);
  rows.push(["HRV", `<g class="fadein" style="--i:2">${D.bursts.map((b) => `<circle cx="${x(b.m).toFixed(1)}" cy="${yv(b.rmssd).toFixed(1)}" r="${b.ok ? 2.3 : 1.7}" fill="${b.ok ? css("--hrv") : "none"}" stroke="${b.ok ? "none" : css("--ink3")}"/>`).join("")}</g>`, `${D.hrv.toFixed(0)} ms<small>${D.good.length}/${D.bursts.length} clean</small>`]);
  rows.push(["Breath", line(D.good.map((b) => [x(b.m), sc(12.5, 19, H - 3, 3)(b.br)]), css("--breath"), 3), `${median(D.good.map((b) => b.br)).toFixed(1)}/min<small>steady</small>`]);
  const ys = sc(92, 100, H - 2, 2);
  rows.push(["SpO₂", `<g class="fadein" style="--i:4">${D.bursts.map((b) => `<circle cx="${x(b.m).toFixed(1)}" cy="${ys(b.spo2).toFixed(1)}" r="1.7" fill="${css("--spo2")}"/>`).join("")}</g>`, `${median(D.bursts.map((b) => b.spo2))}%<small>low ${Math.min(...D.bursts.map((b) => b.spo2))}</small>`]);
  rows.push(["Temp", line(D.bursts.map((b) => [x(b.m), sc(34, 36, H - 2, 2)(b.temp)]), css("--temp"), 5, true), `${D.s.temp >= 0 ? "+" : "−"}${Math.abs(D.s.temp).toFixed(1)}°<small>vs usual</small>`]);
  rows.push(["Rhythm", `<g class="fadein" style="--i:6">${D.good.map((b) => `<rect x="${(x(b.m) - 1).toFixed(1)}" y="9" width="2" height="12" rx="1" fill="${css("--good")}" opacity=".85"/>`).join("")}</g>`, `regular<small>${D.good.length}/${D.good.length} checked</small>`]);
  const hours = []; for (let t = Math.ceil(D.s.onset / 60) * 60; t < D.s.wake; t += 60) if ((t / 60) % 2 === 0) hours.push(t);
  const tax = S(W, 14, hours.map((t) => `<text x="${x(t - D.s.onset)}" y="11" text-anchor="middle" class="axis">${clock(t).replace(":00", "")}</text>`).join(""));
  return `<div class="card mon tap rise" style="--i:4" data-open="hrv">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px"><span class="lbl">${clock(D.s.onset)} ${D.s.onset % 1440 >= 720 ? "PM" : "AM"} – ${clock(D.s.wake)} AM</span><span class="lbl" style="letter-spacing:.04em">tap to explore</span></div>
    ${rows.map(([n, body, v]) => `<div class="ch"><span class="ch-n">${n}</span>${S(W, H, body, 'preserveAspectRatio="none"')}<span class="ch-v">${v}</span></div>`).join("")}
    <div class="taxis"><span></span>${tax}<span></span></div></div>`;
}

// ---------- tiles ----------
const q = (n) => `<span class="q">${[0, 1, 2, 3, 4].map((i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</span>`;
function tile(key, label, color, value, unit, delta, viz, quality, i) {
  return `<div class="card tile tap rise" style="--i:${i};--tint:${css(color)}" data-open="${key}"><div class="t-h"><span class="t-l"><i></i>${label}</span>${q(quality)}</div>
    <div class="tv">${value}<small>${unit}</small></div><div class="td">${delta}</div>${viz}</div>`;
}
function vRhr() { // range strip: your usual band, past nights as ticks, tonight pulses at your resting HR
  const W = 150, H = 50, x = sc(50, 72, 4, W - 4), past = D.hist.slice(-15, -1).map((h) => h.rhr), you = [median(past) - sd(past), median(past) + sd(past)];
  return S(W, H, `<line x1="4" x2="${W - 4}" y1="24" y2="24" stroke="${css("--track")}" stroke-width="6" stroke-linecap="round"/>
    <rect x="${x(you[0])}" y="18" width="${x(you[1]) - x(you[0])}" height="12" rx="6" fill="${css("--heart")}" opacity=".25"/>
    ${past.map((v) => `<line x1="${x(v).toFixed(1)}" x2="${x(v).toFixed(1)}" y1="14" y2="34" stroke="${css("--heart")}" stroke-opacity=".35"/>`).join("")}
    <circle class="beat" style="--beat-s:${(60 / D.s.rhr).toFixed(2)}s" cx="${x(D.s.rhr)}" cy="24" r="6" fill="${css("--heart")}" stroke="${css("--bg")}" stroke-width="2"/>
    <text x="${x(you[0])}" y="48" class="axis">usual ${Math.round(you[0])}–${Math.round(you[1])}</text>`);
}
function vHrv() {
  const W = 150, H = 50, vals = D.hist.slice(-14).map((h) => h.hrv), x = sc(0, 13, 5, W - 5), y = sc(18, 52, H - 5, 5), exp = M.hrv.exp();
  return S(W, H, `<rect x="0" width="${W}" y="${y(exp[1])}" height="${y(exp[0]) - y(exp[1])}" rx="6" fill="${css("--hrv")}" opacity=".13"/>
    <path class="draw" style="--i:3;--len:300" d="${smooth(vals.map((v, i) => [x(i), y(v)]))}" fill="none" stroke="${css("--hrv")}" stroke-opacity=".55" stroke-width="1.4"/>
    ${vals.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${i === 13 ? 4.5 : 2.2}" fill="${css("--hrv")}" ${i === 13 ? `stroke="${css("--bg")}" stroke-width="2"` : ""}/>`).join("")}`);
}
function vBreath() {
  const W = 150, H = 50, vals = D.hist.slice(-14).map((h) => h.br), x = sc(0, 13, 5, W - 5), y = sc(13.5, 18, H - 5, 5), id = `b${uid++}`;
  return S(W, H, `<defs>${glowDef(id, 2)}</defs><path class="draw" style="--i:3;--len:300" d="${smooth(vals.map((v, i) => [x(i), y(v)]))}" fill="none" stroke="${css("--breath")}" stroke-width="2.2" stroke-linecap="round" ${glow(id)}/><circle cx="${x(13)}" cy="${y(vals[13])}" r="4" fill="${css("--breath")}"/>`);
}
function vSpo2() {
  const W = 150, H = 50, x = sc(0, D.N, 5, W - 5), y = sc(92, 100, H - 5, 5);
  return S(W, H, `<rect x="0" width="${W}" y="${y(100)}" height="${y(95) - y(100)}" rx="6" fill="${css("--spo2")}" opacity=".10"/>${D.bursts.map((b) => `<circle cx="${x(b.m).toFixed(1)}" cy="${y(b.spo2).toFixed(1)}" r="2.2" fill="${css("--spo2")}"/>`).join("")}<text x="${W}" y="${y(95) + 11}" text-anchor="end" class="axis">95</text>`);
}
function vTemp() {
  const W = 150, H = 50, vals = D.hist.slice(-14).map((h) => h.tdev * 1.8), bw = W / 14, y0 = H / 2, k = 20 / 1;
  return S(W, H, `<line x1="0" x2="${W}" y1="${y0}" y2="${y0}" stroke="${css("--track")}"/>` + vals.map((v, i) => { const h = Math.max(1.5, Math.min(22, Math.abs(v) * k)); return `<rect x="${(i * bw + 1.6).toFixed(1)}" y="${(v >= 0 ? y0 - h : y0).toFixed(1)}" width="${(bw - 3.2).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${css(v >= 0.5 ? "--bad" : "--temp")}" opacity="${i === 13 ? 1 : 0.5}"/>`; }).join(""));
}
function vSteps() {
  const W = 150, H = 50, bw = W / 24, max = Math.max(...D.stepsHour, ...D.typical, 1);
  return S(W, H, D.typical.map((v, i) => (v ? `<rect x="${(i * bw + 0.9).toFixed(1)}" y="${(H - 3 - (v / max) * (H - 8)).toFixed(1)}" width="${(bw - 1.8).toFixed(1)}" height="${((v / max) * (H - 8) + 3).toFixed(1)}" rx="1.5" fill="${css("--ink3")}" opacity=".2"/>` : "")).join("")
    + D.stepsHour.map((v, i) => (v ? `<rect x="${(i * bw + 0.9).toFixed(1)}" y="${(H - 3 - (v / max) * (H - 8)).toFixed(1)}" width="${(bw - 1.8).toFixed(1)}" height="${((v / max) * (H - 8) + 3).toFixed(1)}" rx="1.5" fill="${css("--steps")}"/>` : "")).join(""));
}
function tiles() {
  const s = D.s, rough = scen === "rough";
  return `<div class="tiles">
    ${tile("rhr", "Resting HR", "--heart", s.rhr.toFixed(1), "bpm", rough ? `<span class="dn">▲ 4</span> over your usual` : `right at your usual`, vRhr(), 5, 5)}
    ${tile("hrv", "Overnight HRV", "--hrv", D.hrv.toFixed(0), "ms", `${rough ? `<span class="warn">below</span>` : `<span class="up">within</span>`} expected ${M.hrv.exp()[0]}–${M.hrv.exp()[1]}`, vHrv(), 4, 6)}
    ${tile("breath", "Breathing", "--breath", median(D.good.map((b) => b.br)).toFixed(1), "/min", rough ? `<span class="warn">+1.1</span> vs usual` : `steady · usual 14.8–15.9`, vBreath(), 3, 7)}
    ${tile("spo2", "Oxygen asleep", "--spo2", median(D.bursts.map((b) => b.spo2)), "%", `lowest ${Math.min(...D.bursts.map((b) => b.spo2))}% · ${D.bursts.length} readings`, vSpo2(), 3, 8)}
    ${tile("temp", "Skin temp", "--temp", `${s.temp >= 0 ? "+" : "−"}${Math.abs(s.temp).toFixed(1)}`, "°F", rough ? `<span class="warn">2nd warm night</span>` : `no warming trend`, vTemp(), 4, 9)}
    ${tile("steps", "Steps today", "--steps", s.steps.toLocaleString(), "", `goal 8,000 · vs typical day`, vSteps(), 5, 10)}
  </div>`;
}

function dashboard() {
  return `<div class="hd rise" style="--i:0"><div><div class="lbl">Thursday · Sep 24</div><h1>Good morning, Alex</h1></div><div class="avatar">A</div></div>
    <div class="sync rise" style="--i:0"><i></i>Synced 4 min ago · V5 Alex · 92%</div>
    ${hero()}
    ${prompts() ? `<div style="margin-top:12px">${prompts()}</div>` : ""}
    <div class="sec rise" style="--i:4"><h2>Last night</h2><span class="lbl">7 channels</span></div>
    ${montage()}
    <div class="sec rise" style="--i:5"><h2>Vitals</h2><span class="lbl">vs your usual</span></div>
    ${tiles()}
    <div class="sec rise" style="--i:11"><h2>Anything to note?</h2><span class="lbl">optional</span></div>
    <div class="tags rise" style="--i:11">${["Alcohol", "Late caffeine", "Stress", "Sick", "Travel", "Meds change", "Late workout"].map((t) => `<button class="chip">${t}</button>`).join("")}</div>
    <div class="sec rise" style="--i:12"><h2>Labs</h2><span class="lbl">Quest · Sep 3</span></div>
    <div class="labs rise" style="--i:12">
      <div class="lab"><div class="n">LDL-C</div><div class="v num">148<small>mg/dL</small></div><div class="f hi">High · ↓ from 161</div></div>
      <div class="lab"><div class="n">HDL-C</div><div class="v num">44<small>mg/dL</small></div><div class="f ok">Normal · ↑ from 41</div></div>
      <div class="lab"><div class="n">hs-CRP</div><div class="v num">0.8<small>mg/L</small></div><div class="f">Lower risk</div></div>
      <div class="lab"><div class="n">HbA1c</div><div class="v num">5.4<small>%</small></div><div class="f ok">Normal</div></div>
    </div>
    <p class="note" style="text-align:center;margin-top:18px">Concept · synthetic data. Try the Rough night scenario, then tap the night or any tile.</p>`;
}

// ---------- drill-down ----------
const M = {
  hrv: { title: "Overnight HRV", unit: "ms", color: "--hrv", get: (h) => h.hrv, pop: [28, 58], popLbl: "Men 25–34", f: (v) => v.toFixed(0), exp: () => (scen === "rough" ? [30, 39] : [33, 42]) },
  rhr: { title: "Resting heart rate", unit: "bpm", color: "--heart", get: (h) => h.rhr, pop: [52, 72], popLbl: "Men 25–34", f: (v) => v.toFixed(1), exp: () => (scen === "rough" ? [58.4, 62.8] : [57.6, 61.9]) },
  breath: { title: "Breathing rate asleep", unit: "/min", color: "--breath", get: (h) => h.br, pop: [12, 20], popLbl: "Adults", f: (v) => v.toFixed(1), exp: () => [14.8, 15.9] },
  temp: { title: "Skin temperature", unit: "°F", color: "--temp", get: (h) => h.tdev * 1.8, pop: [-0.9, 0.9], popLbl: "Normal swing", f: (v) => (v >= 0 ? "+" : "") + v.toFixed(1), exp: () => [-0.3, 0.3] },
};
let view = "night", agg = "90";
function drill(key) {
  const m = M[key] ?? M.hrv, vals = D.hist.map(m.get), prior = vals.slice(-29, -1), cur = vals[vals.length - 1];
  const you = [median(prior) - sd(prior), median(prior) + sd(prior)], exp = m.exp();
  const lo = Math.min(m.pop[0], you[0], exp[0], cur) - (m.pop[1] - m.pop[0]) * 0.12, hi = Math.max(m.pop[1], you[1], exp[1], cur) + (m.pop[1] - m.pop[0]) * 0.12;
  const band = (lbl, b, style) => { const W = 230, x = sc(lo, hi, 5, W - 5); return `<div class="band"><span>${lbl}</span>${S(W, 20, `<line x1="5" x2="${W - 5}" y1="10" y2="10" stroke="${css("--track")}" stroke-width="3" stroke-linecap="round"/><rect x="${x(b[0])}" y="4" width="${x(b[1]) - x(b[0])}" height="12" rx="6" fill="${style === "pop" ? css("--ink3") : css(m.color)}" opacity="${style === "pop" ? 0.25 : style === "exp" ? 0.5 : 0.28}"/><circle cx="${x(cur)}" cy="10" r="5.5" fill="${css(m.color)}" stroke="${css("--bg")}" stroke-width="2"/>`)}<span class="bv">${m.f(b[0])}–${m.f(b[1])}</span></div>`; };
  const inside = cur >= exp[0] && cur <= exp[1];
  const ctxTxt = key === "hrv"
    ? (scen === "rough" ? `You slept 1 h 20 min less than usual, which in your data lowers HRV by about 5 ms, so "expected tonight" shifts to ${exp[0]}–${exp[1]} ms. <b>${m.f(cur)} ms is still below that</b>, so something besides short sleep is likely involved. <button class="chip" style="margin-top:8px" data-close>Tag last night</button>` : `You slept 22 minutes less than usual. In your data each lost hour of sleep lowers HRV by about 4 ms (±1.1), so the expected range shifts down slightly. <b>${m.f(cur)} ms is right in it.</b>`)
    : key === "rhr" ? (scen === "rough" ? `Resting HR runs about 1 bpm higher per hour of lost sleep for you; tonight is ${(cur - you[1]).toFixed(1)} bpm above even that. Alcohol, a late meal or an oncoming cold are the usual reasons.` : `Right inside your usual range and the range your sleep predicts.`)
      : `Compared with your usual and with what last night's sleep predicts.`;
  return `<div class="aurora"><i class="a"></i><i class="b"></i><i class="c"></i></div><div class="inner">
    <div class="m-top"><button class="back" data-close>‹ Home</button>${q(4)}</div>
    <div class="lbl m-lbl">${m.title}</div>
    <div class="m-hero"><div class="m-big" data-count="${cur}">${m.f(cur)}<small>${m.unit}</small></div><div class="m-meta">Night of Sep 23 → 24<br>${D.good.length} of ${D.bursts.length} recordings clean<br>${inside ? "within expected" : cur < exp[0] ? "below expected" : "above expected"}</div></div>
    <div class="bands">${band(m.popLbl, m.pop, "pop")}${band("Your usual", you, "you")}${band("Expected tonight", exp, "exp")}</div>
    <div class="ctx">${ctxTxt}</div>
    <div class="seg">${[["night", "Night"], ["trend", "Trend"], ["spread", "Spread"], ["drivers", "Drivers"], ["patterns", "Patterns"]].map(([k, l]) => `<button data-view="${k}" class="${view === k ? "on" : ""}">${l}</button>`).join("")}</div>
    ${view === "trend" || view === "spread" ? `<div class="agg">${[["30", "30D"], ["90", "90D"], ["365", "1Y"]].map(([k, l]) => `<button data-agg="${k}" class="${agg === k ? "on" : ""}">${l}</button>`).join("")}</div>` : ""}
    <div class="card viz">${renderView(key, m, vals, you)}</div>
    <div class="sec"><h2>How it's measured</h2></div>
    <div class="card explain"><p>RMSSD (beat-to-beat variation) computed on your phone from the band's own ~80-second pulse recordings, every 10 minutes while you sleep. Movement artifacts are removed beat by beat (Lipponen & Tarvainen 2019); recordings with more than 20% corrected beats are dropped. The night's value is the median of the clean ones.</p><p>Bands: a population norm for your age and sex, your own usual (median ± a typical swing, last 28 nights), and what tonight's sleep predicts from your own history.</p></div>
    <div class="sec"><h2>Raw evidence</h2><span class="lbl">${D.bursts.length} recordings</span></div>
    <div class="card bursts">${D.bursts.slice(0, 10).map((b) => `<div class="b"><span>${clock(D.s.onset + b.m)}</span><span>${b.beats} beats</span><span class="${b.ok ? "" : "rej"}">${b.rmssd.toFixed(1)} ms</span><span><span class="pill">${b.ok ? "kept" : "movement"}</span></span></div>`).join("")}<p class="note">…and ${D.bursts.length - 10} more</p></div></div>`;
}
function renderView(key, m, vals, you) {
  const W = 340, col = css(m.color), id = `v${uid++}`;
  if (view === "night") {
    const H = 180, x = sc(0, D.N, 30, W - 6), ys = key === "hrv" ? [16, 54] : key === "rhr" ? [D.s.rhr - 6, D.s.rhr + 14] : key === "breath" ? [12, 19] : [-1, 1];
    const y = sc(ys[0], ys[1], H - 32, 10);
    let bg = "", start = 0; const lv = { 4: 0, 3: 1, 2: 2, 1: 3 };
    for (let i = 1; i <= D.stages.length; i++) if (i === D.stages.length || D.stages[i] !== D.stages[start]) { bg += `<rect x="${x(start).toFixed(1)}" y="${H - 26 + lv[D.stages[start]] * 5}" width="${Math.max(0.8, x(i) - x(start)).toFixed(1)}" height="4" rx="1.5" fill="${stageColor(D.stages[start])}" opacity=".9"/>`; start = i; }
    const pts = key === "hrv" ? D.bursts.map((b) => [b.m, b.rmssd, b.ok]) : key === "rhr" ? D.hr.map((v, i) => [i, v, true]).filter((_, i) => i % 4 === 0) : key === "breath" ? D.good.map((b) => [b.m, b.br, true]) : D.bursts.map((b) => [b.m, (b.temp - 35) * 1.8, true]);
    const grid = [0, 1, 2, 3].map((k) => { const v = ys[0] + (k / 3) * (ys[1] - ys[0]); return `<line x1="30" x2="${W - 6}" y1="${y(v)}" y2="${y(v)}" stroke="${css("--grid")}"/><text x="24" y="${y(v) + 4}" text-anchor="end" class="axis">${m.f(v)}</text>`; }).join("");
    const okPts = pts.filter((p) => p[2]).map((p) => [x(p[0]), y(p[1])]);
    return S(W, H, `<defs>${glowDef(id, 2.4)}</defs>${grid}<rect x="30" width="${W - 36}" y="${y(you[1])}" height="${y(you[0]) - y(you[1])}" fill="${col}" opacity=".1"/>${bg}
      <path class="draw" style="--len:900" d="${smooth(okPts)}" fill="none" stroke="${col}" stroke-width="${key === "rhr" ? 2 : 1.4}" stroke-opacity="${key === "rhr" ? 1 : 0.55}" ${key === "rhr" ? glow(id) : ""}/>
      ${key === "rhr" ? "" : pts.map((p) => `<circle cx="${x(p[0]).toFixed(1)}" cy="${y(p[1]).toFixed(1)}" r="${p[2] ? 3.3 : 2.6}" fill="${p[2] ? col : "none"}" stroke="${p[2] ? css("--bg") : css("--ink3")}" stroke-width="${p[2] ? 1.5 : 1}" class="fadein"/>`).join("")}`)
      + `<p class="note">Every ${key === "rhr" ? "few minutes" : "pulse recording"} across the night, over your sleep stages. Hollow dots were dropped for movement; the shaded band is your usual.</p>`;
  }
  const n = +agg, ser = vals.slice(-n), H = 190;
  if (view === "trend") {
    const x = sc(0, n - 1, 30, W - 6), lo = Math.min(...ser, m.pop[0]), hi = Math.max(...ser, m.pop[1]), y = sc(lo, hi, H - 20, 10);
    const roll = ser.map((_, i) => mean(ser.slice(Math.max(0, i - 6), i + 1)));
    return S(W, H, `<defs>${glowDef(id, 2.6)}</defs><rect x="30" width="${W - 36}" y="${y(m.pop[1])}" height="${y(m.pop[0]) - y(m.pop[1])}" fill="${css("--ink3")}" opacity=".07"/>
      <rect x="30" width="${W - 36}" y="${y(you[1])}" height="${y(you[0]) - y(you[1])}" fill="${col}" opacity=".13"/>
      ${[lo, (lo + hi) / 2, hi].map((v) => `<text x="24" y="${y(v) + 4}" text-anchor="end" class="axis">${m.f(v)}</text>`).join("")}
      ${ser.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${n > 100 ? 1.2 : 2}" fill="${col}" opacity=".4"/>`).join("")}
      <path class="draw" style="--len:1400" d="${smooth(roll.map((v, i) => [x(i), y(v)]), 0.12)}" fill="none" stroke="${col}" stroke-width="2.4" ${glow(id)}/>`)
      + `<div class="stat3"><div><b>${m.f(mean(ser))}</b><span>average</span></div><div><b>${((100 * sd(ser)) / Math.abs(mean(ser))).toFixed(0)}%</b><span>night-to-night CV</span></div><div><b>${m.f(Math.min(...ser))}–${m.f(Math.max(...ser))}</b><span>range</span></div></div>
      <p class="note">Dots are nights; the line is the 7-night average. Colored band: your usual. Grey: ${m.popLbl.toLowerCase()} norm.</p>`;
  }
  if (view === "spread") {
    const bins = 16, lo = Math.min(...ser), hi = Math.max(...ser), bw = (hi - lo) / bins, counts = new Array(bins).fill(0);
    ser.forEach((v) => counts[Math.min(bins - 1, Math.floor((v - lo) / bw))]++);
    const x = sc(lo, hi, 20, W - 10), cmax = Math.max(...counts), y = sc(0, cmax, H - 34, 18), sorted = [...ser].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(n * 0.25)], q3 = sorted[Math.floor(n * 0.75)], md = median(ser), cur = ser[ser.length - 1], pct = Math.round((100 * sorted.filter((v) => v <= cur).length) / n);
    return S(W, H, counts.map((c, i) => `<rect x="${(x(lo + i * bw) + 1).toFixed(1)}" y="${y(c).toFixed(1)}" width="${(x(lo + bw) - x(lo) - 2).toFixed(1)}" height="${(y(0) - y(c)).toFixed(1)}" rx="3" fill="${col}" opacity="${lo + (i + 0.5) * bw >= q1 && lo + (i + 0.5) * bw <= q3 ? 0.8 : 0.3}"/>`).join("")
      + `<line x1="${x(md)}" x2="${x(md)}" y1="14" y2="${H - 32}" stroke="${css("--ink2")}" stroke-width="1.2"/><text x="${x(md)}" y="11" text-anchor="middle" class="axis">median ${m.f(md)}</text>
      <circle cx="${x(cur)}" cy="${H - 22}" r="5.5" fill="${col}" stroke="${css("--bg")}" stroke-width="2"/><text x="${x(cur)}" y="${H - 4}" text-anchor="middle" class="axis">last night</text>`)
      + `<div class="stat3"><div><b>${m.f(q1)}–${m.f(q3)}</b><span>your middle half</span></div><div><b>${m.f(sd(ser))}</b><span>SD</span></div><div><b>${pct}th</b><span>percentile</span></div></div>
      <p class="note">Your last ${n} nights. Last night sits at the ${pct}th percentile of your own history.</p>`;
  }
  if (view === "drivers") {
    const eff = key === "rhr" ? [["Alcohol", "tagged nights", 3.4, 0.8], ["1 h less sleep", "", 1.1, 0.4], ["Illness", "Aug 4–7", 5.0, 1.5], ["Late workout", "after 7 pm", 0.6, 0.7]] : [["Alcohol", "tagged nights", -7.1, 1.4], ["1 h less sleep", "", -4.2, 1.1], ["Late workout", "after 7 pm", -3.0, 1.3], ["Warm night", "+0.3 °C", -2.4, 1.6]];
    const xs = sc(-10, 10, 0, 120);
    const sc2 = D.hist.slice(-120), sx = sc(5.8, 8.8, 30, W - 6), vy = sc2.map(m.get), sy = sc(Math.min(...vy), Math.max(...vy), H - 22, 10);
    const xm = mean(sc2.map((h) => h.sleepH)), ym = mean(vy), b = sc2.reduce((a, h, i) => a + (h.sleepH - xm) * (vy[i] - ym), 0) / sc2.reduce((a, h) => a + (h.sleepH - xm) ** 2, 0);
    return `<div>${eff.map(([l, n2, e, ci]) => `<div class="drv"><span>${l}${n2 ? `<span class="n">${n2}</span>` : ""}</span>${S(120, 12, `<line x1="60" x2="60" y1="0" y2="12" stroke="${css("--grid")}"/><line x1="${xs(e - ci)}" x2="${xs(e + ci)}" y1="6" y2="6" stroke="${css("--ink3")}" stroke-width="1.5"/><rect x="${Math.min(60, xs(e))}" y="2" width="${Math.abs(xs(e) - 60)}" height="8" rx="3" fill="${css((e < 0) === (key !== "rhr") ? "--bad" : "--good")}" opacity=".85"/>`)}<span class="e">${e > 0 ? "+" : ""}${e.toFixed(1)}</span></div>`).join("")}</div>
      <p class="note">Effect on your ${m.title.toLowerCase()} (${m.unit}), fitted on your last 120 nights, with 95% intervals. Tags make these sharper.</p>
      <div style="margin-top:12px">${S(W, H, sc2.map((h, i) => `<circle cx="${sx(h.sleepH).toFixed(1)}" cy="${sy(vy[i]).toFixed(1)}" r="2.6" fill="${css(h.alcohol ? "--bad" : m.color)}" opacity=".55"/>`).join("") + `<path d="M${sx(5.8)},${sy(ym + b * (5.8 - xm))}L${sx(8.8)},${sy(ym + b * (8.8 - xm))}" stroke="${css("--ink")}" stroke-opacity=".6" stroke-width="1.6"/>` + [6, 7, 8].map((hh) => `<text x="${sx(hh)}" y="${H - 4}" text-anchor="middle" class="axis">${hh} h sleep</text>`).join(""))}
      <p class="note">Each dot is a night. Red dots: nights you tagged alcohol.</p></div>`;
  }
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], by = days.map((_, d) => D.hist.slice(-120).filter((h) => h.dow === d).map(m.get));
  const all = by.flat(), lo = Math.min(...all), hi = Math.max(...all), x = sc(0, 6, 34, W - 14), y = sc(lo, hi, H - 22, 10);
  seed = 5;
  const wkend = mean([...by[5], ...by[6]]), wkday = mean(by.slice(1, 5).flat());
  return S(W, H, by.map((v, d) => v.map((val) => `<circle cx="${(x(d) + (rnd() - 0.5) * 18).toFixed(1)}" cy="${y(val).toFixed(1)}" r="2" fill="${col}" opacity=".35"/>`).join("") + `<line x1="${x(d) - 14}" x2="${x(d) + 14}" y1="${y(mean(v))}" y2="${y(mean(v))}" stroke="${css("--ink")}" stroke-width="2.4" stroke-linecap="round"/><text x="${x(d)}" y="${H - 4}" text-anchor="middle" class="axis">${days[d]}</text>`).join(""))
    + `<p class="note">Last 120 nights by weekday; bars are averages. Fri–Sat nights run ${m.f(Math.abs(wkend - wkday))} ${m.unit} ${wkend < wkday ? "lower" : "higher"} than weeknights.</p>`;
}

// ---------- modal ----------
let modal = null, origin = null, openKey = null;
function openDrill(el, key) {
  origin = el; openKey = key;
  const r = el.getBoundingClientRect();
  modal = document.createElement("div");
  modal.className = "modal";
  modal.style.setProperty("--mcolor", css((M[key] ?? M.hrv).color));
  Object.assign(modal.style, { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px`, transition: "none" });
  modal.innerHTML = drill(key);
  document.body.append(modal);
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const e = "cubic-bezier(.2,.85,.2,1)";
    modal.style.transition = `top .46s ${e}, left .46s ${e}, width .46s ${e}, height .46s ${e}, border-radius .46s ${e}`;
    Object.assign(modal.style, { top: "0px", left: "0px", width: "100vw", height: "100vh", borderRadius: "0px" });
    setTimeout(() => { modal?.classList.add("full"); countUp(modal); }, 400);
  }));
}
function closeDrill() {
  if (!modal) return;
  const r = origin.getBoundingClientRect(), m = modal;
  m.classList.remove("full"); m.scrollTop = 0;
  Object.assign(m.style, { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: "24px" });
  modal = null; document.body.style.overflow = "";
  setTimeout(() => m.remove(), 470);
}
function countUp(scope) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const el of scope.querySelectorAll("[data-count]")) {
    const to = +el.dataset.count, dec = String(el.firstChild.textContent).includes(".") ? 1 : 0, t0 = performance.now(), node = el.firstChild;
    const step = (t) => { const f = Math.min(1, (t - t0) / 900), e = 1 - (1 - f) ** 3; node.textContent = (to * e).toFixed(dec); if (f < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
}
function sweep() { requestAnimationFrame(() => requestAnimationFrame(() => { for (const a of document.querySelectorAll(".arc[data-to]")) a.setAttribute("stroke-dashoffset", a.dataset.to); })); }

document.addEventListener("click", (e) => {
  const v = e.target.closest("[data-view]"), a = e.target.closest("[data-agg]");
  if (modal && (v || a)) { if (v) view = v.dataset.view; if (a) agg = a.dataset.agg; const st = modal.scrollTop; modal.innerHTML = drill(openKey); modal.classList.add("full"); modal.scrollTop = st; return; }
  if (e.target.closest("[data-close]")) { closeDrill(); return; }
  const chip = e.target.closest(".chip");
  if (chip) {
    const p = chip.closest("[data-prompt]");
    if (p) { p.querySelector(".chips").innerHTML = `<span class="thanks">Noted: <b>${chip.textContent}</b>. Pulse will use it to explain nights like this.</span>`; return; }
    chip.classList.toggle("on"); return;
  }
  const o = e.target.closest("[data-open]");
  if (o && !modal) openDrill(o, M[o.dataset.open] ? o.dataset.open : "hrv");
});

// ---------- controls ----------
function render() { build(); uid = 0; $("#app").innerHTML = dashboard(); sweep(); countUp($("#app")); }
const params = new URLSearchParams(location.search);
let theme = params.get("theme") ?? "dark";
scen = params.get("scen") ?? "good";
function sync() {
  root.dataset.theme = theme;
  for (const b of document.querySelectorAll(".switch [data-scen]")) b.classList.toggle("on", b.dataset.scen === scen);
  $(".switch [data-theme-toggle]").textContent = theme === "dark" ? "☾" : "☀";
  render();
}
document.querySelector(".switch").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.scen) scen = b.dataset.scen; else theme = theme === "dark" ? "light" : "dark";
  sync();
});
sync();
if (params.get("open")) setTimeout(() => { const el = document.querySelector(`[data-open="${params.get("open")}"]`); if (el) { view = params.get("view") ?? "night"; openDrill(el, params.get("open")); } }, 600);
