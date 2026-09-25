// Lab results: derived metabolic and lipid indices from a standard panel, each with its formula, the
// category cut-offs from the source paper, and a citation. Units: US conventional (mg/dL, µIU/mL, %).
// None of these diagnose anything; they track change between draws and add context to wearable trends.

const r1 = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

/** labs: {tc, ldl, hdl, tg, glucose, insulin, a1c, hscrp, egfr, ...} (fasting where relevant);
 *  profile context: bmi, sex ("female"/"male"), age (years), diabetes (bool) — all optional, and
 *  every block below skips silently when the inputs it needs aren't on file. */
export function derived(labs, { bmi = null, sex = null, age = null, diabetes = false } = {}) {
  const out = [];
  const { tc, ldl, hdl, tg, glucose, insulin } = labs;
  const { apob, ast, alt, platelets, albumin, creatinine, cystatin_c, neut_abs, lymph_abs, neut_pct, lymph_pct,
    testosterone, shbg, epa, dha, aa, iron, tibc, bun, omega3: omega3Total } = labs;
  if (glucose != null && insulin != null) {
    const v = (glucose * insulin) / 405;
    out.push({ key: "homa_ir", name: "HOMA-IR", value: r1(v, 2), unit: "", formula: "fasting glucose (mg/dL) × fasting insulin (µIU/mL) ÷ 405",
      band: v < 1.0 ? ["Optimal insulin sensitivity", "good"] : v < 2.0 ? ["Normal", "good"] : v < 2.9 ? ["Early insulin resistance", "watch"] : ["Insulin resistance", "bad"],
      note: "Cut-offs vary by population; <2 is widely used as normal and ≥2.9 as insulin resistance.", cite: "Matthews DR et al., Diabetologia 1985" });
    const b = glucose > 63 ? (360 * insulin) / (glucose - 63) : null;
    if (b) out.push({ key: "homa_b", name: "HOMA-%B", value: Math.round(b), unit: "%", formula: "360 × insulin ÷ (glucose − 63)", band: ["β-cell function estimate", ""], note: "Descriptive; ~100% is typical.", cite: "Matthews DR et al., Diabetologia 1985" });
    const quicki = 1 / (Math.log10(insulin) + Math.log10(glucose));
    out.push({ key: "quicki", name: "QUICKI", value: r1(quicki, 3), unit: "", formula: "1 ÷ [log₁₀(insulin, µIU/mL) + log₁₀(glucose, mg/dL)]",
      band: quicki >= 0.357 ? ["Typical of lean, healthy adults", "good"] : quicki >= 0.30 ? ["Reduced insulin sensitivity", "watch"] : ["Low — near the diabetic/obese cohort means", "bad"],
      note: "Runs the opposite way from HOMA-IR (higher QUICKI = more sensitive); like HOMA-IR its cut-offs are population-dependent.", cite: "Katz A et al., J Clin Endocrinol Metab 2000;85(7):2402-2410" });
  }
  if (insulin != null && tg != null) {
    const tgMmol = tg / 88.57;
    const mcauley = Math.exp(2.63 - 0.28 * Math.log(insulin) - 0.31 * Math.log(tgMmol));
    out.push({ key: "mcauley", name: "McAuley index", value: r1(mcauley, 2), unit: "", formula: "exp[2.63 − 0.28·ln(insulin, µIU/mL) − 0.31·ln(triglycerides, mmol/L)]",
      band: mcauley > 5.8 ? ["Insulin sensitive", "good"] : ["Insulin resistant", "bad"],
      note: "≤5.8 was the cut-off identified against the euglycemic clamp in the original derivation cohort; it won't always agree with HOMA-IR/QUICKI.", cite: "McAuley KA et al., Diabetes Care 2001;24(3):460-464" });
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
  if (tc != null && hdl != null) {
    const cri1 = tc / hdl;
    out.push({ key: "castelli1", name: "Castelli risk index I (TC/HDL)", value: r1(cri1, 2), unit: "", formula: "total cholesterol ÷ HDL-C",
      band: cri1 < 3.5 ? ["Lower risk", "good"] : cri1 < 5.0 ? ["Average", "watch"] : ["Higher risk", "bad"],
      note: "The single strongest lipid-based predictor of MI in the original Framingham cholesterol-ratio analyses.", cite: "Castelli WP et al., Can J Cardiol 1988;4 Suppl A:5A-10A" });
  }
  if (ldl != null && hdl != null) {
    const cri2 = ldl / hdl;
    out.push({ key: "castelli2", name: "Castelli risk index II (LDL/HDL)", value: r1(cri2, 2), unit: "", formula: "LDL-C ÷ HDL-C",
      band: cri2 < 2.5 ? ["Lower risk", "good"] : cri2 < 3.0 ? ["Average", "watch"] : ["Higher risk", "bad"],
      note: apob != null
        ? "When ApoB and LDL-C disagree (e.g. ApoB elevated despite this ratio looking fine), ApoB better reflects the number of atherogenic particles — often smaller, cholesterol-depleted LDL from high triglycerides or insulin resistance."
        : "Companion to Castelli I; adding an ApoB result lets Pulse flag when LDL particles run cholesterol-depleted (discordant with LDL-C).",
      cite: "Castelli WP et al., Can J Cardiol 1988;4 Suppl A:5A-10A; discordance framework: Sniderman AD et al., Eur Heart J 2024;45(27):2410-2419" });
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

  // ---- Kidney: CKD-EPI 2021 race-free equations (creatinine, cystatin C, and the combined form) ----
  const egfrBand = (v) => (v >= 90 ? ["Normal", "good"] : v >= 60 ? ["Mildly decreased", "watch"] : ["Reduced — CKD range if persistent ≥3 months", "bad"]);
  if (creatinine != null && age != null && sex != null) {
    const k = sex === "female" ? 0.7 : 0.9, a = sex === "female" ? -0.241 : -0.302;
    const v = 142 * Math.min(creatinine / k, 1) ** a * Math.max(creatinine / k, 1) ** -1.2 * 0.9938 ** age * (sex === "female" ? 1.012 : 1);
    out.push({ key: "egfr_cr", name: "eGFR (CKD-EPI 2021, creatinine)", value: Math.round(v), unit: "mL/min/1.73m²",
      formula: "142 × min(Scr/κ,1)^α × max(Scr/κ,1)^−1.200 × 0.9938^age × 1.012 [if female]; κ=0.7(F)/0.9(M), α=−0.241(F)/−0.302(M)",
      band: egfrBand(v), note: "Race-free equation; computed here from your creatinine independent of whatever eGFR the lab itself printed (which may use an older formula).",
      cite: "Inker LA et al., N Engl J Med 2021;385(19):1737-1749" });
  }
  if (cystatin_c != null && age != null && sex != null) {
    const v = 133 * Math.min(cystatin_c / 0.8, 1) ** -0.499 * Math.max(cystatin_c / 0.8, 1) ** -1.328 * 0.996 ** age * (sex === "female" ? 0.932 : 1);
    out.push({ key: "egfr_cys", name: "eGFR (cystatin C)", value: Math.round(v), unit: "mL/min/1.73m²",
      formula: "133 × min(Scys/0.8,1)^−0.499 × max(Scys/0.8,1)^−1.328 × 0.996^age × 0.932 [if female]",
      band: egfrBand(v), note: "This equation never had a race term, so the 2021 race-free recommendations kept the 2012 cystatin-C-only formula unchanged; independent of creatinine/muscle mass.",
      cite: "Inker LA et al., N Engl J Med 2012;367(1):20-29 (equation unchanged by Inker LA et al., N Engl J Med 2021;385(19):1737-1749)" });
    if (creatinine != null) {
      const k = sex === "female" ? 0.7 : 0.9, a = sex === "female" ? -0.219 : -0.144;
      const vc = 135 * Math.min(creatinine / k, 1) ** a * Math.max(creatinine / k, 1) ** -0.544 * Math.min(cystatin_c / 0.8, 1) ** -0.323 * Math.max(cystatin_c / 0.8, 1) ** -0.778 * 0.9961 ** age * (sex === "female" ? 0.963 : 1);
      out.push({ key: "egfr_crcys", name: "eGFR (creatinine + cystatin C)", value: Math.round(vc), unit: "mL/min/1.73m²",
        formula: "135 × min(Scr/κ,1)^α × max(Scr/κ,1)^−0.544 × min(Scys/0.8,1)^−0.323 × max(Scys/0.8,1)^−0.778 × 0.9961^age × 0.963 [if female]; κ=0.7(F)/0.9(M), α=−0.219(F)/−0.144(M)",
        band: egfrBand(vc), note: "The most accurate of the three race-free equations in the derivation/validation cohorts; prefer this one when both markers are on file.",
        cite: "Inker LA et al., N Engl J Med 2021;385(19):1737-1749" });
    }
  }

  // ---- Liver fibrosis risk scores ----
  if (age != null && ast != null && alt != null && platelets != null) {
    const fib4 = (age * ast) / (platelets * Math.sqrt(alt));
    const lowCut = age >= 65 ? 2.0 : 1.3;
    out.push({ key: "fib4", name: "FIB-4", value: r1(fib4, 2), unit: "", formula: "age × AST ÷ (platelets[10³/µL] × √ALT)",
      band: fib4 < lowCut ? ["Low probability of advanced fibrosis", "good"] : fib4 <= 2.67 ? ["Indeterminate", "watch"] : ["High probability of advanced fibrosis", "bad"],
      note: age >= 65
        ? "Age ≥65 inflates FIB-4 on its own, so the low-risk cut-off used here is 2.0 instead of 1.3 (McPherson 2017); the high cut-off (2.67) is unchanged."
        : "Cut-offs (<1.3 low, >2.67 high) are the ones validated for NAFLD/MASLD; the original HCV/HIV cohort used 1.45/3.25.",
      cite: "Sterling RK et al., Hepatology 2006;43(6):1317-1325; NAFLD cut-offs and the age-65 adjustment: McPherson S et al., Gut 2017;66(6):1075-1082" });
  }
  if (age != null && bmi != null && ast != null && alt != null && platelets != null && albumin != null) {
    const ifg = !!diabetes || (glucose != null && glucose >= 100);
    const nfs = -1.675 + 0.037 * age + 0.094 * bmi + 1.13 * (ifg ? 1 : 0) + 0.99 * (ast / alt) - 0.013 * platelets - 0.66 * albumin;
    out.push({ key: "nafld_fs", name: "NAFLD fibrosis score", value: r1(nfs, 2), unit: "", formula: "−1.675 + 0.037·age + 0.094·BMI + 1.13·(IFG/diabetes) + 0.99·(AST/ALT) − 0.013·platelets[10³/µL] − 0.66·albumin[g/dL]",
      band: nfs < -1.455 ? ["Low probability of advanced fibrosis (F0–F2)", "good"] : nfs <= 0.675 ? ["Indeterminate", "watch"] : ["High probability of advanced fibrosis (F3–F4)", "bad"],
      note: `"IFG/diabetes" is taken here as your diabetes flag or a fasting glucose ≥100 mg/dL${glucose == null ? " (glucose isn't on file, so only the diabetes flag counted)" : ""}.`,
      cite: "Angulo P et al., Hepatology 2007;45(4):846-854" });
  }
  if (ast != null && platelets != null) {
    const apri = (ast / 40 / platelets) * 100;
    out.push({ key: "apri", name: "APRI", value: r1(apri, 2), unit: "", formula: "(AST ÷ ULN) ÷ platelets[10⁹/L] × 100",
      band: apri < 0.5 ? ["Low probability of significant fibrosis", "good"] : apri < 1.5 ? ["Indeterminate", "watch"] : ["High probability of significant fibrosis", "bad"],
      note: "Assumes an AST upper limit of normal of 40 U/L, as in the original derivation; use your own lab's ULN if it differs materially. ≥2.0 was the more specific (but less sensitive) cirrhosis cut-off.",
      cite: "Wai CT et al., Hepatology 2003;38(2):518-526" });
  }

  // ---- White-cell inflammatory ratios ----
  const nlrVal = neut_abs != null && lymph_abs != null ? neut_abs / lymph_abs : neut_pct != null && lymph_pct != null ? neut_pct / lymph_pct : null;
  if (nlrVal != null) {
    out.push({ key: "nlr", name: "Neutrophil / lymphocyte ratio", value: r1(nlrVal, 2), unit: "", formula: "absolute neutrophils ÷ absolute lymphocytes (or neutrophil % ÷ lymphocyte % if only percentages are on file)",
      band: nlrVal < 0.78 ? ["Below the healthy-adult reference range", "watch"] : nlrVal <= 3.53 ? ["Within the healthy-adult reference range", "good"] : ["Above the healthy-adult reference range", "bad"],
      note: "0.78–3.53 was the central 95% of a large healthy, non-elderly adult cohort; a persistently high NLR tracks inflammation/physiologic stress.", cite: "Forget P et al., BMC Res Notes 2017;10:12" });
  }
  if (neut_abs != null && lymph_abs != null && platelets != null) {
    const sii = (platelets * (neut_abs / 1000)) / (lymph_abs / 1000);
    out.push({ key: "sii", name: "Systemic immune-inflammation index", value: Math.round(sii), unit: "", formula: "platelets[10³/µL] × neutrophils[10³/µL] ÷ lymphocytes[10³/µL]",
      band: sii < 189 ? ["Below the general-population reference range", "watch"] : sii <= 1168 ? ["Within the general-population reference range", "good"] : ["Above the general-population reference range", "bad"],
      note: "Reference range (189–1168) is the central 95% from a large general-population cohort (mean ≈459), not a diagnostic cut-off.", cite: "Fest J et al., Sci Rep 2018;8:10566 (Rotterdam Study)" });
    const plr = platelets / (lymph_abs / 1000);
    out.push({ key: "plr", name: "Platelet / lymphocyte ratio", value: r1(plr, 1), unit: "", formula: "platelets[10³/µL] ÷ lymphocytes[10³/µL]",
      band: plr < 61 ? ["Below the general-population reference range", "watch"] : plr <= 239 ? ["Within the general-population reference range", "good"] : ["Above the general-population reference range", "bad"],
      note: "Reference range (61–239) from the same cohort as SII, above.", cite: "Fest J et al., Sci Rep 2018;8:10566 (Rotterdam Study)" });
  }

  // ---- Omega-3 fatty acids ----
  if (epa != null && dha != null) {
    const idx = epa + dha;
    out.push({ key: "omega3_index", name: "Omega-3 Index (EPA+DHA)", value: r1(idx, 1), unit: "%", formula: "EPA % + DHA % of red-cell membrane fatty acids",
      band: idx >= 8 ? ["Desirable", "good"] : idx > 4 ? ["Intermediate", "watch"] : ["Undesirable", "bad"],
      note: omega3Total != null && Math.abs(omega3Total - idx) > 0.05
        ? `Distinct from the "Omega-3 Total" this panel reports (${omega3Total}%): the validated Omega-3 Index is EPA+DHA only, while some panels' (e.g. OmegaCheck) "total" also folds in DPA, which reads a bit higher.`
        : "The validated risk index is EPA+DHA only; some panels' \"Omega-3 Total\" (e.g. OmegaCheck) also folds in DPA, which reads a bit higher.",
      cite: "Harris WS & von Schacky C, Prev Med 2004;39(1):212-220" });
  }
  if (aa != null && epa != null) {
    const ratio = aa / epa;
    out.push({ key: "aa_epa", name: "Arachidonic acid / EPA ratio", value: r1(ratio, 2), unit: "", formula: "AA % ÷ EPA % of red-cell membrane fatty acids",
      band: ["Lower is generally considered more favorable; no single validated cut-off", ""],
      note: "The mirror-image EPA/AA ratio tracked with fewer cardiovascular events in Japanese cohorts; read this directionally alongside the Omega-3 Index above, not as a stand-alone diagnostic cut-off.",
      cite: "Itakura H et al., J Atheroscler Thromb 2011;18(2):99-107" });
  }

  // ---- Free androgen index ----
  if (testosterone != null && shbg != null) {
    const fai = (100 * (testosterone / 28.84)) / shbg;
    out.push({ key: "fai", name: "Free androgen index", value: r1(fai, 2), unit: "", formula: "100 × testosterone[nmol/L] ÷ SHBG[nmol/L]; testosterone nmol/L = testosterone ng/dL ÷ 28.84",
      band: [sex === "female" ? "Interpreted mainly in women" : "Not a standard marker in men", ""],
      note: "A rough proxy for bioavailable testosterone, mainly used in PCOS/hyperandrogenism work-ups in women; reference ranges vary a lot by lab, so weigh it against the lab's own range.",
      cite: "Methodologic context and caveats: Vermeulen A et al., J Clin Endocrinol Metab 1999;84(10):3666-3672" });
  }

  // ---- Fill-ins for ratios some panels omit ----
  if (iron != null && tibc != null && labs.iron_sat == null) {
    const v = (iron / tibc) * 100;
    out.push({ key: "iron_sat_calc", name: "Transferrin saturation", value: r1(v, 1), unit: "%", formula: "iron ÷ TIBC × 100",
      band: v < 15 ? ["Low — may suggest iron deficiency", "bad"] : v <= 45 ? ["Typical", "good"] : ["High — repeat, or consider an iron-overload work-up if persistent", "watch"],
      note: "Computed because this panel didn't report % saturation directly.",
      cite: "Standard clinical reference range (~20–50%); ~45% is a commonly used hemochromatosis-screening threshold (Adams PC et al., N Engl J Med 2005;352(17):1769-1778)" });
  }
  if (bun != null && creatinine != null && labs.bun_creat == null) {
    const v = bun / creatinine;
    out.push({ key: "bun_creat_calc", name: "BUN / creatinine ratio", value: r1(v, 1), unit: "", formula: "BUN ÷ creatinine (both mg/dL)",
      band: v < 10 ? ["Low", "watch"] : v <= 20 ? ["Typical", "good"] : ["High — consider dehydration, high protein intake, or GI bleeding", "watch"],
      note: "Computed because this panel didn't report the ratio directly.", cite: "Conventional clinical-chemistry reference range" });
  }

  return out;
}

/**
 * Save a panel into the stored list without losing anything. A panel with the same draw date is merged test by
 * test (the new values replace only the tests they contain; every other result on that date is kept); a new date
 * is added as its own panel. Older panels are never edited, so the current value of each test is simply its
 * newest draw. Returns the new list plus counts for the confirmation message.
 */
export function mergeLabPanel(labs, panel) {
  const list = (labs ?? []).map((p) => ({ ...p })), at = list.findIndex((p) => p.date === panel.date);
  const merge = (a, b) => ({ ...(a ?? {}), ...(b ?? {}) });
  if (at >= 0) {
    const o = list[at], meta = merge(o.meta, panel.meta);
    for (const k of Object.keys(panel.v ?? {})) if (!panel.meta?.[k]) delete meta[k]; // a retyped value drops the old report's flag
    list[at] = { ...o, ...panel, v: merge(o.v, panel.v), meta, extras: merge(o.extras, panel.extras), qual: merge(o.qual, panel.qual),
      source: o.source === "pdf" || panel.source === "pdf" ? "pdf" : panel.source ?? o.source, lab: panel.lab ?? o.lab ?? null };
  } else list.push(panel);
  list.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  const keys = Object.keys(panel.v ?? {}), later = (k) => list.some((p) => p.date > panel.date && p.v?.[k] != null);
  const kept = keys.filter(later), replaced = keys.filter((k) => !later(k) && list.some((p) => p.date < panel.date && p.v?.[k] != null));
  return { labs: list, saved: keys.length, replaced: replaced.length, newerElsewhere: kept.length };
}
