import { Band } from "./core/ble.js?v=20260924113142";
import { summarize } from "./analytics/calibration.js?v=20260924113142";
import { bandpass, ECG_FS, ecgPeaks, ecgSummary } from "./analytics/ecg.js?v=20260924113142";
import * as db from "./core/db.js?v=20260924113142";
import { cosinor, hrmaxTanaka, hrWindow, nightlyTemps, nightSummary, restingHR, sleepSummary, tempDeviation, workouts, zonesAndLoad } from "./analytics/metrics.js?v=20260924113142";
import { decodeHistory, decodeRealtime, hex, SYNCED } from "./core/protocol.js?v=20260924113142";

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const stamp = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const toMs = (t) => Date.parse(t.replace(" ", "T"));
const hhmm = (t) => t.slice(11, 16);
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const byT = (a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

const TABLE = { hr: "hr", hrv: "hrv_vendor", spo2: "spo2", temp: "temp", sleep: "sleep", daily: "daily" };
const DEMO = new URLSearchParams(location.search).has("demo");
const state = { db: null, band: null, mac: null, info: {}, live: false, busy: false, range: 24, showTable: false,
  ecg: { running: false, stop: false } };

// ---------- status, notices, log ----------

function chip(text, mode = "off") {
  $("chipText").textContent = text;
  $("chip").classList.toggle("on", mode === "on");
  $("chip").classList.toggle("busy", mode === "busy");
}

function notice(text) { $("notice").hidden = !text; $("notice").textContent = text ?? ""; }

function log(text, isError = false) {
  const li = el("li", { textContent: `${stamp().slice(11)}  ${text}` });
  if (isError) li.className = "err";
  $("log").prepend(li);
}

function setControls() {
  const on = !!state.band?.connected;
  $("connectPanel").hidden = on;
  $("syncBar").hidden = !on;
  $("sync").disabled = !on || state.busy || state.live;
  $("live").disabled = !on || state.busy;
  $("live").classList.toggle("on", state.live);
  $("live").textContent = state.live ? "Stop" : "Live";
  $("disconnect").disabled = !on;
  $("ecgStart").disabled = !state.ecg.running && (!on || state.busy || state.live);
  $("ecgStart").textContent = state.ecg.running ? "Stop" : "Start ECG";
  if (!state.ecg.running) $("ecgStatus").textContent = on ? "Ready. Touch the plate, then press Start." : "Connect your band first (Today tab).";
  if (!on) chip(DEMO ? "Demo" : "Not connected");
}

// ---------- connection & sync ----------

async function connect(all = false) {
  if (DEMO) { notice("Demo mode can't connect. Remove ?demo from the address to use your band."); return; }
  notice(null);
  log(`Connect tapped (${all ? "all devices" : "band filter"})`);
  chip("Connecting…", "busy");
  const watchdog = setTimeout(() => {
    log("No response from the Bluetooth picker after 15 s", true);
    notice("The Bluetooth picker didn't respond. In iPhone Settings → Bluefy, make sure Bluetooth is allowed, then reload this page.");
  }, 15e3);
  try {
    const pick = Band.choose({ all, log });
    pick.finally(() => clearTimeout(watchdog)).catch(() => {});
    state.band = await pick;
    state.band.onDisconnect = () => { state.live = false; state.busy = false; setControls(); };
    chip(state.band.name, "on");
    setControls();
    await sync();
  } catch (e) {
    const cancelled = e.name === "NotFoundError" && /cancel/i.test(e.message);
    log(`${e.name}: ${e.message}`, !cancelled);
    if (!cancelled) {
      notice(e.name === "NotFoundError"
        ? "No band found. Make sure it's charged and nearby, that nothing else (the Mac, another phone) is connected to it, then try again or tap “Show all nearby devices”."
        : `Couldn't connect: ${e.message}`);
    }
    state.band = null;
    setControls();
  }
}

async function sync() {
  if (!state.band?.connected || state.live || state.busy) return;
  state.busy = true;
  setControls();
  const added = {};
  try {
    chip("Reading band…", "busy");
    state.info = await state.band.info();
    state.mac = state.info.mac ?? state.band.name;
    log(`Band ${state.mac}, firmware ${state.info.firmware}, battery ${state.info.battery}%`);
    // History timestamps come from the band's clock, so keep it right.
    if (state.info.clock && Math.abs(toMs(state.info.clock) - Date.now()) > 60e3) {
      log(`Band clock was ${state.info.clock}; correcting`);
      await state.band.syncClock();
      state.info = { ...state.info, ...(await state.band.info()) };
    }
    for (const kind of SYNCED) {
      chip(`Syncing ${kind}…`, "busy");
      const recs = await state.band.history(kind);
      const t_rx = stamp();
      await db.insert(state.db, "raw_packet", recs.map((r) => ({ band: state.mac, t_rx, cmd: r[0], hex: hex(r) })));
      const rows = recs.flatMap((r) => decodeHistory(kind, r))
        .map((row) => ({ band: state.mac, ...row, ...(kind === "hr" ? { source: "auto" } : {}) }));
      added[kind] = await db.insert(state.db, TABLE[kind], rows);
    }
    const snap = await state.band.snapshot(decodeRealtime);
    await db.put(state.db, "band", { mac: state.mac, name: state.band.name, firmware: state.info.firmware,
      battery: state.info.battery, last_sync: stamp(), snapshot: snap, snapshot_at: stamp() });
    log(`Synced: ${Object.entries(added).map(([k, v]) => `${k} +${v}`).join(", ")}`);
    chip(state.band.name, "on");
  } catch (e) {
    log(`Sync stopped: ${e.name}: ${e.message}`, true);
    notice(`Sync stopped: ${e.message}`);
    chip(state.band?.connected ? state.band.name : "Not connected", state.band?.connected ? "on" : "off");
  } finally {
    state.busy = false;
    setControls();
    await render();
  }
}

async function toggleLive() {
  if (state.live) { state.live = false; return; }
  state.live = true;
  setControls();
  chip("Live", "on");
  const rows = [];
  try {
    await state.band.live((p) => {
      const d = decodeRealtime(p);
      if (!d) return;
      if (d.hr) {
        $("hrNow").textContent = d.hr;
        $("hrNowSub").textContent = "Live, updating every second";
        rows.push({ band: state.mac, t: stamp(), bpm: d.hr, source: "live" });
      }
      $("steps").textContent = d.steps.toLocaleString();
      $("stepsSub").textContent = "Live";
      if (d.temp_c) $("temp").textContent = d.temp_c.toFixed(1);
    }, () => !state.live);
  } finally {
    await db.insert(state.db, "hr", rows);
    state.live = false;
    if (state.band?.connected) chip(state.band.name, "on");
    setControls();
    await render();
  }
}

// ---------- Today ----------

async function render() {
  const now = new Date();
  const end = stamp(now);
  const hr = (await db.range(state.db, "hr", stamp(new Date(now - 7 * 864e5)), end)).sort(byT);
  const day = hr.filter((r) => r.t >= stamp(new Date(now - 864e5)));

  const rhr = restingHR(day.filter((r) => r.source === "auto").map((r) => [r.t, r.bpm]), end);
  $("rhr").textContent = rhr ? Math.round(rhr.bpm) : "—";
  $("rhrSub").textContent = rhr
    ? `Lowest 30-minute average in the last 24 hours, starting ${hhmm(rhr.start)} (${rhr.n} readings)`
    : "Appears once the band has 30+ readings within 30 minutes. Wear it overnight.";

  if (!state.live) {
    const last = day[day.length - 1];
    $("hrNow").textContent = last ? last.bpm : "—";
    $("hrNowSub").textContent = last ? `At ${hhmm(last.t)}` : "No readings yet";
  }
  const latest = async (store, from) => (await db.range(state.db, store, from, end)).sort(byT).pop();
  const since = stamp(new Date(now - 864e5));
  const spo2 = await latest("spo2", since), temp = await latest("temp", since);
  $("spo2").textContent = spo2 ? spo2.pct : "—";
  $("spo2Sub").textContent = spo2 ? `At ${hhmm(spo2.t)}` : "The band measures this automatically";
  if (!state.live) {
    $("temp").textContent = temp ? temp.c.toFixed(1) : "—";
    $("tempSub").textContent = temp ? `At ${hhmm(temp.t)}` : "The band measures this automatically";
  }
  const band = (await db.all(state.db, "band")).sort((a, b) => (a.last_sync < b.last_sync ? 1 : -1))[0];
  const today = (await db.all(state.db, "daily")).find((d) => d.date === end.slice(0, 10));
  if (!state.live && band?.snapshot && band.snapshot_at?.slice(0, 10) === end.slice(0, 10)) {
    $("steps").textContent = Math.max(band.snapshot.steps, today?.steps ?? 0).toLocaleString();
    $("stepsSub").textContent = `As of ${hhmm(band.snapshot_at)}${today ? ` · ${today.km.toFixed(2)} km, ${Math.round(today.kcal)} kcal` : ""}`;
  } else if (!state.live && today) {
    $("steps").textContent = today.steps.toLocaleString();
    $("stepsSub").textContent = `${today.km.toFixed(2)} km, ${Math.round(today.kcal)} kcal`;
  }
  const sl = await lastNight(now);
  $("sleepNow").textContent = sl ? `${Math.floor(sl.asleep / 60)} h ${sl.asleep % 60} min` : "—";
  $("sleepSub").textContent = sl ? `${hhmm(sl.onset)} → ${hhmm(sl.wake)} · deep ${sl.deep} min, REM ${sl.rem} min · ${sl.awakenings} awakenings`
    : "Wear the band overnight, then sync";
  $("syncText").textContent = band?.last_sync ? `Synced ${relTime(band.last_sync)}` : "Not synced yet";
  const lastEcg = (await db.all(state.db, "ecg")).filter((e) => e.result?.hrv).sort(byT).pop();
  $("hrvNow").textContent = lastEcg ? Math.round(lastEcg.result.hrv.rmssd) : "—";
  $("hrvSub").textContent = lastEcg
    ? `From your ECG ${relTime(lastEcg.t)} · heart rate ${Math.round(lastEcg.result.hrv.hr)} bpm`
    : "Take a 30-second ECG to measure it";

  drawChart(hr.filter((r) => r.t >= stamp(new Date(now - state.range * 3600e3))), now);
  await renderCalibration();
  await renderBand(band);
}

function relTime(t) {
  const m = Math.round((Date.now() - toMs(t)) / 60e3);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `at ${hhmm(t)}`;
  return `on ${t.slice(5, 10)}`;
}

/** Mean HR per bucket: 1 min for 6H, 5 min for 24H, 1 h for 7D. */
function buckets(rows, sizeMs) {
  const m = new Map();
  for (const r of rows) {
    const k = Math.floor(toMs(r.t) / sizeMs) * sizeMs;
    const e = m.get(k) ?? { sum: 0, n: 0, min: Infinity, max: -Infinity };
    e.sum += r.bpm; e.n++; e.min = Math.min(e.min, r.bpm); e.max = Math.max(e.max, r.bpm);
    m.set(k, e);
  }
  return [...m].sort((a, b) => a[0] - b[0]).map(([t, e]) => ({ t, v: e.sum / e.n, min: e.min, max: e.max, n: e.n }));
}

const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

function drawChart(rows, now) {
  const box = $("hrChart");
  box.replaceChildren();
  const W = box.clientWidth || 340, H = 220, L = 34, R = 10, T = 12, B = 26;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Heart rate over time" });
  box.append(svg);
  const t1 = now.getTime(), t0 = t1 - state.range * 3600e3;
  const size = state.range <= 6 ? 60e3 : state.range <= 24 ? 300e3 : 3600e3;
  const pts = buckets(rows, size);
  renderTable(buckets(rows, 3600e3));
  if (!pts.length) {
    const t = svgEl("text", { x: W / 2, y: H / 2, "text-anchor": "middle", class: "empty" });
    t.textContent = "No heart-rate readings in this range yet";
    svg.append(t);
    return;
  }
  const vmin = Math.min(...pts.map((p) => p.v)), vmax = Math.max(...pts.map((p) => p.v));
  const step = vmax - vmin > 50 ? 20 : 10;
  const lo = Math.floor((vmin - 3) / step) * step, hi = Math.ceil((vmax + 3) / step) * step;
  const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);

  const grid = svgEl("g", { class: "grid" }), axis = svgEl("g", { class: "axis" });
  for (let v = lo; v <= hi; v += step) {
    grid.append(svgEl("line", { x1: L, x2: W - R, y1: y(v), y2: y(v) }));
    const tx = svgEl("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end" }); tx.textContent = v; axis.append(tx);
  }
  // X ticks on round local times: hourly (6H), every 6 h (24H), midnight (7D).
  const every = state.range <= 6 ? 1 : state.range <= 24 ? 6 : 24;
  const tick = new Date(t0); tick.setMinutes(0, 0, 0);
  while (tick.getTime() < t0 || tick.getHours() % every !== 0) tick.setHours(tick.getHours() + 1);
  for (; tick.getTime() <= t1; tick.setHours(tick.getHours() + every)) {
    const t = tick.getTime();
    const tx = svgEl("text", { x: Math.min(Math.max(x(t), L + 12), W - R - 14), y: H - 6, "text-anchor": "middle" });
    tx.textContent = every === 24 ? DAY[tick.getDay()] : `${pad(tick.getHours())}:00`;
    axis.append(tx);
  }
  svg.append(grid, axis);

  // Break the line where the band wasn't worn (gap > 3 buckets).
  const segs = [];
  for (const p of pts) {
    const s = segs[segs.length - 1];
    if (!s || p.t - s[s.length - 1].t > 3 * size) segs.push([p]); else s.push(p);
  }
  for (const s of segs) {
    const d = s.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
    if (s.length > 1) {
      svg.append(svgEl("path", { class: "area", d: `${d}L${x(s[s.length - 1].t).toFixed(1)},${y(lo)}L${x(s[0].t).toFixed(1)},${y(lo)}Z` }));
      svg.append(svgEl("path", { class: "line", d }));
    } else {
      svg.append(svgEl("circle", { class: "focus", cx: x(s[0].t), cy: y(s[0].v), r: 4 }));
    }
  }

  // Crosshair + tooltip: snaps to the nearest bucket; works with touch.
  const cross = svgEl("line", { class: "cross", y1: T, y2: H - B, visibility: "hidden" });
  const dot = svgEl("circle", { class: "focus", r: 4, visibility: "hidden" });
  svg.append(cross, dot);
  const tip = $("chartTip");
  const show = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const t = t0 + ((px - L) / (W - L - R)) * (t1 - t0);
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
    const cx = x(best.t), cy = y(best.v);
    cross.setAttribute("x1", cx); cross.setAttribute("x2", cx);
    dot.setAttribute("cx", cx); dot.setAttribute("cy", cy);
    cross.setAttribute("visibility", "visible"); dot.setAttribute("visibility", "visible");
    const d = new Date(best.t);
    const when = size >= 3600e3 ? `${DAY[d.getDay()]} ${pad(d.getHours())}:00` : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    tip.replaceChildren(el("span", { className: "key" }), el("strong", { textContent: `${Math.round(best.v)} bpm` }),
      el("span", { className: "when", textContent: `${when}${best.n > 1 ? ` · range ${best.min}–${best.max}` : ""}` }));
    tip.hidden = false;
    const cardW = box.parentElement.clientWidth, tw = tip.offsetWidth;
    tip.style.left = `${Math.max(8, Math.min(cardW - tw - 8, (cx / W) * box.clientWidth + 8 - tw / 2))}px`;
  };
  const hide = () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); };
  svg.addEventListener("pointermove", show);
  svg.addEventListener("pointerdown", show);
  svg.addEventListener("pointerleave", hide);
}

