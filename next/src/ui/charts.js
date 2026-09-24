// SVG charts following the dataviz method: 2px lines, ≤24px bars with 4px rounded data-ends,
// hairline solid gridlines, a personal-baseline band instead of dashed guides, crosshair + tooltip
// on lines, per-mark tooltips on bars, and a table view for every chart.
import { h, s } from "./h.js?v=20260924145338";

const measure = (box) => Math.max(260, Math.round(box.getBoundingClientRect().width || box.clientWidth || 340));

/** Nice tick step for a span, aiming for ~3-4 gridlines. */
function niceStep(span, target = 3) {
  const raw = span / target, mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * mag >= raw) return m * mag;
  return 10 * mag;
}
export function niceDomain(values, { pad = 0.08, min = null, max = null, target = 3 } = {}) {
  const v = values.filter((x) => x != null && Number.isFinite(x));
  let lo = min ?? Math.min(...v), hi = max ?? Math.max(...v);
  if (!v.length) { lo = 0; hi = 1; }
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const span = hi - lo;
  if (min == null) lo -= span * pad;
  if (max == null) hi += span * pad;
  const step = niceStep(hi - lo, target);
  return { lo: min ?? Math.floor(lo / step) * step, hi: max ?? Math.ceil(hi / step) * step, step };
}

function tableToggle(wrap, columns, rows) {
  const btn = h("button.tablebtn", { type: "button" }, "Show as table");
  let tbl = null;
  btn.onclick = () => {
    if (tbl) { tbl.remove(); tbl = null; btn.textContent = "Show as table"; return; }
    tbl = h("div.tblwrap", h("table.tbl",
      h("thead", h("tr", columns.map((c, i) => h("th", { class: i ? "r" : "" }, c)))),
      h("tbody", rows.map((r) => h("tr", r.map((c, i) => h("td", { class: i ? "r" : "" }, c)))))));
    btn.after(tbl);
    btn.textContent = "Hide table";
  };
  wrap.append(btn);
}

function tooltip(box) {
  const tip = h("div.tip", { hidden: true });
  box.append(tip);
  return {
    show(x, lines, W) {
      tip.replaceChildren(...lines);
      tip.hidden = false;
      const bw = box.clientWidth, tw = tip.offsetWidth;
      tip.style.left = `${Math.max(0, Math.min(bw - tw, (x / W) * bw - tw / 2))}px`;
    },
    hide() { tip.hidden = true; },
  };
}

/**
 * Time-series line. opts:
 *  series: [{points: [[ms, v]], color, label, area?: bool, dots?: bool}]
 *  x0, x1 (ms), band: {lo, hi, label} (your usual range), shades: [{x0, x1, label}],
 *  height, fmtX(ms) → tick label, ticks: [ms], fmtV(v) → string, unit, yMin/yMax, gapMs (break line),
 *  table: {columns, rows}
 */
