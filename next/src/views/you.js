// You: profile, health questions (beta-blocker, STOP-Bang), band and its schedule, display, data.
import * as db from "../core/db.js?v=20260924162635";
import { DEFAULT_SCHEDULE } from "../core/sync.js?v=20260924162635";
import { relTime } from "../core/time.js?v=20260924162635";
import { cmToFtIn, ftInToCm, isUS, kg, lbToKg } from "../core/units.js?v=20260924162635";
import { ensureSummaries, SUMMARY_VERSION } from "../analytics/summary.js?v=20260924162635";
import { scoreDays } from "../analytics/scores.js?v=20260924162635";
import { card, cardHead, chip, closeSheet, detailHeader, row, section, segmented, sheet, toast } from "../ui/components.js?v=20260924162635";
import { h, icon } from "../ui/h.js?v=20260924162635";

/** STOP-Bang (Chung 2008/2016): 8 yes/no items; 0-2 low, 3-4 intermediate, 5-8 high risk of
 *  obstructive sleep apnea. Score ≥ 3: ~90% sensitivity for moderate-to-severe OSA (Nagappa 2015). */
export function stopBang(p) {
  const a = p.stopbang ?? {};
  const bmi = p.height && p.weight ? p.weight / (p.height / 100) ** 2 : null;
  const items = {
    snore: !!a.snore, tired: !!a.tired, observed: !!a.observed, pressure: !!a.pressure,
    bmi: bmi != null && bmi > 35, age: (p.age ?? 0) > 50, neck: !!a.neck, male: p.sex === "male",
  };
  const answered = ["snore", "tired", "observed", "pressure", "neck"].every((k) => a[k] != null);
  const score = Object.values(items).filter(Boolean).length;
  return { score, answered, bmi, risk: score >= 5 ? "High" : score >= 3 ? "Intermediate" : "Low", kind: score >= 5 ? "attention" : score >= 3 ? "watch" : "good" };
}