function renderTable(hours) {
  const wrap = $("hrTable");
  wrap.replaceChildren();
  if (!hours.length) return;
  const head = el("tr", {}, el("th", { textContent: "Hour" }), el("th", { className: "num", textContent: "Average" }),
    el("th", { className: "num", textContent: "Min" }), el("th", { className: "num", textContent: "Max" }), el("th", { className: "num", textContent: "Readings" }));
  const body = hours.slice().reverse().map((h) => {
    const d = new Date(h.t);
    return el("tr", {}, el("td", { textContent: `${DAY[d.getDay()]} ${pad(d.getHours())}:00` }),
      el("td", { className: "num", textContent: Math.round(h.v) }), el("td", { className: "num", textContent: h.min }),
      el("td", { className: "num", textContent: h.max }), el("td", { className: "num", textContent: h.n }));
  });
  wrap.append(el("table", {}, el("thead", {}, head), el("tbody", {}, ...body)));
}

// ---------- Sleep ----------

/** Sleep between 18:00 yesterday and 14:00 today. */
async function lastNight(now) {
  const t0 = `${stamp(addDays(now, -1)).slice(0, 10)} 18:00:00`, t1 = `${stamp(now).slice(0, 10)} 14:00:00`;
  const rows = (await db.range(state.db, "sleep", t0, t1)).map((r) => [r.t, r.stage]);
  const s = sleepSummary(rows, t0, t1);
  return s && s.asleep ? { ...s, rows } : null;
}

