// Trends: the weekly review (this week vs last), trend lines for every metric, and the advanced groups
// (body clock, heart fitness, illness & apnea watch, energy, blood pressure, metabolic). Each row opens the
// metric's drill-down.
import { mean, median, sd } from "./stats.js?v=20260924230628";
import { M } from "./drill.js?v=20260924230628";
import { topicRows } from "./advanced.js?v=20260924230628";
import { cap1, css, D, esc, header, hm, MON, S, sc, sign, smooth, st, syncChip, tDelta, uid } from "./kit.js?v=20260924230628";

/** Rows of the weekly review: key, how to aggregate a week, how to format, the noise threshold for calling a change. */
const WEEK = [
  { k: "sleepH", m: "sleep", label: "Sleep", agg: "mean", f: (v) => hm(v), d: (v) => `${sign(v * 60, 0)} min`, th: 10 / 60, better: 1 },
  { k: "sleepScore", m: "sleep", label: "Sleep score", agg: "mean", f: (v) => v.toFixed(0), d: (v) => sign(v, 0), th: 3, better: 1 },
  { k: "rec", m: "recovery", label: "Recovery", agg: "mean", f: (v) => v.toFixed(0), d: (v) => sign(v, 0), th: 3, better: 1 },
  { k: "rhr", m: "rhr", label: "Resting HR", agg: "mean", f: (v) => `${v.toFixed(1)} bpm`, d: (v) => sign(v, 1), th: 1, better: -1 },
  { k: "hrv", m: "hrv", label: "Overnight HRV", agg: "mean", f: (v) => `${v.toFixed(0)} ms`, d: (v) => sign(v, 1), th: 2, better: 1 },
  { k: "br", m: "breath", label: "Breathing", agg: "mean", f: (v) => `${v.toFixed(1)}/min`, d: (v) => sign(v, 1), th: 0.4, better: 0 },
  { k: "tdev", m: "temp", label: "Skin temp", agg: "mean", f: (v) => `${sign(tDelta(v))}°`, d: (v) => sign(tDelta(v), 1), th: 0.1, better: -1 },
  { k: "steps", m: "steps", label: "Steps a day", agg: "mean", day: true, f: (v) => Math.round(v).toLocaleString(), d: (v, a) => `${sign((100 * v) / (a || 1), 0)}%`, th: 0.05, rel: true, better: 1 },
  { k: "mvpa", m: "mvpa", label: "Brisk minutes", agg: "sum", day: true, f: (v) => `${Math.round(v)} min`, d: (v) => sign(v, 0), th: 0.1, rel: true, better: 1 },
  { k: "lightAct", m: "light", label: "Light minutes", agg: "sum", day: true, f: (v) => `${Math.round(v)} min`, d: (v) => sign(v, 0), th: 0.1, rel: true, better: 1 },
  { k: "trimp", label: "Training load", agg: "sum", day: true, f: (v) => `${Math.round(v)} TRIMP`, d: (v) => sign(v, 0), th: 0.15, rel: true, better: 0 },
];
const aggr = (vals, how) => { const v = vals.filter((x) => x != null); if (!v.length) return null; return how === "sum" ? v.reduce((a, b) => a + b, 0) : mean(v); };

function spark(vals, color, W0 = 96, H = 30) {
  const have = vals.filter((v) => v != null);
  if (have.length < 2) return S(W0, H, "");
  const lo = Math.min(...have), hi = Math.max(...have), pad = (hi - lo) * 0.2 || 1, x = sc(0, vals.length - 1, 3, W0 - 3), y = sc(lo - pad, hi + pad, H - 3, 3);
  const pts = vals.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
  return S(W0, H, `<path d="${smooth(pts, 0.15)}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" opacity=".85"/><circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="3" fill="${color}"/>`);
}

