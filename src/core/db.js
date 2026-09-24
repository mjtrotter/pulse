// On-phone storage (IndexedDB). Same tables and keys as store.py / Store.swift.
// Nothing here talks to the network; the page's CSP forbids it anyway.

const DB_NAME = "jcv8"; // demo mode uses a separate database so demo rows never mix with real ones
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
};
const VERSION = 4; // 2: ecg sessions, 3: settings (profile), 4: sleep + daily totals

const req = (r) => new Promise((ok, err) => { r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error); });

export async function open(name = DB_NAME) {
  const r = indexedDB.open(name, VERSION);
  r.onupgradeneeded = () => {
    for (const [name, key] of Object.entries(STORES)) {
      if (r.result.objectStoreNames.contains(name)) continue;
      const s = r.result.createObjectStore(name, { keyPath: key.length === 1 ? key[0] : key });
      if (key.includes("t")) s.createIndex("t", "t");
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
  await new Promise((ok, err) => { tx.oncomplete = ok; tx.onabort = () => err(tx.error); });
}

export async function all(db, store) {
  return req(db.transaction(store).objectStore(store).getAll());
}

/** Rows with t in [from, to] (inclusive, "YYYY-MM-DD hh:mm:ss" strings sort correctly). */
export async function range(db, store, from, to) {
  return req(db.transaction(store).objectStore(store).index("t").getAll(IDBKeyRange.bound(from, to)));
}

export async function counts(db) {
  const out = {};
  for (const name of Object.keys(STORES)) out[name] = await req(db.transaction(name).objectStore(name).count());
  return out;
}

/** Everything, for the user's own backup file. */
export async function exportAll(db) {
  const out = { exported: new Date().toISOString(), format: "jcv8-v1" };
  for (const name of Object.keys(STORES)) out[name] = await all(db, name);
  return out;
}

export async function getSetting(db, key) {
  const row = await req(db.transaction("settings").objectStore("settings").get(key));
  return row?.value ?? null;
}

export async function setSetting(db, key, value) {
  await put(db, "settings", { key, value });
}
