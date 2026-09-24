// Lab results: derived metabolic and lipid indices from a standard panel, each with its formula, the
// category cut-offs from the source paper, and a citation. Units: US conventional (mg/dL, µIU/mL, %).
// None of these diagnose anything; they track change between draws and add context to wearable trends.

const r1 = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

/** labs: {tc, ldl, hdl, tg, glucose, insulin, a1c, hscrp, egfr, ...} (fasting where relevant); bmi optional. */
export function derived(labs, { bmi = null, sex = null } = {}) {
  const out = [];
  const { tc, ldl, hdl, tg, glucose, insulin } = labs;
  if (glucose != null && insulin != null) {
    const v = (glucose * insulin) / 405;
    out.push({ key: "homa_ir", name: "HOMA-IR", value: r1(v, 2), unit: "", formula: "fasting glucose (mg/dL) × fasting insulin (µIU/mL) ÷ 405",
      band: v < 1.0 ? ["Optimal insulin sensitivity", "good"] : v < 2.0 ? ["Normal", "good"] : v < 2.9 ? ["Early insulin resistance", "watch"] : ["Insulin resistance", "bad"],
      note: "Cut-offs vary by population; <2 is widely used as normal and ≥2.9 as insulin resistance.", cite: "Matthews DR et al., Diabetologia 1985" });
    const b = glucose > 63 ? (360 * insulin) / (glucose - 63) : null;
    if (b) out.push({ key: "homa_b", name: "HOMA-%B", value: Math.round(b), unit: "%", formula: "360 × insulin ÷ (glucose − 63)", band: ["β-cell function estimate", ""], note: "Descriptive; ~100% is typical.", cite: "Matthews DR et al., Diabetologia 1985" });
  }
  if (tg != null && glucose != null) {
    const v = Math.log((tg * glucose) / 2);
    out.push({ key: "tyg", name: "TyG index", value: r1(v, 2), unit: "", formula: "ln[triglycerides (mg/dL) × fasting glucose (mg/dL) ÷ 2]",
      band: v < 8.5 ? ["Lower insulin-resistance risk", "good"] : v < 8.8 ? ["Borderline", "watch"] : ["Higher insulin-resistance risk", "bad"],
      note: "Validated against the glucose clamp; ~8.5-8.8 is the usual threshold range.", cite: "Simental-Mendía LE et al., Metab Syndr Relat Disord 2008" });
  }
  if (tg != null && hdl != null) {
    const v = tg / hdl;
    out.push({ key: "tg_hdl", name: "Triglyceride / HDL", value: r1(v, 1), unit: "", formula: "triglycerides ÷ HDL-C (both mg/dL)",
      band: v < 2 ? ["Favorable", "good"] : v < 3.5 ? ["Intermediate", "watch"] : ["Suggests insulin resistance", "bad"],
      note: "≥3.5 (mg/dL units) identified insulin-resistant adults in McLaughlin's cohort.", cite: "McLaughlin T et al., Ann Intern Med 2003" });
    const aip = Math.log10((tg / 88.57) / (hdl / 38.67));
    out.push({ key: "aip", name: "Atherogenic index of plasma", value: r1(aip, 2), unit: "", formula: "log₁₀[TG ÷ HDL-C], both in mmol/L",
      band: aip < 0.11 ? ["Low", "good"] : aip <= 0.21 ? ["Intermediate", "watch"] : ["High", "bad"], note: "Reflects small, dense LDL particles.", cite: "Dobiášová M & Frohlich J, Clin Biochem 2001" });
  }
  if (tc != null && hdl != null && ldl != null) {
    const v = tc - hdl - ldl;
    out.push({ key: "remnant", name: "Remnant cholesterol", value: Math.round(v), unit: "mg/dL", formula: "total − HDL − LDL cholesterol",
      band: v < 24 ? ["Typical", "good"] : v < 39 ? ["Elevated", "watch"] : ["High", "bad"], note: "Cholesterol in triglyceride-rich lipoproteins; independently linked to heart disease risk.", cite: "Varbo A et al., JACC 2013" });
    out.push({ key: "nonhdl", name: "Non-HDL cholesterol", value: Math.round(tc - hdl), unit: "mg/dL", formula: "total − HDL cholesterol",
      band: tc - hdl < 130 ? ["At goal (<130)", "good"] : tc - hdl < 160 ? ["Above optimal", "watch"] : ["High", "bad"], note: "All atherogenic particles' cholesterol.", cite: "Grundy SM et al., 2018 AHA/ACC cholesterol guideline" });
  }
  if (tg != null && glucose != null && hdl != null && bmi != null) {
    const v = (Math.log(2 * glucose + tg) * bmi) / Math.log(hdl);
    out.push({ key: "mets_ir", name: "METS-IR", value: r1(v, 1), unit: "", formula: "ln(2·glucose + TG) × BMI ÷ ln(HDL-C)",
      band: v < 50.39 ? ["Below the insulin-resistance cut-off", "good"] : ["Above the insulin-resistance cut-off", "bad"], note: "Cut-off 50.39 from the clamp-validated derivation cohort.", cite: "Bello-Chavolla OY et al., Eur J Endocrinol 2018" });
  }
  if (labs.hscrp != null) {
    const v = labs.hscrp;
    out.push({ key: "hscrp", name: "hs-CRP category", value: v, unit: "mg/L", formula: "measured", band: v < 1 ? ["Lower relative CV risk", "good"] : v <= 3 ? ["Average", "watch"] : v <= 10 ? ["Higher", "bad"] : ["Likely acute inflammation: retest", "bad"],
      note: "Inflammation also lowers HRV and raises resting heart rate, so Pulse shows it next to those trends.", cite: "Pearson TA et al., Circulation 2003 (AHA/CDC)" });
  }
  return out;
}
