// Today: one hero (activity, whose drill-down holds the day's timeline and workouts), the questions Pulse
// has (only when something triggered them), and the latest reading of every sensor. Charts live in the
// drill-downs.
import { tempC } from "../core/units.js?v=20260924215242";
import { median } from "./stats.js?v=20260924215242";
import { M, paceFrac } from "./drill.js?v=20260924215242";
import { workoutPrompts } from "./daymon.js?v=20260924215242";
import { ampm, cap1, css, D, empty, FULLDAY, gauge, header, MON, mini, relMin, ringSvg, S, sc, sign, smooth, stateOf, syncChip, tDelta, tUnit, vital } from "./kit.js?v=20260924215242";

const usualDays = (k, min = 5) => { const v = D.hist.slice(-29, -1).map((h) => h[k]).filter((x) => x != null); return v.length >= min ? median(v) : null; };
const agoMin = (t) => (Date.now() - new Date(t.replace(" ", "T")).getTime()) / 60e3;

function headline() {
  const T = D.T, frac = paceFrac(), usualDay = usualDays("steps", 3), usualNow = frac != null && usualDay != null ? usualDay * frac : null;
  const ahead = usualNow != null ? T.steps >= usualNow : null;
  const h1 = T.steps >= D.goal ? "Step goal done." : ahead == null ? (T.steps ? `${(D.goal - T.steps).toLocaleString()} steps to your goal.` : "Nothing recorded yet today.") : ahead ? "A strong day so far." : "A slower day than usual so far.";
  const asOf = T.dataEnd != null && T.now - T.dataEnd > 20 ? `as of ${ampm(T.dataEnd)} (last sync)` : `by ${ampm(T.now)}`;
  const vs = usualNow != null ? `, against about ${usualNow < 1000 ? Math.round(usualNow) : (Math.round(usualNow / 100) * 100).toLocaleString()} on a usual day` : "";
  return [h1, `${T.steps.toLocaleString()} steps ${asOf}${vs}.`];
}
function hero() {
  const T = D.T, p = Math.round((100 * T.steps) / D.goal), frac = paceFrac(), ud = usualDays("steps", 3), ghost = frac != null && ud != null ? frac * 100 * (ud / D.goal) : null, rec = D.latest.rec, [h1, why] = headline();
  const ahead = ghost != null ? p >= ghost : null;
  return `<div class="card hero rise" style="--i:1">${gauge({ value: Math.min(100, p), count: p, label: "Activity", big: `${p}<small>%</small>`, verdict: ahead == null ? `${T.steps.toLocaleString()} steps` : ahead ? "Ahead of pace" : "Behind pace", vcolor: css(ahead === false ? "--watch" : "--act"), cap: `${T.steps.toLocaleString()} of ${D.goal.toLocaleString()} steps · tap for your day`, color: css("--act"), color2: css("--act2"), open: "activity", tick: ghost != null ? Math.min(100, ghost) : null })}
    <div class="minis">
      ${mini("mvpa", ringSvg(D.week / 150, css("--act")), "Brisk", `${T.mvpa}<small> min</small>`, `${D.week} of 150 this week`, `${T.light} min light walking`)}
      ${mini("recovery", ringSvg(rec != null ? rec / 100 : D.latest.recNights / D.latest.recNeed, rec != null ? css(`--${stateOf(rec)}`) : css("--ink3")), "Recovery", rec != null ? `${rec}` : "—", rec != null ? (rec >= 67 ? "recovered" : rec >= 50 ? "steady" : "take it easy") : `baseline ${Math.min(D.latest.recNights + 1, D.latest.recNeed)}/${D.latest.recNeed}`, "from last night")}
    </div>
    <p class="summary">${h1}<span class="why">${why}</span></p></div>`;
}
function prompts() {
  let out = "";
  const h = D.latest;
  if (h.hasNight && (h.trig.length || h.checkIn) && !h.asked) out += `<button class="card inbox rise" style="--i:2" data-gonight><i></i><span><b>One question about last night</b><span>${h.trig.length ? `${cap1(h.trig[0].txt)}.` : "A quick check-in."}</span></span><span class="chev">›</span></button>`;
  out += workoutPrompts();
  return out ? `<div class="stack first">${out}</div>` : "";
}
/** Today's readings as a tiny dot line across the day (6 AM–10 PM). */
function sparkDay(list, color, conv = (v) => v) {
  if (!list?.length) return "";
  const W0 = 150, H = 26, x = sc(6 * 60, 22 * 60, 2, W0 - 2), vals = list.map((r) => conv(r.v)), lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.25 || 1, y = sc(lo - pad, hi + pad, H - 3, 3);
  const pts = list.map((r) => [x(r.m), y(conv(r.v))]);
  return S(W0, H, `${pts.length >= 2 ? `<path d="${smooth(pts, 0.12)}" fill="none" stroke="${color}" stroke-width="1.4" opacity=".55"/>` : ""}${pts.map((p2, i) => `<circle cx="${p2[0].toFixed(1)}" cy="${p2[1].toFixed(1)}" r="${i === pts.length - 1 ? 3 : 1.8}" fill="${color}"/>`).join("")}`, 'preserveAspectRatio="none"');
}
function nowGrid() {
  const T = D.T, L = T.latest ?? {}, tiles = [];
  if (T.hrNow) {
    const hrList = []; for (let k = 0; k < T.n; k += 10) { const w = T.hr.slice(k, k + 10).filter((v) => v != null); if (w.length) hrList.push({ m: T.wake + k + 5, v: w.reduce((a, b) => a + b, 0) / w.length }); }
    tiles.push(vital("hrday", M.hrday, "Heart rate", Math.round(T.hrNow.bpm), "bpm", `${relMin(agoMin(T.hrNow.t))}${T.dayHr != null ? ` · avg ${Math.round(T.dayHr)} today` : ""}`, sparkDay(hrList, css("--heart"))));
  }
  if (L.spo2) tiles.push(vital("spo2d", M.spo2d, "Oxygen", L.spo2.v, "%", `${relMin(agoMin(L.spo2.t))} · low ${Math.min(...T.vit.spo2.map((r) => r.v))} today`, sparkDay(T.vit.spo2, css("--spo2"))));
  if (L.temp) tiles.push(vital("tempd", M.tempd, "Skin temp", tempC(L.temp.v).toFixed(1), tUnit(), T.usualTempNow != null ? `${sign(tDelta(L.temp.v - T.usualTempNow))}° vs usual for ${ampm(+L.temp.t.slice(11, 13) * 60).replace(":00", "")}` : relMin(agoMin(L.temp.t)), sparkDay(T.vit.temp, css("--temp"), tempC)));
  if (L.hrv) tiles.push(vital("hrvd", M.hrvd, "HRV", Math.round(L.hrv.v), "ms", `band reading · ${relMin(agoMin(L.hrv.t))}`, sparkDay(T.vit.hrv, css("--hrv"))));
  if (L.br) tiles.push(vital("breathd", M.breathd, "Breathing", L.br.v.toFixed(1), "/min", relMin(agoMin(L.br.t)), sparkDay(T.vit.br, css("--breath"))));
  if (L.stress) tiles.push(vital("stressd", M.stressd, "Stress", Math.round(L.stress.v), "", `band's score · ${relMin(agoMin(L.stress.t))}`, sparkDay(T.vit.stress, css("--watch"))));
  if (!tiles.length) return empty("No readings yet today", "Readings arrive every 10 minutes while you wear the band; sync to bring them in.", 4);
  return `<div class="vitals">${tiles.join("")}</div>`;
}

export function today(ctx) {
  const d = D.latest.d;
  const head = header(`${FULLDAY[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`, "Today", syncChip(ctx));
  if (!D.T?.hasData && !D.hist.some((h) => h.hasNight || h.steps)) {
    return `${head}${empty("No readings yet", ctx.band?.connected ? "Your band is connected. Readings appear after it records a little data; wear it and sync again in a while." : "Tap Connect above to pair your band. After it's been on your wrist for a bit, sync to see your day here.")}`;
  }
  return `${head}
    ${prompts()}
    ${hero()}
    <div class="sec rise" style="--i:3"><h2>Right now</h2><span class="lbl">latest readings</span></div>
    ${nowGrid()}
    <p class="note foot">Tap any reading for today's detail and its history. Your day's timeline and workouts are in Activity.</p>`;
}
