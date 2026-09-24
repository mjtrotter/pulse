// Sync engine: pull new history from the band, store it, and report which days changed.
// History arrives newest first in 500-record pages, and the band ignores resume dates, so we stop
// paging once a page reaches data we already have (see Band.history).
import * as db from "./db.js?v=20260924145338";
import { AUTO, autoMeasurePacket, Cmd, decodeAutoMeasure, decodeHistory, decodeOsa, decodeRealtime, hex, osaPacket, packet, profilePacket, SYNCED } from "./protocol.js?v=20260924145338";
import { stamp } from "./time.js?v=20260924145338";

const TABLE = { hr: "hr", hrv: "hrv_vendor", spo2: "spo2", temp: "temp", sleep: "sleep", daily: "daily", activity: "activity", ppi: "ppi" };
const LABEL = { hr: "heart rate", hrv: "HRV estimates", spo2: "blood oxygen", temp: "temperature", sleep: "sleep", daily: "daily totals",
  activity: "steps", ppi: "pulse intervals" };
// Tables whose rows can change after we first store them (today's running totals): upsert instead of insert.
const UPSERT = new Set(["daily"]);

const EARLIEST = "2026-09-01 00:00:00";

/** Recommended band schedule once the battery test passes (owner's band, 2026-09-24). */
export const DEFAULT_SCHEDULE = { spo2: 10, hrv: 10, osa: true };

/**
 * Full sync. `onStep(text)` reports progress. Returns {mac, info, added: {kind: n}, dates: Set}.
 * `dates` holds every calendar date that got new rows, for the summary engine.
 */
export async function syncBand(band, store, { onStep = () => {}, log = () => {} } = {}) {
  onStep("Reading band…");
  let info = await band.info();
  const mac = info.mac ?? band.name;
  log(`Band ${mac}, firmware ${info.firmware}, battery ${info.battery}%`);
  // History timestamps come from the band's clock, so keep it right.
  if (info.clock && Math.abs(Date.parse(info.clock.replace(" ", "T")) - Date.now()) > 60e3) {
    log(`Band clock was ${info.clock}; correcting`);
    await band.syncClock();
    info = { ...info, ...(await band.info()) };
  }
  await writeProfileIfChanged(band, store, log);
  await applySchedule(band, store, log);

  const added = {}, dates = new Set();
  for (const kind of SYNCED) {
    onStep(`Syncing ${LABEL[kind]}…`);
    const newest = kind === "daily" ? null : await db.latest(store, TABLE[kind], mac);
    const recs = await band.history(kind, { since: newest?.t ?? null });
    const t_rx = stamp();
    await db.insert(store, "raw_packet", recs.map((r) => ({ band: mac, t_rx, cmd: r[0], hex: hex(r) })));
    // Drop clock garbage: rows from before these bands shipped (a new band's factory clock) or from the future.
    const future = stamp(new Date(Date.now() + 864e5));
    const rows = recs.flatMap((r) => decodeHistory(kind, r))
      .filter((row) => { const t = row.t ?? `${row.date} 12:00:00`; return t >= EARLIEST && t <= future; })
      .map((row) => ({ band: mac, ...row, ...(kind === "hr" ? { source: "auto" } : {}) }));
    if (UPSERT.has(kind)) {
      await db.putMany(store, TABLE[kind], rows);
      added[kind] = rows.length;
      for (const r of rows) dates.add(r.date);
    } else {
      const fresh = newest ? rows.filter((r) => r.t > newest.t) : rows;
      added[kind] = await db.insert(store, TABLE[kind], rows);
      for (const r of fresh) dates.add(r.t.slice(0, 10));
    }
  }
  onStep("Finishing…");
  let snapshot = null;
  try { snapshot = await band.snapshot(decodeRealtime); } catch { /* optional */ }
  await db.put(store, "band", { mac, name: band.name, firmware: info.firmware, battery: info.battery,
    last_sync: stamp(), snapshot, snapshot_at: stamp() });
  log(`Synced: ${Object.entries(added).map(([k, v]) => `${k} +${v}`).join(", ")}`);
  return { mac, info, added, dates };
}

/** Writes the profile to the band when it differs from what we last wrote (steps → distance/kcal). */
async function writeProfileIfChanged(band, store, log) {
  const p = await db.getSetting(store, "profile");
  if (!p?.age || !p?.sex || !p?.height || !p?.weight) return;
  const bytes = profilePacket(p);
  const key = hex(bytes);
  if ((await db.getSetting(store, "profile_on_band")) === key) return;
  await band.command(bytes);
  await db.setSetting(store, "profile_on_band", key);
  log("Wrote your profile to the band");
}

/** Applies the stored band schedule (settings "schedule") if the band's settings differ. */
async function applySchedule(band, store, log) {
  const want = await db.getSetting(store, "schedule");
  if (!want) return;
  for (const [name, minutes] of Object.entries({ spo2: want.spo2, hrv: want.hrv })) {
    if (!minutes) continue;
    const type = AUTO[name];
    const cur = (await band.command(packet([Cmd.autoHeartSettings, type])))
      .map(decodeAutoMeasure).find((r) => r?.type === type);
    if (cur && cur.minutes === minutes) continue;
    await band.command(autoMeasurePacket(type, minutes));
    log(`Set ${name} measurements to every ${minutes} min (was ${cur?.minutes ?? "?"})`);
  }
  if (want.osa != null) {
    const cur = (await band.command(packet([Cmd.osa]))).map(decodeOsa).find(Boolean);
    if (cur && cur.on !== want.osa) {
      await band.command(osaPacket(want.osa));
      log(`Turned the band's overnight breathing mode ${want.osa ? "on" : "off"}`);
    }
  }
}