export default async function you(ctx) {
  const p = ctx.profile;
  const screen = h("div.screen", detailHeader(() => ctx.back()), h("header.head", h("div.titles", h("span.eyebrow", "Profile & settings"), h("h1", p.name || "You"))));

  // Profile
  const [ft, inch] = p.height ? cmToFtIn(p.height) : [null, null];
  screen.append(card(cardHead("Profile"), h("div.rows",
    row({ label: "Name", value: p.name || "—", onClick: () => editProfile(ctx) }),
    row({ label: "Age", value: p.age ?? "—", onClick: () => editProfile(ctx) }),
    row({ label: "Sex", value: p.sex ? p.sex[0].toUpperCase() + p.sex.slice(1) : "—", onClick: () => editProfile(ctx) }),
    row({ label: "Height", value: p.height ? (isUS() ? `${ft}′ ${inch}″` : `${Math.round(p.height)} cm`) : "—", onClick: () => editProfile(ctx) }),
    row({ label: "Weight", value: p.weight ? (isUS() ? `${Math.round(kg(p.weight))} lb` : `${Math.round(p.weight)} kg`) : "—", onClick: () => editProfile(ctx) })),
    h("p.fine", { style: { textAlign: "left", padding: "8px 0 0" } }, "Used for sleep need, step goals and heart-rate zones, and sent to the band so its distance and calorie estimates fit you.")));

  // Health
  const sb = stopBang(p);
  screen.append(card(cardHead("Health"), h("div.rows",
    row({ label: "Beta-blocker", sub: "Metoprolol, carvedilol, atenolol, bisoprolol, propranolol…", trailing: toggle(!!p.betablocker, async (v) => { await ctx.setProfile({ ...p, betablocker: v }); await rebuild(ctx); }) }),
    row({ label: "Sleep apnea screening", sub: sb.answered ? `STOP-Bang ${sb.score} of 8` : "4 quick questions (STOP-Bang)", trailing: sb.answered ? chip(`${sb.risk} risk`, sb.kind) : null, onClick: () => stopBangSheet(ctx) }),
    p.sex === "female" ? row({ label: "Cycle insights", sub: "Uses the overnight temperature shift after ovulation", trailing: toggle(!!p.cycle, (v) => ctx.setProfile({ ...p, cycle: v })) }) : null),
    h("p.fine", { style: { textAlign: "left", padding: "8px 0 0" } }, "Beta-blockers slow the heart, so Pulse adjusts heart-rate zones and workout detection when you take one.")));

  // Band
  const band = (await db.all(ctx.store, "band")).sort((a, b) => (a.last_sync < b.last_sync ? 1 : -1))[0];
  const sched = await db.getSetting(ctx.store, "schedule");
  const connected = !!ctx.band?.connected;
  screen.append(section("Band"));
  screen.append(card(h("div.rows",
    row({ label: connected ? "Connected" : "Not connected", sub: band ? `${band.name} · last sync ${band.last_sync ? relTime(band.last_sync) : "never"}` : "No band paired yet",
      trailing: h("button.btn.small", { type: "button", onclick: () => (connected ? ctx.disconnect() : ctx.connect()) }, connected ? "Disconnect" : "Connect") }),
    band?.battery != null ? row({ label: "Battery", sub: "At the last sync", value: `${band.battery}%` }) : null,
    band?.firmware ? row({ label: "Firmware", value: band.firmware }) : null,
    row({ label: "Extra overnight readings", sub: "Blood oxygen and heart-rhythm recordings every 10 minutes instead of every 30–60. Uses more battery.",
      trailing: toggle(!!sched, async (v) => { await db.setSetting(ctx.store, "schedule", v ? DEFAULT_SCHEDULE : { spo2: 30, hrv: 60, osa: false }); toast(v ? "Applied at the next sync" : "Back to standard readings at the next sync"); ctx.refresh(); }) })),
    connected ? h("button.btn.full", { type: "button", style: { marginTop: "10px" }, onclick: () => ctx.sync() }, icon("sync"), "Sync now") : null));

  // Display
  screen.append(section("Display"));
  screen.append(card(h("div.rows",
    h("div.row", h("div.rl", h("b", "Units")), segmented([["us", "US"], ["metric", "Metric"]], p.units ?? "us", async (v) => { await ctx.setProfile({ ...p, units: v }); ctx.refresh(); }, "Units")),
    h("div.row", h("div.rl", h("b", "Appearance")), segmented([["auto", "Auto"], ["dark", "Dark"], ["light", "Light"]], p.theme ?? "auto", async (v) => { await ctx.setProfile({ ...p, theme: v }); ctx.refresh(); }, "Theme")),
    h("div.row", h("div.rl", h("b", "Text size")), segmented([["standard", "Standard"], ["large", "Large"]], p.textSize ?? "standard", async (v) => { await ctx.setProfile({ ...p, textSize: v }); ctx.refresh(); }, "Text size")))));

  // Data
  const counts = await db.counts(ctx.store);
  const file = h("input", { type: "file", accept: "application/json,.json", hidden: true, onchange: async () => {
    const f = file.files[0]; if (!f) return;
    try { const added = await db.importAll(ctx.store, JSON.parse(await f.text())); await rebuild(ctx); toast(`Imported ${Object.values(added).reduce((a, b) => a + b, 0).toLocaleString()} readings`); ctx.refresh(); }
    catch (e) { toast(`Couldn't import: ${e.message}`); }
  } });
  screen.append(section("Your data"));
  screen.append(card(h("div.rows",
    row({ label: "Heart-rate readings", value: counts.hr.toLocaleString() }),
    row({ label: "Nights of sleep", value: new Set((await db.all(ctx.store, "summary")).filter((s) => s.night?.sleep).map((s) => s.date)).size }),
    row({ label: "Rhythm checks", value: counts.ecg }),
    row({ label: "Blood-pressure readings", value: counts.bp })),
    h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "12px" } },
      h("button.btn", { type: "button", onclick: () => exportData(ctx) }, icon("download"), "Back up"),
      h("button.btn", { type: "button", onclick: () => file.click() }, icon("upload"), "Restore"), file),
    h("p.fine", { style: { textAlign: "left", padding: "10px 0 0" } }, "Everything stays on this phone; Pulse can't send data anywhere. Back up now and then (save the file to Files or email it to yourself), because deleting the browser's data would erase it. The band also keeps several days of history.")));

  // Log + about
  screen.append(section("About"));
  const logList = h("ol.log", ctx.logLines.map((l) => h("li", { class: l.isError ? "err" : "" }, `${l.t}  ${l.text}`)));
  const build = new URL(import.meta.url).searchParams.get("v") ?? "dev";
  screen.append(card(h("div.rows",
    row({ label: "Methods & sources", sub: "How each number is computed, and the research behind it", onClick: () => ctx.nav("methods") }),
    row({ label: "Version", value: build }),
    row({ label: "Rebuild analysis", sub: "Recalculates every day from the stored readings", onClick: async () => { await rebuild(ctx, true); toast("Rebuilt"); ctx.refresh(); } })),
    h("details", { style: { marginTop: "10px" } }, h("summary", { style: { cursor: "pointer", fontWeight: 600, minHeight: "36px" } }, "Connection log"), logList)));
  screen.append(h("p.fine", "Pulse: private health analytics for the JC V8 band. Methods follow published research cited in each screen. Not a medical device. Font: Inter (SIL Open Font License)."));
  return screen;
}

