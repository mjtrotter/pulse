// Pulse v3 shell: boot, band connection and sync, the four tabs (Today, Night, Measure, Profile), the
// full-screen drill-down, sheets, and every tap. Screens are rendered from the model in v3/model.js.
import { Band } from "./core/ble.js?v=20260925225520";
import * as db from "./core/db.js?v=20260925225520";
import { DEFAULT_SCHEDULE, syncBand } from "./core/sync.js?v=20260925225520";
import { stamp } from "./core/time.js?v=20260925225520";
import { ftInToCm, isUS, lbToKg, setUnits } from "./core/units.js?v=20260925225520";
import { ensureSummaries, recomputeDays } from "./analytics/summary.js?v=20260925225520";
import { scoreDays } from "./analytics/scores.js?v=20260925225520";
import { mergeLabPanel } from "./analytics/labs.js?v=20260925225520";
import { buildModel } from "./v3/model.js?v=20260925225520";
import { D, SCRUB, css, esc, relMin, resetUid, root, st, stateOf } from "./v3/kit.js?v=20260925225520";
import { drill, M } from "./v3/drill.js?v=20260925225520";
import { today } from "./v3/today.js?v=20260925225520";
import { night } from "./v3/night.js?v=20260925225520";
import { trends } from "./v3/trends.js?v=20260925225520";
import { analyze, analyzed, current, ecgOverview, ecgTrace, hrvPanel, liveView, measure, recView, runRecording } from "./v3/measure.js?v=20260925225520";
import { onboarding, profile, sheet } from "./v3/profile.js?v=20260925225520";
import { labReviewSheet, normKey, preventCard } from "./v3/labsui.js?v=20260925225520";
import { advSheet } from "./v3/advanced.js?v=20260925225520";
import { cycleView } from "./v3/cycleui.js?v=20260925225520";

const params = new URLSearchParams(location.search);
const DEMO = params.has("demo");
const PREVIEW = location.pathname.includes("/next/");
const DB = DEMO ? "jcv8-demo3" : PREVIEW ? "jcv8-next" : db.DB_NAME;
const TABS = { today: "Live", night: "Sleep", trends: "Trends", measure: "Measure", profile: "Profile" };
const $ = (s, r = document) => r.querySelector(s);

export const ctx = {
  demo: DEMO, preview: PREVIEW, store: null, profile: {}, band: null, mac: null, info: {},
  conn: "off", status: "", busy: false, logLines: [],
  log(text, isError = false) { ctx.logLines.unshift({ t: stamp().slice(11), text, isError }); ctx.logLines.length = Math.min(ctx.logLines.length, 200); },
  async setProfile(p) { ctx.profile = p; await db.setSetting(ctx.store, "profile", p); applyPrefs(); },
  setStatus(conn, status = "") { ctx.conn = conn; ctx.status = status; paintStatus(); },
  connect, sync, disconnect,
};

function applyPrefs() {
  setUnits(ctx.profile.units ?? "us");
  const theme = ctx.profile.theme ?? "auto";
  root.dataset.theme = theme === "auto" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : theme;
}

// ---------- connection & sync ----------
async function connect({ auto = false } = {}) {
  if (DEMO) { if (!auto) toast("Demo mode can't connect. Open Pulse without ?demo to use your band."); return false; }
  if (!navigator.bluetooth) { toast(/android/i.test(navigator.userAgent) ? "Open Pulse in Chrome to use Bluetooth." : "Open Pulse in the Bluefy app to use Bluetooth."); return false; }
  ctx.setStatus("connecting", "Connecting…");
  try {
    // requestDevice must run straight from the tap, so nothing is awaited before Band.choose.
    const band = auto ? await Band.reconnect({ log: ctx.log, mac: await db.getSetting(ctx.store, "band_name"), id: await db.getSetting(ctx.store, "band_id") }) : await Band.choose({ log: ctx.log });
    if (!band) { ctx.setStatus("off"); return false; }
    adoptBand(band);
    if (!auto) { // chosen in the picker: this phone switches to it, remembers it by id, and forgets any other band
      ctx.picked = true; ctx.noAuto = false;
      if (band.device.id) await db.setSetting(ctx.store, "band_id", band.device.id);
      const gone = await Band.forgetOthers(band.device).catch(() => 0);
      if (gone) ctx.log(`Forgot ${gone} other band${gone > 1 ? "s" : ""} this phone remembered`);
    }
    await db.setSetting(ctx.store, "band_name", band.name);
    ctx.setStatus("on", band.name);
    await sync();
    return true;
  } catch (e) {
    const cancelled = e.name === "NotFoundError" && /cancel/i.test(e.message);
    ctx.log(`${e.name}: ${e.message}`, !cancelled);
    ctx.band = null; ctx.setStatus("off");
    if (!cancelled && !auto) toast(e.name === "NotFoundError" ? "No band found. Make sure it's charged, nearby, and not connected to another phone." : `Couldn't connect: ${e.message}`, 5000);
    return false;
  }
}
/** Keeps a handle on the band so it can be reconnected without the picker (iOS closes the link whenever
 *  Bluefy goes to the background; the picker needs a tap, but reconnecting a known device doesn't). */
function adoptBand(band) {
  ctx.band = band; ctx.lastBand = band;
  band.onDisconnect = () => {
    ctx.band = null; ctx.busy = false; ctx.setStatus("off");
    if (document.visibilityState === "visible") setTimeout(() => reconnectQuietly(), 2500); // dropped while in use: try again
  };
}
let reconnecting = false;
async function reconnectQuietly() {
  if (DEMO || ctx.band?.connected || reconnecting || !ctx.profile.onboarded || ctx.noAuto) return false;
  reconnecting = true;
  try {
    for (const wait of [0, 1500, 4000]) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      if (document.visibilityState !== "visible") return false;
      ctx.setStatus("connecting", "Reconnecting…");
      try {
        let band = null;
        if (ctx.lastBand) { await Promise.race([ctx.lastBand.connect(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000))]); band = ctx.lastBand; }
        else band = await Band.reconnect({ log: ctx.log, mac: await db.getSetting(ctx.store, "band_name"), id: await db.getSetting(ctx.store, "band_id") });
        if (band?.connected) { adoptBand(band); ctx.setStatus("on", band.name); ctx.log("Reconnected without the picker"); await sync(); return true; }
      } catch (e) { ctx.log(`Reconnect attempt: ${e.message}`); }
    }
    ctx.setStatus("off");
    return false;
  } finally { reconnecting = false; }
}

