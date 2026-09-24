// Reusable pieces of the Pulse design system. Each returns a DOM node.
import { h, icon, s } from "./h.js?v=20260924162635";

/** Status for a 0-100 score: fixed bands (WHOOP-style thresholds, held constant app-wide). */
export function scoreStatus(v) {
  if (v == null) return { key: "none", label: "—", color: "var(--ink-3)" };
  if (v >= 85) return { key: "good", label: "Optimal", color: "var(--good)" };
  if (v >= 70) return { key: "good", label: "Good", color: "var(--good)" };
  if (v >= 55) return { key: "watch", label: "Fair", color: "var(--watch)" };
  return { key: "attention", label: "Low", color: "var(--attention)" };
}

/**
 * Score ring. value 0-100 (or null for "building"). color: CSS color for the arc.
 * size/stroke in px. label is rendered as HTML over the SVG so it scales with text settings.
 */
export function ring(value, { size = 96, stroke = 9, color = "var(--accent)", text = null, suffix = "", font = null, animate = true, aria = "" } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const frac = value == null ? 0 : Math.max(0, Math.min(1, value / 100));
  const arc = s("circle.arc", { style: `color:${color}`, cx: size / 2, cy: size / 2, r, fill: "none", stroke: color, "stroke-width": stroke, "stroke-linecap": "round",
    "stroke-dasharray": c.toFixed(2), "stroke-dashoffset": (animate ? c : c * (1 - frac)).toFixed(2), transform: `rotate(-90 ${size / 2} ${size / 2})` });
  if (value == null) arc.setAttribute("stroke-opacity", "0");
  const svg = s("svg", { viewBox: `0 0 ${size} ${size}`, width: size, height: size, "aria-hidden": "true" },
    s("circle", { cx: size / 2, cy: size / 2, r, fill: "none", stroke: "var(--track)", "stroke-width": stroke }), arc);
  const label = h("span.rv", { class: value == null ? "dim" : "", style: { fontSize: `${font ?? Math.round(size * 0.34)}px` } },
    text ?? (value == null ? "—" : Math.round(value)), suffix ? h("small", suffix) : null);
  const el = h("div.ring", { style: { width: `${size}px`, height: `${size}px` }, role: "img", "aria-label": aria }, svg, label);
  if (animate && value != null) requestAnimationFrame(() => requestAnimationFrame(() => arc.setAttribute("stroke-dashoffset", (c * (1 - frac)).toFixed(2))));
  return el;
}

export function chip(text, kind = "", iconName = null) {
  return h("span.chip", { class: kind }, iconName ? icon(iconName) : null, text);
}

/** Direction chip vs baseline: arrow only when the change is outside normal day-to-day noise. */
export function deltaChip(z, { goodWhen = "down", delta = null, minAbs = 0, labels = { up: "Above usual", down: "Below usual", flat: "Typical" } } = {}) {
  if (z == null || !Number.isFinite(z)) return null;
  if (Math.abs(z) < 1 || (delta != null && Math.abs(delta) < minAbs)) return chip(labels.flat, "");
  const dir = z > 0 ? "up" : "down";
  const good = dir === goodWhen;
  return chip(labels[dir], Math.abs(z) >= 2 && !good ? "attention" : good ? "good" : "watch", dir);
}