function weekly() {
  const H = D.hist, n = H.length;
  const nights = (a, b) => H.slice(Math.max(0, n - b), n - a), days = (a, b) => H.slice(Math.max(0, n - 1 - b), n - 1 - a);
  const haveDays = H.filter((h) => h.hasNight || h.steps).length;
  const rows = WEEK.map((w) => {
    const cur = (w.day ? days(0, 7) : nights(0, 7)).map((h) => h[w.k]), prev = (w.day ? days(7, 14) : nights(7, 14)).map((h) => h[w.k]);
    const a = aggr(cur, w.agg), b = cur.filter((v) => v != null).length >= 4 && prev.filter((v) => v != null).length >= 4 ? aggr(prev, w.agg) : null;
    const delta = a != null && b != null ? a - b : null, big = delta != null && (w.rel ? Math.abs(delta) / (Math.abs(b) || 1) >= w.th : Math.abs(delta) >= w.th);
    const good = big && w.better ? (w.better * delta > 0 ? "up" : "dn") : "";
    const last14 = (w.day ? days(0, 14) : nights(0, 14)).map((h) => h[w.k]);
    return { ...w, a, b, delta, big, good, last14 };
  }).filter((r) => r.a != null);
  const notable = rows.filter((r) => r.big && r.better).sort((x, y) => Math.abs(y.delta / (y.b || 1)) - Math.abs(x.delta / (x.b || 1))).slice(0, 3);
  const line = notable.length ? cap1(notable.map((r) => `${r.label.toLowerCase()} ${r.delta * r.better > 0 ? "better" : "worse"} (${r.d(r.delta, r.b)})`).join(", ")) + " than the week before." : rows.some((r) => r.b != null) ? "A steady week: nothing moved beyond its normal week-to-week swing." : `The week-over-week comparison starts after two weeks of data (${haveDays} day${haveDays === 1 ? "" : "s"} so far).`;
  return `<div class="card rise week" style="--i:1"><p class="week-line">${line}</p>
    ${rows.map((r) => `<div class="wrow ${r.m ? "tap" : ""}" ${r.m ? `data-open="${r.m}" data-openview="time"` : ""}><span class="wl">${r.label}</span>${spark(r.last14, css(r.m ? M[r.m].color : "--ink2"))}<span class="wv"><b>${r.f(r.a)}</b>${r.delta != null ? `<small class="${r.good}">${r.d(r.delta, r.b)}</small>` : `<small>this week</small>`}</span></div>`).join("")}
    <p class="note">This week = the last 7 nights (and last 7 complete days) vs the 7 before. A change is highlighted only when it's bigger than normal week-to-week swing; green is better, red is worse.</p></div>`;
}

const TOPICS = [["overview", "Overview"], ["sleep", "Sleep"], ["heart", "Heart"], ["activity", "Activity"], ["body", "Body"]];
const TOPIC_TRENDS = { sleep: ["sleep", "recovery", "timing", "breath", "spo2", "sri"], heart: ["rhr", "hrv", "hrday", "dip"], activity: ["steps", "mvpa", "light", "ccost"], body: ["temp"] };
const TOPIC_BLURB = {
  sleep: "How long, how regular and how restful your nights are, and anything that looks like disturbed breathing.",
  heart: "Resting heart rate, HRV, fitness and early-warning signs, each against your own history.",
  activity: "Steps, brisk and light minutes, training load and the energy you burn.",
  body: "Temperature, labs, biological age and, in female profiles, your cycle.",
};
function trendPoints(key) {
  const m = M[key], span = +st.tagg, H0 = D.hist, end = m.day ? H0.length - 2 : H0.length - 1;
  return H0.slice(Math.max(0, end - span + 1), end + 1).filter((h) => m.get(h) != null).length;
}
function trendCard(key) {
  const m = M[key], span = +st.tagg, H0 = D.hist, end = m.day ? H0.length - 2 : H0.length - 1, win = H0.slice(Math.max(0, end - span + 1), end + 1);
  const pts = win.map((h, j) => [j, m.get(h)]).filter((p) => p[1] != null);
  const W0 = 320, H = 70, col = css(m.color);
  let chart = `<p class="note" style="margin:6px 0 0">${pts.length ? "Needs a few more days for a line." : "No data yet."}</p>`, stat = "—", sub = "";
  if (pts.length >= 2) {
    const vals = pts.map((p) => p[1]), lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.15 || 1, x = sc(0, Math.max(1, win.length - 1), 4, W0 - 4), y = sc(lo - pad, hi + pad, H - 4, 4);
    const roll = pts.map((_, i) => mean(pts.slice(Math.max(0, i - 6), i + 1).map((p) => p[1])));
    const u = vals.length >= 5 ? { lo: median(vals) - (sd(vals) ?? 0), hi: median(vals) + (sd(vals) ?? 0) } : null;
    chart = S(W0, H, `${u ? `<rect x="4" width="${W0 - 8}" y="${y(u.hi)}" height="${Math.max(0, y(u.lo) - y(u.hi))}" fill="${col}" opacity=".1" rx="4"/>` : ""}${pts.map((p) => `<circle cx="${x(p[0]).toFixed(1)}" cy="${y(p[1]).toFixed(1)}" r="1.9" fill="${col}" opacity=".45"/>`).join("")}<path d="${smooth(pts.map((p, i) => [x(p[0]), y(pts.length >= 7 ? roll[i] : p[1])]), 0.12)}" fill="none" stroke="${col}" stroke-width="2.2" stroke-linecap="round"/>`, 'preserveAspectRatio="none"');
    const last7 = mean(vals.slice(-7)), first7 = vals.length >= 14 ? mean(vals.slice(0, 7)) : null;
    stat = m.f(last7) + (m.unit ? `<small> ${m.unit}</small>` : "");
    sub = first7 != null ? `${sign(last7 - first7, key === "steps" || key === "timing" ? 0 : 1)} vs start of window` : `${vals.length} ${m.day ? "days" : "nights"}`;
  }
  return `<div class="card trend tap rise" style="--i:3;--tint:${col}" data-open="${key}" data-openview="time"><div class="tr-h"><span class="t-l"><i></i>${m.title}</span><span class="tr-v"><b>${stat}</b><small>${sub}</small></span></div>${chart}</div>`;
}

