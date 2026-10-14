// The working behind each lab-derived index in labs.js: which results went in, the formula with your own numbers
// substituted step by step, and the paper's cut-offs as a zone ladder. labs.js stays the single source of each value
// and category; a test checks that every working ends on labs.js's value and every ladder agrees with its category.

/** Number for display: up to `d` decimals, trailing zeros dropped, a true minus sign. */
const n = (x, d = 3) => { const r = +(+x).toFixed(d); return (Math.abs(r) >= 10000 ? r.toLocaleString("en-US") : String(r)).replace("-", "−"); };
const EPS = 1e-9; // a boundary that belongs to the lower zone ("≤ b") is stored as b + EPS

/**
 * Zones per index in the guide format [upper bound, tier, label] (ascending; a value v sits in the first zone with
 * v < bound) plus a scale for the ladder. Labels match labs.js's categories exactly. Indices without a validated
 * cut-off (HOMA-%B, AA/EPA, FAI) have none.
 */
export function zonesFor(key, { age = null } = {}) {
  const Z = {
    homa_ir: [[0, 5], [[1, "good", "Optimal insulin sensitivity"], [2, "good", "Normal"], [2.9, "watch", "Early insulin resistance"], [Infinity, "bad", "Insulin resistance"]]],
    quicki: [[0.25, 0.45], [[0.3, "bad", "Low — near the diabetic/obese cohort means"], [0.357, "watch", "Reduced insulin sensitivity"], [Infinity, "good", "Typical of lean, healthy adults"]]],
    mcauley: [[3, 11], [[5.8 + EPS, "bad", "Insulin resistant"], [Infinity, "good", "Insulin sensitive"]]],
    tyg: [[7.5, 10], [[8.5, "good", "Lower insulin-resistance risk"], [8.8, "watch", "Borderline"], [Infinity, "bad", "Higher insulin-resistance risk"]]],
    tg_hdl: [[0, 6], [[2, "good", "Favorable"], [3.5, "watch", "Intermediate"], [Infinity, "bad", "Suggests insulin resistance"]]],
    aip: [[-0.4, 0.6], [[0.11, "good", "Low"], [0.21 + EPS, "watch", "Intermediate"], [Infinity, "bad", "High"]]],
    remnant: [[0, 60], [[24, "good", "Typical"], [39, "watch", "Elevated"], [Infinity, "bad", "High"]]],
    nonhdl: [[80, 220], [[130, "good", "At goal (<130)"], [160, "watch", "Above optimal"], [Infinity, "bad", "High"]]],
    castelli1: [[2, 7], [[3.5, "good", "Lower risk"], [5, "watch", "Average"], [Infinity, "bad", "Higher risk"]]],
    castelli2: [[1, 4.5], [[2.5, "good", "Lower risk"], [3, "watch", "Average"], [Infinity, "bad", "Higher risk"]]],
    mets_ir: [[25, 70], [[50.39, "good", "Below the insulin-resistance cut-off"], [Infinity, "bad", "Above the insulin-resistance cut-off"]]],
    hscrp: [[0, 12], [[1, "good", "Lower relative CV risk"], [3 + EPS, "watch", "Average"], [10 + EPS, "bad", "Higher"], [Infinity, "bad", "Likely acute inflammation: retest"]]],
    egfr_cr: [[30, 130], [[60, "bad", "Reduced — CKD range if persistent ≥3 months"], [90, "watch", "Mildly decreased"], [Infinity, "good", "Normal"]]],
    fib4: [[0, 4], [[age != null && age >= 65 ? 2 : 1.3, "good", "Low probability of advanced fibrosis"], [2.67 + EPS, "watch", "Indeterminate"], [Infinity, "bad", "High probability of advanced fibrosis"]]],
    nafld_fs: [[-4, 2], [[-1.455, "good", "Low probability of advanced fibrosis (F0–F2)"], [0.675 + EPS, "watch", "Indeterminate"], [Infinity, "bad", "High probability of advanced fibrosis (F3–F4)"]]],
    apri: [[0, 2.5], [[0.5, "good", "Low probability of significant fibrosis"], [1.5, "watch", "Indeterminate"], [Infinity, "bad", "High probability of significant fibrosis"]]],
    nlr: [[0, 6], [[0.78, "watch", "Below the healthy-adult reference range"], [3.53 + EPS, "good", "Within the healthy-adult reference range"], [Infinity, "bad", "Above the healthy-adult reference range"]]],
    sii: [[0, 1600], [[189, "watch", "Below the general-population reference range"], [1168 + EPS, "good", "Within the general-population reference range"], [Infinity, "bad", "Above the general-population reference range"]]],
    plr: [[0, 320], [[61, "watch", "Below the general-population reference range"], [239 + EPS, "good", "Within the general-population reference range"], [Infinity, "bad", "Above the general-population reference range"]]],
    omega3_index: [[2, 12], [[4 + EPS, "bad", "Undesirable"], [8, "watch", "Intermediate"], [Infinity, "good", "Desirable"]]],
    iron_sat_calc: [[0, 70], [[15, "bad", "Low — may suggest iron deficiency"], [45 + EPS, "good", "Typical"], [Infinity, "watch", "High — repeat, or consider an iron-overload work-up if persistent"]]],
    bun_creat_calc: [[0, 35], [[10, "watch", "Low"], [20 + EPS, "good", "Typical"], [Infinity, "watch", "High — consider dehydration, high protein intake, or GI bleeding"]]],
  };
  Z.egfr_cys = Z.egfr_cr; Z.egfr_crcys = Z.egfr_cr;
  const z = Z[key];
  return z ? { scale: z[0], zones: z[1] } : null;
}

