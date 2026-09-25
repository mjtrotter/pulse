// Home blood-pressure helpers shared by Measure, Labs (heart risk) and Trends.
import { toMs } from "../core/time.js?v=20260924205306";
import { mean } from "./stats.js?v=20260924205306";

/** ACC/AHA 2017 home thresholds (Table 11): stage 1 from 130/80, stage 2 from 135/85. */
export function bpCategory(sys, dia, single = false) {
  if (single && (sys > 180 || dia > 120)) return ["Very high", "bad"];
  if (sys >= 135 || dia >= 85) return ["Stage 2 range", "bad"];
  if (sys >= 130 || dia >= 80) return ["Stage 1 range", "watch"];
  if (sys >= 120) return ["Elevated", "watch"];
  return ["Normal", "good"];
}
/** Average of the last 7 days (the first day is dropped when there are 4+ days, per the home protocol). */
export function bpSummary(rows, now = Date.now()) {
  const recent = rows.filter((r) => toMs(r.t) >= now - 7 * 864e5);
  const days = [...new Set(recent.map((r) => r.t.slice(0, 10)))].sort();
  const use = days.length >= 4 ? recent.filter((r) => r.t.slice(0, 10) !== days[0]) : recent;
  if (use.length < 2) return null;
  return { sys: mean(use.map((r) => r.sys)), dia: mean(use.map((r) => r.dia)), n: use.length, days: days.length };
}
