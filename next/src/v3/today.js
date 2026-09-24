// Today: the day so far. Activity gauge, heart now and last night's recovery, the day's timeline, activity
// tiles, and workouts detected from heart rate (with a prompt when one can't be classified from steps).
import { mean, median } from "./stats.js?v=20260924180231";
import { M, paceFrac } from "./drill.js?v=20260924180231";
import { ampm, cap1, css, D, empty, esc, FULLDAY, glow, glowDef, gauge, header, hr12, MON, mini, montage, relMin, ringSvg, S, sc, short, smoothRuns, st, stateOf, syncChip, tile, uid, DAYS } from "./kit.js?v=20260924180231";

const DAYX = sc(6 * 60, 22 * 60, 0, 300);
const WTYPES = ["Strength", "Yard or housework", "Cycling", "Other"];

const usualDays = (k, min = 5) => { const v = D.hist.slice(-29, -1).map((h) => h[k]).filter((x) => x != null); return v.length >= min ? median(v) : null; };
function headline() {
  const T = D.T, frac = paceFrac(), usualDay = usualDays("steps", 3), usualNow = frac != null && usualDay != null ? usualDay * frac : null;
  const ahead = usualNow != null ? T.steps >= usualNow : null;
  const h1 = T.steps >= D.goal ? "Step goal done." : ahead == null ? (T.steps ? `${(D.goal - T.steps).toLocaleString()} steps to your goal.` : "Nothing recorded yet today.") : ahead ? "A strong day so far." : "A slower day than usual so far.";
  const wk = D.week >= 150 ? `${D.week} active minutes over the last 7 days, past the 150 guideline` : `${D.week} of 150 active minutes over the last 7 days`;
  const vs = usualNow != null ? `, against about ${usualNow < 1000 ? Math.round(usualNow) : (Math.round(usualNow / 100) * 100).toLocaleString()} on a usual day` : "";
  const asOf = T.dataEnd != null && T.now - T.dataEnd > 20 ? `as of ${ampm(T.dataEnd)} (last sync)` : `by ${ampm(T.now)}`;
  return [h1, `${T.steps.toLocaleString()} steps ${asOf}${vs}. ${wk}.`];
}
function hero(ctx) {
  const T = D.T, p = Math.round((100 * T.steps) / D.goal), frac = paceFrac(), ud = usualDays("steps", 3), ghost = frac != null && ud != null ? frac * 100 * (ud / D.goal) : null, rec = D.latest.rec, [h1, why] = headline();
  const hrNow = T.hrNow, ago = hrNow ? (Date.now() - new Date(hrNow.t.replace(" ", "T")).getTime()) / 60e3 : null;
  const heartSvg = S(74, 74, `<circle cx="37" cy="37" r="29" fill="none" stroke="${css("--track")}" stroke-width="7"/>${hrNow ? `<circle class="beat" style="--beat-s:${(60 / hrNow.bpm).toFixed(2)}s" cx="37" cy="37" r="11" fill="${css("--heart")}"/>` : ""}`);
  const recCol = css(`--${stateOf(rec)}`);
  const ahead = ghost != null ? p >= ghost : null;
  return `<div class="card hero rise" style="--i:1">${gauge({ value: Math.min(100, p), count: p, label: "Activity", big: `${p}<small>%</small>`, verdict: ahead == null ? `${T.steps.toLocaleString()} steps` : ahead ? "Ahead of pace" : "Behind pace", vcolor: css(ahead === false ? "--watch" : "--act"), cap: `${T.steps.toLocaleString()} of ${D.goal.toLocaleString()} steps${ghost != null ? " · tick = usual pace" : ""}`, color: css("--act"), color2: css("--act2"), open: "steps", tick: ghost != null ? Math.min(100, ghost) : null })}
    <div class="minis">
      ${mini("hrday", heartSvg, "Heart", hrNow ? `${Math.round(hrNow.bpm)}<small> bpm</small>` : "—", hrNow ? relMin(ago) : "no reading yet", T.dayHr != null ? `avg ${Math.round(T.dayHr)} today` : "")}
      ${mini("recovery", ringSvg(rec != null ? rec / 100 : D.latest.recNights / D.latest.recNeed, rec != null ? recCol : css("--ink3")), "Recovery", rec != null ? `${rec}` : "—", rec != null ? (rec >= 67 ? "recovered" : rec >= 50 ? "steady" : "take it easy") : `baseline ${Math.min(D.latest.recNights + 1, D.latest.recNeed)}/${D.latest.recNeed}`, "last night")}
    </div>
    <p class="summary">${h1}<span class="why">${why}</span></p></div>`;
}
function prompts() {
  let out = "";
  const h = D.latest;
  if (h.hasNight && (h.trig.length || h.checkIn) && !h.asked) out += `<button class="card inbox rise" style="--i:2" data-gonight><i></i><span><b>One question about last night</b><span>${h.trig.length ? `${cap1(h.trig[0].txt)}.` : "A quick check-in."}</span></span><span class="chev">›</span></button>`;
  for (const s of D.T.sessions) {
    if (s.kind) continue;
    if (!s.tag) out += `<div class="card prompt rise" style="--i:2" data-wprompt="${esc(s.start)}" data-wmin="${s.min}">
      <p>Your heart rate was up for <b>${s.min} min</b> from ${ampm(s.a)}, with almost no steps. That looks like exercise the step counter can't see. What was it?</p>
      <div class="chips">${WTYPES.map((k) => `<button class="chip" data-wkind="${k}">${k}</button>`).join("")}</div></div>`;
    else if (s.tag.rpe == null) out += `<div class="card prompt rise" style="--i:2" data-wprompt="${esc(s.start)}" data-wmin="${s.min}"><p>How hard was the ${esc(s.tag.type).toLowerCase()} session?</p>
      <div class="chips">${[["Easy", 3], ["Moderate", 5], ["Hard", 7], ["Very hard", 9]].map(([l, v]) => `<button class="chip" data-wrpe="${v}">${l}</button>`).join("")}</div></div>`;
  }
  return out ? `<div class="stack">${out}</div>` : "";
}
function axis() {
  const T = D.T;
  return [6, 9, 12, 15, 18, 21].filter((hh) => Math.abs(hh * 60 - T.now) > 40).map((hh) => `<text x="${DAYX(hh * 60)}" y="11" text-anchor="middle" class="axis">${hr12(hh)}</text>`).join("") + `<text x="${DAYX(T.now)}" y="11" text-anchor="middle" class="axis" style="fill:var(--ink)">now</text>`;
}
function futureMask(H) { const x0 = DAYX(D.T.now); return `<rect x="${x0.toFixed(1)}" y="0" width="${Math.max(0, 300 - x0).toFixed(1)}" height="${H}" fill="${css("--ink3")}" opacity=".06"/><line x1="${x0.toFixed(1)}" x2="${x0.toFixed(1)}" y1="0" y2="${H}" stroke="${css("--ink3")}" stroke-dasharray="2 2" opacity=".6"/>`; }
function dayMontage() {
  const T = D.T, x = DAYX, H = 30, rows = [];
  const line = (pts, color, i) => { const id = uid("m"); return `<defs>${glowDef(id, 1.8)}</defs><path class="draw" style="--i:${i};--len:600" d="${smoothRuns(pts)}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" ${glow(id)}/>`; };
  const shade = T.sessions.map((s) => `<rect x="${x(s.a).toFixed(1)}" y="0" width="${(x(s.b) - x(s.a)).toFixed(1)}" height="${H}" fill="${css("--heart")}" opacity=".12" rx="3"/>`).join("");
  const vals = T.hr.filter((v) => v != null), yh = sc(Math.min(55, ...vals), Math.max(130, ...vals), H - 2, 2), hrPts = [];
  for (let k = 0; k < T.n; k += 5) { const w = T.hr.slice(k, k + 5).filter((v) => v != null); hrPts.push(w.length ? [x(T.wake + k + 2.5), yh(mean(w))] : null); }
  rows.push(["Heart", "hrday", futureMask(H) + shade + line(hrPts, css("--heart"), 1), T.hrNow ? `${Math.round(T.hrNow.bpm)} latest<small>${T.hrHi ? `high ${Math.round(T.hrHi)}` : ""}</small>` : "—"]);
  const bins = []; for (let k = 0; k < T.n; k += 10) bins.push([T.wake + k, T.stepsMin.slice(k, k + 10).reduce((a, b) => a + b, 0)]);
  const bmax = Math.max(...bins.map((b) => b[1]), 1);
  rows.push(["Steps", "steps", futureMask(H) + `<g class="fadein" style="--i:2">${bins.map(([t, v]) => (v ? `<rect x="${x(t).toFixed(1)}" y="${(H - 2 - (v / bmax) * (H - 4)).toFixed(1)}" width="${Math.max(1, x(t + 10) - x(t) - 0.6).toFixed(1)}" height="${((v / bmax) * (H - 4)).toFixed(1)}" rx="1" fill="${css("--steps")}"/>` : "")).join("")}</g>`, `${T.steps.toLocaleString()}<small>${Math.round((100 * T.steps) / D.goal)}% of goal</small>`]);
  rows.push(["Active", "mvpa", futureMask(H) + `<g class="fadein" style="--i:3">${T.brisk.map((b, k) => (b ? `<rect x="${x(T.wake + k).toFixed(1)}" y="8" width="1.2" height="14" fill="${css("--act")}"/>` : "")).join("")}</g>`, `${T.mvpa} min<small>${D.week} in 7 days</small>`]);
  const cells = []; for (let hh = 7; hh < 22; hh++) { const done = hh < T.nowH, on = done && T.hourly[hh] >= 250, curH = hh === T.nowH; cells.push(`<rect x="${(x(hh * 60) + 1).toFixed(1)}" y="7" width="${(x(hh * 60 + 60) - x(hh * 60) - 2).toFixed(1)}" height="16" rx="4" fill="${on ? css("--breath") : "none"}" stroke="${on ? "none" : css("--ink3")}" stroke-opacity="${done || curH ? 0.55 : 0.2}" ${curH ? `stroke-dasharray="2 2"` : ""}/>`); }
  rows.push(["Moving", "moveH", `<g class="fadein" style="--i:4">${cells.join("")}</g>`, `${T.moveH} of ${Math.max(0, T.nowH - 7)} h<small>250+ steps</small>`]);
  return montage(rows, axis(), `${ampm(T.wake)} – now`, T.dataEnd != null && T.now - T.dataEnd > 20 ? `synced to ${ampm(T.dataEnd)}` : "tap a row");
}
function vHrDay() {
  const T = D.T, W0 = 150, H = 50, x = sc(T.wake, T.now, 4, W0 - 8), vals = T.hr.filter((v) => v != null), y = sc(Math.min(55, ...vals), Math.max(130, ...vals), H - 4, 4), pts = [];
  for (let k = 0; k < T.n; k += 10) { const w = T.hr.slice(k, k + 10).filter((v) => v != null); pts.push(w.length ? [x(T.wake + k + 5), y(mean(w))] : null); }
  const lastK = T.hr.map((v, k) => (v != null ? k : -1)).filter((k) => k >= 0).pop();
  return S(W0, H, `<line x1="4" x2="${W0 - 4}" y1="${y(T.hrr40)}" y2="${y(T.hrr40)}" stroke="${css("--heart")}" stroke-opacity=".35" stroke-dasharray="3 3"/><path class="draw" style="--i:3;--len:300" d="${smoothRuns(pts)}" fill="none" stroke="${css("--heart")}" stroke-width="1.6"/>
    ${lastK != null ? `<circle class="beat" style="--beat-s:${(60 / T.hr[lastK]).toFixed(2)}s" cx="${x(T.wake + lastK)}" cy="${y(T.hr[lastK])}" r="4.5" fill="${css("--heart")}" stroke="${css("--bg")}" stroke-width="2"/>` : ""}`);
}
function vSteps() {
  const W0 = 150, H = 50, bw = W0 / 24, typ = D.typical ?? new Array(24).fill(0), max = Math.max(...D.T.hourly, ...typ, 1);
  const bar = (v, i, fill, op) => (v ? `<rect x="${(i * bw + 0.9).toFixed(1)}" y="${(H - 3 - (v / max) * (H - 8)).toFixed(1)}" width="${(bw - 1.8).toFixed(1)}" height="${((v / max) * (H - 8) + 3).toFixed(1)}" rx="1.5" fill="${fill}" opacity="${op}"/>` : "");
  return S(W0, H, typ.map((v, i) => bar(v, i, css("--ink3"), 0.2)).join("") + D.T.hourly.map((v, i) => bar(v, i, css("--steps"), 1)).join(""));
}
function vMvpa() {
  const W0 = 150, H = 50, days = [...D.hist.slice(-7, -1).map((h) => [h.d, h.mvpa]), [D.latest.d, D.T.mvpa]];
  while (days.length < 7) days.unshift([new Date(days[0][0].getTime() - 864e5), null]);
  const max = Math.max(45, ...days.map((d) => d[1] ?? 0)), bw = W0 / 7, y = sc(0, max, H - 12, 4);
  return S(W0, H, `<line x1="0" x2="${W0}" y1="${y(150 / 7)}" y2="${y(150 / 7)}" stroke="${css("--ink3")}" stroke-dasharray="3 3" opacity=".7"/>` + days.map(([d, v], i) => `${v != null ? `<rect x="${(i * bw + 3).toFixed(1)}" y="${y(v).toFixed(1)}" width="${(bw - 6).toFixed(1)}" height="${Math.max(1.5, y(0) - y(v)).toFixed(1)}" rx="3" fill="${css("--act")}" opacity="${i === 6 ? 1 : 0.5}"/>` : ""}<text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 1}" text-anchor="middle" class="axis" style="font-size:8.5px">${DAYS[d.getDay()][0]}</text>`).join(""));
}
function vMoveH() {
  const T = D.T, W0 = 150, H = 50, cw = W0 / 15, cells = [];
  for (let hh = 7; hh < 22; hh++) { const i = hh - 7, done = hh < T.nowH, on = done && T.hourly[hh] >= 250, curH = hh === T.nowH; cells.push(`<rect x="${(i * cw + 1).toFixed(1)}" y="${i % 2 ? 22 : 12}" width="${(cw - 2).toFixed(1)}" height="16" rx="3" fill="${on ? css("--breath") : "none"}" stroke="${on ? "none" : css("--ink3")}" stroke-opacity="${done || curH ? 0.6 : 0.2}" ${curH ? `stroke-dasharray="2 2"` : ""}/>`); }
  return S(W0, H, cells.join("") + `<text x="0" y="${H - 1}" class="axis" style="font-size:8.5px">7a</text><text x="${W0}" y="${H - 1}" text-anchor="end" class="axis" style="font-size:8.5px">10p</text>`);
}
function tiles() {
  const T = D.T, u = usualDays("dayHr"), frac = paceFrac(), sd0 = usualDays("steps", 3), su = frac != null && sd0 != null ? sd0 * frac : null;
  return `<div class="tiles">
    ${tile("hrday", M.hrday, "Heart rate", T.hrNow ? Math.round(T.hrNow.bpm) : "—", "bpm latest", T.dayHr != null ? `daytime avg ${Math.round(T.dayHr)}${u != null ? ` · usual ${Math.round(u)}` : ""}` : "daytime average after more readings", vHrDay(), 5)}
    ${tile("steps", M.steps, "Steps", T.steps.toLocaleString(), "", su != null ? `${T.steps >= su ? `<span class="up">ahead</span>` : `<span class="warn">behind</span>`} of usual by now` : `goal ${D.goal.toLocaleString()}`, vSteps(), 6)}
    ${tile("mvpa", M.mvpa, "Active minutes", T.mvpa, "min", D.week >= 150 ? `<span class="up">${D.week}</span> in 7 days · goal 150` : `${D.week} of 150 in 7 days`, vMvpa(), 7)}
    ${tile("moveH", M.moveH, "Moving hours", T.moveH, `of ${Math.max(0, T.nowH - 7)}`, T.stillNow >= 60 ? `<span class="warn">still for ${short(T.stillNow)}</span>` : `longest still ${short(T.longestStill)}`, vMoveH(), 8)}
  </div>`;
}
function workouts() {
  const T = D.T;
  if (!T.sessions.length) return `<div class="card rise" style="--i:9"><p class="note" style="margin:0">No workouts yet today. Sessions of 10+ minutes at ${Math.round(T.hrr40)}+ bpm show up here automatically.</p></div>`;
  const maxMin = Math.max(...T.sessions.map((z) => z.min));
  return `<div class="card rise wk-list" style="--i:9">${T.sessions.map((s) => {
    const kind = s.kind === "run" ? "Run" : s.kind === "walk" ? "Brisk walk" : s.tag?.type ?? "Untagged session", x = sc(0, maxMin, 0, 120);
    const load = s.tag?.rpe ? `load ${s.tag.rpe * s.min}` : `TRIMP ${Math.round(s.trimp)}`;
    return `<div class="wk"><div class="wk-t"><b>${esc(kind)}</b><span>${ampm(s.a)} · ${s.min} min${s.avg ? ` · avg ${Math.round(s.avg)} bpm` : ""}${s.spm >= 60 ? ` · ${Math.round(s.spm)} steps/min` : ""}${s.hrr60 != null && s.hrr60 > 0 ? ` · 1-min drop ${Math.round(s.hrr60)} bpm` : ""}</span></div>
      ${S(120, 12, `<rect x="0" y="2" width="${x(s.zone[0]).toFixed(1)}" height="8" rx="4" fill="${css("--watch")}" opacity=".75"/><rect x="${x(s.zone[0]).toFixed(1)}" y="2" width="${Math.max(0, x(s.zone[0] + s.zone[1]) - x(s.zone[0])).toFixed(1)}" height="8" rx="4" fill="${css("--heart")}"/>`)}
      <em>${load}</em></div>`;
  }).join("")}<p class="note">Bars: minutes at moderate (${Math.round(T.hrr40)}+ bpm, amber) and vigorous (${Math.round(T.hrr60)}+ bpm, red) effort, from your heart-rate reserve. Tagged sessions use effort × minutes as load (Foster 2001).</p></div>`;
}

export function today(ctx) {
  const d = D.latest.d;
  const head = header(`${FULLDAY[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`, "Today", syncChip(ctx));
  if (!D.T?.hasData && !D.hist.some((h) => h.hasNight || h.steps)) {
    return `${head}${empty("No readings yet", ctx.band?.connected ? "Your band is connected. Readings appear after it records a little data; wear it and sync again in a while." : "Tap Connect above to pair your band. After it's been on your wrist for a bit, sync to see your day here.")}`;
  }
  return `${head}
    ${hero(ctx)}
    ${prompts()}
    <div class="sec rise" style="--i:4"><h2>Across the day</h2><span class="lbl">4 channels</span></div>
    ${dayMontage()}
    <div class="sec rise" style="--i:5"><h2>Activity</h2><span class="lbl">${D.typical ? "vs your usual by now" : "today"}</span></div>
    ${tiles()}
    <div class="sec rise" style="--i:9"><h2>Workouts</h2><span class="lbl">detected from heart rate</span></div>
    ${workouts()}`;
}
export { st };