export function lineChart(opts) {
  const box = h("div.chart");
  const wrap = h("div", box);
  const render = () => {
    box.replaceChildren();
    const W = measure(box), H = opts.height ?? 180, L = opts.left ?? 34, R = 10, T = 14, B = 24;
    const all = opts.series.flatMap((sr) => sr.points.map((p) => p[1]));
    const dom = niceDomain([...all, opts.band?.lo, opts.band?.hi].filter((x) => x != null), { min: opts.yMin, max: opts.yMax });
    const x0 = opts.x0 ?? Math.min(...opts.series.flatMap((sr) => sr.points.map((p) => p[0])));
    const x1 = opts.x1 ?? Math.max(...opts.series.flatMap((sr) => sr.points.map((p) => p[0])));
    const x = (t) => L + ((t - x0) / Math.max(1, x1 - x0)) * (W - L - R);
    const y = (v) => T + (1 - (v - dom.lo) / (dom.hi - dom.lo)) * (H - T - B);
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": opts.aria ?? opts.series.map((sr) => sr.label).join(", ") });
    box.append(svg);
    if (!all.length) {
      svg.append(s("text.empty", { x: W / 2, y: H / 2, "text-anchor": "middle" }, opts.empty ?? "No readings in this range yet"));
      return;
    }
    for (const sh of opts.shades ?? []) {
      const a = Math.max(L, x(sh.x0)), b = Math.min(W - R, x(sh.x1));
      if (b <= a) continue;
      svg.append(s("rect.shade", { x: a, y: T - 6, width: b - a, height: H - T - B + 6, rx: 6 }));
      if (sh.label && b - a > 44) svg.append(s("text.shade-label", { x: a + 6, y: T + 6 }, sh.label));
    }
    const grid = s("g.grid"), axis = s("g.axis");
    for (let v = dom.lo; v <= dom.hi + 1e-9; v += dom.step) {
      grid.append(s("line", { x1: L, x2: W - R, y1: y(v), y2: y(v) }));
      axis.append(s("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end" }, opts.fmtTick ? opts.fmtTick(v) : +v.toFixed(2)));
    }
    for (const t of opts.ticks ?? []) {
      if (t < x0 || t > x1) continue;
      axis.append(s("text", { x: Math.min(Math.max(x(t), L + 14), W - R - 14), y: H - 5, "text-anchor": "middle" }, opts.fmtX(t)));
    }
    svg.append(grid, axis);
    if (opts.band && opts.band.hi > opts.band.lo) {
      const c = opts.bandColor ?? opts.series[0].color;
      svg.append(s("rect.band", { x: L, width: W - L - R, y: y(opts.band.hi), height: y(opts.band.lo) - y(opts.band.hi), fill: c, rx: 4 }));
      if (opts.band.label) svg.append(s("text.shade-label", { x: W - R - 4, y: y(opts.band.hi) - 5, "text-anchor": "end" }, opts.band.label));
    }
    for (const sr of opts.series) {
      const segs = [];
      for (const p of sr.points) {
        const last = segs[segs.length - 1];
        if (!last || (opts.gapMs && p[0] - last[last.length - 1][0] > opts.gapMs)) segs.push([p]); else last.push(p);
      }
      for (const seg of segs) {
        const d = seg.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
        if (seg.length > 1) {
          if (sr.area) svg.append(s("path.area", { d: `${d}L${x(seg[seg.length - 1][0]).toFixed(1)},${y(dom.lo)}L${x(seg[0][0]).toFixed(1)},${y(dom.lo)}Z`, fill: sr.color }));
          svg.append(s("path.line", { d, stroke: sr.color }));
        }
        if (sr.dots || seg.length === 1) for (const p of seg) svg.append(s("circle.focus", { cx: x(p[0]), cy: y(p[1]), r: 4, fill: sr.color }));
      }
      if (sr.endLabel && sr.points.length) {
        const p = sr.points[sr.points.length - 1];
        svg.append(s("text.dlabel", { x: Math.min(x(p[0]), W - R - 2), y: y(p[1]) - 10, "text-anchor": "end" }, sr.endLabel(p[1])));
      }
    }
    // Crosshair snaps to the nearest point of the first series.
    const main = opts.series[0].points;
    if (!main.length) return;
    const cross = s("line.cross", { y1: T - 4, y2: H - B, visibility: "hidden" });
    const dot = s("circle.focus", { r: 5, fill: opts.series[0].color, visibility: "hidden" });
    svg.append(cross, dot);
    const tip = tooltip(box);
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const t = x0 + ((px - L) / (W - L - R)) * (x1 - x0);
      let best = main[0];
      for (const p of main) if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
      const cx = x(best[0]);
      cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("visibility", "visible");
      dot.setAttribute("cx", cx); dot.setAttribute("cy", y(best[1])); dot.setAttribute("visibility", "visible");
      const lines = [h("b", opts.fmtV ? opts.fmtV(best[1], best) : String(Math.round(best[1])))];
      for (const sr of opts.series.slice(1)) {
        const q = sr.points.reduce((a, p) => (Math.abs(p[0] - best[0]) < Math.abs(a[0] - best[0]) ? p : a), sr.points[0]);
        if (q && Math.abs(q[0] - best[0]) < (opts.matchMs ?? 36e5)) lines.push(h("span", h("i.key", { style: { background: sr.color } }), `${sr.label} ${opts.fmtV ? opts.fmtV(q[1], q) : Math.round(q[1])}`), h("br"));
      }
      lines.push(h("span", opts.fmtWhen ? opts.fmtWhen(best[0], best) : ""));
      tip.show(cx, lines, W);
    };
    const leave = () => { tip.hide(); cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); };
    svg.addEventListener("pointerdown", move);
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerleave", leave);
    svg.addEventListener("pointercancel", leave);
  };
  requestAnimationFrame(render);
  onResize(box, render);
  if (opts.legend) wrap.append(legend(opts.series.map((sr) => ({ label: sr.label, color: sr.color, line: true }))));
  if (opts.table && opts.table.rows.length) tableToggle(wrap, opts.table.columns, opts.table.rows);
  return wrap;
}

