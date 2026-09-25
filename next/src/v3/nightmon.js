// The night's channels on one shared time axis (stages, heart rate, HRV, breathing, oxygen, temperature,
// rhythm screen). Shown inside the Recovery and Sleep drill-downs.
import { tempC } from "../core/units.js?v=20260924230628";
import { ampm, clock, css, D, empty, glow, glowDef, montage, sc, short, sign, smooth, smoothRuns, stageColor, tDelta, tUnit, uid } from "./kit.js?v=20260924230628";

export function nightChannels(attr = "data-open") {
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
  return montage(rows, tax, `${ampm(nt.onsetMin)} – ${ampm(nt.onsetMin + N)}`, "tap a row", attr);
}
