// Today on one shared time axis (heart rate, steps, brisk/light minutes, moving hours) and the day's
// workouts with their tag prompts. Shown inside the Activity drill-down.
import { mean } from "./stats.js?v=20260924215242";
import { ampm, css, D, esc, glow, glowDef, hr12, montage, S, sc, smoothRuns, uid } from "./kit.js?v=20260924215242";

const DAYX = sc(6 * 60, 22 * 60, 0, 300);
const WTYPES = ["Strength", "Yard or housework", "Cycling", "Other"];
function axis() {
  const T = D.T;
  return [6, 9, 12, 15, 18, 21].filter((hh) => Math.abs(hh * 60 - T.now) > 75).map((hh) => `<text x="${DAYX(hh * 60)}" y="11" text-anchor="middle" class="axis">${hr12(hh)}</text>`).join("") + `<text x="${DAYX(T.now)}" y="11" text-anchor="middle" class="axis" style="fill:var(--ink)">now</text>`;
}
function futureMask(H) { const x0 = DAYX(D.T.now); return `<rect x="${x0.toFixed(1)}" y="0" width="${Math.max(0, 300 - x0).toFixed(1)}" height="${H}" fill="${css("--ink3")}" opacity=".06"/><line x1="${x0.toFixed(1)}" x2="${x0.toFixed(1)}" y1="0" y2="${H}" stroke="${css("--ink3")}" stroke-dasharray="2 2" opacity=".6"/>`; }
export function dayMontage(attr = "data-open") {
  const T = D.T, x = DAYX, H = 30, rows = [];
  const line = (pts, color, i) => { const id = uid("m"); return `<defs>${glowDef(id, 1.8)}</defs><path class="draw" style="--i:${i};--len:600" d="${smoothRuns(pts)}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" ${glow(id)}/>`; };
  const shade = T.sessions.map((s) => `<rect x="${x(s.a).toFixed(1)}" y="0" width="${(x(s.b) - x(s.a)).toFixed(1)}" height="${H}" fill="${css("--heart")}" opacity=".12" rx="3"/>`).join("");
  const vals = T.hr.filter((v) => v != null), yh = sc(Math.min(55, ...vals), Math.max(130, ...vals), H - 2, 2), hrPts = [];
  for (let k = 0; k < T.n; k += 5) { const w = T.hr.slice(k, k + 5).filter((v) => v != null); hrPts.push(w.length ? [x(T.wake + k + 2.5), yh(mean(w))] : null); }
  rows.push(["Heart", "hrday", futureMask(H) + shade + line(hrPts, css("--heart"), 1), T.hrNow ? `${Math.round(T.hrNow.bpm)} latest<small>${T.hrHi ? `high ${Math.round(T.hrHi)}` : ""}</small>` : "—"]);
  const bins = []; for (let k = 0; k < T.n; k += 10) bins.push([T.wake + k, T.stepsMin.slice(k, k + 10).reduce((a, b) => a + b, 0)]);
  const bmax = Math.max(...bins.map((b) => b[1]), 1);
  rows.push(["Steps", "steps", futureMask(H) + `<g class="fadein" style="--i:2">${bins.map(([t, v]) => (v ? `<rect x="${x(t).toFixed(1)}" y="${(H - 2 - (v / bmax) * (H - 4)).toFixed(1)}" width="${Math.max(1, x(t + 10) - x(t) - 0.6).toFixed(1)}" height="${((v / bmax) * (H - 4)).toFixed(1)}" rx="1" fill="${css("--steps")}"/>` : "")).join("")}</g>`, `${T.steps.toLocaleString()}<small>${Math.round((100 * T.steps) / D.goal)}% of goal</small>`]);
  rows.push(["Active", "mvpa", futureMask(H) + `<g class="fadein" style="--i:3">${T.brisk.map((b, k) => (b ? `<rect x="${x(T.wake + k).toFixed(1)}" y="6" width="1.2" height="18" fill="${css("--act")}"/>` : T.lightMin[k] ? `<rect x="${x(T.wake + k).toFixed(1)}" y="12" width="1.2" height="12" fill="${css("--act2")}" opacity=".8"/>` : "")).join("")}</g>`, `${T.mvpa} brisk<small>${T.light} light</small>`]);
  const cells = []; for (let hh = 7; hh < 22; hh++) { const done = hh < T.nowH, on = done && T.hourly[hh] >= 250, curH = hh === T.nowH; cells.push(`<rect x="${(x(hh * 60) + 1).toFixed(1)}" y="7" width="${(x(hh * 60 + 60) - x(hh * 60) - 2).toFixed(1)}" height="16" rx="4" fill="${on ? css("--breath") : "none"}" stroke="${on ? "none" : css("--ink3")}" stroke-opacity="${done || curH ? 0.55 : 0.2}" ${curH ? `stroke-dasharray="2 2"` : ""}/>`); }
  rows.push(["Moving", "moveH", `<g class="fadein" style="--i:4">${cells.join("")}</g>`, `${T.moveH} of ${Math.max(0, T.nowH - 7)} h<small>250+ steps</small>`]);
  return montage(rows, axis(), `${ampm(T.wake)} – now`, T.dataEnd != null && T.now - T.dataEnd > 20 ? `synced to ${ampm(T.dataEnd)}` : "tap a row", attr);
}
export function workoutsList() {
  const T = D.T;
  if (!T.sessions.length) return `<p class="note" style="margin:0">No workouts yet today. Sessions of 10+ minutes at ${Math.round(T.hrr40)}+ bpm show up here automatically.</p>`;
  const maxMin = Math.max(...T.sessions.map((z) => z.min));
  return `<div class="wk-list">${T.sessions.map((s) => {
    const kind = s.kind === "run" ? "Run" : s.kind === "walk" ? "Brisk walk" : s.tag?.type ?? "Untagged session", x = sc(0, maxMin, 0, 120);
    const load = s.tag?.rpe ? `load ${s.tag.rpe * s.min}` : `TRIMP ${Math.round(s.trimp)}`;
    return `<div class="wk"><div class="wk-t"><b>${esc(kind)}</b><span>${ampm(s.a)} · ${s.min} min${s.avg ? ` · avg ${Math.round(s.avg)} bpm` : ""}${s.spm >= 60 ? ` · ${Math.round(s.spm)} steps/min` : ""}${s.hrr60 != null && s.hrr60 > 0 ? ` · 1-min drop ${Math.round(s.hrr60)} bpm` : ""}</span></div>
      ${S(120, 12, `<rect x="0" y="2" width="${x(s.zone[0]).toFixed(1)}" height="8" rx="4" fill="${css("--watch")}" opacity=".75"/><rect x="${x(s.zone[0]).toFixed(1)}" y="2" width="${Math.max(0, x(s.zone[0] + s.zone[1]) - x(s.zone[0])).toFixed(1)}" height="8" rx="4" fill="${css("--heart")}"/>`)}
      <em>${load}</em></div>`;
  }).join("")}<p class="note">Bars: minutes at moderate (${Math.round(T.hrr40)}+ bpm, amber) and vigorous (${Math.round(T.hrr60)}+ bpm, red) effort, from your heart-rate reserve. Tagged sessions use effort × minutes as load (Foster 2001).</p></div>`;
}

/** Tag prompts for detected sessions without steps (what was it? then how hard?). */
export function workoutPrompts() {
  let out = "";
  for (const s of D.T.sessions) {
    if (s.kind) continue;
    if (!s.tag) out += `<div class="card prompt rise" style="--i:2" data-wprompt="${esc(s.start)}" data-wmin="${s.min}">
      <p>Your heart rate was up for <b>${s.min} min</b> from ${ampm(s.a)}, with almost no steps. That looks like exercise the step counter can't see. What was it?</p>
      <div class="chips">${WTYPES.map((k) => `<button class="chip" data-wkind="${k}">${k}</button>`).join("")}</div></div>`;
    else if (s.tag.rpe == null) out += `<div class="card prompt rise" style="--i:2" data-wprompt="${esc(s.start)}" data-wmin="${s.min}"><p>How hard was the ${esc(s.tag.type).toLowerCase()} session?</p>
      <div class="chips">${[["Easy", 3], ["Moderate", 5], ["Hard", 7], ["Very hard", 9]].map(([l, v]) => `<button class="chip" data-wrpe="${v}">${l}</button>`).join("")}</div></div>`;
  }
  return out;
}
