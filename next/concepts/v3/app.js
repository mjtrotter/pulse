// Pulse Luminous v3 concept (synthetic data). The Measure and Profile tabs run the app's real analytics
// modules (ECG, advanced HRV, ECG-derived breathing, median beat, lab indices, AHA PREVENT) in the browser.
import * as W from "./data.js?v=20260924145338";
import { synthEcg } from "./synth.js?v=20260924145338";
import { ecgSummary, bandpass } from "../../src/analytics/ecg.js?v=20260924145338";
import { advancedHRV } from "../../src/analytics/hrv_advanced.js?v=20260924145338";
import { edrFusion, medianBeat, morphologyFilter } from "../../src/analytics/edr.js?v=20260924145338";
import { derived } from "../../src/analytics/labs.js?v=20260924145338";
import { prevent } from "../../src/analytics/prevent.js?v=20260924145338";

const { median, mean, sd } = W;
const root = document.documentElement;
const $ = (s, r = document) => r.querySelector(s);
const css = (v) => getComputedStyle(root).getPropertyValue(v).trim();
const dark = () => root.dataset.theme !== "light";

// ---------- state ----------
const params = new URLSearchParams(location.search);
let scen = params.get("scen") ?? "good", theme = params.get("theme") ?? "dark", tab = params.get("tab") ?? "today";
let view = "now", agg = "90", split = false, showTags = true;
let hrvTab = params.get("hrv") ?? "time", ecgStart = 0, horizon = "10";
const me = { ...W.ME };
const whatIf = { sbp: null, tc: null };
const userTags = new Set();
const open = new Set();
let D = null;

function build() {
  D = W.world(scen);
  const last = D.hist[D.hist.length - 1];
  for (const k of userTags) { last.t[k] = true; last.logged = true; }
  D.last = last;
  D.hrv = last.hrv;
  D.usualSleep = median(D.hist.slice(-29, -1).map((h) => h.sleepH));
  root.dataset.state = D.s.state;
  root.style.setProperty("--breath-s", `${(60 / D.s.br).toFixed(2)}s`);
}

