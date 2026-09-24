// Pulse v2 app shell: routing, connection/sync state, and the shared context every screen gets.
import { Band } from "./core/ble.js?v=20260924162635";
import * as db from "./core/db.js?v=20260924162635";
import { syncBand } from "./core/sync.js?v=20260924162635";
import { dayOf, relTime, stamp } from "./core/time.js?v=20260924162635";
import { setUnits } from "./core/units.js?v=20260924162635";
import { ensureSummaries, recomputeDays } from "./analytics/summary.js?v=20260924162635";
import { scoreDays } from "./analytics/scores.js?v=20260924162635";
import { closeSheet, toast } from "./ui/components.js?v=20260924162635";
import { h, icon } from "./ui/h.js?v=20260924162635";

const params = new URLSearchParams(location.search);
const DEMO = params.has("demo");
const PREVIEW = location.pathname.includes("/next/");
const DB = DEMO ? "jcv8-demo" : PREVIEW ? "jcv8-next" : db.DB_NAME;

const ROUTES = {
  today: () => import("./views/today.js?v=20260924162635"),
  sleep: () => import("./views/sleep.js?v=20260924162635"),
  heart: () => import("./views/heart.js?v=20260924162635"),
  activity: () => import("./views/activity.js?v=20260924162635"),
  recovery: () => import("./views/recovery.js?v=20260924162635"),
  metric: () => import("./views/metric.js?v=20260924162635"),
  ecg: () => import("./views/ecg.js?v=20260924162635"),
  bp: () => import("./views/bp.js?v=20260924162635"),
  you: () => import("./views/you.js?v=20260924162635"),
  methods: () => import("./views/methods.js?v=20260924162635"),
  welcome: () => import("./views/onboarding.js?v=20260924162635"),
};
const TABS = ["today", "sleep", "heart", "activity"];
const TINT = { today: "var(--accent)", sleep: "var(--sleep)", heart: "var(--heart)", activity: "var(--act)", recovery: "var(--good)",
  ecg: "var(--heart)", bp: "var(--heart)", metric: "var(--accent)", you: "var(--accent)", welcome: "var(--accent)", methods: "var(--accent)" };

export const ctx = {
  demo: DEMO, preview: PREVIEW, store: null, profile: {}, band: null, mac: null, info: {},
  conn: "off", // off | connecting | syncing | on
  status: "", busy: false, live: false, logLines: [],
  lastRoute: null,

  log(text, isError = false) {
    ctx.logLines.unshift({ t: stamp().slice(11), text, isError });
    ctx.logLines.length = Math.min(ctx.logLines.length, 200);
    document.dispatchEvent(new CustomEvent("pulse:log"));
  },
  nav(route) { location.hash = `#/${route}`; },
  back() { if (history.length > 1 && ctx.lastRoute) history.back(); else ctx.nav("today"); },
  async setProfile(p) {
    ctx.profile = p;
    await db.setSetting(ctx.store, "profile", p);
    applyPrefs();
  },
  async summaries(days = 30, end = dayOf()) {
    const d = new Date(+end.slice(0, 4), +end.slice(5, 7) - 1, +end.slice(8, 10) - days + 1);
    return db.summaries(ctx.store, dayOf(d), end);
  },
  async summary(date) { return db.get(ctx.store, "summary", date); },
  setStatus(conn, status = "") { ctx.conn = conn; ctx.status = status; document.dispatchEvent(new CustomEvent("pulse:status")); },
  refresh: () => render(),
  connect, sync, disconnect,
};

function applyPrefs() {
  setUnits(ctx.profile.units ?? "us");
  const root = document.documentElement;
  const theme = ctx.profile.theme ?? "auto";
  if (theme === "auto") root.removeAttribute("data-theme"); else root.dataset.theme = theme;
  if (ctx.profile.textSize === "large") root.dataset.size = "large"; else delete root.dataset.size;
}

// ---------- connection & sync ----------

