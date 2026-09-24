// On-phone storage (IndexedDB). Same tables and keys as store.py / Store.swift for the shared ones.
// Nothing here talks to the network; the page's CSP forbids it anyway.

// The live app, the /next/ preview and ?demo each get their own database, so they never mix rows.
export const DB_NAME = "jcv8";
const STORES = {
  band: ["mac"],
  raw_packet: ["band", "cmd", "hex"],
  hr: ["band", "t", "source"],
  hrv_vendor: ["band", "t"],
  spo2: ["band", "t"],
  temp: ["band", "t"],
  measurement: ["band", "t"],
  pair: ["band", "t"],
  ecg: ["band", "t"],
  settings: ["key"],
  sleep: ["band", "t"],
  daily: ["band", "date"],
  // v5 (Pulse v2)
  activity: ["band", "t"], // 10-minute step blocks with per-minute counts (0x52)
  ppi: ["band", "t", "page"], // pulse-to-pulse interval bursts (0x63)
  osa: ["band", "t"], // band sleep-apnea / EOV records (0x5F / 0x5D), stored as decoded
  battery_log: ["band", "t"], // 0x67
  bp: ["t"], // home blood-pressure cuff log
  tags: ["date", "tag"], // what happened that day: alcohol, late meal, sick, strength workout...
  summary: ["date"], // per-day cache computed from the rows above (analytics/summary.js)
};
const VERSION = 5; // 2: ecg sessions, 3: settings (profile), 4: sleep + daily totals, 5: v2 stores

const req = (r) => new Promise((ok, err) => { r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error); });
const done = (tx) => new Promise((ok, err) => { tx.oncomplete = ok; tx.onabort = () => err(tx.error); tx.onerror = () => err(tx.error); });

export async function open(name = DB_NAME) {
  const r = indexedDB.open(name, VERSION);
  r.onupgradeneeded = () => {
    for (const [store, key] of Object.entries(STORES)) {
      if (r.result.objectStoreNames.contains(store)) continue;
      const s = r.result.createObjectStore(store, { keyPath: key.length === 1 ? key[0] : key });
      if (key.includes("t")) s.createIndex("t", "t");
      if (key.includes("date") && store !== "summary") s.createIndex("date", "date");
    }
  };
  const db = await req(r);
  // Ask the browser not to evict this data. Not awaited: some engines hold the promise
  // open behind a permission decision.
  navigator.storage?.persist?.().catch(() => {});
  return db;
}

/** Insert rows that aren't already present; returns how many were new (INSERT OR IGNORE). */
export async function insert(db, store, rows) {
  if (!rows.length) return 0;
  const tx = db.transaction(store, "readwrite");
  // add() fails with ConstraintError for duplicates; swallow those so the transaction commits.
  tx.addEventListener("error", (e) => { if (e.target.error?.name === "ConstraintError") e.preventDefault(); });
  const s = tx.objectStore(store);
  let added = 0;
  for (const row of rows) s.add(row).onsuccess = () => { added++; };
  await new Promise((ok, err) => { tx.oncomplete = ok; tx.onabort = () => err(tx.error); });
  return added;
}

export async function put(db, store, row) {
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).put(row);
  await done(tx);
}

export async function putMany(db, store, rows) {
  if (!rows.length) return;
  const tx = db.transaction(store, "readwrite");
  const s = tx.objectStore(store);
  for (const row of rows) s.put(row);
  await done(tx);
}

export async function remove(db, store, key) {
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).delete(key);
  await done(tx);
}

export async function get(db, store, key) {
  return req(db.transaction(store).objectStore(store).get(key));
}

export async function all(db, store) {
  return req(db.transaction(store).objectStore(store).getAll());
}

/** Rows with t in [from, to] (inclusive, "YYYY-MM-DD hh:mm:ss" strings sort correctly), sorted by t. */
export async function range(db, store, from, to) {
  return req(db.transaction(store).objectStore(store).index("t").getAll(IDBKeyRange.bound(from, to)));
}

/** The newest row by t (or null), optionally for one band only. Used by incremental sync: a phone that
 *  has synced more than one band must not use band B's newest time as band A's stopping point. */
export async function latest(db, store, band = null) {
  return new Promise((ok, err) => {
    const r = db.transaction(store).objectStore(store).index("t").openCursor(null, "prev");
    r.onerror = () => err(r.error);
    r.onsuccess = () => {
      const cur = r.result;
      if (!cur) return ok(null);
      if (band == null || cur.value.band === band) return ok(cur.value);
      cur.continue();
    };
  });
}

/** Deletes rows with t (or `key`) before `cutoff` in one store; returns how many. Summaries are never pruned. */
export async function pruneBefore(db, store, cutoff, key = "t") {
  if (store === "summary") return 0;
  return new Promise((ok, err) => {
    const tx = db.transaction(store, "readwrite");
    const src = key === "t" ? tx.objectStore(store).index("t") : tx.objectStore(store);
    let n = 0;
    const r = key === "t" ? src.openCursor(IDBKeyRange.upperBound(cutoff, true)) : src.openCursor();
    r.onsuccess = () => {
      const cur = r.result;
      if (!cur) return;
      if (key === "t" || (cur.value[key] ?? "") < cutoff) { cur.delete(); n++; }
      cur.continue();
    };
    tx.oncomplete = () => ok(n);
    tx.onabort = tx.onerror = () => err(tx.error);
  });
}

/** Summaries with date in [from, to] (inclusive), sorted by date. */
export async function summaries(db, from, to) {
  return req(db.transaction("summary").objectStore("summary").getAll(IDBKeyRange.bound(from, to)));
}

export async function counts(db) {
  const out = {};
  for (const name of Object.keys(STORES)) out[name] = await req(db.transaction(name).objectStore(name).count());
  return out;
}

/** Everything, for the user's own backup file. */
export async function exportAll(db) {
  const out = { exported: new Date().toISOString(), format: "jcv8-v2" };
  for (const name of Object.keys(STORES)) {
    if (name === "summary") continue; // derived; rebuilt on import
    out[name] = await all(db, name);
  }
  return out;
}

/** Merge a backup file back in (rows already present are kept). Returns rows added per store. */
export async function importAll(db, data) {
  const added = {};
  for (const name of Object.keys(STORES)) {
    if (name === "summary" || !Array.isArray(data[name])) continue;
    const rows = name === "ecg" ? data[name].map((e) => ({ ...e, samples: Float32Array.from(Object.values(e.samples ?? {})) })) : data[name];
    added[name] = await insert(db, name, rows);
  }
  return added;
}

export async function getSetting(db, key) {
  const row = await req(db.transaction("settings").objectStore("settings").get(key));
  return row?.value ?? null;
}

export async function setSetting(db, key, value) {
  await put(db, "settings", { key, value });
}
