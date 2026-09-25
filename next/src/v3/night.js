// Night: last night by default, any earlier night from the strip. Recovery gauge, sleep and deep+REM minis,
// a plain-language summary, the trigger-based question, the channels across the night, and vitals tiles.
import { tempC } from "../core/units.js?v=20260924214250";
import { MIN_USUAL, median, sd } from "./stats.js?v=20260924214250";
import { expOf, M } from "./drill.js?v=20260924214250";
import { ampm, arcPath, cap1, clock, css, D, DAYS, empty, esc, glow, glowDef, gauge, header, hm, isLatest, mini, montage, nightDates, nightName, S, sc, short, sign, smooth, smoothRuns, stageColor, stateOf, st, syncChip, tDelta, thatNight, tile, tUnit, uid, usualOf } from "./kit.js?v=20260924214250";

const ASK = [{ key: "alcohol", label: "Alcohol" }, { key: "caffeine", label: "Late caffeine" }, { key: "stress", label: "Stress" }, { key: "sick", label: "Feeling ill" }];

function strip() {
  const idx = D.nights.slice(-21);
  return `<div class="nstrip rise" style="--i:0" id="nstrip">${idx.map((i) => { const h = D.hist[i]; return `<button class="nd ${i === D.i ? "on" : ""}" data-night="${i}" aria-label="${nightName(h)}"><span>${DAYS[h.d.getDay()][0]}</span><b>${h.d.getDate()}</b><i style="background:var(--${h.rec == null ? "ink3" : stateOf(h.rec)})"></i></button>`; }).join("")}</div>`;
}
function sleepClock() {
  const h = D.last, W0 = 74, c = 37, r = 29, toA = (min) => ((min % 720) / 720) * Math.PI * 2 - Math.PI / 2;
  let body = "";
  if (h.hasSleep) { let a0 = toA(h.onset), a1 = toA(h.wake); if (a1 <= a0) a1 += Math.PI * 2; const id = uid("s"); body = `<defs>${glowDef(id, 2.5)}</defs><path class="draw" style="--len:${(r * (a1 - a0)).toFixed(0)}" d="${arcPath(c, c, r, a0, Math.min(a1, a0 + Math.PI * 1.999))}" fill="none" stroke="${css("--sleep")}" stroke-width="7" stroke-linecap="round" ${glow(id)}/>`; }
  const ticks = [0, 3, 6, 9].map((k) => { const a = (k / 12) * Math.PI * 2 - Math.PI / 2; return `<line x1="${c + (r - 11) * Math.cos(a)}" y1="${c + (r - 11) * Math.sin(a)}" x2="${c + (r - 7) * Math.cos(a)}" y2="${c + (r - 7) * Math.sin(a)}" stroke="${css("--ink3")}" stroke-width="1.5" stroke-linecap="round"/>`; }).join("");
  return S(W0, W0, `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${css("--track")}" stroke-width="7"/>${ticks}${body}<text x="${c}" y="${c - r + 17}" text-anchor="middle" class="axis" style="font-size:8.5px">12</text><text x="${c}" y="${c + r - 11}" text-anchor="middle" class="axis" style="font-size:8.5px">6</text>`);
}
function stagesDonut() {
  const c = 37, r = 29, len = 2 * Math.PI * r, h = D.last, tot = (h.deep ?? 0) + (h.rem ?? 0) + (h.light ?? 0);
  if (!tot) return S(74, 74, `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${css("--track")}" stroke-width="7"/>`);
  let off = 0;
  const segs = [[1, h.deep], [3, h.rem], [2, h.light]].map(([s, v]) => { const l = (v / tot) * len, g = 2.5; const out = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${stageColor(s)}" stroke-width="7" transform="rotate(-90 ${c} ${c})" stroke-dasharray="${Math.max(0, l - g).toFixed(1)} ${(len - l + g).toFixed(1)}" stroke-dashoffset="${(-off).toFixed(1)}" class="fadein" style="--i:${s}"/>`; off += l; return out; }).join("");
  return S(74, 74, `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${css("--track")}" stroke-width="7"/>${segs}`);
}
function headline() {
  const h = D.last, e = expOf("hrv"), us = usualOf("sleepH");
  if (!h.hasSleep) return [h.rhr != null ? "No sleep record, but the band caught your overnight heart rate." : "No data for this night.", h.rhr != null ? `Resting heart rate ${h.rhr.toFixed(0)} bpm between midnight and 6 AM.` : ""];
  const dMin = us != null ? Math.round((h.sleepH - us) * 60) : null, len = dMin == null ? (h.sleepH >= 7 ? "full" : h.sleepH >= 6 ? "slightly short" : "short") : dMin >= -15 ? "full" : dMin >= -50 ? "slightly short" : "short";
  const restless = (h.waso ?? 0) >= 45;
  const h1 = h.rec == null ? `${cap1(len === "full" ? "a full" : `a ${len}`)} night: ${hm(h.sleepH)} asleep.` : h.rec >= 67 ? `Recovered, after a ${len} night.` : h.rec >= 50 ? `Steady, after a ${len} night.` : `A ${len}${restless ? ", unsettled" : ""} night. Your body is working harder.`;
  const f = [], ur = usualOf("rhr");
  if (dMin != null) f.push([Math.abs(dMin) / 35, `sleep ran ${Math.abs(dMin)} min ${dMin >= 0 ? "over" : "under"} your usual`]);
  if (ur != null && h.rhr != null) { const dR = h.rhr - ur; if (Math.abs(dR) >= 1.5) f.push([Math.abs(dR) / 1.5, `resting HR ${dR > 0 ? "ran" : "came in"} ${Math.abs(dR).toFixed(0)} bpm ${dR > 0 ? "over" : "under"} your usual`]); else f.push([0.5, "resting HR was right at your usual"]); }
  if (e && h.hrv != null) { const inside = h.hrv >= e.lo && h.hrv <= e.hi; f.push([inside ? 0.9 : 2.2, inside ? `HRV landed inside what that much sleep predicts` : `HRV came in ${h.hrv < e.lo ? "below" : "above"} what ${hm(h.sleepH)} of sleep predicts`]); }
  if (h.tdev != null && h.tdev >= 0.2) f.push([1.6, `skin temperature ran warm`]);
  const ub = usualOf("br"); if (ub != null && h.br != null && h.br - ub >= 1) f.push([1.4, `breathing was faster than usual`]);
  if (!f.length) {
    const bits = [h.rhr != null && `resting heart rate ${h.rhr.toFixed(0)} bpm`, h.hrv != null && `overnight HRV ${h.hrv.toFixed(0)} ms`, h.br != null && `breathing ${h.br.toFixed(1)}/min`].filter(Boolean);
    const have = D.H.slice(0, -1).filter((z) => z.hasNight).length;
    return [h1, `${cap1(bits.join(", "))}${bits.length ? ". " : ""}Pulse starts comparing nights with your usual after ${MIN_USUAL} nights (${Math.max(1, MIN_USUAL - have)} to go).`];
  }
  const top = f.sort((a, b) => b[0] - a[0]).slice(0, 2).map((z) => z[1]);
  return [h1, `${cap1(top.join(", and "))}.`];
}
function hero() {
  const h = D.last, prior = D.H.slice(-29, -1).map((z) => z.rec).filter((v) => v != null);
  const rng = prior.length >= 5 ? [Math.round(median(prior) - sd(prior)), Math.round(median(prior) + sd(prior))] : null;
  const [h1, why] = headline();
  const g = h.rec != null
    ? gauge({ value: h.rec, count: h.rec, label: "Recovery", big: `${h.rec}`, verdict: h.rec >= 67 ? "Recovered" : h.rec >= 50 ? "Steady" : "Take it easy", color: css("--state"), open: "recovery", range: rng, cap: rng ? `your usual range ${rng[0]}–${rng[1]}` : "compared with your own nights" })
    : gauge({ value: (100 * Math.min(h.recNights, h.recNeed)) / h.recNeed, label: "Recovery", big: "—", verdict: `Baseline ${Math.min(h.recNights + 1, h.recNeed)} of ${h.recNeed}`, vcolor: css("--ink2"), color: css("--ink3"), open: "recovery", cap: "Recovery compares each night with your own usual", building: true });
  const dr = (h.deep ?? 0) + (h.rem ?? 0);
  return `<div class="card hero rise" style="--i:1">${g}
    <div class="minis">
      ${mini("sleep", sleepClock(), "Sleep", h.sleepScore ?? "—", h.hasSleep ? `${hm(h.sleepH)} asleep` : "no sleep record", h.hasSleep ? `${clock(h.onset)}–${clock(h.wake)}` : "")}
      ${mini("sleep", stagesDonut(), "Deep + REM", h.hasSleep ? short(dr) : "—", h.hasSleep && h.sleepH ? `${Math.round((100 * dr) / (h.sleepH * 60))}% of sleep` : "", h.hasSleep ? "wrist estimate" : "")}
    </div>
    <p class="summary">${h1}<span class="why">${why}</span></p></div>`;
}
function prompt() {
  const h = D.last, known = [...["alcohol", "caffeine", "stress"].filter((k) => h.t[k]).map((k) => ASK.find((a) => a.key === k).label), ...(h.sick ? ["Feeling ill"] : [])];
  const auto = h.t.workout && h.lateWorkoutAt != null ? `<span class="auto">Late workout detected · ${ampm(h.lateWorkoutAt)}</span>` : "";
  if (h.asked) return `<div class="noted rise" style="--i:2"><i>✓</i><span>You noted: <b>${known.length ? known.join(" · ") : "nothing unusual"}</b>${h.answer?.via === "checkin" ? "<em>check-in</em>" : ""}</span><button class="link" data-undo="${esc(h.date)}">Change</button>${auto}</div>`;
  if (!h.trig.length && !h.checkIn) return auto ? `<div class="noted rise" style="--i:2">${auto}</div>` : "";
  const reasons = h.trig.map((t) => t.txt);
  const txt = reasons.length ? `${cap1(thatNight())}, ${reasons.length > 1 ? `${reasons.slice(0, -1).join(", ")} and ${reasons[reasons.length - 1]}` : reasons[0]}. Anything that might explain it?`
    : `A quick check-in about ${thatNight()}. Pulse asks on a few ordinary nights too, so it can tell what really moves your numbers.`;
  const dr = st.draft;
  return `<div class="card prompt rise" style="--i:2" id="prompt"><p>${txt}</p>
    <div class="chips">${ASK.map((t) => `<button class="chip ${dr.has(t.key) ? "on" : ""}" data-draft="${t.key}">${t.label}</button>`).join("")}</div>
    <div class="p-act"><button class="chip ghost" data-answer="none">Nothing unusual</button><button class="chip solid" data-answer="save" ${dr.size ? "" : "disabled"}>Save</button></div>${auto ? `<div class="p-auto">${auto}</div>` : ""}</div>`;
}
function channels() {
  const nt = D.nt, h = D.last;
  if (!nt) return "";
  const W0 = 300, H = 30, N = nt.N, x = sc(0, N, 0, W0), rows = [], lv = { 4: 2, 3: 8, 2: 15, 1: 23 };
  if (nt.stages) {
    let stg = "", start = 0;
    for (let i = 1; i <= nt.stages.length; i++) if (i === nt.stages.length || nt.stages[i] !== nt.stages[start]) { stg += `<rect x="${x(start).toFixed(1)}" y="${lv[nt.stages[start]]}" width="${Math.max(0.8, x(i) - x(start)).toFixed(1)}" height="${nt.stages[start] === 4 ? 4 : 5}" rx="2" fill="${stageColor(nt.stages[start])}"/>`; start = i; }
    rows.push(["Stages", "sleep", `<g class="fadein" style="--i:0">${stg}</g>`, `${short(h.deep ?? 0)} deep<small>${short(h.rem ?? 0)} REM</small>`]);
  }
  const line = (pts, color, i, fill = false) => { const id = uid("m"); const d = smoothRuns(pts); return `<defs>${glowDef(id, 1.8)}</defs>${fill && pts.length > 1 ? `<path d="${smooth(pts.filter(Boolean))}L${pts.filter(Boolean).pop()[0]},${H}L${pts.filter(Boolean)[0][0]},${H}Z" fill="${color}" fill-opacity=".14" class="fadein" style="--i:${i}"/>` : ""}<path class="draw" style="--i:${i};--len:600" d="${d}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" ${glow(id)}/>`; };
  const hv = nt.hr.filter((v) => v != null);
  if (hv.length) {
    const lo = Math.min(...hv), hi = Math.max(...hv), yh = sc(lo - 2, hi + 2, H - 2, 2), hrPts = [];
    for (let i = 0; i < N; i += 8) { const w = nt.hr.slice(i, i + 8).filter((v) => v != null); hrPts.push(w.length ? [x(i + 4), yh(w.reduce((a, b) => a + b, 0) / w.length)] : null); }
    const lowAt = nt.hr.indexOf(lo);
    rows.push(["Heart", "rhr", line(hrPts, css("--heart"), 1) + `<circle cx="${x(lowAt)}" cy="${yh(lo)}" r="2.6" fill="${css("--heart")}" class="fadein" style="--i:3"/>`, `low ${Math.round(lo)}<small>at ${clock(nt.onsetMin + lowAt)}</small>`]);
  }
  const hb = nt.bursts.filter((b) => b.rmssd != null);
  if (hb.length) {
    const vals = hb.map((b) => b.rmssd), yv = sc(Math.min(...vals) - 4, Math.max(...vals) + 4, H - 3, 3);
    rows.push(["HRV", "hrv", `<g class="fadein" style="--i:2">${hb.map((b) => `<circle cx="${x(b.m).toFixed(1)}" cy="${yv(b.rmssd).toFixed(1)}" r="${b.ok ? 2.3 : 1.7}" fill="${b.ok ? css("--hrv") : "none"}" stroke="${b.ok ? "none" : css("--ink3")}"/>`).join("")}</g>`, `${h.hrv != null ? `${h.hrv.toFixed(0)} ms` : "—"}<small>${nt.good.length}/${nt.bursts.length} usable</small>`]);
  }
  const bb = nt.good.filter((b) => b.br != null);
  if (bb.length >= 2) { const vals = bb.map((b) => b.br), yb = sc(Math.min(...vals) - 1, Math.max(...vals) + 1, H - 3, 3); rows.push(["Breath", "breath", line(bb.map((b) => [x(b.m), yb(b.br)]), css("--breath"), 3), `${h.br != null ? `${h.br.toFixed(1)}/min` : "—"}<small>${bb.length} readings</small>`]); }
  if (nt.spo2.length) { const ys = sc(Math.min(90, ...nt.spo2.map((r) => r.pct)), 100, H - 2, 2); rows.push(["SpO₂", "spo2", `<g class="fadein" style="--i:4">${nt.spo2.map((r) => `<circle cx="${x(r.m).toFixed(1)}" cy="${ys(r.pct).toFixed(1)}" r="1.9" fill="${css("--spo2")}"/>`).join("")}</g>`, `${h.spo2 != null ? `${Math.round(h.spo2)}%` : "—"}<small>${h.spo2Min != null ? `low ${h.spo2Min}` : ""}</small>`]); }
  if (nt.temp.length >= 2) { const tv = nt.temp.map((r) => r.c), yt = sc(Math.min(...tv) - 0.2, Math.max(...tv) + 0.2, H - 2, 2); rows.push(["Temp", "temp", line(nt.temp.map((r) => [x(r.m), yt(r.c)]), css("--temp"), 5, true), `${h.tdev != null ? `${sign(tDelta(h.tdev))}°<small>vs usual</small>` : `${tempC(h.tempC ?? tv[0]).toFixed(1)}°<small>${tUnit()}</small>`}`]); }
  const scr = nt.bursts.filter((b) => b.screened);
  if (scr.length) rows.push(["Rhythm", "", `<g class="fadein" style="--i:6">${scr.map((b) => `<rect x="${(x(b.m) - 1).toFixed(1)}" y="9" width="2" height="12" rx="1" fill="${css(b.irregular ? "--watch" : "--good")}" opacity=".85"/>`).join("")}</g>`, `${h.rhythm?.flagged ? "irregular" : "regular"}<small>${scr.filter((b) => !b.irregular).length}/${scr.length} checked</small>`]);
  if (!rows.length) return empty("No readings across this night", "The band was worn but didn't record overnight detail.", 4);
  const hours = []; for (let t = Math.ceil(nt.onsetMin / 60) * 60; t < nt.onsetMin + N; t += 60) if ((t / 60) % 2 === 0) hours.push(t);
  const tax = hours.map((t) => `<text x="${x(t - nt.onsetMin)}" y="11" text-anchor="middle" class="axis">${clock(t).replace(":00", "")}</text>`).join("");
  return `<div class="sec rise" style="--i:4"><h2>Across the night</h2><span class="lbl">${rows.length} channels</span></div>${montage(rows, tax, `${ampm(nt.onsetMin)} – ${ampm(nt.onsetMin + N)}`, "tap a row")}`;
}
const spark14 = (k, color) => {
  const W0 = 150, H = 50, vals = D.H.slice(-14).map((z) => z[k]), have = vals.filter((v) => v != null);
  if (have.length < 2) return S(W0, H, have.length ? `<circle cx="${W0 - 5}" cy="25" r="4.5" fill="${color}"/>` : "");
  const x = sc(0, 13, 5, W0 - 5), lo = Math.min(...have), hi = Math.max(...have), pad = (hi - lo) * 0.2 || 1, y = sc(lo - pad, hi + pad, H - 5, 5);
  return S(W0, H, `<path class="draw" style="--i:3;--len:300" d="${smoothRuns(vals.map((v, i) => (v == null ? null : [x(i), y(v)])))}" fill="none" stroke="${color}" stroke-opacity=".6" stroke-width="1.5"/>${vals.map((v, i) => (v == null ? "" : `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${i === 13 ? 4.5 : 2.2}" fill="${color}" ${i === 13 ? `stroke="${css("--bg")}" stroke-width="2"` : ""}/>`)).join("")}`);
};
function vSpo2() {
  const W0 = 150, H = 50, nt = D.nt;
  if (!nt?.spo2.length) return S(W0, H, "");
  const x = sc(0, nt.N, 5, W0 - 5), y = sc(Math.min(90, ...nt.spo2.map((r) => r.pct)), 100, H - 5, 5);
  return S(W0, H, `<rect x="0" width="${W0}" y="${y(100)}" height="${y(95) - y(100)}" rx="6" fill="${css("--spo2")}" opacity=".10"/>${nt.spo2.map((r) => `<circle cx="${x(r.m).toFixed(1)}" cy="${y(r.pct).toFixed(1)}" r="2.2" fill="${css("--spo2")}"/>`).join("")}<text x="${W0}" y="${y(95) + 11}" text-anchor="end" class="axis">95</text>`);
}
function vTemp() {
  const W0 = 150, H = 50, vals = D.H.slice(-14).map((z) => (z.tdev == null ? null : tDelta(z.tdev))), bw = W0 / 14, y0 = H / 2;
  return S(W0, H, `<line x1="0" x2="${W0}" y1="${y0}" y2="${y0}" stroke="${css("--track")}"/>` + vals.map((v, i) => { if (v == null) return ""; const hh = Math.max(1.5, Math.min(22, Math.abs(v) * 20)); return `<rect x="${(i * bw + 1.6).toFixed(1)}" y="${(v >= 0 ? y0 - hh : y0).toFixed(1)}" width="${(bw - 3.2).toFixed(1)}" height="${hh.toFixed(1)}" rx="2" fill="${css(v >= tDelta(0.2) ? "--bad" : "--temp")}" opacity="${i === 13 ? 1 : 0.5}"/>`; }).join(""));
}
function vTiming() {
  const W0 = 150, H = 50, hs = D.H.slice(-14), bw = W0 / 14, y = sc(21 * 60, 33 * 60, 3, H - 3), mids = hs.filter((z) => z.hasSleep).map((z) => z.mid), um = mids.length >= 3 ? median(mids) + 1440 : null;
  return S(W0, H, (um != null ? `<line x1="0" x2="${W0}" y1="${y(um)}" y2="${y(um)}" stroke="${css("--ink3")}" stroke-dasharray="3 3" opacity=".7"/>` : "") + hs.map((z, i) => (z.hasSleep ? `<rect x="${(i * bw + 2).toFixed(1)}" y="${y(Math.max(21 * 60, z.onset)).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${Math.max(2, y(Math.min(33 * 60, z.wake)) - y(Math.max(21 * 60, z.onset))).toFixed(1)}" rx="3" fill="${css("--sleep")}" opacity="${i === 13 ? 1 : 0.4}"/>` : "")).join(""));
}
function tiles() {
  const h = D.last, e = expOf("hrv"), ur = usualOf("rhr"), ub = usualOf("br"), have = D.H.slice(0, -1).filter((z) => z.hasNight).length, bl = `building your usual · ${Math.min(have, MIN_USUAL)} of ${MIN_USUAL}`;
  const uh = usualOf("hrv"), tms = D.H.slice(-15, -1).filter((z) => z.hasSleep).map((z) => z.mid), dMid = h.hasSleep && tms.length >= 3 ? h.mid - median(tms) : null;
  const hrvTxt = h.hrv == null ? "no usable recordings" : e ? `${h.hrv >= e.lo && h.hrv <= e.hi ? `<span class="up">within</span>` : `<span class="warn">${h.hrv < e.lo ? "below" : "above"}</span>`} expected ${e.lo.toFixed(0)}–${e.hi.toFixed(0)}` : uh != null ? `usual ${uh.toFixed(0)} ms${h.hrvSrc === "band" ? " · band estimate" : ""}` : `${bl}`;
  const rhrTxt = h.rhr == null ? "no reading" : ur == null ? bl : Math.abs(h.rhr - ur) < 1.5 ? "right at your usual" : h.rhr > ur ? `<span class="dn">▲ ${(h.rhr - ur).toFixed(0)}</span> over your usual` : `<span class="up">▼ ${(ur - h.rhr).toFixed(0)}</span> under your usual`;
  return `<div class="tiles">
    ${tile("rhr", M.rhr, "Resting HR", h.rhr != null ? h.rhr.toFixed(1) : "—", "bpm", rhrTxt, spark14("rhr", css("--heart")), 5)}
    ${tile("hrv", M.hrv, "Overnight HRV", h.hrv != null ? h.hrv.toFixed(0) : "—", "ms", hrvTxt, spark14("hrv", css("--hrv")), 6)}
    ${tile("breath", M.breath, "Breathing", h.br != null ? h.br.toFixed(1) : "—", "/min", h.br == null ? "needs clean pulse recordings" : ub == null ? bl : h.br - ub >= 1 ? `<span class="warn">${sign(h.br - ub)}</span> vs usual` : `steady · usual ${ub.toFixed(1)}`, spark14("br", css("--breath")), 7)}
    ${tile("spo2", M.spo2, "Oxygen asleep", h.spo2 != null ? Math.round(h.spo2) : "—", "%", h.spo2 != null ? `lowest ${h.spo2Min}% · ${h.spo2N} readings` : "no readings", vSpo2(), 8)}
    ${tile("temp", M.temp, "Skin temp", h.tdev != null ? sign(tDelta(h.tdev)) : h.tempC != null ? tempC(h.tempC).toFixed(1) : "—", h.tdev != null ? `°${tUnit().slice(1)} vs usual` : tUnit(), h.trig?.some((t) => t.k === "temp") ? `<span class="warn">2nd warm night</span>` : h.tdev == null ? `usual after 3 nights` : h.tdev >= 0.2 ? `<span class="warn">warm</span> vs usual` : `no warming trend`, vTemp(), 9)}
    ${tile("timing", M.timing, "Sleep timing", h.hasSleep ? clock(h.onset) : "—", h.hasSleep ? `– ${clock(h.wake)}` : "", dMid == null ? (h.hasSleep ? "usual after 3 nights" : "no sleep record") : Math.abs(dMid) < 20 ? `on your usual schedule${tms.length >= 3 ? ` · ±${Math.round(sd(tms) ?? 0)} min` : ""}` : `<span class="warn">${Math.round(Math.abs(dMid))} min ${dMid > 0 ? "later" : "earlier"}</span> than usual`, vTiming(), 10)}
  </div>`;
}

export function night(ctx) {
  if (!D.nights.length) return `${header("Night", "Night", syncChip(ctx))}${empty("No nights yet", "Wear the band to bed and open Pulse in the morning with the band nearby. Last night's sleep, heart rate, HRV and oxygen appear here.")}`;
  const h = D.last;
  const right = isLatest() || D.i === D.nights[D.nights.length - 1] ? syncChip(ctx) : `<button class="hchip btn" data-night="${D.nights[D.nights.length - 1]}"><span>Latest ›</span></button>`;
  return `${header(`${nightName(h)} · ${nightDates(h)}`, isLatest() ? "Last night" : "Night", right)}
    ${strip()}
    ${hero()}
    ${prompt()}
    ${channels()}
    <div class="sec rise" style="--i:5"><h2>Vitals</h2><span class="lbl">vs your usual</span></div>
    ${tiles()}`;
}
export { ASK };
