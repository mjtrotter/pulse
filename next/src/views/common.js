// Shared bits for screens: the live sync pill, baselines over summaries, formatting.
import { baseline, median, z } from "../analytics/baseline.js?v=20260924145338";
import { syncLine } from "../app.js?v=20260924145338";
import { addDaysStr, DAY, MONTH, toDate } from "../core/time.js?v=20260924145338";
import { h, icon } from "../ui/h.js?v=20260924145338";

/** The connection/sync pill; keeps itself up to date via pulse:status events. */
export function syncPill(ctx) {
  const txt = h("span.txt");
  const btn = h("button.btn.small", { type: "button" });
  const el = h("div.syncpill", h("span.dot"), txt, btn);
  const update = async () => {
    if (!el.isConnected && el.dataset.mounted) { document.removeEventListener("pulse:status", update); return; }
    el.dataset.mounted = "1";
    el.classList.toggle("on", ctx.conn === "on");
    el.classList.toggle("busy", ctx.conn === "connecting" || ctx.conn === "syncing");
    txt.textContent = await syncLine();
    if (ctx.demo) { btn.textContent = "Demo"; btn.disabled = true; return; }
    btn.disabled = ctx.conn === "connecting" || ctx.conn === "syncing";
    if (ctx.conn === "on") { btn.textContent = "Sync"; btn.onclick = () => ctx.sync(); }
    else { btn.replaceChildren(icon("bt"), "Connect"); btn.onclick = () => ctx.connect(); }
  };
  document.addEventListener("pulse:status", update);
  update();
  return el;
}

/** Values of f(summary) for the `n` summaries before `date` (oldest first). */
export function prior(summaries, date, f, n = 28) {
  return summaries.filter((s) => s.date < date).slice(-n).map(f);
}

/** Baseline + z for today's value of a nightly metric. */
export function vsUsual(summaries, date, f, opts = {}) {
  const today = summaries.find((s) => s.date === date);
  const value = today ? f(today) : null;
  const b = baseline(prior(summaries, date, f), opts);
  return { value, base: b, z: z(value, b), usual: b?.center ?? median(prior(summaries, date, f)) };
}

/** Last `n` nightly values ending at date (null where missing), oldest first. */
export function series(summaries, date, f, n = 14) {
  const by = new Map(summaries.map((s) => [s.date, s]));
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = addDaysStr(date, -i);
    const s = by.get(d);
    out.push(s ? f(s) : null);
  }
  return out;
}

export const dayLabel = (date) => DAY[toDate(date).getDay()];
export const dateLong = (date) => { const d = toDate(date); return `${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()]}, ${MONTH[d.getMonth()]} ${d.getDate()}`; };
export const dateShort = (date) => { const d = toDate(date); return `${MONTH[d.getMonth()]} ${d.getDate()}`; };
export const fmtInt = (v) => (v == null ? "—" : Math.round(v).toLocaleString());

/** Day-of-week ticks helper for N-day charts: labels like "Mon". */
export const dayTicks = (dates) => dates.map((d) => DAY[toDate(d).getDay()]);

export function greeting(name) {
  const hr = new Date().getHours();
  const part = hr < 5 ? "Good night" : hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
  return name ? `${part}, ${name}` : part;
}
