// First run: one question per screen, big buttons, no accounts. Ends with the band connected and a
// first sync, then how to wear it.
import * as db from "../core/db.js?v=20260924162635";
import { DEFAULT_SCHEDULE } from "../core/sync.js?v=20260924162635";
import { ftInToCm, lbToKg } from "../core/units.js?v=20260924162635";
import { toast } from "../ui/components.js?v=20260924162635";
import { h, icon, s } from "../ui/h.js?v=20260924162635";

const state = { step: 0, draft: {} };
const STEPS = ["welcome", "name", "about", "health", "band", "wear"];

export default async function onboarding(ctx) {
  const d = state.draft;
  if (!d.init) Object.assign(d, { init: true, ...ctx.profile, units: ctx.profile.units ?? "us" });
  const step = STEPS[state.step];
  const go = (n) => { state.step = Math.max(0, Math.min(STEPS.length - 1, n)); ctx.refresh(); };
  const next = () => go(state.step + 1);
  const wrap = h("div.ob",
    h("div.steps", STEPS.map((_, i) => h("i", { class: i <= state.step ? "on" : "" }))),
    state.step > 0 && step !== "wear" ? h("button.back", { type: "button", style: { alignSelf: "flex-start" }, onclick: () => go(state.step - 1) }, icon("back"), "Back") : null);

  if (step === "welcome") {
    wrap.append(h("div.art", logo()),
      h("h1", "Your heart, sleep and activity, on your phone."),
      h("p.lead", "Pulse reads your band and turns it into clear daily scores, backed by published research. Everything stays on this phone."),
      h("div.spacer"),
      h("button.btn.primary.full", { type: "button", onclick: next }, "Get started"));
  }

  if (step === "name") {
    const input = h("input", { value: d.name ?? "", autocomplete: "given-name", placeholder: "First name", style: { fontSize: "22px" } });
    wrap.append(h("h1", "What should we call you?"), h("div.form", h("label.full", input)), h("div.spacer"),
      h("button.btn.primary.full", { type: "button", onclick: () => { d.name = input.value.trim(); next(); } }, "Continue"));
    setTimeout(() => input.focus(), 50);
  }

  if (step === "about") {
    const us = d.units !== "metric";
    const f = {
      age: h("input", { value: d.age ?? "", inputmode: "numeric", pattern: "[0-9]*", placeholder: "65" }),
      ft: h("input", { value: d.ft ?? "", inputmode: "numeric", pattern: "[0-9]*", placeholder: "5" }),
      inch: h("input", { value: d.inch ?? "", inputmode: "numeric", pattern: "[0-9]*", placeholder: "8" }),
      cm: h("input", { value: d.cm ?? "", inputmode: "numeric", placeholder: "172" }),
      wt: h("input", { value: d.wt ?? "", inputmode: "decimal", placeholder: us ? "165" : "75" }),
    };
    const sexBox = h("div.choice", { style: { flexDirection: "row" } });
    const paint = () => sexBox.replaceChildren(...[["female", "Female"], ["male", "Male"]].map(([k, l]) => h("button", { type: "button", class: d.sex === k ? "on" : "", style: { flex: 1 }, onclick: () => { d.sex = k; paint(); } }, l, h("span.ck"))));
    paint();
    wrap.append(h("h1", "A little about you"),
      h("p.lead", "Sleep needs, step goals and heart-rate zones depend on these."),
      h("div.form",
        h("label.full", "Age", f.age),
        h("div.full", sexBox),
        ...(us ? [h("label", "Height (feet)", f.ft), h("label", "(inches)", f.inch)] : [h("label.full", "Height (cm)", f.cm)]),
        h("label.full", `Weight (${us ? "pounds" : "kg"})`, f.wt)),
      h("button.link", { type: "button", onclick: () => { d.units = us ? "metric" : "us"; ctx.refresh(); } }, us ? "Use metric units" : "Use US units"),
      h("div.spacer"),
      h("button.btn.primary.full", { type: "button", onclick: () => {
        const age = parseInt(f.age.value, 10);
        const height = us ? ftInToCm(parseInt(f.ft.value, 10) || 0, parseInt(f.inch.value, 10) || 0) : parseFloat(f.cm.value);
        const w = parseFloat(f.wt.value);
        Object.assign(d, { ft: f.ft.value, inch: f.inch.value, cm: f.cm.value, wt: f.wt.value });
        if (!(age >= 18 && age <= 110)) { toast("Please enter your age."); return; }
        if (!d.sex) { toast("Please choose female or male."); return; }
        if (!(height >= 120 && height <= 230)) { toast("Please check your height."); return; }
        if (!(w > 0)) { toast("Please enter your weight."); return; }
        Object.assign(d, { age, height, weight: us ? lbToKg(w) : w });
        finishProfile(ctx, d).then(next);
      } }, "Continue"));
  }

  if (step === "health") {
    const yn = (key, label, sub) => {
      const box = h("div.choice", { style: { flexDirection: "row" } });
      const paint = () => box.replaceChildren(...[[true, "Yes"], [false, "No"]].map(([v, l]) => h("button", { type: "button", class: d[key] === v ? "on" : "", style: { flex: 1, minHeight: "52px" }, onclick: () => { d[key] = v; paint(); } }, l, h("span.ck"))));
      paint();
      return h("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } }, h("b", { style: { fontSize: "18px", fontWeight: 600 } }, label), sub ? h("p.note", sub) : null, box);
    };
    wrap.append(h("h1", "Two quick health questions"),
      yn("betablocker", "Do you take a beta-blocker?", "For example metoprolol, carvedilol, atenolol, bisoprolol or propranolol. They slow the heart, so Pulse adjusts its heart-rate targets."),
      yn("snore", "Do you snore loudly?", "Loud enough to be heard through a closed door. This starts a sleep-apnea screening you can finish later."),
      h("div.spacer"),
      h("button.btn.primary.full", { type: "button", onclick: () => finishProfile(ctx, d).then(next) }, "Continue"));
  }

  if (step === "band") {
    const android = /android/i.test(navigator.userAgent);
    const hasBt = !!navigator.bluetooth;
    const status = h("p.note", { style: { textAlign: "center", minHeight: "24px" } });
    const btn = h("button.btn.primary.full", { type: "button" }, icon("bt"), "Connect my band");
    btn.onclick = async () => {
      // The Bluetooth picker must open straight from the tap (user activation), so nothing is awaited first;
      // the profile was already saved on the previous steps.
      btn.disabled = true;
      status.textContent = "Choose your band (JCV8B…) in the list that appears.";
      const onStatus = () => { if (ctx.status) status.textContent = ctx.status; };
      document.addEventListener("pulse:status", onStatus);
      const ok = await ctx.connect();
      document.removeEventListener("pulse:status", onStatus);
      btn.disabled = false;
      if (ok) {
        // Name the band after its owner so the phone's picker shows "V5 Pat" from now on (couples share homes).
        if (d.name && !ctx.band.name.includes(d.name.slice(0, 12))) await ctx.band.rename(d.name).catch(() => {});
        toast("Band connected and synced"); next();
      }
      else status.textContent = "Not connected yet. Make sure the band is charged, on your wrist or next to the phone, and not connected to another phone, then try again.";
    };
    wrap.append(h("div.art", bandArt()), h("h1", "Connect your band"),
      h("ol.stepslist",
        h("li", "Charge the band for about an hour first."),
        h("li", "Keep it within arm's reach of this phone."),
        h("li", android ? "When Chrome asks, allow Nearby devices. On older phones, turn on Location too (Android needs it to find Bluetooth devices)." : "When Bluefy asks, allow Bluetooth."),
        h("li", "Tap below, then choose your band: the one with your name (", h("strong", "V5 …"), "), or starting with ", h("strong", "JCV8B"), " if it hasn't been named yet.")),
      !hasBt ? h("p.note", { style: { color: "var(--watch)" } }, android ? "This browser can't use Bluetooth. Open this page in Google Chrome." : "Safari can't use Bluetooth. Install the free Bluefy app from the App Store and open this page there.") : null,
      h("div.spacer"), status, btn,
      h("button.link", { type: "button", style: { alignSelf: "center" }, onclick: async () => { await finishProfile(ctx, d); next(); } }, "I'll connect later"));
  }

  if (step === "wear") {
    const band = (await db.all(ctx.store, "band"))[0];
    const liveHr = band?.snapshot?.hr;
    wrap.append(h("h1", "You're all set" + (d.name ? `, ${d.name}` : "") + "."),
      liveHr ? h("div.card", { style: { display: "flex", alignItems: "center", gap: "14px" } },
        h("span", { style: { width: "48px", height: "48px", borderRadius: "16px", display: "grid", placeItems: "center", background: "color-mix(in srgb, var(--heart) 16%, transparent)", color: "var(--heart)", flex: "none" } }, icon("heart")),
        h("div", h("b", { style: { fontSize: "17px" } }, `Your heart rate right now: ${liveHr} bpm`), h("p.note", "Your band is connected and working."))) : null,
      h("div", { style: { display: "flex", flexDirection: "column", gap: "16px" } },
        tip("band", "Wear it snug", "A finger's width above the wrist bone, tight enough that it doesn't slide. Loose bands give noisy readings."),
        tip("sleep", "Wear it to bed", "Sleep, overnight heart rate, HRV and blood oxygen are measured while you sleep. Scores appear after your first night."),
        tip("sync", "Open Pulse each morning", "With the band nearby, Pulse syncs by itself. Your recovery baseline builds over the first week."),
        tip("activity", "Charge while you shower", "A short daily top-up keeps it going; Pulse warns you when the battery is low.")),
      h("div.spacer"),
      h("button.btn.primary.full", { type: "button", onclick: async () => { await finishProfile(ctx, d, true); state.step = 0; ctx.nav("today"); } }, "Go to Today"));
  }
  return h("div.screen", wrap);
}

async function finishProfile(ctx, d, done = false) {
  const p = { ...ctx.profile, name: d.name, age: d.age, sex: d.sex, height: d.height, weight: d.weight, units: d.units, betablocker: !!d.betablocker,
    stopbang: { ...(ctx.profile.stopbang ?? {}), ...(d.snore != null ? { snore: d.snore } : {}) }, onboarded: done || ctx.profile.onboarded || false };
  await ctx.setProfile(p);
  if (!(await db.getSetting(ctx.store, "schedule"))) await db.setSetting(ctx.store, "schedule", DEFAULT_SCHEDULE);
}

function tip(iconName, title, body) {
  return h("div", { style: { display: "flex", gap: "14px", alignItems: "flex-start" } },
    h("span", { style: { width: "44px", height: "44px", borderRadius: "14px", display: "grid", placeItems: "center", background: "var(--surface)", border: "1px solid var(--line)", flex: "none" } }, icon(iconName)),
    h("div", h("b", { style: { fontSize: "17px" } }, title), h("p.note", body)));
}

function logo() {
  return s("svg", { viewBox: "0 0 180 180", "aria-hidden": "true" },
    s("defs", s("linearGradient", { id: "lg", x1: "0", y1: "0", x2: "1", y2: "1" }, s("stop", { offset: "0", "stop-color": "var(--sleep)" }), s("stop", { offset: "1", "stop-color": "var(--heart)" }))),
    s("circle", { cx: 90, cy: 90, r: 74, fill: "none", stroke: "var(--track)", "stroke-width": 12 }),
    s("circle", { cx: 90, cy: 90, r: 74, fill: "none", stroke: "url(#lg)", "stroke-width": 12, "stroke-linecap": "round", "stroke-dasharray": "465", "stroke-dashoffset": "120", transform: "rotate(-90 90 90)" }),
    s("path", { d: "M48 94h20l9-22 16 44 12-30 7 8h20", fill: "none", stroke: "var(--ink)", "stroke-width": 7, "stroke-linecap": "round", "stroke-linejoin": "round" }));
}

function bandArt() {
  return s("svg", { viewBox: "0 0 180 180", "aria-hidden": "true" },
    s("rect", { x: 62, y: 8, width: 56, height: 164, rx: 26, fill: "var(--surface-2)", stroke: "var(--line-2)" }),
    s("rect", { x: 56, y: 52, width: 68, height: 76, rx: 18, fill: "var(--surface-3)", stroke: "var(--line-2)" }),
    s("rect", { x: 66, y: 62, width: 48, height: 56, rx: 12, fill: "var(--bg)" }),
    s("path", { d: "M72 92h9l5-12 8 22 6-14 4 4h6", fill: "none", stroke: "var(--heart)", "stroke-width": 3, "stroke-linecap": "round", "stroke-linejoin": "round" }),
    s("circle", { cx: 150, cy: 60, r: 5, fill: "var(--accent)", opacity: 0.9 }), s("circle", { cx: 150, cy: 60, r: 13, fill: "none", stroke: "var(--accent)", "stroke-width": 2, opacity: 0.5 }),
    s("circle", { cx: 150, cy: 60, r: 22, fill: "none", stroke: "var(--accent)", "stroke-width": 2, opacity: 0.25 }));
}
