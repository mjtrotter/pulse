const out = document.getElementById("out");
const log = (s) => { out.textContent += `${new Date().toTimeString().slice(0, 8)}  ${s}\n`; };
log(`userAgent: ${navigator.userAgent}`);
log(`navigator.bluetooth: ${typeof navigator.bluetooth}`);
if (navigator.bluetooth) log(`methods: ${Object.keys(Object.getPrototypeOf(navigator.bluetooth)).concat(Object.keys(navigator.bluetooth)).join(", ")}`);
async function test(all) {
  log(`tap: requestDevice (${all ? "all" : "JCV8 filter"})`);
  const svc = "0000fff0-0000-1000-8000-00805f9b34fb";
  try {
    const d = await navigator.bluetooth.requestDevice(all ? { acceptAllDevices: true, optionalServices: [svc] }
      : { filters: [{ namePrefix: "JCV8" }], optionalServices: [svc] });
    log(`picked: ${d.name} (${d.id})`);
    const g = await d.gatt.connect(); log("gatt connected");
    const s = await g.getPrimaryService(svc); log("service found");
    const n = await s.getCharacteristic("0000fff7-0000-1000-8000-00805f9b34fb");
    const w = await s.getCharacteristic("0000fff6-0000-1000-8000-00805f9b34fb");
    n.addEventListener("characteristicvaluechanged", (e) => {
      const v = new Uint8Array(e.target.value.buffer); log(`notify: ${[...v].map((x) => x.toString(16).padStart(2, "0")).join(" ")}`);
    });
    await n.startNotifications(); log("notifications on");
    const p = new Uint8Array(16); p[0] = 0x13; p[15] = 0x13; // battery query
    await (w.writeValueWithResponse ?? w.writeValue).call(w, p); log("battery query sent");
    setTimeout(() => { d.gatt.disconnect(); log("disconnected"); }, 2500);
  } catch (e) { log(`ERROR ${e.name}: ${e.message}`); }
}
document.getElementById("a").onclick = () => test(false);
document.getElementById("b").onclick = () => test(true);
