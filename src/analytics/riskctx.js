// Heart-risk context around the PREVENT number: the 2026 ACC/AHA risk categories, the guideline's risk-enhancing
// factors as separate facts (each with the draws behind it), metabolic syndrome, Lp(a) status and the KDIGO kidney
// grid. Nothing here is folded into a score. Each fact stands on its own, and "never measured" is kept distinct
// from "not present". Labs are the stored panels: [{date, v:{…}, meta:{key:{unit, flag, ref}}}], US units.
import { derived } from "./labs.js?v=20260925173307";

const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const num = (x) => (x == null || x === "" || !Number.isFinite(+x) ? null : +x);
/** Every draw of one test, oldest first: [{date, value, unit}]. */
export function draws(labs, key) {
  return (labs ?? []).filter((p) => num(p.v?.[key]) != null).map((p) => ({ date: p.date, value: num(p.v[key]), unit: p.meta?.[key]?.unit ?? null })).sort(byDate);
}
const newest = (ds) => (ds.length ? ds[ds.length - 1] : null);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fd = (date) => `${MON[+date.slice(5, 7) - 1]} ${+date.slice(8, 10)}, ${date.slice(0, 4)}`;
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;

// ---------- PREVENT categories ----------
/** 10-year PREVENT-ASCVD cut-offs for primary prevention (2026 ACC/AHA dyslipidemia guideline). */
export const PREVENT_CUTS = [0.03, 0.05, 0.1];
export function preventCategory(ascvd10) {
  if (ascvd10 == null || !Number.isFinite(ascvd10)) return null;
  if (ascvd10 < 0.03) return { label: "Low", kind: "good" };
  if (ascvd10 < 0.05) return { label: "Borderline", kind: "watch" };
  if (ascvd10 < 0.1) return { label: "Intermediate", kind: "bad" };
  return { label: "High", kind: "bad" };
}
export const PREVENT_CAT_CITE = "2026 ACC/AHA multisociety guideline on the management of dyslipidemia (Circulation 2026; doi:10.1161/CIR.0000000000001423): 10-year PREVENT-ASCVD <3% low, 3–<5% borderline, 5–<10% intermediate, ≥10% high";

// ---------- eGFR per draw ----------
/** eGFR at one draw: CKD-EPI 2021 creatinine + cystatin C when both exist (KDIGO 2024 prefers it), else the lab's
 *  own eGFR, else CKD-EPI 2021 from creatinine. Age is taken at the draw. */
export function egfrAt(panel, { age = null, sex = null, today = null } = {}) {
  const v = panel.v ?? {}, ageThen = age != null && today ? age - days(panel.date, today) / 365.25 : age;
  const d = Object.fromEntries(derived(v, { age: ageThen, sex }).map((z) => [z.key, z]));
  if (d.egfr_crcys) return { value: d.egfr_crcys.value, source: "creatinine + cystatin C (CKD-EPI 2021)" };
  if (num(v.egfr) != null) return { value: num(v.egfr), source: "as reported by the lab" };
  if (d.egfr_cr) return { value: d.egfr_cr.value, source: "creatinine (CKD-EPI 2021)" };
  return null;
}
/** UACR (mg/g) at one draw: reported, or computed from urine albumin and urine creatinine (both mg/dL). */
export function uacrAt(panel) {
  const v = panel.v ?? {};
  if (num(v.uacr) != null) return { value: num(v.uacr), source: "as reported by the lab" };
  if (num(v.urine_albumin) != null && num(v.urine_creat) > 0) return { value: Math.round((num(v.urine_albumin) / num(v.urine_creat)) * 1000 * 10) / 10, source: "urine albumin ÷ urine creatinine × 1000" };
  return null;
}

// ---------- KDIGO ----------
const G_OF = (e) => (e >= 90 ? "G1" : e >= 60 ? "G2" : e >= 45 ? "G3a" : e >= 30 ? "G3b" : e >= 15 ? "G4" : "G5");
const A_OF = (u) => (u < 30 ? "A1" : u <= 300 ? "A2" : "A3");
const GRID = { G1: ["low", "moderate", "high"], G2: ["low", "moderate", "high"], G3a: ["moderate", "high", "veryhigh"], G3b: ["high", "veryhigh", "veryhigh"], G4: ["veryhigh", "veryhigh", "veryhigh"], G5: ["veryhigh", "veryhigh", "veryhigh"] };
export const KDIGO_RISK = { low: ["Low risk", "good"], moderate: ["Moderately increased risk", "watch"], high: ["High risk", "bad"], veryhigh: ["Very high risk", "bad"] };
/** KDIGO 2012/2024 GFR (G1–G5) and albuminuria (A1–A3) categories and the heat-map risk cell. Without a UACR the
 *  risk cell is unknown (G1–G2 is only "low" when albuminuria is A1). */