function unlockList(items) {
  if (!items.length) return "";
  return `<details class="card rise unlock" style="--i:4;margin-top:22px"><summary><b>${items.length} more unlock${items.length === 1 ? "s" : ""} with more data</b><span class="chev">›</span></summary>${items.map((u) => `<div class="ul-row"><span>${u.label}</span></div><p class="note" style="margin:0 0 8px">${u.need}</p>`).join("")}</details>`;
}
function topicView(topic, rowsBy) {
  const keys = TOPIC_TRENDS[topic] ?? [], haveT = keys.filter((k) => M[k] && trendPoints(k) >= 2), waitT = keys.filter((k) => M[k] && !haveT.includes(k));
  const rows = rowsBy[topic] ?? [], ready = rows.filter((r) => r.ready), waitR = rows.filter((r) => !r.ready);
  const unlock = [...waitR.map((r) => ({ label: r.label, need: r.need })), ...(waitT.length ? [{ label: `Trend lines: ${waitT.map((k) => M[k].title).join(", ")}`, need: "Each line appears once there are a few days of data." }] : [])];
  return `<p class="topic-blurb rise" style="--i:1">${TOPIC_BLURB[topic]}</p>
    ${ready.length ? `<div class="card rise adv" style="--i:2">${ready.map((r) => r.html).join("")}</div>` : ""}
    ${haveT.length ? `<div class="sec rise" style="--i:3"><h2>Trend lines</h2><div class="agg inline">${[["30", "30D"], ["90", "90D"], ["365", "1Y"]].map(([k, l]) => `<button data-tagg="${k}" class="${st.tagg === k ? "on" : ""}">${l}</button>`).join("")}</div></div>${haveT.map(trendCard).join("")}` : ""}
    ${!ready.length && !haveT.length ? `<div class="card rise empty" style="--i:2"><b>Nothing here yet</b><p>These fill in as the band collects more days and nights.</p></div>` : ""}
    ${unlockList(unlock)}`;
}

export function trends(ctx) {
  const rowsBy = topicRows(), topic = st.ttopic ?? "overview";
  const seg = `<div class="tseg rise" style="--i:0">${TOPICS.map(([k, l]) => `<button data-ttopic="${k}" class="${topic === k ? "on" : ""}">${l}</button>`).join("")}</div>`;
  const body = topic === "overview"
    ? `${rowsBy.watch?.ready ? `<div class="card rise adv" style="--i:1">${rowsBy.watch.html}</div>` : ""}
       <div class="sec rise first" style="--i:1"><h2>This week</h2><span class="lbl">vs the week before</span></div>${weekly()}
       <div class="topic-links rise" style="--i:3">${TOPICS.slice(1).map(([k, l]) => { const n = (rowsBy[k] ?? []).filter((r) => r.ready).length + (TOPIC_TRENDS[k] ?? []).filter((x) => M[x] && trendPoints(x) >= 2).length; return `<button class="card tl" data-ttopic="${k}"><b>${l}</b><span>${n ? `${n} metric${n === 1 ? "" : "s"}` : "filling in"}</span><span class="chev">›</span></button>`; }).join("")}</div>`
    : topicView(topic, rowsBy);
  return `${header("Weekly review · by topic", "Trends", syncChip(ctx))}${seg}${body}`;
}
export { MON };