/**
 * Columns (one per day/hour). bars: [{label, v, color?, sub?}], goal: number (hairline + label),
 * band: {lo, hi} (e.g. recommended sleep), highlight: index (full color; others dimmed if dimOthers).
 */
export function barChart(opts) {
  const box = h("div.chart");
  const wrap = h("div", box);
  const render = () => {
    box.replaceChildren();
    const W = measure(box), H = opts.height ?? 170, L = opts.left ?? 34, R = 8, T = 18, B = 24;
    const vals = opts.bars.map((b) => b.v).filter((v) => v != null);
    const dom = niceDomain([...vals, opts.goal, opts.band?.hi].filter((v) => v != null), { min: 0, pad: 0.1 });
    if (opts.yMax) dom.hi = opts.yMax;
    dom.hi = Math.max(dom.hi, ...vals, opts.goal ?? 0);
    const step = niceStep(dom.hi, 3);
    dom.hi = Math.ceil(dom.hi / step) * step;
    const y = (v) => T + (1 - v / dom.hi) * (H - T - B);
    const slot = (W - L - R) / opts.bars.length;
    const bw = Math.min(24, slot * 0.62);
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": opts.aria ?? "Bar chart" });
    box.append(svg);
    const grid = s("g.grid"), axis = s("g.axis");
    for (let v = 0; v <= dom.hi + 1e-9; v += step) {
      grid.append(s("line", { x1: L, x2: W - R, y1: y(v), y2: y(v) }));
      axis.append(s("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end" }, opts.fmtTick ? opts.fmtTick(v) : v));
    }
    svg.append(grid);
    if (opts.band) svg.append(s("rect.band", { x: L, width: W - L - R, y: y(opts.band.hi), height: y(opts.band.lo) - y(opts.band.hi), fill: opts.color, rx: 4 }));
    const every = Math.ceil(opts.bars.length / (opts.maxLabels ?? 7));
    opts.bars.forEach((b, i) => {
      if (i % every === 0 || i === opts.bars.length - 1) axis.append(s("text", { x: L + slot * (i + 0.5), y: H - 5, "text-anchor": "middle" }, b.label));
    });
    svg.append(axis);
    const tip = tooltip(box);
    opts.bars.forEach((b, i) => {
      const cx = L + slot * (i + 0.5);
      if (b.v == null || b.v <= 0) return;
      const top = y(b.v), base = y(0), r = Math.min(4, bw / 2, base - top);
      const x0 = cx - bw / 2, x1 = cx + bw / 2;
      // Rounded data-end, square at the baseline.
      const d = `M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x1 - r}Q${x1},${top} ${x1},${top + r}V${base}Z`;
      const dim = opts.highlight != null && i !== opts.highlight;
      const bar = s("path.bar", { d, fill: b.color ?? opts.color, class: dim ? "dim" : "" });
      const hit = s("rect", { x: cx - slot / 2, y: T, width: slot, height: H - T - B, fill: "transparent" });
      const show = () => tip.show(cx, [h("b", opts.fmtV ? opts.fmtV(b.v, b) : String(b.v)), h("span", b.sub ?? b.label)], W);
      hit.addEventListener("pointerenter", show); hit.addEventListener("pointerdown", show);
      hit.addEventListener("pointerleave", () => tip.hide());
      svg.append(bar, hit);
      if (opts.labelIndex === i || (opts.labelIndex == null && i === opts.bars.length - 1 && opts.labelLast)) {
        svg.append(s("text.dlabel", { x: cx, y: top - 6, "text-anchor": "middle" }, opts.fmtV ? opts.fmtV(b.v, b) : b.v));
      }
    });
    if (opts.goal) {
      svg.append(s("line.goal", { x1: L, x2: W - R, y1: y(opts.goal), y2: y(opts.goal) }));
      if (opts.goalLabel !== "") svg.append(s("text.goal-label", { x: W - R, y: y(opts.goal) - 5, "text-anchor": "end" }, opts.goalLabel ?? "Goal"));
    }
  };
  requestAnimationFrame(render);
  onResize(box, render);
  if (opts.legend) wrap.append(legend(opts.legend));
  if (opts.table && opts.table.rows.length) tableToggle(wrap, opts.table.columns, opts.table.rows);
  return wrap;
}