const STAGE_ORDER = [["deep", "Deep"], ["rem", "REM"], ["light", "Light"], ["awake", "Awake"]];

async function renderSleep(now) {
  const s = await lastNight(now);
  $("sleepBar").replaceChildren(); $("sleepLegend").replaceChildren(); $("hypnogram").replaceChildren();
  if (!s) { $("sleepHead").textContent = ""; $("sleepNote").textContent = "No sleep recorded for last night yet. Wear the band to bed and sync in the morning."; return; }
  $("sleepHead").textContent = `${Math.floor(s.asleep / 60)} h ${s.asleep % 60} min asleep · ${hhmm(s.onset)} to ${hhmm(s.wake)} · efficiency ${Math.round(s.efficiency)}% · ${s.awakenings} awakenings`;
  for (const [k, name] of STAGE_ORDER) {
    if (!s[k]) continue;
    const seg = el("span", { className: `st-${k}`, title: `${name} ${s[k]} min` });
    seg.style.flex = String(s[k]);
    $("sleepBar").append(seg);
    $("sleepLegend").append(el("div", {}, el("i", { className: `st-${k}` }), el("span", { textContent: name }),
      el("b", { textContent: `${Math.floor(s[k] / 60) ? `${Math.floor(s[k] / 60)} h ` : ""}${s[k] % 60} min · ${Math.round((100 * s[k]) / s.in_record)}%` })));
  }
  // Hypnogram: one step line, awake on top, deep at the bottom.
  const { svg, W, H } = svgBox($("hypnogram"), 150);
  const level = (code) => ({ 4: 0, 3: 1, 2: 2, 1: 3 })[code] ?? 0;
  const L = 48, R = 8, T = 10, B = 22;
  const t0 = toMs(s.rows[0][0]), t1 = toMs(s.rows[s.rows.length - 1][0]) + 60e3;
  const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R), y = (lv) => T + (lv / 3) * (H - T - B);
  const axis = svgEl("g", { class: "axis" }), grid = svgEl("g", { class: "grid" });
  ["Awake", "REM", "Light", "Deep"].forEach((n, i) => {
    grid.append(svgEl("line", { x1: L, x2: W - R, y1: y(i), y2: y(i) }));
    const tx = svgEl("text", { x: L - 6, y: y(i) + 4, "text-anchor": "end" }); tx.textContent = n; axis.append(tx);
  });
  const first = new Date(t0); first.setMinutes(0, 0, 0);
  for (let t = first.getTime() + 3600e3; t < t1; t += 2 * 3600e3) {
    const tx = svgEl("text", { x: x(t), y: H - 5, "text-anchor": "middle" }); tx.textContent = `${pad(new Date(t).getHours())}:00`; axis.append(tx);
  }
  svg.append(grid, axis);
  let d = "", prev = null;
  s.rows.forEach(([t, code], i) => {
    const px = x(toMs(t)).toFixed(1), lv = level(code);
    if (i === 0) d += `M${px},${y(lv).toFixed(1)}`;
    else if (lv !== prev) d += `H${px}V${y(lv).toFixed(1)}`;
    prev = lv;
  });
  d += `H${x(t1).toFixed(1)}`;
  svg.append(svgEl("path", { class: "hyp", d }));
  $("sleepNote").textContent = "Stages are the band's own per-minute estimate from motion and heart rate. Sleep timing is reliable; the split between stages is approximate.";
}

// ---------- Trends ----------

const day = (d) => stamp(d).slice(0, 10);
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const fmtClock = (h) => `${pad(Math.floor(h) % 24)}:${pad(Math.round((h % 1) * 60) % 60)}`;

