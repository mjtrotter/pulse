// Web Bluetooth client for one JCV8 band (Chrome on Mac/Android, Bluefy on iPhone).
// Notifications are buffered; collect() drains them with overall and idle timeouts,
// mirroring Band.collect in jcv8.py and BandClient.collect in Swift.
import { decodeEcgPacket } from "../analytics/ecg.js?v=20260924205306";
import { Cmd, decodeInfo, HISTORY, HistoryPage, isBandName, NAME_PREFIXES, namePacket, notifyPacket, NOTIFY, packet, recordTime, SERVICE, setTimePacket, WRITE } from "./protocol.js?v=20260924205306";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Band {
  /** Shows the browser's device picker. `all` lists every nearby device (fallback if the
   *  name filter finds nothing). `log` receives each connection step for troubleshooting. */
  static async choose({ all = false, log = () => {} } = {}) {
    if (!navigator.bluetooth) throw new Error("This browser has no Bluetooth. On iPhone, open this page in Bluefy.");
    // requestDevice must run straight from the tap (user activation), so nothing is awaited before it.
    log(all ? "Opening picker (all nearby devices)" : `Opening picker (names starting ${NAME_PREFIXES.join(" or ")})`);
    const device = await navigator.bluetooth.requestDevice(all
      ? { acceptAllDevices: true, optionalServices: [SERVICE] }
      : { filters: NAME_PREFIXES.map((namePrefix) => ({ namePrefix })), optionalServices: [SERVICE] });
    log(`Picked ${device.name ?? "unnamed device"}`);
    const band = new Band(device, log);
    await band.connect();
    return band;
  }

  /** Reconnects without the picker to a band this browser already has permission for
   *  (navigator.bluetooth.getDevices: Chrome/Android; absent in some engines → null). */
  static async reconnect({ log = () => {}, mac = null, timeoutMs = 8000 } = {}) {
    if (!navigator.bluetooth?.getDevices) return null;
    const devices = await navigator.bluetooth.getDevices();
    const dev = devices.find((d) => d.name && d.name === mac) ?? devices.find((d) => isBandName(d.name));
    if (!dev) return null;
    log(`Reconnecting to ${dev.name}`);
    const band = new Band(dev, log);
    const attempt = (async () => {
      if (dev.watchAdvertisements) {
        // Chrome only connects to a remembered device once it has seen it advertise.
        const seen = new Promise((ok) => dev.addEventListener("advertisementreceived", ok, { once: true }));
        await dev.watchAdvertisements().catch(() => {});
        await Promise.race([seen, sleep(timeoutMs - 1500)]);
      }
      await band.connect();
      return band;
    })();
    return Promise.race([attempt, sleep(timeoutMs).then(() => { throw new Error("reconnect timed out"); })])
      .catch((e) => { log(`Reconnect skipped: ${e.message}`); try { dev.gatt?.disconnect(); } catch {} return null; });
  }

  constructor(device, log = () => {}) {
    this.device = device;
    this.log = log;
    this.inbox = [];
    this.onDisconnect = null;
    device.addEventListener("gattserverdisconnected", () => { this.log("Disconnected"); this.onDisconnect?.(); });
  }

  get name() { return this.device.name ?? "band"; }
  get connected() { return !!this.device.gatt?.connected; }

  async connect() {
    this.log("Connecting…");
    const server = await this.device.gatt.connect();
    this.log("Connected; finding the band's service");
    const svc = await server.getPrimaryService(SERVICE);
    this.w = await svc.getCharacteristic(WRITE);
    this.n = await svc.getCharacteristic(NOTIFY);
    this.log("Subscribing to notifications");
    this.n.addEventListener("characteristicvaluechanged", (e) => {
      const v = e.target.value;
      this.inbox.push(new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)));
    });
    await this.n.startNotifications();
    this.log("Ready");
  }

  disconnect() { if (this.connected) this.device.gatt.disconnect(); }

  async write(bytes) {
    // writeValueWithResponse is newer; older engines only have writeValue.
    const fn = this.w.writeValueWithResponse ?? this.w.writeValue;
    await fn.call(this.w, bytes);
  }

  send(payload) { return this.write(packet(payload)); }

  /** Notifications for up to `secs`, or until `idle` seconds of silence, or until `until(r)` is true. */
  async collect(secs, { idle = null, until = null } = {}) {
    const end = Date.now() + secs * 1000;
    let last = Date.now();
    const out = [];
    while (Date.now() < end) {
      if (this.inbox.length) {
        last = Date.now();
        for (const r of this.inbox.splice(0)) {
          out.push(r);
          if (until?.(r)) return out;
        }
      } else if (idle !== null && Date.now() - last > idle * 1000) {
        break;
      }
      await sleep(20);
    }
    return out;
  }

  async ask(payload, wait = 1.5) {
    this.inbox.length = 0;
    await this.send(payload);
    return this.collect(wait);
  }

  async info() {
    const info = {};
    for (const c of [Cmd.mac, Cmd.version, Cmd.battery, Cmd.getTime]) {
      for (const r of await this.ask([c])) decodeInfo(r, info);
    }
    return info;
  }

  async syncClock() {
    this.inbox.length = 0;
    await this.write(setTimePacket(new Date()));
    await this.collect(1);
  }

  /** History for one kind, newest first (verified: 500 records per page, newest first).
   *  mode 0 = start, 2 = next page. Never 0x99 (delete). With `since` ("YYYY-MM-DD hh:mm:ss"),
   *  stops paging once a page reaches records at or before `since` (the band ignores resume dates). */
  async history(kind, { since = null, maxPages = 60 } = {}) {
    const records = [];
    let mode = 0x00;
    for (let i = 0; i < maxPages; i++) {
      this.inbox.length = 0;
      await this.send([HISTORY[kind].cmd, mode]);
      const page = new HistoryPage(kind);
      await this.collect(15, { idle: 5, until: (r) => page.feed(r) });
      const recs = page.records;
      records.push(...recs);
      if (page.done || !recs.length) break;
      if (since && recs.some((c) => { const t = recordTime(kind, c); return t !== null && t <= since; })) break;
      mode = 0x02;
    }
    return records;
  }

  /** Rename the band (it will advertise "V5 <name>"). */
  async rename(name) {
    this.inbox.length = 0;
    await this.write(namePacket(name));
    return this.collect(1.5);
  }

  /** Make the band buzz and show a short message (ASCII). Resolves with the band's replies. */
  async buzz(message) {
    this.inbox.length = 0;
    await this.write(notifyPacket(message));
    return this.collect(2);
  }

  /** Send one settings command and return the replies (for 2A/2B/34/02). */
  async command(bytes, wait = 1.5) {
    this.inbox.length = 0;
    await this.write(bytes);
    return this.collect(wait);
  }

  /** ECG spot check (vendor buildStartEcgCommand): 07 01, then 28 04 01 00 FF FF. The band streams
   *  0x07 packets only while a finger touches the plate. onSamples(mV[], packet) per packet. */
  async ecg(onSamples, isStopped, maxSecs = 60) {
    this.inbox.length = 0;
    await this.send([0x07, 0x01]);
    await this.send([Cmd.measure, 0x04, 0x01, 0x00, 0xff, 0xff]);
    const t0 = Date.now();
    try {
      while (!isStopped() && this.connected && Date.now() - t0 < maxSecs * 1000) {
        for (const r of await this.collect(0.2)) {
          if (r[0] === 0x07 && r.length > 16) onSamples(decodeEcgPacket(r), r);
        }
      }
    } finally {
      if (this.connected) {
        await this.send([0x07, 0x01, 0x00]);
        await this.send([Cmd.measure, 0x04, 0x00, 0x00, 0x00, 0x00]);
      }
    }
  }

  /** One live reading (steps today, current HR, skin temp) via a ~2 s realtime burst. */
  async snapshot(decode) {
    this.inbox.length = 0;
    await this.send([Cmd.realtime, 0x01]);
    let last = null;
    try {
      for (const r of await this.collect(2.5)) last = decode(r) ?? last;
    } finally {
      if (this.connected) await this.send([Cmd.realtime, 0x00]);
    }
    return last;
  }

  /** Live 1 Hz stream; calls onPacket for every notification until isStopped() is true. */
  async live(onPacket, isStopped) {
    this.inbox.length = 0;
    await this.send([Cmd.realtime, 0x01]);
    try {
      while (!isStopped() && this.connected) {
        for (const r of await this.collect(0.5)) onPacket(r);
      }
    } finally {
      if (this.connected) await this.send([Cmd.realtime, 0x00]);
    }
  }
}