/**
 * Floating bars per night: sleep onset → wake, on a clock axis (18:00 → 14:00 next day).
 * nights: [{label, onset_min, wake_min, sub}] with minutes relative to the previous midnight.
 */
export function sleepWindows(opts) {
  const box = h("div.chart");
  const wrap = h("div", box);
  const render = () => {
    box.replaceChildren();
    const W = measure(box), H = opts.height ?? 190, L = 44, R = 8, T = 10, B = 24;
    const lo = opts.from ?? 20 * 60, hi = opts.to ?? 34 * 60; // 20:00 → 10:00
    const y = (m) => T + ((m - lo) / (hi - lo)) * (H - T - B);
    const slot = (W - L - R) / opts.nights.length, bw = Math.min(18, slot * 0.55);
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": "Sleep times per night" });
    box.append(svg);
    const grid = s("g.grid"), axis = s("g.axis");
    for (let m = Math.ceil(lo / 120) * 120; m <= hi; m += 120) {
      grid.append(s("line", { x1: L, x2: W - R, y1: y(m), y2: y(m) }));
      axis.append(s("text", { x: L - 6, y: y(m) + 4, "text-anchor": "end" }, opts.fmtClock(m)));
    }
    const every = Math.ceil(opts.nights.length / 7);
    opts.nights.forEach((n, i) => { if (i % every === 0 || i === opts.nights.length - 1) axis.append(s("text", { x: L + slot * (i + 0.5), y: H - 5, "text-anchor": "middle" }, n.label)); });
    svg.append(grid, axis);
    if (opts.usual) svg.append(s("rect.band", { x: L, width: W - L - R, y: y(opts.usual.onset), height: Math.max(2, 4), fill: opts.color, rx: 2 }),
      s("rect.band", { x: L, width: W - L - R, y: y(opts.usual.wake) - 2, height: 4, fill: opts.color, rx: 2 }));
    const tip = tooltip(box);
    opts.nights.forEach((n, i) => {
      if (n.onset_min == null) return;
      const cx = L + slot * (i + 0.5);
      const a = y(Math.max(lo, n.onset_min)), b = y(Math.min(hi, n.wake_min));
      svg.append(s("rect", { x: cx - bw / 2, y: a, width: bw, height: Math.max(4, b - a), rx: Math.min(bw / 2, 6), fill: opts.color, opacity: opts.highlight == null || opts.highlight === i ? 1 : 0.45 }));
      const hit = s("rect", { x: cx - slot / 2, y: T, width: slot, height: H - T - B, fill: "transparent" });
      const show = () => tip.show(cx, [h("b", `${opts.fmtClock(n.onset_min)} – ${opts.fmtClock(n.wake_min)}`), h("span", n.sub ?? n.label)], W);
      hit.addEventListener("pointerenter", show); hit.addEventListener("pointerdown", show); hit.addEventListener("pointerleave", () => tip.hide());
      svg.append(hit);
    });
  };
  requestAnimationFrame(render);
  onResize(box, render);
  if (opts.table && opts.table.rows.length) tableToggle(wrap, opts.table.columns, opts.table.rows);
  return wrap;
}

