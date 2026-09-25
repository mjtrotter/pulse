// Labs: on-phone PDF import (with a review step) or manual entry, the panel over time, what it implies (each
// paper's own formula), heart risk (AHA PREVENT from labs + home BP), and the lab context other screens use.
import { derived } from "../analytics/labs.js?v=20260925073227";
import { CANONICAL } from "../labs/pdfimport.js?v=20260925073227";
import { phenoAge, PHENOAGE_INPUTS } from "../analytics/bioage.js?v=20260925073227";
import { prevent } from "../analytics/prevent.js?v=20260925073227";
import { bpSummary } from "./bp.js?v=20260925073227";
import { mean } from "./stats.js?v=20260925073227";
import { css, D, esc, MON, pct, poly, S, sc, sign, smooth, st } from "./kit.js?v=20260925073227";

/** Analytes Pulse tracks: the parser's canonical catalog (US conventional units, grouped). ref = a typical
 *  adult range used only when the report's own range isn't available; the lab's range and flag always win. */
const REF = { ldl: [0, 99], hdl: [40, 200], tg: [0, 149], tc: [0, 199], apob: [0, 89], lpa: [0, 74], glucose: [65, 99], insulin: [0, 18.4], a1c: [0, 5.6], uric: [2.5, 8],
  hscrp: [0, 1.0], egfr: [60, 200], creatinine: [0.6, 1.3], bun: [7, 25], alt: [9, 46], ast: [10, 40], tsh: [0.4, 4.5], testosterone: [250, 1100], vitd: [30, 100], ferritin: [30, 400],
  sodium: [135, 146], potassium: [3.5, 5.3], wbc: [3.8, 10.8], hemoglobin: [13.2, 17.1], platelets: [140, 400], homocysteine: [0, 11], omega3: [8, 100], albumin: [3.6, 5.1],
  alp: [36, 130], rdw: [11, 15], mcv: [80, 100], ldl_p: [0, 1138], ldl_small: [0, 142], ggt: [3, 70], b12: [200, 1100], magnesium: [1.5, 2.5] };