/** Index of the zone a value falls in (first zone with v < bound), or -1. */
export const zoneAt = (zones, v) => (v == null || !Number.isFinite(v) ? -1 : zones.findIndex((z) => v < z[0]));

/**
 * The working for index `key` from the same inputs labs.js used: {inputs: [[key, value]], lines: [string], result}.
 * `inputs` keys are lab analyte keys or "age", "sex", "bmi", "diabetes" (from the profile). `lines` read top to
 * bottom; the last one ends on the result. Returns null when the inputs aren't there.
 */
export function workings(key, labs, { bmi = null, sex = null, age = null, diabetes = false } = {}) {
  const L = labs ?? {}, { tc, ldl, hdl, tg, glucose: g, insulin: ins } = L;
  const W = (inputs, lines, result) => ({ inputs, lines, result });
  const ln = Math.log, lg = Math.log10, fem = sex === "female";
  switch (key) {
    case "homa_ir": if (g == null || ins == null) return null; {
      const v = (g * ins) / 405; return W([["glucose", g], ["insulin", ins]], [`glucose ${n(g)} × insulin ${n(ins)} ÷ 405`, `= ${n(g * ins)} ÷ 405`, `= ${n(v, 2)}`], v); }
    case "homa_b": if (g == null || ins == null || !(g > 63)) return null; {
      const v = (360 * ins) / (g - 63); return W([["glucose", g], ["insulin", ins]], [`360 × insulin ${n(ins)} ÷ (glucose ${n(g)} − 63)`, `= ${n(360 * ins)} ÷ ${n(g - 63)}`, `= ${n(v, 0)}%`], v); }
    case "quicki": if (g == null || ins == null) return null; {
      const v = 1 / (lg(ins) + lg(g)); return W([["glucose", g], ["insulin", ins]], [`1 ÷ [log₁₀(insulin ${n(ins)}) + log₁₀(glucose ${n(g)})]`, `= 1 ÷ (${n(lg(ins), 4)} + ${n(lg(g), 4)})`, `= 1 ÷ ${n(lg(ins) + lg(g), 4)}`, `= ${n(v, 3)}`], v); }
    case "mcauley": if (ins == null || tg == null) return null; {
      const tm = tg / 88.57, a = 0.28 * ln(ins), b = 0.31 * ln(tm), v = Math.exp(2.63 - a - b);
      return W([["insulin", ins], ["tg", tg]], [`triglycerides ${n(tg)} mg/dL ÷ 88.57 = ${n(tm, 3)} mmol/L`, `exp[2.63 − 0.28 × ln(${n(ins)}) − 0.31 × ln(${n(tm, 3)})]`, `= exp(2.63 − ${n(a, 3)} − ${n(b, 3)}) = exp(${n(2.63 - a - b, 3)})`, `= ${n(v, 2)}`], v); }
    case "tyg": if (tg == null || g == null) return null; {
      const v = ln((tg * g) / 2); return W([["tg", tg], ["glucose", g]], [`ln(triglycerides ${n(tg)} × glucose ${n(g)} ÷ 2)`, `= ln(${n((tg * g) / 2, 1)})`, `= ${n(v, 2)}`], v); }
    case "tg_hdl": if (tg == null || hdl == null) return null; {
      const v = tg / hdl; return W([["tg", tg], ["hdl", hdl]], [`triglycerides ${n(tg)} ÷ HDL ${n(hdl)}`, `= ${n(v, 1)}`], v); }
    case "aip": if (tg == null || hdl == null) return null; {
      const a = tg / 88.57, b = hdl / 38.67, v = lg(a / b);
      return W([["tg", tg], ["hdl", hdl]], [`triglycerides ${n(tg)} ÷ 88.57 = ${n(a, 3)} mmol/L; HDL ${n(hdl)} ÷ 38.67 = ${n(b, 3)} mmol/L`, `log₁₀(${n(a, 3)} ÷ ${n(b, 3)}) = log₁₀(${n(a / b, 3)})`, `= ${n(v, 2)}`], v); }
    case "remnant": if (tc == null || hdl == null || ldl == null) return null; {
      const v = tc - hdl - ldl; return W([["tc", tc], ["hdl", hdl], ["ldl", ldl]], [`total ${n(tc)} − HDL ${n(hdl)} − LDL ${n(ldl)}`, `= ${n(v, 0)} mg/dL`], v); }
    case "nonhdl": if (tc == null || hdl == null || ldl == null) return null; {
      const v = tc - hdl; return W([["tc", tc], ["hdl", hdl]], [`total ${n(tc)} − HDL ${n(hdl)}`, `= ${n(v, 0)} mg/dL`], v); }
    case "castelli1": if (tc == null || hdl == null) return null; {
      const v = tc / hdl; return W([["tc", tc], ["hdl", hdl]], [`total ${n(tc)} ÷ HDL ${n(hdl)}`, `= ${n(v, 2)}`], v); }
    case "castelli2": if (ldl == null || hdl == null) return null; {
      const v = ldl / hdl; return W([["ldl", ldl], ["hdl", hdl]], [`LDL ${n(ldl)} ÷ HDL ${n(hdl)}`, `= ${n(v, 2)}`], v); }
    case "mets_ir": if (tg == null || g == null || hdl == null || bmi == null) return null; {
      const a = ln(2 * g + tg), b = ln(hdl), v = (a * bmi) / b;
      return W([["glucose", g], ["tg", tg], ["hdl", hdl], ["bmi", bmi]], [`ln(2 × glucose ${n(g)} + triglycerides ${n(tg)}) = ln(${n(2 * g + tg)}) = ${n(a, 3)}`, `ln(HDL ${n(hdl)}) = ${n(b, 3)}`, `${n(a, 3)} × BMI ${n(bmi, 1)} ÷ ${n(b, 3)}`, `= ${n(v, 1)}`], v); }
    case "hscrp": if (L.hscrp == null) return null;
      return W([["hscrp", L.hscrp]], [`measured directly: ${n(L.hscrp)} mg/L (no formula)`], L.hscrp);
    case "egfr_cr": { const cr = L.creatinine; if (cr == null || age == null || sex == null) return null;
      const k = fem ? 0.7 : 0.9, a = fem ? -0.241 : -0.302, r = cr / k, t1 = Math.min(r, 1) ** a, t2 = Math.max(r, 1) ** -1.2, t3 = 0.9938 ** age, v = 142 * t1 * t2 * t3 * (fem ? 1.012 : 1);
      return W([["creatinine", cr], ["age", age], ["sex", sex]], [`κ = ${k}, α = ${n(a)} for ${sex === "female" ? "women" : "men"}; creatinine ${n(cr)} ÷ κ = ${n(r, 3)}`,
        `142 × min(${n(r, 3)}, 1)^${n(a)} × max(${n(r, 3)}, 1)^−1.200 × 0.9938^${n(age, 1)}${fem ? " × 1.012" : ""}`, `= 142 × ${n(t1, 3)} × ${n(t2, 3)} × ${n(t3, 3)}${fem ? " × 1.012" : ""}`, `= ${n(v, 0)} mL/min/1.73m²`], v); }
    case "egfr_cys": { const cy = L.cystatin_c; if (cy == null || age == null || sex == null) return null;
      const r = cy / 0.8, t1 = Math.min(r, 1) ** -0.499, t2 = Math.max(r, 1) ** -1.328, t3 = 0.996 ** age, v = 133 * t1 * t2 * t3 * (fem ? 0.932 : 1);
      return W([["cystatin_c", cy], ["age", age], ["sex", sex]], [`cystatin C ${n(cy)} ÷ 0.8 = ${n(r, 3)}`, `133 × min(${n(r, 3)}, 1)^−0.499 × max(${n(r, 3)}, 1)^−1.328 × 0.996^${n(age, 1)}${fem ? " × 0.932" : ""}`,
        `= 133 × ${n(t1, 3)} × ${n(t2, 3)} × ${n(t3, 3)}${fem ? " × 0.932" : ""}`, `= ${n(v, 0)} mL/min/1.73m²`], v); }
    case "egfr_crcys": { const cr = L.creatinine, cy = L.cystatin_c; if (cr == null || cy == null || age == null || sex == null) return null;
      const k = fem ? 0.7 : 0.9, a = fem ? -0.219 : -0.144, r = cr / k, s = cy / 0.8;
      const t = [Math.min(r, 1) ** a, Math.max(r, 1) ** -0.544, Math.min(s, 1) ** -0.323, Math.max(s, 1) ** -0.778, 0.9961 ** age], v = 135 * t.reduce((p, x) => p * x, 1) * (fem ? 0.963 : 1);
      return W([["creatinine", cr], ["cystatin_c", cy], ["age", age], ["sex", sex]], [`κ = ${k}, α = ${n(a)} for ${sex === "female" ? "women" : "men"}; creatinine ÷ κ = ${n(r, 3)}; cystatin C ÷ 0.8 = ${n(s, 3)}`,
        `135 × min(${n(r, 3)}, 1)^${n(a)} × max(${n(r, 3)}, 1)^−0.544 × min(${n(s, 3)}, 1)^−0.323 × max(${n(s, 3)}, 1)^−0.778 × 0.9961^${n(age, 1)}${fem ? " × 0.963" : ""}`,
        `= 135 × ${t.map((x) => n(x, 3)).join(" × ")}${fem ? " × 0.963" : ""}`, `= ${n(v, 0)} mL/min/1.73m²`], v); }
    case "fib4": { const { ast, alt, platelets: p } = L; if (age == null || ast == null || alt == null || p == null) return null;
      const v = (age * ast) / (p * Math.sqrt(alt));
      return W([["age", age], ["ast", ast], ["alt", alt], ["platelets", p]], [`age ${n(age, 1)} × AST ${n(ast)} ÷ (platelets ${n(p)} × √ALT ${n(alt)})`, `= ${n(age * ast, 1)} ÷ (${n(p)} × ${n(Math.sqrt(alt), 3)})`, `= ${n(age * ast, 1)} ÷ ${n(p * Math.sqrt(alt), 1)}`, `= ${n(v, 2)}`], v); }
    case "nafld_fs": { const { ast, alt, platelets: p, albumin: alb } = L; if (age == null || bmi == null || ast == null || alt == null || p == null || alb == null) return null;
      const ifg = !!diabetes || (g != null && g >= 100) ? 1 : 0;
      const parts = [["", -1.675], [`0.037 × age ${n(age, 1)}`, 0.037 * age], [`0.094 × BMI ${n(bmi, 1)}`, 0.094 * bmi], [`1.13 × IFG/diabetes ${ifg}`, 1.13 * ifg], [`0.99 × AST/ALT ${n(ast / alt, 3)}`, 0.99 * (ast / alt)], [`0.013 × platelets ${n(p)}`, -0.013 * p], [`0.66 × albumin ${n(alb)}`, -0.66 * alb]];
      const v = parts.reduce((s, x) => s + x[1], 0);
      return W([["age", age], ["bmi", bmi], ["diabetes", ifg], ["ast", ast], ["alt", alt], ["platelets", p], ["albumin", alb], ...(g != null ? [["glucose", g]] : [])],
        [...parts.map(([lab, x], i) => `${i ? (x < 0 ? "− " : "+ ") : ""}${lab ? `${lab} = ` : ""}${n(i ? Math.abs(x) : x, 3)}`), `= ${n(v, 2)}`], v); }
    case "apri": { const { ast, platelets: p } = L; if (ast == null || p == null) return null;
      const v = (ast / 40 / p) * 100; return W([["ast", ast], ["platelets", p]], [`(AST ${n(ast)} ÷ 40) ÷ platelets ${n(p)} × 100`, `= ${n(ast / 40, 3)} ÷ ${n(p)} × 100`, `= ${n(v, 2)}`], v); }
    case "nlr": { const { neut_abs: na, lymph_abs: la, neut_pct: np, lymph_pct: lp } = L;
      if (na != null && la != null) { const v = na / la; return W([["neut_abs", na], ["lymph_abs", la]], [`neutrophils ${n(na)} ÷ lymphocytes ${n(la)} (absolute counts)`, `= ${n(v, 2)}`], v); }
      if (np != null && lp != null) { const v = np / lp; return W([["neut_pct", np], ["lymph_pct", lp]], [`neutrophils ${n(np)}% ÷ lymphocytes ${n(lp)}% (percentages; absolute counts weren't on file)`, `= ${n(v, 2)}`], v); }
      return null; }
    case "sii": { const { neut_abs: na, lymph_abs: la, platelets: p } = L; if (na == null || la == null || p == null) return null;
      const v = (p * (na / 1000)) / (la / 1000);
      return W([["platelets", p], ["neut_abs", na], ["lymph_abs", la]], [`neutrophils ${n(na)}/µL = ${n(na / 1000, 2)} × 10³/µL; lymphocytes ${n(la)}/µL = ${n(la / 1000, 2)} × 10³/µL`, `platelets ${n(p)} × ${n(na / 1000, 2)} ÷ ${n(la / 1000, 2)}`, `= ${n(v, 0)}`], v); }
    case "plr": { const { lymph_abs: la, platelets: p } = L; if (la == null || p == null || L.neut_abs == null) return null;
      const v = p / (la / 1000); return W([["platelets", p], ["lymph_abs", la]], [`platelets ${n(p)} ÷ lymphocytes ${n(la / 1000, 2)} × 10³/µL`, `= ${n(v, 1)}`], v); }
    case "omega3_index": { const { epa, dha } = L; if (epa == null || dha == null) return null;
      const v = epa + dha; return W([["epa", epa], ["dha", dha]], [`EPA ${n(epa)}% + DHA ${n(dha)}%`, `= ${n(v, 1)}%`], v); }
    case "aa_epa": { const { aa, epa } = L; if (aa == null || epa == null) return null;
      const v = aa / epa; return W([["aa", aa], ["epa", epa]], [`arachidonic acid ${n(aa)}% ÷ EPA ${n(epa)}%`, `= ${n(v, 2)}`], v); }
    case "fai": { const { testosterone: t, shbg } = L; if (t == null || shbg == null) return null;
      const tn = t / 28.84, v = (100 * tn) / shbg;
      return W([["testosterone", t], ["shbg", shbg]], [`testosterone ${n(t)} ng/dL ÷ 28.84 = ${n(tn, 3)} nmol/L`, `100 × ${n(tn, 3)} ÷ SHBG ${n(shbg)}`, `= ${n(v, 2)}`], v); }
    case "iron_sat_calc": { const { iron, tibc } = L; if (iron == null || tibc == null) return null;
      const v = (iron / tibc) * 100; return W([["iron", iron], ["tibc", tibc]], [`iron ${n(iron)} ÷ TIBC ${n(tibc)} × 100`, `= ${n(v, 1)}%`], v); }
    case "bun_creat_calc": { const { bun, creatinine: cr } = L; if (bun == null || cr == null) return null;
      const v = bun / cr; return W([["bun", bun], ["creatinine", cr]], [`BUN ${n(bun)} ÷ creatinine ${n(cr)}`, `= ${n(v, 1)}`], v); }
    default: return null;
  }
}