export function sparkline(values, color, { height = 30, width = 140, band = null } = {}) {
  const v = values.map((x) => (x == null || !Number.isFinite(x) ? null : x));
  const nums = v.filter((x) => x != null);
  const svg = s("svg.spark", { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none", "aria-hidden": "true" });
  if (nums.length < 2) return svg;
  let lo = Math.min(...nums, band?.lo ?? Infinity), hi = Math.max(...nums, band?.hi ?? -Infinity);
  if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
  const pad = 4;
  const x = (i) => (i / (v.length - 1)) * (width - 2 * pad) + pad;
  const y = (val) => height - pad - ((val - lo) / (hi - lo)) * (height - 2 * pad);
  if (band) svg.append(s("rect", { x: 0, width, y: y(band.hi), height: Math.max(1, y(band.lo) - y(band.hi)), fill: "var(--line-2)", rx: 3 }));
  let d = "", pen = false;
  v.forEach((val, i) => { if (val == null) { pen = false; return; } d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(val).toFixed(1)}`; pen = true; });
  svg.append(s("path", { d, fill: "none", stroke: color, "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke" }));
  const li = v.length - 1 - [...v].reverse().findIndex((x) => x != null);
  svg.append(s("circle", { cx: x(li), cy: y(v[li]), r: 3.2, fill: color, stroke: "var(--surface)", "stroke-width": 2 }));
  return svg;
}

/** Metric tile: label with a color swatch, big value + unit, sub line, optional chip and sparkline. */
export function tile({ label, color, value, unit, sub, chipEl = null, spark = null, onClick = null, wide = false, aria = null }) {
  const el = h("div.tile", { class: `${onClick ? "tap" : ""} ${wide ? "wide" : ""}`, role: onClick ? "button" : null, tabindex: onClick ? 0 : null,
    onclick: onClick, onkeydown: onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : null,
    "aria-label": aria },
    h("div.tl", h("span.sw", { style: { background: color } }), label),
    h("div.tv", value ?? "—", unit && value != null ? h("small", unit) : null),
    sub || chipEl ? h("div.ts", chipEl, chipEl && sub ? " " : "", sub) : null,
    spark);
  return el;
}

export function section(title, action = null) {
  return h("div.section", h("h2", title), action);
}

export function card(...kids) { return h("div.card", ...kids); }

export function cardHead(title, meta = null) {
  return h("div.card-head", h("h2", title), meta != null ? h("span.meta", meta) : null);
}

/** A row in a list: {label, sub, value, unit, onClick, lead}. */
export function row({ label, sub = null, value = null, unit = null, onClick = null, lead = null, extra = null, trailing = null }) {
  return h("div.row", { class: onClick ? "tap" : "", onclick: onClick, role: onClick ? "button" : null, tabindex: onClick ? 0 : null },
    lead,
    h("div.rl", h("b", label), sub ? h("span", sub) : null, extra),
    value != null ? h("div.rr", value, unit ? h("small", unit) : null) : null,
    trailing ?? (onClick ? icon("chev", "chev") : null));
}

/** Where today's value sits against your usual range (median ± 1 SD), on a lo..hi scale. */
export function rangeBar({ value, center, spread, lo, hi, color }) {
  const pos = (v) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100))}%`;
  const a = center - spread, b = center + spread;
  return h("div.rangebar", { "aria-hidden": "true" },
    h("div.trk"),
    h("div.usual", { style: { left: pos(a), width: `calc(${pos(b)} - ${pos(a)})` } }),
    value != null ? h("div.you", { style: { left: pos(value), background: color } }) : null);
}

export function segmented(options, value, onChange, label = "Range") {
  const el = h("div.seg", { role: "group", "aria-label": label });
  for (const [v, text] of options) {
    el.append(h("button", { type: "button", class: v === value ? "on" : "", "aria-pressed": v === value ? "true" : "false",
      onclick: () => { if (v !== value) onChange(v); } }, text));
  }
  return el;
}

export function banner({ title, body, kind = "accent", iconName = "info", onClose = null, action = null }) {
  const color = { accent: "var(--accent)", good: "var(--good)", watch: "var(--watch)", attention: "var(--attention)" }[kind] ?? kind;
  return h("div.banner", { vars: { "--c": color }, role: kind === "attention" ? "alert" : null },
    icon(iconName, "bi"),
    h("div", { style: { flex: "1", minWidth: "0" } }, h("b", title), body ? h("p", body) : null, action),
    onClose ? h("button.x", { type: "button", "aria-label": "Dismiss", onclick: onClose }, icon("close")) : null);
}

/** "Building your baseline" state: have/need nights with a progress bar. */
export function building(have, need, text) {
  return h("div.building",
    h("div", { style: { fontWeight: 600, color: "var(--ink-2)" } }, `Building your baseline · night ${Math.min(have + 1, need)} of ${need}`),
    h("div.bar", h("i", { style: { width: `${Math.round((100 * Math.min(have, need)) / need)}%` } })),
    text ? h("p.note", { style: { maxWidth: "300px" } }, text) : null);
}

let sheetOpen = null;
/** Bottom sheet with a title; returns a close function. */
export function sheet(title, ...content) {
  closeSheet();
  const scrim = h("div.sheet-scrim", { onclick: () => closeSheet() });
  const panel = h("div.sheet", { role: "dialog", "aria-modal": "true", "aria-label": title },
    h("div.grab"),
    h("div.sh", h("h2", title), h("button.iconbtn", { type: "button", "aria-label": "Close", onclick: () => closeSheet() }, icon("close"))),
    ...content);
  document.body.append(scrim, panel);
  document.body.style.overflow = "hidden";
  sheetOpen = { scrim, panel };
  panel.querySelector("button")?.focus({ preventScroll: true });
  return closeSheet;
}
export function closeSheet() {
  if (!sheetOpen) return;
  sheetOpen.scrim.remove(); sheetOpen.panel.remove();
  document.body.style.overflow = "";
  sheetOpen = null;
}

let toastTimer = null;
export function toast(text, ms = 3200) {
  document.querySelector(".toast")?.remove();
  const el = h("div.toast", { role: "status" }, text);
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), ms);
}

/** Header for tab screens: eyebrow (small caps) + large title + trailing controls. */
export function header(eyebrow, title, ...trailing) {
  return h("header.head", h("div.titles", eyebrow ? h("span.eyebrow", eyebrow) : null, h("h1", title)), h("div", { style: { display: "flex", gap: "8px" } }, ...trailing));
}

/** Header for pushed detail screens: back button + optional trailing. */
export function detailHeader(onBack, ...trailing) {
  return h("header.head", h("button.back", { type: "button", onclick: onBack, "aria-label": "Back" }, icon("back"), "Back"), h("div", ...trailing));
}

export function stageBar(parts) {
  const el = h("div.stagebar", { role: "img", "aria-label": parts.map((p) => `${p.label} ${p.minutes} min`).join(", ") });
  for (const p of parts) if (p.minutes > 0) el.append(h("span", { style: { flex: String(p.minutes), background: p.color } }));
  return el;
}

/** Contributor row: label + note, value on the right, and a thin meter showing how much of the part's
 *  points were earned. */
export function meterRow({ label, sub, value, frac, color, points = null }) {
  return h("div.row", { style: { flexWrap: "wrap", rowGap: "0" } },
    h("div.rl", h("b", label), sub ? h("span", sub) : null),
    h("div.rr", value, points ? h("small", ` · ${points}`) : null),
    h("div.meter", { style: { flexBasis: "100%" } }, h("i", { style: { width: `${Math.round(Math.max(0.02, frac) * 100)}%`, background: color } })));
}
