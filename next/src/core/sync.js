// Sync engine: pull new history from the band, store it, and report which days changed.
// History arrives newest first in 500-record pages, and the band ignores resume dates, so we stop
// paging once a page reaches data we already have (see Band.history).
import * as db from "./db.js?v=20260925164715";
import { AUTO, autoMeasurePacket, Cmd, decodeAutoMeasure, decodeHistory, decodeOsa, decodeRealtime, hex, osaPacket, packet, profilePacket, SYNCED } from "./protocol.js?v=20260925164715";
import { stamp } from "./time.js?v=20260925164715";

const TABLE = { hr: "hr", hrv: "hrv_vendor", spo2: "spo2", temp: "temp", sleep: "sleep", daily: "daily", activity: "activity", ppi: "ppi" };
const LABEL = { hr: "heart rate", hrv: "HRV estimates", spo2: "blood oxygen", temp: "temperature", sleep: "sleep", daily: "daily totals",
  activity: "steps", ppi: "pulse intervals" };
// Tables whose rows can change after we first store them (today's running totals): upsert instead of insert.
const UPSERT = new Set(["daily"]);

const EARLIEST = "2026-09-01 00:00:00";

/**
 * Where this phone's readings from a band begin. A band that changes hands still holds the previous wearer's last
 * few days, so the first time a phone syncs a band it has never synced before, anything recorded earlier is
 * skipped. A band this phone already knows (it has a stored band record, e.g. after "Bring in my data" or a
 * restore) keeps its full history. `claims` is settings "band_claims": {mac: timestamp}.
 */
export function claimFor(claims, mac, known, now) {
  const c = { ...(claims ?? {}) };
  if (c[mac]) return { claims: c, from: c[mac], isNew: false };
  c[mac] = known ? EARLIEST : now;
  return { claims: c, from: c[mac], isNew: !known };
}
/** Keep a decoded row? Timed rows from `from` to `future`. The band's daily totals carry only a date, and the
 *  total for the handover day mixes both wearers, so after a real cutoff only later days are kept. */
export function keepRow(row, from, future) {
  if (row.t) return row.t >= from && row.t >= EARLIEST && row.t <= future;
  if (!row.date) return false;
  const t = `${row.date} 12:00:00`;
  if (t < EARLIEST || t > future) return false;
  return from > EARLIEST ? row.date > from.slice(0, 10) : true;
}
/** The band paired with this phone vs the one that answered: an automatic reconnect must never sync another band. */
export const otherBand = (expectMac, mac) => !!(expectMac && mac && expectMac !== mac);

/** Recommended band schedule once the battery test passes (owner's band, 2026-09-24). */
export const DEFAULT_SCHEDULE = { spo2: 10, hrv: 10, osa: true };

/**
 * Full sync. `onStep(text)` reports progress. Returns {mac, info, added: {kind: n}, dates: Set}.
 * `dates` holds every calendar date that got new rows, for the summary engine.
 */
export async function syncBand(band, store, { onStep = () => {}, log = () => {}, expectMac = null } = {}) {
  onStep("Reading band…");
  let info = await band.info();
  const mac = info.mac ?? band.name;
  log(`Band ${mac}, firmware ${info.firmware}, battery ${info.battery}%`);
  if (otherBand(expectMac, info.mac)) throw Object.assign(new Error(`${band.name} isn't the band paired with this phone. Tap Connect and pick your band to switch`), { name: "OtherBand" });
  const known = (await db.all(store, "band")).some((b) => b.mac === mac);
  const claim = claimFor(await db.getSetting(store, "band_claims"), mac, known, stamp());
  if (claim.isNew) {
    await db.setSetting(store, "band_claims", claim.claims);
    log(`First sync of this band on this phone: skipping anything it recorded before ${claim.from} (it may be a previous wearer's)`);
  }
  // History timestamps come from the band's clock, so keep it right.
  if (info.clock && Math.abs(Date.parse(info.clock.replace(" ", "T")) - Date.now()) > 60e3) {
    log(`Band clock was ${info.clock}; correcting`);
    await band.syncClock();
    info = { ...info, ...(await band.info()) };
  }
  await writeProfileIfChanged(band, store, mac, log);
  await applySchedule(band, store, log);

  const added = {}, dates = new Set();
  for (const kind of SYNCED) {
    onStep(`Syncing ${LABEL[kind]}…`);
    const newest = kind === "daily" ? null : await db.latest(store, TABLE[kind], mac);
    const cut = claim.from > EARLIEST;
    const recs = await band.history(kind, { since: newest?.t ?? (cut && kind !== "daily" ? claim.from : null) });
    const t_rx = stamp();
    // Drop clock garbage (rows from before these bands shipped, i.e. a new band's factory clock, or from the future)
    // and anything recorded before this phone's claim on the band.
    const future = stamp(new Date(Date.now() + 864e5));
    const decoded = recs.map((r) => [r, decodeHistory(kind, r).filter((row) => keepRow(row, claim.from, future))]);
    // A previous wearer's raw packets stay off this phone too.
    await db.insert(store, "raw_packet", decoded.filter(([, d]) => !cut || d.length).map(([r]) => ({ band: mac, t_rx, cmd: r[0], hex: hex(r) })));
    const rows = decoded.flatMap(([, d]) => d).map((row) => ({ band: mac, ...row, ...(kind === "hr" ? { source: "auto" } : {}) }));
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

/** Writes the profile to the band when it differs from what we last wrote to that band (steps → distance/kcal).
 *  Tracked per band, so a replacement band gets the profile too. Older builds stored one string for the only band;
 *  that's dropped, which costs one harmless rewrite. */
async function writeProfileIfChanged(band, store, mac, log) {
  const p = await db.getSetting(store, "profile");
  if (!p?.age || !p?.sex || !p?.height || !p?.weight) return;
  const bytes = profilePacket(p);
  const key = hex(bytes), prev = await db.getSetting(store, "profile_on_band"), onBand = prev && typeof prev === "object" ? { ...prev } : {};
  if (onBand[mac] === key) return;
  await band.command(bytes);
  onBand[mac] = key;
  await db.setSetting(store, "profile_on_band", onBand);
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