// ---------- svg helpers ----------
const S = (w, h, body, extra = "") => `<svg viewBox="0 0 ${w} ${h}" ${extra}>${body}</svg>`;
const sc = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
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
const poly = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
const glowDef = (id, dev = 3) => (dark() ? `<filter id="${id}" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="${dev}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` : "");
const glow = (id) => (dark() ? `filter="url(#${id})"` : "");
const arcPath = (cx, cy, r, a0, a1) => { const p = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)]; const [x0, y0] = p(a0), [x1, y1] = p(a1); return `M${x0.toFixed(2)},${y0.toFixed(2)}A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`; };
const stageColor = (s) => css({ 1: "--deep", 2: "--light", 3: "--rem", 4: "--awake" }[s]);
const stageName = { 1: "Deep", 2: "Light", 3: "REM", 4: "Awake" };
const clock = (m) => { const t = ((m % 1440) + 1440) % 1440; const h = Math.floor(t / 60), mm = t % 60; return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, "0")}`; };
const ampm = (m) => `${clock(m)} ${((m % 1440) + 1440) % 1440 >= 720 ? "PM" : "AM"}`;
const dur = (h) => { const m = Math.round(Math.abs(h) * 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`; };
const hm = (h) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
const short = (min) => (min >= 60 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}` : `${min}m`);
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dname = (d) => `${DAYS[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}`;
const ord = (n) => `${n}${[11, 12, 13].includes(n % 100) ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
const pct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;
const sign = (v, d = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}`;
let uid = 0;
const q = (n) => `<span class="q" title="data quality ${n}/5">${[0, 1, 2, 3, 4].map((i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</span>`;
const icon = { chev: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>` };

// Scrubbable charts register their points here: SCRUB[id] = { pts: [[x, y, text]], idle }.
const SCRUB = {};
function scrubbable(id, W0, H0, body, pts, idle, cls = "") {
  SCRUB[id] = { pts, idle, W: W0 };
  return `<div class="readout" data-readout="${id}">${idle}</div><div class="scrub ${cls}" data-scrub="${id}">${S(W0, H0, `${body}<line class="xh" x1="0" x2="0" y1="0" y2="${H0}"/><circle class="xd" r="4.5" cx="-20" cy="-20"/>`)}</div>`;
}

// ---------- metric catalog ----------
const ALL = ["sleep", "alcohol", "caffeine", "stress", "workout"];
const M = {
  recovery: { lc: "recovery score", title: "Recovery", unit: "", color: "--act", get: (h) => h.rec, f: (v) => Math.round(v), nowLbl: "Last night", better: 1, drivers: ALL, q: 4 },
  sleep: { lc: "sleep", title: "Sleep", unit: "", color: "--sleep", get: (h) => h.sleepH, f: (v) => hm(v), fa: (v) => v.toFixed(1), big: (v) => { const t = Math.round(v * 60); return `${Math.floor(t / 60)}<small>h</small> ${String(t % 60).padStart(2, "0")}<small>m</small>`; }, pop: [7, 9], popLbl: "Need (26–64)", nowLbl: "Last night", better: 1, drivers: ["alcohol", "caffeine", "stress", "workout", "steps"], q: 4 },
  hrv: { lc: "overnight HRV", title: "Overnight HRV", unit: "ms", color: "--hrv", get: (h) => h.hrv, f: (v) => v.toFixed(0), pop: [16, 44], popLbl: "Men 55–64", model: true, nowLbl: "Last night", better: 1, drivers: ALL, q: 4 },
  rhr: { lc: "resting heart rate", title: "Resting heart rate", unit: "bpm", color: "--heart", get: (h) => h.rhr, f: (v) => v.toFixed(1), pop: [52, 74], popLbl: "Men 55–64", model: true, nowLbl: "Last night", better: -1, drivers: ALL, q: 5 },
  breath: { lc: "breathing rate", title: "Breathing rate asleep", unit: "/min", color: "--breath", get: (h) => h.br, f: (v) => v.toFixed(1), pop: [12, 20], popLbl: "Adults asleep", nowLbl: "Last night", better: 0, drivers: ["alcohol", "sleep"], q: 3 },
  spo2: { lc: "oxygen level", title: "Oxygen asleep", unit: "%", color: "--spo2", get: (h) => h.spo2, f: (v) => v.toFixed(0), fa: (v) => v.toFixed(1), pop: [95, 100], popLbl: "Healthy adults", nowLbl: "Last night", better: 1, drivers: ["alcohol", "sleep"], q: 3 },
  temp: { lc: "skin temperature", title: "Skin temperature", unit: "°F", color: "--temp", get: (h) => h.tdev * 1.8, f: (v) => sign(v), pop: [-0.9, 0.9], popLbl: "Normal swing", nowLbl: "Last night", better: -1, drivers: ["alcohol", "workout"], q: 4 },
  steps: { lc: "steps", title: "Steps", unit: "", color: "--steps", get: (h) => h.steps, f: (v) => Math.round(v).toLocaleString(), pop: [8000, 12000], popLbl: "Benefit plateau <60", nowLbl: "Today", better: 1, drivers: ["sleep", "stress"], q: 5, yesterday: true },
};
const series = (m) => D.hist.slice(0, m.yesterday ? -1 : undefined).filter((h) => m.get(h) != null);
const expOf = (key) => (M[key].model ? W.expected(D.hist, M[key].get, D.last.sleepH) : null);

// ---------- Today ----------
function gauge() {
  const s = D.s, rec = D.last.rec, W0 = 260, c = 130, cy = 122, r = 104, a0 = Math.PI * 0.78, a1 = Math.PI * 2.22, span = a1 - a0, at = (v) => a0 + (v / 100) * span;
  const len = r * span, prog = (rec / 100) * len, id = `g${uid++}`, gid = `gg${uid++}`, col = css("--state");
  const prior = D.hist.slice(-29, -1).map((h) => h.rec), lo = Math.round(median(prior) - sd(prior)), hi = Math.round(median(prior) + sd(prior));
  const knob = [c + r * Math.cos(at(rec)), cy + r * Math.sin(at(rec))];
  const verdict = rec >= 67 ? "Recovered" : rec >= 50 ? "Steady" : "Take it easy";
  return `<div class="gauge" data-open="recovery"><div class="halo"></div>${S(W0, 230, `<defs><linearGradient id="${gid}" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${col}" stop-opacity=".55"/><stop offset="1" stop-color="${col}"/></linearGradient>${glowDef(id, 5)}</defs>
    <path d="${arcPath(c, cy, r, a0, a1)}" fill="none" stroke="${css("--track")}" stroke-width="16" stroke-linecap="round"/>
    <path d="${arcPath(c, cy, r, at(lo), at(hi))}" fill="none" stroke="${css("--ink")}" stroke-opacity=".10" stroke-width="16"/>
    <path class="arc" d="${arcPath(c, cy, r, a0, a1)}" fill="none" stroke="url(#${gid})" stroke-width="16" stroke-linecap="round" stroke-dasharray="${len.toFixed(1)}" stroke-dashoffset="${len.toFixed(1)}" data-to="${(len - prog).toFixed(1)}" ${glow(id)}/>
    <circle cx="${knob[0].toFixed(1)}" cy="${knob[1].toFixed(1)}" r="6" fill="${css("--bg")}" stroke="${col}" stroke-width="3" class="fadein" style="--i:6"/>`)}
    <div class="center"><div class="lbl">Recovery</div><div class="big num" data-count="${rec}">${rec}</div><div class="verdict">${verdict}</div></div><div class="cap">your usual range ${lo}–${hi}</div></div>`;
}
function sleepClock() {
  const s = D.s, W0 = 74, c = 37, r = 29, toA = (min) => ((min % 720) / 720) * Math.PI * 2 - Math.PI / 2;
  let a0 = toA(s.onset), a1 = toA(s.wake); if (a1 <= a0) a1 += Math.PI * 2;
  const id = `s${uid++}`;
  const ticks = [0, 3, 6, 9].map((k) => { const a = (k / 12) * Math.PI * 2 - Math.PI / 2; return `<line x1="${c + (r - 11) * Math.cos(a)}" y1="${c + (r - 11) * Math.sin(a)}" x2="${c + (r - 7) * Math.cos(a)}" y2="${c + (r - 7) * Math.sin(a)}" stroke="${css("--ink3")}" stroke-width="1.5" stroke-linecap="round"/>`; }).join("");
  return S(W0, W0, `<defs>${glowDef(id, 2.5)}</defs><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${css("--track")}" stroke-width="7"/>${ticks}
    <path class="draw" style="--len:${(r * (a1 - a0)).toFixed(0)}" d="${arcPath(c, c, r, a0, a1)}" fill="none" stroke="${css("--sleep")}" stroke-width="7" stroke-linecap="round" ${glow(id)}/>
    <text x="${c}" y="${c - r + 17}" text-anchor="middle" class="axis" style="font-size:8.5px">12</text><text x="${c}" y="${c + r - 11}" text-anchor="middle" class="axis" style="font-size:8.5px">6</text>`);
}
function actRing() {
  const s = D.s, W0 = 74, c = 37, r = 29, len = 2 * Math.PI * r, id = `a${uid++}`, gid = `ag${uid++}`, pa = s.ghost * Math.PI * 2 - Math.PI / 2;
  return S(W0, W0, `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${css("--act")}"/><stop offset="1" stop-color="${css("--act2")}"/></linearGradient>${glowDef(id, 2.5)}</defs>
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${css("--track")}" stroke-width="7"/>
    <circle class="arc" cx="${c}" cy="${c}" r="${r}" fill="none" stroke="url(#${gid})" stroke-width="7" stroke-linecap="round" transform="rotate(-90 ${c} ${c})" stroke-dasharray="${len.toFixed(1)}" stroke-dashoffset="${len.toFixed(1)}" data-to="${(len * (1 - s.pct / 100)).toFixed(1)}" ${glow(id)}/>
    <line x1="${c + (r - 6) * Math.cos(pa)}" y1="${c + (r - 6) * Math.sin(pa)}" x2="${c + (r + 6) * Math.cos(pa)}" y2="${c + (r + 6) * Math.sin(pa)}" stroke="${css("--ink")}" stroke-width="2" stroke-linecap="round" opacity=".7"/>`);
}
function headline() {
  const e = expOf("hrv"), dMin = Math.round((D.last.sleepH - D.usualSleep) * 60), rhrU = median(D.hist.slice(-29, -1).map((h) => h.rhr));
  if (scen === "rough") return [`A short, unsettled night. Your body is working harder.`, `Resting HR ${(D.last.rhr - rhrU).toFixed(0)} bpm over your usual, heart rate bottomed out late, and HRV below what ${hm(D.last.sleepH)} of sleep predicts.`];
  const inside = D.hrv >= e.lo && D.hrv <= e.hi;
  return [`Recovered, after a ${dMin >= -10 ? "full" : "slightly short"} night.`, `Sleep ran ${Math.abs(dMin)} min ${dMin >= 0 ? "over" : "under"} your usual, and HRV landed ${inside ? "inside" : D.hrv > e.hi ? "above" : "below"} what that predicts.`];
}
function hero() {
  const s = D.s, [h1, why] = headline();
  return `<div class="card hero rise" style="--i:1">${gauge()}
    <div class="minis">
      <div class="mini" data-open="sleep">${sleepClock()}<div class="t"><em>Sleep</em><b>${s.sleep}</b><span>${hm(D.asleepMin / 60)} asleep</span><span>${clock(s.onset)}–${clock(s.wake)}</span></div></div>
      <div class="mini" data-open="steps">${actRing()}<div class="t"><em>Activity</em><b>${s.pct}%</b><span>${s.steps.toLocaleString()} steps</span><span>${s.pct >= s.ghost * 100 ? "on pace" : "behind pace"}</span></div></div>
    </div>
    <p class="summary">${h1}<span class="why">${why}</span></p></div>`;
}
function prompts() {
  if (scen !== "rough") return "";
  const e = expOf("hrv");
  return `<div class="card prompt rise" style="--i:2" data-prompt>
      <p>Your HRV was <b>lower than expected</b> last night: <b>${D.hrv.toFixed(0)} ms</b>, below the ${e.lo.toFixed(0)}–${e.hi.toFixed(0)} ms your short sleep predicts. Anything that might explain it?</p>
      <div class="chips">${W.TAGS.map((t) => `<button class="chip" data-tag="${t.key}">${t.label}</button>`).join("")}<button class="chip ghost" data-tag="none">Nothing unusual</button></div></div>
    <div class="card prompt rise" style="--i:3; margin-top:12px" data-prompt>
      <p>Your skin temperature has been <b>above your usual two nights running</b> (+0.4 °F last night). That can come a day or two before a cold. How are you feeling?</p>
      <div class="chips"><button class="chip" data-tag="none">A bit run-down</button><button class="chip" data-tag="none">Warm room</button><button class="chip ghost" data-tag="none">Fine</button></div></div>`;
}
function montage() {
  const W0 = 300, H = 30, N = D.N, x = sc(0, N, 0, W0), rows = [], lv = { 4: 2, 3: 8, 2: 15, 1: 23 };
  let st = "", start = 0;
  for (let i = 1; i <= D.stages.length; i++) if (i === D.stages.length || D.stages[i] !== D.stages[start]) {
    st += `<rect x="${x(start).toFixed(1)}" y="${lv[D.stages[start]]}" width="${Math.max(0.8, x(i) - x(start)).toFixed(1)}" height="${D.stages[start] === 4 ? 4 : 5}" rx="2" fill="${stageColor(D.stages[start])}"/>`; start = i;
  }
  const deep = D.stages.filter((v) => v === 1).length, rem = D.stages.filter((v) => v === 3).length;
  rows.push(["Stages", "sleep", `<g class="fadein" style="--i:0">${st}</g>`, `${short(deep)} deep<small>${short(rem)} REM</small>`]);
  const line = (pts, color, i, fill = false) => { const id = `m${uid++}`; const d = smooth(pts); return `<defs>${glowDef(id, 1.8)}</defs>${fill ? `<path d="${d}L${W0},${H}L0,${H}Z" fill="${color}" fill-opacity=".14" class="fadein" style="--i:${i}"/>` : ""}<path class="draw" style="--i:${i};--len:600" d="${d}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" ${glow(id)}/>`; };
  const hrPts = [], yh = sc(D.s.rhr - 6, D.s.rhr + 14, H - 2, 2);
  for (let i = 0; i < D.hr.length; i += 8) { const w = D.hr.slice(i, i + 8); hrPts.push([x(i + w.length / 2), yh(mean(w))]); }
  const low = Math.min(...D.hr), lowAt = D.hr.indexOf(low);
  rows.push(["Heart", "rhr", line(hrPts, css("--heart"), 1) + `<circle cx="${x(lowAt)}" cy="${yh(low)}" r="2.6" fill="${css("--heart")}" class="fadein" style="--i:3"/>`, `low ${Math.round(low)}<small>at ${clock(D.s.onset + lowAt)}</small>`]);
  const yv = sc(8, 46, H - 3, 3);
  rows.push(["HRV", "hrv", `<g class="fadein" style="--i:2">${D.bursts.map((b) => `<circle cx="${x(b.m).toFixed(1)}" cy="${yv(b.rmssd).toFixed(1)}" r="${b.ok ? 2.3 : 1.7}" fill="${b.ok ? css("--hrv") : "none"}" stroke="${b.ok ? "none" : css("--ink3")}"/>`).join("")}</g>`, `${D.hrv.toFixed(0)} ms<small>${D.good.length}/${D.bursts.length} clean</small>`]);
  rows.push(["Breath", "breath", line(D.good.map((b) => [x(b.m), sc(12.5, 19, H - 3, 3)(b.br)]), css("--breath"), 3), `${median(D.good.map((b) => b.br)).toFixed(1)}/min<small>steady</small>`]);
  const ys = sc(92, 100, H - 2, 2);
  rows.push(["SpO₂", "spo2", `<g class="fadein" style="--i:4">${D.bursts.map((b) => `<circle cx="${x(b.m).toFixed(1)}" cy="${ys(b.spo2).toFixed(1)}" r="1.7" fill="${css("--spo2")}"/>`).join("")}</g>`, `${median(D.bursts.map((b) => b.spo2))}%<small>low ${Math.min(...D.bursts.map((b) => b.spo2))}</small>`]);
  rows.push(["Temp", "temp", line(D.bursts.map((b) => [x(b.m), sc(34, 36, H - 2, 2)(b.temp)]), css("--temp"), 5, true), `${sign(D.s.temp)}°<small>vs usual</small>`]);
  rows.push(["Rhythm", "", `<g class="fadein" style="--i:6">${D.good.map((b) => `<rect x="${(x(b.m) - 1).toFixed(1)}" y="9" width="2" height="12" rx="1" fill="${css("--good")}" opacity=".85"/>`).join("")}</g>`, `regular<small>${D.good.length}/${D.good.length} checked</small>`]);
  const hours = []; for (let t = Math.ceil(D.s.onset / 60) * 60; t < D.s.wake; t += 60) if ((t / 60) % 2 === 0) hours.push(t);
  const tax = S(W0, 14, hours.map((t) => `<text x="${x(t - D.s.onset)}" y="11" text-anchor="middle" class="axis">${clock(t).replace(":00", "")}</text>`).join(""));
  return `<div class="card mon rise" style="--i:4">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px"><span class="lbl">${ampm(D.s.onset)} – ${ampm(D.s.wake)}</span><span class="lbl" style="letter-spacing:.04em">tap a row</span></div>
    ${rows.map(([n, k, body, v]) => `<div class="ch ${k ? "tap" : ""}" ${k ? `data-open="${k}"` : ""}><span class="ch-n">${n}</span>${S(W0, H, body, 'preserveAspectRatio="none"')}<span class="ch-v">${v}</span></div>`).join("")}
    <div class="taxis"><span></span>${tax}<span></span></div></div>`;
}
function tile(key, label, value, unit, delta, viz, i) {
  const m = M[key];
  return `<div class="card tile tap rise" style="--i:${i};--tint:${css(m.color)}" data-open="${key}"><div class="t-h"><span class="t-l"><i></i>${label}</span>${q(m.q)}</div>
    <div class="tv">${value}<small>${unit}</small></div><div class="td">${delta}</div>${viz}</div>`;
}
function vRhr() {
  const W0 = 150, H = 50, x = sc(50, 72, 4, W0 - 4), past = D.hist.slice(-15, -1).map((h) => h.rhr), you = [median(past) - sd(past), median(past) + sd(past)];
  return S(W0, H, `<line x1="4" x2="${W0 - 4}" y1="24" y2="24" stroke="${css("--track")}" stroke-width="6" stroke-linecap="round"/>
    <rect x="${x(you[0])}" y="18" width="${x(you[1]) - x(you[0])}" height="12" rx="6" fill="${css("--heart")}" opacity=".25"/>
    ${past.map((v) => `<line x1="${x(v).toFixed(1)}" x2="${x(v).toFixed(1)}" y1="14" y2="34" stroke="${css("--heart")}" stroke-opacity=".35"/>`).join("")}
    <circle class="beat" style="--beat-s:${(60 / D.s.rhr).toFixed(2)}s" cx="${x(D.s.rhr)}" cy="24" r="6" fill="${css("--heart")}" stroke="${css("--bg")}" stroke-width="2"/>
    <text x="${x(you[0])}" y="48" class="axis">usual ${Math.round(you[0])}–${Math.round(you[1])}</text>`);
}
function vHrv() {
  const W0 = 150, H = 50, vals = D.hist.slice(-14).map((h) => h.hrv), x = sc(0, 13, 5, W0 - 5), y = sc(10, 46, H - 5, 5), e = expOf("hrv");
  return S(W0, H, `<rect x="0" width="${W0}" y="${y(e.hi)}" height="${y(e.lo) - y(e.hi)}" rx="6" fill="${css("--hrv")}" opacity=".13"/>
    <path class="draw" style="--i:3;--len:300" d="${smooth(vals.map((v, i) => [x(i), y(v)]))}" fill="none" stroke="${css("--hrv")}" stroke-opacity=".55" stroke-width="1.4"/>
    ${vals.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${i === 13 ? 4.5 : 2.2}" fill="${css("--hrv")}" ${i === 13 ? `stroke="${css("--bg")}" stroke-width="2"` : ""}/>`).join("")}`);
}
function vBreath() {
  const W0 = 150, H = 50, vals = D.hist.slice(-14).map((h) => h.br), x = sc(0, 13, 5, W0 - 5), y = sc(13.5, 18, H - 5, 5), id = `b${uid++}`;
  return S(W0, H, `<defs>${glowDef(id, 2)}</defs><path class="draw" style="--i:3;--len:300" d="${smooth(vals.map((v, i) => [x(i), y(v)]))}" fill="none" stroke="${css("--breath")}" stroke-width="2.2" stroke-linecap="round" ${glow(id)}/><circle cx="${x(13)}" cy="${y(vals[13])}" r="4" fill="${css("--breath")}"/>`);
}
function vSpo2() {
  const W0 = 150, H = 50, x = sc(0, D.N, 5, W0 - 5), y = sc(90, 100, H - 5, 5);
  return S(W0, H, `<rect x="0" width="${W0}" y="${y(100)}" height="${y(95) - y(100)}" rx="6" fill="${css("--spo2")}" opacity=".10"/>${D.bursts.map((b) => `<circle cx="${x(b.m).toFixed(1)}" cy="${y(b.spo2).toFixed(1)}" r="2.2" fill="${css("--spo2")}"/>`).join("")}<text x="${W0}" y="${y(95) + 11}" text-anchor="end" class="axis">95</text>`);
}
function vTemp() {
  const W0 = 150, H = 50, vals = D.hist.slice(-14).map((h) => h.tdev * 1.8), bw = W0 / 14, y0 = H / 2;
  return S(W0, H, `<line x1="0" x2="${W0}" y1="${y0}" y2="${y0}" stroke="${css("--track")}"/>` + vals.map((v, i) => { const h = Math.max(1.5, Math.min(22, Math.abs(v) * 20)); return `<rect x="${(i * bw + 1.6).toFixed(1)}" y="${(v >= 0 ? y0 - h : y0).toFixed(1)}" width="${(bw - 3.2).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${css(v >= 0.5 ? "--bad" : "--temp")}" opacity="${i === 13 ? 1 : 0.5}"/>`; }).join(""));
}
function vSteps() {
  const W0 = 150, H = 50, bw = W0 / 24, max = Math.max(...D.stepsHour, ...D.typical, 1);
  const bar = (v, i, fill, op) => (v ? `<rect x="${(i * bw + 0.9).toFixed(1)}" y="${(H - 3 - (v / max) * (H - 8)).toFixed(1)}" width="${(bw - 1.8).toFixed(1)}" height="${((v / max) * (H - 8) + 3).toFixed(1)}" rx="1.5" fill="${fill}" opacity="${op}"/>` : "");
  return S(W0, H, D.typical.map((v, i) => bar(v, i, css("--ink3"), 0.2)).join("") + D.stepsHour.map((v, i) => bar(v, i, css("--steps"), 1)).join(""));
}
function tiles() {
  const s = D.s, rough = scen === "rough", e = expOf("hrv"), rhrU = median(D.hist.slice(-29, -1).map((h) => h.rhr));
  const inside = D.hrv >= e.lo && D.hrv <= e.hi;
  return `<div class="tiles">
    ${tile("rhr", "Resting HR", s.rhr.toFixed(1), "bpm", rough ? `<span class="dn">▲ ${(s.rhr - rhrU).toFixed(0)}</span> over your usual` : `right at your usual`, vRhr(), 5)}
    ${tile("hrv", "Overnight HRV", D.hrv.toFixed(0), "ms", `${inside ? `<span class="up">within</span>` : `<span class="warn">${D.hrv < e.lo ? "below" : "above"}</span>`} expected ${e.lo.toFixed(0)}–${e.hi.toFixed(0)}`, vHrv(), 6)}
    ${tile("breath", "Breathing", median(D.good.map((b) => b.br)).toFixed(1), "/min", rough ? `<span class="warn">+1.2</span> vs usual` : `steady · usual 14.6–15.4`, vBreath(), 7)}
    ${tile("spo2", "Oxygen asleep", median(D.bursts.map((b) => b.spo2)), "%", `lowest ${Math.min(...D.bursts.map((b) => b.spo2))}% · ${D.bursts.length} readings`, vSpo2(), 8)}
    ${tile("temp", "Skin temp", sign(s.temp), "°F", rough ? `<span class="warn">2nd warm night</span>` : `no warming trend`, vTemp(), 9)}
    ${tile("steps", "Steps today", s.steps.toLocaleString(), "", `goal 8,000 · vs typical day`, vSteps(), 10)}
  </div>`;
}
function today() {
  const L = W.DRAWS[W.DRAWS.length - 1].v, P = W.DRAWS[W.DRAWS.length - 2].v;
  const lab = (n, k, u, flag, cls) => `<div class="lab" data-goto="labs"><div class="n">${n}</div><div class="v num">${L[k]}<small>${u}</small></div><div class="f ${cls}">${flag} · ${L[k] < P[k] ? "↓" : "↑"} from ${P[k]}</div></div>`;
  return `<div class="hd rise" style="--i:0"><div><div class="lbl">Thursday · Sep 24</div><h1>Good morning, ${me.name}</h1></div><div class="avatar" data-goto="profile">${me.name[0]}</div></div>
    <div class="sync rise" style="--i:0"><i></i>Synced 4 min ago · V5 ${me.name} · 92%</div>
    ${hero()}
    ${prompts() ? `<div style="margin-top:12px">${prompts()}</div>` : ""}
    <div class="sec rise" style="--i:4"><h2>Last night</h2><span class="lbl">7 channels</span></div>
    ${montage()}
    <div class="sec rise" style="--i:5"><h2>Vitals</h2><span class="lbl">vs your usual</span></div>
    ${tiles()}
    <div class="sec rise" style="--i:11"><h2>Anything to note?</h2><span class="lbl">optional · last night</span></div>
    <div class="tags rise" style="--i:11">${[...W.TAGS, { key: "sick", label: "Sick" }, { key: "travel", label: "Travel" }, { key: "meds", label: "Meds change" }].map((t) => `<button class="chip ${userTags.has(t.key) ? "on" : ""}" data-tag="${t.key}">${t.label}</button>`).join("")}</div>
    <p class="note" style="margin:8px 4px 0">Tags let Pulse test what moves your numbers. See <b>What affects it</b> in any metric.</p>
    <div class="sec rise" style="--i:12"><h2>Labs</h2><span class="lbl">Quest · Sep 3</span></div>
    <div class="labs rise" style="--i:12">
      ${lab("LDL-C", "ldl", "mg/dL", "High", "hi")}${lab("HDL-C", "hdl", "mg/dL", "Normal", "ok")}${lab("Triglycerides", "tg", "mg/dL", "Normal", "ok")}${lab("hs-CRP", "hscrp", "mg/L", "Lower risk", "")}
    </div>
    <p class="note" style="text-align:center;margin-top:18px">Concept · synthetic data. Try Rough night, tap any tile, then the Measure and Profile tabs.</p>`;
}

// ---------- drill-down ----------
function bandsOf(key) {
  const m = M[key], ser = series(m), prior = ser.slice(-29, -1).map(m.get), cur = m.get(ser[ser.length - 1]);
  const you = [median(prior) - sd(prior), median(prior) + sd(prior)], e = expOf(key);
  return { m, ser, cur, you, e };
}
function bandRow(lbl, b, style, cur, lo, hi, m) {
  const W0 = 230, x = sc(lo, hi, 5, W0 - 5), fa = m.fa ?? m.f;
  return `<div class="band"><span>${lbl}</span>${S(W0, 20, `<line x1="5" x2="${W0 - 5}" y1="10" y2="10" stroke="${css("--track")}" stroke-width="3" stroke-linecap="round"/><rect x="${x(b[0])}" y="4" width="${Math.max(4, x(b[1]) - x(b[0]))}" height="12" rx="6" fill="${style === "pop" ? css("--ink3") : css(m.color)}" opacity="${style === "pop" ? 0.25 : style === "exp" ? 0.5 : 0.28}"/><circle cx="${x(cur)}" cy="10" r="5.5" fill="${css(m.color)}" stroke="${css("--bg")}" stroke-width="2"/>`)}<span class="bv">${fa(b[0])}–${fa(b[1])}</span></div>`;
}
function ctxText(key, B) {
  const { m, cur, you, e } = B, dSleep = D.last.sleepH - D.usualSleep;
  const sleepTxt = `You slept ${dur(dSleep)} ${dSleep < 0 ? "less" : "more"} than usual.`;
  if (e) {
    const inside = cur >= e.lo && cur <= e.hi, worse = m.better * (cur - e.center) < 0;
    const per = `In your data each hour of sleep moves ${m.lc} by ${Math.abs(e.slope).toFixed(1)} ${m.unit} (±${(1.96 * e.slopeSe).toFixed(1)}), so expected tonight is ${m.f(e.lo)}–${m.f(e.hi)} ${m.unit}.`;
    return `${sleepTxt} ${per} <b>${m.f(cur)} ${m.unit} is ${inside ? "inside that range" : cur < e.lo ? "below that range" : "above that range"}.</b>${!inside && worse ? ` Something besides sleep is likely involved. <button class="chip" style="margin-top:8px" data-close data-goto="tags">Tag last night</button>` : ""}`;
  }
  if (key === "sleep") return `${hm(cur)} asleep, ${dur(dSleep)} ${dSleep < 0 ? "under" : "over"} your usual ${hm(D.usualSleep)}. Adults 26–64 need 7–9 h (National Sleep Foundation).`;
  if (key === "recovery") return `A blend of four parts, each compared with your own last 28 nights. Open <b>Last night</b> to see every part and the math.`;
  if (key === "steps") return `${D.s.steps.toLocaleString()} so far today (${pct(D.s.pct / 100, 0)} of goal). Yesterday: <b>${m.f(cur)}</b>. Adults under 60 get most of the mortality benefit by ~8,000 a day (Paluch 2022).`;
  if (key === "spo2") return `Spot readings every 10 minutes. These can show a low night but can't count breathing pauses; that needs a sleep study or a 1-second oximeter.`;
  const inside = cur >= you[0] && cur <= you[1];
  return `${inside ? "Inside" : cur < you[0] ? "Below" : "Above"} your usual range (median ± one typical swing, last 28 nights).`;
}
function drill(key) {
  const B = bandsOf(key), { m, cur, you, e } = B;
  const cands = [cur, you[0], you[1], ...(m.pop ?? []), ...(e ? [e.lo, e.hi] : [])], span = Math.max(...cands) - Math.min(...cands);
  const lo = Math.min(...cands) - span * 0.1, hi = Math.max(...cands) + span * 0.1;
  const views = [["now", m.nowLbl], ["time", "Over time"], ["range", "Your range"], ["affects", "What affects it"]];
  const meta = key === "steps" ? `Yesterday, full day<br>${D.s.steps.toLocaleString()} so far today` : `Night of Sep 23 → 24<br>${["hrv", "breath", "spo2", "temp"].includes(key) ? `${D.good.length} of ${D.bursts.length} recordings clean` : key === "sleep" ? `${ampm(D.s.onset)} – ${ampm(D.s.wake)}` : "all sensors"}<br>${e ? (cur >= e.lo && cur <= e.hi ? "within expected" : cur < e.lo ? "below expected" : "above expected") : cur >= you[0] && cur <= you[1] ? "within your usual" : cur < you[0] ? "below your usual" : "above your usual"}`;
  return `<div class="aurora"><i class="a"></i><i class="b"></i><i class="c"></i></div><div class="inner">
    <div class="m-top"><button class="back" data-close>‹ Home</button>${q(m.q)}</div>
    <div class="lbl m-lbl">${m.title}${key === "steps" ? " · yesterday" : ""}</div>
    <div class="m-hero"><div class="m-big">${m.big ? m.big(cur) : `${m.f(cur)}<small>${m.unit}</small>`}</div><div class="m-meta">${meta}</div></div>
    <div class="bands">${m.pop ? bandRow(m.popLbl, m.pop, "pop", cur, lo, hi, m) : ""}${bandRow("Your usual", you, "you", cur, lo, hi, m)}${e ? bandRow("Expected tonight", [e.lo, e.hi], "exp", cur, lo, hi, m) : ""}</div>
    <div class="ctx">${ctxText(key, B)}</div>
    <div class="seg">${views.map(([k, l]) => `<button data-view="${k}" class="${view === k ? "on" : ""}">${l}</button>`).join("")}</div>
    ${view === "time" || view === "range" ? `<div class="agg">${view === "time" ? `<button data-split class="ov ${split ? "on" : ""}">Weekday vs weekend</button><button data-showtags class="ov ${showTags ? "on" : ""}">Tags</button><span class="grow"></span>` : ""}${[["30", "30D"], ["90", "90D"], ["365", "1Y"]].map(([k, l]) => `<button data-agg="${k}" class="${agg === k ? "on" : ""}">${l}</button>`).join("")}</div>` : ""}
    <div class="card viz">${renderView(key, B)}</div>
    ${explain(key)}</div>`;
}
function explain(key) {
  const txt = {
    hrv: `RMSSD (beat-to-beat variation) computed on your phone from the band's own ~80-second pulse recordings, every 10 minutes while you sleep. Movement artifacts are removed beat by beat (Lipponen & Tarvainen 2019); recordings with more than 20% corrected beats are dropped. The night's value is the median of the clean ones.`,
    rhr: `The lowest 30-minute average of the band's 5-second heart rate while asleep. Timing of the low point matters too: a late low often follows alcohol, a late meal or illness.`,
    breath: `Breaths per minute from the rhythmic speed-up and slow-down of your pulse with each breath (respiratory sinus arrhythmia), measured in each clean pulse recording. A rise of 1.5/min or more over your usual can come with illness.`,
    spo2: `The band's own blood-oxygen spot readings, every 10 minutes asleep. Healthy adults usually stay at 95% or above; brief dips to the low 90s happen.`,
    temp: `Skin temperature every 10 minutes, compared with your usual for the same part of the night. Two or more warm nights can come before a cold; alcohol and a warm room also raise it.`,
    sleep: `Sleep stages come from the band's own classifier (movement + heart rate). Stage minutes from wrist bands are rough; total sleep, timing and regularity are the reliable parts.`,
    recovery: `Recovery = 0.30 × HRV + 0.30 × resting HR + 0.15 × temperature + 0.25 × sleep. Each part is 70 at your usual and moves 15 points per typical swing (your own median and spread, last 28 nights).`,
    steps: `Per-minute step counts from the band. Walking briskly is about 100+ steps a minute (Tudor-Locke 2018); those minutes count toward the 150 a week of moderate activity.`,
  }[key];
  const raw = ["hrv", "breath", "spo2", "temp"].includes(key);
  const col = { hrv: (b) => `${b.rmssd.toFixed(1)} ms`, breath: (b) => `${b.br.toFixed(1)}/min`, spo2: (b) => `${b.spo2}%`, temp: (b) => `${(b.temp * 1.8 + 32).toFixed(1)} °F` }[key];
  return `<div class="sec"><h2>How it's measured</h2></div><div class="card explain"><p>${txt}</p><p>Bands: a population norm for your age and sex where one exists, your own usual (median ± a typical swing, last 28 nights), and, for HRV and resting HR, what last night's sleep predicts from your own history (80% range).</p></div>
    ${raw ? `<div class="sec"><h2>Raw evidence</h2><span class="lbl">${D.bursts.length} recordings</span></div>
    <div class="card bursts">${D.bursts.slice(0, 8).map((b) => `<div class="b"><span>${clock(D.s.onset + b.m)}</span><span>${b.beats} beats</span><span class="${b.ok ? "" : "rej"}">${col(b)}</span><span><span class="pill">${b.ok ? "kept" : "movement"}</span></span></div>`).join("")}<p class="note">…and ${D.bursts.length - 8} more</p></div>` : ""}`;
}

function renderView(key, B) {
  if (view === "now") return viewNow(key, B);
  if (view === "time") return viewTime(key, B);
  if (view === "range") return viewRange(key, B);
  return viewAffects(key, B);
}
function stageLanes(x, y0, laneH, gap, op = 0.9) {
  let out = "", start = 0; const lv = { 4: 0, 3: 1, 2: 2, 1: 3 };
  for (let i = 1; i <= D.stages.length; i++) if (i === D.stages.length || D.stages[i] !== D.stages[start]) {
    out += `<rect x="${x(start).toFixed(1)}" y="${(y0 + lv[D.stages[start]] * (laneH + gap)).toFixed(1)}" width="${Math.max(0.8, x(i) - x(start)).toFixed(1)}" height="${laneH}" rx="${Math.min(3, laneH / 2)}" fill="${stageColor(D.stages[start])}" opacity="${op}"/>`; start = i;
  }
  return out;
}
function viewNow(key, B) {
  const { m, you } = B, W0 = 340, col = css(m.color), id = `v${uid++}`, sid = `s${uid++}`;
  if (key === "recovery") {
    const p = D.last.parts, prior = D.hist.slice(-29, -1);
    const rows = [["HRV", "hrv", p.hrv, 0.3, `${D.last.hrv.toFixed(0)} ms vs ${median(prior.map((h) => h.hrv)).toFixed(0)}`], ["Resting HR", "rhr", p.rhr, 0.3, `${D.last.rhr.toFixed(1)} vs ${median(prior.map((h) => h.rhr)).toFixed(1)} bpm`], ["Temperature", "temp", p.temp, 0.15, `${sign(D.last.tdev * 1.8)} °F vs usual`], ["Sleep", "sleep", p.sleep, 0.25, `${hm(D.last.sleepH)} asleep`]];
    const x = sc(0, 100, 0, 150);
    return `${rows.map(([n, k, v, w, det]) => `<div class="part" data-open2="${k}"><div><b>${n}</b><span>${det}</span></div>${S(150, 16, `<rect x="0" y="4" width="150" height="8" rx="4" fill="${css("--track")}"/><rect x="0" y="4" width="${x(v).toFixed(1)}" height="8" rx="4" fill="${css(v >= 60 ? "--good" : v >= 45 ? "--watch" : "--bad")}"/><line x1="${x(70)}" x2="${x(70)}" y1="0" y2="16" stroke="${css("--ink")}" stroke-opacity=".5"/>`)}<em>${Math.round(v)}<small>× ${w.toFixed(2)}</small></em></div>`).join("")}
      <div class="sum">= ${rows.map(([, , v, w]) => (v * w).toFixed(1)).join(" + ")} = <b>${D.last.rec}</b></div>
      <p class="note">Each bar is one part's score; the tick at 70 is your usual. Tap a part for its own detail.</p>`;
  }
  if (key === "steps") {
    const H = 170, bw = (W0 - 30) / 24, max = Math.max(...D.stepsHour, ...D.typical, 1), y = sc(0, max, H - 22, 10), nowH = 9;
    let cum = 0, ct = 0; const cumPts = [], typPts = [];
    const tot = D.typical.reduce((a, b) => a + b, 0), yc = sc(0, tot, H - 22, 10);
    D.typical.forEach((v, i) => { ct += v; typPts.push([30 + (i + 1) * bw, yc(ct)]); });
    D.stepsHour.forEach((v, i) => { if (i <= nowH) { cum += v; cumPts.push([30 + (i + 1) * bw, yc(cum)]); } });
    const body = D.typical.map((v, i) => (v ? `<rect x="${(30 + i * bw + 1.5).toFixed(1)}" y="${y(v).toFixed(1)}" width="${(bw - 3).toFixed(1)}" height="${(y(0) - y(v)).toFixed(1)}" rx="2" fill="${css("--ink3")}" opacity=".18"/>` : "")).join("")
      + D.stepsHour.map((v, i) => (v ? `<rect x="${(30 + i * bw + 1.5).toFixed(1)}" y="${y(v).toFixed(1)}" width="${(bw - 3).toFixed(1)}" height="${(y(0) - y(v)).toFixed(1)}" rx="2" fill="${col}"/>` : "")).join("")
      + `<path d="${poly(typPts)}" fill="none" stroke="${css("--ink3")}" stroke-dasharray="3 3" stroke-width="1.3"/><path d="${poly(cumPts)}" fill="none" stroke="${css("--act")}" stroke-width="2.2"/>`
      + [0, 6, 12, 18].map((h) => `<text x="${30 + h * bw}" y="${H - 6}" class="axis">${h === 0 ? "12a" : h === 12 ? "12p" : h < 12 ? `${h}a` : `${h - 12}p`}</text>`).join("");
    const pts = D.stepsHour.map((v, i) => [30 + (i + 0.5) * bw, y(Math.max(v, D.typical[i])), `${i === 0 ? 12 : i > 12 ? i - 12 : i}${i < 12 ? " AM" : " PM"} · <b>${i <= nowH ? v.toLocaleString() : "—"}</b> steps · typical ${D.typical[i].toLocaleString()}`]);
    return scrubbable(sid, W0, H, body, pts, `Bars: steps each hour today. Grey: your typical day. Green line: today's running total vs typical (dashed).`) + `<p class="note">You're ${D.s.pct >= D.s.ghost * 100 ? "on" : "behind"} your usual pace for 9 AM.</p>`;
  }
  if (key === "sleep") {
    const H = 150, x = sc(0, D.N, 44, W0 - 6), laneH = 22, gap = 8;
    const body = stageLanes(x, 8, laneH, gap, 0.95) + ["Awake", "REM", "Light", "Deep"].map((n, i) => `<text x="0" y="${8 + i * (laneH + gap) + 15}" class="axis">${n}</text>`).join("")
      + [0, 2, 4, 6].map((hh) => { const t = D.s.onset + hh * 60; return t < D.s.wake ? `<text x="${x(hh * 60)}" y="${H - 4}" text-anchor="middle" class="axis">${clock(Math.round(t / 60) * 60).replace(":00", "")}</text>` : ""; }).join("");
    const pts = []; for (let i = 0; i < D.N; i += 3) pts.push([x(i), 8 + ({ 4: 0, 3: 1, 2: 2, 1: 3 }[D.stages[i]]) * (laneH + gap) + laneH / 2, `${ampm(D.s.onset + i)} · <b>${stageName[D.stages[i]]}</b>`]);
    const cnt = (s) => D.stages.filter((v) => v === s).length, tot = D.asleepMin;
    const wake = D.stages.reduce((a, v, i) => a + (v === 4 && i > 0 && D.stages[i - 1] !== 4 ? 1 : 0), 0);
    return scrubbable(sid, W0, H, body, pts, `Drag across the night to read each stage.`) + `<div class="stat4">${[[1, "Deep"], [3, "REM"], [2, "Light"], [4, "Awake"]].map(([s, n]) => `<div><i style="background:${stageColor(s)}"></i><b>${short(cnt(s))}</b><span>${n}${s !== 4 ? ` · ${Math.round((100 * cnt(s)) / tot)}%` : ` · ${wake}×`}</span></div>`).join("")}</div>
      <div class="stat3"><div><b>${((100 * tot) / D.N).toFixed(0)}%</b><span>efficiency</span></div><div><b>${cnt(4)} min</b><span>awake after onset</span></div><div><b>${clock(D.s.onset)}</b><span>fell asleep</span></div></div>`;
  }
  // PPI/HR channels over the night
  const H = 180, x = sc(0, D.N, 30, W0 - 6), ys = key === "hrv" ? [6, 46] : key === "rhr" ? [D.s.rhr - 6, D.s.rhr + 14] : key === "breath" ? [12, 19] : key === "spo2" ? [90, 100] : [-1.2, 1.2];
  const y = sc(ys[0], ys[1], H - 32, 10);
  const lv = { 4: 0, 3: 1, 2: 2, 1: 3 };
  let bg = "", start = 0;
  for (let i = 1; i <= D.stages.length; i++) if (i === D.stages.length || D.stages[i] !== D.stages[start]) { bg += `<rect x="${x(start).toFixed(1)}" y="${H - 26 + lv[D.stages[start]] * 5}" width="${Math.max(0.8, x(i) - x(start)).toFixed(1)}" height="4" rx="1.5" fill="${stageColor(D.stages[start])}" opacity=".9"/>`; start = i; }
  const pts = key === "hrv" ? D.bursts.map((b) => [b.m, b.rmssd, b.ok]) : key === "rhr" ? D.hr.map((v, i) => [i, v, true]).filter((_, i) => i % 4 === 0) : key === "breath" ? D.good.map((b) => [b.m, b.br, true]) : key === "spo2" ? D.bursts.map((b) => [b.m, b.spo2, true]) : D.bursts.map((b) => [b.m, (b.temp - 35) * 1.8, true]);
  const grid = [0, 1, 2, 3].map((k) => { const v = ys[0] + (k / 3) * (ys[1] - ys[0]); return `<line x1="30" x2="${W0 - 6}" y1="${y(v)}" y2="${y(v)}" stroke="${css("--grid")}"/><text x="24" y="${y(v) + 4}" text-anchor="end" class="axis">${m.f(v)}</text>`; }).join("");
  const okPts = pts.filter((p) => p[2]).map((p) => [x(p[0]), y(p[1])]);
  const band = key === "spo2" ? `<rect x="30" width="${W0 - 36}" y="${y(100)}" height="${y(95) - y(100)}" fill="${col}" opacity=".08"/>` : key === "temp" ? "" : `<rect x="30" width="${W0 - 36}" y="${y(Math.min(ys[1], you[1]))}" height="${Math.max(0, y(Math.max(ys[0], you[0])) - y(Math.min(ys[1], you[1])))}" fill="${col}" opacity=".1"/>`;
  const body = `<defs>${glowDef(id, 2.4)}</defs>${grid}${band}${bg}
      ${key === "spo2" ? "" : `<path class="draw" style="--len:900" d="${smooth(okPts)}" fill="none" stroke="${col}" stroke-width="${key === "rhr" ? 2 : 1.4}" stroke-opacity="${key === "rhr" ? 1 : 0.55}" ${key === "rhr" ? glow(id) : ""}/>`}
      ${key === "rhr" ? "" : pts.map((p) => `<circle cx="${x(p[0]).toFixed(1)}" cy="${y(p[1]).toFixed(1)}" r="${p[2] ? 3.3 : 2.6}" fill="${p[2] ? col : "none"}" stroke="${p[2] ? css("--bg") : css("--ink3")}" stroke-width="${p[2] ? 1.5 : 1}" class="fadein"/>`).join("")}`;
  const sp = pts.map((p) => [x(p[0]), y(p[1]), `${ampm(D.s.onset + p[0])} · <b>${m.f(p[1])} ${m.unit}</b> · ${stageName[D.stages[Math.min(D.N - 1, p[0])]]}${p[2] ? "" : " · dropped (movement)"}`]);
  return scrubbable(sid, W0, H, body, sp, `Drag across the chart to read any moment.`)
    + `<p class="note">Every ${key === "rhr" ? "few minutes" : "pulse recording"} across the night, over your sleep stages${key === "hrv" ? ". Hollow dots were dropped for movement" : ""}${key === "temp" ? " (°F vs your usual)" : "; the shaded band is your usual"}.</p>`;
}
function tagColor(k) { return css({ alcohol: "--bad", caffeine: "--watch", stress: "--breath", workout: "--act" }[k]); }
function viewTime(key, B) {
  const { m, you } = B, W0 = 340, col = css(m.color), id = `v${uid++}`, sid = `s${uid++}`;
  const n = +agg, hs = B.ser.slice(-n), ser = hs.map(m.get), H = 206, tagRow = showTags ? 18 : 0;
  const x = sc(0, n - 1, 30, W0 - 6), lo = Math.min(...ser, ...(m.pop ?? [ser[0]])), hi = Math.max(...ser, ...(m.pop ?? [ser[0]])), y = sc(lo, hi, H - 26 - tagRow, 10);
  const roll = ser.map((_, i) => mean(ser.slice(Math.max(0, i - 6), i + 1)));
  const wk = hs.map((h) => h.wkend);
  let body = `<defs>${glowDef(id, 2.6)}</defs>${m.pop ? `<rect x="30" width="${W0 - 36}" y="${y(m.pop[1])}" height="${y(m.pop[0]) - y(m.pop[1])}" fill="${css("--ink3")}" opacity=".07"/>` : ""}
      <rect x="30" width="${W0 - 36}" y="${y(you[1])}" height="${y(you[0]) - y(you[1])}" fill="${col}" opacity=".13"/>
      ${[lo, (lo + hi) / 2, hi].map((v) => `<text x="24" y="${y(v) + 4}" text-anchor="end" class="axis">${(m.fa ?? m.f)(v)}</text>`).join("")}`;
  const dotR = n > 100 ? 1.3 : 2.1;
  if (split) {
    const a = ser.filter((_, i) => !wk[i]), b = ser.filter((_, i) => wk[i]);
    body += ser.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${dotR + 0.3}" fill="${wk[i] ? css("--watch") : col}" opacity="${wk[i] ? 0.85 : 0.45}"/>`).join("")
      + `<line x1="30" x2="${W0 - 6}" y1="${y(mean(a))}" y2="${y(mean(a))}" stroke="${col}" stroke-width="2"/><line x1="30" x2="${W0 - 6}" y1="${y(mean(b))}" y2="${y(mean(b))}" stroke="${css("--watch")}" stroke-width="2"/>`;
  } else {
    body += ser.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${dotR}" fill="${col}" opacity=".4"/>`).join("")
      + `<path class="draw" style="--len:1400" d="${smooth(roll.map((v, i) => [x(i), y(v)]), 0.12)}" fill="none" stroke="${col}" stroke-width="2.4" ${glow(id)}/>`;
  }
  if (showTags) {
    const ty = H - 22 - tagRow + 6;
    body += `<text x="24" y="${ty + 5}" text-anchor="end" class="axis">tags</text>` + hs.map((h, i) => (h.logged ? W.TAGS.filter((t) => h.t[t.key]).map((t, j) => `<rect x="${(x(i) - 1.2).toFixed(1)}" y="${ty - 2 + j * 3}" width="2.4" height="${n > 100 ? 5 : 7}" rx="1" fill="${tagColor(t.key)}"/>`).join("") : "")).join("");
    const firstLogged = hs.findIndex((h) => h.logged);
    if (firstLogged > 0) body += `<line x1="${x(firstLogged)}" x2="${x(firstLogged)}" y1="10" y2="${H - 22}" stroke="${css("--ink3")}" stroke-opacity=".35"/><text x="${x(firstLogged) + 4}" y="20" class="axis">tagging started</text>`;
  }
  if (n === 365 && (key === "rhr" || key === "hrv")) {
    for (const dr of W.DRAWS) { const i = hs.findIndex((h) => h.d.toISOString().slice(0, 10) >= dr.date); if (i >= 0) body += `<line x1="${x(i)}" x2="${x(i)}" y1="10" y2="${H - 22}" stroke="${css("--ink")}" stroke-opacity=".35" stroke-dasharray="2 3"/><text x="${x(i)}" y="8" text-anchor="middle" class="axis">labs</text>`; }
  }
  const step = n > 100 ? 91 : n > 60 ? 30 : 7;
  for (let i = n - 1; i >= 0; i -= step) body += `<text x="${x(i)}" y="${H - 4}" text-anchor="middle" class="axis">${MON[hs[i].d.getMonth()]} ${hs[i].d.getDate()}</text>`;
  const sp = hs.map((h, i) => [x(i), y(ser[i]), `${dname(h.d)} · <b>${m.f(ser[i])} ${m.unit}</b>${h.logged ? W.TAGS.filter((t) => h.t[t.key]).map((t) => ` · ${t.label}`).join("") : ""}${h.sick ? " · Sick" : ""}`]);
  const a = ser.filter((_, i) => !wk[i]), b = ser.filter((_, i) => wk[i]), dW = mean(b) - mean(a);
  return scrubbable(sid, W0, H, body, sp, split ? `<span class="key" style="--k:${col}">weeknights ${m.f(mean(a))}</span><span class="key" style="--k:${css("--watch")}">Fri–Sat nights ${m.f(mean(b))}</span>` : `Dots are nights; the line is the 7-night average.`)
    + `<div class="stat3"><div><b>${(m.fa ?? m.f)(mean(ser))}</b><span>average</span></div><div><b>${((100 * sd(ser)) / Math.abs(mean(ser))).toFixed(0)}%</b><span>night-to-night CV</span></div><div><b>${sign(dW, key === "steps" ? 0 : 1)}</b><span>weekend vs weekday</span></div></div>
      <p class="note">Colored band: your usual.${m.pop ? ` Grey: ${m.popLbl.toLowerCase()}.` : ""}${showTags ? " Tag ticks: " + W.TAGS.map((t) => `<span class="key" style="--k:${tagColor(t.key)}">${t.label.toLowerCase()}</span>`).join(" ") : ""}${n === 365 && (key === "rhr" || key === "hrv") ? " Dashed lines: lab draws." : ""}</p>`;
}
function viewRange(key, B) {
  const { m, you } = B, W0 = 340, col = css(m.color);
  const n = +agg, ser = B.ser.slice(-n).map(m.get), H = 190, bins = 16;
  const lo = Math.min(...ser), hi = Math.max(...ser), bw = (hi - lo) / bins || 1, counts = new Array(bins).fill(0);
  ser.forEach((v) => counts[Math.min(bins - 1, Math.floor((v - lo) / bw))]++);
  const x = sc(lo, hi, 20, W0 - 10), cmax = Math.max(...counts), y = sc(0, cmax, H - 50, 18), sorted = [...ser].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(n * 0.25)], q3 = sorted[Math.floor(n * 0.75)], md = median(ser), cur = B.cur, p = Math.round((100 * sorted.filter((v) => v <= cur).length) / sorted.length);
  const clampX = (v) => Math.max(20, Math.min(W0 - 10, x(v)));
  const rowY = H - 30;
  return S(W0, H, counts.map((c, i) => `<rect x="${(x(lo + i * bw) + 1).toFixed(1)}" y="${y(c).toFixed(1)}" width="${Math.max(1, x(lo + bw) - x(lo) - 2).toFixed(1)}" height="${(y(0) - y(c)).toFixed(1)}" rx="3" fill="${col}" opacity="${lo + (i + 0.5) * bw >= q1 && lo + (i + 0.5) * bw <= q3 ? 0.8 : 0.3}"/>`).join("")
    + `<line x1="${x(md)}" x2="${x(md)}" y1="14" y2="${H - 48}" stroke="${css("--ink2")}" stroke-width="1.2"/><text x="${x(md)}" y="11" text-anchor="middle" class="axis">median ${(m.fa ?? m.f)(md)}</text>`
    + (m.pop ? `<rect x="${clampX(m.pop[0])}" y="${rowY - 4}" width="${Math.max(2, clampX(m.pop[1]) - clampX(m.pop[0]))}" height="8" rx="4" fill="${css("--ink3")}" opacity=".3"/>` : "")
    + `<rect x="${clampX(you[0])}" y="${rowY + 8}" width="${Math.max(2, clampX(you[1]) - clampX(you[0]))}" height="8" rx="4" fill="${col}" opacity=".45"/>`
    + `<circle cx="${clampX(cur)}" cy="${rowY + 6}" r="6" fill="${col}" stroke="${css("--bg")}" stroke-width="2"/><text x="${clampX(cur)}" y="${H - 2}" text-anchor="middle" class="axis">${m.yesterday ? "yesterday" : "last night"}</text>`)
    + `<div class="stat3"><div><b>${(m.fa ?? m.f)(q1)}–${(m.fa ?? m.f)(q3)}</b><span>your middle half</span></div><div><b>${(m.fa ?? m.f)(sd(ser))}</b><span>typical swing (SD)</span></div><div><b>${ord(p)}</b><span>percentile</span></div></div>
      <p class="note">Your last ${n} ${key === "steps" ? "days" : "nights"}. ${m.yesterday ? "Yesterday" : "Last night"} sits at the <b>${ord(p)} percentile</b> of your own history.${m.pop ? ` The grey bar under the histogram is the ${m.popLbl.toLowerCase()} range; the colored one is your usual.` : ""}</p>`;
}
function viewAffects(key, B) {
  const { m } = B, W0 = 340, H = 180;
  const list = W.drivers(D.hist, m.get, m.drivers);
  const tagged = D.hist.filter((h) => h.logged && W.TAGS.some((t) => h.t[t.key])).length, logged = D.hist.filter((h) => h.logged).length;
  const shown = list.filter((d) => d.state !== "needs");
  const ext = Math.max(0.5, ...shown.map((d) => Math.abs(d.effect) + d.ci)), xs = sc(-ext, ext, 2, 118);
  const good = (e) => (m.better === 0 ? null : m.better * e > 0);
  const row = (d) => {
    if (d.state === "needs") return `<div class="drv needs"><span>${d.label}<span class="n">${d.n} of ${W.MIN_TAGGED} tagged nights</span></span><span class="meter">${Array.from({ length: W.MIN_TAGGED }, (_, i) => `<i class="${i < d.n ? "on" : ""}"></i>`).join("")}</span><span class="e muted">tag ${d.need} more</span></div>`;
    const g = good(d.effect), fill = d.state === "clear" ? css(g == null ? "--ink2" : g ? "--good" : "--bad") : css("--ink3");
    const unit = key === "sleep" ? "h" : m.unit;
    return `<div class="drv ${d.state}"><span>${d.label}<span class="n">${d.note}${d.state === "unclear" ? " · no clear effect yet" : ""}</span></span>${S(120, 14, `<line x1="60" x2="60" y1="0" y2="14" stroke="${css("--grid")}"/><line x1="${xs(d.effect - d.ci)}" x2="${xs(d.effect + d.ci)}" y1="7" y2="7" stroke="${css("--ink3")}" stroke-width="1.5"/>${d.state === "clear" ? `<rect x="${Math.min(60, xs(d.effect))}" y="2.5" width="${Math.abs(xs(d.effect) - 60)}" height="9" rx="3" fill="${fill}" opacity=".9"/>` : `<circle cx="${xs(d.effect)}" cy="7" r="3.5" fill="none" stroke="${fill}" stroke-width="1.5"/>`}`)}<span class="e ${d.state === "clear" ? "" : "muted"}">${d.state === "clear" ? `${sign(d.effect, key === "sleep" ? 2 : 1)}<small>${unit}</small>` : "±" + d.ci.toFixed(1)}</span></div>`;
  };
  let scatter = "";
  if (m.drivers.includes("sleep")) {
    const sc2 = D.hist.slice(-121, -1).filter((h) => !h.sick), vy = sc2.map(m.get), sx = sc(5, 9, 30, W0 - 6), sy = sc(Math.min(...vy), Math.max(...vy), H - 22, 10);
    const xm = mean(sc2.map((h) => h.sleepH)), ym = mean(vy), b = sc2.reduce((a, h, i) => a + (h.sleepH - xm) * (vy[i] - ym), 0) / sc2.reduce((a, h) => a + (h.sleepH - xm) ** 2, 0);
    const sid = `s${uid++}`;
    const body = sc2.map((h, i) => `<circle cx="${sx(h.sleepH).toFixed(1)}" cy="${sy(vy[i]).toFixed(1)}" r="2.6" fill="${h.logged && h.t.alcohol ? css("--bad") : css(m.color)}" opacity="${h.logged && h.t.alcohol ? 0.9 : 0.45}"/>`).join("")
      + `<path d="M${sx(5)},${sy(ym + b * (5 - xm))}L${sx(9)},${sy(ym + b * (9 - xm))}" stroke="${css("--ink")}" stroke-opacity=".6" stroke-width="1.6"/>` + [5, 6, 7, 8, 9].map((hh) => `<text x="${sx(hh)}" y="${H - 4}" text-anchor="middle" class="axis">${hh}h</text>`).join("")
      + [Math.min(...vy), Math.max(...vy)].map((v) => `<text x="24" y="${sy(v) + 4}" text-anchor="end" class="axis">${(m.fa ?? m.f)(v)}</text>`).join("");
    scatter = `<div class="sub-h">Sleep length vs ${m.lc}</div>` + scrubbable(sid, W0, H, body, sc2.map((h, i) => [sx(h.sleepH), sy(vy[i]), `${dname(h.d)} · ${hm(h.sleepH)} sleep · <b>${m.f(vy[i])} ${m.unit}</b>${h.logged && h.t.alcohol ? " · alcohol" : ""}`]), `Each dot is a night. <span class="key" style="--k:${css("--bad")}">alcohol-tagged</span>`);
  }
  return `<p class="lead">You've tagged <b>${tagged}</b> of the last ${logged} nights. An effect shows only once there's enough data, and it's called clear only when its 95% range stays on one side of zero.</p>
    <div>${list.map(row).join("")}</div>
    <p class="note">Effect on your ${m.lc} per tagged night${m.drivers.includes("sleep") && key !== "sleep" ? ", adjusted for sleep length" : ""}, with 95% ranges. From your own nights: associations, not proof of cause. Nights tagged sick are left out.</p>
    ${scatter ? `<div style="margin-top:14px">${scatter}</div>` : ""}`;
}

// ---------- Measure: ECG ----------
let ECG = null;
function analyze() {
  if (ECG) return ECG;
  const t0 = performance.now(), fs = 256, settle = 5;
  const raw = synthEcg({ seed: 13 });
  const x = raw.x.slice(settle * fs);
  const s = ecgSummary(raw.x, fs, settle), bp = bandpass(x);
  const adv = advancedHRV(s.rr), edr = edrFusion(s.peaks, s.good, bp, fs);
  const mrr = mean(s.rr), mf = morphologyFilter(x, fs), mb = medianBeat(mf, s.peaks, s.good, fs, mrr);
  // interval-level flags (same rules as rrClean) for the tachogram
  const iv = [];
  for (let i = 1; i < s.peaks.length; i++) iv.push({ t: s.peaks[i] / fs, v: ((s.peaks[i] - s.peaks[i - 1]) * 1000) / fs });
  iv.forEach((r, i) => { const nb = iv.slice(Math.max(0, i - 2), i + 3).map((z) => z.v).sort((a, b) => a - b), med = nb[nb.length >> 1]; r.ok = s.good[i] && s.good[i + 1] && r.v >= 300 && r.v <= 2000 && Math.abs(r.v - med) <= 0.2 * med; });
  ECG = { fs, x: mf, s, adv, edr, mb, iv, ms: performance.now() - t0, dur: x.length / fs };
  return ECG;
}
function ecgTrace() {
  const E = analyze(), W0 = 340, H = 150, win = 8, fs = E.fs, a = Math.round(ecgStart * fs), b = Math.min(E.x.length, a + win * fs);
  const lo = -0.45, hi = 0.85, x = sc(0, win, 0, W0), y = sc(lo, hi, H, 0);
  let grid = "";
  for (let t = 0; t <= win + 1e-9; t += 0.2) grid += `<line x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="0" y2="${H}" stroke="${css("--heart")}" stroke-opacity="${Math.abs(t - Math.round(t)) < 1e-6 ? 0.32 : 0.12}"/>`;
  for (let v = -0.4; v <= 0.8 + 1e-9; v += 0.1) grid += `<line x1="0" x2="${W0}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${css("--heart")}" stroke-opacity="${Math.abs(v * 2 - Math.round(v * 2)) < 1e-6 ? 0.32 : 0.12}"/>`;
  const pts = []; for (let i = a; i < b; i += 1) pts.push([x((i - a) / fs), y(Math.max(lo, Math.min(hi, E.x[i])))]);
  const marks = E.s.peaks.map((p, k) => [p, k]).filter(([p]) => p >= a && p < b).map(([p, k]) => `<circle cx="${x((p - a) / fs).toFixed(1)}" cy="8" r="3" fill="${E.s.good[k] ? css("--good") : css("--bad")}"/>`).join("");
  const early = E.iv.find((r) => !r.ok && r.t >= ecgStart && r.t < ecgStart + win);
  return `<div class="ecg">${S(W0, H, `${grid}<path d="${poly(pts)}" fill="none" stroke="${css("--ink")}" stroke-width="1.3" stroke-linejoin="round"/>${marks}`)}</div>
    <div class="ecg-cap"><span>${ecgStart.toFixed(0)}–${(ecgStart + win).toFixed(0)} s</span><span>1 s · 0.5 mV per large square</span></div>
    ${early ? `<p class="flag">Red dot: a beat that didn't match your usual shape (an early, wide beat). It and its neighbours are left out of HRV.</p>` : ""}`;
}
function ecgOverview() {
  const E = analyze(), W0 = 340, H = 44, n = E.x.length, px = W0, per = Math.floor(n / px);
  let top = "", bot = "";
  for (let c = 0; c < px; c++) { let mn = Infinity, mx = -Infinity; for (let i = c * per; i < (c + 1) * per; i++) { mn = Math.min(mn, E.x[i]); mx = Math.max(mx, E.x[i]); } top += `${c ? "L" : "M"}${c},${sc(-0.5, 0.9, H - 4, 4)(mx).toFixed(1)}`; bot = `L${c},${sc(-0.5, 0.9, H - 4, 4)(mn).toFixed(1)}` + bot; }
  const x = sc(0, E.dur, 0, W0), flags = E.iv.filter((r) => !r.ok).map((r) => `<rect x="${(x(r.t) - 1).toFixed(1)}" y="0" width="2" height="${H}" fill="${css("--bad")}" opacity=".6"/>`).join("");
  return `<div class="ov-strip" data-ecgov>${S(W0, H, `<path d="${top}${bot}Z" fill="${css("--ink3")}" opacity=".55"/>${flags}<rect class="win" x="${x(ecgStart).toFixed(1)}" y="1" width="${(x(8) - x(0)).toFixed(1)}" height="${H - 2}" rx="5" fill="${css("--heart")}" fill-opacity=".12" stroke="${css("--heart")}" stroke-width="1.5"/>`)}</div>
    <div class="ecg-cap"><span>Drag the window · 2 min</span><span>Jump to <button class="link" data-jump="early">early beat</button> · <button class="link" data-jump="move">movement</button></span></div>`;
}
function hrvPanel() {
  const E = analyze(), a = E.adv, h = E.s.hrv, W0 = 340;
  const tabs = [["time", "Beat to beat"], ["spectrum", "Rhythms"], ["poincare", "Poincaré"], ["complexity", "Complexity"]];
  let body = "";
  if (hrvTab === "time") {
    const H = 150, ok = E.iv.filter((r) => r.ok), x = sc(0, E.dur, 30, W0 - 4), vals = E.iv.map((r) => r.v), lo = Math.min(...ok.map((r) => r.v)) - 40, hi = Math.max(...ok.map((r) => r.v)) + 40, y = sc(lo, hi, H - 18, 6);
    const sid = `s${uid++}`;
    const svgb = [lo + 40, (lo + hi) / 2, hi - 40].map((v) => `<line x1="30" x2="${W0 - 4}" y1="${y(v)}" y2="${y(v)}" stroke="${css("--grid")}"/><text x="26" y="${y(v) + 4}" text-anchor="end" class="axis">${v.toFixed(0)}</text>`).join("")
      + `<path d="${poly(ok.map((r) => [x(r.t), y(r.v)]))}" fill="none" stroke="${css("--hrv")}" stroke-width="1.4"/>` + E.iv.filter((r) => !r.ok).map((r) => `<circle cx="${x(r.t).toFixed(1)}" cy="${y(Math.max(lo, Math.min(hi, r.v))).toFixed(1)}" r="3" fill="none" stroke="${css("--bad")}" stroke-width="1.4"/>`).join("")
      + [0, 30, 60, 90].map((t) => `<text x="${x(t)}" y="${H - 2}" text-anchor="middle" class="axis">${t}s</text>`).join("");
    body = scrubbable(sid, W0, H, svgb, E.iv.map((r) => [x(r.t), y(Math.max(lo, Math.min(hi, r.v))), `${r.t.toFixed(1)} s · <b>${r.v.toFixed(0)} ms</b> (${(60000 / r.v).toFixed(0)} bpm)${r.ok ? "" : " · left out"}`]), `Time between beats (ms). The wave is your breathing speeding and slowing the heart.`)
      + stats([[h.rmssd.toFixed(1), "RMSSD ms"], [h.sdnn.toFixed(1), "SDNN ms"], [h.pnn50.toFixed(1) + "%", "pNN50"], [a.cvnn.toFixed(1) + "%", "CVNN"], [h.stress_index.toFixed(0), "Baevsky SI"], [h.hr.toFixed(0), "mean bpm"]]);
  } else if (hrvTab === "spectrum") {
    const sp = a.spectrum, H = 160, x = sc(0, 0.5, 30, W0 - 4), pmax = Math.max(...sp.psd.filter((_, i) => sp.freqs[i] > 0.035)), y = sc(0, pmax * 1.1, H - 20, 8);
    const pts = sp.freqs.map((f, i) => [x(f), y(Math.min(pmax * 1.1, sp.psd[i]))]);
    const zone = (a0, a1, c, l) => `<rect x="${x(a0)}" y="8" width="${x(a1) - x(a0)}" height="${H - 28}" fill="${css(c)}" opacity=".09"/><text x="${(x(a0) + x(a1)) / 2}" y="20" text-anchor="middle" class="axis">${l}</text>`;
    const sid = `s${uid++}`;
    const svgb = zone(0.0033, 0.04, "--ink3", "VLF") + zone(0.04, 0.15, "--temp", "LF") + zone(0.15, 0.4, "--breath", "HF")
      + `<path d="${poly(pts)}L${x(0.5)},${y(0)}L${x(0)},${y(0)}Z" fill="${css("--hrv")}" opacity=".18"/><path d="${poly(pts)}" fill="none" stroke="${css("--hrv")}" stroke-width="1.6"/>`
      + `<line x1="${x(sp.hfPeak)}" x2="${x(sp.hfPeak)}" y1="26" y2="${H - 20}" stroke="${css("--breath")}" stroke-width="1.2"/><text x="${x(sp.hfPeak) + 4}" y="36" class="axis">${(sp.hfPeak * 60).toFixed(1)} breaths/min</text>`
      + [0, 0.1, 0.2, 0.3, 0.4, 0.5].map((f) => `<text x="${x(f)}" y="${H - 4}" text-anchor="middle" class="axis">${f}</text>`).join("");
    body = scrubbable(sid, W0, H, svgb, sp.freqs.filter((_, i) => i % 2 === 0).map((f) => { const i = sp.freqs.indexOf(f); return [x(f), y(Math.min(pmax * 1.1, sp.psd[i])), `${f.toFixed(3)} Hz (${(f * 60).toFixed(1)}/min) · <b>${sp.psd[i].toFixed(0)} ms²/Hz</b>`]; }), `Power by rhythm speed (Hz). HF = breathing; LF = slower blood-pressure waves.`)
      + stats([[sp.lnHf.toFixed(2), "ln HF (ms²)"], [sp.lnLf.toFixed(2), "ln LF (ms²)"], [sp.lfhf.toFixed(2), "LF/HF"], [sp.hfnu.toFixed(0), "HF n.u."], [(sp.hfPeak * 60).toFixed(1), "HF peak /min"], [`${Math.round(sp.duration)} s`, "clean length"]])
      + `<p class="note">Lomb-Scargle spectrum of the beat intervals (no resampling). HF needs 1 min and LF 2 min of clean beats (Baek 2015): ${sp.hfValid ? "✓" : "✗"} HF, ${sp.lfValid ? "✓" : "✗"} LF. LF/HF is shown for completeness; it is not a reliable "stress balance" meter (Billman 2013).</p>`;
  } else if (hrvTab === "poincare") {
    const rr = E.s.rr, H = 250, lo = Math.min(...rr) - 30, hi = Math.max(...rr) + 30, x = sc(lo, hi, 36, W0 - 60), y = sc(lo, hi, H - 20, 10), p = a.poincare, m = mean(rr), k = (x(hi) - x(lo)) / (hi - lo);
    body = S(W0, H, `<line x1="${x(lo)}" y1="${y(lo)}" x2="${x(hi)}" y2="${y(hi)}" stroke="${css("--grid")}" stroke-width="1.5"/>`
      + rr.slice(0, -1).map((v, i) => `<circle cx="${x(v).toFixed(1)}" cy="${y(rr[i + 1]).toFixed(1)}" r="2.6" fill="${css("--hrv")}" opacity=".55"/>`).join("")
      + `<ellipse cx="${x(m)}" cy="${y(m)}" rx="${(p.sd2 * k * 1.5).toFixed(1)}" ry="${(p.sd1 * k * 1.5).toFixed(1)}" transform="rotate(-45 ${x(m)} ${y(m)})" fill="${css("--hrv")}" fill-opacity=".08" stroke="${css("--hrv")}" stroke-width="1.5"/>`
      + `<text x="${x(hi)}" y="${y(hi) - 6}" text-anchor="end" class="axis">RRₙ₊₁ = RRₙ</text><text x="${x(lo)}" y="${H - 4}" class="axis">RRₙ (ms) →</text>`)
      + stats([[p.sd1.toFixed(1), "SD1 ms (short-term)"], [p.sd2.toFixed(1), "SD2 ms (long-term)"], [p.ratio.toFixed(2), "SD1/SD2"], [p.csi.toFixed(2), "CSI"], [p.cvi.toFixed(2), "CVI"], [(p.area / 1000).toFixed(1) + "k", "ellipse ms²"]])
      + `<p class="note">Each dot plots one beat interval against the next. The ellipse's width (SD1) is quick beat-to-beat change; its length (SD2) is slower drift (Brennan 2001).</p>`;
  } else {
    const scale = (lbl, v, lo, hi, marks, txt, fmt = (z) => z.toFixed(2)) => { const x = sc(lo, hi, 6, 214); return `<div class="scale"><div class="sc-h"><b>${lbl}</b><em>${fmt(v)}</em></div>${S(220, 26, `<rect x="6" y="9" width="208" height="6" rx="3" fill="${css("--track")}"/>${marks.map(([a0, a1, c]) => `<rect x="${x(a0)}" y="9" width="${x(a1) - x(a0)}" height="6" rx="3" fill="${css(c)}" opacity=".55"/>`).join("")}<circle cx="${Math.max(6, Math.min(214, x(v)))}" cy="12" r="6" fill="${css("--ink")}" stroke="${css("--bg")}" stroke-width="2"/><text x="6" y="26" class="axis">${lo}</text><text x="214" y="26" text-anchor="end" class="axis">${hi}</text>`)}<p>${txt}</p></div>`; };
    body = scale("DFA α1", a.dfa1, 0.3, 1.7, [[0.75, 1.25, "--good"]], `Fractal pattern of the beat intervals over 4–16 beats (Peng 1995). About 1.0 at healthy rest; drifts toward 0.5 (random) with exertion or irregular beats.`)
      + scale("Sample entropy", a.sampen, 0, 3, [[1, 2.2, "--good"]], `How unpredictable the rhythm is (Richman & Moorman 2000). Lower means more regular. Compare with your own recordings.`)
      + scale("Fragmentation (PIP)", a.fragmentation.pip, 30, 80, [], `Share of beats where the speed-up/slow-down direction flips (Costa 2017). Higher values are linked with ageing and heart disease; tracked against your own.`, (z) => `${z.toFixed(0)}%`)
      + `<p class="note">Each of these needs about 1.5–2 minutes of clean beats; Pulse hides them on shorter recordings.</p>`;
  }
  return `<div class="seg small">${tabs.map(([k, l]) => `<button data-hrvtab="${k}" class="${hrvTab === k ? "on" : ""}">${l}</button>`).join("")}</div>${body}`;
}
const stats = (arr) => `<div class="stat6">${arr.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join("")}</div>`;
function breathingPanel() {
  const E = analyze(), e = E.edr, W0 = 300, H = 26, ok = E.s.peaks.map((p, i) => ({ p, g: E.s.good[i] })).filter((b) => b.g && b.p / E.fs < 60);
  const sig = [ok.slice(1).map((b, i) => [b.p / E.fs, (b.p - ok[i].p) / E.fs]), ok.map((b) => [b.p / E.fs, Math.abs(E.x[b.p])]), ok.map((b) => { let m = 0; for (let k = b.p - 10; k < b.p + 10; k++) m = Math.max(m, Math.abs(E.x[k] - E.x[k - 1])); return [b.p / E.fs, m]; })];
  const maxW = Math.max(...e.channels.map((c) => c.weight ?? 0), 1);
  return `<div class="fuse">${e.channels.map((c, i) => { const v = sig[i].map((p) => p[1]), x = sc(0, 60, 0, W0), y = sc(Math.min(...v), Math.max(...v), H - 3, 3);
    return `<div class="fch"><div class="fch-h"><b>${c.name}</b><em>${c.rate != null ? `${c.rate.toFixed(1)}/min` : "—"}</em></div>${S(W0, H, `<path d="${smooth(sig[i].map((p) => [x(p[0]), y(p[1])]), 0.15)}" fill="none" stroke="${css("--breath")}" stroke-width="1.4"/>`, 'preserveAspectRatio="none"')}
      <div class="fch-w"><span>clarity ${(c.clarity ?? 0) > 99 ? "99+" : (c.clarity ?? 0).toFixed(0)}×</span><span class="wbar"><i style="width:${(100 * (c.weight ?? 0)) / maxW}%"></i></span><span>weight ${(c.weight ?? 0).toFixed(1)}</span></div></div>`; }).join("")}
    <div class="fused"><div><div class="lbl">Fused breathing rate</div><div class="num big2">${e.rate.toFixed(1)}<small>/min</small></div></div><div class="agree"><b>${e.channels.filter((c) => c.weight > 0).length} of 3</b> channels used<br>agreement ${Math.round(e.agreement * 100)}%</div></div>
    <p class="note">Three signals in the ECG move with each breath: beat timing, R-wave height and QRS steepness. Each is scored by how clear its rhythm is, and the rate is their weighted median, so one noisy signal can't drag it (Charlton 2016). Overnight, asleep, your pulse recordings gave ${D.last.br.toFixed(1)}/min.</p></div>`;
}
function beatPanel() {
  const E = analyze(), b = E.mb, W0 = 340, H = 170, L = b.template.length, ms = (k) => ((k - b.pre) * 1000) / b.fs;
  const x = sc(ms(0), ms(L - 1), 10, W0 - 10), lo = Math.min(...b.template), hi = Math.max(...b.template), y = sc(lo - 0.05, hi + 0.05, H - 22, 8);
  const vl = (k, lbl, dy = 0) => `<line x1="${x(ms(k))}" x2="${x(ms(k))}" y1="8" y2="${H - 22}" stroke="${css("--ink3")}" stroke-dasharray="3 3"/><text x="${x(ms(k))}" y="${H - 8 - dy}" text-anchor="middle" class="axis">${lbl}</text>`;
  const qrsOk = b.qrs_ms < 120, qtOk = b.qtcF < 450;
  return S(W0, H, `<rect x="${x(ms(b.qrsOn))}" y="8" width="${x(ms(b.qrsOff)) - x(ms(b.qrsOn))}" height="${H - 30}" fill="${css("--heart")}" opacity=".12"/>`
    + `<rect x="${x(ms(b.qrsOn))}" y="${H - 34}" width="${x(ms(b.tEnd)) - x(ms(b.qrsOn))}" height="3" rx="1.5" fill="${css("--temp")}" opacity=".8"/>`
    + `<path d="${poly(b.template.map((v, k) => [x(ms(k)), y(v)]))}" fill="none" stroke="${css("--ink")}" stroke-width="2" stroke-linejoin="round"/>`
    + vl(b.qrsOn, "Q") + vl(b.qrsOff, "J") + vl(b.tPeak, "T") + vl(b.tEnd, "T end"))
    + stats([[`${b.qrs_ms.toFixed(0)} ms`, `QRS ${qrsOk ? "· under 120" : "· wide"}`], [`${b.qt_ms.toFixed(0)} ms`, "QT"], [`${b.qtcF.toFixed(0)} ms`, `QTc Fridericia ${qtOk ? "· under 450" : ""}`], [`${b.rAmp.toFixed(2)} mV`, "R height"], [`${b.tAmp.toFixed(2)} mV`, "T height"], [b.beats, "beats averaged"]])
    + `<p class="note">The median of ${b.beats} aligned beats, so noise cancels out. QRS edges are where the slope becomes significant; T end uses the tangent method; QTc uses Fridericia, better than Bazett at resting rates (Luo 2004). A finger lead is not a 12-lead: check the markers by eye, and treat these as estimates.</p>`;
}
function bpSection() {
  const rows = W.bpLog(), sys = rows.map((r) => r.sys), dia = rows.map((r) => r.dia), aS = mean(sys), aD = mean(dia);
  const cat = aS >= 135 || aD >= 85 ? ["Stage 2 range", "bad"] : aS >= 130 || aD >= 80 ? ["Stage 1 range", "watch"] : aS >= 120 ? ["Elevated", "watch"] : ["Normal", "good"];
  const W0 = 340, H = 170, x = sc(0, rows.length - 1, 30, W0 - 10), y = sc(70, 150, H - 22, 8);
  const body = [80, 130].map((v) => `<line x1="30" x2="${W0 - 6}" y1="${y(v)}" y2="${y(v)}" stroke="${css("--watch")}" stroke-opacity=".6"/><text x="26" y="${y(v) + 4}" text-anchor="end" class="axis">${v}</text>`).join("")
    + [100, 140].map((v) => `<line x1="30" x2="${W0 - 6}" y1="${y(v)}" y2="${y(v)}" stroke="${css("--grid")}"/><text x="26" y="${y(v) + 4}" text-anchor="end" class="axis">${v}</text>`).join("")
    + rows.map((r, i) => `<line x1="${x(i)}" x2="${x(i)}" y1="${y(r.sys)}" y2="${y(r.dia)}" stroke="${css("--heart")}" stroke-width="6" stroke-linecap="round" opacity="${r.am ? 1 : 0.6}"/><circle cx="${x(i)}" cy="${y(r.band)}" r="3.2" fill="none" stroke="${css("--ink2")}" stroke-width="1.4"/>`).join("")
    + rows.filter((r) => r.am).map((r) => `<text x="${x(rows.indexOf(r)) + 6}" y="${H - 4}" text-anchor="middle" class="axis">${DAYS[(4 - r.day + 7) % 7][0]}</text>`).join("");
  const sid = `s${uid++}`;
  const diffs = rows.map((r) => r.band - r.sys), bias = mean(diffs), sdd = sd(diffs), maeBand = mean(diffs.map(Math.abs));
  const maeLast = mean(rows.slice(1).map((r, i) => Math.abs(r.sys - rows[i].sys)));
  const X = sc(0, Math.max(maeBand, maeLast) * 1.15, 0, 170);
  return `<div class="card rise" style="--i:6"><div class="bp-h"><div><div class="lbl">Home average · last 7 days</div><div class="num big2">${aS.toFixed(0)}<span class="slash">/</span>${aD.toFixed(0)}<small>mmHg</small></div></div><span class="badge ${cat[1]}">${cat[0]}</span></div>
      ${scrubbable(sid, W0, H, body, rows.map((r, i) => [x(i), y(r.sys), `${DAYS[(4 - r.day + 7) % 7]} ${r.am ? "AM" : "PM"} · <b>${r.sys}/${r.dia}</b> cuff · band guessed ${r.band}`]), `Bars: cuff readings (systolic to diastolic), morning solid. Rings: the band's own estimate.`)}
      <p class="note">ACC/AHA home thresholds: stage 1 from 130/80, stage 2 from 135/85. This average feeds your heart-risk estimate in Profile.</p>
      <button class="cta" data-sheet="bp">Log a reading</button></div>
    <div class="card rise" style="--i:7"><div class="lbl" style="margin-bottom:10px">Can the band estimate your BP?</div>
      <div class="cmp"><div><span>Band's estimate</span>${S(170, 12, `<rect x="0" y="2" width="${X(maeBand)}" height="8" rx="4" fill="${css("--bad")}" opacity=".8"/>`)}<b>${maeBand.toFixed(1)}</b></div>
        <div><span>Your last cuff reading</span>${S(170, 12, `<rect x="0" y="2" width="${X(maeLast)}" height="8" rx="4" fill="${css("--good")}" opacity=".8"/>`)}<b>${maeLast.toFixed(1)}</b></div></div>
      <p class="note">Average miss in systolic mmHg over ${rows.length} paired readings. The band reads ${Math.abs(bias).toFixed(0)} mmHg ${bias < 0 ? "low" : "high"} on average (95% of misses within ${(bias - 1.96 * sdd).toFixed(0)} to ${(bias + 1.96 * sdd).toFixed(0)}) and barely moves when your cuff does.</p>
      <p class="verdict-line"><b>Not yet.</b> Simply reusing your last cuff reading beats the band, so Pulse shows cuff numbers only. The band has no raw pulse-wave signal to time against the ECG, which is what a real cuffless estimate needs. The AHA advises against cuffless readings for diagnosis.</p></div>`;
}
function measure() {
  const E = analyze(), h = E.s.hrv;
  return `<div class="hd rise" style="--i:0"><div><div class="lbl">Measure</div><h1>Spot checks</h1></div></div>
    <div class="card hero-ecg rise" style="--i:1"><div class="rhythm"><div class="pulse-dot"></div><div><div class="lbl">Heart rhythm check · 7:12 AM</div><div class="r-verdict">Regular rhythm</div><div class="r-sub">${Math.round(E.dur)} s · ${Math.round(E.s.quality * 100)}% clean beats · 1 early beat set aside</div></div></div>
      <div class="r-stats"><div><b>${h.hr.toFixed(0)}</b><span>bpm</span></div><div><b>${h.rmssd.toFixed(0)}</b><span>RMSSD ms</span></div><div><b>${E.edr.rate.toFixed(1)}</b><span>breaths/min</span></div><div><b>${E.mb.qtcF.toFixed(0)}</b><span>QTc ms</span></div></div>
      <button class="cta" data-record>New 2-minute recording</button>
      <p class="note">Irregularity screen (Dash 2009): normalised RMSSD ${h.nrmssd.toFixed(3)} (flag above 0.1), entropy ${h.shannon.toFixed(2)}, turning points ${h.tpr.toFixed(2)}. Not a diagnosis; an irregular result means show a doctor the strip.</p></div>
    <div class="sec rise" style="--i:2"><h2>The recording</h2><span class="lbl">finger lead · 256 Hz</span></div>
    <div class="card rise" style="--i:2" id="ecgcard">${ecgTrace()}${ecgOverview()}</div>
    <div class="sec rise" style="--i:3"><h2>Heart rate variability</h2><span class="lbl">${E.s.rr.length} clean beats</span></div>
    <div class="card rise" style="--i:3" id="hrvcard">${hrvPanel()}</div>
    <div class="sec rise" style="--i:4"><h2>Breathing from the ECG</h2><span class="lbl">3-signal fusion</span></div>
    <div class="card rise" style="--i:4">${breathingPanel()}</div>
    <div class="sec rise" style="--i:5"><h2>Average beat</h2><span class="lbl">estimates · check by eye</span></div>
    <div class="card rise" style="--i:5">${beatPanel()}</div>
    <div class="sec rise" style="--i:6"><h2>Blood pressure</h2><span class="lbl">cuff log</span></div>
    ${bpSection()}
    <p class="note" style="text-align:center;margin-top:18px">Concept · a synthetic ECG analysed live by Pulse's own code in ${E.ms.toFixed(0)} ms.</p>`;
}

// ---------- Profile ----------
const latest = () => W.DRAWS[W.DRAWS.length - 1].v;
function preventInput(over = {}) {
  const L = latest(), sbp = Math.round(mean(W.bpLog().map((r) => r.sys)));
  return { age: me.age, sex: me.sex, totalChol: over.tc ?? L.tc, hdl: L.hdl, sbp: over.sbp ?? sbp, bmi: +W.bmi(me).toFixed(1), egfr: L.egfr, diabetes: me.diabetes, smoker: me.smoker, bpTreatment: me.bpMeds, statin: me.statin, hba1c: L.a1c };
}
const pick = (r) => r.a1c ?? r.base;
function riskCat(p) { return p < 0.05 ? ["Low", "good"] : p < 0.075 ? ["Borderline", "watch"] : p < 0.2 ? ["Intermediate", "bad"] : ["High", "bad"]; }
function preventCard() {
  const inp = preventInput(), r = prevent(inp), R = pick(r);
  if (!R) return `<div class="card"><p>${r.warnings[0]}</p></div>`;
  const wi = pick(prevent(preventInput({ sbp: whatIf.sbp ?? inp.sbp, tc: whatIf.tc ?? inp.totalChol })));
  const opt = pick(prevent({ ...inp, totalChol: 170, hdl: 50, sbp: 110, bmi: 25, egfr: 90, smoker: false, diabetes: false, bpTreatment: false, statin: false, hba1c: 5.3 }));
  const k = horizon === "10" ? ["cvd10", "ascvd10", "hf10"] : ["cvd30", "ascvd30", "hf30"], v = R[k[0]], cat = riskCat(v);
  const W0 = 300, max = horizon === "10" ? 0.3 : 0.6, x = sc(0, max, 4, W0 - 4);
  const zones = horizon === "10" ? [[0, 0.05, "--good"], [0.05, 0.075, "--watch"], [0.075, 0.2, "--temp"], [0.2, 0.3, "--bad"]] : [];
  const changed = (whatIf.sbp != null && whatIf.sbp !== inp.sbp) || (whatIf.tc != null && whatIf.tc !== inp.totalChol);
  return `<div class="risk-h"><div><div class="lbl">${horizon}-year risk · heart attack, stroke or heart failure</div><div class="num big2">${pct(v)}</div></div>${horizon === "10" ? `<span class="badge ${cat[1]}">${cat[0]}</span>` : ""}</div>
    ${S(W0, 30, `${zones.length ? zones.map(([a0, a1, c]) => `<rect x="${x(a0)}" y="10" width="${x(a1) - x(a0)}" height="8" fill="${css(c)}" opacity=".5"/>`).join("") : `<rect x="4" y="10" width="${W0 - 8}" height="8" rx="4" fill="${css("--track")}"/>`}
      <line x1="${x(opt[k[0]])}" x2="${x(opt[k[0]])}" y1="6" y2="22" stroke="${css("--ink2")}" stroke-width="1.5"/>
      <circle cx="${x(v)}" cy="14" r="7" fill="${css("--ink")}" stroke="${css("--bg")}" stroke-width="2.5"/>${changed ? `<circle cx="${x(wi[k[0]])}" cy="14" r="5" fill="none" stroke="${css("--act")}" stroke-width="2"/>` : ""}
      <text x="4" y="30" class="axis">0%</text><text x="${W0 - 4}" y="30" text-anchor="end" class="axis">${max * 100}%</text>`)}
    <div class="seg small">${[["10", "10 years"], ["30", "30 years"]].map(([h, l]) => `<button data-horizon="${h}" class="${horizon === h ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="stat3"><div><b>${pct(R[k[1]])}</b><span>heart attack or stroke</span></div><div><b>${pct(R[k[2]])}</b><span>heart failure</span></div><div><b>${pct(opt[k[0]])}</b><span>same age, optimal numbers</span></div></div>
    <div class="sub-h">What would move it</div>
    <div class="slider"><label><span>Home systolic</span><span><b>${whatIf.sbp ?? inp.sbp}</b> mmHg</span></label><input type="range" min="105" max="165" step="1" value="${whatIf.sbp ?? inp.sbp}" data-whatif="sbp"></div>
    <div class="slider"><label><span>Total cholesterol</span><span><b>${whatIf.tc ?? inp.totalChol}</b> mg/dL</span></label><input type="range" min="140" max="300" step="1" value="${whatIf.tc ?? inp.totalChol}" data-whatif="tc"></div>
    <p class="whatif">${changed ? `With these numbers: <b>${pct(wi[k[0]])}</b> (${sign((wi[k[0]] - v) * 100)} points).` : "Drag a slider to see how the equation responds."}</p>
    <div class="sub-h">Inputs</div>
    <div class="kv">${[["Age, sex", `${inp.age}, ${inp.sex}`, "Profile"], ["Total / HDL cholesterol", `${inp.totalChol} / ${inp.hdl} mg/dL`, "Labs · Sep 3"], ["Systolic BP", `${inp.sbp} mmHg`, "Home cuff · 7-day avg"], ["BMI", inp.bmi.toFixed(1), "Profile"], ["eGFR", `${inp.egfr}`, "Labs · Sep 3"], ["HbA1c", `${inp.hba1c}%`, "Labs · Sep 3"], ["Urine albumin (UACR)", "not on file", "adds kidney detail"]].map(([a, b, c]) => `<div><span>${a}</span><b>${b}</b><em>${c}</em></div>`).join("")}</div>
    <p class="note">AHA PREVENT equations (Khan 2024), sex-specific with the HbA1c add-on, for ages 30–79 without known heart disease. Implemented from the published coefficients and checked against two independent sources. Categories are the ACC/AHA convention. This is what your clinician's calculator would show; it isn't a diagnosis.</p>`;
}
function labsCard() {
  const Ls = W.DRAWS, groups = [...new Set(W.ANALYTES.map((a) => a.grp))];
  const flag = (a, v) => (v > a.ref[1] ? ["H", "hi"] : v < a.ref[0] ? ["L", "lo"] : ["", ""]);
  const spark = (a) => { const v = Ls.map((d) => d.v[a.k]), x = sc(0, v.length - 1, 4, 56), y = sc(Math.min(...v), Math.max(...v) + 1e-9, 18, 4); return S(60, 22, `<path d="${poly(v.map((z, i) => [x(i), y(z)]))}" fill="none" stroke="${css("--ink3")}" stroke-width="1.4"/>${v.map((z, i) => `<circle cx="${x(i)}" cy="${y(z)}" r="${i === v.length - 1 ? 3 : 2}" fill="${i === v.length - 1 ? css("--ink") : css("--ink3")}"/>`).join("")}`); };
  return groups.map((g) => `<div class="sub-h">${g}</div>` + W.ANALYTES.filter((a) => a.grp === g).map((a) => {
    const v = Ls[Ls.length - 1].v[a.k], p = Ls[Ls.length - 2].v[a.k], [f, cls] = flag(a, v), id = `lab-${a.k}`;
    return `<div class="an" data-expand="${id}"><div class="an-n">${a.n}<small>ref ${a.ref[1] >= 200 ? `≥${a.ref[0]}` : a.ref[0] ? `${a.ref[0]}–${a.ref[1]}` : `<${a.ref[1]}`}</small></div>${spark(a)}<div class="an-v"><b class="${cls}">${v}${f ? `<sup>${f}</sup>` : ""}</b><small>${a.u} · ${v < p ? "↓" : v > p ? "↑" : "="} ${Math.abs(v - p).toFixed(a.k === "a1c" || a.k === "hscrp" || a.k === "insulin" ? 1 : 0)}</small></div></div>
      ${open.has(id) ? `<div class="an-x">${Ls.map((d) => `<span>${d.label}<b>${d.v[a.k]}</b></span>`).join("")}</div>` : ""}`;
  }).join("")).join("");
}
function indicesCard() {
  const b = W.bmi(me), all = W.DRAWS.map((d) => derived(d.v, { bmi: b })), cur = all[all.length - 1];
  return cur.map((d) => {
    const hist = all.map((set) => set.find((z) => z.key === d.key)?.value), id = `ix-${d.key}`;
    const dec = Math.max(...hist.filter((v) => v != null).map((v) => (String(v).split(".")[1] ?? "").length)), fx = (v) => (v == null ? "—" : v.toFixed(dec));
    return `<div class="ix" data-expand="${id}"><div class="ix-n">${d.name}<small class="${d.band[1] === "good" ? "ok" : d.band[1] === "watch" ? "lo" : d.band[1] === "bad" ? "hi" : ""}">${d.band[0]}</small></div><div class="ix-t">${hist.map(fx).join(" → ")}</div><div class="ix-v"><b>${fx(d.value)}</b>${d.unit ? `<small>${d.unit}</small>` : ""}</div></div>
      ${open.has(id) ? `<div class="ix-x"><code>${d.formula}</code><p>${d.note}</p><p class="cite">${d.cite}</p></div>` : ""}`;
  }).join("") + `<p class="note">Computed from your panels with each paper's own formula and cut-offs; tap a row for the math. Arrows run ${W.DRAWS.map((d) => d.label).join(" → ")}.</p>`;
}
function labsVsWearable() {
  const W0 = 340, H = 150, hs = D.hist, wk = [];
  for (let i = 0; i + 7 <= hs.length; i += 7) { const w = hs.slice(i, i + 7); wk.push({ d: w[3].d, rhr: mean(w.map((h) => h.rhr)), hrv: mean(w.map((h) => h.hrv)) }); }
  const x = sc(0, wk.length - 1, 30, W0 - 6), yr = sc(Math.min(...wk.map((w) => w.rhr)) - 0.5, Math.max(...wk.map((w) => w.rhr)) + 0.5, 70, 18), yh = sc(Math.min(...wk.map((w) => w.hrv)) - 1, Math.max(...wk.map((w) => w.hrv)) + 1, H - 20, 82);
  const at = (date) => wk.findIndex((w) => w.d.toISOString().slice(0, 10) >= date);
  const pins = W.DRAWS.map((dr) => { const i = at(dr.date), r = (dr.v.tg / dr.v.hdl).toFixed(1), anc = x(i) > W0 - 30 ? "end" : "middle"; return i < 0 ? "" : `<line x1="${x(i)}" x2="${x(i)}" y1="14" y2="${H - 16}" stroke="${css("--ink")}" stroke-opacity=".3" stroke-dasharray="2 3"/><text x="${x(i)}" y="9" text-anchor="${anc}" class="axis">${dr.label}</text><text x="${x(i)}" y="${H - 3}" text-anchor="${anc}" class="axis" style="fill:var(--ink2)">${r}</text>`; }).join("") + `<text x="26" y="${H - 3}" text-anchor="end" class="axis">TG/HDL</text>`;
  const near = (date, k) => { const i = hs.findIndex((h) => h.d.toISOString().slice(0, 10) >= date); return mean(hs.slice(Math.max(0, i - 14), i).map((h) => h[k])); };
  const dR = near(W.DRAWS[2].date, "rhr") - near(W.DRAWS[0].date, "rhr"), dH = near(W.DRAWS[2].date, "hrv") - near(W.DRAWS[0].date, "hrv");
  return S(W0, H, `${pins}<text x="26" y="${yr(mean(wk.map((w) => w.rhr))) + 4}" text-anchor="end" class="axis">RHR</text><path d="${smooth(wk.map((w, i) => [x(i), yr(w.rhr)]))}" fill="none" stroke="${css("--heart")}" stroke-width="2"/>
      <text x="26" y="${yh(mean(wk.map((w) => w.hrv))) + 4}" text-anchor="end" class="axis">HRV</text><path d="${smooth(wk.map((w, i) => [x(i), yh(w.hrv)]))}" fill="none" stroke="${css("--hrv")}" stroke-width="2"/>`)
    + `<p class="note">Weekly averages over the past year, with your lab draws. In the two weeks before each draw, resting HR went ${sign(dR)} bpm and HRV ${sign(dH)} ms from February to September, while TG/HDL fell ${(W.DRAWS[0].v.tg / W.DRAWS[0].v.hdl).toFixed(1)} → ${(W.DRAWS[2].v.tg / W.DRAWS[2].v.hdl).toFixed(1)}. Pulse shows these side by side; it can't say one caused the other.</p>`;
}
function profile() {
  const b = W.bmi(me);
  const tog = (k, l) => `<button class="chip ${me[k] ? "on" : ""}" data-me="${k}">${l}${me[k] ? ": yes" : ": no"}</button>`;
  return `<div class="hd rise" style="--i:0"><div><div class="lbl">Profile</div><h1>${me.name}</h1></div><div class="avatar">${me.name[0]}</div></div>
    <div class="card rise" style="--i:1"><div class="kv">${[["Age", `${me.age}`], ["Sex", me.sex], ["Height", `${Math.floor(me.heightIn / 12)}′${me.heightIn % 12}″`], ["Weight", `${me.weightLb} lb`], ["BMI", b.toFixed(1)]].map(([a, v]) => `<div><span>${a}</span><b>${v}</b></div>`).join("")}</div>
      <div class="chips" style="margin-top:12px">${tog("bpMeds", "BP medication")}${tog("statin", "Statin")}${tog("smoker", "Smoker")}${tog("diabetes", "Diabetes")}</div>
      <p class="note">These feed the risk estimate below and adjust heart-rate targets (beta-blockers change them).</p></div>
    <div class="sec rise" style="--i:2"><h2>Heart risk</h2><span class="lbl">AHA PREVENT</span></div>
    <div class="card rise" style="--i:2" id="prevent">${preventCard()}</div>
    <div class="sec rise" style="--i:3" id="labs"><h2>Labs</h2><span class="lbl">${W.DRAWS.length} panels · Quest</span></div>
    <div class="card rise" style="--i:3"><button class="cta ghost" data-sheet="upload">Add a lab report (PDF)</button>${labsCard()}</div>
    <div class="sec rise" style="--i:4"><h2>What your labs imply</h2><span class="lbl">derived</span></div>
    <div class="card rise" style="--i:4">${indicesCard()}</div>
    <div class="sec rise" style="--i:5"><h2>Labs alongside your band</h2><span class="lbl">1 year</span></div>
    <div class="card rise" style="--i:5">${labsVsWearable()}</div>
    <div class="sec rise" style="--i:6"><h2>Band</h2><span class="lbl">V5 ${me.name}</span></div>
    <div class="card rise" style="--i:6"><div class="kv">${[["Battery", "92%"], ["Last sync", "4 min ago"], ["Heart rate", "every 5 s"], ["Oxygen, HRV, temperature", "every 10 min"], ["Snore / breathing mode", "on"], ["Data", "on this phone only"]].map(([a, v]) => `<div><span>${a}</span><b>${v}</b></div>`).join("")}</div>
      <div class="chips" style="margin-top:12px"><button class="chip">Sync now</button><button class="chip">Export backup</button><button class="chip ghost">Forget band</button></div></div>
    <p class="note" style="text-align:center;margin-top:18px">Concept · synthetic person and labs. PREVENT and the lab formulas are the real ones.</p>`;
}
function sheet(kind) {
  if (kind === "upload") return `<div class="sh-h"><b>Add a lab report</b><button class="back" data-sheetclose>Done</button></div>
    <p>Pick the PDF from Quest, Labcorp or Function Health. It's read on this phone; nothing is uploaded anywhere.</p>
    <div class="lbl" style="margin:14px 0 6px">Check what Pulse found · Sep 3 panel</div>
    <div class="review">${[["LDL cholesterol", "148 mg/dL", "p. 2"], ["HDL cholesterol", "44 mg/dL", "p. 2"], ["Triglycerides", "131 mg/dL", "p. 2"], ["Glucose", "97 mg/dL", "p. 3"], ["Insulin", "8.9 µIU/mL", "p. 3"], ["hs-CRP", "0.8 mg/L", "p. 4"]].map(([a, v, p]) => `<label><input type="checkbox" checked> <span>${a}</span><b>${v}</b><em>${p}</em></label>`).join("")}</div>
    <p class="note">Every value is shown with the page it came from, so you can confirm it before it's saved. Units are converted to US conventional.</p>`;
  return `<div class="sh-h"><b>Log a blood pressure reading</b><button class="back" data-sheetclose>Done</button></div>
    <ol class="steps"><li>No caffeine, smoking or exercise for 30 minutes.</li><li>Sit for 5 minutes, back supported, feet flat, arm resting at heart level.</li><li>Take two readings a minute apart without talking.</li></ol>
    <div class="inputs"><label>Systolic<input inputmode="numeric" placeholder="132"></label><label>Diastolic<input inputmode="numeric" placeholder="84"></label><label>Pulse<input inputmode="numeric" placeholder="64"></label></div>
    <p class="note">Mornings and evenings for a week gives a reliable home average (AHA). Pulse pairs each reading with the band's estimate at the same time.</p>`;
}

// ---------- modal + interactions ----------
let modal = null, origin = null, openKey = null;
function openDrill(el, key) {
  origin = el; openKey = key; view = "now";
  const r = el.getBoundingClientRect();
  modal = document.createElement("div");
  modal.className = "modal";
  modal.style.setProperty("--mcolor", css(M[key].color));
  Object.assign(modal.style, { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px`, transition: "none" });
  modal.innerHTML = drill(key);
  document.body.append(modal);
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const e = "cubic-bezier(.2,.85,.2,1)";
    modal.style.transition = `top .46s ${e}, left .46s ${e}, width .46s ${e}, height .46s ${e}, border-radius .46s ${e}`;
    Object.assign(modal.style, { top: "0px", left: "0px", width: "100vw", height: "100vh", borderRadius: "0px" });
    setTimeout(() => modal?.classList.add("full"), 400);
  }));
}
function redrawModal() { const st = modal.scrollTop; modal.innerHTML = drill(openKey); modal.classList.add("full"); modal.scrollTop = st; }
function closeDrill() {
  if (!modal) return;
  const r = origin.getBoundingClientRect(), m = modal;
  m.classList.remove("full"); m.scrollTop = 0;
  Object.assign(m.style, { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: "24px" });
  modal = null; document.body.style.overflow = "";
  setTimeout(() => m.remove(), 470);
}
function showSheet(kind) {
  const s = document.createElement("div");
  s.className = "sheet-wrap";
  s.innerHTML = `<div class="sheet-bg" data-sheetclose></div><div class="sheet">${sheet(kind)}</div>`;
  document.body.append(s);
  requestAnimationFrame(() => s.classList.add("on"));
}
function countUp(scope) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const el of scope.querySelectorAll("[data-count]")) {
    const to = +el.dataset.count, t0 = performance.now(), node = el.firstChild;
    const step = (t) => { const f = Math.min(1, (t - t0) / 900), e = 1 - (1 - f) ** 3; node.textContent = Math.round(to * e); if (f < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
}
function sweep() { requestAnimationFrame(() => requestAnimationFrame(() => { for (const a of document.querySelectorAll(".arc[data-to]")) a.setAttribute("stroke-dashoffset", a.dataset.to); })); }

function record(btn) {
  const card = btn.closest(".card");
  const ov = document.createElement("div");
  ov.className = "rec";
  ov.innerHTML = `<div class="rec-ring">${S(120, 120, `<circle cx="60" cy="60" r="52" fill="none" stroke="${css("--track")}" stroke-width="8"/><circle class="rec-arc" cx="60" cy="60" r="52" fill="none" stroke="${css("--heart")}" stroke-width="8" stroke-linecap="round" transform="rotate(-90 60 60)" stroke-dasharray="326.7" stroke-dashoffset="326.7"/>`)}<div class="rec-t">0:00</div></div><p>Finger on the silver plate. Hold still.</p><p class="note">Demo: 2 minutes, sped up 30×</p>`;
  card.append(ov);
  const t0 = performance.now(), dur = 4000;
  const tick = (t) => {
    const f = Math.min(1, (t - t0) / dur), s = Math.round(f * 120);
    ov.querySelector(".rec-arc").setAttribute("stroke-dashoffset", (326.7 * (1 - f)).toFixed(1));
    ov.querySelector(".rec-t").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    if (f < 1) requestAnimationFrame(tick); else { ov.innerHTML = `<p class="done">Analysing…</p>`; setTimeout(() => { ov.remove(); render(); }, 500); }
  };
  requestAnimationFrame(tick);
}

document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.closest("[data-sheetclose]")) { const s = t.closest(".sheet-wrap"); s.classList.remove("on"); setTimeout(() => s.remove(), 300); return; }
  if (t.closest(".sheet")) return;
  const v = t.closest("[data-view]"), a = t.closest("[data-agg]");
  if (modal && (v || a || t.closest("[data-split]") || t.closest("[data-showtags]"))) {
    if (v) view = v.dataset.view; if (a) agg = a.dataset.agg;
    if (t.closest("[data-split]")) split = !split; if (t.closest("[data-showtags]")) showTags = !showTags;
    redrawModal(); return;
  }
  const o2 = t.closest("[data-open2]");
  if (modal && o2) { openKey = o2.dataset.open2; view = "now"; modal.style.setProperty("--mcolor", css(M[openKey].color)); modal.innerHTML = drill(openKey); modal.classList.add("full"); modal.scrollTop = 0; return; }
  if (t.closest("[data-close]")) { closeDrill(); if (t.closest("[data-goto]")) setTimeout(() => $(".tags")?.scrollIntoView({ behavior: "smooth", block: "center" }), 480); return; }
  const tagBtn = t.closest("[data-tag]");
  if (tagBtn) {
    const k = tagBtn.dataset.tag, p = tagBtn.closest("[data-prompt]");
    if (k !== "none" && W.TAGS.some((z) => z.key === k)) { userTags.has(k) && !p ? userTags.delete(k) : userTags.add(k); }
    if (p) { p.querySelector(".chips").innerHTML = `<span class="thanks">Noted: <b>${tagBtn.textContent}</b>. Pulse will use it to explain nights like this.</span>`; build(); return; }
    tagBtn.classList.toggle("on"); build(); return;
  }
  const go = t.closest("[data-goto]");
  if (go && !modal) { const g = go.dataset.goto; if (g === "labs" || g === "profile") { setTab("profile"); if (g === "labs") setTimeout(() => $("#labs")?.scrollIntoView({ behavior: "smooth" }), 80); } return; }
  const tb = t.closest("[data-tab]");
  if (tb) { setTab(tb.dataset.tab); return; }
  const ht = t.closest("[data-hrvtab]");
  if (ht) { hrvTab = ht.dataset.hrvtab; $("#hrvcard").innerHTML = hrvPanel(); return; }
  const j = t.closest("[data-jump]");
  if (j) { const E = analyze(); const r = j.dataset.jump === "early" ? E.iv.find((z) => !z.ok) : { t: 87 }; ecgStart = Math.max(0, Math.min(E.dur - 8, r.t - 3)); $("#ecgcard").innerHTML = ecgTrace() + ecgOverview(); return; }
  if (t.closest("[data-record]")) { record(t.closest("[data-record]")); return; }
  const hz = t.closest("[data-horizon]");
  if (hz) { horizon = hz.dataset.horizon; $("#prevent").innerHTML = preventCard(); return; }
  const mk = t.closest("[data-me]");
  if (mk) { me[mk.dataset.me] = !me[mk.dataset.me]; mk.classList.toggle("on", me[mk.dataset.me]); mk.textContent = mk.textContent.replace(/: (yes|no)$/, me[mk.dataset.me] ? ": yes" : ": no"); $("#prevent").innerHTML = preventCard(); return; }
  const ex = t.closest("[data-expand]");
  if (ex) { const id = ex.dataset.expand; open.has(id) ? open.delete(id) : open.add(id); const y = scrollY; render(false); scrollTo(0, y); return; }
  const sh = t.closest("[data-sheet]");
  if (sh) { showSheet(sh.dataset.sheet); return; }
  const o = t.closest("[data-open]");
  if (o && !modal) openDrill(o, o.dataset.open);
});
document.addEventListener("input", (e) => {
  const s = e.target.closest("[data-whatif]");
  if (!s) return;
  whatIf[s.dataset.whatif] = +s.value;
  const card = $("#prevent"), k = s.dataset.whatif;
  card.innerHTML = preventCard();
  const again = card.querySelector(`[data-whatif="${k}"]`); again?.focus();
});
// Scrubbing: pointer over any registered chart moves the crosshair and fills the readout.
function scrubAt(el, clientX) {
  const id = el.dataset.scrub, R = SCRUB[id]; if (!R) return;
  const svg = el.querySelector("svg"), box = svg.getBoundingClientRect(), vx = ((clientX - box.left) / box.width) * R.W;
  let best = R.pts[0], bd = Infinity; for (const p of R.pts) { const d = Math.abs(p[0] - vx); if (d < bd) { bd = d; best = p; } }
  const xh = svg.querySelector(".xh"), xd = svg.querySelector(".xd");
  xh.setAttribute("x1", best[0]); xh.setAttribute("x2", best[0]); xh.style.opacity = 1;
  xd.setAttribute("cx", best[0]); xd.setAttribute("cy", best[1]); xd.style.opacity = 1;
  const ro = el.parentElement.querySelector(`[data-readout="${id}"]`); if (ro) { ro.innerHTML = best[2]; ro.classList.add("live"); }
}
function scrubEnd(el) {
  const id = el.dataset.scrub, R = SCRUB[id]; if (!R) return;
  const svg = el.querySelector("svg"); svg.querySelector(".xh").style.opacity = 0; svg.querySelector(".xd").style.opacity = 0;
  const ro = el.parentElement.querySelector(`[data-readout="${id}"]`); if (ro) { ro.innerHTML = R.idle; ro.classList.remove("live"); }
}
let dragOv = null;
document.addEventListener("pointerdown", (e) => { const ov = e.target.closest("[data-ecgov]"); if (ov) { dragOv = ov; moveOv(e); } const s = e.target.closest("[data-scrub]"); if (s) scrubAt(s, e.clientX); });
document.addEventListener("pointermove", (e) => { if (dragOv) { moveOv(e); return; } const s = e.target.closest("[data-scrub]"); if (s) scrubAt(s, e.clientX); });
document.addEventListener("pointerup", () => { dragOv = null; });
document.addEventListener("pointerout", (e) => { const s = e.target.closest("[data-scrub]"); if (s && !s.contains(e.relatedTarget)) scrubEnd(s); });
function moveOv(e) {
  const E = analyze(), box = dragOv.querySelector("svg").getBoundingClientRect(), f = (e.clientX - box.left) / box.width;
  ecgStart = Math.max(0, Math.min(E.dur - 8, f * E.dur - 4));
  const card = $("#ecgcard"); card.querySelector(".ecg").outerHTML = ""; card.innerHTML = ecgTrace() + ecgOverview(); dragOv = card.querySelector("[data-ecgov]");
}

// ---------- tabs + controls ----------
function setTab(t) { tab = t; for (const b of document.querySelectorAll(".tabbar [data-tab]")) b.classList.toggle("on", b.dataset.tab === tab); render(); scrollTo(0, 0); }
function render(anim = true) {
  build(); uid = 0;
  for (const k of Object.keys(SCRUB)) delete SCRUB[k];
  const app = $("#app");
  app.classList.toggle("still", !anim);
  app.innerHTML = tab === "today" ? today() : tab === "measure" ? measure() : profile();
  sweep(); countUp(app);
}
function sync() {
  root.dataset.theme = theme;
  for (const b of document.querySelectorAll(".switch [data-scen]")) b.classList.toggle("on", b.dataset.scen === scen);
  $(".switch [data-theme-toggle]").textContent = theme === "dark" ? "☾" : "☀";
  for (const b of document.querySelectorAll(".tabbar [data-tab]")) b.classList.toggle("on", b.dataset.tab === tab);
  render();
}
document.querySelector(".switch").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.scen) scen = b.dataset.scen; else theme = theme === "dark" ? "light" : "dark";
  sync();
});
sync();
if (params.get("open")) setTimeout(() => { const el = document.querySelector(`[data-open="${params.get("open")}"]`); if (el) { openDrill(el, params.get("open")); view = params.get("view") ?? "now"; setTimeout(redrawModal, 450); } }, 600);
