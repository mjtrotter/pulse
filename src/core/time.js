// Local wall-clock helpers. Timestamps are "YYYY-MM-DD hh:mm:ss" strings in the band's (= phone's)
// local time; they sort lexically and match the Python reference.
export const pad = (n) => String(n).padStart(2, "0");
export const stamp = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
export const dayOf = (d = new Date()) => stamp(d).slice(0, 10);
/** Local Date from a timestamp or a date string. */
export const toDate = (t) => new Date(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10),
  t.length > 10 ? +t.slice(11, 13) : 0, t.length > 10 ? +t.slice(14, 16) : 0, t.length > 10 ? +t.slice(17, 19) : 0);
export const toMs = (t) => toDate(t).getTime();
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds());
export const addDaysStr = (date, n) => dayOf(addDays(toDate(date), n));
export const hhmm = (t) => t.slice(11, 16);
export const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Minutes after local midnight for a timestamp (0..1439.99). */
export const clockMin = (t) => +t.slice(11, 13) * 60 + +t.slice(14, 16) + +t.slice(17, 19) / 60;
/** "7:05 AM" / "23:05" depending on the user's clock preference. */
export function clock(t, h12 = true) {
  const h = +t.slice(11, 13), m = t.slice(14, 16);
  if (!h12) return `${pad(h)}:${m}`;
  return `${((h + 11) % 12) + 1}:${m} ${h < 12 ? "AM" : "PM"}`;
}
/** Clock string from minutes after midnight (wraps). */
export function clockFromMin(min, h12 = true) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const t = `2000-01-01 ${pad(Math.floor(m / 60))}:${pad(m % 60)}:00`;
  return clock(t, h12);
}
export const fmtDuration = (min) => {
  const m = Math.round(min);
  return m >= 60 ? `${Math.floor(m / 60)}h ${pad(m % 60)}m` : `${m}m`;
};
export function relTime(t, now = Date.now()) {
  const m = Math.round((now - toMs(t)) / 60e3);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  const d = Math.round(m / 1440);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
