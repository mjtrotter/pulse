// Tiny DOM builders. h("div.card.tap", {onclick, style: {...}, "aria-label": "…"}, ...children).
// Children: nodes, strings (as text, never HTML), numbers, arrays, null/false (skipped).
const SVGNS = "http://www.w3.org/2000/svg";

// Native append/prepend/replaceChildren/before/after turn null into the text "null". Screens pass optional
// pieces as `cond ? node : null`, so make these skip null/false/undefined everywhere, like h() does.
for (const name of ["append", "prepend", "replaceChildren", "before", "after"]) {
  const native = Element.prototype[name];
  if (native.__pulse) continue;
  const safe = function (...nodes) { return native.apply(this, nodes.filter((n) => n != null && n !== false && n !== true)); };
  safe.__pulse = true;
  Element.prototype[name] = safe;
}

function parseTag(tag) {
  const [name, ...cls] = tag.split(".");
  return { name: name || "div", cls };
}

function apply(el, props, isSvg) {
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.classList.add(...String(v).split(/\s+/).filter(Boolean));
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "vars") for (const [n, x] of Object.entries(v)) el.style.setProperty(n, x);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "text") el.textContent = v;
    else if (!isSvg && (k === "value" || k === "checked" || k === "disabled" || k === "hidden")) el[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
}

function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false || k === true) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export function h(tag, props, ...kids) {
  if (props instanceof Node || typeof props !== "object" || Array.isArray(props)) { kids.unshift(props); props = {}; }
  const { name, cls } = parseTag(tag);
  const el = document.createElement(name);
  if (cls.length) el.classList.add(...cls);
  apply(el, props, false);
  append(el, kids);
  return el;
}

export function s(tag, props, ...kids) {
  if (props instanceof Node || typeof props !== "object" || Array.isArray(props)) { kids.unshift(props); props = {}; }
  const { name, cls } = parseTag(tag);
  const el = document.createElementNS(SVGNS, name);
  if (cls.length) el.setAttribute("class", cls.join(" "));
  apply(el, props, true);
  append(el, kids);
  return el;
}

// Icons (24×24, stroked; currentColor).
const P = {
  today: "M4 12h3.5l2.5-6 4 12 2.5-6H20",
  sleep: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
  heart: "M12 20s-7.5-4.6-9.2-9.3C1.6 7.3 3.8 4 7.2 4c2 0 3.6 1.1 4.8 2.7C13.2 5.1 14.8 4 16.8 4c3.4 0 5.6 3.3 4.4 6.7C19.5 15.4 12 20 12 20z",
  activity: "M13 3 5 13.5h6L10 21l8-10.5h-6z",
  back: "M15 5l-7 7 7 7",
  chev: "M9 5l7 7-7 7",
  left: "M15 5l-7 7 7 7",
  right: "M9 5l7 7-7 7",
  close: "M6 6l12 12M18 6 6 18",
  sync: "M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16m0 4v-4h-4",
  bt: "M7 7l10 10-5 4V3l5 4L7 17",
  ecg: "M2 13h4l2-5 3 10 3-13 2 8h6",
  drop: "M12 3.5c3.2 4.1 6.3 7.7 6.3 11a6.3 6.3 0 0 1-12.6 0c0-3.3 3.1-6.9 6.3-11z",
  temp: "M14 14.2V5a2 2 0 1 0-4 0v9.2a4 4 0 1 0 4 0z",
  wave: "M3 12c2.4 0 2.4-6 4.8-6s2.4 12 4.8 12 2.4-9 4.8-9 1.6 3 3.6 3",
  steps: "M8.5 3c1.9 0 2.9 2.2 2.9 4.7S10.6 12 8.8 12 6 10 6 7.7 6.7 3 8.5 3zM6.4 13.6h4.7l-.3 3.1a2.3 2.3 0 0 1-4.5.1zM15.5 7.5c1.8 0 2.5 2.3 2.5 4.6s-1 4.3-2.8 4.3-2.6-2-2.6-4.3.9-4.6 2.9-4.6zM13 18h4.7l-.3 1.8a2.3 2.3 0 0 1-4.5 0z",
  cuff: "M5 6h10a4 4 0 0 1 0 8H9v4H5zM9 10h6",
  info: "M12 8h.01M11 12h1v5h1M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  alert: "M12 9v4m0 4h.01M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  up: "M12 19V5m-6 6 6-6 6 6",
  down: "M12 5v14m-6-6 6 6 6-6",
  flat: "M5 12h14",
  plus: "M12 5v14M5 12h14",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  band: "M8 3h8v18H8zM8 8h8M8 16h8",
  lungs: "M12 4v7m0 0c-1.5 1-2.5 1-3.5 0V7.5C8.5 5.6 7 5 6 6.5 4.2 9 3 13 3 16.5 3 19 5 20 7 19.5c2-.5 2.5-2 2.5-4V13M12 11c1.5 1 2.5 1 3.5 0V7.5c0-1.9 1.5-2.5 2.5-1 1.8 2.5 3 6.5 3 10 0 2.5-2 3.5-4 3-2-.5-2.5-2-2.5-4V13",
  moonzz: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5zM15 3h4l-4 4h4",
  download: "M12 4v11m-5-5 5 5 5-5M5 20h14",
  upload: "M12 20V9m-5 5 5-5 5 5M5 4h14",
  dumbbell: "M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11",
};
export function icon(name, cls = "") {
  return s("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 1.9, "stroke-linecap": "round",
    "stroke-linejoin": "round", "aria-hidden": "true", class: cls }, s("path", { d: P[name] ?? P.info }));
}

export const $ = (sel, root = document) => root.querySelector(sel);