// ---- PhenoAge, marker by marker ----
// Levine 2018: PhenoAge = 141.50225 + ln(−0.00553 × ln(1 − M)) / 0.090165 with M = 1 − exp(−1.51714 × e^xb / 0.0076927).
// Substituting M gives PhenoAge = 141.50225 + (ln(0.00553 × 1.51714 / 0.0076927) + xb) / 0.090165 exactly, so every
// marker adds or removes years in a straight line: coefficient × value ÷ 0.090165. That makes an exact split possible.
const PHENO = [
  { key: "albumin", name: "Albumin", unit: "g/dL", coef: -0.0336, model: (v) => v * 10, mu: "g/L", ref: 4.3 },
  { key: "creatinine", name: "Creatinine", unit: "mg/dL", coef: 0.0095, model: (v) => v * 88.42, mu: "µmol/L", ref: 0.9 },
  { key: "glucose", name: "Glucose", unit: "mg/dL", coef: 0.1953, model: (v) => v / 18.016, mu: "mmol/L", ref: 85 },
  { key: "hscrp", name: "hs-CRP", unit: "mg/L", coef: 0.0954, model: (v) => Math.log(v > 0 ? v / 10 : 0.01), mu: "ln mg/dL", ref: 1 },
  { key: "lymph_pct", name: "Lymphocytes", unit: "%", coef: -0.012, model: (v) => v, mu: "%", ref: 30 },
  { key: "mcv", name: "MCV", unit: "fL", coef: 0.0268, model: (v) => v, mu: "fL", ref: 90 },
  { key: "rdw", name: "RDW", unit: "%", coef: 0.3306, model: (v) => v, mu: "%", ref: 13 },
  { key: "alp", name: "Alkaline phosphatase", unit: "U/L", coef: 0.00188, model: (v) => v, mu: "U/L", ref: 80 },
  { key: "wbc", name: "White cells", unit: "×10³/µL", coef: 0.0554, model: (v) => v, mu: "×10³/µL", ref: 6.5 },
];
const PHENO_K = 0.090165, PHENO_C = 141.50225 + (Math.log((0.00553 * 1.51714) / 0.0076927) - 19.9067) / PHENO_K;
/** Years per year of age in PhenoAge (0.0804 ÷ 0.090165). */
export const PHENO_AGE_YEARS = 0.0804 / PHENO_K;
/** Mid-range reference values the per-marker "pull" is measured against (shown to the person). */
export const PHENO_REF = Object.fromEntries(PHENO.map((m) => [m.key, m.ref]));