/**
 * Hypnogram as four lanes (Awake, REM, Light, Deep) with rounded blocks per stage run.
 * stages: [[t, code]] per minute; colors: {awake, rem, light, deep}; toMs(t).
 */
export function hypnogram({ stages, colors, toMs, fmtX, ticks, height = 150, hr = null }) {
  const box = h("div.chart");
  const wrap = h("div", box);
  const lane = { 4: 0, 3: 1, 2: 2, 1: 3 };
  const names = ["Awake", "REM", "Light", "Deep"];
  const col = [colors.awake, colors.rem, colors.light, colors.deep];
  const render = () => {
    box.replaceChildren();
    const W = measure(box), H = height, L = 50, R = 6, T = 4, B = 22;
    if (!stages?.length) return;
    const t0 = toMs(stages[0][0]), t1 = toMs(stages[stages.length - 1][0]) + 60e3;
    const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
    const lh = (H - T - B) / 4;
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": "Sleep stages through the night" });
    box.append(svg);
    const axis = s("g.axis");
    names.forEach((n, i) => {
      svg.append(s("rect", { x: L, y: T + i * lh + 1, width: W - L - R, height: lh - 2, rx: 6, fill: "var(--track)", opacity: 0.5 }));
      axis.append(s("text", { x: L - 8, y: T + i * lh + lh / 2 + 4, "text-anchor": "end" }, n));
    });
    for (const t of ticks) if (t > t0 && t < t1) axis.append(s("text", { x: x(t), y: H - 5, "text-anchor": "middle" }, fmtX(t)));
    svg.append(axis);
    // Runs of the same lane.
    let start = 0;
    for (let i = 1; i <= stages.length; i++) {
      const cur = lane[stages[start][1]] ?? 0;
      const next = i < stages.length ? (lane[stages[i][1]] ?? 0) : -1;
      if (next !== cur) {
        const a = x(toMs(stages[start][0])), b = x(toMs(stages[i - 1][0]) + 60e3);
        svg.append(s("rect", { x: a, y: T + cur * lh + 3, width: Math.max(1.5, b - a - 1), height: lh - 6, rx: Math.min(4, (b - a) / 2), fill: col[cur] }));
        start = i;
      }
    }
    if (hr?.length) {
      // Sleeping heart rate as a thin line over the lanes' area (no second axis: normalized, labeled in the tooltip only).
    }
  };
  requestAnimationFrame(render);
  onResize(box, render);
  wrap.append(legend(names.map((n, i) => ({ label: n, color: col[i] }))));
  return wrap;
}

export function legend(items) {
  return h("div.legend", items.map((it) => h("span", h("i", { class: it.line ? "ln" : "", style: { background: it.color } }), it.label)));
}

const observers = new WeakMap();
function onResize(el, fn) {
  if (typeof ResizeObserver === "undefined") return;
  let w = 0, timer = null;
  const ro = new ResizeObserver((entries) => {
    const nw = Math.round(entries[0].contentRect.width);
    if (!w) { w = nw; return; }
    if (Math.abs(nw - w) < 2) return;
    w = nw;
    clearTimeout(timer);
    timer = setTimeout(fn, 120);
  });
  ro.observe(el);
  observers.set(el, ro);
}