const MANUAL = ["ldl", "hdl", "tg", "tc", "apob", "lpa", "glucose", "insulin", "a1c", "hscrp", "egfr", "creatinine", "alt", "ast", "tsh", "vitd", "ferritin", "albumin", "alp", "wbc", "lymph_pct", "mcv", "rdw"];
export const ANALYTES = CANONICAL.map((c) => { const k = c.key === "uricacid" ? "uric" : c.key; return { k, n: c.name, u: c.unit, grp: c.group, ref: REF[k] ?? null }; });
export const MANUAL_ANALYTES = ANALYTES.filter((a) => MANUAL.includes(a.k));
const ALIAS = { uric_acid: "uric", uricacid: "uric", vitamin_d: "vitd", vitd25: "vitd", crp: "hscrp", hs_crp: "hscrp", hgb: "hemoglobin", plt: "platelets", lpa_nmol: "lpa" };
export const normKey = (k) => ALIAS[k] ?? k;
export const bmiOf = (p) => (p.height && p.weight ? p.weight / (p.height / 100) ** 2 : null);
export const labLabel = (date) => { const d = new Date(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)); return `${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; };
const shortLabel = (date) => { const d = new Date(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)); return `${MON[d.getMonth()]} ${d.getDate()}`; };
/** The newest value of each analyte across panels, with the panel date and the report's own flag/range. */
export function latestLabs() {
  const out = {};
  for (const d of D.labs ?? []) for (const [k, v] of Object.entries(d.v ?? {})) if (v != null) out[k] = { value: v, date: d.date, meta: d.meta?.[k] ?? null };
  return out;
}
const flagOf = (a, v, meta) => {
  if (meta?.flag) return /h/i.test(meta.flag) ? ["H", "hi"] : /l/i.test(meta.flag) ? ["L", "lo"] : ["", ""];
  if (!a.ref) return ["", ""];
  return v > a.ref[1] ? ["H", "hi"] : v < a.ref[0] ? ["L", "lo"] : ["", ""];
};

// ---------- heart risk ----------
function preventInput(p, over = {}) {
  const L = latestLabs(), bp = bpSummary(D.bp), bmi = bmiOf(p);
  return { age: p.age, sex: p.sex, totalChol: over.tc ?? L.tc?.value, hdl: L.hdl?.value, sbp: over.sbp ?? (bp ? Math.round(bp.sys) : null), bmi: bmi ? +bmi.toFixed(1) : null, egfr: L.egfr?.value,
    diabetes: !!p.diabetes, smoker: !!p.smoker, bpTreatment: !!p.bpMeds, statin: !!p.statin, hba1c: L.a1c?.value ?? null };
}
const pick = (r) => r?.a1c ?? r?.base ?? null;
const riskCat = (v) => (v < 0.05 ? ["Low", "good"] : v < 0.075 ? ["Borderline", "watch"] : v < 0.2 ? ["Intermediate", "bad"] : ["High", "bad"]);
export function preventResult(p) {
  if (!(p.age >= 30 && p.age <= 79)) return { reason: `The AHA PREVENT equations cover ages 30–79${p.age ? `, so at ${p.age} Pulse can't give a number` : ""}.` };
  const inp = preventInput(p), missing = [];
  if (!p.sex) missing.push("sex (Profile)");
  if (inp.totalChol == null || inp.hdl == null) missing.push("total and HDL cholesterol");
  if (inp.egfr == null) missing.push("eGFR");
  if (inp.sbp == null) missing.push("a week of home blood pressure");
  if (!inp.bmi) missing.push("height and weight (Profile)");
  if (missing.length) return { reason: `Heart risk (AHA PREVENT) needs ${missing.join(", ")}.` };
  try { const r = prevent(inp), R = pick(r); return R ? { inp, R } : { reason: r?.warnings?.[0] ?? "PREVENT couldn't use these inputs." }; } catch (e) { return { reason: e.message }; }
}
export function preventCard(p) {
  const res = preventResult(p);
  if (!res.R) return `<p class="note" style="margin:0">${esc(res.reason)}</p>`;
  const { inp, R } = res;
  const wi = pick(prevent(preventInput(p, { sbp: st.whatIf.sbp ?? inp.sbp, tc: st.whatIf.tc ?? inp.totalChol })));
  const opt = pick(prevent({ ...inp, totalChol: 170, hdl: 50, sbp: 110, bmi: 25, egfr: 90, smoker: false, diabetes: false, bpTreatment: false, statin: false, hba1c: inp.hba1c != null ? 5.3 : null }));
  const k = st.horizon === "10" ? ["cvd10", "ascvd10", "hf10"] : ["cvd30", "ascvd30", "hf30"], v = R[k[0]], cat = riskCat(v);
  const W0 = 300, max = st.horizon === "10" ? 0.3 : 0.6, x = sc(0, max, 4, W0 - 4);
  const zones = st.horizon === "10" ? [[0, 0.05, "--good"], [0.05, 0.075, "--watch"], [0.075, 0.2, "--temp"], [0.2, 0.3, "--bad"]] : [];
  const changed = (st.whatIf.sbp != null && st.whatIf.sbp !== inp.sbp) || (st.whatIf.tc != null && st.whatIf.tc !== inp.totalChol);
  const L = latestLabs();
  return `<div class="risk-h"><div><div class="lbl">${st.horizon}-year risk · heart attack, stroke or heart failure</div><div class="num big2">${pct(v)}</div></div>${st.horizon === "10" ? `<span class="badge ${cat[1]}">${cat[0]}</span>` : ""}</div>
    ${S(W0, 30, `${zones.length ? zones.map(([a0, a1, c]) => `<rect x="${x(a0)}" y="10" width="${x(a1) - x(a0)}" height="8" fill="${css(c)}" opacity=".5"/>`).join("") : `<rect x="4" y="10" width="${W0 - 8}" height="8" rx="4" fill="${css("--track")}"/>`}
      ${opt ? `<line x1="${x(Math.min(max, opt[k[0]]))}" x2="${x(Math.min(max, opt[k[0]]))}" y1="6" y2="22" stroke="${css("--ink2")}" stroke-width="1.5"/>` : ""}
      <circle cx="${x(Math.min(max, v))}" cy="14" r="7" fill="${css("--ink")}" stroke="${css("--bg")}" stroke-width="2.5"/>${changed && wi ? `<circle cx="${x(Math.min(max, wi[k[0]]))}" cy="14" r="5" fill="none" stroke="${css("--act")}" stroke-width="2"/>` : ""}
      <text x="4" y="30" class="axis">0%</text><text x="${W0 - 4}" y="30" text-anchor="end" class="axis">${max * 100}%</text>`)}
    <div class="seg small">${[["10", "10 years"], ["30", "30 years"]].map(([h, l]) => `<button data-horizon="${h}" class="${st.horizon === h ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="stat3"><div><b>${pct(R[k[1]])}</b><span>heart attack or stroke</span></div><div><b>${pct(R[k[2]])}</b><span>heart failure</span></div><div><b>${opt ? pct(opt[k[0]]) : "—"}</b><span>same age, optimal numbers</span></div></div>
    <div class="sub-h">What would move it</div>
    <div class="slider"><label><span>Home systolic</span><span><b>${st.whatIf.sbp ?? inp.sbp}</b> mmHg</span></label><input type="range" min="95" max="175" step="1" value="${st.whatIf.sbp ?? inp.sbp}" data-whatif="sbp"></div>
    <div class="slider"><label><span>Total cholesterol</span><span><b>${st.whatIf.tc ?? inp.totalChol}</b> mg/dL</span></label><input type="range" min="130" max="320" step="1" value="${st.whatIf.tc ?? inp.totalChol}" data-whatif="tc"></div>
    <p class="whatif">${changed && wi ? `With these numbers: <b>${pct(wi[k[0]])}</b> (${sign((wi[k[0]] - v) * 100)} points).` : "Drag a slider to see how the equation responds."}</p>
    <div class="sub-h">Inputs</div>
    <div class="kv">${[["Age, sex", `${inp.age}, ${inp.sex}`, "Profile"], ["Total / HDL cholesterol", `${inp.totalChol} / ${inp.hdl} mg/dL`, `Labs · ${shortLabel(L.tc.date)}`], ["Systolic BP", `${inp.sbp} mmHg`, "Home cuff · 7-day avg"], ["BMI", inp.bmi.toFixed(1), "Profile"], ["eGFR", `${inp.egfr}`, `Labs · ${shortLabel(L.egfr.date)}`], ["HbA1c", inp.hba1c != null ? `${inp.hba1c}%` : "not on file", inp.hba1c != null ? `Labs · ${shortLabel(L.a1c.date)}` : "adds precision"]].map(([a, b, c]) => `<div><span>${a}</span><b>${esc(b)}</b><em>${c}</em></div>`).join("")}</div>
    <p class="note">AHA PREVENT equations (Khan 2024), sex-specific${inp.hba1c != null ? " with the HbA1c add-on" : ""}, for ages 30–79 without known heart disease. It isn't a diagnosis.</p>`;
}

// ---------- the panel ----------
function labsCard() {
  const Ls = D.labs ?? [];
  const add = `<div class="acts2"><button class="cta" data-labpdf>Import a lab PDF</button><button class="cta ghost" data-sheet="labs">Type values in</button></div>`;
  if (!Ls.length) return `<p class="note" style="margin:0 0 14px">Import the PDF from Quest, Labcorp or Function Health. It's read on this phone and you check every value before it's saved; nothing leaves the phone.</p>${add}`;
  const groups = [...new Set(ANALYTES.map((a) => a.grp))];
  const spark = (a) => { const v = Ls.map((d) => d.v[a.k]).filter((z) => z != null); if (v.length < 2) return S(60, 22, ""); const x = sc(0, v.length - 1, 4, 56), y = sc(Math.min(...v), Math.max(...v) + 1e-9, 18, 4); return S(60, 22, `<path d="${poly(v.map((z, i) => [x(i), y(z)]))}" fill="none" stroke="${css("--ink3")}" stroke-width="1.4"/>${v.map((z, i) => `<circle cx="${x(i)}" cy="${y(z)}" r="${i === v.length - 1 ? 3 : 2}" fill="${i === v.length - 1 ? css("--ink") : css("--ink3")}"/>`).join("")}`); };
  // Each test shows its newest draw (older panels fill in tests a newer one didn't repeat, dated). Out-of-range
  // results stay visible; in-range ones fold into one "N in range" row per group.
  const newest = Ls[Ls.length - 1].date;
  const one = (a) => {
    const withV = Ls.filter((d) => d.v[a.k] != null), last = withV[withV.length - 1], v = last.v[a.k], meta = last.meta?.[a.k], p = withV.length > 1 ? withV[withV.length - 2].v[a.k] : null, [f, cls] = flagOf(a, v, meta), id = `lab-${a.k}`;
    const ref = meta?.ref ?? (!a.ref ? "" : a.ref[1] >= 200 ? `≥${a.ref[0]}` : a.ref[0] ? `${a.ref[0]}–${a.ref[1]}` : `<${a.ref[1]}`);
    const html = `<div class="an" data-expand="${id}"><div class="an-n">${a.n}${ref || last.date !== newest ? `<small>${ref ? `ref ${esc(ref)}` : ""}${last.date !== newest ? `${ref ? " · " : ""}<span class="older">${shortLabel(last.date)}</span>` : ""}</small>` : ""}</div>${spark(a)}<div class="an-v"><b class="${cls}">${v}${f ? `<sup>${f}</sup>` : ""}</b><small>${esc(a.u || meta?.unit || "")}${p != null ? ` · ${v < p ? "↓" : v > p ? "↑" : "="} ${Math.abs(v - p).toFixed(a.k === "a1c" || a.k === "hscrp" || a.k === "insulin" || a.k === "creatinine" || a.k === "tsh" ? 1 : 0)}` : ""}</small></div></div>
        ${st.open.has(id) ? `<div class="an-x">${withV.map((d) => `<span>${shortLabel(d.date)}<b>${d.v[a.k]}</b></span>`).join("")}</div>` : ""}`;
    return { flagged: !!cls, html };
  };
  let total = 0, flagged = 0;
  const body = groups.map((g) => {
    const rows = ANALYTES.filter((a) => a.grp === g && Ls.some((d) => d.v[a.k] != null)).map(one);
    if (!rows.length) return "";
    const bad = rows.filter((r) => r.flagged), ok = rows.filter((r) => !r.flagged), id = `lg-${g}`, open = st.open.has(id);
    total += rows.length; flagged += bad.length;
    // A group with nothing out of range is a single tappable header; otherwise flagged rows, then the fold.
    if (!bad.length) return `<div class="sub-h tap" data-expand="${id}">${g}<span>${rows.length} in range <i class="chev">${open ? "⌃" : "›"}</i></span></div>${open ? ok.map((r) => r.html).join("") : ""}`;
    return `<div class="sub-h">${g}<span class="hi">${bad.length} of ${rows.length} out of range</span></div>${bad.map((r) => r.html).join("")}
      ${ok.length ? (open ? ok.map((r) => r.html).join("") : "") + `<div class="an-more" data-expand="${id}">${open ? "Hide in-range results" : `${ok.length} more in range`}<span class="chev">${open ? "⌃" : "›"}</span></div>` : ""}`;
  }).join("");
  const dates = [...new Set(Ls.map((d) => d.date))];
  return add + `<p class="note lab-sum"><b>${total}</b> results · <b class="${flagged ? "hi" : ""}">${flagged}</b> out of range · newest draw ${shortLabel(newest)}${dates.length > 1 ? `; tests it didn't repeat come from earlier draws (dated)` : ""}.</p>` + body + otherResults(Ls) + `<p class="note">${Ls.map((d) => `${labLabel(d.date)}${d.source === "pdf" ? " (PDF)" : ""} · <button class="link" data-dellab="${esc(d.date)}">remove</button>`).join("<br>")}</p>`;
}
/** Results outside the catalog (kept, nothing lost) and qualitative ones: the newest draw of each, dated. */
function otherResults(Ls) {
  const ex = {}, ql = {};
  for (const d of Ls) { for (const [k, x] of Object.entries(d.extras ?? {})) ex[k] = { ...x, date: d.date }; for (const [k, x] of Object.entries(d.qual ?? {})) ql[k] = { ...x, date: d.date }; }
  const dated = (o) => new Set(Object.values(o).map((x) => x.date)).size > 1, when = (o, x) => (dated(o) ? ` · ${shortLabel(x.date)}` : "");
  const head = (t, o) => `<div class="sub-h">${t}${dated(o) ? "" : ` · ${shortLabel(Object.values(o)[0].date)}`}</div>`;
  let out = "";
  if (Object.keys(ex).length) out += head("Other results", ex) + Object.values(ex).map((x) => `<div class="an"><div class="an-n">${esc(x.name)}${x.ref || dated(ex) ? `<small>${x.ref ? `ref ${esc(x.ref)}` : ""}${esc(when(ex, x))}</small>` : ""}</div><span></span><div class="an-v"><b class="${/h/i.test(x.flag ?? "") ? "hi" : /l/i.test(x.flag ?? "") ? "lo" : ""}">${esc(x.value)}${x.flag ? `<sup>${esc(x.flag)}</sup>` : ""}</b><small>${esc(x.unit ?? "")}</small></div></div>`).join("");
  if (Object.keys(ql).length) { const open = st.open.has("lg-qual");
    out += `<div class="sub-h tap" data-expand="lg-qual">Qualitative<span>${Object.keys(ql).length} results <i class="chev">${open ? "⌃" : "›"}</i></span></div>` + (open ? `<div class="qual">${Object.values(ql).map((x) => `<span><em>${esc(x.name)}</em> ${esc(x.text)}${esc(when(ql, x))}</span>`).join("")}</div>` : ""); }
  return out;
}
/** Biological age from the newest panel with every input: PhenoAge (Levine 2018), plus any other verified model. */
export function bioAge(p) {
  const L = latestLabs(), vals = Object.fromEntries(Object.entries(L).map(([k, x]) => [k, x.value]));
  const age = p?.age; if (!age) return null;
  const pa = phenoAge(vals, age);
  return pa?.phenoAge != null ? pa : { missing: pa?.missing ?? PHENOAGE_INPUTS.map((z) => z.key ?? z) };
}
function bioAgeCard(p) {
  const b = bioAge(p);
  if (!b) return "";
  if (b.phenoAge == null) return `<p class="note" style="margin:0">Biological age (PhenoAge) needs albumin, creatinine, glucose, hs-CRP, lymphocyte %, MCV, RDW, alkaline phosphatase and white cell count from one panel${b.missing?.length ? `; missing: ${esc(b.missing.join(", "))}` : ""}.</p>`;
  const d = b.delta;
  // Each past panel is scored at the age you were when it was drawn, so the trend isn't inflated by ageing alone.
  const ageAt = (date) => p.age - (Date.now() - new Date(`${date}T12:00:00`)) / (365.25 * 864e5);
  const hist = (D.labs ?? []).map((panel) => { const r = phenoAge(panel.v ?? {}, ageAt(panel.date)); return r?.phenoAge != null ? [panel.date, r.phenoAge, r.delta] : null; }).filter(Boolean);
  return `<div class="risk-h"><div><div class="lbl">Biological age · PhenoAge</div><div class="num big2">${b.phenoAge.toFixed(1)}<small>years</small></div></div><span class="badge ${d <= -1 ? "good" : d >= 1 ? "bad" : "watch"}">${d <= 0 ? `${Math.abs(d).toFixed(1)} younger` : `${d.toFixed(1)} older`}</span></div>
    <p class="note">From 9 routine blood markers and your age (Levine 2018, trained on NHANES mortality). It estimates the age at which your blood chemistry would be average; each year of "acceleration" was associated with roughly 9% higher mortality risk in the original cohort. ${hist.length > 1 ? `Across your complete panels (vs your age then): ${hist.map(([dt2, , dd]) => `${shortLabel(dt2)} ${dd <= 0 ? "−" : "+"}${Math.abs(dd).toFixed(1)}`).join(" → ")}.` : ""}</p>
    <div class="kv">${PHENOAGE_INPUTS.map((z) => { const k = z.key ?? z, x = latestLabs()[k === "uricacid" ? "uric" : k]; return x ? `<div><span>${esc(z.name ?? k)}</span><b>${x.value}</b><em>${shortLabel(x.date)}</em></div>` : ""; }).join("")}</div>
    <p class="note">Other blood-age formulas (Klemera–Doubal, commercial scores) weight markers differently, so their numbers won't match exactly; the trend across your annual panels is what matters. The headline uses your current age with your newest result for each marker (draw dates shown).</p>`;
}
function indicesCard(p) {
  const b = bmiOf(p), ctxD = { bmi: b, sex: p.sex, age: p.age, diabetes: !!p.diabetes }, all = (D.labs ?? []).map((d) => derived(d.v, ctxD));
  // Current values use the newest result for each test, falling back to older panels where a test wasn't repeated.
  const L = latestLabs(), cur = derived(Object.fromEntries(Object.entries(L).map(([k, x]) => [k, x.value])), ctxD);
  if (!cur.length) return `<p class="note" style="margin:0">Add glucose, insulin, triglycerides and cholesterol to see insulin-resistance and lipid indices, each with its paper's formula.</p>`;
  return cur.map((d) => {
    const Ls = D.labs ?? [], pts = all.map((set, i) => [Ls[i].date, set.find((z) => z.key === d.key)?.value]).filter(([, v]) => v != null), id = `ix-${d.key}`;
    const dec = Math.max(0, ...pts.map(([, v]) => (String(v).split(".")[1] ?? "").length)), fx = (v) => (v == null ? "—" : v.toFixed(dec));
    const trail = pts.length > 1 ? pts.map(([, v]) => fx(v)).join(" → ") : pts.length === 1 && pts[0][0] !== Ls[Ls.length - 1].date ? `<span class="older">${shortLabel(pts[0][0])}</span>` : "";
    return `<div class="ix" data-expand="${id}"><div class="ix-n">${d.name}<small class="${d.band[1] === "good" ? "ok" : d.band[1] === "watch" ? "lo" : d.band[1] === "bad" ? "hi" : ""}">${d.band[0]}</small></div><div class="ix-t">${trail}</div><div class="ix-v"><b>${fx(d.value)}</b>${d.unit ? `<small>${d.unit}</small>` : ""}</div></div>
      ${st.open.has(id) ? `<div class="ix-x"><code>${d.formula}</code><p>${d.note}</p><p class="cite">${d.cite}</p></div>` : ""}`;
  }).join("") + `<p class="note">Each index uses your newest result for every test it needs${[...new Set(Object.values(L).map((x) => x.date))].length > 1 ? ` (drawn from ${[...new Set(Object.values(L).map((x) => x.date))].sort().reverse().map(shortLabel).join(" and ")})` : ""}, with each paper's own formula and cut-offs; tap a row for the math. Arrows show the index at each draw.</p>`;
}
/** Weekly resting HR and HRV over the past year, with each lab draw pinned. */
export function labsVsBand() {
  const hs = D.hist, Ls = D.labs ?? [];
  if (Ls.length < 1 || hs.length < 21) return "";
  const W0 = 340, H = 150, wk = [];
  for (let i = Math.max(0, hs.length - 364); i + 7 <= hs.length; i += 7) { const w = hs.slice(i, i + 7); wk.push({ d: w[3].date, rhr: mean(w.map((h) => h.rhr)), hrv: mean(w.map((h) => h.hrv)) }); }
  const r = wk.filter((w) => w.rhr != null), v = wk.filter((w) => w.hrv != null);
  if (r.length < 3) return "";
  const x = sc(0, wk.length - 1, 34, W0 - 8), yr = sc(Math.min(...r.map((w) => w.rhr)) - 0.5, Math.max(...r.map((w) => w.rhr)) + 0.5, 70, 18), yh = v.length ? sc(Math.min(...v.map((w) => w.hrv)) - 1, Math.max(...v.map((w) => w.hrv)) + 1, H - 20, 82) : null;
  const pins = Ls.filter((d) => d.date >= wk[0].d).map((d) => { const i = wk.findIndex((w) => w.d >= d.date); return i < 0 ? "" : `<line x1="${x(i)}" x2="${x(i)}" y1="14" y2="${H - 16}" stroke="${css("--ink")}" stroke-opacity=".3" stroke-dasharray="2 3"/><text x="${x(i)}" y="10" text-anchor="middle" class="axis">${shortLabel(d.date)}</text>`; }).join("");
  return `<div class="sub-h">Labs alongside your band</div>` + S(W0, H, `${pins}<text x="28" y="${yr(mean(r.map((w) => w.rhr))) + 4}" text-anchor="end" class="axis">RHR</text><path d="${smooth(wk.map((w, i) => (w.rhr == null ? null : [x(i), yr(w.rhr)])).filter(Boolean))}" fill="none" stroke="${css("--heart")}" stroke-width="2"/>
      ${yh ? `<text x="28" y="${yh(mean(v.map((w) => w.hrv))) + 4}" text-anchor="end" class="axis">HRV</text><path d="${smooth(wk.map((w, i) => (w.hrv == null ? null : [x(i), yh(w.hrv)])).filter(Boolean))}" fill="none" stroke="${css("--hrv")}" stroke-width="2"/>` : ""}`)
    + `<p class="note">Weekly averages with each lab draw pinned. Pulse shows them side by side; it can't say one caused the other.</p>`;
}
export function labsBlock(ctx) {
  const p = ctx.profile;
  return `<div class="sec rise" style="--i:7" id="labs"><h2>Labs</h2><span class="lbl">${(D.labs ?? []).length} panel${(D.labs ?? []).length === 1 ? "" : "s"}</span></div>
    <div class="card rise" style="--i:7">${labsCard()}</div>
    ${(D.labs ?? []).length ? `<div class="sec rise" style="--i:8"><h2>Biological age</h2><span class="lbl">from your blood</span></div><div class="card rise" style="--i:8">${bioAgeCard(p)}</div>` : ""}
    ${(D.labs ?? []).length ? `<div class="sec rise" style="--i:8"><h2>What your labs imply</h2><span class="lbl">derived</span></div><div class="card rise" style="--i:8">${indicesCard(p)}${labsVsBand()}</div>` : ""}
    <div class="sec rise" style="--i:8"><h2>Heart risk</h2><span class="lbl">labs + home BP</span></div>
    <div class="card rise" style="--i:8" id="prevent">${preventCard(p)}</div>`;
}

/** One line of lab context for a metric's drill-down, or "" (only when a relevant lab is on file). */
export function labContext(key) {
  const L = latestLabs(), out = [];
  const when = (k) => `on ${shortLabel(L[k].date)}`;
  if (["hrv", "rhr", "recovery", "temp", "hrday"].includes(key) && L.hscrp) {
    const v = L.hscrp.value;
    out.push(v > 3 ? `Your last hs-CRP was ${v} mg/L ${when("hscrp")}, above 3: inflammation lowers HRV and raises resting heart rate, so read this alongside it.` : v < 1 ? `Your last hs-CRP was low, ${v} mg/L ${when("hscrp")}, so inflammation is unlikely to be pulling these numbers.` : `Your last hs-CRP was ${v} mg/L ${when("hscrp")}, in the average range.`);
  }
  if (["rhr", "hrday"].includes(key) && L.tsh && (L.tsh.value < 0.4 || L.tsh.value > 4.5)) out.push(`Your TSH was ${L.tsh.value} ${when("tsh")}, outside the usual range; thyroid levels change resting heart rate.`);
  if (["rhr", "hrday", "spo2"].includes(key) && L.hemoglobin && L.hemoglobin.value < 12) out.push(`Your hemoglobin was ${L.hemoglobin.value} g/dL ${when("hemoglobin")}; low hemoglobin raises heart rate and can lower oxygen readings.`);
  if (["steps", "mvpa", "light", "moveH"].includes(key) && (L.a1c || L.glucose || L.tg)) {
    const d = derived(Object.fromEntries(Object.entries(L).map(([k, x]) => [k, x.value])), { bmi: bmiOf(D.profile) });
    const ir = d.find((z) => z.key === "homa_ir") ?? d.find((z) => z.key === "tyg");
    out.push(`${ir ? `Your ${ir.name} is ${ir.value} (${ir.band[0].toLowerCase()}). ` : L.a1c ? `Your HbA1c is ${L.a1c.value}% ${when("a1c")}. ` : ""}Walking breaks during long sitting lower post-meal glucose and insulin (Dunstan 2012), and regular brisk activity improves insulin sensitivity.`);
  }
  if (key === "sleep" && L.vitd && L.vitd.value < 20) out.push(`Your vitamin D was ${L.vitd.value} ng/mL ${when("vitd")}, low; low vitamin D is associated with poorer sleep, though causation isn't established.`);
  return out.length ? `<div class="labctx"><span class="lbl">From your labs</span>${out.map((t) => `<p>${t}</p>`).join("")}<button class="link" data-close data-golabs>See labs ›</button></div>` : "";
}

/** Review sheet for a parsed PDF: every value checkable and editable before saving, grouped like the lab list. */
export function labReviewSheet(draft) {
  const vals = Object.entries(draft.values ?? {}).map(([k, v]) => [normKey(k), v]).filter(([k]) => ANALYTES.some((a) => a.k === k));
  const extras = Object.entries(draft.extras ?? {}), qual = Object.entries(draft.qualitative ?? {});
  const groups = [...new Set(ANALYTES.map((a) => a.grp))];
  const row = (id, name, v, unit, flag, page, x = false) => `<label class="full rv"><span class="rv-n"><input type="checkbox" name="use_${id}" checked> ${esc(name)}</span><span class="rv-v"><input name="v_${id}" inputmode="decimal" value="${esc(v)}"><em>${esc(unit ?? "")}${flag ? ` · ${esc(flag)}` : ""}${page ? ` · p.${page}` : ""}</em></span></label>`;
  const total = vals.length + extras.length + qual.length;
  return `<div class="sh-h"><b>Check your lab report</b><button class="back" data-sheetclose>Cancel</button></div>
    <p>${total ? `Pulse found <b>${total}</b> results${draft.lab ? ` in this ${esc(draft.lab)} report` : ""}. Check them against the PDF (page shown) and untick anything wrong.` : "Pulse couldn't find any results in this PDF. You can type values in instead."}</p>
    <form data-form="labreview" class="fform">
      <label class="full">Date collected<input name="date" type="date" value="${esc(draft.date ?? new Date().toISOString().slice(0, 10))}" required></label>
      ${groups.map((g) => { const rows = vals.filter(([k]) => ANALYTES.find((a) => a.k === k)?.grp === g); return rows.length ? `<div class="sub-h full">${g}</div>${rows.map(([k, v]) => { const a = ANALYTES.find((z) => z.k === k); return row(k, a.n, v.value, v.unit ?? a.u, v.flag, v.page); }).join("")}` : ""; }).join("")}
      ${extras.length ? `<div class="sub-h full">Other results</div>${extras.map(([k, x]) => row(`x_${k}`, x.name, x.value, x.unit, x.flag, x.page)).join("")}` : ""}
      ${qual.length ? `<div class="sub-h full">Qualitative</div><p class="note full" style="margin:0">${qual.map(([, q]) => `${esc(q.name)}: ${esc(q.text)}`).join(" · ")}</p>` : ""}
      <button class="cta full" type="submit" ${total ? "" : "disabled"}>Save ${total} results</button></form>
    <p class="note">Read on this phone only. Units are converted to US conventional where the report uses SI units.</p>`;
}