export function kdigo(egfr, uacr = null) {
  if (egfr == null || !Number.isFinite(egfr)) return null;
  const g = G_OF(egfr), a = uacr != null && Number.isFinite(uacr) ? A_OF(uacr) : null;
  const risk = a ? GRID[g][+a[1] - 1] : g === "G4" || g === "G5" ? "veryhigh" : null;
  return { g, a, risk, floor: GRID[g][0] };
}

// ---------- Lp(a) ----------
/** Lp(a) is mostly inherited, so one result usually suffices. The unit is kept as reported: mass (mg/dL) and molar
 *  (nmol/L) assays don't convert with one universal factor, so each has its own thresholds. */
export function lpaStatus(labs) {
  const ds = draws(labs, "lpa"), last = newest(ds);
  if (!last) return { measured: false };
  const mass = /mg\/dl/i.test(last.unit ?? ""), [t1, t2] = mass ? [50, 100] : [125, 250];
  const level = last.value >= t2 ? "high" : last.value >= t1 ? "elevated" : "normal";
  return { measured: true, value: last.value, unit: mass ? "mg/dL" : "nmol/L", date: last.date, n: ds.length, level, threshold: t1, high: t2 };
}

// ---------- metabolic syndrome ----------
/** Harmonized definition (Alberti 2009): any 3 of 5. Waist uses the AHA/NHLBI US cut-points. BP is the home
 *  average; treated hypertension or diabetes counts for its criterion. Returns how many are met and assessable. */
export function metabolicSyndrome({ tg = null, hdl = null, glucose = null, sys = null, dia = null, waist = null } = {}, { sex = null, bpMeds = false, diabetes = false } = {}) {
  const c = [];
  const add = (key, name, met, value, rule) => c.push({ key, name, met, value, rule });
  add("waist", "Waist", waist == null || !sex ? null : waist >= (sex === "female" ? 88 : 102), waist, sex === "female" ? "≥ 88 cm (35 in)" : "≥ 102 cm (40 in)");
  add("tg", "Triglycerides", tg == null ? null : tg >= 150, tg, "≥ 150 mg/dL");
  add("hdl", "HDL cholesterol", hdl == null || !sex ? null : hdl < (sex === "female" ? 50 : 40), hdl, sex === "female" ? "< 50 mg/dL" : "< 40 mg/dL");
  add("bp", "Blood pressure", bpMeds ? true : sys == null ? null : sys >= 130 || (dia ?? 0) >= 85, sys != null ? `${Math.round(sys)}/${Math.round(dia ?? 0)}` : bpMeds ? "treated" : null, "≥ 130/85 or treated");
  add("glucose", "Fasting glucose", diabetes ? true : glucose == null ? null : glucose >= 100, glucose ?? (diabetes ? "treated" : null), "≥ 100 mg/dL or treated");
  const met = c.filter((z) => z.met === true).length, assessed = c.filter((z) => z.met != null).length;
  return { criteria: c, met, assessed, present: met >= 3 ? true : met + (5 - assessed) < 3 ? false : null };
}

// ---------- risk-enhancing factors ----------
/** The guideline's risk-enhancing factors, each as its own fact. status: "present"; "once" (elevated, but the
 *  guideline asks for persistence, so repeat to confirm); "absent"; "partial" (some inputs missing, can't tell yet); "missing" (never measured); "unasked".
 *  Numeric thresholds are the 2018 AHA/ACC ones (Grundy 2018, Table 6); the 2026 guideline keeps these markers. */
