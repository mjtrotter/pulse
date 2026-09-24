// Wire protocol for the JCVital V8. Mirrors jcv8.py and swift/Sources/JCV8Kit.
// 16-byte commands on fff6: byte 0 = command, byte 15 = sum(bytes 0..14) & 0xFF.

// Full 128-bit UUIDs: some Web Bluetooth engines (Bluefy) don't resolve 16-bit aliases.
export const SERVICE = "0000fff0-0000-1000-8000-00805f9b34fb";
export const WRITE = "0000fff6-0000-1000-8000-00805f9b34fb";
export const NOTIFY = "0000fff7-0000-1000-8000-00805f9b34fb";
export const NAME_PREFIX = "JCV8";

export const Cmd = Object.freeze({
  setTime: 0x01, realtime: 0x09, battery: 0x13, mac: 0x22, version: 0x27, measure: 0x28,
  autoHeartSettings: 0x2b, getTime: 0x41, profile: 0x42,
  // History reads from the vendor's own sync table (reference/v8/history.md), verified by capture.
  dailyTotals: 0x51, sleepHistory: 0x53, hrHistory: 0x54, hrvHistory: 0x56, tempHistory: 0x62, spo2History: 0x66,
});

// From the J-Style SDK (DeviceConst.java). packet() refuses these.
export const DANGEROUS = { 0x12: "factory reset", 0x2e: "MCU reset", 0x47: "start OTA", 0x04: "delete data", 0x61: "reset device data" };
export const DELETE_MODE = 0x99; // byte[1] == 0x99 means "delete" on history/alarm/contact commands

export function packet(payload, { allowDangerous = false } = {}) {
  if (payload.length > 15) throw new Error("payload longer than 15 bytes");
  if (!allowDangerous && payload.length) {
    if (DANGEROUS[payload[0]]) throw new Error(`refused: ${DANGEROUS[payload[0]]}`);
    if (payload.length > 1 && payload[1] === DELETE_MODE && payload[0] !== 0x99) throw new Error("refused: delete mode");
  }
  const b = new Uint8Array(16);
  b.set(payload);
  b[15] = b.subarray(0, 15).reduce((s, x) => s + x, 0) & 0xff;
  return b;
}

export const bcd = (x) => (x >> 4) * 10 + (x & 0x0f);
export const toBcd = (n) => ((Math.floor(n / 10) << 4) | n % 10);

export function setTimePacket(d = new Date()) {
  return packet([Cmd.setTime, ...[d.getFullYear() % 100, d.getMonth() + 1, d.getDate(),
    d.getHours(), d.getMinutes(), d.getSeconds()].map(toBcd)]);
}

const pad = (n, w = 2) => String(n).padStart(w, "0");

/** "20YY-MM-DD hh:mm:ss" from six BCD bytes at o, shifted by `plus` seconds; null if impossible. */
export function timestamp(p, o, plus = 0) {
  if (p.length < o + 6) return null;
  const [y, mo, d, h, mi, s] = Array.from({ length: 6 }, (_, i) => bcd(p[o + i]));
  const t = Date.UTC(2000 + y, mo - 1, d, h, mi, s);
  const v = new Date(t);
  // Reject dates that Date.UTC silently normalizes (month 13, Feb 30, hour 24...).
  if (v.getUTCFullYear() !== 2000 + y || v.getUTCMonth() !== mo - 1 || v.getUTCDate() !== d ||
      v.getUTCHours() !== h || v.getUTCMinutes() !== mi || v.getUTCSeconds() !== s) return null;
  const r = new Date(t + plus * 1000); // naive wall-clock arithmetic, like Python's naive datetime
  return `${r.getUTCFullYear()}-${pad(r.getUTCMonth() + 1)}-${pad(r.getUTCDate())} ` +
    `${pad(r.getUTCHours())}:${pad(r.getUTCMinutes())}:${pad(r.getUTCSeconds())}`;
}

const le = (p, o, n) => { let v = 0; for (let i = n - 1; i >= 0; i--) v = v * 256 + p[o + i]; return v; };