function toggle(on, onChange) {
  const el = h("button.toggle", { type: "button", role: "switch", "aria-checked": on ? "true" : "false", class: on ? "on" : "" });
  el.onclick = (e) => { e.stopPropagation(); on = !on; el.classList.toggle("on", on); el.setAttribute("aria-checked", on ? "true" : "false"); onChange(on); };
  return el;
}

async function rebuild(ctx, all = false) {
  if (all) { const tx = ctx.store.transaction("summary", "readwrite"); tx.objectStore("summary").clear(); await new Promise((ok) => { tx.oncomplete = ok; }); }
  else { const rows = await db.all(ctx.store, "summary"); await db.putMany(ctx.store, "summary", rows.map((r) => ({ ...r, v: -1 }))); }
  await ensureSummaries(ctx.store, db, ctx.profile, scoreDays);
}

export function editProfile(ctx, onDone = null) {
  const p = ctx.profile;
  const us = isUS();
  const [ft, inch] = p.height ? cmToFtIn(p.height) : ["", ""];
  const f = {
    name: h("input", { value: p.name ?? "", autocomplete: "given-name", placeholder: "First name" }),
    age: h("input", { value: p.age ?? "", inputmode: "numeric", pattern: "[0-9]*", placeholder: "60" }),
    ft: h("input", { value: ft, inputmode: "numeric", pattern: "[0-9]*", placeholder: "5" }),
    inch: h("input", { value: inch, inputmode: "numeric", pattern: "[0-9]*", placeholder: "9" }),
    cm: h("input", { value: p.height ? Math.round(p.height) : "", inputmode: "numeric", placeholder: "175" }),
    wt: h("input", { value: p.weight ? Math.round(us ? kg(p.weight) : p.weight) : "", inputmode: "decimal", placeholder: us ? "170" : "77" }),
  };
  let sex = p.sex ?? null;
  const sexBox = h("div.choice", { style: { flexDirection: "row" } });
  const paint = () => sexBox.replaceChildren(...[["female", "Female"], ["male", "Male"]].map(([k, l]) => h("button", { type: "button", class: sex === k ? "on" : "", style: { flex: 1 }, onclick: () => { sex = k; paint(); } }, l, h("span.ck"))));
  paint();
  sheet("Your profile", h("form.form", { onsubmit: async (e) => {
    e.preventDefault();
    const age = parseInt(f.age.value, 10);
    const height = us ? ftInToCm(parseInt(f.ft.value, 10) || 0, parseInt(f.inch.value, 10) || 0) : parseFloat(f.cm.value);
    const w = parseFloat(f.wt.value);
    const weight = us ? lbToKg(w) : w;
    if (!(age >= 18 && age <= 110)) { toast("Age should be between 18 and 110."); return; }
    if (!(height >= 120 && height <= 230)) { toast("That height looks off."); return; }
    if (!(weight >= 30 && weight <= 250)) { toast("That weight looks off."); return; }
    await ctx.setProfile({ ...p, name: f.name.value.trim(), age, sex, height, weight });
    closeSheet();
    if (onDone) onDone(); else { await rebuild(ctx); ctx.refresh(); }
  } },
    h("label.full", "First name", f.name),
    h("label", "Age", f.age), h("div"),
    h("div.full", { style: { fontSize: "14px", fontWeight: 600, color: "var(--ink-2)" } }, "Sex (for sleep and heart-rate norms)"), h("div.full", sexBox),
    ...(us ? [h("label", "Height (ft)", f.ft), h("label", "(in)", f.inch)] : [h("label.full", "Height (cm)", f.cm)]),
    h("label.full", `Weight (${us ? "lb" : "kg"})`, f.wt),
    h("button.btn.primary.full", { type: "submit" }, "Save")));
}