/**
 * PhenoAge split into years per marker. `values` in US units (as stored); a CRP at or below zero is floored like
 * bioage.js does (a below-detection CRP should be passed as its printed bound; bioage.js applies the same floor).
 * Returns {total, base, ageYears, parts: [{key, name, unit, value, coef, years, pull}]} where `years` sums with base and
 * ageYears to the total, and `pull` is the years this marker adds versus its mid-range reference value.
 */
export function phenoParts(values, age, { crpFloor = false } = {}) {
  if (age == null || PHENO.some((m) => values?.[m.key] == null)) return null;
  const parts = PHENO.map((m) => {
    const v = values[m.key], x = m.key === "hscrp" && crpFloor ? Math.log(0.01) : m.model(v);
    return { key: m.key, name: m.name, unit: m.unit, value: v, coef: m.coef, modelValue: x, modelUnit: m.mu, years: (m.coef * x) / PHENO_K, pull: (m.coef * (x - m.model(m.ref))) / PHENO_K };
  });
  const ageYears = PHENO_AGE_YEARS * age;
  return { total: PHENO_C + ageYears + parts.reduce((a, p) => a + p.years, 0), base: PHENO_C, ageYears, parts };
}

/** The change in PhenoAge between two complete panels, split exactly by marker (plus ageing between the draws). */
export function phenoChange(a, b) {
  if (!a || !b) return null;
  const parts = a.parts.map((p, i) => ({ key: p.key, name: p.name, unit: p.unit, from: p.value, to: b.parts[i].value, years: b.parts[i].years - p.years }));
  return { total: b.total - a.total, ageing: b.ageYears - a.ageYears, parts };
}