async function renderTrends() {
  const now = new Date();
  await renderSleep(now);
  const hrRows = (await db.range(state.db, "hr", stamp(addDays(now, -8)), stamp(now))).sort(byT);
  const samples = hrRows.map((r) => [r.t, r.bpm]);
  const auto = hrRows.filter((r) => r.source === "auto").map((r) => [r.t, r.bpm]);

  // Last night: 00:00-06:00 today vs yesterday's daytime.
  const ns = nightSummary(auto, day(now));
  const rows = [];
  if (ns.night) {
    rows.push(["Average, midnight to 6 am", `${Math.round(ns.night.mean)} bpm`], ["Lowest", `${ns.night.min} bpm`],
      ["Hours with readings", (ns.night.minutes / 60).toFixed(1)]);
    if (ns.day) rows.push(["Yesterday daytime average", `${Math.round(ns.day.mean)} bpm`]);
    if (ns.dip_pct != null) rows.push(["Night-time dip", `${ns.dip_pct.toFixed(0)}%`]);
  }
  $("nightStats").replaceChildren(...rows.flatMap(([k, v]) => [el("dt", { textContent: k }), el("dd", { textContent: v })]));
  $("nightNote").textContent = !ns.night
    ? "No readings between midnight and 6 am yet. Wear the band overnight and sync in the morning."
    : ns.dip_pct == null
      ? "The dip needs at least an hour of night readings and two hours from yesterday's daytime."
      : "Heart rate normally drops 10–20% at night. A smaller dip can follow late meals, alcohol, stress, or illness.";

  // Daily rhythm over the last 24 hours.
  const t0 = stamp(new Date(now - 864e5)), t1 = stamp(now);
  const cz = cosinor(samples, t0, t1);
  $("rhythmText").textContent = cz
    ? `Peaks around ${fmtClock(cz.acrophase_h)}, lowest around ${fmtClock((cz.acrophase_h + 12) % 24)}. Swings ±${cz.amplitude.toFixed(0)} bpm around ${cz.mesor.toFixed(0)} (fit explains ${Math.round(cz.r2 * 100)}% of the hourly variation).`
    : "Needs readings spread over at least 16 hours of the last day.";
  drawRhythm($("rhythmChart"), samples.filter(([t]) => t >= t0), cz);

  // Zones and training load today.
  const profile = (await db.getSetting(state.db, "profile")) ?? {};
  const rhr = restingHR(auto.filter(([t]) => t >= t0), t1);
  const zonesBox = $("zones");
  zonesBox.replaceChildren();
  if (!profile.age || !profile.sex) {
    $("zonesNote").textContent = "Add your age and sex in Band → Profile to see zones and training load.";
  } else {
    const hrMax = profile.hrmax || hrmaxTanaka(profile.age), hrRest = rhr?.bpm ?? 60;
    const z = zonesAndLoad(samples, `${day(now)} 00:00:00`, t1, hrRest, hrMax, profile.sex);
    const maxMin = Math.max(1, ...z.zone_minutes);
    const names = ["Easy", "Moderate", "Aerobic", "Threshold", "Maximum"];
    z.zone_minutes.forEach((m, i) => {
      const bar = el("div", { className: `bar z${i + 1}${m > 0 ? " some" : ""}` });
      bar.style.width = `${(m / maxMin) * 100}%`;
      zonesBox.append(el("div", { className: "zone" }, el("span", { className: "name", textContent: `Z${i + 1} ${names[i]}` }),
        el("div", { className: "track" }, bar), el("span", { className: "mins", textContent: `${Math.round(m)} min` })));
    });
    $("zonesNote").textContent = `Training load today (Banister TRIMP): ${z.trimp.toFixed(0)}. Zones use heart-rate reserve with max ${Math.round(hrMax)} bpm`
      + `${profile.hrmax ? "" : " (estimated from age)"} and resting ${Math.round(hrRest)} bpm${rhr ? "" : " (default until measured)"}.`;
  }

  // Nightly skin temperature vs your own baseline.
  const tRows = (await db.range(state.db, "temp", stamp(addDays(now, -21)), stamp(now))).map((r) => [r.t, r.c]);
  const nights = nightlyTemps(tRows);
  drawDots($("tempNights"), Object.entries(nights).slice(-14).map(([d, c]) => ({ t: toMs(`${d} 03:00:00`), v: c })), { step: 0.5, unit: "°" });
  const td = tempDeviation(tRows, day(now));
  $("tempNightsNote").textContent = !Object.keys(nights).length
    ? "Appears once the band's temperature history syncs (being added next)."
    : !td ? "No readings between midnight and 6 am last night."
      : td.deviation == null ? `Last night ${td.night.toFixed(1)} °C. Your baseline needs ${3 - td.n_baseline} more night(s).`
        : `Last night ${td.night.toFixed(1)} °C, ${td.deviation >= 0 ? "+" : "−"}${Math.abs(td.deviation).toFixed(1)} °C vs your usual (${td.n_baseline} nights). A rise of 0.5 °C or more can come with illness, alcohol, or a warm room.`;

  // Workouts (>= 5 min at >= 50% of heart-rate reserve) with heart-rate recovery.
  const wl = $("workoutList");
  wl.replaceChildren();
  if (!profile.age || !profile.sex) {
    $("workoutNote").textContent = "Add your age and sex in Band → Profile to detect workouts.";
  } else {
    const hrMax = profile.hrmax || hrmaxTanaka(profile.age), hrRest = rhr?.bpm ?? 60;
    const ws = workouts(samples, hrRest, hrMax, 5, 120, profile.sex).reverse();
    if (!ws.length) {
      $("workoutNote").textContent = "None yet. A workout is 5+ minutes at or above half your heart-rate reserve.";
    } else {
      const head = el("tr", {}, el("th", { textContent: "When" }), el("th", { className: "num", textContent: "Min" }),
        el("th", { className: "num", textContent: "Avg/peak" }), el("th", { className: "num", textContent: "Load" }),
        el("th", { className: "num", textContent: "1-min drop" }));
      const body = ws.map((w) => el("tr", {},
        el("td", { textContent: `${DAY[new Date(toMs(w.start)).getDay()]} ${hhmm(w.start)}` }),
        el("td", { className: "num", textContent: Math.round(w.minutes) }),
        el("td", { className: "num", textContent: `${Math.round(w.mean)}/${w.peak}` }),
        el("td", { className: "num", textContent: Math.round(w.trimp) }),
        el("td", { className: "num", textContent: w.hrr60 != null ? `−${Math.round(w.hrr60)} bpm` : "—" })));
      wl.append(el("table", {}, el("thead", {}, head), el("tbody", {}, ...body)));
      $("workoutNote").textContent = "Recovery is how far your heart rate falls in the minute after the workout ends. Bigger drops mean fitter; under 12 bpm is on the low side.";
    }
  }

  // Resting HR by calendar day, last 7 days.
  const days = [];
  for (let k = 6; k >= 0; k--) {
    const d = addDays(now, -k), a = `${day(d)} 00:00:00`, b = `${day(addDays(d, 1))} 00:00:00`;
    const r = restingHR(auto.filter(([t]) => t >= a && t < b), b < t1 ? b : t1, 24);
    days.push({ t: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime(), label: DAY[d.getDay()], v: r?.bpm ?? null });
  }
  drawDays($("rhrDays"), days);
  const have = days.filter((d) => d.v != null).length;
  $("rhrDaysNote").textContent = have >= 2 ? "Lowest 30-minute average each day. A rise of 5+ bpm above your usual can mean fatigue or illness." : "Builds up as you wear the band each day.";

  // HRV (RMSSD) per ECG session.
  const ecgs = (await db.all(state.db, "ecg")).filter((e) => e.result?.hrv).sort(byT);
  drawDots($("hrvTrend"), ecgs.map((e) => ({ t: toMs(e.t), v: e.result.hrv.rmssd })));
  $("hrvTrendNote").textContent = ecgs.length >= 2
    ? "RMSSD from each ECG. Compare like with like: same time of day, seated, before coffee."
    : "Take an ECG most mornings to build your HRV baseline.";
}