export function stopBangSheet(ctx) {
  const p = ctx.profile;
  const a = { ...(p.stopbang ?? {}) };
  const qs = [
    ["snore", "Do you snore loudly (louder than talking, or heard through a closed door)?"],
    ["tired", "Do you often feel tired, fatigued or sleepy during the day?"],
    ["observed", "Has anyone seen you stop breathing, choke or gasp during sleep?"],
    ["pressure", "Do you have, or are you treated for, high blood pressure?"],
    ["neck", p.sex === "female" ? "Is your neck size (shirt collar) 16 inches / 41 cm or more?" : "Is your neck size (shirt collar) 17 inches / 43 cm or more?"],
  ];
  const box = h("div", { style: { display: "flex", flexDirection: "column", gap: "14px" } });
  const paint = () => box.replaceChildren(...qs.map(([k, q]) => h("div", h("p", { style: { fontWeight: 500, marginBottom: "8px" } }, q),
    h("div.choice", { style: { flexDirection: "row" } }, ...[[true, "Yes"], [false, "No"]].map(([v, l]) => h("button", { type: "button", class: a[k] === v ? "on" : "", style: { flex: 1, minHeight: "48px" }, onclick: () => { a[k] = v; paint(); } }, l, h("span.ck")))))));
  paint();
  sheet("Sleep apnea screening", h("p.note", { style: { marginBottom: "14px" } }, "STOP-Bang: four questions here, plus age, sex and BMI from your profile. It's the most widely validated sleep-apnea questionnaire."),
    box, h("button.btn.primary.full", { type: "button", style: { marginTop: "18px" }, onclick: async () => {
      await ctx.setProfile({ ...p, stopbang: a }); closeSheet();
      const r = stopBang({ ...p, stopbang: a });
      toast(`STOP-Bang ${r.score}/8: ${r.risk.toLowerCase()} risk`, 4000); ctx.refresh();
    } }, "Save answers"));
}

async function exportData(ctx) {
  const data = await db.exportAll(ctx.store);
  const name = `pulse-${(ctx.profile.name || "backup").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.json`;
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const f = new File([blob], name, { type: "application/json" });
  if (navigator.canShare?.({ files: [f] })) { await navigator.share({ files: [f], title: name }).catch(() => {}); }
  else { const a = h("a", { href: URL.createObjectURL(blob), download: name }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10e3); }
  await db.setSetting(ctx.store, "last_backup", new Date().toISOString());
}

export { SUMMARY_VERSION };
