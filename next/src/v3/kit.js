// Shared UI state, formatting, SVG helpers and the components every tab uses (header, gauge, minis,
// montage, tiles, scrubbable charts). Screens are HTML strings; every piece of user-entered text goes
// through esc().
import { isUS, tempUnit } from "../core/units.js?v=20260924205306";
import { clamp, median } from "./stats.js?v=20260924205306";

/** UI state that survives re-renders. */
export const st = {
  tab: "today", sel: null, view: "now", agg: "90", split: false, showTags: true, hrvTab: "time", ecgStart: 0, horizon: "10",
  ecgMetric: "rmssd", bpAgg: "30", tagg: "90", allRecs: false, draft: new Set(), open: new Set(), whatIf: { sbp: null, tc: null }, recOpen: null,
};
/** The derived data for the current render (filled by app.js before each render). */
export const D = {};

export const root = document.documentElement;
export const css = (v) => getComputedStyle(root).getPropertyValue(v).trim();
export const dark = () => (root.dataset.theme ? root.dataset.theme !== "light" : matchMedia("(prefers-color-scheme: dark)").matches);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- svg ----------
export const S = (w, h, body, extra = "") => `<svg viewBox="0 0 ${w} ${h}" ${extra}>${body}</svg>`;
export const sc = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
export function smooth(pts, t = 0.18) {
  if (pts.length < 3) return pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) * t, p1[1] + (p2[1] - p0[1]) * t], c2 = [p2[0] - (p3[0] - p1[0]) * t, p2[1] - (p3[1] - p1[1]) * t];
    d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}
/** Smooth path through points, broken where gaps (null y) occur. */
export function smoothRuns(pts, t = 0.18) {
  const runs = []; let cur = [];
  for (const p of pts) { if (p == null || p[1] == null || !Number.isFinite(p[1])) { if (cur.length) runs.push(cur); cur = []; } else cur.push(p); }
  if (cur.length) runs.push(cur);
  return runs.map((r) => smooth(r, t)).join("");
}
export const poly = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
export const glowDef = (id, dev = 3) => (dark() ? `<filter id="${id}" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="${dev}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` : "");
export const glow = (id) => (dark() ? `filter="url(#${id})"` : "");
export const arcPath = (cx, cy, r, a0, a1) => { const p = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)]; const [x0, y0] = p(a0), [x1, y1] = p(a1); return `M${x0.toFixed(2)},${y0.toFixed(2)}A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`; };
export const stageColor = (s) => css({ 1: "--deep", 2: "--light", 3: "--rem", 4: "--awake" }[s] ?? "--awake");
export const stageName = { 1: "Deep", 2: "Light", 3: "REM", 4: "Awake" };
let uidN = 0;
export const uid = (p = "u") => `${p}${uidN++}`;
export const resetUid = () => { uidN = 0; };