async function connect({ all = false, auto = false } = {}) {
  if (DEMO) { toast("Demo mode can't connect. Open Pulse without ?demo to use your band."); return false; }
  if (!navigator.bluetooth) { toast(/android/i.test(navigator.userAgent) ? "Open Pulse in Chrome to use Bluetooth." : "Open Pulse in the Bluefy app to use Bluetooth."); return false; }
  ctx.setStatus("connecting", "Connecting…");
  try {
    let band = null;
    if (auto) {
      band = await Band.reconnect({ log: ctx.log, mac: await db.getSetting(ctx.store, "band_name") });
      if (!band) { ctx.setStatus("off"); return false; }
    } else {
      band = await Band.choose({ all, log: ctx.log });
    }
    ctx.band = band;
    band.onDisconnect = () => { ctx.band = null; ctx.live = false; ctx.busy = false; ctx.setStatus("off"); };
    await db.setSetting(ctx.store, "band_name", band.name);
    ctx.setStatus("on", band.name);
    await sync();
    return true;
  } catch (e) {
    const cancelled = e.name === "NotFoundError" && /cancel/i.test(e.message);
    ctx.log(`${e.name}: ${e.message}`, !cancelled);
    ctx.band = null;
    ctx.setStatus("off");
    if (!cancelled && !auto) {
      toast(e.name === "NotFoundError"
        ? "No band found. Make sure it's charged, nearby, and not connected to another phone."
        : `Couldn't connect: ${e.message}`, 5000);
    }
    return false;
  }
}

async function sync() {
  if (!ctx.band?.connected || ctx.busy || ctx.live) return;
  ctx.busy = true;
  try {
    const res = await syncBand(ctx.band, ctx.store, { onStep: (t) => ctx.setStatus("syncing", t), log: ctx.log });
    ctx.mac = res.mac; ctx.info = res.info;
    ctx.setStatus("syncing", "Analysing…");
    await recomputeDays(ctx.store, db, res.dates, ctx.profile, scoreDays);
    ctx.setStatus("on", `Synced just now`);
  } catch (e) {
    ctx.log(`Sync stopped: ${e.name}: ${e.message}`, true);
    toast(`Sync stopped: ${e.message}`, 5000);
    ctx.setStatus(ctx.band?.connected ? "on" : "off");
  } finally {
    ctx.busy = false;
    await render();
  }
}

function disconnect() { ctx.band?.disconnect(); }

/** Phones can keep Pulse open for days; when it comes back to the foreground, compare the running build
 *  with the published version.txt (same origin, allowed by the CSP) and offer a one-tap update. */
let lastUpdateCheck = 0;
async function checkForUpdate() {
  const build = new URL(import.meta.url).searchParams.get("v");
  if (!build || Date.now() - lastUpdateCheck < 10 * 60e3) return;
  lastUpdateCheck = Date.now();
  try {
    const res = await fetch(new URL("../version.txt", import.meta.url), { cache: "no-store" });
    const latest = (await res.text()).trim();
    if (/^\d{14}$/.test(latest) && latest > build && !document.querySelector(".update-banner")) {
      const b = h("button.btn.accent.small.update-banner", { type: "button", style: { position: "fixed", top: "calc(env(safe-area-inset-top) + 10px)", left: "50%", transform: "translateX(-50%)", zIndex: 60, boxShadow: "var(--shadow)" },
        onclick: () => location.reload() }, icon("sync"), "Update available: tap to refresh");
      document.body.append(b);
      ctx.log(`Update available (${latest})`);
    }
  } catch { /* offline: try again next time */ }
}

/** Keeps storage bounded: raw 5-s heart rate older than 180 days and raw packets older than 30 days are
 *  dropped (the day summaries that every screen and trend uses are kept forever). Runs at most daily. */
async function prune() {
  if (DEMO) return;
  const last = await db.getSetting(ctx.store, "last_prune");
  if (last && Date.now() - Date.parse(last) < 864e5) return;
  const cutoff = (days) => stamp(new Date(Date.now() - days * 864e5));
  const hr = await db.pruneBefore(ctx.store, "hr", cutoff(180));
  const raw = await db.pruneBefore(ctx.store, "raw_packet", cutoff(30), "t_rx");
  if (hr || raw) ctx.log(`Tidied storage: ${hr} old heart-rate rows, ${raw} raw packets`);
  await db.setSetting(ctx.store, "last_prune", new Date().toISOString());
}

/** Text for the sync pill. */
export async function syncLine() {
  if (ctx.conn === "connecting" || ctx.conn === "syncing") return ctx.status;
  const band = (await db.all(ctx.store, "band")).sort((a, b) => (a.last_sync < b.last_sync ? 1 : -1))[0];
  const when = band?.last_sync ? relTime(band.last_sync) : null;
  if (ctx.conn === "on") return when ? `Connected · synced ${when}` : "Connected";
  return when ? `Synced ${when}` : "Not synced yet";
}

