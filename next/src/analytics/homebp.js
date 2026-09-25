// Home blood pressure beyond the 7-day average: readings grouped into sittings, how complete the week is against
// the AHA/AMA home-monitoring protocol, morning vs evening, pulse pressure, mean arterial pressure and day-to-day
// variability. Cuff readings only: the band's cuffless estimate never enters these numbers.
// Rows: [{t: "YYYY-MM-DD hh:mm:ss", sys, dia, pulse}].
import { toMs } from "../core/time.js?v=20260925164715";
import { mean, median, sd } from "./baseline.js?v=20260925164715";

const r1 = (x, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

/** Group readings taken within `gapMin` minutes of the previous one into one sitting (the AHA advises two readings
 *  a minute apart, and the sitting's mean is the unit that gets averaged). */
export function sessions(rows, gapMin = 10) {
  const rs = [...(rows ?? [])].filter((r) => r?.sys > 0 && r?.dia > 0 && r.sys > r.dia).sort((a, b) => (a.t < b.t ? -1 : 1));
  const out = [];
  for (const r of rs) {
    const cur = out[out.length - 1];
    if (cur && toMs(r.t) - toMs(cur.readings[cur.readings.length - 1].t) <= gapMin * 60e3) cur.readings.push(r);
    else out.push({ readings: [r] });
  }
  return out.map((s) => {
    const R = s.readings, pulses = R.map((r) => r.pulse).filter((x) => x > 0);
    return { t: R[0].t, date: R[0].t.slice(0, 10), am: +R[0].t.slice(11, 13) < 12, n: R.length, sys: mean(R.map((r) => r.sys)), dia: mean(R.map((r) => r.dia)), pulse: pulses.length ? mean(pulses) : null, first: R[0], second: R[1] ?? null };
  });
}

/** Average real variability: mean absolute difference between successive values (Mena 2005). */
export function arv(values) {
  const v = values.filter((x) => x != null && Number.isFinite(x));
  if (v.length < 2) return null;
  let s = 0;
  for (let i = 1; i < v.length; i++) s += Math.abs(v[i] - v[i - 1]);
  return s / (v.length - 1);
}

/** Protocol completeness for the last 7 days (AHA/AMA 2020: two readings a minute apart, morning and evening,
 *  ideally 7 days and at least 3). */
export function protocolWeek(rows, now = Date.now()) {
  const ss = sessions(rows).filter((s) => toMs(s.t) >= now - 7 * 864e5 && toMs(s.t) <= now);
  const dates = [...new Set(ss.map((s) => s.date))], am = new Set(ss.filter((s) => s.am).map((s) => s.date)), pm = new Set(ss.filter((s) => !s.am).map((s) => s.date));
  const paired = ss.filter((s) => s.n >= 2).length;
  const level = dates.length >= 7 && am.size >= 6 && pm.size >= 6 ? "complete" : dates.length >= 3 && am.size >= 1 && pm.size >= 1 ? "minimum" : "short";
  return { days: dates.length, amDays: am.size, pmDays: pm.size, sessions: ss.length, paired, level };
}

/**
 * Home BP analytics over the last `days` days of cuff readings. Every block returns null (with the reason in
 * `need`) until it has enough data: variability needs 7+ days with readings, morning-vs-evening 3+ sittings of
 * each, the first-vs-second-reading gap 3+ paired sittings.
 */
export function homeBP(rows, { now = Date.now(), days = 30 } = {}) {
  const ss = sessions(rows).filter((s) => toMs(s.t) >= now - days * 864e5 && toMs(s.t) <= now);
  const need = {};
  if (!ss.length) return { sessions: 0, need: { all: "No cuff readings in this window." } };
  const pp = mean(ss.map((s) => s.sys - s.dia)), map = mean(ss.map((s) => s.dia + (s.sys - s.dia) / 3));

  const am = ss.filter((s) => s.am), pm = ss.filter((s) => !s.am);
  let mornEve = null;
  if (am.length >= 3 && pm.length >= 3) mornEve = { am: r1(mean(am.map((s) => s.sys))), pm: r1(mean(pm.map((s) => s.sys))), amDia: r1(mean(am.map((s) => s.dia))), pmDia: r1(mean(pm.map((s) => s.dia))), nAm: am.length, nPm: pm.length, diff: r1(mean(am.map((s) => s.sys)) - mean(pm.map((s) => s.sys))) };
  else need.mornEve = `Needs 3 morning and 3 evening sittings (${am.length} and ${pm.length} so far).`;

  const byDay = new Map();
  for (const s of ss) { if (!byDay.has(s.date)) byDay.set(s.date, []); byDay.get(s.date).push(s); }
  const dayRows = [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, list]) => ({ date, sys: mean(list.map((s) => s.sys)), dia: mean(list.map((s) => s.dia)) }));
  let variability = null;
  if (dayRows.length >= 7) {
    const sys = dayRows.map((d) => d.sys), m = mean(sys), s = sd(sys);
    variability = { days: dayRows.length, sd: r1(s), cv: r1((100 * s) / m), arv: r1(arv(sys)), range: r1(Math.max(...sys) - Math.min(...sys)), sdDia: r1(sd(dayRows.map((d) => d.dia))) };
  } else need.variability = `Needs readings on 7 different days (${dayRows.length} so far).`;

  const pairs = ss.filter((s) => s.second);
  let firstReading = null;
  if (pairs.length >= 3) { const d = pairs.map((s) => s.first.sys - s.second.sys); firstReading = { n: pairs.length, diff: r1(mean(d)), median: r1(median(d)) }; }
  else need.firstReading = `Needs 3 sittings with two readings (${pairs.length} so far).`;

  return { sessions: ss.length, days: dayRows.length, pp: r1(pp, 0), map: r1(map, 0), mornEve, variability, firstReading, dayRows, need };
}

/** Plain-language reading of pulse pressure. ESC/ESH 2018 lists ≥60 mmHg in older people as a sign of stiffer
 *  large arteries; below that the number is descriptive only. */
export function ppNote(pp, age = null) {
  if (pp == null) return "";
  if (pp >= 60 && (age == null || age >= 60)) return "At 60 mmHg or more, a wide pulse pressure in older adults is a sign of stiffer large arteries (ESC/ESH 2018).";
  return "Pulse pressure is the gap between the top and bottom numbers. It widens as large arteries stiffen with age.";
}
