// Phenotypic Age (Levine et al., "An epigenetic biomarker of aging for lifespan and healthspan",
// Aging (Albany NY) 2018, 10(4):573-591) computed from 9 routine CMP/CBC biomarkers plus
// chronological age. This is the *phenotypic* (biomarker) age from that paper -- not the DNA-
// methylation clock the same paper also correlates it with -- so it only needs a standard lab
// panel, which is exactly what src/labs/pdfimport.js already extracts.
//
// The published regression is fit in SI/model units (g/L, umol/L, mmol/L, mg/dL for CRP); Pulse
// stores US-conventional units everywhere else, so values are converted on the way in and the
// converted numbers are also returned (under `inputs`) so the UI can show what actually went into
// the formula.

const r1 = (x) => Math.round(x * 10) / 10;

const REQUIRED_KEYS = ["albumin", "creatinine", "glucose", "hscrp", "lymph_pct", "mcv", "rdw", "alp", "wbc"];

/** PhenoAge's 9 required inputs, for prompting/labeling in the UI. */
export const PHENOAGE_INPUTS = [
  { key: "albumin", name: "Albumin", unit: "g/dL" },
  { key: "creatinine", name: "Creatinine", unit: "mg/dL" },
  { key: "glucose", name: "Glucose", unit: "mg/dL" },
  { key: "hscrp", name: "hs-CRP", unit: "mg/L" },
  { key: "lymph_pct", name: "Lymphocytes", unit: "%" },
  { key: "mcv", name: "MCV", unit: "fL" },
  { key: "rdw", name: "RDW", unit: "%" },
  { key: "alp", name: "Alkaline Phosphatase", unit: "U/L" },
  { key: "wbc", name: "White Blood Cell Count", unit: "Thousand/uL" },
];

// Accepts either a bare number or one of pdfimport.js's {value, unit, flag, ref, ...} result
// objects, so `phenoAge(labsResult.values, age)` works directly against parseLabs' output.
function num(entry) {
  if (entry == null) return null;
  if (typeof entry === "number") return Number.isFinite(entry) ? entry : null;
  if (typeof entry === "object" && typeof entry.value === "number" && Number.isFinite(entry.value)) return entry.value;
  return null;
}

// A below-detection-limit CRP ("<0.2 mg/L", flag "L" on an already-floored assay) reports an
// upper bound, not a true value; the paper's own convention (and the one this task specifies) is
// to floor the natural log's input at a small constant rather than trust that printed bound.
function isBelowDetection(entry) {
  if (entry == null || typeof entry !== "object") return false;
  if (typeof entry.ref === "string" && entry.ref.trim().startsWith("<")) return true;
  return false;
}

/**
 * phenoAge(values, ageYears) -> {phenoAge, age, delta, inputs, missing} or {missing} when any of
 * the 9 required biomarkers (or age) is absent. `values` is a plain object keyed by the same
 * canonical analyte keys src/labs/pdfimport.js uses (albumin, creatinine, glucose, hscrp,
 * lymph_pct, mcv, rdw, alp, wbc); each entry may be a bare number or a pdfimport.js result object.
 */
export function phenoAge(values = {}, ageYears) {
  const missing = [];
  const raw = {};
  for (const key of REQUIRED_KEYS) {
    const v = num(values[key]);
    if (v == null) missing.push(key);
    else raw[key] = v;
  }
  if (typeof ageYears !== "number" || !Number.isFinite(ageYears)) missing.push("age");
  if (missing.length) return { missing };

  const albumin_gL = raw.albumin * 10; // g/dL -> g/L
  const creatinine_umolL = raw.creatinine * 88.42; // mg/dL -> umol/L
  const glucose_mmolL = raw.glucose / 18.016; // mg/dL -> mmol/L

  let crp_mgdl = raw.hscrp / 10; // mg/L -> mg/dL
  if (crp_mgdl <= 0 || isBelowDetection(values.hscrp)) crp_mgdl = 0.01;
  const lncrp = Math.log(crp_mgdl);

  const { lymph_pct: lymph, mcv, rdw, alp, wbc } = raw;

  // xb = -19.9067 - 0.0336*alb + 0.0095*creat + 0.1953*glu + 0.0954*ln(crp) - 0.0120*lymph
  //      + 0.0268*mcv + 0.3306*rdw + 0.00188*alp + 0.0554*wbc + 0.0804*age
  const xb =
    -19.9067 -
    0.0336 * albumin_gL +
    0.0095 * creatinine_umolL +
    0.1953 * glucose_mmolL +
    0.0954 * lncrp -
    0.0120 * lymph +
    0.0268 * mcv +
    0.3306 * rdw +
    0.00188 * alp +
    0.0554 * wbc +
    0.0804 * ageYears;

  // M = 1 - exp(-1.51714 * exp(xb) / 0.0076927); PhenoAge = 141.50225 + ln(-0.00553*ln(1-M)) / 0.090165
  const M = 1 - Math.exp((-1.51714 * Math.exp(xb)) / 0.0076927);
  const years = 141.50225 + Math.log(-0.00553 * Math.log(1 - M)) / 0.090165;

  return {
    phenoAge: r1(years),
    age: ageYears,
    delta: r1(years - ageYears),
    inputs: { albumin_gL, creatinine_umolL, glucose_mmolL, crp_mgdl, lymph_pct: lymph, mcv, rdw, alp, wbc },
    missing: [],
  };
}