// ---- PREVENT, input by input ----
const PREVENT_GROUP = {
  age: "Age", age_squared: "Age",
  non_hdl_c: "Cholesterol", hdl_c: "Cholesterol", statin: "Cholesterol", statin_non_hdl_c: "Cholesterol", age_non_hdl_c: "Cholesterol", age_hdl_c: "Cholesterol",
  sbp_lt_110: "Blood pressure", sbp_gte_110: "Blood pressure", bp_tx: "Blood pressure", bp_tx_sbp_gte_110: "Blood pressure", age_sbp_gte_110: "Blood pressure",
  dm: "Diabetes and HbA1c", age_dm: "Diabetes and HbA1c", hba1c_dm: "Diabetes and HbA1c", hba1c_no_dm: "Diabetes and HbA1c", missing_hba1c: "Diabetes and HbA1c",
  smoking: "Smoking", age_smoking: "Smoking",
  bmi_lt_30: "BMI", bmi_gte_30: "BMI", age_bmi_gte_30: "BMI",
  egfr_lt_60: "Kidney function", egfr_gte_60: "Kidney function", age_egfr_lt_60: "Kidney function", ln_uacr: "Kidney function", missing_uacr: "Kidney function",
  sdi_4_to_6: "Neighbourhood (not collected)", sdi_7_to_10: "Neighbourhood (not collected)", missing_sdi: "Neighbourhood (not collected)",
};
/**
 * A preventBreakdown() grouped by input. Age interactions (e.g. age × cholesterol) count with the other factor, since
 * age itself can't change. Each group's log-odds sum becomes an odds multiplier against the reference person.
 * Returns {ref (reference person's risk), risk, groups: [{name, logOdds, odds}]} with non-zero groups, largest first.
 */
export function preventGroups(bd) {
  if (!bd) return null;
  const g = new Map();
  for (const p of bd.parts) { const k = PREVENT_GROUP[p.term] ?? p.term; g.set(k, (g.get(k) ?? 0) + p.contrib); }
  const groups = [...g].filter(([, z]) => Math.abs(z) > 1e-9).map(([name, z]) => ({ name, logOdds: z, odds: Math.exp(z) })).sort((a, b) => Math.abs(b.logOdds) - Math.abs(a.logOdds));
  return { ref: 1 / (1 + Math.exp(-bd.constant)), risk: bd.risk, groups };
}