function svgBox(box, H = 170) {
  box.replaceChildren();
  const W = box.clientWidth || 340;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}` });
  box.append(svg);
  return { svg, W, H };
}

function yAxis(svg, lo, hi, step, y, L, W, R, digits = 0) {
  const grid = svgEl("g", { class: "grid" }), axis = svgEl("g", { class: "axis" });
  for (let v = lo; v <= hi + 1e-9; v += step) {
    grid.append(svgEl("line", { x1: L, x2: W - R, y1: y(v), y2: y(v) }));
    const tx = svgEl("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end" }); tx.textContent = v.toFixed(digits); axis.append(tx);
  }
  svg.append(grid, axis);
  return axis;
}

function niceRange(vals, step) {
  return [Math.floor((Math.min(...vals) - 2) / step) * step, Math.ceil((Math.max(...vals) + 2) / step) * step];
}

function drawRhythm(box, samples, cz) {
  const { svg, W, H } = svgBox(box);
  if (!samples.length) return;
  const byHour = new Map();
  for (const [t, b] of samples) { const h = +t.slice(11, 13); const e = byHour.get(h) ?? [0, 0]; byHour.set(h, [e[0] + b, e[1] + 1]); }
  const pts = [...byHour].map(([h, [s, n]]) => [h + 0.5, s / n]);
  const fit = cz ? Array.from({ length: 49 }, (_, i) => [i / 2, cz.mesor + cz.amplitude * Math.cos((2 * Math.PI * (i / 2 - cz.acrophase_h)) / 24)]) : [];
  const [lo, hi] = niceRange([...pts.map((p) => p[1]), ...fit.map((p) => p[1])], 10);
  const L = 30, R = 8, T = 8, B = 22;
  const x = (h) => L + (h / 24) * (W - L - R), y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const axis = yAxis(svg, lo, hi, 10, y, L, W, R);
  for (const h of [0, 6, 12, 18, 24]) { const tx = svgEl("text", { x: Math.min(x(h), W - R - 14), y: H - 5, "text-anchor": "middle" }); tx.textContent = `${pad(h % 24)}:00`; axis.append(tx); }
  if (fit.length) svg.append(svgEl("path", { class: "fit", d: fit.map(([h, v], i) => `${i ? "L" : "M"}${x(h).toFixed(1)},${y(v).toFixed(1)}`).join("") }));
  for (const [h, v] of pts) svg.append(svgEl("circle", { class: "dot", cx: x(h), cy: y(v), r: 4 }));
}

/** Dot-and-line chart over the last 7 calendar days (no truncated bars for small changes). */
function drawDays(box, items) {
  const { svg, W, H } = svgBox(box);
  const vals = items.filter((d) => d.v != null).map((d) => d.v);
  const L = 30, R = 12, T = 18, B = 22;
  const [lo, hi] = vals.length ? niceRange(vals, 5) : [45, 70];
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const axis = yAxis(svg, lo, hi, 5, y, L, W, R);
  const slot = (W - L - R) / items.length, x = (i) => L + slot * (i + 0.5);
  items.forEach((d, i) => { const tx = svgEl("text", { x: x(i), y: H - 5, "text-anchor": "middle" }); tx.textContent = d.label; axis.append(tx); });
  const pts = items.map((d, i) => [i, d.v]).filter(([, v]) => v != null);
  if (pts.length > 1) svg.append(svgEl("path", { class: "fit", d: pts.map(([i, v], k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("") }));
  for (const [i, v] of pts) {
    svg.append(svgEl("circle", { class: "dot", cx: x(i), cy: y(v), r: 4 }));
    const lab = svgEl("text", { x: x(i), y: y(v) - 9, "text-anchor": "middle", class: "val" }); lab.textContent = Math.round(v); svg.append(lab);
  }
}

function drawColumns(box, items) {
  const { svg, W, H } = svgBox(box);
  const vals = items.filter((d) => d.v != null).map((d) => d.v);
  const L = 30, R = 8, T = 16, B = 22;
  const [lo, hi] = vals.length ? niceRange(vals, 10) : [40, 80];
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const axis = yAxis(svg, lo, hi, 10, y, L, W, R);
  const slot = (W - L - R) / items.length, bw = Math.min(24, slot * 0.6);
  items.forEach((d, i) => {
    const cx = L + slot * (i + 0.5);
    const tx = svgEl("text", { x: cx, y: H - 5, "text-anchor": "middle" }); tx.textContent = d.label; axis.append(tx);
    if (d.v == null) return;
    const top = y(d.v), base = y(lo), r = 4;
    svg.append(svgEl("path", { class: "col", d: `M${cx - bw / 2},${base}V${top + r}Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top}H${cx + bw / 2 - r}Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r}V${base}Z` }));
    const lab = svgEl("text", { x: cx, y: top - 4, "text-anchor": "middle", class: "val" }); lab.textContent = Math.round(d.v); svg.append(lab);
  });
}

function drawDots(box, pts, { step = 10, unit = " ms" } = {}) {
  const { svg, W, H } = svgBox(box);
  if (!pts.length) return;
  const L = 34, R = 12, T = 16, B = 22;
  const vals = pts.map((p) => p.v);
  const lo = Math.floor((Math.min(...vals) - step / 2) / step) * step, hi = Math.ceil((Math.max(...vals) + step / 2) / step) * step;
  const t0 = Math.min(...pts.map((p) => p.t)), t1 = Math.max(...pts.map((p) => p.t)), span = Math.max(t1 - t0, 864e5);
  const x = (t) => L + ((t - t0) / span) * (W - L - R), y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const axis = yAxis(svg, lo, hi, step, y, L, W, R, step < 1 ? 1 : 0);
  for (const t of [t0, t0 + span]) { const d = new Date(t); const tx = svgEl("text", { x: Math.min(Math.max(x(t), L + 14), W - R - 14), y: H - 5, "text-anchor": "middle" }); tx.textContent = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; axis.append(tx); }
  if (pts.length > 1) svg.append(svgEl("path", { class: "fit", d: pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("") }));
  for (const p of pts) svg.append(svgEl("circle", { class: "dot", cx: x(p.t), cy: y(p.v), r: 4 }));
  const last = pts[pts.length - 1], lab = svgEl("text", { x: x(last.t), y: y(last.v) - 9, "text-anchor": "middle", class: "val" });
  lab.textContent = step < 1 ? `${last.v.toFixed(1)}${unit}` : `${Math.round(last.v)}${unit}`; svg.append(lab);
}

// ---------- Profile ----------

async function loadProfile() {
  const p = (await db.getSetting(state.db, "profile")) ?? {};
  $("pAge").value = p.age ?? ""; $("pSex").value = p.sex ?? ""; $("pHeight").value = p.height ?? "";
  $("pWeight").value = p.weight ?? ""; $("pHrmax").value = p.hrmax ?? "";
  $("profileNote").textContent = p.age ? `Max heart rate used: ${Math.round(p.hrmax || hrmaxTanaka(p.age))} bpm${p.hrmax ? "" : " (208 − 0.7 × age)"}.` : "";
}

async function saveProfile(e) {
  e.preventDefault();
  const num = (id) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : null; };
  const p = { age: num("pAge"), sex: $("pSex").value || null, height: num("pHeight"), weight: num("pWeight"), hrmax: num("pHrmax") };
  if (p.age != null && (p.age < 18 || p.age > 100)) { notice("Age should be between 18 and 100."); return; }
  if (p.hrmax != null && (p.hrmax < 120 || p.hrmax > 230)) { notice("Max heart rate should be between 120 and 230."); return; }
  await db.setSetting(state.db, "profile", p);
  notice(null);
  await loadProfile();
}

// ---------- ECG ----------

const ECG_SETTLE = 5, ECG_RECORD = 30;

function drawEcg(canvas, x, { peaks = [], fs = ECG_FS } = {}) {
  const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth || 340, H = 180;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement);
  // Light ECG-paper grid: a line every 0.2 s.
  g.strokeStyle = css.getPropertyValue("--grid"); g.lineWidth = 1;
  const secs = x.length / fs;
  for (let t = 0; t <= secs; t += 0.2) { const px = (t / secs) * W; g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H); g.stroke(); }
  if (x.length < 2) return;
  const sorted = x.slice().sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.005)], hi = sorted[Math.ceil(sorted.length * 0.995) - 1];
  const span = Math.max(hi - lo, 0.2), pad = span * 0.15;
  const y = (v) => H - 8 - ((v - (lo - pad)) / (span + 2 * pad)) * (H - 16);
  g.strokeStyle = css.getPropertyValue("--hr"); g.lineWidth = 1.6; g.lineJoin = "round";
  g.beginPath();
  x.forEach((v, i) => { const px = (i / (x.length - 1)) * W; i ? g.lineTo(px, y(v)) : g.moveTo(px, y(v)); });
  g.stroke();
  g.fillStyle = css.getPropertyValue("--ink-2");
  for (const p of peaks) { const px = (p / (x.length - 1)) * W; g.beginPath(); g.arc(px, 8, 3, 0, 7); g.fill(); }
}

async function toggleEcg() {
  if (state.ecg.running) { state.ecg.stop = true; return; }
  const samples = [];
  let firstAt = null, lastAt = null, packets = 0, frame = 0;
  state.ecg = { running: true, stop: false };
  setControls();
  $("ecgLive").hidden = false; $("ecgResult").hidden = true;
  $("ecgStatus").textContent = "Waiting for your finger on the silver plate…";
  $("ecgClock").textContent = "0 s"; $("ecgBpm").textContent = "";
  log("ECG started");
  const startedAt = Date.now();
  const tick = setInterval(() => {
    if (!firstAt) {
      if (Date.now() - startedAt > 20e3) { state.ecg.stop = true; $("ecgStatus").textContent = "No signal. Is your finger on the silver plate?"; }
      return;
    }
    const secs = (Date.now() - firstAt) / 1000;
    $("ecgClock").textContent = `${Math.min(ECG_SETTLE + ECG_RECORD, Math.floor(secs))} / ${ECG_SETTLE + ECG_RECORD} s`;
    $("ecgStatus").textContent = secs < ECG_SETTLE ? "Settling… keep still" : "Recording… keep still";
    const tail = samples.slice(-8 * ECG_FS);
    if (tail.length >= 4 * ECG_FS) {
      const { peaks } = ecgPeaks(tail);
      if (peaks.length > 2) $("ecgBpm").textContent = `${Math.round((60 * ECG_FS * (peaks.length - 1)) / (peaks[peaks.length - 1] - peaks[0]))} bpm`;
    }
    if (secs >= ECG_SETTLE + ECG_RECORD) state.ecg.stop = true;
  }, 1000);
  const draw = () => {
    if (!state.ecg.running) return;
    if (frame++ % 2 === 0 && samples.length > 64) drawEcg($("ecgCanvas"), bandpass(samples.slice(-4 * ECG_FS)));
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
  try {
    await state.band.ecg((mv, pkt) => {
      if (!firstAt) { firstAt = Date.now(); log(`ECG signal: ${pkt.length}-byte packets, ${mv.length} samples each`); }
      lastAt = Date.now(); packets++;
      samples.push(...mv);
    }, () => state.ecg.stop, ECG_SETTLE + ECG_RECORD + 25);
  } catch (e) {
    log(`ECG stopped: ${e.name}: ${e.message}`, true);
  } finally {
    clearInterval(tick);
    state.ecg = { running: false, stop: false };
    setControls();
  }
  const rate = packets > 1 ? samples.length / ((lastAt - firstAt) / 1000) : 0;
  log(`ECG ended: ${samples.length} samples, ${packets} packets, arrival ≈${rate.toFixed(0)}/s`);
  if (samples.length < (ECG_SETTLE + 10) * ECG_FS) {
    $("ecgStatus").textContent = samples.length ? "Too short to analyse. Keep your finger on for the full 35 s." : $("ecgStatus").textContent;
    return;
  }
  const result = ecgSummary(samples, ECG_FS, ECG_SETTLE);
  const session = { band: state.mac ?? "unknown", t: stamp(), fs: ECG_FS, arrival_rate: rate, n: samples.length,
    samples: Float32Array.from(samples), result: { hrv: result.hrv, quality: result.quality, peaks: result.peaks, good: result.good } };
  await db.put(state.db, "ecg", session);
  showEcgResult(session);
  $("ecgStatus").textContent = "Saved on this phone.";
  await renderEcgList();
}

function showEcgResult(session) {
  const r = session.result, h = r.hrv;
  $("ecgResult").hidden = false; $("ecgLive").hidden = false;
  const x = Array.from(session.samples).slice(ECG_SETTLE * session.fs);
  const mid = Math.max(0, Math.floor(x.length / 2 - 4 * session.fs));
  const strip = bandpass(x).slice(mid, mid + 8 * session.fs);
  drawEcg($("ecgCanvas"), strip, { peaks: r.peaks.filter((p) => p >= mid && p < mid + 8 * session.fs).map((p) => p - mid), fs: session.fs });
  $("ecgClock").textContent = `${session.t.slice(5, 10)} ${hhmm(session.t)} · 8 s shown`;
  $("ecgBpm").textContent = h ? `${Math.round(h.hr)} bpm` : "";
  $("ecgResultTitle").textContent = h ? "Result" : "Signal too noisy";
  const rows = h ? [
    ["Heart rate", `${h.hr.toFixed(0)} bpm`],
    ["HRV (RMSSD)", `${h.rmssd.toFixed(1)} ms`],
    ["ln RMSSD", h.ln_rmssd.toFixed(2)],
    ["SDNN", `${h.sdnn.toFixed(1)} ms`],
    ["pNN50", `${h.pnn50.toFixed(0)}%`],
    ["Stress index", h.stress_index != null ? h.stress_index.toFixed(0) : "—"],
    ["Rhythm", h.irregular ? "Irregular pattern" : "Regular"],
    ["Signal quality", `${Math.round(r.quality * 100)}% of beats usable (${h.n} intervals)`],
  ] : [["Signal quality", `${Math.round(r.quality * 100)}% of beats usable`]];
  $("ecgStats").replaceChildren(...rows.flatMap(([k, v]) => [el("dt", { textContent: k }),
    el("dd", { textContent: v, className: k === "Rhythm" && h?.irregular ? "flag" : "" })]));
  $("ecgNote").textContent = !h
    ? "Fewer than 10 clean beats. Rest your arm, keep your finger light and still on the plate, and try again."
    : h.irregular
      ? "The beat-to-beat pattern was irregular in this recording. One strip can be thrown off by movement; repeat it at rest, and if it keeps showing up, show the recordings to a doctor."
      : "Computed on this phone from the raw ECG: beats found in the waveform, noisy beats removed by shape, then standard HRV measures.";
}

async function renderEcgList() {
  const sessions = (await db.all(state.db, "ecg")).sort(byT).reverse();
  const list = $("ecgList");
  list.replaceChildren();
  if (!sessions.length) { list.append(el("p", { className: "sub", textContent: "None yet." })); return; }
  const head = el("tr", {}, el("th", { textContent: "When" }), el("th", { className: "num", textContent: "HR" }),
    el("th", { className: "num", textContent: "HRV" }), el("th", { className: "num", textContent: "Quality" }), el("th", { textContent: "Rhythm" }));
  const body = sessions.map((sn) => {
    const h = sn.result?.hrv;
    const tr = el("tr", { className: "pick", tabIndex: 0 },
      el("td", { textContent: `${sn.t.slice(5, 10)} ${hhmm(sn.t)}` }),
      el("td", { className: "num", textContent: h ? Math.round(h.hr) : "—" }),
      el("td", { className: "num", textContent: h ? `${h.rmssd.toFixed(0)} ms` : "—" }),
      el("td", { className: "num", textContent: `${Math.round((sn.result?.quality ?? 0) * 100)}%` }),
      el("td", { textContent: h ? (h.irregular ? "Irregular" : "Regular") : "—" }));
    tr.onclick = () => { showEcgResult(sn); window.scrollTo({ top: 0, behavior: "smooth" }); };
    return tr;
  });
  list.append(el("table", {}, el("thead", {}, head), el("tbody", {}, ...body)));
}

// ---------- Calibrate ----------

async function savePair(e) {
  e.preventDefault();
  const num = (id) => { const v = parseInt($(id).value, 10); return Number.isFinite(v) ? v : null; };
  const pair = { band: state.mac ?? "unpaired", t: stamp(), ref_sys: num("refSys"), ref_dia: num("refDia"),
    ref_hr: num("refHr"), ref_spo2: num("refSpo2"), context: $("refNote").value.trim() || null };
  if (!pair.ref_sys && !pair.ref_spo2) { notice("Enter a cuff or oximeter reading first."); return; }
  if (pair.ref_sys && (pair.ref_sys < 60 || pair.ref_sys > 250 || !pair.ref_dia || pair.ref_dia < 30 || pair.ref_dia >= pair.ref_sys)) {
    notice("That cuff reading looks off. Check systolic and diastolic."); return;
  }
  if (pair.ref_spo2 && (pair.ref_spo2 < 70 || pair.ref_spo2 > 100)) { notice("SpO₂ should be between 70 and 100."); return; }
  await db.put(state.db, "pair", pair);
  for (const id of ["refSys", "refDia", "refHr", "refSpo2", "refNote"]) $(id).value = "";
  notice(null);
  await renderCalibration();
}

async function renderCalibration() {
  const [pairs, hrv, spo2] = await Promise.all([db.all(state.db, "pair"), db.all(state.db, "hrv_vendor"), db.all(state.db, "spo2")]);
  const s = summarize(pairs, hrv, spo2);
  const fmt = (x, unit) => (x ? `${x.mean >= 0 ? "+" : "−"}${Math.abs(x.mean).toFixed(1)} ± ${x.sd.toFixed(1)} ${unit} (${x.n})` : "Not enough pairs yet");
  $("calStats").replaceChildren(
    el("dt", { textContent: "Readings logged" }), el("dd", { textContent: pairs.length }),
    el("dt", { textContent: "Systolic, band − cuff" }), el("dd", { textContent: fmt(s.sys, "mmHg") }),
    el("dt", { textContent: "Diastolic, band − cuff" }), el("dd", { textContent: fmt(s.dia, "mmHg") }),
    el("dt", { textContent: "SpO₂, band − oximeter" }), el("dd", { textContent: fmt(s.spo2, "%") }));
  $("calNote").textContent = pairs.length && !s.matched.bp && !s.matched.spo2
    ? "No reading has a band measurement within 15 minutes yet. Sync after the band's next automatic reading."
    : "Error shown as average ± spread (number of matched pairs). The band's figure is only shown once it beats simply predicting your usual reading.";
  const list = $("pairList");
  list.replaceChildren();
  if (!pairs.length) { list.append(el("p", { className: "sub", textContent: "None yet." })); return; }
  const head = el("tr", {}, el("th", { textContent: "When" }), el("th", { className: "num", textContent: "Cuff" }),
    el("th", { className: "num", textContent: "Pulse" }), el("th", { className: "num", textContent: "SpO₂" }), el("th", { textContent: "Note" }));
  const body = pairs.sort(byT).reverse().map((p) => el("tr", {},
    el("td", { textContent: `${p.t.slice(5, 10)} ${hhmm(p.t)}` }),
    el("td", { className: "num", textContent: p.ref_sys ? `${p.ref_sys}/${p.ref_dia}` : "—" }),
    el("td", { className: "num", textContent: p.ref_hr ?? "—" }), el("td", { className: "num", textContent: p.ref_spo2 ?? "—" }),
    el("td", { textContent: p.context ?? "" })));
  list.append(el("table", {}, el("thead", {}, head), el("tbody", {}, ...body)));
}

// ---------- Band ----------

async function renderBand(band) {
  const info = state.band?.connected ? state.info : {};
  const rows = [
    ["Status", state.band?.connected ? "Connected" : "Not connected"],
    ["Name", state.band?.name ?? band?.name ?? "—"],
    ["Battery", info.battery != null ? `${info.battery}%` : band?.battery != null ? `${band.battery}% (last sync)` : "—"],
    ["Firmware", info.firmware ?? band?.firmware ?? "—"],
    ["Band clock", info.clock ?? "—"],
    ["Last sync", band?.last_sync ?? "—"],
  ];
  $("bandInfo").replaceChildren(...rows.flatMap(([k, v]) => [el("dt", { textContent: k }), el("dd", { textContent: v })]));
  const batt = info.battery ?? band?.battery;
  $("battery").hidden = batt == null;
  if (batt != null) {
    $("battery").classList.toggle("low", batt <= 20);
    $("battery").firstElementChild.style.width = `${Math.max(3, Math.min(100, batt))}%`;
  }
  const c = await db.counts(state.db);
  $("storeInfo").replaceChildren(...[["Heart-rate readings", c.hr], ["Blood-oxygen readings", c.spo2],
    ["Temperature readings", c.temp], ["Band HRV/BP estimates", c.hrv_vendor], ["Reference readings", c.pair]]
    .flatMap(([k, v]) => [el("dt", { textContent: k }), el("dd", { textContent: v.toLocaleString() })]));
}

async function exportData() {
  const data = await db.exportAll(state.db);
  const name = `pulse-${stamp().slice(0, 10)}.json`;
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const file = new File([blob], name, { type: "application/json" });
  if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: name }).catch(() => {}); return; }
  const a = el("a", { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10e3);
}

// ---------- demo data (separate database; ?demo) ----------

async function seedDemo() {
  if ((await db.counts(state.db)).hr) return;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const now = new Date(), hr = [], temp = [], spo2 = [], hrv = [];
  for (let m = 7 * 1440; m >= 0; m--) {
    const d = new Date(now - m * 60e3), h = d.getHours() + d.getMinutes() / 60;
    if (h > 13 && h < 14.2 && d.getDate() % 3 === 0) continue; // band off for a while some days
    const asleep = h < 6.5 || h > 23;
    const base = asleep ? 54 + 4 * Math.cos(((h + 1) / 8) * Math.PI) : 68 + 8 * Math.sin((h / 24) * Math.PI);
    const workout = !asleep && Math.abs(h - 18) < 0.5 && d.getDay() % 2 === 0 ? 55 * Math.cos((h - 18) * Math.PI) : 0;
    hr.push({ band: "DEMO", t: stamp(d), bpm: Math.round(base + workout + (rnd() - 0.5) * 6), source: "auto" });
    if (m % 30 === 0) temp.push({ band: "DEMO", t: stamp(d), c: Math.round((asleep ? 34.4 : 32.6) * 10 + (rnd() - 0.5) * 6) / 10 });
    if (m % 60 === 0 && asleep) spo2.push({ band: "DEMO", t: stamp(d), pct: 95 + Math.round(rnd() * 4) });
    if (m % 120 === 0) hrv.push({ band: "DEMO", t: stamp(d), hrv_ms: 40 + Math.round(rnd() * 25), vascular_aging: 0, hr: 62,
      stress: 30, bp_sys: 118 + Math.round(rnd() * 12), bp_dia: 76 + Math.round(rnd() * 8) });
  }
  await db.insert(state.db, "hr", hr); await db.insert(state.db, "temp", temp);
  await db.insert(state.db, "spo2", spo2); await db.insert(state.db, "hrv_vendor", hrv);
  for (const [mins, s, d] of [[240, 121, 79], [1680, 118, 77], [3120, 124, 81]]) {
    const target = now - mins * 60e3;
    const nearest = hrv.reduce((a, b) => (Math.abs(toMs(b.t) - target) < Math.abs(toMs(a.t) - target) ? b : a));
    await db.put(state.db, "pair", { band: "DEMO", t: stamp(new Date(toMs(nearest.t) + 5 * 60e3)), ref_sys: s, ref_dia: d,
      ref_hr: 63, ref_spo2: 97, context: "Seated 5 min" });
  }
  // A night of per-minute sleep stages (23:40 to 06:50), cycling roughly every 90 minutes.
  const sleepRows = [];
  const bed = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 40);
  for (let m = 0; m < 430; m++) {
    const phase = (m % 90) / 90, late = m / 430;
    let st = phase < 0.15 ? 2 : phase < (0.45 - 0.3 * late) ? 1 : phase < (0.75 - 0.1 * late) ? 2 : 3;
    if (m < 4 || rnd() < 0.01) st = 4;
    sleepRows.push({ band: "DEMO", t: stamp(new Date(bed.getTime() + m * 60e3)), stage: st });
  }
  await db.insert(state.db, "sleep", sleepRows);
  await db.put(state.db, "daily", { band: "DEMO", date: stamp(now).slice(0, 10), steps: 6421, sport: 0, km: 4.3, kcal: 238 });

  // A synthetic 35 s finger ECG (P, QRS, T; slight breathing-linked RR variation; wander and noise).
  const x = [], fs = ECG_FS;
  let beat = 0.4;
  const g = (t, c, w, a) => a * Math.exp(-(((t - c) / w) ** 2));
  const beats = [];
  while (beat < 35) { beats.push(beat); beat += 0.8 + 0.04 * Math.sin(beat * 1.6) + (rnd() - 0.5) * 0.03; }
  for (let i = 0; i < 35 * fs; i++) {
    const t = i / fs;
    let v = 0.3 * Math.sin(t * 0.7) + (rnd() - 0.5) * 0.06;
    for (const b of beats) if (Math.abs(t - b) < 0.5) v += g(t, b - 0.16, 0.025, 0.12) + g(t, b, 0.012, 1.1) - g(t, b + 0.03, 0.012, 0.25) + g(t, b + 0.25, 0.05, 0.25);
    x.push(v);
  }
  const res = ecgSummary(x, fs, ECG_SETTLE);
  await db.put(state.db, "ecg", { band: "DEMO", t: stamp(new Date(now - 45 * 60e3)), fs, arrival_rate: 254, n: x.length,
    samples: Float32Array.from(x), result: { hrv: res.hrv, quality: res.quality, peaks: res.peaks, good: res.good } });
  await db.put(state.db, "band", { mac: "DEMO", name: "JCV8B DEMO", firmware: "0.0.8.8", battery: 82,
    last_sync: stamp(new Date(now - 12 * 60e3)), snapshot: { steps: 6421, hr: 71, temp_c: 32.4 }, snapshot_at: stamp(new Date(now - 12 * 60e3)) });
}

// ---------- boot ----------

function showView(name) {
  for (const v of ["today", "trends", "ecg", "calibrate", "band"]) $(`view-${v}`).hidden = v !== name;
  for (const b of document.querySelectorAll(".tabbar button")) b.classList.toggle("on", b.dataset.view === name);
  window.scrollTo({ top: 0 });
  if (name === "today") render();
  if (name === "ecg") renderEcgList();
  if (name === "trends") renderTrends();
  if (name === "band") loadProfile();
}

// If the page's lockdown policy ever blocks something (e.g. a browser's Bluetooth bridge), say so.
document.addEventListener("securitypolicyviolation", (e) => {
  log(`Blocked by page policy: ${e.violatedDirective} ${e.blockedURI || "(inline)"}`, true);
});

async function main() {
  state.db = await db.open(DEMO ? "jcv8-demo" : undefined);
  if (DEMO) {
    $("demoBanner").hidden = false;
    await seedDemo();
    if (!(await db.getSetting(state.db, "profile"))) await db.setSetting(state.db, "profile", { age: 40, sex: "male", height: 178, weight: 78 });
  }
  $("connect").onclick = () => connect(false);
  $("connectAll").onclick = () => connect(true);
  $("chip").onclick = () => showView("band");
  $("sync").onclick = sync;
  $("live").onclick = toggleLive;
  $("disconnect").onclick = () => state.band?.disconnect();
  $("export").onclick = exportData;
  $("pairForm").onsubmit = savePair;
  $("ecgStart").onclick = toggleEcg;
  $("profileForm").onsubmit = saveProfile;
  $("goEcg").onclick = () => showView("ecg");
  $("tableToggle").onclick = () => {
    state.showTable = !state.showTable;
    $("hrTable").hidden = !state.showTable;
    $("tableToggle").textContent = state.showTable ? "Hide table" : "Show as table";
  };
  for (const b of document.querySelectorAll(".segmented button")) {
    b.onclick = () => {
      state.range = Number(b.dataset.range);
      for (const o of document.querySelectorAll(".segmented button")) o.classList.toggle("on", o === b);
      render();
    };
  }
  for (const b of document.querySelectorAll(".tabbar button")) b.onclick = () => showView(b.dataset.view);
  if (!navigator.bluetooth && !DEMO) notice("This browser can't use Bluetooth. On iPhone, open this page in the Bluefy app.");
  const build = new URL(import.meta.url).searchParams.get("v") ?? "dev";
  log(`Pulse ${build} ready (${navigator.bluetooth ? "Bluetooth available" : "no Bluetooth in this browser"})`);
  let resizeTimer;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 150); });
  setControls();
  await render();
}

main().catch((e) => { notice(e.message); log(`${e.name}: ${e.message}`, true); });
