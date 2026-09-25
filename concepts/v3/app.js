// Pulse Luminous v3 concept (synthetic data). Four tabs: Today (the day so far), Night (any night, with
// its drill-downs), Measure (ECG + blood pressure, recorded over time) and Profile. Measure and Profile run
// the app's real analytics modules (ECG, advanced HRV, ECG-derived breathing, median beat, lab indices,
// AHA PREVENT) in the browser.
import * as W from "./data.js?v=20260925173307";
import { synthEcg } from "./synth.js?v=20260925173307";
import { ecgSummary, bandpass } from "../../src/analytics/ecg.js?v=20260925173307";
import { advancedHRV } from "../../src/analytics/hrv_advanced.js?v=20260925173307";
import { edrFusion, medianBeat, morphologyFilter } from "../../src/analytics/edr.js?v=20260925173307";
import { derived } from "../../src/analytics/labs.js?v=20260925173307";
import { prevent } from "../../src/analytics/prevent.js?v=20260925173307";

const { median, mean, sd } = W;
const root = document.documentElement;
const $ = (s, r = document) => r.querySelector(s);
const css = (v) => getComputedStyle(root).getPropertyValue(v).trim();
const dark = () => root.dataset.theme !== "light";

// ---------- state ----------
const params = new URLSearchParams(location.search);
const TABS = { today: "Today", night: "Night", measure: "Measure", profile: "Profile" };
let scen = params.get("scen") ?? "good", theme = params.get("theme") ?? "dark", tab = params.get("tab") ?? "today";
if (!TABS[tab]) tab = "today";
let sel = null; // Night tab: index into D.hist (null = last night)
let view = "now", agg = "90", split = false, showTags = true;
let hrvTab = params.get("hrv") ?? "time", ecgStart = 0, horizon = "10", ecgMetric = "rmssd", bpAgg = "30", allRecs = false;
const me = { ...W.ME };
const whatIf = { sbp: null, tc: null };
const answers = new Map(); // night index → Set of tags (empty = nothing unusual)
const draft = new Set(); // chips toggled on an open prompt
const workoutTags = new Map(); // session start → { kind, rpe }
const open = new Set();
let D = null;

