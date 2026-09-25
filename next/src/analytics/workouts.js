// Workout detection from the band's 5-s heart rate. Moderate intensity starts at 40% of heart-rate
// reserve (ACSM), which is where a brisk walk sits for most people over 55; bouts need 10+ minutes and
// pauses of up to 5 minutes (a red light, a rest between sets) don't split them.
// Heart-rate recovery: HR over the bout's last 10 s minus HR 60 s / 120 s later (Cole 1999 style;
// informal protocol, so it's tracked against your own typical drop, never a clinical cutoff).
import { hrWindow, zonesAndLoad } from "./metrics.js?v=20260924215242";

const ms = (t) => Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10), +t.slice(11, 13), +t.slice(14, 16), +t.slice(17, 19));
const fmt = (m) => new Date(m).toISOString().slice(0, 19).replace("T", " ");

export function detectWorkouts(samples, hrRest, hrMax, { frac = 0.4, minMinutes = 10, gapS = 300, sex = "male" } = {}) {
  const pts = samples.map(([t, b]) => [ms(t), b, t]).sort((a, b) => a[0] - b[0]);
  const thr = hrRest + frac * (hrMax - hrRest);
  const bouts = [];
  let cur = null;
  for (const p of pts) {
    if (p[1] < thr) continue;
    if (cur && p[0] - cur.last > gapS * 1000) { bouts.push(cur); cur = null; }
    if (!cur) cur = { first: p[0], last: p[0], peak: p[1], n: 0 };
    cur.last = p[0]; cur.peak = Math.max(cur.peak, p[1]); cur.n++;
  }
  if (cur) bouts.push(cur);
  const out = [];
  for (const b of bouts) {
    const minutes = (b.last - b.first) / 60e3;
    if (minutes < minMinutes || b.n < minMinutes * 4) continue; // ≥ ~1 in 3 samples above threshold
    const s0 = fmt(b.first), s1 = fmt(b.last + 1000);
    const win = hrWindow(samples, s0, s1);
    const load = zonesAndLoad(samples, s0, s1, hrRest, hrMax, sex);
    const tail = pts.filter((p) => p[0] >= b.last - 10e3 && p[0] <= b.last).map((p) => p[1]);
    const hrEnd = tail.reduce((a, x) => a + x, 0) / tail.length;
    const at = (sec) => {
      const target = b.last + sec * 1000;
      let best = null;
      for (const p of pts) if (Math.abs(p[0] - target) <= 10e3 && (!best || Math.abs(p[0] - target) < Math.abs(best[0] - target))) best = p;
      return best?.[1] ?? null;
    };
    const h60 = at(60), h120 = at(120);
    out.push({ start: s0, end: fmt(b.last), minutes, mean: win?.mean ?? null, peak: b.peak, trimp: load.trimp,
      hrr60: h60 != null ? hrEnd - h60 : null, hrr120: h120 != null ? hrEnd - h120 : null });
  }
  return out;
}