// ---------- formatting ----------
export const clock = (m) => { const t = ((Math.round(m) % 1440) + 1440) % 1440; const h = Math.floor(t / 60), mm = t % 60; return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, "0")}`; };
export const ampm = (m) => `${clock(m)} ${((Math.round(m) % 1440) + 1440) % 1440 >= 720 ? "PM" : "AM"}`;
export const hr12 = (h) => (h % 24 === 0 ? "12a" : h % 24 === 12 ? "12p" : h % 24 < 12 ? `${h % 24}a` : `${(h % 24) - 12}p`);
export const dur = (h) => { const m = Math.round(Math.abs(h) * 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`; };
export const hm = (h) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
export const short = (min) => (min >= 60 ? `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, "0")}` : `${Math.round(min)}m`);
export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const FULLDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const dname = (d) => `${DAYS[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}`;
export const ord = (n) => `${n}${[11, 12, 13].includes(n % 100) ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
export const pct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;
export const sign = (v, d = 1) => { const r = +Math.abs(v).toFixed(d); return `${r === 0 ? "" : v > 0 ? "+" : "−"}${r.toFixed(d)}`; };
export const cap1 = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const eveOf = (h) => new Date(h.d.getFullYear(), h.d.getMonth(), h.d.getDate() - 1);
export const nightName = (h) => { const e = eveOf(h); return `${DAYS[e.getDay()]} → ${DAYS[h.d.getDay()]}`; };
export const nightDates = (h) => { const e = eveOf(h); return e.getMonth() === h.d.getMonth() ? `${MON[e.getMonth()]} ${e.getDate()}–${h.d.getDate()}` : `${MON[e.getMonth()]} ${e.getDate()} – ${MON[h.d.getMonth()]} ${h.d.getDate()}`; };
/** Temperature difference (stored °C) in the display unit. */
export const tDelta = (dc) => (isUS() ? dc * 1.8 : dc);
export const tUnit = () => tempUnit();
export const fmt0 = (v) => (v == null ? "—" : Math.round(v).toLocaleString());
export const relMin = (m) => (m < 1 ? "just now" : m < 60 ? `${Math.round(m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`);
export const q = (n) => `<span class="q" title="data quality ${n}/5">${[0, 1, 2, 3, 4].map((i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</span>`;
export const stateOf = (rec) => (rec == null || rec >= 67 ? "good" : rec >= 50 ? "watch" : "bad");
export const isLatest = () => D.i === D.L;
export const thatNight = () => (isLatest() ? "last night" : "that night");
export const usualOf = (k, hist = D.H) => { const v = hist.slice(-29, -1).map((h) => h[k]).filter((x) => x != null); return v.length >= 5 ? median(v) : null; };

// ---------- scrubbable charts ----------
export const SCRUB = {};
export function scrubbable(id, W0, H0, body, pts, idle, cls = "") {
  SCRUB[id] = { pts, idle, W: W0 };
  return `<div class="readout" data-readout="${id}">${idle}</div><div class="scrub ${cls}" data-scrub="${id}">${S(W0, H0, `${body}<line class="xh" x1="0" x2="0" y1="0" y2="${H0}"/><circle class="xd" r="4.5" cx="-20" cy="-20"/>`)}</div>`;
}

// ---------- components ----------
export function header(lbl, title, right = "") {
  return `<div class="hd rise" style="--i:0"><div><div class="lbl">${lbl}</div><h1>${title}</h1></div>${right}</div>`;
}
/** The connection chip in the header: tap to connect or sync. */
export function syncChip(ctx) {
  const busy = ctx.conn === "connecting" || ctx.conn === "syncing";
  const txt = busy ? esc(ctx.status || "Syncing…") : D.syncText ?? "Connect";
  return `<button class="hchip btn ${busy ? "busy" : ctx.conn === "on" ? "on" : ""}" data-syncchip><i></i><span>${txt}</span></button>`;
}
export function gauge({ value, count, label, big, verdict, vcolor, cap, color, color2, open, range, tick, building = false }) {
  const W0 = 260, c = 130, cy = 122, r = 104, a0 = Math.PI * 0.78, a1 = Math.PI * 2.22, span = a1 - a0, at = (v) => a0 + (clamp(v, 0, 100) / 100) * span;
  const v = value ?? 0, len = r * span, prog = (clamp(v, 0, 100) / 100) * len, id = uid("g"), gid = uid("gg");
  const knob = [c + r * Math.cos(at(v)), cy + r * Math.sin(at(v))];
  const tk = tick != null ? (() => { const a = at(tick); return `<line x1="${(c + (r - 13) * Math.cos(a)).toFixed(1)}" y1="${(cy + (r - 13) * Math.sin(a)).toFixed(1)}" x2="${(c + (r + 13) * Math.cos(a)).toFixed(1)}" y2="${(cy + (r + 13) * Math.sin(a)).toFixed(1)}" stroke="${css("--ink")}" stroke-width="2.5" stroke-linecap="round" opacity=".75"/>`; })() : "";
  return `<div class="gauge ${building ? "building" : ""}" ${open ? `data-open="${open}"` : ""} style="--gc:${color}"><div class="halo"></div>${S(W0, 230, `<defs><linearGradient id="${gid}" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${color2 ?? color}" stop-opacity="${color2 ? 1 : 0.55}"/><stop offset="1" stop-color="${color}"/></linearGradient>${glowDef(id, 5)}</defs>
    <path d="${arcPath(c, cy, r, a0, a1)}" fill="none" stroke="${css("--track")}" stroke-width="16" stroke-linecap="round"/>
    ${range ? `<path d="${arcPath(c, cy, r, at(range[0]), at(range[1]))}" fill="none" stroke="${css("--ink")}" stroke-opacity=".10" stroke-width="16"/>` : ""}
    ${value != null ? `<path class="arc" d="${arcPath(c, cy, r, a0, a1)}" fill="none" stroke="url(#${gid})" stroke-width="16" stroke-linecap="round" stroke-dasharray="${len.toFixed(1)}" stroke-dashoffset="${len.toFixed(1)}" data-to="${(len - prog).toFixed(1)}" ${glow(id)}/>
    ${tk}<circle cx="${knob[0].toFixed(1)}" cy="${knob[1].toFixed(1)}" r="6" fill="${css("--bg")}" stroke="${color}" stroke-width="3" class="fadein" style="--i:6"/>` : ""}`)}
    <div class="center"><div class="lbl">${label}</div><div class="big num" ${count != null ? `data-count="${count}"` : ""}>${big}</div><div class="verdict" style="color:${vcolor ?? color}">${verdict}</div></div><div class="cap">${cap}</div></div>`;
}
export const mini = (open, svg, em, b, s1, s2 = "") => `<div class="mini" ${open ? `data-open="${open}"` : ""}>${svg}<div class="t"><em>${em}</em><b>${b}</b><span>${s1}</span>${s2 ? `<span>${s2}</span>` : ""}</div></div>`;
export function ringSvg(frac, color) {
  const c = 37, r = 29, len = 2 * Math.PI * r, id = uid("r");
  return S(74, 74, `<defs>${glowDef(id, 2.5)}</defs><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${css("--track")}" stroke-width="7"/>
    ${frac != null ? `<circle class="arc" cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" transform="rotate(-90 ${c} ${c})" stroke-dasharray="${len.toFixed(1)}" stroke-dashoffset="${len.toFixed(1)}" data-to="${(len * (1 - clamp(frac, 0, 1))).toFixed(1)}" ${glow(id)}/>` : ""}`);
}
export function montage(rows, axis, lblL, lblR) {
  return `<div class="card mon rise" style="--i:4">
    <div class="mon-h"><span class="lbl">${lblL}</span><span class="lbl">${lblR}</span></div>
    ${rows.map(([n, k, body, v]) => `<div class="ch ${k ? "tap" : ""}" ${k ? `data-open="${k}"` : ""}><span class="ch-n">${n}</span>${S(300, 30, body, 'preserveAspectRatio="none"')}<span class="ch-v">${v}</span></div>`).join("")}
    <div class="taxis"><span></span>${S(300, 14, axis)}<span></span></div></div>`;
}
export function tile(key, m, label, value, unit, delta, viz, i) {
  return `<div class="card tile tap rise" style="--i:${i};--tint:${css(m.color)}" data-open="${key}"><div class="t-h"><span class="t-l"><i></i>${label}</span>${q(m.q)}</div>
    <div class="t-body"><div class="t-main"><div class="tv">${value}<small>${unit}</small></div><div class="td">${delta}</div></div><div class="t-viz">${viz}</div></div></div>`;
}
export const empty = (title, body, i = 2) => `<div class="card empty rise" style="--i:${i}"><b>${title}</b><p>${body}</p></div>`;
export const buildingLine = (have, need, what = "nights") => `<span class="muted">building your usual · ${Math.min(have, need)} of ${need} ${what}</span>`;