async function sync() {
  if (!ctx.band?.connected || ctx.busy || st.recRun) return;
  ctx.busy = true;
  try {
    const expectMac = ctx.picked ? null : await db.getSetting(ctx.store, "band_mac");
    const res = await syncBand(ctx.band, ctx.store, { onStep: (t) => ctx.setStatus("syncing", t), log: ctx.log, expectMac });
    ctx.mac = res.mac; ctx.info = res.info; ctx.picked = false;
    if (res.info?.mac) await db.setSetting(ctx.store, "band_mac", res.info.mac);
    ctx.setStatus("syncing", "Analysing…");
    await recomputeDays(ctx.store, db, res.dates, ctx.profile, scoreDays);
    ctx.setStatus("on", "Synced just now");
  } catch (e) {
    // Someone else's band answered an automatic reconnect: let go of it at once (a band talks to one phone at a
    // time) and stop reconnecting until the person picks a band themselves.
    if (e.name === "OtherBand") { ctx.noAuto = true; ctx.lastBand = null; ctx.band?.disconnect(); }
    ctx.log(`Sync stopped: ${e.name}: ${e.message}`, true);
    toast(`Sync stopped: ${e.message}`, 5000);
    ctx.setStatus(ctx.band?.connected ? "on" : "off");
  } finally {
    ctx.busy = false;
    invalidate();
    if (!modal) await render(false);
  }
}
function disconnect() { ctx.band?.disconnect(); }
function paintStatus() {
  const busy = ctx.conn === "connecting" || ctx.conn === "syncing";
  for (const el of document.querySelectorAll("[data-syncchip]")) {
    el.classList.toggle("busy", busy); el.classList.toggle("on", ctx.conn === "on");
    const s = el.querySelector("span"); if (s) s.textContent = busy ? ctx.status || "Syncing…" : syncText();
  }
  const ob = $("#obStatus"); if (ob) ob.textContent = ctx.status ?? "";
}
function syncText() {
  const t = D.band?.last_sync;
  if (ctx.conn === "on") return t ? `Synced ${relMin((Date.now() - new Date(t.replace(" ", "T")).getTime()) / 60e3)}` : "Connected";
  return t ? `Synced ${relMin((Date.now() - new Date(t.replace(" ", "T")).getTime()) / 60e3)}` : "Connect";
}

// ---------- model ----------
let model = null, nightParam = params.get("night") != null ? +params.get("night") : null;
const invalidate = () => { model = null; };
async function prepare() {
  if (!model) model = await buildModel(ctx.store, ctx.profile);
  const m = model;
  Object.assign(D, { profile: ctx.profile, hist: m.hist, L: m.L, latest: m.hist[m.L], typical: m.typical, T: m.today, goal: m.goal, band: m.band, ecg: m.ecg, bp: m.bp, labs: m.labs, events: m.events ?? [], bandBp: m.bandBp ?? [], advData: m.adv, cycle: m.cycle });
  D.nights = m.hist.map((h, i) => (h.hasNight ? i : -1)).filter((i) => i >= 0);
  D.week = m.hist.slice(-7, -1).reduce((a, h) => a + (h.mvpa ?? 0), 0) + (m.today?.mvpa ?? 0);
  if (nightParam != null) { st.sel = Math.max(0, m.L - nightParam); nightParam = null; }
  const defNight = D.nights.length ? D.nights[D.nights.length - 1] : m.L;
  D.i = st.tab === "night" && st.sel != null && m.hist[st.sel] ? st.sel : st.tab === "night" ? defNight : m.L;
  D.H = m.hist.slice(0, D.i + 1); D.last = m.hist[D.i];
  D.nt = D.last?.hasNight ? await m.night(D.i) : null;
  D.syncText = syncText();
  if (st.tab === "profile") { D.counts = await db.counts(ctx.store); D.schedule = await db.getSetting(ctx.store, "schedule"); }
}