export function riskEnhancers(labs, profile = {}, { bp = null, today = null } = {}) {
  const L = [...(labs ?? [])].sort(byDate), p = profile ?? {}, q = p.risk ?? {}, out = [];
  const item = (key, name, status, detail, extra = {}) => out.push({ key, name, status, detail, ...extra });
  const fmt = (ds) => ds.map((d) => ({ date: d.date, value: d.value }));

  // LDL-C / non-HDL-C
  const ldl = newest(draws(L, "ldl")), tcD = draws(L, "tc"), hdlD = draws(L, "hdl");
  const nonhdlD = draws(L, "nonhdl").length ? draws(L, "nonhdl") : L.filter((x) => num(x.v?.tc) != null && num(x.v?.hdl) != null).map((x) => ({ date: x.date, value: num(x.v.tc) - num(x.v.hdl) }));
  const nh = newest(nonhdlD);
  let severe = false;
  if (!ldl && !nh) item("ldl", "LDL cholesterol 160–189", "missing", "No cholesterol panel on file.");
  else if (ldl && ldl.value >= 190) { severe = true; item("ldl", "LDL cholesterol ≥ 190", "present", `LDL-C ${ldl.value} mg/dL on ${fd(ldl.date)}. Guidelines treat this as high risk on its own.`, { draws: [ldl] }); }
  else if ((ldl && ldl.value >= 160) || (nh && nh.value >= 190 && nh.value < 220)) item("ldl", "LDL cholesterol 160–189", "present", ldl && ldl.value >= 160 ? `LDL-C ${ldl.value} mg/dL on ${fd(ldl.date)}.` : `Non-HDL-C ${nh.value} mg/dL on ${fd(nh.date)} (190–219 counts).`, { draws: [ldl ?? nh] });
  else item("ldl", "LDL cholesterol 160–189", "absent", `LDL-C ${ldl ? `${ldl.value} mg/dL` : "not reported"}${nh ? `, non-HDL-C ${nh.value} mg/dL` : ""} on the newest draw.`);

  // Triglycerides ≥175, persistently (optimally three determinations)
  const tgD = draws(L, "tg");
  if (!tgD.length) item("tg", "Triglycerides ≥ 175, persistent", "missing", "No triglyceride result on file.");
  else {
    const last3 = tgD.slice(-3), hi = last3.filter((d) => d.value >= 175), last = newest(tgD);
    if (last.value < 175) item("tg", "Triglycerides ≥ 175, persistent", "absent", `${last.value} mg/dL on ${fd(last.date)}${tgD.some((d) => d.value >= 175) ? "; higher on an earlier draw" : ""}.`, { draws: fmt(last3) });
    else if (last3.length >= 2 && hi.length === last3.length) item("tg", "Triglycerides ≥ 175, persistent", "present", `≥ 175 mg/dL on all of your last ${last3.length} draws.`, { draws: fmt(last3) });
    else item("tg", "Triglycerides ≥ 175, persistent", "once", `${last.value} mg/dL on ${fd(last.date)}. The guideline asks for a persistent elevation (ideally three measurements), so a repeat test would confirm it.`, { draws: fmt(last3) });
  }

  // hs-CRP ≥2 (values >10 mg/L usually mean an acute illness and are left out)
  const crpD = draws(L, "hscrp"), crpOk = crpD.filter((d) => d.value <= 10), lastCrp = newest(crpD);
  if (!crpD.length) item("hscrp", "hs-CRP ≥ 2 mg/L", "missing", "Not measured. It's an optional test.");
  else if (lastCrp.value > 10) item("hscrp", "hs-CRP ≥ 2 mg/L", "once", `${lastCrp.value} mg/L on ${fd(lastCrp.date)}. Above 10 usually means an infection or injury, so retest once you're well.`, { draws: fmt(crpD.slice(-3)) });
  else {
    const two = crpOk.slice(-2);
    if (lastCrp.value < 2) item("hscrp", "hs-CRP ≥ 2 mg/L", "absent", `${lastCrp.value} mg/L on ${fd(lastCrp.date)}.`, { draws: fmt(two) });
    else if (two.length === 2 && two.every((d) => d.value >= 2)) item("hscrp", "hs-CRP ≥ 2 mg/L", "present", `≥ 2 mg/L on your last two draws.`, { draws: fmt(two) });
    else item("hscrp", "hs-CRP ≥ 2 mg/L", "once", `${lastCrp.value} mg/L on ${fd(lastCrp.date)}. CRP rises with any cold or strain, so the AHA/CDC advice is to average two tests.`, { draws: fmt(two) });
  }

  // Lp(a)
  const lp = lpaStatus(L);
  if (!lp.measured) item("lpa", "Lipoprotein(a) ≥ 125 nmol/L", "missing", "Never measured. One test is recommended for every adult (2026 ACC/AHA).");
  else item("lpa", `Lipoprotein(a) ≥ ${lp.threshold} ${lp.unit}`, lp.level === "normal" ? "absent" : "present", `${lp.value} ${lp.unit} on ${fd(lp.date)}.${lp.level === "high" ? ` At ${lp.high} ${lp.unit} or more, risk is about double.` : ""}`, { draws: [{ date: lp.date, value: lp.value }] });

  // ApoB ≥130
  const apo = newest(draws(L, "apob"));
  if (!apo) item("apob", "ApoB ≥ 130 mg/dL", "missing", "Not measured. It counts the particles that carry cholesterol into artery walls.");
  else item("apob", "ApoB ≥ 130 mg/dL", apo.value >= 130 ? "present" : "absent", `${apo.value} mg/dL on ${fd(apo.date)}.`, { draws: [apo] });

  // Kidney: eGFR 15–59 for 3+ months
  const eg = L.map((x) => ({ date: x.date, e: egfrAt(x, { age: p.age, sex: p.sex, today }) })).filter((z) => z.e);
  const lastE = newest(eg);
  if (!lastE) item("ckd", "Chronic kidney disease (eGFR 15–59)", "missing", "No creatinine or eGFR on file.");
  else if (lastE.e.value >= 60 || lastE.e.value < 15) item("ckd", "Chronic kidney disease (eGFR 15–59)", "absent", `eGFR ${lastE.e.value} on ${fd(lastE.date)} (${lastE.e.source}).`);
  else {
    const earlier = eg.filter((z) => days(z.date, lastE.date) >= 90 && z.e.value < 60);
    item("ckd", "Chronic kidney disease (eGFR 15–59)", earlier.length ? "present" : "once", `eGFR ${lastE.e.value} on ${fd(lastE.date)}${earlier.length ? `, and below 60 at least 3 months earlier` : ". It only counts once it has stayed below 60 for 3 months, so a repeat would confirm it"}.`, { draws: eg.slice(-3).map((z) => ({ date: z.date, value: z.e.value })) });
  }

  // Metabolic syndrome
  const metList = (m) => m.criteria.filter((z) => z.met).map((z) => z.name.toLowerCase()).join(", ");
  const lastOf = (k) => newest(draws(L, k))?.value ?? null;
  const ms = metabolicSyndrome({ tg: lastOf("tg"), hdl: lastOf("hdl"), glucose: lastOf("glucose"), sys: bp?.sys ?? null, dia: bp?.dia ?? null, waist: p.waist ?? null }, { sex: p.sex, bpMeds: !!p.bpMeds, diabetes: !!p.diabetes });
  item("mets", "Metabolic syndrome", ms.present === true ? "present" : ms.present === false ? "absent" : ms.assessed ? "partial" : "missing",
    ms.present === true ? `${ms.met} of 5 criteria met (${metList(ms)}).` : ms.present === false ? `${ms.met} of ${ms.assessed} criteria met${ms.met ? ` (${metList(ms)})` : ""}.` : `${ms.met} of ${ms.assessed} assessed criteria met; ${5 - ms.assessed} can't be checked yet${p.waist == null ? " (add your waist in Profile)" : ""}.`, { mets: ms });

  // Questions only the person can answer
  const ask = (key, name, ans, yes, no) => item(key, name, ans == null ? "unasked" : ans ? "present" : "absent", ans == null ? "Not answered yet." : ans ? yes : no);
  ask("famhx", "Family history of early heart disease", q.famhx, "A parent or sibling had it early (men under 55, women under 65).", "None reported.");
  ask("inflam", "Chronic inflammatory condition", q.inflam, "Rheumatoid arthritis, psoriasis, lupus or HIV raise risk beyond the equation.", "None reported.");
  if (p.sex === "female") ask("women", "Early menopause or pregnancy complications", q.women, "Menopause before 40, or preeclampsia or other pregnancy complications, raise later heart risk.", "None reported.");
  ask("ancestry", "South Asian ancestry", q.ancestry, "Associated with higher heart risk than PREVENT estimates.", "No.");

  const count = (s) => out.filter((z) => z.status === s).length;
  return { items: out, present: count("present"), once: count("once"), missing: count("missing"), unasked: count("unasked"), severeLdl: severe,
    cite: "Risk enhancers: Grundy SM et al., 2018 AHA/ACC cholesterol guideline (Circulation 2019;139:e1082), Table 6; kept in the 2026 ACC/AHA dyslipidemia guideline. Metabolic syndrome: Alberti KG et al., Circulation 2009;120:1640. CKD: KDIGO 2024." };
}