const stateOf = (rec) => (rec == null || rec >= 67 ? "good" : rec >= 50 ? "watch" : "bad");
function build() {
  D = W.world(scen);
  for (const [i, tags] of answers) {
    const h = D.hist[i];
    for (const k of tags) if (k === "sick") h.sick = true; else h.t[k] = true;
    h.asked = true; h.w = h.trig?.length ? 1 : 1 / W.ASK_RATE; h.answered = true;
  }
  D.i = tab === "night" && sel != null ? sel : D.L;
  D.H = D.hist.slice(0, D.i + 1);
  D.last = D.hist[D.i];
  D.latest = D.hist[D.L];
  D.nt = D.night(D.i);
  D.hrv = D.last.hrv;
  D.usualSleep = median(D.H.slice(-29, -1).map((h) => h.sleepH));
  D.T = D.today;
  D.goal = W.STEP_GOAL(me.age);
  D.week = D.hist.slice(-7, -1).reduce((a, h) => a + h.mvpa, 0) + D.T.mvpa;
  root.dataset.state = stateOf(tab === "night" ? D.last.rec : D.latest.rec);
  root.style.setProperty("--breath-s", `${(60 / D.last.br).toFixed(2)}s`);
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
const clock = (m) => { const t = ((Math.round(m) % 1440) + 1440) % 1440; const h = Math.floor(t / 60), mm = t % 60; return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, "0")}`; };
const ampm = (m) => `${clock(m)} ${((Math.round(m) % 1440) + 1440) % 1440 >= 720 ? "PM" : "AM"}`;
const hr12 = (h) => (h % 24 === 0 ? "12a" : h % 24 === 12 ? "12p" : h % 24 < 12 ? `${h % 24}a` : `${(h % 24) - 12}p`);
const dur = (h) => { const m = Math.round(Math.abs(h) * 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`; };
const hm = (h) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
const short = (min) => (min >= 60 ? `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, "0")}` : `${Math.round(min)}m`);
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULLDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dname = (d) => `${DAYS[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}`;
const ord = (n) => `${n}${[11, 12, 13].includes(n % 100) ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
const pct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;
const sign = (v, d = 1) => { const r = +Math.abs(v).toFixed(d); return `${r === 0 ? "" : v > 0 ? "+" : "−"}${r.toFixed(d)}`; };
const eveOf = (h) => new Date(h.d.getFullYear(), h.d.getMonth(), h.d.getDate() - 1);
const nightName = (h) => { const e = eveOf(h); return `${DAYS[e.getDay()]} → ${DAYS[h.d.getDay()]}`; };
const nightDates = (h) => { const e = eveOf(h); return e.getMonth() === h.d.getMonth() ? `${MON[e.getMonth()]} ${e.getDate()}–${h.d.getDate()}` : `${MON[e.getMonth()]} ${e.getDate()} – ${MON[h.d.getMonth()]} ${h.d.getDate()}`; };
const isLatest = () => D.i === D.L;
const thatNight = () => (isLatest() ? "last night" : "that night");
let uid = 0;
const q = (n) => `<span class="q" title="data quality ${n}/5">${[0, 1, 2, 3, 4].map((i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</span>`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Scrubbable charts register their points here: SCRUB[id] = { pts: [[x, y, text]], idle }.
const SCRUB = {};
function scrubbable(id, W0, H0, body, pts, idle, cls = "") {
  SCRUB[id] = { pts, idle, W: W0 };
  return `<div class="readout" data-readout="${id}">${idle}</div><div class="scrub ${cls}" data-scrub="${id}">${S(W0, H0, `${body}<line class="xh" x1="0" x2="0" y1="0" y2="${H0}"/><circle class="xd" r="4.5" cx="-20" cy="-20"/>`)}</div>`;
}

// ---------- metric catalog ----------
// Night metrics read the selected night (and the history up to it). Day metrics read today so far for
// the headline and complete days (through yesterday) for Over time / Your range / What affects it.
const ALL = ["sleep", "alcohol", "caffeine", "stress", "workout"];
const paceFrac = () => { const tot = D.typical.reduce((a, b) => a + b, 0); let c = 0; D.typical.forEach((v, hh) => { if (hh < D.T.nowH) c += v; else if (hh === D.T.nowH) c += (v * (D.T.now % 60)) / 60; }); return c / tot; };
const M = {
  recovery: { lc: "recovery score", title: "Recovery", unit: "", color: "--act", get: (h) => h.rec, f: (v) => Math.round(v), nowLbl: "Last night", better: 1, drivers: ALL, q: 4 },
  sleep: { lc: "sleep", title: "Sleep", unit: "", color: "--sleep", get: (h) => h.sleepH, f: (v) => hm(v), fa: (v) => v.toFixed(1), big: (v) => { const t = Math.round(v * 60); return `${Math.floor(t / 60)}<small>h</small> ${String(t % 60).padStart(2, "0")}<small>m</small>`; }, pop: [7, 9], popLbl: "Need (26–64)", nowLbl: "Last night", better: 1, drivers: ["alcohol", "caffeine", "stress", "workout", "steps"], q: 4 },
  hrv: { lc: "overnight HRV", title: "Overnight HRV", unit: "ms", color: "--hrv", get: (h) => h.hrv, f: (v) => v.toFixed(0), pop: [16, 44], popLbl: "Men 55–64", model: true, nowLbl: "Last night", better: 1, drivers: ALL, q: 4 },
  rhr: { lc: "resting heart rate", title: "Resting heart rate", unit: "bpm", color: "--heart", get: (h) => h.rhr, f: (v) => v.toFixed(1), pop: [52, 74], popLbl: "Men 55–64", model: true, nowLbl: "Last night", better: -1, drivers: ALL, q: 5 },
  breath: { lc: "breathing rate", title: "Breathing rate asleep", unit: "/min", color: "--breath", get: (h) => h.br, f: (v) => v.toFixed(1), pop: [12, 20], popLbl: "Adults asleep", nowLbl: "Last night", better: 0, drivers: ["alcohol", "sleep"], q: 3 },
  spo2: { lc: "oxygen level", title: "Oxygen asleep", unit: "%", color: "--spo2", get: (h) => h.spo2, f: (v) => v.toFixed(0), fa: (v) => v.toFixed(1), pop: [95, 100], popLbl: "Healthy adults", nowLbl: "Last night", better: 1, drivers: ["alcohol", "sleep"], q: 3 },
  temp: { lc: "skin temperature", title: "Skin temperature", unit: "°F", color: "--temp", get: (h) => h.tdev * 1.8, f: (v) => sign(v), pop: [-0.9, 0.9], popLbl: "Normal swing", nowLbl: "Last night", better: -1, drivers: ["alcohol", "workout"], q: 4 },
  timing: { lc: "sleep midpoint", title: "Sleep timing", unit: "", color: "--sleep2", get: (h) => h.mid, f: (v) => clock(v), big: (v) => `${clock(v)}<small>${v >= 720 ? "PM" : "AM"}</small>`, fd: (v) => `${Math.round(v)} min`, noCv: true, nowLbl: "Last night", better: 0, drivers: ["alcohol", "caffeine", "stress"], q: 4 },
  // day metrics
  steps: { day: true, lc: "steps", title: "Steps", unit: "", color: "--steps", get: (h) => h.steps, today: () => D.T.steps, frac: paceFrac, f: (v) => Math.round(v).toLocaleString(), pop: () => [D.goal, D.goal * 1.5], popLbl: "Daily goal", nowLbl: "Today", better: 1, drivers: ["sleep", "alcohol", "stress"], q: 5 },
  hrday: { day: true, lc: "daytime heart rate", title: "Daytime heart rate", unit: "bpm", color: "--heart", get: (h) => h.dayHr, today: () => D.T.dayHr, frac: () => 1, f: (v) => v.toFixed(0), pop: () => [60, 100], popLbl: "Adults at rest", nowLbl: "Today", better: -1, drivers: ["sleep", "alcohol", "stress"], q: 5 },
  mvpa: { day: true, lc: "active minutes", title: "Active minutes", unit: "min", color: "--act", get: (h) => h.mvpa, today: () => D.T.mvpa, frac: paceFrac, f: (v) => Math.round(v).toString(), pop: () => [150 / 7, 300 / 7], popLbl: "Guideline pace", nowLbl: "Today", better: 1, drivers: ["sleep", "stress"], q: 4 },
  moveH: { day: true, lc: "moving hours", title: "Moving hours", unit: "h", color: "--breath", get: (h) => h.moveH, today: () => D.T.moveH, frac: () => (D.T.nowH - 7) / 15, f: (v) => Math.round(v).toString(), fa: (v) => v.toFixed(1), nowLbl: "Today", better: 1, drivers: ["sleep", "stress"], q: 4 },
};
const popOf = (m) => (typeof m.pop === "function" ? m.pop() : m.pop);
const series = (m) => (m.day ? D.hist.slice(0, -1) : D.H).filter((h) => m.get(h) != null);
const expOf = (key) => (M[key].model ? W.expected(D.H, M[key].get, D.last.sleepH) : null);
const usual = (k) => median(D.H.slice(-29, -1).map((h) => h[k]));

// ---------- shared pieces ----------
function header(lbl, title, right = "") {
  return `<div class="hd rise" style="--i:0"><div><div class="lbl">${lbl}</div><h1>${title}</h1></div>${right}</div>`;
}
function gauge({ value, count, label, big, verdict, vcolor, cap, color, color2, open, range, tick }) {
  const W0 = 260, c = 130, cy = 122, r = 104, a0 = Math.PI * 0.78, a1 = Math.PI * 2.22, span = a1 - a0, at = (v) => a0 + clamp(v, 0, 100) / 100 * span;
  const len = r * span, prog = (clamp(value, 0, 100) / 100) * len, id = `g${uid++}`, gid = `gg${uid++}`;
  const knob = [c + r * Math.cos(at(value)), cy + r * Math.sin(at(value))];
  const tk = tick != null ? (() => { const a = at(tick); return `<line x1="${(c + (r - 13) * Math.cos(a)).toFixed(1)}" y1="${(cy + (r - 13) * Math.sin(a)).toFixed(1)}" x2="${(c + (r + 13) * Math.cos(a)).toFixed(1)}" y2="${(cy + (r + 13) * Math.sin(a)).toFixed(1)}" stroke="${css("--ink")}" stroke-width="2.5" stroke-linecap="round" opacity=".75"/>`; })() : "";
  return `<div class="gauge" data-open="${open}" style="--gc:${color}"><div class="halo"></div>${S(W0, 230, `<defs><linearGradient id="${gid}" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${color2 ?? color}" stop-opacity="${color2 ? 1 : 0.55}"/><stop offset="1" stop-color="${color}"/></linearGradient>${glowDef(id, 5)}</defs>
    <path d="${arcPath(c, cy, r, a0, a1)}" fill="none" stroke="${css("--track")}" stroke-width="16" stroke-linecap="round"/>
    ${range ? `<path d="${arcPath(c, cy, r, at(range[0]), at(range[1]))}" fill="none" stroke="${css("--ink")}" stroke-opacity=".10" stroke-width="16"/>` : ""}
    <path class="arc" d="${arcPath(c, cy, r, a0, a1)}" fill="none" stroke="url(#${gid})" stroke-width="16" stroke-linecap="round" stroke-dasharray="${len.toFixed(1)}" stroke-dashoffset="${len.toFixed(1)}" data-to="${(len - prog).toFixed(1)}" ${glow(id)}/>
    ${tk}<circle cx="${knob[0].toFixed(1)}" cy="${knob[1].toFixed(1)}" r="6" fill="${css("--bg")}" stroke="${color}" stroke-width="3" class="fadein" style="--i:6"/>`)}
    <div class="center"><div class="lbl">${label}</div><div class="big num" data-count="${count ?? Math.round(value)}">${big}</div><div class="verdict" style="color:${vcolor ?? color}">${verdict}</div></div><div class="cap">${cap}</div></div>`;
}
const mini = (open, svg, em, b, s1, s2 = "") => `<div class="mini" data-open="${open}">${svg}<div class="t"><em>${em}</em><b>${b}</b><span>${s1}</span>${s2 ? `<span>${s2}</span>` : ""}</div></div>`;
function ringSvg(frac, color, inner = "") {
  const c = 37, r = 29, len = 2 * Math.PI * r, id = `r${uid++}`;
  return S(74, 74, `<defs>${glowDef(id, 2.5)}</defs><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${css("--track")}" stroke-width="7"/>
    <circle class="arc" cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" transform="rotate(-90 ${c} ${c})" stroke-dasharray="${len.toFixed(1)}" stroke-dashoffset="${len.toFixed(1)}" data-to="${(len * (1 - clamp(frac, 0, 1))).toFixed(1)}" ${glow(id)}/>${inner}`);
}
function montage(rows, axis, lblL, lblR) {
  return `<div class="card mon rise" style="--i:4">
    <div class="mon-h"><span class="lbl">${lblL}</span><span class="lbl">${lblR}</span></div>
    ${rows.map(([n, k, body, v]) => `<div class="ch ${k ? "tap" : ""}" ${k ? `data-open="${k}"` : ""}><span class="ch-n">${n}</span>${S(300, 30, body, 'preserveAspectRatio="none"')}<span class="ch-v">${v}</span></div>`).join("")}
    <div class="taxis"><span></span>${S(300, 14, axis)}<span></span></div></div>`;
}
function tile(key, label, value, unit, delta, viz, i) {
  const m = M[key];
  return `<div class="card tile tap rise" style="--i:${i};--tint:${css(m.color)}" data-open="${key}"><div class="t-h"><span class="t-l"><i></i>${label}</span>${q(m.q)}</div>
    <div class="tv">${value}<small>${unit}</small></div><div class="td">${delta}</div>${viz}</div>`;
}

// ================= TODAY =================
function todayHeadline() {
  const T = D.T, frac = paceFrac(), usualNow = median(D.hist.slice(-29, -1).map((h) => h.steps)) * frac, ahead = T.steps >= usualNow;
  const h1 = ahead ? (T.steps >= D.goal ? "Step goal done, with the evening to spare." : "A strong day so far.") : "A slower day than usual so far.";
  const wk = D.week >= 150 ? `${D.week} active minutes this week, past the 150 guideline` : `${D.week} of 150 active minutes this week`;
  return [h1, `${T.steps.toLocaleString()} steps by ${ampm(T.now)}, against about ${Math.round(usualNow / 100) * 100 < 1000 ? Math.round(usualNow) : (Math.round(usualNow / 100) * 100).toLocaleString()} on a usual day. ${wk}.`];
}
function todayHero() {
  const T = D.T, p = Math.round((100 * T.steps) / D.goal), ghost = paceFrac() * 100, rec = D.latest.rec, [h1, why] = todayHeadline();
  const heartSvg = S(74, 74, `<circle cx="37" cy="37" r="29" fill="none" stroke="${css("--track")}" stroke-width="7"/><circle class="beat" style="--beat-s:${(60 / T.hrNow).toFixed(2)}s" cx="37" cy="37" r="11" fill="${css("--heart")}"/>`);
  return `<div class="card hero rise" style="--i:1">${gauge({ value: Math.min(100, p), count: p, label: "Activity", big: `${p}<small>%</small>`, verdict: p >= ghost ? "Ahead of pace" : "Behind pace", vcolor: css(p >= ghost ? "--act" : "--watch"), cap: `${T.steps.toLocaleString()} of ${D.goal.toLocaleString()} steps · tick = usual pace`, color: css("--act"), color2: css("--act2"), open: "steps", tick: ghost })}
    <div class="minis">
      ${mini("hrday", heartSvg, "Heart now", `${Math.round(T.hrNow)}`, "bpm", `avg ${Math.round(T.dayHr)} today`)}
      ${mini("recovery", ringSvg(rec / 100, css(`--${stateOf(rec) === "good" ? "good" : stateOf(rec) === "watch" ? "watch" : "bad"}`)), "Recovery", `${rec}`, rec >= 67 ? "recovered" : rec >= 50 ? "steady" : "take it easy", "last night")}
    </div>
    <p class="summary">${h1}<span class="why">${why}</span></p></div>`;
}
function todayPrompts() {
  let out = "";
  const h = D.latest;
  if ((h.trig.length || h.checkIn) && !h.answered) out += `<button class="card inbox rise" style="--i:2" data-gonight><i></i><span><b>One question about last night</b><span>${h.trig.length ? `${cap1(h.trig[0].txt)}.` : "A quick check-in."}</span></span><span class="chev">›</span></button>`;
  for (const s of D.T.sessions) {
    if (s.kind || workoutTags.has(s.a)) continue;
    const wt = workoutTags.get(s.a);
    out += `<div class="card prompt rise" style="--i:2" data-wprompt="${s.a}">
      <p>Your heart rate was up for <b>${s.min} min</b> from ${ampm(s.a)}, with almost no steps. That looks like exercise the step counter can't see. What was it?</p>
      <div class="chips">${["Strength", "Yard or housework", "Cycling", "Other"].map((k) => `<button class="chip ${wt?.kind === k ? "on" : ""}" data-wkind="${k}">${k}</button>`).join("")}</div></div>`;
  }
  for (const [a, wt] of workoutTags) if (wt.kind && wt.rpe == null) {
    out += `<div class="card prompt rise" style="--i:2" data-wprompt="${a}"><p>How hard was the ${wt.kind.toLowerCase()} session?</p>
      <div class="chips">${[["Easy", 3], ["Moderate", 5], ["Hard", 7], ["Very hard", 9]].map(([l, v]) => `<button class="chip" data-wrpe="${v}">${l}</button>`).join("")}</div></div>`;
  }
  return out ? `<div class="stack">${out}</div>` : "";
}
const cap1 = (s) => s[0].toUpperCase() + s.slice(1);
const DAYX = sc(6 * 60, 22 * 60, 0, 300);
function dayAxis() {
  const T = D.T, x = DAYX;
  return [6, 9, 12, 15, 18, 21].filter((hh) => Math.abs(hh * 60 - T.now) > 40).map((hh) => `<text x="${x(hh * 60)}" y="11" text-anchor="middle" class="axis">${hr12(hh)}</text>`).join("") + `<text x="${x(T.now)}" y="11" text-anchor="middle" class="axis" style="fill:var(--ink)">now</text>`;
}
function futureMask(H) { const x0 = DAYX(D.T.now); return `<rect x="${x0.toFixed(1)}" y="0" width="${(300 - x0).toFixed(1)}" height="${H}" fill="${css("--ink3")}" opacity=".06"/><line x1="${x0.toFixed(1)}" x2="${x0.toFixed(1)}" y1="0" y2="${H}" stroke="${css("--ink3")}" stroke-dasharray="2 2" opacity=".6"/>`; }
function dayMontage() {
  const T = D.T, x = DAYX, H = 30, rows = [], line = (pts, color, i) => { const id = `m${uid++}`; return `<defs>${glowDef(id, 1.8)}</defs><path class="draw" style="--i:${i};--len:600" d="${smooth(pts)}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" ${glow(id)}/>`; };
  const shade = T.sessions.map((s) => `<rect x="${x(s.a).toFixed(1)}" y="0" width="${(x(s.b) - x(s.a)).toFixed(1)}" height="${H}" fill="${css("--heart")}" opacity=".12" rx="3"/>`).join("");
  const hrPts = [], yh = sc(55, 130, H - 2, 2);
  for (let k = 0; k < T.n; k += 5) { const w = T.hr.slice(k, k + 5); hrPts.push([x(T.wake + k + w.length / 2), yh(mean(w))]); }
  rows.push(["Heart", "hrday", futureMask(H) + shade + line(hrPts, css("--heart"), 1), `${Math.round(T.hrNow)} now<small>high ${Math.round(T.hrHi)}</small>`]);
  const bins = []; for (let k = 0; k < T.n; k += 10) bins.push([T.wake + k, T.stepsMin.slice(k, k + 10).reduce((a, b) => a + b, 0)]);
  const bmax = Math.max(...bins.map((b) => b[1]), 1);
  rows.push(["Steps", "steps", futureMask(H) + `<g class="fadein" style="--i:2">${bins.map(([t, v]) => (v ? `<rect x="${x(t).toFixed(1)}" y="${(H - 2 - (v / bmax) * (H - 4)).toFixed(1)}" width="${Math.max(1, x(t + 10) - x(t) - 0.6).toFixed(1)}" height="${((v / bmax) * (H - 4)).toFixed(1)}" rx="1" fill="${css("--steps")}"/>` : "")).join("")}</g>`, `${T.steps.toLocaleString()}<small>${Math.round((100 * T.steps) / D.goal)}% of goal</small>`]);
  rows.push(["Active", "mvpa", futureMask(H) + `<g class="fadein" style="--i:3">${T.brisk.map((b, k) => (b ? `<rect x="${x(T.wake + k).toFixed(1)}" y="8" width="1.2" height="14" fill="${css("--act")}"/>` : "")).join("")}</g>`, `${T.mvpa} min<small>${D.week} this week</small>`]);
  const cells = []; for (let hh = 7; hh < 22; hh++) { const done = hh < T.nowH, on = done && T.hourly[hh] >= 250, curH = hh === T.nowH; cells.push(`<rect x="${(x(hh * 60) + 1).toFixed(1)}" y="7" width="${(x(hh * 60 + 60) - x(hh * 60) - 2).toFixed(1)}" height="16" rx="4" fill="${on ? css("--breath") : "none"}" stroke="${on ? "none" : css("--ink3")}" stroke-opacity="${done || curH ? 0.55 : 0.2}" ${curH ? `stroke-dasharray="2 2"` : ""}/>`); }
  rows.push(["Moving", "moveH", `<g class="fadein" style="--i:4">${cells.join("")}</g>`, `${T.moveH} of ${T.nowH - 7} h<small>250+ steps</small>`]);
  return montage(rows, dayAxis(), `${ampm(T.wake)} – now`, "tap a row");
}
function vHrDay() {
  const T = D.T, W0 = 150, H = 50, x = sc(T.wake, T.now, 4, W0 - 8), y = sc(55, 130, H - 4, 4), pts = [];
  for (let k = 0; k < T.n; k += 10) pts.push([x(T.wake + k + 5), y(mean(T.hr.slice(k, k + 10)))]);
  return S(W0, H, `<line x1="4" x2="${W0 - 4}" y1="${y(T.hrr40)}" y2="${y(T.hrr40)}" stroke="${css("--heart")}" stroke-opacity=".35" stroke-dasharray="3 3"/><path class="draw" style="--i:3;--len:300" d="${smooth(pts)}" fill="none" stroke="${css("--heart")}" stroke-width="1.6"/>
    <circle class="beat" style="--beat-s:${(60 / T.hrNow).toFixed(2)}s" cx="${x(T.now)}" cy="${y(T.hrNow)}" r="4.5" fill="${css("--heart")}" stroke="${css("--bg")}" stroke-width="2"/>`);
}
function vSteps() {
  const W0 = 150, H = 50, bw = W0 / 24, max = Math.max(...D.T.hourly, ...D.typical, 1);
  const bar = (v, i, fill, op) => (v ? `<rect x="${(i * bw + 0.9).toFixed(1)}" y="${(H - 3 - (v / max) * (H - 8)).toFixed(1)}" width="${(bw - 1.8).toFixed(1)}" height="${((v / max) * (H - 8) + 3).toFixed(1)}" rx="1.5" fill="${fill}" opacity="${op}"/>` : "");
  return S(W0, H, D.typical.map((v, i) => bar(v, i, css("--ink3"), 0.2)).join("") + D.T.hourly.map((v, i) => bar(v, i, css("--steps"), 1)).join(""));
}
function vMvpa() {
  const W0 = 150, H = 50, days = [...D.hist.slice(-7, -1).map((h) => [h.d, h.mvpa]), [D.latest.d, D.T.mvpa]], max = Math.max(45, ...days.map((d) => d[1])), bw = W0 / 7, y = sc(0, max, H - 12, 4);
  return S(W0, H, `<line x1="0" x2="${W0}" y1="${y(150 / 7)}" y2="${y(150 / 7)}" stroke="${css("--ink3")}" stroke-dasharray="3 3" opacity=".7"/>` + days.map(([d, v], i) => `<rect x="${(i * bw + 3).toFixed(1)}" y="${y(v).toFixed(1)}" width="${(bw - 6).toFixed(1)}" height="${Math.max(1.5, y(0) - y(v)).toFixed(1)}" rx="3" fill="${css("--act")}" opacity="${i === 6 ? 1 : 0.5}"/><text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 1}" text-anchor="middle" class="axis" style="font-size:8.5px">${DAYS[d.getDay()][0]}</text>`).join(""));
}
function vMoveH() {
  const T = D.T, W0 = 150, H = 50, cw = W0 / 15;
  const cells = []; for (let hh = 7; hh < 22; hh++) { const i = hh - 7, done = hh < T.nowH, on = done && T.hourly[hh] >= 250, curH = hh === T.nowH; cells.push(`<rect x="${(i * cw + 1).toFixed(1)}" y="${i % 2 ? 22 : 12}" width="${(cw - 2).toFixed(1)}" height="16" rx="3" fill="${on ? css("--breath") : "none"}" stroke="${on ? "none" : css("--ink3")}" stroke-opacity="${done || curH ? 0.6 : 0.2}" ${curH ? `stroke-dasharray="2 2"` : ""}/>`); }
  return S(W0, H, cells.join("") + `<text x="0" y="${H - 1}" class="axis" style="font-size:8.5px">7a</text><text x="${W0}" y="${H - 1}" text-anchor="end" class="axis" style="font-size:8.5px">10p</text>`);
}
function todayTiles() {
  const T = D.T, u = median(D.hist.slice(-29, -1).map((h) => h.dayHr)), frac = paceFrac(), su = median(D.hist.slice(-29, -1).map((h) => h.steps)) * frac;
  return `<div class="tiles">
    ${tile("hrday", "Heart rate", Math.round(T.hrNow), "bpm now", `daytime avg ${Math.round(T.dayHr)} · usual ${Math.round(u)}`, vHrDay(), 5)}
    ${tile("steps", "Steps", T.steps.toLocaleString(), "", `${T.steps >= su ? `<span class="up">ahead</span>` : `<span class="warn">behind</span>`} of usual by now`, vSteps(), 6)}
    ${tile("mvpa", "Active minutes", T.mvpa, "min", D.week >= 150 ? `<span class="up">${D.week}</span> this week · goal 150` : `${D.week} of 150 this week`, vMvpa(), 7)}
    ${tile("moveH", "Moving hours", T.moveH, `of ${T.nowH - 7}`, T.stillNow >= 60 ? `<span class="warn">still for ${short(T.stillNow)}</span>` : `longest still ${short(T.longestStill)}`, vMoveH(), 8)}
  </div>`;
}
function workouts() {
  const T = D.T;
  if (!T.sessions.length) return `<div class="card rise" style="--i:9"><p class="note" style="margin:0">No workouts yet today. Sessions of 10+ minutes at ${Math.round(T.hrr40)}+ bpm show up here automatically.</p></div>`;
  return `<div class="card rise wk-list" style="--i:9">${T.sessions.map((s) => {
    const wt = workoutTags.get(s.a), kind = s.kind === "walk" ? "Brisk walk" : wt?.kind ?? "Untagged session", x = sc(0, Math.max(...T.sessions.map((z) => z.min)), 0, 120);
    const load = wt?.rpe ? `load ${wt.rpe * s.min}` : `TRIMP ${s.trimp.toFixed(0)}`;
    return `<div class="wk"><div class="wk-t"><b>${kind}</b><span>${ampm(s.a)} · ${s.min} min · avg ${Math.round(s.avg)} bpm${s.spm >= 60 ? ` · ${Math.round(s.spm)} steps/min` : ""}</span></div>
      ${S(120, 12, `<rect x="0" y="2" width="${x(s.zone[0]).toFixed(1)}" height="8" rx="4" fill="${css("--watch")}" opacity=".75"/><rect x="${x(s.zone[0]).toFixed(1)}" y="2" width="${(x(s.min) - x(s.zone[0])).toFixed(1)}" height="8" rx="4" fill="${css("--heart")}"/>`)}
      <em>${load}</em></div>`;
  }).join("")}<p class="note">Bars: minutes at moderate (${Math.round(T.hrr40)}+ bpm, amber) and vigorous (${Math.round(T.hrr60)}+ bpm, red) effort, from your heart-rate reserve. Tagged sessions use effort × minutes as load (Foster 2001).</p></div>`;
}
function today() {
  const d = D.latest.d;
  return `${header(`${FULLDAY[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`, "Today", `<span class="hchip"><i></i>Synced 4 min ago</span>`)}
    ${todayHero()}
    ${todayPrompts()}
    <div class="sec rise" style="--i:4"><h2>Across the day</h2><span class="lbl">4 channels</span></div>
    ${dayMontage()}
    <div class="sec rise" style="--i:5"><h2>Activity</h2><span class="lbl">vs your usual by now</span></div>
    ${todayTiles()}
    <div class="sec rise" style="--i:9"><h2>Workouts</h2><span class="lbl">detected from heart rate</span></div>
    ${workouts()}
    <p class="note foot">Concept · synthetic data. Profile → Preview switches between a good and a rough night.</p>`;
}

// ================= NIGHT =================
function nightStrip() {
  const hs = D.hist.slice(-21), off = D.hist.length - 21;
  return `<div class="nstrip rise" style="--i:0" id="nstrip">${hs.map((h, k) => { const i = off + k, st = stateOf(h.rec); return `<button class="nd ${i === D.i ? "on" : ""}" data-night="${i}" aria-label="${nightName(h)}"><span>${DAYS[h.d.getDay()][0]}</span><b>${h.d.getDate()}</b><i style="background:var(--${st})"></i></button>`; }).join("")}</div>`;
}
function sleepClock() {
  const nt = D.nt, W0 = 74, c = 37, r = 29, toA = (min) => ((min % 720) / 720) * Math.PI * 2 - Math.PI / 2;
  let a0 = toA(nt.onset), a1 = toA(nt.wake); if (a1 <= a0) a1 += Math.PI * 2;
  const id = `s${uid++}`;
  const ticks = [0, 3, 6, 9].map((k) => { const a = (k / 12) * Math.PI * 2 - Math.PI / 2; return `<line x1="${c + (r - 11) * Math.cos(a)}" y1="${c + (r - 11) * Math.sin(a)}" x2="${c + (r - 7) * Math.cos(a)}" y2="${c + (r - 7) * Math.sin(a)}" stroke="${css("--ink3")}" stroke-width="1.5" stroke-linecap="round"/>`; }).join("");
  return S(W0, W0, `<defs>${glowDef(id, 2.5)}</defs><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${css("--track")}" stroke-width="7"/>${ticks}
    <path class="draw" style="--len:${(r * (a1 - a0)).toFixed(0)}" d="${arcPath(c, c, r, a0, a1)}" fill="none" stroke="${css("--sleep")}" stroke-width="7" stroke-linecap="round" ${glow(id)}/>
    <text x="${c}" y="${c - r + 17}" text-anchor="middle" class="axis" style="font-size:8.5px">12</text><text x="${c}" y="${c + r - 11}" text-anchor="middle" class="axis" style="font-size:8.5px">6</text>`);
}
function stagesDonut() {
  const c = 37, r = 29, len = 2 * Math.PI * r, cnt = (s) => D.nt.stages.filter((v) => v === s).length, tot = D.nt.asleepMin;
  let off = 0; const segs = [[1, cnt(1)], [3, cnt(3)], [2, cnt(2)]].map(([s, v]) => { const l = (v / tot) * len, g = 2.5; const out = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${stageColor(s)}" stroke-width="7" transform="rotate(-90 ${c} ${c})" stroke-dasharray="${Math.max(0, l - g).toFixed(1)} ${(len - l + g).toFixed(1)}" stroke-dashoffset="${(-off).toFixed(1)}" class="fadein" style="--i:${s}"/>`; off += l; return out; }).join("");
  return S(74, 74, `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${css("--track")}" stroke-width="7"/>${segs}`);
}
function nightHeadline() {
  const h = D.last, e = expOf("hrv"), dMin = Math.round((h.sleepH - D.usualSleep) * 60), len = dMin >= -15 ? "full" : dMin >= -50 ? "slightly short" : "short";
  const awake = D.nt.stages.filter((v) => v === 4).length, restless = awake > 1.6 * 0.02 * D.nt.N;
  const h1 = h.rec >= 67 ? `Recovered, after a ${len} night.` : h.rec >= 50 ? `Steady, after a ${len} night.` : `A ${len}${restless ? ", unsettled" : ""} night. Your body is working harder.`;
  const f = [], dR = h.rhr - usual("rhr");
  f.push([Math.abs(dMin) / 35, `sleep ran ${Math.abs(dMin)} min ${dMin >= 0 ? "over" : "under"} your usual`]);
  if (Math.abs(dR) >= 1.5) f.push([Math.abs(dR) / 1.5, `resting HR ${dR > 0 ? "ran" : "came in"} ${Math.abs(dR).toFixed(0)} bpm ${dR > 0 ? "over" : "under"} your usual`]);
  if (e) { const inside = D.hrv >= e.lo && D.hrv <= e.hi; f.push([inside ? 0.9 : 2.2, inside ? `HRV landed inside what that much sleep predicts` : `HRV came in ${D.hrv < e.lo ? "below" : "above"} what ${hm(h.sleepH)} of sleep predicts`]); }
  if (h.tdev >= 0.2) f.push([1.6, `skin temperature ran warm`]);
  if (h.br - usual("br") >= 1) f.push([1.4, `breathing was faster than usual`]);
  const top = f.sort((a, b) => b[0] - a[0]).slice(0, 2).map((z) => z[1]);
  return [h1, `${cap1(top.join(", and "))}.`];
}
function nightHero() {
  const h = D.last, prior = D.H.slice(-29, -1).map((z) => z.rec).filter((v) => v != null), lo = Math.round(median(prior) - sd(prior)), hi = Math.round(median(prior) + sd(prior));
  const [h1, why] = nightHeadline(), cnt = (s) => D.nt.stages.filter((v) => v === s).length;
  return `<div class="card hero rise" style="--i:1">${gauge({ value: h.rec, label: "Recovery", big: `${h.rec}`, verdict: h.rec >= 67 ? "Recovered" : h.rec >= 50 ? "Steady" : "Take it easy", color: css("--state"), open: "recovery", range: [lo, hi], cap: `your usual range ${lo}–${hi}` })}
    <div class="minis">
      ${mini("sleep", sleepClock(), "Sleep", `${h.sleepScore}`, `${hm(h.sleepH)} asleep`, `${clock(D.nt.onset)}–${clock(D.nt.wake)}`)}
      ${mini("sleep", stagesDonut(), "Deep + REM", short(cnt(1) + cnt(3)), `${Math.round((100 * (cnt(1) + cnt(3))) / D.nt.asleepMin)}% of sleep`, "wrist estimate")}
    </div>
    <p class="summary">${h1}<span class="why">${why}</span></p></div>`;
}
const ASK = [{ key: "alcohol", label: "Alcohol" }, { key: "caffeine", label: "Late caffeine" }, { key: "stress", label: "Stress" }, { key: "sick", label: "Feeling ill" }];
function nightPrompt() {
  const h = D.last, tagsOf = (z) => [...W.TAGS.filter((t) => !t.auto && z.t[t.key]).map((t) => t.label), ...(z.sick ? ["Feeling ill"] : [])];
  const auto = h.t.workout && h.lateWorkoutAt ? `<span class="auto">Late workout detected · ${ampm(h.lateWorkoutAt)}</span>` : "";
  if (h.asked || h.answered) {
    const tg = tagsOf(h);
    return `<div class="noted rise" style="--i:2"><i>✓</i><span>${h.answered ? "You noted" : "Noted"}: <b>${tg.length ? tg.join(" · ") : "nothing unusual"}</b>${h.trig?.length ? "" : `<em>check-in</em>`}</span>${h.answered ? `<button class="link" data-undo="${D.i}">Undo</button>` : ""}${auto}</div>`;
  }
  if (!h.trig?.length && !h.checkIn) return auto ? `<div class="noted rise" style="--i:2">${auto}</div>` : "";
  const reasons = h.trig.map((t) => t.txt);
  const txt = reasons.length ? `${cap1(thatNight())}, ${reasons.length > 1 ? `${reasons.slice(0, -1).join(", ")} and ${reasons[reasons.length - 1]}` : reasons[0]}. Anything that might explain it?`
    : `A quick check-in about ${thatNight()}. Pulse asks on a few ordinary nights too, so it can tell what really moves your numbers.`;
  return `<div class="card prompt rise" style="--i:2" id="prompt"><p>${txt}</p>
    <div class="chips">${ASK.map((t) => `<button class="chip ${draft.has(t.key) ? "on" : ""}" data-draft="${t.key}">${t.label}</button>`).join("")}</div>
    <div class="p-act"><button class="chip ghost" data-answer="none">Nothing unusual</button><button class="chip solid" data-answer="save" ${draft.size ? "" : "disabled"}>Save</button></div>${auto ? `<div class="p-auto">${auto}</div>` : ""}</div>`;
}
function nightMontage() {
  const nt = D.nt, W0 = 300, H = 30, N = nt.N, x = sc(0, N, 0, W0), rows = [], lv = { 4: 2, 3: 8, 2: 15, 1: 23 };
  let st = "", start = 0;
  for (let i = 1; i <= nt.stages.length; i++) if (i === nt.stages.length || nt.stages[i] !== nt.stages[start]) {
    st += `<rect x="${x(start).toFixed(1)}" y="${lv[nt.stages[start]]}" width="${Math.max(0.8, x(i) - x(start)).toFixed(1)}" height="${nt.stages[start] === 4 ? 4 : 5}" rx="2" fill="${stageColor(nt.stages[start])}"/>`; start = i;
  }
  const deep = nt.stages.filter((v) => v === 1).length, rem = nt.stages.filter((v) => v === 3).length;
  rows.push(["Stages", "sleep", `<g class="fadein" style="--i:0">${st}</g>`, `${short(deep)} deep<small>${short(rem)} REM</small>`]);
  const line = (pts, color, i, fill = false) => { const id = `m${uid++}`; const d = smooth(pts); return `<defs>${glowDef(id, 1.8)}</defs>${fill ? `<path d="${d}L${W0},${H}L0,${H}Z" fill="${color}" fill-opacity=".14" class="fadein" style="--i:${i}"/>` : ""}<path class="draw" style="--i:${i};--len:600" d="${d}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" ${glow(id)}/>`; };
  const hrPts = [], yh = sc(D.last.rhr - 6, D.last.rhr + 14, H - 2, 2);
  for (let i = 0; i < nt.hr.length; i += 8) { const w = nt.hr.slice(i, i + 8); hrPts.push([x(i + w.length / 2), yh(mean(w))]); }
  const low = Math.min(...nt.hr), lowAt = nt.hr.indexOf(low);
  rows.push(["Heart", "rhr", line(hrPts, css("--heart"), 1) + `<circle cx="${x(lowAt)}" cy="${yh(low)}" r="2.6" fill="${css("--heart")}" class="fadein" style="--i:3"/>`, `low ${Math.round(low)}<small>at ${clock(nt.onset + lowAt)}</small>`]);
  const yv = sc(Math.min(8, D.hrv - 14), Math.max(46, D.hrv + 14), H - 3, 3);
  rows.push(["HRV", "hrv", `<g class="fadein" style="--i:2">${nt.bursts.map((b) => `<circle cx="${x(b.m).toFixed(1)}" cy="${yv(b.rmssd).toFixed(1)}" r="${b.ok ? 2.3 : 1.7}" fill="${b.ok ? css("--hrv") : "none"}" stroke="${b.ok ? "none" : css("--ink3")}"/>`).join("")}</g>`, `${D.hrv.toFixed(0)} ms<small>${nt.good.length}/${nt.bursts.length} clean</small>`]);
  rows.push(["Breath", "breath", line(nt.good.map((b) => [x(b.m), sc(D.last.br - 3, D.last.br + 3.5, H - 3, 3)(b.br)]), css("--breath"), 3), `${median(nt.good.map((b) => b.br)).toFixed(1)}/min<small>${D.last.br - usual("br") >= 1 ? "faster" : "steady"}</small>`]);
  const ys = sc(92, 100, H - 2, 2);
  rows.push(["SpO₂", "spo2", `<g class="fadein" style="--i:4">${nt.bursts.map((b) => `<circle cx="${x(b.m).toFixed(1)}" cy="${ys(b.spo2).toFixed(1)}" r="1.7" fill="${css("--spo2")}"/>`).join("")}</g>`, `${median(nt.bursts.map((b) => b.spo2))}%<small>low ${Math.min(...nt.bursts.map((b) => b.spo2))}</small>`]);
  rows.push(["Temp", "temp", line(nt.bursts.map((b) => [x(b.m), sc(34, 36, H - 2, 2)(b.temp)]), css("--temp"), 5, true), `${sign(D.last.tdev * 1.8)}°<small>vs usual</small>`]);
  rows.push(["Rhythm", "", `<g class="fadein" style="--i:6">${nt.good.map((b) => `<rect x="${(x(b.m) - 1).toFixed(1)}" y="9" width="2" height="12" rx="1" fill="${css("--good")}" opacity=".85"/>`).join("")}</g>`, `regular<small>${nt.good.length}/${nt.good.length} checked</small>`]);
  const hours = []; for (let t = Math.ceil(nt.onset / 60) * 60; t < nt.wake; t += 60) if ((t / 60) % 2 === 0) hours.push(t);
  const tax = hours.map((t) => `<text x="${x(t - nt.onset)}" y="11" text-anchor="middle" class="axis">${clock(t).replace(":00", "")}</text>`).join("");
  return montage(rows, tax, `${ampm(nt.onset)} – ${ampm(nt.wake)}`, "tap a row");
}
function vRhr() {
  const W0 = 150, H = 50, x = sc(50, 72, 4, W0 - 4), past = D.H.slice(-15, -1).map((h) => h.rhr), you = [median(past) - sd(past), median(past) + sd(past)];
  return S(W0, H, `<line x1="4" x2="${W0 - 4}" y1="24" y2="24" stroke="${css("--track")}" stroke-width="6" stroke-linecap="round"/>
    <rect x="${x(you[0])}" y="18" width="${x(you[1]) - x(you[0])}" height="12" rx="6" fill="${css("--heart")}" opacity=".25"/>
    ${past.map((v) => `<line x1="${x(v).toFixed(1)}" x2="${x(v).toFixed(1)}" y1="14" y2="34" stroke="${css("--heart")}" stroke-opacity=".35"/>`).join("")}
    <circle class="beat" style="--beat-s:${(60 / D.last.rhr).toFixed(2)}s" cx="${x(D.last.rhr)}" cy="24" r="6" fill="${css("--heart")}" stroke="${css("--bg")}" stroke-width="2"/>
    <text x="${x(you[0])}" y="48" class="axis">usual ${Math.round(you[0])}–${Math.round(you[1])}</text>`);
}
function vHrv() {
  const W0 = 150, H = 50, vals = D.H.slice(-14).map((h) => h.hrv), x = sc(0, 13, 5, W0 - 5), e = expOf("hrv"), y = sc(Math.min(10, ...vals), Math.max(46, ...vals), H - 5, 5);
  return S(W0, H, `<rect x="0" width="${W0}" y="${y(e.hi)}" height="${y(e.lo) - y(e.hi)}" rx="6" fill="${css("--hrv")}" opacity=".13"/>
    <path class="draw" style="--i:3;--len:300" d="${smooth(vals.map((v, i) => [x(i), y(v)]))}" fill="none" stroke="${css("--hrv")}" stroke-opacity=".55" stroke-width="1.4"/>
    ${vals.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${i === 13 ? 4.5 : 2.2}" fill="${css("--hrv")}" ${i === 13 ? `stroke="${css("--bg")}" stroke-width="2"` : ""}/>`).join("")}`);
}
function vBreath() {
  const W0 = 150, H = 50, vals = D.H.slice(-14).map((h) => h.br), x = sc(0, 13, 5, W0 - 5), y = sc(Math.min(13.5, ...vals), Math.max(18, ...vals), H - 5, 5), id = `b${uid++}`;
  return S(W0, H, `<defs>${glowDef(id, 2)}</defs><path class="draw" style="--i:3;--len:300" d="${smooth(vals.map((v, i) => [x(i), y(v)]))}" fill="none" stroke="${css("--breath")}" stroke-width="2.2" stroke-linecap="round" ${glow(id)}/><circle cx="${x(13)}" cy="${y(vals[13])}" r="4" fill="${css("--breath")}"/>`);
}
function vSpo2() {
  const W0 = 150, H = 50, x = sc(0, D.nt.N, 5, W0 - 5), y = sc(90, 100, H - 5, 5);
  return S(W0, H, `<rect x="0" width="${W0}" y="${y(100)}" height="${y(95) - y(100)}" rx="6" fill="${css("--spo2")}" opacity=".10"/>${D.nt.bursts.map((b) => `<circle cx="${x(b.m).toFixed(1)}" cy="${y(b.spo2).toFixed(1)}" r="2.2" fill="${css("--spo2")}"/>`).join("")}<text x="${W0}" y="${y(95) + 11}" text-anchor="end" class="axis">95</text>`);
}
function vTemp() {
  const W0 = 150, H = 50, vals = D.H.slice(-14).map((h) => h.tdev * 1.8), bw = W0 / 14, y0 = H / 2;
  return S(W0, H, `<line x1="0" x2="${W0}" y1="${y0}" y2="${y0}" stroke="${css("--track")}"/>` + vals.map((v, i) => { const h = Math.max(1.5, Math.min(22, Math.abs(v) * 20)); return `<rect x="${(i * bw + 1.6).toFixed(1)}" y="${(v >= 0 ? y0 - h : y0).toFixed(1)}" width="${(bw - 3.2).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${css(v >= 0.36 ? "--bad" : "--temp")}" opacity="${i === 13 ? 1 : 0.5}"/>`; }).join(""));
}
function vTiming() {
  const W0 = 150, H = 50, hs = D.H.slice(-14), bw = W0 / 14, y = sc(21 * 60, 33 * 60, 3, H - 3), um = median(hs.map((h) => h.mid)) + 1440;
  return S(W0, H, `<line x1="0" x2="${W0}" y1="${y(um)}" y2="${y(um)}" stroke="${css("--ink3")}" stroke-dasharray="3 3" opacity=".7"/>` + hs.map((h, i) => `<rect x="${(i * bw + 2).toFixed(1)}" y="${y(h.onset).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${(y(h.wake) - y(h.onset)).toFixed(1)}" rx="3" fill="${css("--sleep")}" opacity="${i === 13 ? 1 : 0.4}"/>`).join(""));
}
function nightTiles() {
  const h = D.last, e = expOf("hrv"), dR = h.rhr - usual("rhr"), inside = D.hrv >= e.lo && D.hrv <= e.hi, dB = h.br - usual("br");
  const tms = D.H.slice(-15, -1).map((z) => z.mid), dMid = h.mid - median(tms), spread = sd(tms);
  return `<div class="tiles">
    ${tile("rhr", "Resting HR", h.rhr.toFixed(1), "bpm", Math.abs(dR) < 1.5 ? `right at your usual` : dR > 0 ? `<span class="dn">▲ ${dR.toFixed(0)}</span> over your usual` : `<span class="up">▼ ${(-dR).toFixed(0)}</span> under your usual`, vRhr(), 5)}
    ${tile("hrv", "Overnight HRV", D.hrv.toFixed(0), "ms", `${inside ? `<span class="up">within</span>` : `<span class="warn">${D.hrv < e.lo ? "below" : "above"}</span>`} expected ${e.lo.toFixed(0)}–${e.hi.toFixed(0)}`, vHrv(), 6)}
    ${tile("breath", "Breathing", h.br.toFixed(1), "/min", dB >= 1 ? `<span class="warn">${sign(dB)}</span> vs usual` : `steady · usual ${usual("br").toFixed(1)}`, vBreath(), 7)}
    ${tile("spo2", "Oxygen asleep", median(D.nt.bursts.map((b) => b.spo2)), "%", `lowest ${Math.min(...D.nt.bursts.map((b) => b.spo2))}% · ${D.nt.bursts.length} readings`, vSpo2(), 8)}
    ${tile("temp", "Skin temp", sign(h.tdev * 1.8), "°F", h.trig?.some((t) => t.k === "temp") ? `<span class="warn">2nd warm night</span>` : h.tdev >= 0.2 ? `<span class="warn">warm</span> vs usual` : `no warming trend`, vTemp(), 9)}
    ${tile("timing", "Sleep timing", clock(D.nt.onset), `– ${clock(D.nt.wake)}`, Math.abs(dMid) < 20 ? `on your usual schedule · ±${Math.round(spread)} min` : `<span class="warn">${Math.round(Math.abs(dMid))} min ${dMid > 0 ? "later" : "earlier"}</span> than usual`, vTiming(), 10)}
  </div>`;
}
function night() {
  const h = D.last;
  return `${header(`${nightName(h)} · ${nightDates(h)}`, isLatest() ? "Last night" : "Night", isLatest() ? `<span class="hchip"><i></i>Synced 4 min ago</span>` : `<button class="hchip btn" data-night="${D.L}">Last night ›</button>`)}
    ${nightStrip()}
    ${nightHero()}
    ${nightPrompt()}
    <div class="sec rise" style="--i:4"><h2>Across the night</h2><span class="lbl">7 channels</span></div>
    ${nightMontage()}
    <div class="sec rise" style="--i:5"><h2>Vitals</h2><span class="lbl">vs your usual</span></div>
    ${nightTiles()}
    <p class="note foot">Concept · synthetic data. Tap a night above to go back; every tile opens that night's detail.</p>`;
}

// ================= DRILL-DOWN =================
function bandsOf(key) {
  const m = M[key], ser = series(m);
  if (m.day) {
    const prior = ser.slice(-28).map(m.get), f = m.frac();
    return { m, ser, cur: m.today(), rcur: m.get(ser[ser.length - 1]), you: [(median(prior) - sd(prior)) * f, (median(prior) + sd(prior)) * f], e: null };
  }
  const prior = ser.slice(-29, -1).map(m.get), cur = m.get(ser[ser.length - 1]);
  return { m, ser, cur, you: [median(prior) - sd(prior), median(prior) + sd(prior)], e: expOf(key) };
}
function bandRow(lbl, b, style, cur, lo, hi, m) {
  const W0 = 230, x = sc(lo, hi, 5, W0 - 5), fa = m.fa ?? m.f;
  return `<div class="band"><span>${lbl}</span>${S(W0, 20, `<line x1="5" x2="${W0 - 5}" y1="10" y2="10" stroke="${css("--track")}" stroke-width="3" stroke-linecap="round"/><rect x="${x(b[0])}" y="4" width="${Math.max(4, x(b[1]) - x(b[0]))}" height="12" rx="6" fill="${style === "pop" ? css("--ink3") : css(m.color)}" opacity="${style === "pop" ? 0.25 : style === "exp" ? 0.5 : 0.28}"/><circle cx="${clamp(x(cur), 5, W0 - 5)}" cy="10" r="5.5" fill="${css(m.color)}" stroke="${css("--bg")}" stroke-width="2"/>`)}<span class="bv">${fa(b[0])}–${fa(b[1])}</span></div>`;
}
function ctxText(key, B) {
  const { m, cur, you, e } = B, dSleep = D.last.sleepH - D.usualSleep, T = D.T;
  const sleepTxt = `You slept ${dur(dSleep)} ${dSleep < 0 ? "less" : "more"} than usual.`;
  if (e) {
    const inside = cur >= e.lo && cur <= e.hi, worse = m.better * (cur - e.center) < 0, askable = !D.last.asked && !D.last.answered && (D.last.trig?.length || D.last.checkIn);
    const per = `In your data each hour of sleep moves ${m.lc} by ${Math.abs(e.slope).toFixed(1)} ${m.unit} (±${(1.96 * e.slopeSe).toFixed(1)}), so ${isLatest() ? "expected tonight" : "expected that night"} was ${m.f(e.lo)}–${m.f(e.hi)} ${m.unit}.`;
    return `${sleepTxt} ${per} <b>${m.f(cur)} ${m.unit} is ${inside ? "inside that range" : cur < e.lo ? "below that range" : "above that range"}.</b>${!inside && worse ? ` Something besides sleep is likely involved.${askable ? ` <button class="chip" style="margin-top:8px" data-close data-goto="prompt">Answer Pulse's question</button>` : ""}` : ""}`;
  }
  if (key === "sleep") return `${hm(cur)} asleep, ${dur(dSleep)} ${dSleep < 0 ? "under" : "over"} your usual ${hm(D.usualSleep)}. Adults 26–64 need 7–9 h (National Sleep Foundation). Sleep score ${D.last.sleepScore}: duration ${Math.round(D.last.sleepParts.dur)}, efficiency ${Math.round(D.last.sleepParts.eff)}, regular timing ${Math.round(D.last.sleepParts.reg)} (weights 50/25/25).`;
  if (key === "recovery") return `A blend of four parts, each compared with your own last 28 nights. Open <b>${isLatest() ? "Last night" : "That night"}</b> to see every part and the math.`;
  if (key === "timing") { const um = median(D.H.slice(-15, -1).map((h) => h.mid)); return `Asleep ${ampm(D.nt.onset)}, up ${ampm(D.nt.wake)}. The middle of your sleep was ${Math.round(Math.abs(cur - um))} min ${cur >= um ? "later" : "earlier"} than your 14-night usual (${ampm(um)}).`; }
  if (key === "steps") return `${T.steps.toLocaleString()} so far today, ${Math.round((100 * T.steps) / D.goal)}% of ${D.goal.toLocaleString()}. By ${ampm(T.now)} you usually have ${m.f(you[0])}–${m.f(you[1])}. Yesterday: <b>${m.f(B.rcur)}</b>. Adults under 60 get most of the mortality benefit by ~8,000 a day (Paluch 2022).`;
  if (key === "hrday") return `Averaging <b>${cur.toFixed(0)} bpm</b> while awake and not exercising, ${cur >= you[0] && cur <= you[1] ? "inside" : cur > you[1] ? "above" : "below"} your usual ${m.f(you[0])}–${m.f(you[1])}. Right now: ${Math.round(T.hrNow)} bpm. Highest today ${Math.round(T.hrHi)}, during a workout.`;
  if (key === "mvpa") return `<b>${T.mvpa} active minutes</b> today and ${D.week} over the last 7 days, toward the 150 a week of moderate activity adults need (AHA, WHO). Your strength session counts by heart rate, not steps.`;
  if (key === "moveH") return `You moved (250+ steps) in <b>${T.moveH} of the ${T.nowH - 7} hours</b> since 7 AM. Longest still stretch today: ${short(T.longestStill)}. Short walking breaks during long sitting lower blood sugar and insulin after meals (Dunstan 2012).`;
  if (key === "spo2") return `Spot readings every 10 minutes. These can show a low night but can't count breathing pauses; that needs a sleep study or a 1-second oximeter.`;
  const inside = cur >= you[0] && cur <= you[1];
  return `${inside ? "Inside" : cur < you[0] ? "Below" : "Above"} your usual range (median ± one typical swing, last 28 nights).`;
}
function drill(key) {
  const B = bandsOf(key), { m, cur, you, e } = B, pop = popOf(m), T = D.T;
  const cands = [cur, you[0], you[1], ...(pop ?? []), ...(e ? [e.lo, e.hi] : [])], span = Math.max(...cands) - Math.min(...cands) || 1;
  const lo = Math.min(...cands) - span * 0.1, hi = Math.max(...cands) + span * 0.1;
  const views = [["now", m.day ? "Today" : isLatest() ? m.nowLbl : "That night"], ["time", "Over time"], ["range", "Your range"], ["affects", "What affects it"]];
  const h = D.last, ev = eveOf(h);
  const meta = m.day ? `Today so far · ${ampm(T.now)}<br>${key === "steps" ? `${Math.round((100 * T.steps) / D.goal)}% of daily goal` : key === "mvpa" ? `${D.week} min over 7 days` : key === "hrday" ? `now ${Math.round(T.hrNow)} bpm` : `${T.nowH - 7} hours so far`}<br>${cur >= you[0] && cur <= you[1] ? "within your usual by now" : cur < you[0] ? "below your usual by now" : "above your usual by now"}`
    : `Night of ${MON[ev.getMonth()]} ${ev.getDate()} → ${h.d.getDate()}<br>${["hrv", "breath", "spo2", "temp"].includes(key) ? `${D.nt.good.length} of ${D.nt.bursts.length} recordings clean` : key === "sleep" || key === "timing" ? `${ampm(D.nt.onset)} – ${ampm(D.nt.wake)}` : "all sensors"}<br>${e ? (cur >= e.lo && cur <= e.hi ? "within expected" : cur < e.lo ? "below expected" : "above expected") : cur >= you[0] && cur <= you[1] ? "within your usual" : cur < you[0] ? "below your usual" : "above your usual"}`;
  const bandsHtml = key === "timing" ? "" : `<div class="bands">${pop ? bandRow(m.popLbl, pop, "pop", cur, lo, hi, m) : ""}${bandRow(m.day && m.frac() < 1 ? `Usual by ${clock(T.now)}` : "Your usual", you, "you", cur, lo, hi, m)}${e ? bandRow(isLatest() ? "Expected tonight" : "Expected", [e.lo, e.hi], "exp", cur, lo, hi, m) : ""}</div>`;
  return `<div class="aurora"><i class="a"></i><i class="b"></i><i class="c"></i></div><div class="inner">
    <div class="m-top"><button class="back" data-close>‹ ${TABS[tab]}</button>${q(m.q)}</div>
    <div class="lbl m-lbl">${m.title}${m.day ? " · today" : isLatest() ? "" : ` · ${nightName(h)}`}</div>
    <div class="m-hero"><div class="m-big">${m.big ? m.big(cur) : `${m.f(cur)}<small>${m.unit}</small>`}</div><div class="m-meta">${meta}</div></div>
    ${bandsHtml}
    <div class="ctx">${ctxText(key, B)}</div>
    <div class="seg">${views.map(([k, l]) => `<button data-view="${k}" class="${view === k ? "on" : ""}">${l}</button>`).join("")}</div>
    ${view === "time" || view === "range" ? `<div class="agg">${view === "time" ? `<button data-split class="ov ${split ? "on" : ""}">Weekday vs weekend</button><button data-showtags class="ov ${showTags ? "on" : ""}">Tags</button><span class="grow"></span>` : ""}${[["30", "30D"], ["90", "90D"], ["365", "1Y"]].map(([k, l]) => `<button data-agg="${k}" class="${agg === k ? "on" : ""}">${l}</button>`).join("")}</div>` : ""}
    <div class="card viz">${renderView(key, B)}</div>
    ${explain(key)}</div>`;
}
function explain(key) {
  const T = D.T, txt = {
    hrv: `RMSSD (beat-to-beat variation) computed on your phone from the band's own ~80-second pulse recordings, every 10 minutes while you sleep. Movement artifacts are removed beat by beat (Lipponen & Tarvainen 2019); recordings with more than 20% corrected beats are dropped. The night's value is the median of the clean ones.`,
    rhr: `The lowest 30-minute average of the band's 5-second heart rate while asleep. Timing of the low point matters too: a late low often follows alcohol, a late meal or illness.`,
    breath: `Breaths per minute from the rhythmic speed-up and slow-down of your pulse with each breath (respiratory sinus arrhythmia), measured in each clean pulse recording. A rise of 1.5/min or more over your usual can come with illness.`,
    spo2: `The band's own blood-oxygen spot readings, every 10 minutes asleep. Healthy adults usually stay at 95% or above; brief dips to the low 90s happen.`,
    temp: `Skin temperature every 10 minutes, compared with your usual for the same part of the night. Two or more warm nights can come before a cold; alcohol and a warm room also raise it.`,
    sleep: `Sleep stages come from the band's own classifier (movement + heart rate). Stage minutes from wrist bands are rough; total sleep, timing and regularity are the reliable parts.`,
    recovery: `Recovery = 0.30 × HRV + 0.30 × resting HR + 0.15 × temperature + 0.25 × sleep. Each part is 70 at your usual and moves 15 points per typical swing (your own median and spread, last 28 nights).`,
    timing: `The midpoint is halfway between falling asleep and waking. Regular timing matters on its own: in about 60,000 UK Biobank adults, sleep regularity predicted mortality better than sleep length did (Windred 2024).`,
    steps: `Per-minute step counts from the band. Walking briskly is about 100+ steps a minute (Tudor-Locke 2018); those minutes count toward the 150 a week of moderate activity. "Usual by now" scales your usual day by how much of it is normally done by ${ampm(T.now)}.`,
    hrday: `The band's 5-second heart rate while you're awake, leaving out workouts and walking. A daytime average that creeps up over several days can come with poor sleep, illness or dehydration; compare it with your own usual.`,
    mvpa: `A minute counts when you walk at 100+ steps a minute (Tudor-Locke 2018), or when your heart rate is at or above 40% of your heart-rate reserve during a detected session (${Math.round(T.hrr40)}+ bpm for you; max heart rate = 208 − 0.7 × age, Tanaka 2001). Strength work shows up by heart rate, not steps.`,
    moveH: `An hour counts as moving when it has 250+ steps, about two or three minutes of walking. Hours from 7 AM to 10 PM count.`,
  }[key];
  const raw = ["hrv", "breath", "spo2", "temp"].includes(key), nt = D.nt;
  const col = { hrv: (b) => `${b.rmssd.toFixed(1)} ms`, breath: (b) => `${b.br.toFixed(1)}/min`, spo2: (b) => `${b.spo2}%`, temp: (b) => `${(b.temp * 1.8 + 32).toFixed(1)} °F` }[key];
  return `<div class="sec"><h2>How it's measured</h2></div><div class="card explain"><p>${txt}</p><p>${key === "timing" ? "Your usual: the median midpoint of your previous 14 nights. Spread is the standard deviation of those midpoints; under about 30 minutes is regular." : M[key].day ? "Bands: a guideline or population range where one exists, and your own usual for this time of day (median ± a typical swing, last 28 days)." : "Bands: a population norm for your age and sex where one exists, your own usual (median ± a typical swing, last 28 nights), and, for HRV and resting HR, what that night's sleep predicts from your own history (80% range)."}</p></div>
    ${raw ? `<div class="sec"><h2>Raw evidence</h2><span class="lbl">${nt.bursts.length} recordings</span></div>
    <div class="card bursts">${nt.bursts.slice(0, 8).map((b) => `<div class="b"><span>${clock(nt.onset + b.m)}</span><span>${b.beats} beats</span><span class="${b.ok ? "" : "rej"}">${col(b)}</span><span><span class="pill">${b.ok ? "kept" : "movement"}</span></span></div>`).join("")}<p class="note">…and ${nt.bursts.length - 8} more</p></div>` : ""}`;
}
function renderView(key, B) {
  if (view === "now") return viewNow(key, B);
  if (view === "time") return viewTime(key, B);
  if (view === "range") return viewRange(key, B);
  return viewAffects(key, B);
}
function stageLanes(x, y0, laneH, gap, op = 0.9) {
  let out = "", start = 0; const lv = { 4: 0, 3: 1, 2: 2, 1: 3 }, st = D.nt.stages;
  for (let i = 1; i <= st.length; i++) if (i === st.length || st[i] !== st[start]) {
    out += `<rect x="${x(start).toFixed(1)}" y="${(y0 + lv[st[start]] * (laneH + gap)).toFixed(1)}" width="${Math.max(0.8, x(i) - x(start)).toFixed(1)}" height="${laneH}" rx="${Math.min(3, laneH / 2)}" fill="${stageColor(st[start])}" opacity="${op}"/>`; start = i;
  }
  return out;
}
function viewNowDay(key, B) {
  const T = D.T, W0 = 340, sid = `s${uid++}`, col = css(M[key].color), x = sc(6 * 60, 22 * 60, 30, W0 - 6);
  const fut = (H) => `<rect x="${x(T.now).toFixed(1)}" y="0" width="${(W0 - 6 - x(T.now)).toFixed(1)}" height="${H - 18}" fill="${css("--ink3")}" opacity=".06"/>`;
  const taxis = (H) => [6, 9, 12, 15, 18, 21].map((hh) => `<text x="${x(hh * 60)}" y="${H - 4}" text-anchor="middle" class="axis">${hr12(hh)}</text>`).join("");
  if (key === "steps") {
    const H = 170, bw = (W0 - 36) / 24, max = Math.max(...T.hourly, ...D.typical, 1), y = sc(0, max, H - 22, 10), xs = (i) => 30 + i * bw;
    let cum = 0, ct = 0; const cumPts = [], typPts = [];
    const tot = D.typical.reduce((a, b) => a + b, 0), yc = sc(0, Math.max(tot, T.steps * 1.1), H - 22, 10);
    D.typical.forEach((v, i) => { ct += v; typPts.push([xs(i + 1), yc(ct)]); });
    T.hourly.forEach((v, i) => { if (i <= T.nowH) { cum += v; cumPts.push([xs(i + 1), yc(cum)]); } });
    const body = D.typical.map((v, i) => (v ? `<rect x="${(xs(i) + 1.5).toFixed(1)}" y="${y(v).toFixed(1)}" width="${(bw - 3).toFixed(1)}" height="${(y(0) - y(v)).toFixed(1)}" rx="2" fill="${css("--ink3")}" opacity=".18"/>` : "")).join("")
      + T.hourly.map((v, i) => (v ? `<rect x="${(xs(i) + 1.5).toFixed(1)}" y="${y(v).toFixed(1)}" width="${(bw - 3).toFixed(1)}" height="${(y(0) - y(v)).toFixed(1)}" rx="2" fill="${col}"/>` : "")).join("")
      + `<path d="${poly(typPts)}" fill="none" stroke="${css("--ink3")}" stroke-dasharray="3 3" stroke-width="1.3"/><path d="${poly(cumPts)}" fill="none" stroke="${css("--act")}" stroke-width="2.2"/>`
      + [0, 6, 12, 18].map((hh) => `<text x="${xs(hh)}" y="${H - 6}" class="axis">${hr12(hh)}</text>`).join("");
    const pts = T.hourly.map((v, i) => [xs(i + 0.5), y(Math.max(v, D.typical[i])), `${hr12(i)} · <b>${i <= T.nowH ? v.toLocaleString() : "—"}</b> steps · typical ${D.typical[i].toLocaleString()}`]);
    return scrubbable(sid, W0, H, body, pts, `Bars: steps each hour today. Grey: your typical day. Green line: today's running total vs typical (dashed).`);
  }
  if (key === "hrday") {
    const H = 200, y = sc(50, 140, H - 22, 8), pts = [], sp = [];
    for (let k = 0; k < T.n; k += 3) { const v = mean(T.hr.slice(k, k + 3)), t = T.wake + k + 1.5; pts.push([x(t), y(v)]); const ss = T.sessions.find((s) => t >= s.a && t < s.b); sp.push([x(t), y(v), `${ampm(t)} · <b>${Math.round(v)} bpm</b>${ss ? ` · ${ss.kind === "walk" ? "brisk walk" : workoutTags.get(ss.a)?.kind?.toLowerCase() ?? "workout"}` : ""}`]); }
    const zone = (a, b, c, l) => `<rect x="30" width="${W0 - 36}" y="${y(b)}" height="${y(a) - y(b)}" fill="${css(c)}" opacity=".07"/><text x="${W0 - 8}" y="${y(b) + 11}" text-anchor="end" class="axis">${l}</text>`;
    const body = zone(T.hrr40, T.hrr60, "--watch", "moderate") + zone(T.hrr60, 140, "--heart", "vigorous")
      + T.sessions.map((s) => `<rect x="${x(s.a).toFixed(1)}" y="8" width="${(x(s.b) - x(s.a)).toFixed(1)}" height="${H - 30}" fill="${css("--heart")}" opacity=".08" rx="3"/>`).join("") + fut(H)
      + [60, 80, 100, 120].map((v) => `<line x1="30" x2="${W0 - 6}" y1="${y(v)}" y2="${y(v)}" stroke="${css("--grid")}"/><text x="24" y="${y(v) + 4}" text-anchor="end" class="axis">${v}</text>`).join("")
      + `<path class="draw" style="--len:1400" d="${smooth(pts, 0.1)}" fill="none" stroke="${col}" stroke-width="1.6"/>` + taxis(H);
    return scrubbable(sid, W0, H, body, sp, `Drag across the day. Shaded: detected workouts.`) + `<div class="stat3"><div><b>${Math.round(T.hrNow)}</b><span>now</span></div><div><b>${T.dayHr.toFixed(0)}</b><span>daytime average</span></div><div><b>${Math.round(T.hrHi)}</b><span>highest</span></div></div>`;
  }
  if (key === "mvpa") {
    const H = 70, body = fut(H) + T.brisk.map((b, k) => (b ? `<rect x="${x(T.wake + k).toFixed(1)}" y="10" width="1.3" height="36" fill="${col}"/>` : "")).join("") + T.stepsMin.map((v, k) => (!T.brisk[k] && v > 0 ? `<rect x="${x(T.wake + k).toFixed(1)}" y="${46 - Math.min(36, v / 3)}" width="1" height="${Math.min(36, v / 3)}" fill="${css("--ink3")}" opacity=".35"/>` : "")).join("") + taxis(H);
    const sp = []; for (let k = 0; k < T.n; k += 2) sp.push([x(T.wake + k), 28, `${ampm(T.wake + k)} · ${T.stepsMin[k]} steps/min${T.brisk[k] ? " · <b>active</b>" : ""}`]);
    const days = [...D.hist.slice(-7, -1).map((h) => [h.d, h.mvpa]), [D.latest.d, T.mvpa]], wmax = Math.max(50, ...days.map((d) => d[1])), bw = (W0 - 36) / 7, yb = sc(0, wmax, 118, 10);
    const week = S(W0, 136, `<line x1="30" x2="${W0 - 6}" y1="${yb(150 / 7)}" y2="${yb(150 / 7)}" stroke="${css("--ink3")}" stroke-dasharray="3 3"/>` + days.map(([d, v], i) => `<rect x="${(30 + i * bw + 5).toFixed(1)}" y="${yb(v).toFixed(1)}" width="${(bw - 10).toFixed(1)}" height="${Math.max(2, yb(0) - yb(v)).toFixed(1)}" rx="4" fill="${col}" opacity="${i === 6 ? 1 : 0.5}"/><text x="${(30 + i * bw + bw / 2).toFixed(1)}" y="${yb(v) - 4}" text-anchor="middle" class="axis">${v}</text><text x="${(30 + i * bw + bw / 2).toFixed(1)}" y="132" text-anchor="middle" class="axis">${i === 6 ? "today" : DAYS[d.getDay()]}</text>`).join(""));
    return scrubbable(sid, W0, H, body, sp, `Green: minutes that count as active. Grey: lighter steps.`) + `<div class="sub-h">Last 7 days · dashed = 150 a week pace</div>${week}<div class="stat3"><div><b>${T.mvpa}</b><span>today</span></div><div><b>${D.week}</b><span>of 150 this week</span></div><div><b>${days.filter((d) => d[1] >= 10).length} of 7</b><span>days with 10+ min</span></div></div>`;
  }
  // moving hours
  const H = 112, cw = (W0 - 36) / 15, body = [], xh = sc(7 * 60, 22 * 60, 30, W0 - 6);
  for (let hh = 7; hh < 22; hh++) { const i = hh - 7, done = hh < T.nowH, on = done && T.hourly[hh] >= 250, curH = hh === T.nowH; body.push(`<rect x="${(30 + i * cw + 2).toFixed(1)}" y="12" width="${(cw - 4).toFixed(1)}" height="40" rx="7" fill="${on ? col : "none"}" stroke="${on ? "none" : css("--ink3")}" stroke-opacity="${done || curH ? 0.6 : 0.2}" ${curH ? `stroke-dasharray="3 3"` : ""}/>${i % 3 === 0 ? `<text x="${(30 + i * cw + cw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle" class="axis">${hr12(hh)}</text>` : ""}`); }
  let run = 0, runs = "";
  for (let k = 0; k <= T.n; k++) { if (k < T.n && T.stepsMin[k] < 10) run++; else { if (run >= 30) { const a0 = Math.max(7 * 60, T.wake + k - run), b0 = T.wake + k; if (b0 > a0) runs += `<rect x="${xh(a0).toFixed(1)}" y="72" width="${Math.max(3, xh(b0) - xh(a0)).toFixed(1)}" height="10" rx="5" fill="${run === T.longestStill ? css("--watch") : css("--ink3")}" opacity="${run === T.longestStill ? 0.9 : 0.4}"/>`; } run = 0; } }
  const sp = []; for (let hh = 7; hh < 22; hh++) sp.push([30 + (hh - 7 + 0.5) * cw, 32, `${hr12(hh)}–${hr12(hh + 1)} · ${hh < T.nowH ? `<b>${T.hourly[hh].toLocaleString()}</b> steps${T.hourly[hh] >= 250 ? " · moving" : ""}` : hh === T.nowH ? "this hour so far" : "later today"}`]);
  return scrubbable(sid, W0, H, body.join("") + `<text x="30" y="67" class="axis">still 30+ min</text>${runs}`, sp, `Filled: hours with 250+ steps. Bars below: stretches of 30+ minutes without walking; amber is the longest.`)
    + `<div class="stat3"><div><b>${T.moveH} of ${T.nowH - 7}</b><span>moving hours</span></div><div><b>${short(T.longestStill)}</b><span>longest still stretch</span></div><div><b>${short(T.stillNow)}</b><span>still right now</span></div></div>`;
}
function viewNow(key, B) {
  if (M[key].day) return viewNowDay(key, B);
  const { m, you } = B, W0 = 340, col = css(m.color), id = `v${uid++}`, sid = `s${uid++}`, nt = D.nt;
  if (key === "recovery") {
    const p = D.last.parts, prior = D.H.slice(-29, -1);
    const rows = [["HRV", "hrv", p.hrv, 0.3, `${D.last.hrv.toFixed(0)} ms vs ${median(prior.map((h) => h.hrv)).toFixed(0)}`], ["Resting HR", "rhr", p.rhr, 0.3, `${D.last.rhr.toFixed(1)} vs ${median(prior.map((h) => h.rhr)).toFixed(1)} bpm`], ["Temperature", "temp", p.temp, 0.15, `${sign(D.last.tdev * 1.8)} °F vs usual`], ["Sleep", "sleep", p.sleep, 0.25, `${hm(D.last.sleepH)} asleep`]];
    const x = sc(0, 100, 0, 150);
    return `${rows.map(([n, k, v, w, det]) => `<div class="part" data-open2="${k}"><div><b>${n}</b><span>${det}</span></div>${S(150, 16, `<rect x="0" y="4" width="150" height="8" rx="4" fill="${css("--track")}"/><rect x="0" y="4" width="${x(v).toFixed(1)}" height="8" rx="4" fill="${css(v >= 60 ? "--good" : v >= 45 ? "--watch" : "--bad")}"/><line x1="${x(70)}" x2="${x(70)}" y1="0" y2="16" stroke="${css("--ink")}" stroke-opacity=".5"/>`)}<em>${Math.round(v)}<small>× ${w.toFixed(2)}</small></em></div>`).join("")}
      <div class="sum">= ${rows.map(([, , v, w]) => (v * w).toFixed(1)).join(" + ")} = <b>${D.last.rec}</b></div>
      <p class="note">Each bar is one part's score; the tick at 70 is your usual. Tap a part for its own detail.</p>`;
  }
  if (key === "timing") {
    const hs = D.H.slice(-14), H = 210, bw = (W0 - 40) / 14, y = sc(21 * 60, 33 * 60, 8, H - 30), um = median(hs.slice(0, -1).map((h) => h.mid)) + 1440;
    const body = [22, 24, 26, 28, 30, 32].map((hh) => `<line x1="36" x2="${W0 - 4}" y1="${y(hh * 60)}" y2="${y(hh * 60)}" stroke="${css("--grid")}"/><text x="30" y="${y(hh * 60) + 4}" text-anchor="end" class="axis">${hr12(hh)}</text>`).join("")
      + `<line x1="36" x2="${W0 - 4}" y1="${y(um)}" y2="${y(um)}" stroke="${css("--ink2")}" stroke-dasharray="4 3"/>`
      + hs.map((h, i) => `<rect x="${(36 + i * bw + 3).toFixed(1)}" y="${y(h.onset).toFixed(1)}" width="${(bw - 6).toFixed(1)}" height="${(y(h.wake) - y(h.onset)).toFixed(1)}" rx="5" fill="${col}" opacity="${i === 13 ? 1 : 0.35}"/><circle cx="${(36 + i * bw + bw / 2).toFixed(1)}" cy="${y(h.mid + 1440).toFixed(1)}" r="2.4" fill="${css("--ink")}" opacity=".8"/>${i % 2 === 1 ? `<text x="${(36 + i * bw + bw / 2).toFixed(1)}" y="${H - 12}" text-anchor="middle" class="axis">${DAYS[eveOf(h).getDay()][0]}</text>` : ""}`).join("");
    const sp = hs.map((h, i) => [36 + i * bw + bw / 2, y(h.mid + 1440), `${nightName(h)} · ${ampm(h.onset)} – ${ampm(h.wake)} · midpoint <b>${ampm(h.mid)}</b>`]);
    const mids = hs.map((h) => h.mid);
    return scrubbable(sid, W0, H, body, sp, `Each bar is a night, from falling asleep to waking. Dots: midpoints. Dashed: your usual midpoint.`)
      + `<div class="stat3"><div><b>${clock(D.nt.onset)}</b><span>asleep</span></div><div><b>${clock(D.nt.wake)}</b><span>awake</span></div><div><b>±${Math.round(sd(mids))} min</b><span>midpoint spread, 14 nights</span></div></div>`;
  }
  if (key === "sleep") {
    const H = 150, x = sc(0, nt.N, 44, W0 - 6), laneH = 22, gap = 8;
    const body = stageLanes(x, 8, laneH, gap, 0.95) + ["Awake", "REM", "Light", "Deep"].map((n, i) => `<text x="0" y="${8 + i * (laneH + gap) + 15}" class="axis">${n}</text>`).join("")
      + [0, 2, 4, 6].map((hh) => { const t = nt.onset + hh * 60; return t < nt.wake ? `<text x="${x(hh * 60)}" y="${H - 4}" text-anchor="middle" class="axis">${clock(Math.round(t / 60) * 60).replace(":00", "")}</text>` : ""; }).join("");
    const pts = []; for (let i = 0; i < nt.N; i += 3) pts.push([x(i), 8 + ({ 4: 0, 3: 1, 2: 2, 1: 3 }[nt.stages[i]]) * (laneH + gap) + laneH / 2, `${ampm(nt.onset + i)} · <b>${stageName[nt.stages[i]]}</b>`]);
    const cnt = (s) => nt.stages.filter((v) => v === s).length, tot = nt.asleepMin;
    const wake = nt.stages.reduce((a, v, i) => a + (v === 4 && i > 0 && nt.stages[i - 1] !== 4 ? 1 : 0), 0);
    return scrubbable(sid, W0, H, body, pts, `Drag across the night to read each stage.`) + `<div class="stat4">${[[1, "Deep"], [3, "REM"], [2, "Light"], [4, "Awake"]].map(([s, n]) => `<div><i style="background:${stageColor(s)}"></i><b>${short(cnt(s))}</b><span>${n}${s !== 4 ? ` · ${Math.round((100 * cnt(s)) / tot)}%` : ` · ${wake}×`}</span></div>`).join("")}</div>
      <div class="stat3"><div><b>${((100 * tot) / nt.N).toFixed(0)}%</b><span>efficiency</span></div><div><b>${cnt(4)} min</b><span>awake after onset</span></div><div><b>${clock(nt.onset)}</b><span>fell asleep</span></div></div>`;
  }
  // PPI/HR channels over the night
  const H = 180, x = sc(0, nt.N, 30, W0 - 6), ys = key === "hrv" ? [Math.min(6, D.hrv - 18), Math.max(46, D.hrv + 18)] : key === "rhr" ? [D.last.rhr - 6, D.last.rhr + 14] : key === "breath" ? [D.last.br - 3.5, D.last.br + 3.5] : key === "spo2" ? [90, 100] : [-1.2, 1.2];
  const y = sc(ys[0], ys[1], H - 32, 10);
  const lv = { 4: 0, 3: 1, 2: 2, 1: 3 };
  let bg = "", start = 0;
  for (let i = 1; i <= nt.stages.length; i++) if (i === nt.stages.length || nt.stages[i] !== nt.stages[start]) { bg += `<rect x="${x(start).toFixed(1)}" y="${H - 26 + lv[nt.stages[start]] * 5}" width="${Math.max(0.8, x(i) - x(start)).toFixed(1)}" height="4" rx="1.5" fill="${stageColor(nt.stages[start])}" opacity=".9"/>`; start = i; }
  const pts = key === "hrv" ? nt.bursts.map((b) => [b.m, b.rmssd, b.ok]) : key === "rhr" ? nt.hr.map((v, i) => [i, v, true]).filter((_, i) => i % 4 === 0) : key === "breath" ? nt.good.map((b) => [b.m, b.br, true]) : key === "spo2" ? nt.bursts.map((b) => [b.m, b.spo2, true]) : nt.bursts.map((b) => [b.m, (b.temp - 35) * 1.8, true]);
  const grid = [0, 1, 2, 3].map((k) => { const v = ys[0] + (k / 3) * (ys[1] - ys[0]); return `<line x1="30" x2="${W0 - 6}" y1="${y(v)}" y2="${y(v)}" stroke="${css("--grid")}"/><text x="24" y="${y(v) + 4}" text-anchor="end" class="axis">${m.f(v)}</text>`; }).join("");
  const okPts = pts.filter((p) => p[2]).map((p) => [x(p[0]), y(p[1])]);
  const band = key === "spo2" ? `<rect x="30" width="${W0 - 36}" y="${y(100)}" height="${y(95) - y(100)}" fill="${col}" opacity=".08"/>` : key === "temp" ? "" : `<rect x="30" width="${W0 - 36}" y="${y(Math.min(ys[1], you[1]))}" height="${Math.max(0, y(Math.max(ys[0], you[0])) - y(Math.min(ys[1], you[1])))}" fill="${col}" opacity=".1"/>`;
  const body = `<defs>${glowDef(id, 2.4)}</defs>${grid}${band}${bg}
      ${key === "spo2" ? "" : `<path class="draw" style="--len:900" d="${smooth(okPts)}" fill="none" stroke="${col}" stroke-width="${key === "rhr" ? 2 : 1.4}" stroke-opacity="${key === "rhr" ? 1 : 0.55}" ${key === "rhr" ? glow(id) : ""}/>`}
      ${key === "rhr" ? "" : pts.map((p) => `<circle cx="${x(p[0]).toFixed(1)}" cy="${y(p[1]).toFixed(1)}" r="${p[2] ? 3.3 : 2.6}" fill="${p[2] ? col : "none"}" stroke="${p[2] ? css("--bg") : css("--ink3")}" stroke-width="${p[2] ? 1.5 : 1}" class="fadein"/>`).join("")}`;
  const sp = pts.map((p) => [x(p[0]), y(p[1]), `${ampm(nt.onset + p[0])} · <b>${m.f(p[1])} ${m.unit}</b> · ${stageName[nt.stages[Math.min(nt.N - 1, p[0])]]}${p[2] ? "" : " · dropped (movement)"}`]);
  return scrubbable(sid, W0, H, body, sp, `Drag across the chart to read any moment.`)
    + `<p class="note">Every ${key === "rhr" ? "few minutes" : "pulse recording"} across the night, over your sleep stages${key === "hrv" ? ". Hollow dots were dropped for movement" : ""}${key === "temp" ? " (°F vs your usual)" : "; the shaded band is your usual"}.</p>`;
}
function tagColor(k) { return css({ alcohol: "--bad", caffeine: "--watch", stress: "--breath", workout: "--act" }[k]); }
const tagsKnown = (h) => W.TAGS.filter((t) => (t.auto ? h.inLog : h.asked) && h.t[t.key]);
function viewTime(key, B) {
  const { m, you } = B, W0 = 340, col = css(m.color), id = `v${uid++}`, sid = `s${uid++}`, pop = popOf(m), fd = m.fd ?? m.fa ?? m.f;
  const n = Math.min(+agg, B.ser.length), hs = B.ser.slice(-n), ser = hs.map(m.get), H = 206, tagRow = showTags ? 18 : 0;
  const yl = m.day ? [...ser] : [...ser, ...(pop ?? [ser[0]])], you2 = m.day ? [you[0] / m.frac(), you[1] / m.frac()] : you;
  const x = sc(0, n - 1, 30, W0 - 6), lo = Math.min(...yl), hi = Math.max(...yl), y = sc(lo, hi, H - 26 - tagRow, 10);
  const roll = ser.map((_, i) => mean(ser.slice(Math.max(0, i - 6), i + 1)));
  const wk = hs.map((h) => (m.day ? h.dow === 0 || h.dow === 6 : h.wkend));
  const clip = (v) => clamp(v, lo, hi);
  let body = `<defs>${glowDef(id, 2.6)}</defs>${pop && !m.day ? `<rect x="30" width="${W0 - 36}" y="${y(clip(pop[1]))}" height="${y(clip(pop[0])) - y(clip(pop[1]))}" fill="${css("--ink3")}" opacity=".07"/>` : ""}
      <rect x="30" width="${W0 - 36}" y="${y(clip(you2[1]))}" height="${Math.max(0, y(clip(you2[0])) - y(clip(you2[1])))}" fill="${col}" opacity=".13"/>
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
  if (!m.day) body += `<circle cx="${x(n - 1)}" cy="${y(ser[n - 1])}" r="4.5" fill="${col}" stroke="${css("--bg")}" stroke-width="2"/>`;
  if (showTags) {
    const ty = H - 22 - tagRow + 6;
    body += `<text x="24" y="${ty + 5}" text-anchor="end" class="axis">tags</text>` + hs.map((h, i) => tagsKnown(h).map((t, j) => `<rect x="${(x(i) - 1.2).toFixed(1)}" y="${ty - 2 + j * 3}" width="2.4" height="${n > 100 ? 5 : 7}" rx="1" fill="${tagColor(t.key)}"/>`).join("")).join("");
    const first = hs.findIndex((h) => h.inLog);
    if (first > 0) body += `<line x1="${x(first)}" x2="${x(first)}" y1="10" y2="${H - 22}" stroke="${css("--ink3")}" stroke-opacity=".35"/><text x="${x(first) + 4}" y="20" class="axis">Pulse started</text>`;
  }
  if (n === 365 && (key === "rhr" || key === "hrv")) {
    for (const dr of W.DRAWS) { const i = hs.findIndex((h) => h.d.toISOString().slice(0, 10) >= dr.date); if (i >= 0) body += `<line x1="${x(i)}" x2="${x(i)}" y1="10" y2="${H - 22}" stroke="${css("--ink")}" stroke-opacity=".35" stroke-dasharray="2 3"/><text x="${x(i)}" y="8" text-anchor="middle" class="axis">labs</text>`; }
  }
  const step = n > 100 ? 91 : n > 60 ? 30 : 7;
  for (let i = n - 1; i >= 0; i -= step) body += `<text x="${x(i)}" y="${H - 4}" text-anchor="middle" class="axis">${MON[hs[i].d.getMonth()]} ${hs[i].d.getDate()}</text>`;
  const sp = hs.map((h, i) => [x(i), y(ser[i]), `${m.day ? dname(h.d) : nightName(h) + " " + MON[h.d.getMonth()] + " " + h.d.getDate()} · <b>${m.f(ser[i])} ${m.unit}</b>${tagsKnown(h).map((t) => ` · ${t.label}`).join("")}${h.sick ? " · Sick" : ""}`]);
  const a = ser.filter((_, i) => !wk[i]), b = ser.filter((_, i) => wk[i]), dW = mean(b) - mean(a), unitWord = m.day ? "days" : "nights";
  const spread = m.noCv ? `<div><b>±${fd(sd(ser))}</b><span>${m.day ? "day" : "night"}-to-${m.day ? "day" : "night"} spread</span></div>` : `<div><b>${((100 * sd(ser)) / Math.abs(mean(ser))).toFixed(0)}%</b><span>${m.day ? "day" : "night"}-to-${m.day ? "day" : "night"} CV</span></div>`;
  return scrubbable(sid, W0, H, body, sp, split ? `<span class="key" style="--k:${col}">${m.day ? "weekdays" : "weeknights"} ${m.f(mean(a))}</span><span class="key" style="--k:${css("--watch")}">${m.day ? "Sat–Sun" : "Fri–Sat nights"} ${m.f(mean(b))}</span>` : `Dots are ${unitWord}; the line is the 7-${m.day ? "day" : "night"} average.`)
    + `<div class="stat3"><div><b>${(m.fa ?? m.f)(mean(ser))}</b><span>average</span></div>${spread}<div><b>${m.noCv ? `${sign(dW, 0)} min` : sign(dW, m.day || key === "steps" ? 0 : 1)}</b><span>weekend vs weekday</span></div></div>
      <p class="note">${m.day ? "Complete days only; today is still in progress. " : ""}Colored band: your usual.${pop && !m.day ? ` Grey: ${m.popLbl.toLowerCase()}.` : ""}${showTags ? " Tag ticks: " + W.TAGS.map((t) => `<span class="key" style="--k:${tagColor(t.key)}">${t.label.toLowerCase()}</span>`).join(" ") : ""}${n === 365 && (key === "rhr" || key === "hrv") ? " Dashed lines: lab draws." : ""}</p>`;
}
function viewRange(key, B) {
  const { m } = B, W0 = 340, col = css(m.color), pop = popOf(m), f = m.fa ?? m.f, fd = m.fd ?? f;
  const n = Math.min(+agg, B.ser.length), ser = B.ser.slice(-n).map(m.get), H = 190, bins = 16, you = m.day ? [B.you[0] / m.frac(), B.you[1] / m.frac()] : B.you;
  const lo = Math.min(...ser), hi = Math.max(...ser), bw = (hi - lo) / bins || 1, counts = new Array(bins).fill(0);
  ser.forEach((v) => counts[Math.min(bins - 1, Math.floor((v - lo) / bw))]++);
  const x = sc(lo, hi, 20, W0 - 10), cmax = Math.max(...counts), y = sc(0, cmax, H - 50, 18), sorted = [...ser].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(n * 0.25)], q3 = sorted[Math.floor(n * 0.75)], md = median(ser), cur = B.rcur ?? B.cur, p = Math.round((100 * sorted.filter((v) => v <= cur).length) / sorted.length);
  const clampX = (v) => clamp(x(v), 20, W0 - 10);
  const rowY = H - 30, who = m.day ? "yesterday" : isLatest() ? "last night" : "that night";
  return S(W0, H, counts.map((c, i) => `<rect x="${(x(lo + i * bw) + 1).toFixed(1)}" y="${y(c).toFixed(1)}" width="${Math.max(1, x(lo + bw) - x(lo) - 2).toFixed(1)}" height="${(y(0) - y(c)).toFixed(1)}" rx="3" fill="${col}" opacity="${lo + (i + 0.5) * bw >= q1 && lo + (i + 0.5) * bw <= q3 ? 0.8 : 0.3}"/>`).join("")
    + `<line x1="${x(md)}" x2="${x(md)}" y1="14" y2="${H - 48}" stroke="${css("--ink2")}" stroke-width="1.2"/><text x="${x(md)}" y="11" text-anchor="middle" class="axis">median ${f(md)}</text>`
    + (pop ? `<rect x="${clampX(pop[0])}" y="${rowY - 4}" width="${Math.max(2, clampX(pop[1]) - clampX(pop[0]))}" height="8" rx="4" fill="${css("--ink3")}" opacity=".3"/>` : "")
    + `<rect x="${clampX(you[0])}" y="${rowY + 8}" width="${Math.max(2, clampX(you[1]) - clampX(you[0]))}" height="8" rx="4" fill="${col}" opacity=".45"/>`
    + `<circle cx="${clampX(cur)}" cy="${rowY + 6}" r="6" fill="${col}" stroke="${css("--bg")}" stroke-width="2"/><text x="${clampX(cur)}" y="${H - 2}" text-anchor="middle" class="axis">${who}</text>`)
    + `<div class="stat3"><div><b>${f(q1)}–${f(q3)}</b><span>your middle half</span></div><div><b>${fd(sd(ser))}</b><span>typical swing (SD)</span></div><div><b>${ord(p)}</b><span>percentile</span></div></div>
      <p class="note">Your last ${n} ${m.day ? "complete days" : "nights"}. ${cap1(who)} sits at the <b>${ord(p)} percentile</b> of your own history.${pop ? ` The grey bar under the histogram is the ${m.popLbl.toLowerCase()} range; the colored one is your usual.` : ""}</p>`;
}
function viewAffects(key, B) {
  const { m } = B, W0 = 340, H = 180, hist = m.day ? D.hist : D.H;
  const list = W.drivers(hist, m.get, m.drivers);
  const inLog = hist.filter((h) => h.inLog), asked = inLog.filter((h) => h.asked), trig = asked.filter((h) => h.trig?.length).length;
  const shown = list.filter((d) => d.state !== "needs");
  const ext = Math.max(0.5, ...shown.map((d) => Math.abs(d.effect) + d.ci)), xs = sc(-ext, ext, 2, 118);
  const good = (e) => (m.better === 0 ? null : m.better * e > 0);
  const row = (d) => {
    if (d.state === "needs") return `<div class="drv needs"><span>${d.label}<span class="n">${d.n} of ${W.MIN_TAGGED} tagged nights</span></span><span class="meter">${Array.from({ length: W.MIN_TAGGED }, (_, i) => `<i class="${i < d.n ? "on" : ""}"></i>`).join("")}</span><span class="e muted">${d.need} more</span></div>`;
    const g = good(d.effect), fill = d.state === "clear" ? css(g == null ? "--ink2" : g ? "--good" : "--bad") : css("--ink3");
    const unit = key === "sleep" ? "h" : key === "timing" ? "min" : m.unit;
    return `<div class="drv ${d.state}"><span>${d.label}<span class="n">${d.note}${d.state === "unclear" ? " · no clear effect yet" : ""}</span></span>${S(120, 14, `<line x1="60" x2="60" y1="0" y2="14" stroke="${css("--grid")}"/><line x1="${xs(d.effect - d.ci)}" x2="${xs(d.effect + d.ci)}" y1="7" y2="7" stroke="${css("--ink3")}" stroke-width="1.5"/>${d.state === "clear" ? `<rect x="${Math.min(60, xs(d.effect))}" y="2.5" width="${Math.abs(xs(d.effect) - 60)}" height="9" rx="3" fill="${fill}" opacity=".9"/>` : `<circle cx="${xs(d.effect)}" cy="7" r="3.5" fill="none" stroke="${fill}" stroke-width="1.5"/>`}`)}<span class="e ${d.state === "clear" ? "" : "muted"}">${d.state === "clear" ? `${sign(d.effect, key === "sleep" ? 2 : key === "steps" || key === "timing" ? 0 : 1)}<small>${unit}</small>` : "±" + d.ci.toFixed(key === "steps" || key === "timing" ? 0 : 1)}</span></div>`;
  };
  let scatter = "";
  if (m.drivers.includes("sleep")) {
    const sc2 = hist.slice(-121, -1).filter((h) => !h.sick), vy = sc2.map(m.get), sx = sc(5, 9, 30, W0 - 6), sy = sc(Math.min(...vy), Math.max(...vy), H - 22, 10);
    const xm = mean(sc2.map((h) => h.sleepH)), ym = mean(vy), b = sc2.reduce((a, h, i) => a + (h.sleepH - xm) * (vy[i] - ym), 0) / sc2.reduce((a, h) => a + (h.sleepH - xm) ** 2, 0);
    const sid = `s${uid++}`, alc = (h) => h.asked && h.t.alcohol;
    const body = sc2.map((h, i) => `<circle cx="${sx(h.sleepH).toFixed(1)}" cy="${sy(vy[i]).toFixed(1)}" r="2.6" fill="${alc(h) ? css("--bad") : css(m.color)}" opacity="${alc(h) ? 0.9 : 0.45}"/>`).join("")
      + `<path d="M${sx(5)},${sy(ym + b * (5 - xm))}L${sx(9)},${sy(ym + b * (9 - xm))}" stroke="${css("--ink")}" stroke-opacity=".6" stroke-width="1.6"/>` + [5, 6, 7, 8, 9].map((hh) => `<text x="${sx(hh)}" y="${H - 4}" text-anchor="middle" class="axis">${hh}h</text>`).join("")
      + [Math.min(...vy), Math.max(...vy)].map((v) => `<text x="24" y="${sy(v) + 4}" text-anchor="end" class="axis">${(m.fa ?? m.f)(v)}</text>`).join("");
    scatter = `<div class="sub-h">${m.day ? "Last night's sleep vs the next day's" : "Sleep length vs"} ${m.lc}</div>` + scrubbable(sid, W0, H, body, sc2.map((h, i) => [sx(h.sleepH), sy(vy[i]), `${dname(h.d)} · ${hm(h.sleepH)} sleep · <b>${m.f(vy[i])} ${m.unit}</b>${alc(h) ? " · alcohol" : ""}`]), `Each dot is a ${m.day ? "day" : "night"}. <span class="key" style="--k:${css("--bad")}">alcohol-tagged</span>`);
  }
  return `<p class="lead">Pulse asked about <b>${asked.length}</b> of your last ${inLog.length} nights: every unusual one (${trig}) plus a random 1 in 4 of the ordinary ones, which count 4× so answers don't over-represent bad nights. Late workouts are detected from heart rate.</p>
    <div>${list.map(row).join("")}</div>
    <p class="note">Effect on your ${m.lc} ${m.day ? "the day after a" : "per"} tagged night${m.drivers.includes("sleep") && key !== "sleep" ? ", adjusted for sleep length" : ""}, with 95% ranges. An effect is called clear only when its range stays on one side of zero. From your own data: associations, not proof of cause. Sick nights are left out.</p>
    ${scatter ? `<div style="margin-top:14px">${scatter}</div>` : ""}`;
}

// ================= MEASURE =================
const LOG = W.ecgLog();
const AN = new Map();
let recOpen = null;
function analyzeRec(r) {
  if (AN.has(r.id)) return AN.get(r.id);
  const t0 = performance.now(), fs = 256, settle = 5;
  const raw = synthEcg(r);
  const x = raw.x.slice(settle * fs);
  const s = ecgSummary(raw.x, fs, settle), bp = bandpass(x);
  const adv = advancedHRV(s.rr), edr = edrFusion(s.peaks, s.good, bp, fs);
  const mrr = mean(s.rr), mf = morphologyFilter(x, fs), mb = medianBeat(mf, s.peaks, s.good, fs, mrr);
  const iv = [];
  for (let i = 1; i < s.peaks.length; i++) iv.push({ t: s.peaks[i] / fs, v: ((s.peaks[i] - s.peaks[i - 1]) * 1000) / fs });
  iv.forEach((z, i) => { const nb = iv.slice(Math.max(0, i - 2), i + 3).map((q2) => q2.v).sort((a, b) => a - b), med = nb[nb.length >> 1]; z.ok = s.good[i] && s.good[i + 1] && z.v >= 300 && z.v <= 2000 && Math.abs(z.v - med) <= 0.2 * med; });
  const durS = x.length / fs, h = s.hrv;
  const verdict = durS < 25 ? ["Too short to judge", "short", "Keep your finger on the plate for at least 30 seconds."] : s.quality < 0.7 || h.hr < 50 || h.hr > 120 ? ["Inconclusive", "short", "Too many unclear beats or a heart rate outside 50–120."] : h.irregular ? ["Irregular rhythm", "bad", "Show a doctor this recording."] : ["Regular rhythm", "good", ""];
  const E = { r, fs, x: mf, s, adv, edr, mb, iv, ms: performance.now() - t0, dur: durS, verdict, early: iv.filter((z) => !z.ok).length };
  AN.set(r.id, E);
  return E;
}
let pumping = false;
function pump() {
  if (pumping) return; pumping = true;
  const next = () => { const r = LOG.find((z) => !AN.has(z.id)); if (!r) { pumping = false; if (tab === "measure" && !modal) { const y = scrollY; render(false); scrollTo(0, y); } return; } analyzeRec(r); setTimeout(next, 16); };
  setTimeout(next, 250);
}
const cur = () => analyzeRec(LOG.find((r) => r.id === recOpen) ?? LOG[LOG.length - 1]);
const recWhen = (r) => `${r.ago === 0 ? "Today" : r.ago === 1 ? "Yesterday" : dname(r.d)} · ${ampm(r.min)}`;
function ecgTrace() {
  const E = cur(), W0 = 340, H = 150, win = 8, fs = E.fs, a = Math.round(ecgStart * fs), b = Math.min(E.x.length, a + win * fs);
  const lo = -0.45, hi = 0.85, x = sc(0, win, 0, W0), y = sc(lo, hi, H, 0);
  let grid = "";
  for (let t = 0; t <= win + 1e-9; t += 0.2) grid += `<line x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="0" y2="${H}" stroke="${css("--heart")}" stroke-opacity="${Math.abs(t - Math.round(t)) < 1e-6 ? 0.32 : 0.12}"/>`;
  for (let v = -0.4; v <= 0.8 + 1e-9; v += 0.1) grid += `<line x1="0" x2="${W0}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${css("--heart")}" stroke-opacity="${Math.abs(v * 2 - Math.round(v * 2)) < 1e-6 ? 0.32 : 0.12}"/>`;
  const pts = []; for (let i = a; i < b; i += 1) pts.push([x((i - a) / fs), y(clamp(E.x[i], lo, hi))]);
  const marks = E.s.peaks.map((p, k) => [p, k]).filter(([p]) => p >= a && p < b).map(([p, k]) => `<circle cx="${x((p - a) / fs).toFixed(1)}" cy="8" r="3" fill="${E.s.good[k] ? css("--good") : css("--bad")}"/>`).join("");
  const early = E.iv.find((r) => !r.ok && r.t >= ecgStart && r.t < ecgStart + win);
  return `<div class="ecg">${S(W0, H, `${grid}<path d="${poly(pts)}" fill="none" stroke="${css("--ink")}" stroke-width="1.3" stroke-linejoin="round"/>${marks}`)}</div>
    <div class="ecg-cap"><span>${ecgStart.toFixed(0)}–${(ecgStart + win).toFixed(0)} s</span><span>1 s · 0.5 mV per large square</span></div>
    ${early ? `<p class="flag">Red dot: a beat that didn't match your usual shape (an early, wide beat). It and its neighbours are left out of HRV.</p>` : ""}`;
}
function ecgOverview() {
  const E = cur(), W0 = 340, H = 44, n = E.x.length, px = W0, per = Math.max(1, Math.floor(n / px));
  let top = "", bot = "";
  for (let c = 0; c < px; c++) { let mn = Infinity, mx = -Infinity; for (let i = c * per; i < Math.min(n, (c + 1) * per); i++) { mn = Math.min(mn, E.x[i]); mx = Math.max(mx, E.x[i]); } if (!isFinite(mn)) continue; top += `${c ? "L" : "M"}${c},${sc(-0.5, 0.9, H - 4, 4)(mx).toFixed(1)}`; bot = `L${c},${sc(-0.5, 0.9, H - 4, 4)(mn).toFixed(1)}` + bot; }
  const x = sc(0, E.dur, 0, W0), flags = E.iv.filter((r) => !r.ok).map((r) => `<rect x="${(x(r.t) - 1).toFixed(1)}" y="0" width="2" height="${H}" fill="${css("--bad")}" opacity=".6"/>`).join("");
  const hasEarly = E.iv.some((z) => !z.ok);
  return `<div class="ov-strip" data-ecgov>${S(W0, H, `<path d="${top}${bot}Z" fill="${css("--ink3")}" opacity=".55"/>${flags}<rect class="win" x="${x(ecgStart).toFixed(1)}" y="1" width="${(x(8) - x(0)).toFixed(1)}" height="${H - 2}" rx="5" fill="${css("--heart")}" fill-opacity=".12" stroke="${css("--heart")}" stroke-width="1.5"/>`)}</div>
    <div class="ecg-cap"><span>Drag the window · ${Math.round(E.dur + 5)} s</span>${hasEarly ? `<span>Jump to <button class="link" data-jump="early">flagged beat</button></span>` : ""}</div>`;
}
const stats = (arr) => `<div class="stat6">${arr.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join("")}</div>`;
function hrvPanel() {
  const E = cur(), a = E.adv, h = E.s.hrv, W0 = 340;
  const tabs = [["time", "Beat to beat"], ["spectrum", "Rhythms"], ["poincare", "Poincaré"], ["complexity", "Complexity"]];
  let body = "";
  if (hrvTab === "time") {
    const H = 150, ok = E.iv.filter((r) => r.ok), x = sc(0, E.dur, 30, W0 - 4), lo = Math.min(...ok.map((r) => r.v)) - 40, hi = Math.max(...ok.map((r) => r.v)) + 40, y = sc(lo, hi, H - 18, 6);
    const sid = `s${uid++}`;
    const svgb = [lo + 40, (lo + hi) / 2, hi - 40].map((v) => `<line x1="30" x2="${W0 - 4}" y1="${y(v)}" y2="${y(v)}" stroke="${css("--grid")}"/><text x="26" y="${y(v) + 4}" text-anchor="end" class="axis">${v.toFixed(0)}</text>`).join("")
      + `<path d="${poly(ok.map((r) => [x(r.t), y(r.v)]))}" fill="none" stroke="${css("--hrv")}" stroke-width="1.4"/>` + E.iv.filter((r) => !r.ok).map((r) => `<circle cx="${x(r.t).toFixed(1)}" cy="${y(clamp(r.v, lo, hi)).toFixed(1)}" r="3" fill="none" stroke="${css("--bad")}" stroke-width="1.4"/>`).join("")
      + [0, 30, 60, 90].filter((t) => t < E.dur).map((t) => `<text x="${x(t)}" y="${H - 2}" text-anchor="middle" class="axis">${t}s</text>`).join("");
    body = scrubbable(sid, W0, H, svgb, E.iv.map((r) => [x(r.t), y(clamp(r.v, lo, hi)), `${r.t.toFixed(1)} s · <b>${r.v.toFixed(0)} ms</b> (${(60000 / r.v).toFixed(0)} bpm)${r.ok ? "" : " · left out"}`]), `Time between beats (ms). The wave is your breathing speeding and slowing the heart.`)
      + stats([[h.rmssd.toFixed(1), "RMSSD ms"], [h.sdnn.toFixed(1), "SDNN ms"], [h.pnn50.toFixed(1) + "%", "pNN50"], [a.cvnn.toFixed(1) + "%", "CVNN"], [h.stress_index.toFixed(0), "Baevsky SI"], [h.hr.toFixed(0), "mean bpm"]]);
  } else if (hrvTab === "spectrum") {
    const sp = a.spectrum;
    if (!sp) body = `<p class="note">Rhythm analysis needs at least a minute of clean beats (Baek 2015). This recording has ${Math.round(a.duration)} s.</p>`;
    else {
      const H = 160, x = sc(0, 0.5, 30, W0 - 4), pmax = Math.max(...sp.psd.filter((_, i) => sp.freqs[i] > 0.035)), y = sc(0, pmax * 1.1, H - 20, 8);
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
    }
  } else if (hrvTab === "poincare") {
    const rr = E.s.rr, H = 250, lo = Math.min(...rr) - 30, hi = Math.max(...rr) + 30, x = sc(lo, hi, 36, W0 - 60), y = sc(lo, hi, H - 20, 10), p = a.poincare, m = mean(rr), k = (x(hi) - x(lo)) / (hi - lo);
    body = S(W0, H, `<line x1="${x(lo)}" y1="${y(lo)}" x2="${x(hi)}" y2="${y(hi)}" stroke="${css("--grid")}" stroke-width="1.5"/>`
      + rr.slice(0, -1).map((v, i) => `<circle cx="${x(v).toFixed(1)}" cy="${y(rr[i + 1]).toFixed(1)}" r="2.6" fill="${css("--hrv")}" opacity=".55"/>`).join("")
      + `<ellipse cx="${x(m)}" cy="${y(m)}" rx="${(p.sd2 * k * 1.5).toFixed(1)}" ry="${(p.sd1 * k * 1.5).toFixed(1)}" transform="rotate(-45 ${x(m)} ${y(m)})" fill="${css("--hrv")}" fill-opacity=".08" stroke="${css("--hrv")}" stroke-width="1.5"/>`
      + `<text x="${x(hi)}" y="${y(hi) - 6}" text-anchor="end" class="axis">RRₙ₊₁ = RRₙ</text><text x="${x(lo)}" y="${H - 4}" class="axis">RRₙ (ms) →</text>`)
      + stats([[p.sd1.toFixed(1), "SD1 ms (short-term)"], [p.sd2.toFixed(1), "SD2 ms (long-term)"], [p.ratio.toFixed(2), "SD1/SD2"], [p.csi.toFixed(2), "CSI"], [p.cvi.toFixed(2), "CVI"], [(p.area / 1000).toFixed(1) + "k", "ellipse ms²"]])
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
  return `<div class="seg small">${tabs.map(([k, l]) => `<button data-hrvtab="${k}" class="${hrvTab === k ? "on" : ""}">${l}</button>`).join("")}</div>${body}`;
}
function breathingPanel() {
  const E = cur(), e = E.edr, W0 = 300, H = 26, win = Math.min(60, E.dur), ok = E.s.peaks.map((p, i) => ({ p, g: E.s.good[i] })).filter((b) => b.g && b.p / E.fs < win);
  if (!e.channels) return `<p class="note">Breathing from the ECG needs about a minute of clean beats.</p>`;
  const sig = [ok.slice(1).map((b, i) => [b.p / E.fs, (b.p - ok[i].p) / E.fs]), ok.map((b) => [b.p / E.fs, Math.abs(E.x[b.p])]), ok.map((b) => { let m = 0; for (let k = b.p - 10; k < b.p + 10; k++) m = Math.max(m, Math.abs(E.x[k] - E.x[k - 1])); return [b.p / E.fs, m]; })];
  const maxW = Math.max(...e.channels.map((c) => c.weight ?? 0), 1);
  return `<div class="fuse">${e.channels.map((c, i) => { const v = sig[i].map((p) => p[1]), x = sc(0, win, 0, W0), y = sc(Math.min(...v), Math.max(...v), H - 3, 3);
    return `<div class="fch"><div class="fch-h"><b>${c.name}</b><em>${c.rate != null ? `${c.rate.toFixed(1)}/min` : "—"}</em></div>${S(W0, H, `<path d="${smooth(sig[i].map((p) => [x(p[0]), y(p[1])]), 0.15)}" fill="none" stroke="${css("--breath")}" stroke-width="1.4"/>`, 'preserveAspectRatio="none"')}
      <div class="fch-w"><span>clarity ${(c.clarity ?? 0) > 99 ? "99+" : (c.clarity ?? 0).toFixed(0)}×</span><span class="wbar"><i style="width:${(100 * (c.weight ?? 0)) / maxW}%"></i></span><span>weight ${(c.weight ?? 0).toFixed(1)}</span></div></div>`; }).join("")}
    <div class="fused"><div><div class="lbl">Fused breathing rate</div><div class="num big2">${e.rate != null ? e.rate.toFixed(1) : "—"}<small>/min</small></div></div><div class="agree"><b>${e.channels.filter((c) => c.weight > 0).length} of 3</b> channels used<br>agreement ${Math.round((e.agreement ?? 0) * 100)}%</div></div>
    <p class="note">Three signals in the ECG move with each breath: beat timing, R-wave height and QRS steepness. Each is scored by how clear its rhythm is, and the rate is their weighted median, so one noisy signal can't drag it (Charlton 2016). Asleep last night, your pulse recordings gave ${D.latest.br.toFixed(1)}/min.</p></div>`;
}
function beatPanel() {
  const E = cur(), b = E.mb, W0 = 340, H = 170, L = b.template.length, ms = (k) => ((k - b.pre) * 1000) / b.fs;
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
const ECGM = { hr: ["Heart rate", "bpm", (E) => E.s.hrv.hr, 0], rmssd: ["HRV", "ms", (E) => E.s.hrv.rmssd, 1], breath: ["Breathing", "/min", (E) => E.edr.rate, 1], qtc: ["QTc", "ms", (E) => E.mb.qtcF, 0] };
function ecgHistory() {
  const ready = LOG.every((r) => AN.has(r.id));
  if (!ready) return `<div class="card rise" style="--i:3"><p class="note" style="margin:0">Analysing ${LOG.length} recordings on this phone… ${AN.size}/${LOG.length}</p></div>`;
  const [lbl, unit, get, dp] = ECGM[ecgMetric], W0 = 340, H = 190, sid = `s${uid++}`, col = css({ hr: "--heart", rmssd: "--hrv", breath: "--breath", qtc: "--temp" }[ecgMetric]);
  const rows = LOG.map((r) => ({ r, E: AN.get(r.id) })).map((z) => ({ ...z, v: z.E.verdict[1] === "short" ? null : get(z.E) }));
  const vals = rows.filter((z) => z.v != null).map((z) => z.v), lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.25 || 1;
  const x = sc(-60, 0, 34, W0 - 10), y = sc(lo - pad, hi + pad, H - 24, 12), okRows = rows.filter((z) => z.v != null);
  const fit = W.ols(okRows.map((z) => [1, -z.r.ago]), okRows.map((z) => z.v));
  const body = [lo, (lo + hi) / 2, hi].map((v) => `<line x1="34" x2="${W0 - 10}" y1="${y(v)}" y2="${y(v)}" stroke="${css("--grid")}"/><text x="28" y="${y(v) + 4}" text-anchor="end" class="axis">${v.toFixed(dp)}</text>`).join("")
    + (fit ? `<path d="M${x(-60)},${y(fit.beta[0] + fit.beta[1] * -60)}L${x(0)},${y(fit.beta[0])}" stroke="${col}" stroke-opacity=".45" stroke-width="1.5" stroke-dasharray="5 4"/>` : "")
    + `<path class="draw" style="--len:700" d="${smooth(okRows.map((z) => [x(-z.r.ago), y(z.v)]), 0.12)}" fill="none" stroke="${col}" stroke-width="2"/>`
    + rows.map((z) => z.v == null ? `<circle cx="${x(-z.r.ago)}" cy="${H - 30}" r="3.5" fill="none" stroke="${css("--ink3")}" stroke-width="1.4"/>` : `<circle cx="${x(-z.r.ago)}" cy="${y(z.v)}" r="${z.r.ago === 0 ? 5.5 : 4}" fill="${css(z.E.verdict[1] === "good" ? "--good" : "--bad")}" stroke="${css("--bg")}" stroke-width="2"/>`).join("")
    + [-60, -45, -30, -15, 0].map((dd) => { const d = new Date(2026, 8, 24 + dd); return `<text x="${x(dd)}" y="${H - 4}" text-anchor="middle" class="axis">${dd === 0 ? "today" : `${MON[d.getMonth()]} ${d.getDate()}`}</text>`; }).join("");
  const sp = rows.map((z) => [x(-z.r.ago), z.v == null ? H - 30 : y(z.v), `${recWhen(z.r)} · ${z.v == null ? "too short to measure" : `<b>${z.v.toFixed(dp)} ${unit}</b>`} · ${z.E.verdict[0].toLowerCase()}`]);
  const slope = fit ? fit.beta[1] * 30 : 0;
  return `<div class="card rise" style="--i:3"><div class="seg small">${Object.entries(ECGM).map(([k, [l]]) => `<button data-ecgm="${k}" class="${ecgMetric === k ? "on" : ""}">${l}</button>`).join("")}</div>
    ${scrubbable(sid, W0, H, body, sp, `Each dot is a recording, coloured by its rhythm result. Hollow: too short to judge.`)}
    <div class="stat3"><div><b>${okRows[okRows.length - 1].v.toFixed(dp)}</b><span>latest ${unit}</span></div><div><b>${median(vals).toFixed(dp)}</b><span>median of ${vals.length}</span></div><div><b>${sign(slope, dp)}</b><span>trend per 30 days</span></div></div>
    <p class="note">Morning recordings are the most comparable: same time, seated, before coffee. ${ecgMetric === "qtc" ? "QTc from a finger lead is an estimate; the trend matters more than any one value." : ecgMetric === "rmssd" ? "Short-recording HRV swings from day to day; the dashed trend line is what to watch." : ""}</p></div>`;
}
function recList() {
  const list = [...LOG].reverse(), shown = allRecs ? list : list.slice(0, 5);
  return `<div class="card rise reclist" style="--i:4">${shown.map((r) => {
    const E = AN.get(r.id);
    return `<button class="rec-row" data-rec="${r.id}"><i class="${E ? E.verdict[1] : ""}"></i><span class="rr-w"><b>${recWhen(r)}</b><span>${E ? E.verdict[0] : "analysing…"} · ${r.seconds >= 120 ? "2 min" : `${r.seconds} s`}</span></span><span class="rr-v">${E && E.verdict[1] !== "short" ? `${E.s.hrv.hr.toFixed(0)}<small>bpm</small> ${E.s.hrv.rmssd.toFixed(0)}<small>ms</small>` : "—"}</span><span class="chev">›</span></button>`;
  }).join("")}${list.length > 5 ? `<button class="more" data-allrecs>${allRecs ? "Show fewer" : `Show all ${list.length} recordings`}</button>` : ""}</div>`;
}
function bpSection() {
  const all = W.bpLog(), n = +bpAgg, rows = all.filter((r) => r.day < n), wk = all.filter((r) => r.day <= 6), aS = mean(wk.map((r) => r.sys)), aD = mean(wk.map((r) => r.dia));
  const cat = aS >= 135 || aD >= 85 ? ["Stage 2 range", "bad"] : aS >= 130 || aD >= 80 ? ["Stage 1 range", "watch"] : aS >= 120 ? ["Elevated", "watch"] : ["Normal", "good"];
  const W0 = 340, H = 180, x = sc(n - 0.5, -0.5, 30, W0 - 8), y = sc(70, 150, H - 22, 8), bw = Math.max(1.6, Math.min(6, ((W0 - 40) / n) * 0.36));
  const roll = []; for (let d = n - 1; d >= 0; d--) { const w = all.filter((r) => r.day >= d && r.day < d + 7); if (w.length >= 4) roll.push([x(d), y(mean(w.map((r) => r.sys))), y(mean(w.map((r) => r.dia)))]); }
  const body = [80, 130].map((v) => `<line x1="30" x2="${W0 - 6}" y1="${y(v)}" y2="${y(v)}" stroke="${css("--watch")}" stroke-opacity=".6"/><text x="26" y="${y(v) + 4}" text-anchor="end" class="axis">${v}</text>`).join("")
    + [100, 140].map((v) => `<line x1="30" x2="${W0 - 6}" y1="${y(v)}" y2="${y(v)}" stroke="${css("--grid")}"/><text x="26" y="${y(v) + 4}" text-anchor="end" class="axis">${v}</text>`).join("")
    + rows.map((r) => `<line x1="${(x(r.day) + (r.am ? -bw / 2 : bw / 2)).toFixed(1)}" x2="${(x(r.day) + (r.am ? -bw / 2 : bw / 2)).toFixed(1)}" y1="${y(r.sys)}" y2="${y(r.dia)}" stroke="${css("--heart")}" stroke-width="${bw.toFixed(1)}" stroke-linecap="round" opacity="${r.am ? 0.9 : 0.5}"/>`).join("")
    + `<path d="${smooth(roll.map((p) => [p[0], p[1]]), 0.12)}" fill="none" stroke="${css("--ink")}" stroke-width="1.8" opacity=".75"/><path d="${smooth(roll.map((p) => [p[0], p[2]]), 0.12)}" fill="none" stroke="${css("--ink")}" stroke-width="1.8" opacity=".45"/>`
    + [n - 1, Math.round((n - 1) / 2), 0].map((d) => { const dt = new Date(2026, 8, 24 - d); return `<text x="${x(d)}" y="${H - 4}" text-anchor="middle" class="axis">${d === 0 ? "today" : `${MON[dt.getMonth()]} ${dt.getDate()}`}</text>`; }).join("");
  const sid = `s${uid++}`;
  const first = mean(all.filter((r) => r.day >= 49).map((r) => r.sys));
  const diffs = wk.map((r) => r.band - r.sys), bias = mean(diffs), sdd = sd(diffs), maeBand = mean(diffs.map(Math.abs));
  const maeLast = mean(wk.slice(1).map((r, i) => Math.abs(r.sys - wk[i].sys)));
  const X = sc(0, Math.max(maeBand, maeLast) * 1.15, 0, 170);
  return `<div class="card rise" style="--i:6"><div class="bp-h"><div><div class="lbl">Home average · last 7 days</div><div class="num big2">${aS.toFixed(0)}<span class="slash">/</span>${aD.toFixed(0)}<small>mmHg</small></div></div><span class="badge ${cat[1]}">${cat[0]}</span></div>
      <div class="agg">${[["14", "2W"], ["30", "30D"], ["56", "8W"]].map(([k, l]) => `<button data-bpagg="${k}" class="${bpAgg === k ? "on" : ""}">${l}</button>`).join("")}</div>
      ${scrubbable(sid, W0, H, body, rows.map((r) => [x(r.day), y(r.sys), `${dname(r.d)} ${r.am ? "AM" : "PM"} · <b>${r.sys}/${r.dia}</b> · pulse ${r.pulse}`]), `Bars: each cuff reading, systolic to diastolic (morning solid). Lines: 7-day averages.`)}
      <div class="stat3"><div><b>${sign(aS - first, 0)}</b><span>systolic vs 8 weeks ago</span></div><div><b>${wk.length}</b><span>readings this week</span></div><div><b>${all.length}</b><span>readings logged</span></div></div>
      <p class="note">ACC/AHA home thresholds: stage 1 from 130/80, stage 2 from 135/85. The 7-day average feeds your heart-risk estimate in Profile.</p></div>
    <div class="card rise" style="--i:7"><div class="lbl" style="margin-bottom:10px">Can the band estimate your BP?</div>
      <div class="cmp"><div><span>Band's estimate</span>${S(170, 12, `<rect x="0" y="2" width="${X(maeBand)}" height="8" rx="4" fill="${css("--bad")}" opacity=".8"/>`)}<b>${maeBand.toFixed(1)}</b></div>
        <div><span>Your last cuff reading</span>${S(170, 12, `<rect x="0" y="2" width="${X(maeLast)}" height="8" rx="4" fill="${css("--good")}" opacity=".8"/>`)}<b>${maeLast.toFixed(1)}</b></div></div>
      <p class="note">Average miss in systolic mmHg over ${wk.length} paired readings this week. The band reads ${Math.abs(bias).toFixed(0)} mmHg ${bias < 0 ? "low" : "high"} on average (95% of misses within ${(bias - 1.96 * sdd).toFixed(0)} to ${(bias + 1.96 * sdd).toFixed(0)}) and barely moves when your cuff does.</p>
      <p class="verdict-line"><b>Not yet.</b> Simply reusing your last cuff reading beats the band, so Pulse shows cuff numbers only. The band has no raw pulse-wave signal to time against the ECG, which is what a real cuffless estimate needs. The AHA advises against cuffless readings for diagnosis.</p></div>`;
}
function measure() {
  const lastR = LOG[LOG.length - 1], E = AN.get(lastR.id);
  const ecgIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 13h4l2-5 3 10 3-13 2 8h6"/></svg>`;
  const bpIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="7"/><path d="M12 13l3-3M12 6V4M9 3h6"/></svg>`;
  return `${header("ECG · blood pressure", "Measure", `<span class="hchip"><i></i>V5 ${me.name}</span>`)}
    <div class="acts rise" style="--i:1">
      <div class="card act" style="--tint:${css("--heart")}"><span class="act-i">${ecgIcon}</span><b>Heart rhythm</b><span>30 s – 2 min, finger on the silver plate</span><button class="cta" data-record>Start</button></div>
      <div class="card act" style="--tint:${css("--spo2")}"><span class="act-i">${bpIcon}</span><b>Blood pressure</b><span>Log a reading from your home cuff</span><button class="cta" data-sheet="bp">Log</button></div>
    </div>
    ${E ? `<button class="card latest rise" style="--i:2" data-rec="${lastR.id}"><span class="pulse-dot ${E.verdict[1]}"></span><span class="lt-t"><span class="lbl">Latest · ${recWhen(lastR)}</span><b>${E.verdict[0]}</b><span>${E.s.hrv.hr.toFixed(0)} bpm · HRV ${E.s.hrv.rmssd.toFixed(0)} ms · QTc ${E.mb.qtcF.toFixed(0)} ms · breathing ${E.edr.rate.toFixed(1)}/min</span></span><span class="chev">›</span></button>` : ""}
    <div class="sec rise" style="--i:3"><h2>Rhythm checks over time</h2><span class="lbl">${LOG.length} recordings</span></div>
    ${ecgHistory()}
    <div class="sec rise" style="--i:4"><h2>Recordings</h2><span class="lbl">tap to open</span></div>
    ${recList()}
    <div class="sec rise" style="--i:5"><h2>Blood pressure over time</h2><span class="lbl">home cuff</span></div>
    ${bpSection()}
    <p class="note foot">Concept · synthetic ECGs, analysed on this phone by Pulse's own code.</p>`;
}
function recView() {
  const E = cur(), r = E.r, h = E.s.hrv, short2 = E.verdict[1] === "short" && E.dur < 25;
  return `<div class="aurora"><i class="a"></i><i class="b"></i><i class="c"></i></div><div class="inner">
    <div class="m-top"><button class="back" data-close>‹ Measure</button><span class="lbl">finger lead · 256 Hz</span></div>
    <div class="card hero-ecg v-${E.verdict[1]}" style="margin-top:16px"><div class="rhythm"><div class="pulse-dot ${E.verdict[1]}"></div><div><div class="lbl">Heart rhythm check · ${recWhen(r)}</div><div class="r-verdict">${E.verdict[0]}</div><div class="r-sub">${Math.round(E.dur + 5)} s · ${Math.round(E.s.quality * 100)}% clean beats${E.early ? ` · ${E.early} interval${E.early > 1 ? "s" : ""} set aside` : ""}</div></div></div>
      <div class="r-stats"><div><b>${h.hr.toFixed(0)}</b><span>bpm</span></div><div><b>${h.rmssd.toFixed(0)}</b><span>RMSSD ms</span></div><div><b>${E.edr.rate != null ? E.edr.rate.toFixed(1) : "—"}</b><span>breaths/min</span></div><div><b>${E.mb.qtcF.toFixed(0)}</b><span>QTc ms</span></div></div>
      <p class="note">${E.verdict[2] ? `${E.verdict[2]} ` : ""}Irregularity screen (Dash 2009): normalised RMSSD ${h.nrmssd.toFixed(3)} (flag above 0.1), entropy ${h.shannon.toFixed(2)}, turning points ${h.tpr.toFixed(2)}. Not a diagnosis; an irregular result means show a doctor the strip.</p></div>
    <div class="sec"><h2>The recording</h2><span class="lbl">${Math.round(E.dur + 5)} s</span></div>
    <div class="card" id="ecgcard">${ecgTrace()}${ecgOverview()}</div>
    ${short2 ? "" : `<div class="sec"><h2>Heart rate variability</h2><span class="lbl">${E.s.rr.length} clean beats</span></div>
    <div class="card" id="hrvcard">${hrvPanel()}</div>
    <div class="sec"><h2>Breathing from the ECG</h2><span class="lbl">3-signal fusion</span></div>
    <div class="card">${breathingPanel()}</div>
    <div class="sec"><h2>Average beat</h2><span class="lbl">estimates · check by eye</span></div>
    <div class="card">${beatPanel()}</div>`}
    <p class="note foot">Analysed on this phone in ${E.ms.toFixed(0)} ms.</p></div>`;
}

// ================= PROFILE =================
const latest = () => W.DRAWS[W.DRAWS.length - 1].v;
function preventInput(over = {}) {
  const L = latest(), sbp = Math.round(mean(W.bpLog().filter((r) => r.day <= 6).map((r) => r.sys)));
  return { age: me.age, sex: me.sex, totalChol: over.tc ?? L.tc, hdl: L.hdl, sbp: over.sbp ?? sbp, bmi: +W.bmi(me).toFixed(1), egfr: L.egfr, diabetes: me.diabetes, smoker: me.smoker, bpTreatment: me.bpMeds, statin: me.statin, hba1c: L.a1c };
}
const pick = (r) => r.a1c ?? r.base;
function riskCat(p) { return p < 0.05 ? ["Low", "good"] : p < 0.075 ? ["Borderline", "watch"] : p < 0.2 ? ["Intermediate", "bad"] : ["High", "bad"]; }
function preventCard() {
  const inp = preventInput(), r = prevent(inp), R = pick(r);
  if (!R) return `<p>${r.warnings[0]}</p>`;
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
  const b = W.bmi(me), all = W.DRAWS.map((d) => derived(d.v, { bmi: b })), cur2 = all[all.length - 1];
  return cur2.map((d) => {
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
  return `${header(`${me.name} · ${me.age}`, "Profile", `<span class="avatar">${me.name[0]}</span>`)}
    <div class="card rise" style="--i:1"><div class="kv">${[["Age", `${me.age}`], ["Sex", me.sex], ["Height", `${Math.floor(me.heightIn / 12)}′${me.heightIn % 12}″`], ["Weight", `${me.weightLb} lb`], ["BMI", b.toFixed(1)]].map(([a, v]) => `<div><span>${a}</span><b>${v}</b></div>`).join("")}</div>
      <div class="chips" style="margin-top:12px">${tog("bpMeds", "BP medication")}${tog("statin", "Statin")}${tog("smoker", "Smoker")}${tog("diabetes", "Diabetes")}</div>
      <p class="note">These feed the risk estimate below and adjust heart-rate targets (beta-blockers change them).</p></div>
    <div class="sec rise" style="--i:2"><h2>Settings</h2><span class="lbl">this phone</span></div>
    <div class="card rise" style="--i:2">
      <div class="setrow"><span>Appearance</span><div class="seg small inline">${[["dark", "Dark"], ["light", "Light"]].map(([k, l]) => `<button data-theme-set="${k}" class="${theme === k ? "on" : ""}">${l}</button>`).join("")}</div></div>
      <div class="setrow"><span>Preview <em>concept only</em></span><div class="seg small inline">${[["good", "Good night"], ["rough", "Rough night"]].map(([k, l]) => `<button data-scen="${k}" class="${scen === k ? "on" : ""}">${l}</button>`).join("")}</div></div>
      <p class="note">Preview swaps the synthetic data between a good night and a rough one, so you can see how Today and Night respond.</p></div>
    <div class="sec rise" style="--i:3"><h2>Heart risk</h2><span class="lbl">AHA PREVENT</span></div>
    <div class="card rise" style="--i:3" id="prevent">${preventCard()}</div>
    <div class="sec rise" style="--i:4" id="labs"><h2>Labs</h2><span class="lbl">${W.DRAWS.length} panels · Quest</span></div>
    <div class="card rise" style="--i:4"><button class="cta ghost" data-sheet="upload">Add a lab report (PDF)</button>${labsCard()}</div>
    <div class="sec rise" style="--i:5"><h2>What your labs imply</h2><span class="lbl">derived</span></div>
    <div class="card rise" style="--i:5">${indicesCard()}</div>
    <div class="sec rise" style="--i:6"><h2>Labs alongside your band</h2><span class="lbl">1 year</span></div>
    <div class="card rise" style="--i:6">${labsVsWearable()}</div>
    <div class="sec rise" style="--i:7"><h2>Band</h2><span class="lbl">V5 ${me.name}</span></div>
    <div class="card rise" style="--i:7"><div class="kv">${[["Battery", "92%"], ["Last sync", "4 min ago"], ["Heart rate", "every 5 s"], ["Oxygen, HRV, temperature", "every 10 min"], ["Snore / breathing mode", "on"], ["Data", "on this phone only"]].map(([a, v]) => `<div><span>${a}</span><b>${v}</b></div>`).join("")}</div>
      <div class="chips" style="margin-top:12px"><button class="chip">Sync now</button><button class="chip">Export backup</button><button class="chip ghost">Forget band</button></div></div>
    <p class="note foot">Concept · synthetic person and labs. PREVENT and the lab formulas are the real ones.</p>`;
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

// ================= modal + interactions =================
let modal = null, origin = null, openKey = null, modalKind = null;
function openModal(el, kind, key) {
  origin = el; modalKind = kind; openKey = key; view = "now";
  if (kind === "rec") { recOpen = key; ecgStart = 0; }
  const r = el.getBoundingClientRect();
  modal = document.createElement("div");
  modal.className = "modal";
  modal.style.setProperty("--mcolor", css(kind === "rec" ? "--heart" : M[key].color));
  Object.assign(modal.style, { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px`, transition: "none" });
  modal.innerHTML = kind === "rec" ? recView() : drill(key);
  document.body.append(modal);
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const e = "cubic-bezier(.2,.85,.2,1)";
    modal.style.transition = `top .46s ${e}, left .46s ${e}, width .46s ${e}, height .46s ${e}, border-radius .46s ${e}`;
    Object.assign(modal.style, { top: "0px", left: "0px", width: "100vw", height: "100vh", borderRadius: "0px" });
    setTimeout(() => modal?.classList.add("full"), 400);
  }));
}
function redrawModal() { const st = modal.scrollTop; modal.innerHTML = modalKind === "rec" ? recView() : drill(openKey); modal.classList.add("full"); modal.scrollTop = st; }
function closeModal() {
  if (!modal) return;
  const r = origin.isConnected ? origin.getBoundingClientRect() : { top: innerHeight / 2, left: innerWidth / 2 - 20, width: 40, height: 40 }, m = modal;
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
  ov.innerHTML = `<div class="rec-ring">${S(120, 120, `<circle cx="60" cy="60" r="52" fill="none" stroke="${css("--track")}" stroke-width="8"/><circle class="rec-arc" cx="60" cy="60" r="52" fill="none" stroke="${css("--heart")}" stroke-width="8" stroke-linecap="round" transform="rotate(-90 60 60)" stroke-dasharray="326.7" stroke-dashoffset="326.7"/>`)}<div class="rec-t">0:00</div></div><p>Finger on the silver plate.</p><p class="note">Demo: 2 min, 30× speed</p>`;
  card.append(ov);
  const t0 = performance.now(), dur2 = 4000;
  const tick = (t) => {
    const f = Math.min(1, (t - t0) / dur2), s = Math.round(f * 120);
    ov.querySelector(".rec-arc").setAttribute("stroke-dashoffset", (326.7 * (1 - f)).toFixed(1));
    ov.querySelector(".rec-t").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    if (f < 1) requestAnimationFrame(tick); else { ov.innerHTML = `<p class="done">Analysing…</p>`; setTimeout(() => { ov.remove(); const el = $("[data-rec]") ?? card; analyzeRec(LOG[LOG.length - 1]); openModal(el, "rec", LOG[LOG.length - 1].id); }, 450); }
  };
  requestAnimationFrame(tick);
}
function saveAnswer(tags) {
  answers.set(D.i, new Set(tags)); draft.clear();
  const y = scrollY; render(false); scrollTo(0, y);
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
  if (t.closest("[data-close]")) { closeModal(); if (t.closest("[data-goto]")) setTimeout(() => $("#prompt")?.scrollIntoView({ behavior: "smooth", block: "center" }), 480); return; }
  const ht = t.closest("[data-hrvtab]");
  if (ht) { hrvTab = ht.dataset.hrvtab; $("#hrvcard").innerHTML = hrvPanel(); return; }
  const j = t.closest("[data-jump]");
  if (j) { const E = cur(); const r = E.iv.find((z) => !z.ok); if (r) ecgStart = clamp(r.t - 3, 0, Math.max(0, E.dur - 8)); $("#ecgcard").innerHTML = ecgTrace() + ecgOverview(); return; }
  if (modal) return;
  // prompts
  const dr = t.closest("[data-draft]");
  if (dr) { const k = dr.dataset.draft; draft.has(k) ? draft.delete(k) : draft.add(k); dr.classList.toggle("on"); const sv = $("[data-answer=save]"); if (sv) sv.disabled = !draft.size; return; }
  const an = t.closest("[data-answer]");
  if (an) { saveAnswer(an.dataset.answer === "none" ? [] : [...draft]); return; }
  const un = t.closest("[data-undo]");
  if (un) { answers.delete(+un.dataset.undo); const y = scrollY; render(false); scrollTo(0, y); return; }
  const wk = t.closest("[data-wkind]");
  if (wk) { workoutTags.set(+wk.closest("[data-wprompt]").dataset.wprompt, { kind: wk.dataset.wkind, rpe: null }); const y = scrollY; render(false); scrollTo(0, y); return; }
  const wr = t.closest("[data-wrpe]");
  if (wr) { const k = +wr.closest("[data-wprompt]").dataset.wprompt; workoutTags.get(k).rpe = +wr.dataset.wrpe; const y = scrollY; render(false); scrollTo(0, y); return; }
  if (t.closest("[data-gonight]")) { sel = null; setTab("night"); setTimeout(() => $("#prompt")?.scrollIntoView({ behavior: "smooth", block: "center" }), 350); return; }
  const nb = t.closest("[data-night]");
  if (nb) { const i = +nb.dataset.night; sel = i === D.L ? null : i; draft.clear(); const y = Math.min(scrollY, 0); render(); scrollTo(0, y); return; }
  const tb = t.closest("[data-tab]");
  if (tb) { setTab(tb.dataset.tab); return; }
  const em = t.closest("[data-ecgm]");
  if (em) { ecgMetric = em.dataset.ecgm; const y = scrollY; render(false); scrollTo(0, y); return; }
  if (t.closest("[data-allrecs]")) { allRecs = !allRecs; const y = scrollY; render(false); scrollTo(0, y); return; }
  const ba = t.closest("[data-bpagg]");
  if (ba) { bpAgg = ba.dataset.bpagg; const y = scrollY; render(false); scrollTo(0, y); return; }
  if (t.closest("[data-record]")) { record(t.closest("[data-record]")); return; }
  const rc = t.closest("[data-rec]");
  if (rc) { const r = LOG.find((z) => z.id === rc.dataset.rec); analyzeRec(r); openModal(rc, "rec", r.id); return; }
  const hz = t.closest("[data-horizon]");
  if (hz) { horizon = hz.dataset.horizon; $("#prevent").innerHTML = preventCard(); return; }
  const mk = t.closest("[data-me]");
  if (mk) { me[mk.dataset.me] = !me[mk.dataset.me]; mk.classList.toggle("on", me[mk.dataset.me]); mk.textContent = mk.textContent.replace(/: (yes|no)$/, me[mk.dataset.me] ? ": yes" : ": no"); $("#prevent").innerHTML = preventCard(); return; }
  const th = t.closest("[data-theme-set]");
  if (th) { theme = th.dataset.themeSet; root.dataset.theme = theme; const y = scrollY; render(false); scrollTo(0, y); return; }
  const sn = t.closest("[data-scen]");
  if (sn) { scen = sn.dataset.scen; answers.clear(); workoutTags.clear(); draft.clear(); sel = null; const y = scrollY; render(false); scrollTo(0, y); return; }
  const ex = t.closest("[data-expand]");
  if (ex) { const id = ex.dataset.expand; open.has(id) ? open.delete(id) : open.add(id); const y = scrollY; render(false); scrollTo(0, y); return; }
  const sh = t.closest("[data-sheet]");
  if (sh) { showSheet(sh.dataset.sheet); return; }
  const o = t.closest("[data-open]");
  if (o) openModal(o, "drill", o.dataset.open);
});
document.addEventListener("input", (e) => {
  const s = e.target.closest("[data-whatif]");
  if (!s) return;
  whatIf[s.dataset.whatif] = +s.value;
  const card = $("#prevent"), k = s.dataset.whatif;
  card.innerHTML = preventCard();
  card.querySelector(`[data-whatif="${k}"]`)?.focus();
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
  const E = cur(), box = dragOv.querySelector("svg").getBoundingClientRect(), f = (e.clientX - box.left) / box.width;
  ecgStart = clamp(f * E.dur - 4, 0, Math.max(0, E.dur - 8));
  const card = $("#ecgcard"); card.innerHTML = ecgTrace() + ecgOverview(); dragOv = card.querySelector("[data-ecgov]");
}

// ---------- tabs ----------
function setTab(t) { tab = t; render(); scrollTo(0, 0); }
function render(anim = true) {
  build(); uid = 0;
  for (const k of Object.keys(SCRUB)) delete SCRUB[k];
  const app = $("#app");
  app.classList.toggle("still", !anim);
  app.innerHTML = tab === "today" ? today() : tab === "night" ? night() : tab === "measure" ? measure() : profile();
  for (const b of document.querySelectorAll(".tabbar [data-tab]")) b.classList.toggle("on", b.dataset.tab === tab);
  if (tab === "night") { const on = $(".nd.on"), st = $("#nstrip"); if (on && st) st.scrollLeft = on.offsetLeft - st.clientWidth + on.clientWidth + 8; }
  sweep(); countUp(app);
}
root.dataset.theme = theme;
if (params.get("night")) { build(); sel = clamp(D.L - +params.get("night"), 7, D.L); if (sel === D.L) sel = null; }
render();
pump();
const deep = params.get("open"), rec = params.get("rec");
if (deep) setTimeout(() => { const el = document.querySelector(`[data-open="${deep}"]`); if (el) { openModal(el, "drill", deep); view = params.get("view") ?? "now"; setTimeout(redrawModal, 450); } }, 600);
if (rec) setTimeout(() => { const r = LOG.find((z) => z.id === rec) ?? LOG[LOG.length - 1]; analyzeRec(r); openModal($("#app"), "rec", r.id); }, 600);