// ---------- routing ----------

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  return { name: ROUTES[parts[0]] ? parts[0] : "today", args: parts.slice(1).map(decodeURIComponent) };
}

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const { name, args } = parseRoute();
  closeSheet();
  const main = document.getElementById("app");
  document.documentElement.style.setProperty("--tint", TINT[name] ?? "var(--accent)");
  const tabbar = document.getElementById("tabbar");
  tabbar.hidden = name === "welcome";
  for (const b of tabbar.querySelectorAll("button")) b.classList.toggle("on", b.dataset.tab === (TABS.includes(name) ? name : ""));
  let node;
  try {
    const mod = await ROUTES[name]();
    node = await mod.default(ctx, ...args);
  } catch (e) {
    console.error(e);
    ctx.log(`Screen error: ${e.message}`, true);
    node = h("div.screen", h("div.card", h("h2", "Something went wrong"), h("p.note", e.message)));
  }
  if (seq !== renderSeq) return; // a newer render started meanwhile
  const same = ctx.lastRoute === location.hash;
  node.classList.add(same ? "stay" : TABS.includes(name) ? "enter" : "push");
  main.replaceChildren(node);
  if (!same) window.scrollTo({ top: 0 });
  ctx.lastRoute = location.hash;
}

// ---------- boot ----------

const DEMO_VERSION = "4"; // bump when demo.js changes so phones re-create the demo data

async function main() {
  if (DEMO) {
    let stale = true;
    try { stale = localStorage.getItem("pulse_demo_v") !== DEMO_VERSION; } catch { /* storage blocked */ }
    if (stale) {
      await new Promise((ok) => { const r = indexedDB.deleteDatabase(DB); r.onsuccess = r.onerror = r.onblocked = () => ok(); });
      try { localStorage.setItem("pulse_demo_v", DEMO_VERSION); } catch { /* ignore */ }
    }
  }
  ctx.store = await db.open(DB);
  if (DEMO) {
    document.body.prepend(h("p.demo-banner", "Demo data — nothing here is real"));
    const { seedDemo } = await import("./demo.js?v=20260924162635");
    if (!(await db.getSetting(ctx.store, "profile"))) {
      await db.setSetting(ctx.store, "profile", { name: "Alex", age: 58, sex: "male", height: 178, weight: 84, units: "us", onboarded: true });
    }
    if (await seedDemo(ctx.store)) ctx.log("Demo data created");
  }
  ctx.profile = (await db.getSetting(ctx.store, "profile")) ?? {};
  // v1 users already have a profile: don't send them through first-run setup again.
  if (!ctx.profile.onboarded && ctx.profile.age && ctx.profile.sex) await ctx.setProfile({ ...ctx.profile, onboarded: true });
  applyPrefs();
  document.getElementById("tabbar").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if (b) ctx.nav(b.dataset.tab);
  });
  window.addEventListener("hashchange", render);
  const build = new URL(import.meta.url).searchParams.get("v") ?? "dev";
  ctx.log(`Pulse ${build} ready (${navigator.bluetooth ? "Bluetooth available" : "no Bluetooth in this browser"})`);
  if (!ctx.profile.onboarded && !DEMO) { location.replace("#/welcome"); }
  await render();
  // Build any missing day summaries (first run after an update, or new demo data).
  await ensureSummaries(ctx.store, db, ctx.profile, scoreDays, (t) => ctx.setStatus(ctx.conn, t)).catch((e) => ctx.log(`Analysis: ${e.message}`, true));
  ctx.setStatus(ctx.conn);
  await render();
  prune().catch((e) => ctx.log(`Prune: ${e.message}`, true));
  // Reconnect silently to a band this browser already knows (Chrome/Android; Bluefy if supported).
  if (!DEMO && ctx.profile.onboarded) connect({ auto: true }).catch(() => {});
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    checkForUpdate();
    if (ctx.band?.connected && !ctx.busy) sync();
  });
  checkForUpdate();
}

document.addEventListener("securitypolicyviolation", (e) => ctx.log(`Blocked by page policy: ${e.violatedDirective} ${e.blockedURI || "(inline)"}`, true));
main().catch((e) => { console.error(e); document.getElementById("app").replaceChildren(h("div.card", h("h2", "Pulse couldn't start"), h("p.note", e.message))); });

export { icon };