// ---------- render ----------
let renderSeq = 0;
async function render(anim = true) {
  const seq = ++renderSeq;
  if (!ctx.profile.onboarded) return renderOnboarding();
  await prepare();
  if (seq !== renderSeq) return;
  resetUid();
  for (const k of Object.keys(SCRUB)) delete SCRUB[k];
  root.dataset.state = stateOf(st.tab === "night" ? D.last?.rec : D.latest?.rec);
  if (D.last?.br) root.style.setProperty("--breath-s", `${(60 / D.last.br).toFixed(2)}s`);
  const app = $("#app");
  app.classList.toggle("still", !anim);
  let html = "";
  try { html = st.tab === "today" ? today(ctx) : st.tab === "night" ? night(ctx) : st.tab === "trends" ? trends(ctx) : st.tab === "measure" ? measure(ctx) : profile(ctx); }
  catch (e) { console.error(e); ctx.log(`Screen error: ${e.message}`, true); html = `<div class="card"><b>Something went wrong</b><p class="note">${esc(e.message)}</p></div>`; }
  app.innerHTML = html;
  $("#tabbar").hidden = false;
  for (const b of document.querySelectorAll(".tabbar [data-tab]")) b.classList.toggle("on", b.dataset.tab === st.tab);
  if (st.tab === "night") { const on = $(".nd.on"), s = $("#nstrip"); if (on && s) s.scrollLeft = on.offsetLeft - s.clientWidth + on.clientWidth + 8; }
  if (st.tab === "measure") pump();
  sweep(); countUp(app);
}
function renderOnboarding() {
  $("#tabbar").hidden = true;
  $("#app").innerHTML = onboarding(ctx);
}
function sweep() { requestAnimationFrame(() => requestAnimationFrame(() => { for (const a of document.querySelectorAll(".arc[data-to]")) a.setAttribute("stroke-dashoffset", a.dataset.to); })); }
function countUp(scope) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const el of scope.querySelectorAll("[data-count]")) {
    const to = +el.dataset.count, t0 = performance.now(), node = el.firstChild;
    if (!node || !Number.isFinite(to)) continue;
    const step = (t) => { const f = Math.min(1, (t - t0) / 900), e = 1 - (1 - f) ** 3; node.textContent = Math.round(to * e); if (f < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
}
let pumping = false;
function pump() {
  if (pumping) return; pumping = true;
  const next = () => {
    const sn = D.ecg?.find((z) => !analyzed(z));
    if (!sn) { pumping = false; if (st.tab === "measure" && !modal && D.ecg?.length) { const y = scrollY; render(false).then(() => scrollTo(0, y)); } return; }
    analyze(sn); setTimeout(next, 16);
  };
  if (D.ecg?.some((z) => !analyzed(z))) setTimeout(next, 200); else pumping = false;
}
async function setTab(t) { st.tab = t; st.draft.clear(); await render(); scrollTo(0, 0); }
async function stay() { const y = scrollY; await render(false); scrollTo(0, y); }

// ---------- modal ----------
let modal = null, origin = null, openKey = null, modalKind = null;
function modalHtml() { return modalKind === "rec" ? recView() : modalKind === "live" ? liveView(ctx) : modalKind === "cycle" ? cycleView() : drill(openKey, TABS[st.tab]); }
function openModal(el, kind, key) {
  origin = el; modalKind = kind; openKey = key; st.view = "now";
  if (kind === "rec") { st.recOpen = key; st.ecgStart = 0; }
  const r = el.getBoundingClientRect();
  modal = document.createElement("div");
  modal.className = "modal";
  modal.style.setProperty("--mcolor", css(kind === "drill" ? M[key].color : kind === "cycle" ? "--sleep" : "--heart"));
  Object.assign(modal.style, { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px`, transition: "none" });
  try { modal.innerHTML = modalHtml(); } catch (e) { console.error(e); modal.innerHTML = `<div class="inner"><button class="back" data-close>‹ Back</button><p class="note">${esc(e.message)}</p></div>`; }
  document.body.append(modal);
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const e = "cubic-bezier(.2,.85,.2,1)";
    modal.style.transition = `top .46s ${e}, left .46s ${e}, width .46s ${e}, height .46s ${e}, border-radius .46s ${e}`;
    Object.assign(modal.style, { top: "0px", left: "0px", width: "100vw", height: "100vh", borderRadius: "0px" });
    setTimeout(() => modal?.classList.add("full"), 400);
  }));
}
function redrawModal() { if (!modal) return; const s = modal.scrollTop; try { modal.innerHTML = modalHtml(); } catch (e) { console.error(e); } modal.classList.add("full"); modal.scrollTop = s; }
function closeModal() {
  if (!modal) return;
  if (st.recRun) st.recRun.stop = true;
  const r = origin?.isConnected ? origin.getBoundingClientRect() : { top: innerHeight / 2 - 20, left: innerWidth / 2 - 20, width: 40, height: 40 }, m = modal;
  m.classList.remove("full"); m.scrollTop = 0;
  Object.assign(m.style, { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: "24px" });
  modal = null; document.body.style.overflow = "";
  setTimeout(() => m.remove(), 470);
}

// ---------- sheets & toast ----------
function showSheet(kind) {
  closeSheet();
  const s = document.createElement("div");
  s.className = "sheet-wrap";
  s.innerHTML = `<div class="sheet-bg" data-sheetclose></div><div class="sheet" role="dialog" aria-modal="true">${kind === "labreview" ? labReviewSheet(st.labDraft ?? {}) : kind.startsWith("adv:") ? advSheet(kind.slice(4)) : sheet(kind, ctx)}</div>`;
  document.body.append(s);
  requestAnimationFrame(() => s.classList.add("on"));
}
function closeSheet() { for (const s of document.querySelectorAll(".sheet-wrap")) { s.classList.remove("on"); setTimeout(() => s.remove(), 300); } }
let toastTimer = null;
function toast(text, ms = 3200) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); el.textContent = text;
  document.body.append(el); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.remove(), ms);
}

// ---------- data actions ----------
async function rebuild(all = false) {
  if (all) { const tx = ctx.store.transaction("summary", "readwrite"); tx.objectStore("summary").clear(); await new Promise((ok) => { tx.oncomplete = ok; }); }
  else { const rows = await db.all(ctx.store, "summary"); await db.putMany(ctx.store, "summary", rows.map((r) => ({ ...r, v: -1 }))); }
  await ensureSummaries(ctx.store, db, ctx.profile, scoreDays, (t) => ctx.setStatus(ctx.conn, t));
  ctx.setStatus(ctx.conn); invalidate();
}
async function exportData() {
  const data = await db.exportAll(ctx.store);
  const name = `pulse-${(ctx.profile.name || "backup").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.json`;
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" }), f = new File([blob], name, { type: "application/json" });
  if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f], title: name }).catch(() => {});
  else { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10e3); }
  await db.setSetting(ctx.store, "last_backup", new Date().toISOString());
}
function importData() {
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = "application/json,.json";
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    try { const added = await db.importAll(ctx.store, JSON.parse(await f.text())); await rebuild(); toast(`Imported ${Object.values(added).reduce((a, b) => a + b, 0).toLocaleString()} readings`); await stay(); }
    catch (e) { toast(`Couldn't import: ${e.message}`); }
  };
  inp.click();
}
/** The main Pulse app (same site, database "jcv8") keeps its own history. /next/ can copy it: read-only on
 *  the source; opening it without a version number never upgrades it. */
async function probeLive() {
  if (!PREVIEW || DEMO) return null;
  try {
    // No databases() in some engines: opening without a version and aborting the upgrade (which only fires
    // when the database doesn't exist) is a safe existence check that never creates or upgrades anything.
    if (indexedDB.databases && !(await indexedDB.databases()).some((d) => d.name === db.DB_NAME)) return null;
    const live = await new Promise((ok, err) => { const r = indexedDB.open(db.DB_NAME); r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error); r.onupgradeneeded = () => r.transaction.abort(); });
    const has = (s) => live.objectStoreNames.contains(s);
    const count = (s) => (has(s) ? new Promise((ok) => { const q = live.transaction(s).objectStore(s).count(); q.onsuccess = () => ok(q.result); q.onerror = () => ok(0); }) : 0);
    const prof = has("settings") ? await new Promise((ok) => { const q = live.transaction("settings").objectStore("settings").get("profile"); q.onsuccess = () => ok(q.result?.value ?? null); q.onerror = () => ok(null); }) : null;
    const out = { hr: await count("hr"), name: prof?.name ?? null };
    live.close();
    return out.hr > 0 ? out : null;
  } catch { return null; }
}
async function copyLive() {
  ctx.setStatus(ctx.conn, "Copying your data…"); toast("Copying your data…", 8000);
  const live = await new Promise((ok, err) => { const r = indexedDB.open(db.DB_NAME); r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error); r.onupgradeneeded = () => r.transaction.abort(); });
  let n = 0;
  for (const s of ["band", "hr", "hrv_vendor", "spo2", "temp", "measurement", "ecg", "sleep", "daily", "activity", "ppi", "osa", "battery_log", "bp", "tags"]) {
    if (!live.objectStoreNames.contains(s)) continue;
    const rows = await new Promise((ok) => { const q = live.transaction(s).objectStore(s).getAll(); q.onsuccess = () => ok(q.result); q.onerror = () => ok([]); });
    n += await db.insert(ctx.store, s, rows).catch(() => 0);
  }
  const prof = await new Promise((ok) => { const q = live.transaction("settings").objectStore("settings").get("profile"); q.onsuccess = () => ok(q.result?.value ?? null); q.onerror = () => ok(null); });
  const bandName = await new Promise((ok) => { const q = live.transaction("settings").objectStore("settings").get("band_name"); q.onsuccess = () => ok(q.result?.value ?? null); q.onerror = () => ok(null); });
  live.close();
  if (prof && !ctx.profile.age) await ctx.setProfile({ ...prof, ...ctx.profile, name: ctx.profile.name || prof.name, age: prof.age, sex: prof.sex, height: prof.height, weight: prof.weight });
  if (bandName && !(await db.getSetting(ctx.store, "band_name"))) await db.setSetting(ctx.store, "band_name", bandName);
  if (ctx.profile.age && ctx.profile.sex) await ctx.setProfile({ ...ctx.profile, onboarded: true });
  if (!(await db.getSetting(ctx.store, "schedule"))) await db.setSetting(ctx.store, "schedule", DEFAULT_SCHEDULE);
  await rebuild();
  ctx.log(`Copied ${n.toLocaleString()} rows from the main Pulse app`);
  toast(`Brought in ${n.toLocaleString()} readings`);
  if (!ctx.profile.onboarded) st.obStep = 1;
  await render();
}
/** Period logging (settings "periods" = [{start, end}]). */
async function logPeriod(action, date = null) {
  const d0 = new Date(), iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = iso(d0), yday = iso(new Date(d0.getTime() - 864e5));
  if (action === "dismiss") { st.cycleDismiss = D.latest?.date; await stay(); return; }
  const periods = ((await db.getSetting(ctx.store, "periods")) ?? []).sort((a, b) => (a.start < b.start ? -1 : 1));
  const open = periods.filter((p) => !p.end).pop();
  if (action.startsWith("start")) {
    const start = date ?? (action === "start-yday" ? yday : today);
    if (!periods.some((p) => Math.abs((new Date(p.start) - new Date(start)) / 864e5) < 10)) periods.push({ start, end: null });
    toast("Period start logged");
  } else if (action.startsWith("end")) {
    const end = date ?? (action === "end-yday" ? yday : today);
    if (open && end >= open.start) { open.end = end; toast("Period end logged"); } else { toast("No open period to end."); return; }
  }
  await db.setSetting(ctx.store, "periods", periods.sort((a, b) => (a.start < b.start ? -1 : 1)));
  invalidate(); if (!modal) await stay();
}
/** "Saved 47 results · 30 replace older values · 2 kept from a newer draw". */
function labSavedMsg(m, other) {
  const parts = [`Saved ${m.saved + other} results`];
  if (m.replaced) parts.push(`${m.replaced} replace older values`);
  if (m.newerElsewhere) parts.push(`${m.newerElsewhere} kept from a newer draw`);
  return parts.join(" · ");
}
/** Lab PDF → parsed on this phone (pdf.js, loaded only now) → review sheet. */
function pickLabPdf() {
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = "application/pdf,.pdf";
  inp.onchange = async () => {
    const file = inp.files[0]; if (!file) return;
    toast("Reading the report…", 15000);
    try {
      const { importLabPdf } = await import("./labs/pdfimport.js?v=20260925225520");
      st.labDraft = await importLabPdf(await file.arrayBuffer());
      document.querySelector(".toast")?.remove();
      showSheet("labreview");
    } catch (e) { ctx.log(`Lab PDF: ${e.message}`, true); toast(`Couldn't read that PDF: ${e.message}. You can type the values in instead.`, 6000); }
  };
  inp.click();
}
function readProfileForm(f, base) {
  const us = isUS(), age = parseInt(f.age.value, 10);
  const height = us ? ftInToCm(parseInt(f.ft?.value, 10) || 0, parseInt(f.in?.value, 10) || 0) : parseFloat(f.cm?.value);
  const w = parseFloat(f.wt.value), weight = us ? lbToKg(w) : w;
  if (!(age >= 18 && age <= 110)) { toast("Age should be between 18 and 110."); return null; }
  if (!f.sex.value) { toast("Please choose female or male."); return null; }
  if (!(height >= 120 && height <= 230)) { toast("Please check your height."); return null; }
  if (!(weight >= 30 && weight <= 250)) { toast("Please check your weight."); return null; }
  const wv = parseFloat(f.waist?.value), waist = Number.isFinite(wv) ? (us ? wv * 2.54 : wv) : null;
  if (waist != null && !(waist >= 50 && waist <= 200)) { toast("Please check your waist measurement."); return null; }
  return { ...base, name: f.name.value.trim(), age, sex: f.sex.value, height, weight, waist };
}

// ---------- taps ----------
document.addEventListener("click", async (e) => {
  const t = e.target, on = (sel) => t.closest(sel);
  if (on("[data-sheetclose]")) { closeSheet(); return; }
  if (on(".sheet")) return;
  // band connection: must call connect() synchronously from the tap
  if (on("[data-syncchip]") || on("[data-connect]")) { if (ctx.band?.connected) sync(); else if (ctx.conn !== "connecting") connect(); return; }
  if (on("[data-obconnect]")) { const ok = await connect(); if (ok) { if (ctx.profile.name && !ctx.band.name.includes(ctx.profile.name.slice(0, 12))) await ctx.band.rename(ctx.profile.name).catch(() => {}); await ctx.setProfile({ ...ctx.profile, onboarded: true }); toast("Band connected and synced"); render(); } return; }
  if (on("[data-obdone]")) { await ctx.setProfile({ ...ctx.profile, onboarded: true }); render(); return; }
  const ob = on("[data-ob]"); if (ob) { st.obStep = +ob.dataset.ob; renderOnboarding(); return; }
  if (on("[data-copylive]")) { copyLive().catch((err) => toast(`Couldn't copy: ${err.message}`)); return; }
  // inside a modal
  const v = on("[data-view]"), a = on("[data-agg]");
  if (modal && (v || a || on("[data-split]") || on("[data-showtags]"))) {
    if (v) st.view = v.dataset.view; if (a) st.agg = a.dataset.agg;
    if (on("[data-split]")) st.split = !st.split; if (on("[data-showtags]")) st.showTags = !st.showTags;
    redrawModal(); return;
  }
  const o2 = on("[data-open2]");
  if (modal && o2 && M[o2.dataset.open2]) { openKey = o2.dataset.open2; st.view = "now"; modal.style.setProperty("--mcolor", css(M[openKey].color)); redrawModal(); modal.scrollTop = 0; return; }
  if (on("[data-close]")) { closeModal(); if (on("[data-goto]")) setTimeout(() => $("#prompt")?.scrollIntoView({ behavior: "smooth", block: "center" }), 480); if (on("[data-golabs]")) setTimeout(async () => { await setTab("measure"); $("#labs")?.scrollIntoView({ behavior: "smooth" }); }, 480); return; }
  const ht = on("[data-hrvtab]"); if (ht) { st.hrvTab = ht.dataset.hrvtab; $("#hrvcard").innerHTML = hrvPanel(); return; }
  const j = on("[data-jump]"); if (j) { const E = current(); const r = E.iv.find((z) => !z.ok); if (r) st.ecgStart = Math.max(0, Math.min(E.dur - 8, r.t - 3)); $("#ecgcard").innerHTML = ecgTrace() + ecgOverview(); return; }
  const rl = on("[data-reclen]"); if (rl && !st.recRun) { st.recLen = +rl.dataset.reclen; redrawModal(); return; }
  const go = on("[data-recgo]");
  if (go) {
    if (st.recRun) { st.recRun.stop = true; return; }
    const sn = await runRecording(ctx, db, stamp);
    if (sn) { invalidate(); await prepare(); st.recOpen = sn.t; modalKind = "rec"; analyze(sn); redrawModal(); modal.scrollTop = 0; render(false); }
    return;
  }
  const dr = on("[data-delrec]");
  if (dr) { const sn = D.ecg.find((z) => z.t === dr.dataset.delrec); if (sn && confirm("Delete this recording from this phone?")) { await db.remove(ctx.store, "ecg", [sn.band, sn.t]); invalidate(); closeModal(); await stay(); } return; }
  // workout tags work on Today and inside the Activity drill-down
  const wk0 = on("[data-wkind]"), wr0 = on("[data-wrpe]");
  if (wk0 || wr0) {
    const p = (wk0 ?? wr0).closest("[data-wprompt]"), start = p.dataset.wprompt, key = [start.slice(0, 10), `workout ${start}`];
    if (wk0) await db.put(ctx.store, "tags", { date: start.slice(0, 10), tag: `workout ${start}`, type: wk0.dataset.wkind, rpe: null, minutes: +p.dataset.wmin });
    else { const row = await db.get(ctx.store, "tags", key); if (row) await db.put(ctx.store, "tags", { ...row, rpe: +wr0.dataset.wrpe }); }
    invalidate();
    if (modal) { await prepare(); redrawModal(); render(false); } else await stay();
    return;
  }
  const pa = on("[data-period]");
  if (pa) { await logPeriod(pa.dataset.period); if (modal) { invalidate(); await prepare(); redrawModal(); render(false); } return; }
  if (modal) return;
  // prompts
  const d = on("[data-draft]"); if (d) { const k = d.dataset.draft; st.draft.has(k) ? st.draft.delete(k) : st.draft.add(k); d.classList.toggle("on"); const sv = $("[data-answer=save]"); if (sv) sv.disabled = !st.draft.size; return; }
  const an = on("[data-answer]");
  if (an) { const h = D.last; await db.put(ctx.store, "tags", { date: h.date, tag: "night", tags: an.dataset.answer === "none" ? [] : [...st.draft], via: h.trig?.length ? "trigger" : "checkin", t: stamp() }); st.draft.clear(); invalidate(); await stay(); return; }
  const un = on("[data-undo]"); if (un) { await db.remove(ctx.store, "tags", [un.dataset.undo, "night"]); invalidate(); await stay(); return; }
  if (on("[data-gonight]")) { st.sel = null; await setTab("night"); setTimeout(() => $("#prompt")?.scrollIntoView({ behavior: "smooth", block: "center" }), 350); return; }
  const nb = on("[data-night]"); if (nb) { const i = +nb.dataset.night; st.sel = i; st.draft.clear(); await render(); scrollTo(0, 0); return; }
  const tb = on("[data-tab]"); if (tb) { setTab(tb.dataset.tab); return; }
  const em = on("[data-ecgm]"); if (em) { st.ecgMetric = em.dataset.ecgm; await stay(); return; }
  const ba = on("[data-bpagg]"); if (ba) { st.bpAgg = ba.dataset.bpagg; await stay(); return; }
  if (on("[data-allrecs]")) { st.allRecs = !st.allRecs; await stay(); return; }
  if (on("[data-record]")) { openModal(on("[data-record]"), "live"); return; }
  const rc = on("[data-rec]"); if (rc) { const sn = D.ecg.find((z) => z.t === rc.dataset.rec); if (sn) { analyze(sn); openModal(rc, "rec", sn.t); } return; }
  // profile
  const hz = on("[data-horizon]"); if (hz) { st.horizon = hz.dataset.horizon; $("#prevent").innerHTML = preventCard(ctx.profile); return; }
  const pt = on("[data-ptoggle]");
  if (pt) { const k = pt.dataset.ptoggle; await ctx.setProfile({ ...ctx.profile, [k]: !ctx.profile[k] }); if (k === "betablocker") await rebuild(); invalidate(); await stay(); return; }
  const th = on("[data-theme-set]"); if (th) { await ctx.setProfile({ ...ctx.profile, theme: th.dataset.themeSet }); await stay(); return; }
  const un2 = on("[data-units]"); if (un2) { await ctx.setProfile({ ...ctx.profile, units: un2.dataset.units }); await stay(); return; }
  const dn = on("[data-dense]"); if (dn) { await db.setSetting(ctx.store, "schedule", dn.dataset.dense === "on" ? DEFAULT_SCHEDULE : { spo2: 30, hrv: 60, osa: false }); toast("Applied at the next sync"); await stay(); return; }
  if (on("[data-sync]")) { sync(); return; }
  if (on("[data-disconnect]")) { disconnect(); return; }
  if (on("[data-export]")) { exportData(); return; }
  if (on("[data-import]")) { importData(); return; }
  if (on("[data-rebuild]")) { await rebuild(true); toast("Rebuilt"); await stay(); return; }
  if (on("[data-labpdf]")) { pickLabPdf(); return; }
  if (on("[data-cycle]") && !modal) { openModal(on("[data-cycle]"), "cycle"); return; }
  const ai = on("[data-advinfo]"); if (ai) { showSheet(`adv:${ai.dataset.advinfo}`); return; }
  if (on("[data-golabs2]")) { await setTab("measure"); setTimeout(() => $("#labs")?.scrollIntoView({ behavior: "smooth" }), 200); return; }
  const dl = on("[data-dellab]"); if (dl) { const labs = ((await db.getSetting(ctx.store, "labs")) ?? []).filter((x) => x.date !== dl.dataset.dellab); await db.setSetting(ctx.store, "labs", labs); invalidate(); await stay(); return; }
  const de = on("[data-delevent]"); if (de) { const events = ((await db.getSetting(ctx.store, "events")) ?? []).filter((x) => (x.id ?? x.date) !== de.dataset.delevent); await db.setSetting(ctx.store, "events", events); invalidate(); await stay(); return; }
  if (on("[data-allevents]")) { st.allEvents = !st.allEvents; await stay(); return; }
  const ex = on("[data-expand]"); if (ex) { const id = ex.dataset.expand; st.open.has(id) ? st.open.delete(id) : st.open.add(id); await stay(); return; }
  const sh = on("[data-sheet]"); if (sh) { showSheet(sh.dataset.sheet); return; }
  const tg = on("[data-tagg]"); if (tg) { st.tagg = tg.dataset.tagg; await stay(); return; }
  const tt = on("[data-ttopic]"); if (tt) { st.ttopic = tt.dataset.ttopic; await render(); scrollTo(0, 0); return; }
  const o = on("[data-open]"); if (o && M[o.dataset.open]) { openModal(o, "drill", o.dataset.open); if (o.dataset.openview) { st.view = o.dataset.openview; redrawModal(); } }
});

document.addEventListener("submit", async (e) => {
  const f = e.target.closest("form[data-form]"); if (!f) return;
  e.preventDefault();
  const kind = f.dataset.form;
  if (kind === "bp") {
    const s = parseInt(f.sys.value, 10), d = parseInt(f.dia.value, 10), p = parseInt(f.pulse.value, 10);
    if (!(s >= 70 && s <= 260 && d >= 30 && d <= 160 && d < s)) { toast("That reading looks off. Check the top and bottom numbers."); return; }
    await db.put(ctx.store, "bp", { t: stamp(), sys: s, dia: d, pulse: Number.isFinite(p) ? p : null, arm: null, note: "" });
    closeSheet(); toast(s > 180 || d > 120 ? "Saved. That's very high: rest 5 minutes and measure again; with chest pain, shortness of breath or weakness, call 911." : "Saved", s > 180 || d > 120 ? 8000 : 2500);
    invalidate(); await stay(); return;
  }
  if (kind === "profile" || kind === "obprofile") {
    const p = readProfileForm(f, ctx.profile); if (!p) return;
    if (kind === "obprofile") { p.betablocker = !!f.betablocker?.checked; await ctx.setProfile(p); if (!(await db.getSetting(ctx.store, "schedule"))) await db.setSetting(ctx.store, "schedule", DEFAULT_SCHEDULE); st.obStep = 2; renderOnboarding(); if (p.sex === "female" && !((await db.getSetting(ctx.store, "periods")) ?? []).length) showSheet("pastperiods"); return; }
    await ctx.setProfile(p); closeSheet(); await rebuild(); await stay(); return;
  }
  if (kind === "riskq") {
    const a = { ...(ctx.profile.risk ?? {}) };
    for (const k of ["famhx", "inflam", "women", "ancestry"]) { const r = f.querySelector(`input[name=${k}]:checked`); if (r) a[k] = r.value === "1"; }
    await ctx.setProfile({ ...ctx.profile, risk: a }); closeSheet(); await stay(); return;
  }
  if (kind === "event") {
    const label = f.label.value.trim(), date = f.date.value;
    if (!label || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast("Add what changed and the date."); return; }
    const events = (await db.getSetting(ctx.store, "events")) ?? [];
    events.push({ id: `${date}-${Date.now().toString(36)}`, date, label, kind: f.kind.value });
    await db.setSetting(ctx.store, "events", events); closeSheet(); toast("Saved"); invalidate(); await stay(); return;
  }
  if (kind === "stopbang") {
    const a = { ...(ctx.profile.stopbang ?? {}) };
    for (const k of ["snore", "tired", "observed", "pressure", "neck"]) { const r = f.querySelector(`input[name=${k}]:checked`); if (r) a[k] = r.value === "1"; }
    await ctx.setProfile({ ...ctx.profile, stopbang: a }); closeSheet(); await stay(); return;
  }
  if (kind === "pastperiods") {
    const periods = (await db.getSetting(ctx.store, "periods")) ?? [];
    for (const k of ["p1", "p2", "p3"]) { const d = f[k]?.value; if (d && !periods.some((p) => Math.abs((new Date(p.start) - new Date(d)) / 864e5) < 10)) periods.push({ start: d, end: null }); }
    // Past periods are over: give any that started more than a week ago an estimated 5-day length, so no
    // "has your period ended?" prompt fires for an old one. A period that just started stays open.
    periods.sort((a, b) => (a.start < b.start ? -1 : 1));
    const plus = (d, n) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
    const weekAgo = plus(new Date().toISOString().slice(0, 10), -7);
    for (const p of periods) if (!p.end && p.start < weekAgo) { p.end = plus(p.start, 4); p.endEstimated = true; }
    await db.setSetting(ctx.store, "periods", periods);
    closeSheet(); toast("Saved"); invalidate();
    if (!ctx.profile.onboarded) { st.obStep = 2; renderOnboarding(); } else if (modal) { await prepare(); redrawModal(); render(false); } else await stay();
    return;
  }
  if (kind === "period") {
    const periods = ((await db.getSetting(ctx.store, "periods")) ?? []).filter((p) => p.start !== f.start.value);
    if (f.end.value && f.end.value < f.start.value) { toast("The end date is before the start."); return; }
    periods.push({ start: f.start.value, end: f.end.value || null });
    await db.setSetting(ctx.store, "periods", periods.sort((a, b) => (a.start < b.start ? -1 : 1)));
    closeSheet(); toast("Period logged"); invalidate(); if (modal) { await prepare(); redrawModal(); render(false); } else await stay(); return;
  }
  if (kind === "labreview") {
    const v = {}, meta = {}, dr = st.labDraft ?? {};
    for (const [k0, x] of Object.entries(dr.values ?? {})) {
      const k = normKey(k0), use = f.querySelector(`[name="use_${k}"]`), val = parseFloat(f.querySelector(`[name="v_${k}"]`)?.value);
      if (use?.checked && Number.isFinite(val)) { v[k] = val; meta[k] = { unit: x.unit ?? null, flag: x.flag ?? null, ref: x.ref ?? null }; }
    }
    const extras = {}, qual = {};
    for (const [k, x] of Object.entries(dr.extras ?? {})) {
      const use = f.querySelector(`[name="use_x_${k}"]`), val = parseFloat(f.querySelector(`[name="v_x_${k}"]`)?.value);
      if (use?.checked && Number.isFinite(val)) extras[k] = { name: x.name, value: val, unit: x.unit ?? null, flag: x.flag ?? null, ref: x.ref ?? null };
    }
    for (const [k, q] of Object.entries(dr.qualitative ?? {})) qual[k] = { name: q.name, text: q.text };
    if (!Object.keys(v).length && !Object.keys(extras).length) { toast("Nothing selected to save."); return; }
    const m = mergeLabPanel(await db.getSetting(ctx.store, "labs"), { date: f.date.value, v, meta, extras, qual, source: "pdf", lab: dr.lab ?? null });
    await db.setSetting(ctx.store, "labs", m.labs);
    st.labDraft = null; closeSheet(); toast(labSavedMsg(m, Object.keys(extras).length + Object.keys(qual).length), 5000); invalidate(); await stay(); return;
  }
  if (kind === "labs") {
    const v = {};
    for (const el of f.querySelectorAll("input[inputmode=decimal]")) { const x = parseFloat(el.value); if (Number.isFinite(x)) v[el.name] = x; }
    if (!Object.keys(v).length) { toast("Enter at least one value."); return; }
    const m = mergeLabPanel(await db.getSetting(ctx.store, "labs"), { date: f.date.value, v, source: "manual" });
    await db.setSetting(ctx.store, "labs", m.labs);
    closeSheet(); toast(labSavedMsg(m, 0), 5000); invalidate(); await stay();
  }
});
document.addEventListener("input", (e) => {
  const s = e.target.closest("[data-whatif]"); if (!s) return;
  st.whatIf[s.dataset.whatif] = +s.value;
  const card = $("#prevent"), k = s.dataset.whatif;
  card.innerHTML = preventCard(ctx.profile);
  card.querySelector(`[data-whatif="${k}"]`)?.focus();
});
// Scrubbing: pointer over any registered chart moves the crosshair and fills the readout.
function scrubAt(el, clientX) {
  const id = el.dataset.scrub, R = SCRUB[id]; if (!R || !R.pts.length) return;
  const svg = el.querySelector("svg"), box = svg.getBoundingClientRect(), vx = ((clientX - box.left) / box.width) * R.W;
  let best = R.pts[0], bd = Infinity; for (const p of R.pts) { const d = Math.abs(p[0] - vx); if (d < bd) { bd = d; best = p; } }
  const xh = svg.querySelector(".xh"), xd = svg.querySelector(".xd");
  xh.setAttribute("x1", best[0]); xh.setAttribute("x2", best[0]); xh.style.opacity = 1;
  xd.setAttribute("cx", best[0]); xd.setAttribute("cy", best[1]); xd.style.opacity = 1;
  const ro = el.parentElement.querySelector(`[data-readout="${id}"]`); if (ro) { ro.innerHTML = best[2]; ro.classList.add("live"); }
}
function scrubEnd(el) {
  const id = el.dataset.scrub, R = SCRUB[id]; if (!R) return;
  const svg = el.querySelector("svg"); svg.querySelector(".xh").style.opacity = 0; svg.querySelector(".xd").style.opacity = 0;
  const ro = el.parentElement.querySelector(`[data-readout="${id}"]`); if (ro) { ro.innerHTML = R.idle; ro.classList.remove("live"); }
}
let dragOv = null;
function moveOv(e) {
  const E = current(), box = dragOv.querySelector("svg").getBoundingClientRect(), f = (e.clientX - box.left) / box.width;
  st.ecgStart = Math.max(0, Math.min(Math.max(0, E.dur - 8), f * E.dur - 4));
  const card = $("#ecgcard"); card.innerHTML = ecgTrace() + ecgOverview(); dragOv = card.querySelector("[data-ecgov]");
}
document.addEventListener("pointerdown", (e) => { const ov = e.target.closest("[data-ecgov]"); if (ov) { dragOv = ov; moveOv(e); } const s = e.target.closest("[data-scrub]"); if (s) scrubAt(s, e.clientX); });
document.addEventListener("pointermove", (e) => { if (dragOv) { moveOv(e); return; } const s = e.target.closest("[data-scrub]"); if (s) scrubAt(s, e.clientX); });
document.addEventListener("pointerup", () => { dragOv = null; });
document.addEventListener("pointerout", (e) => { const s = e.target.closest("[data-scrub]"); if (s && !s.contains(e.relatedTarget)) scrubEnd(s); });

// ---------- housekeeping ----------
let lastUpdateCheck = 0;
async function checkForUpdate() {
  const build = new URL(import.meta.url).searchParams.get("v");
  if (!build || Date.now() - lastUpdateCheck < 10 * 60e3) return;
  lastUpdateCheck = Date.now();
  try {
    const latest = (await (await fetch(new URL("../version.txt", import.meta.url), { cache: "no-store" })).text()).trim();
    if (/^\d{14}$/.test(latest) && latest > build && !$(".update-banner")) {
      const b = document.createElement("button"); b.className = "update-banner"; b.textContent = "Update available: tap to refresh"; b.onclick = () => location.reload();
      document.body.append(b);
    }
  } catch { /* offline */ }
}
async function prune() {
  const last = await db.getSetting(ctx.store, "last_prune");
  if (last && Date.now() - Date.parse(last) < 864e5) return;
  const cutoff = (days) => stamp(new Date(Date.now() - days * 864e5));
  const hr = await db.pruneBefore(ctx.store, "hr", cutoff(180));
  const raw = await db.pruneBefore(ctx.store, "raw_packet", cutoff(30), "t_rx");
  if (hr || raw) ctx.log(`Tidied storage: ${hr} old heart-rate rows, ${raw} raw packets`);
  await db.setSetting(ctx.store, "last_prune", new Date().toISOString());
}

async function main() {
  ctx.store = await db.open(DB);
  if (DEMO) {
    document.body.classList.add("demo");
    if (!(await db.getSetting(ctx.store, "profile"))) await db.setSetting(ctx.store, "profile", { name: "Alex", age: 58, sex: "male", height: 178, weight: 89, units: "us", onboarded: true });
    const { seedDemo } = await import("./demo.js?v=20260925225520");
    if (await seedDemo(ctx.store)) ctx.log("Demo data created");
    if (!(await db.getSetting(ctx.store, "labs"))) await db.setSetting(ctx.store, "labs", [
      { date: "2026-02-10", source: "demo", v: { tc: 238, ldl: 161, hdl: 41, tg: 212, glucose: 104, insulin: 12.8, a1c: 5.6, hscrp: 1.6, egfr: 84, apob: 118, alt: 31, tsh: 2.1, vitd: 24 } },
      { date: "2026-05-12", source: "demo", v: { tc: 226, ldl: 153, hdl: 42, tg: 166, glucose: 100, insulin: 10.4, a1c: 5.5, hscrp: 1.1, egfr: 85, apob: 111, alt: 28, tsh: 2.3, vitd: 31 } },
      { date: "2026-09-03", source: "demo", v: { tc: 218, ldl: 148, hdl: 44, tg: 131, glucose: 97, insulin: 8.9, a1c: 5.4, hscrp: 0.8, egfr: 86, apob: 104, alt: 25, tsh: 2.0, vitd: 38 } }]);
  }
  ctx.profile = (await db.getSetting(ctx.store, "profile")) ?? {};
  if (!ctx.profile.onboarded && ctx.profile.age && ctx.profile.sex) await ctx.setProfile({ ...ctx.profile, onboarded: true });
  applyPrefs();
  if (TABS[params.get("tab")]) st.tab = params.get("tab");
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { if ((ctx.profile.theme ?? "auto") === "auto") { applyPrefs(); stay(); } });
  const build = new URL(import.meta.url).searchParams.get("v") ?? "dev";
  ctx.log(`Pulse ${build} ready (${navigator.bluetooth ? "Bluetooth available" : "no Bluetooth in this browser"})`);
  D.liveDb = await probeLive();
  await render();
  await ensureSummaries(ctx.store, db, ctx.profile, scoreDays, (t) => ctx.setStatus(ctx.conn, t)).catch((e) => ctx.log(`Analysis: ${e.message}`, true));
  ctx.setStatus(ctx.conn); invalidate();
  if (ctx.profile.onboarded) await render(false);
  prune().catch((e) => ctx.log(`Prune: ${e.message}`, true));
  if (ctx.profile.onboarded) connect({ auto: true }).catch(() => {});
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    checkForUpdate();
    if (ctx.band?.connected && !ctx.busy) sync();
    else { reconnectQuietly().then((ok) => { if (!ok && !modal) { invalidate(); stay(); } }); }
  });
  checkForUpdate();
  const deep = params.get("open");
  if (deep && M[deep]) setTimeout(() => { const el = document.querySelector(`[data-open="${deep}"]`) ?? $("#app"); openModal(el, "drill", deep); st.view = params.get("view") ?? "now"; setTimeout(redrawModal, 450); }, 700);
}
document.addEventListener("securitypolicyviolation", (e) => ctx.log(`Blocked by page policy: ${e.violatedDirective} ${e.blockedURI || "(inline)"}`, true));
main().catch((e) => { console.error(e); $("#app").innerHTML = `<div class="card"><b>Pulse couldn't start</b><p class="note">${esc(e.message)}</p></div>`; });