// Synced by the app: vendor opcodes whose replies were captured and decoded on the band (2026-09-24).
// Never 0x2A (SETS the auto-measurement schedule) or 0x44/0x3B (not history reads on this firmware).
export const SYNCED = ["hr", "spo2", "temp", "hrv", "sleep", "daily"];
export const HISTORY = {
  hr: { cmd: Cmd.hrHistory, size: 24 },
  hrv: { cmd: Cmd.hrvHistory, size: 15 },
  spo2: { cmd: Cmd.spo2History, size: 10 },
  temp: { cmd: Cmd.tempHistory, size: 11 },
  sleep: { cmd: Cmd.sleepHistory, size: 130 },
  daily: { cmd: Cmd.dailyTotals, size: 27 },
};
/** Sleep stage codes (vendor getSleepLevelerOneMinute). Anything else counts as awake. */
export const SLEEP_STAGE = { 1: "deep", 2: "light", 3: "REM", 4: "awake" };

/** Rows for one history record. Records: cmd, idx, idx, BCD time at 3..8, payload from 9. */
export function decodeHistory(kind, c) {
  if (c.length < HISTORY[kind].size) return [];
  if (kind === "daily") {
    // ResolveUtil.getTotalStepData: BCD date at 2..4, steps, sport time, distance/100 km, kcal/100.
    const [y, m, d] = [bcd(c[2]), bcd(c[3]), bcd(c[4])];
    const v = new Date(Date.UTC(2000 + y, m - 1, d));
    if (v.getUTCFullYear() !== 2000 + y || v.getUTCMonth() !== m - 1 || v.getUTCDate() !== d) return [];
    return [{ date: `20${pad(y)}-${pad(m)}-${pad(d)}`, steps: le(c, 5, 4), sport: le(c, 9, 4), km: le(c, 13, 4) / 100, kcal: le(c, 17, 4) / 100 }];
  }
  const t = timestamp(c, 3);
  if (t === null) return [];
  switch (kind) {
    case "hr": {
      const rows = [];
      for (let j = 0; j < 15; j++) if (c[9 + j]) rows.push({ t: timestamp(c, 3, 5 * j), bpm: c[9 + j] });
      return rows;
    }
    case "hrv":
      return [{ t, hrv_ms: c[9], vascular_aging: c[10], hr: c[11], stress: c[12], bp_sys: c[13], bp_dia: c[14] }];
    case "spo2":
      return c[9] ? [{ t, pct: c[9] }] : [];
    case "temp":
      return [{ t, c: le(c, 9, 2) / 10 }];
    case "sleep": {
      const rows = [];
      for (let i = 0; i < Math.min(c[9], c.length - 10); i++) rows.push({ t: timestamp(c, 3, 60 * i), stage: c[10 + i] });
      return rows;
    }
  }
  return [];
}

/** 0x09 realtime stream (ResolveUtil.getActivityData). */
export function decodeRealtime(p) {
  if (p.length < 24 || p[0] !== Cmd.realtime) return null;
  return { steps: le(p, 1, 4), kcal: le(p, 5, 4) / 100, km: le(p, 9, 4) / 100,
    exercise_min: Math.floor(le(p, 13, 4) / 60), active: le(p, 17, 4), hr: p[21], temp_c: le(p, 22, 2) / 10 };
}

export function decodeInfo(p, info = {}) {
  switch (p[0]) {
    case Cmd.mac: if (p.length >= 7) info.mac = [...p.subarray(1, 7)].map((x) => x.toString(16).padStart(2, "0").toUpperCase()).join(":"); break;
    case Cmd.version: if (p.length >= 5) info.firmware = [...p.subarray(1, 5)].join("."); break;
    case Cmd.battery: if (p.length >= 2) info.battery = p[1]; break;
    case Cmd.getTime: info.clock = timestamp(p, 1); break;
  }
  return info;
}

/** Collects one history page and splits it into records, exactly as jcv8.history_records does. */
export class HistoryPage {
  constructor(kind) { this.kind = kind; this.buffer = []; this.done = false; }
  feed(r) {
    if (r[0] !== HISTORY[this.kind].cmd) return this.done;
    if (r[r.length - 1] === 0xff || (r.length >= 2 && r[1] === 0xff)) this.done = true;
    this.buffer.push(...r);
    return this.done;
  }
  get records() {
    const { size, cmd } = HISTORY[this.kind];
    const out = [];
    for (let i = 0; i + size <= this.buffer.length; i += size) {
      const c = Uint8Array.from(this.buffer.slice(i, i + size));
      if (c[0] === cmd && c.subarray(3, 9).some((x) => x !== 0)) out.push(c);
    }
    return out;
  }
}

export const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
export const unhex = (s) => Uint8Array.from(s.match(/../g) ?? [], (x) => parseInt(x, 16));
