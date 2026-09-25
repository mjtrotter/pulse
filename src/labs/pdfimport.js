// Lab-report PDF import. Extracts text from a lab PDF (Quest/Health Gorilla/Labcorp style layouts)
// with pdf.js, then parses it into the analyte keys Pulse's other lab tooling uses (see
// src/analytics/labs.js) plus a much wider "extras"/"qualitative" catch-all so nothing a report
// prints is ever silently dropped -- US conventional units (mg/dL, %, mmol/L for electrolytes,
// etc.), converting from SI when the report shows SI units instead.
//
// pdf.js itself is NOT imported at module load: it's ~1.7MB and most app sessions never touch a
// PDF, so it's dynamically imported (see loadPdfjs) only when extractText/importLabPdf run.

const PDFJS_URL = new URL("../../vendor/pdfjs/pdf4.legacy.min.js", import.meta.url);
const PDFJS_WORKER_URL = new URL("../../vendor/pdfjs/pdf4.legacy.worker.min.js", import.meta.url);

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(/* @vite-ignore */ PDFJS_URL.href).then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL.href;
      return mod;
    });
  }
  return pdfjsPromise;
}

// ---------------------------------------------------------------------------------------------
// Text-item -> line grouping. pdf.js's getTextContent() returns individual text runs (words or
// word-fragments) with their own x/y position; a "line" of a printed report is every item whose
// baseline y lands within a small tolerance of the others, read left to right by x.
// ---------------------------------------------------------------------------------------------

/**
 * Group raw text items ({str, x, y, width, height}) into printed lines, top to bottom, each
 * line's items sorted left to right and joined with a single space wherever there's a visible
 * horizontal gap between them (so table columns don't run together). Exported so callers who
 * already have items from some other pdf.js entry point (e.g. a Node-only build used in tests)
 * can reuse the exact same grouping logic without going through extractText/loadPdfjs.
 */
export function linesFromItems(items) {
  const filtered = items.filter((it) => it && typeof it.str === "string" && it.str.trim() !== "");
  const sorted = filtered.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    const h = it.height || 8;
    if (last && Math.abs(last.y - it.y) <= Math.max(2, h * 0.4)) {
      last.items.push(it);
      last.y = (last.y * last.n + it.y) / (last.n + 1);
      last.n += 1;
    } else {
      rows.push({ y: it.y, n: 1, items: [it] });
    }
  }
  return rows.map((row) => renderRow(row.items)).filter((t) => t.length > 0);
}

function renderRow(rowItems) {
  const its = rowItems.slice().sort((a, b) => a.x - b.x);
  let text = "";
  let prevEnd = null;
  for (const it of its) {
    const s = it.str;
    if (!s) continue;
    if (prevEnd != null) {
      const gap = it.x - prevEnd;
      const h = it.height || 8;
      if (gap > h * 0.3 && !text.endsWith(" ") && !s.startsWith(" ")) text += " ";
    }
    text += s;
    prevEnd = it.x + (it.width || s.length * (it.height || 8) * 0.5);
  }
  return text.replace(/\s+/g, " ").trim();
}

/** async extractText(arrayBuffer) -> [{page, lines:[string]}], via the vendored pdf.js. */
export async function extractText(arrayBuffer) {
  const pdfjs = await loadPdfjs();
  const data = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
  const task = pdfjs.getDocument({ data, isEvalSupported: false });
  const pages = [];
  try {
    const doc = await task.promise;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const items = tc.items.map((it) => ({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
        width: it.width,
        height: it.height,
      }));
      pages.push({ page: p, lines: linesFromItems(items) });
      page.cleanup?.();
    }
  } finally {
    // destroy() lives on the loading task, not the resolved document proxy.
    await task.destroy();
  }
  return pages;
}

// ---------------------------------------------------------------------------------------------
// parseLabs: pure text -> structured values. No pdf.js dependency, so it's trivially unit-testable
// against hand-written line arrays.
// ---------------------------------------------------------------------------------------------

// Known analytes, in match-priority order (a line is tested against these top to bottom; the
// first whose name pattern matches "claims" the line). More specific patterns are listed before
// more general ones they could otherwise be confused with (e.g. a1c before the bare hemoglobin
// pattern, since "HEMOGLOBIN A1c" would also match /^HEMOGLOBIN\b/; chol_hdl/nonhdl before tc/hdl;
// bun_creat before bun/creatinine; ag_ratio before albumin/globulin; the Cardio IQ LDL/HDL subtype
// keys and hdl_large before the bare ldl/hdl patterns; omega6_3/aa_epa before omega6/aa).
//
// Each entry carries the metadata CANONICAL (below) is built from: a human `name`, the US
// conventional `unit` Pulse displays, and a UI `group`. `si` (when present) converts a reported SI
// unit to that US unit.
//
// Note: the task's analyte list writes "uric acid" with a space; every other key is a single bare
// token (tc, ldl, hscrp, ...), so for a valid/consistent object key it's named "uricacid" here,
// matching that convention.
const mgdlFromMmol = (f) => (v) => v * f;
const ANALYTES = [
  { key: "a1c", re: /^(HEMOGLOBIN\s*A1C|HGB\s*A1C|HBA1C|A1C)\b/i, name: "Hemoglobin A1c", unit: "%", group: "Metabolic",
    si: { re: /mmol\/mol/i, unit: "%", convert: (v) => 0.0915 * v + 2.15 } },
  { key: "hemoglobin", re: /^HEMOGLOBIN\b/i, name: "Hemoglobin", unit: "g/dL", group: "Blood count" },

  { key: "chol_hdl", re: /^CHOL(?:ESTEROL)?\s*\/\s*HDLC?\s*RATIO\b/i, name: "Cholesterol / HDL Ratio", unit: "", group: "Lipids & particles" },
  { key: "nonhdl", re: /^NON[\s-]?HDL(\s*CHOLESTEROL)?\b/i, name: "Non-HDL Cholesterol", unit: "mg/dL", group: "Lipids & particles",
    si: { re: /mmol\/L/i, unit: "mg/dL", convert: mgdlFromMmol(38.67) } },
  { key: "tc", re: /^(CHOLESTEROL|TOTAL\s+CHOLESTEROL)\b/i, name: "Total Cholesterol", unit: "mg/dL", group: "Lipids & particles",
    si: { re: /mmol\/L/i, unit: "mg/dL", convert: mgdlFromMmol(38.67) } },
  { key: "ldl_p", re: /^(LDL\s*PARTICLE\s*NUMBER|LDL[\s-]?P)\b/i, name: "LDL Particle Number", unit: "nmol/L", group: "Lipids & particles" },
  { key: "ldl_small", re: /^LDL\s*SMALL\b/i, name: "LDL Small", unit: "nmol/L", group: "Lipids & particles" },
  { key: "ldl_medium", re: /^LDL\s*MEDIUM\b/i, name: "LDL Medium", unit: "nmol/L", group: "Lipids & particles" },
  { key: "ldl_size", re: /^LDL\s*PEAK\s*SIZE\b/i, name: "LDL Peak Size", unit: "nm", group: "Lipids & particles" },
  { key: "ldl", re: /^LDL\b/i, name: "LDL Cholesterol", unit: "mg/dL", group: "Lipids & particles",
    si: { re: /mmol\/L/i, unit: "mg/dL", convert: mgdlFromMmol(38.67) } },
  { key: "hdl_large", re: /^HDL\s*LARGE\b/i, name: "HDL Large", unit: "umol/L", group: "Lipids & particles" },
  { key: "hdl", re: /^HDL\b/i, name: "HDL Cholesterol", unit: "mg/dL", group: "Lipids & particles",
    si: { re: /mmol\/L/i, unit: "mg/dL", convert: mgdlFromMmol(38.67) } },
  { key: "tg", re: /^TRIGLYCERIDES?\b/i, name: "Triglycerides", unit: "mg/dL", group: "Lipids & particles",
    si: { re: /mmol\/L/i, unit: "mg/dL", convert: mgdlFromMmol(88.57) } },
  { key: "apob", re: /^(APOLIPOPROTEIN\s*B|APO\s*B|APOB)\b/i, name: "Apolipoprotein B", unit: "mg/dL", group: "Lipids & particles" },
  { key: "lpa", re: /^(LIPOPROTEIN\s*\(?A\)?|LP\s*\(?A\)?|LPA)\b/i, name: "Lipoprotein(a)", unit: "nmol/L", group: "Lipids & particles" },

  // Omega fatty acids (OmegaCheck panel).
  { key: "omega6_3", re: /^OMEGA[\s-]?6\s*\/\s*OMEGA[\s-]?3\s*RATIO\b/i, name: "Omega-6/Omega-3 Ratio", unit: "", group: "Omega fatty acids" },
  { key: "omega6", re: /^OMEGA[\s-]?6(\s*TOTAL)?\b/i, name: "Omega-6 Total", unit: "%", group: "Omega fatty acids" },
  { key: "omega3", re: /^OMEGA[\s-]?3(\s*(TOTAL|INDEX))?\b/i, name: "Omega-3 Total / Index", unit: "%", group: "Omega fatty acids" },
  // (?!\+) keeps the combined "EPA+DPA+DHA" summary row (some reports print it above the
  // individual EPA result) from being mistaken for EPA itself.
  { key: "epa", re: /^EPA\b(?!\+)/i, name: "EPA", unit: "%", group: "Omega fatty acids" },
  { key: "dpa", re: /^DPA\b/i, name: "DPA", unit: "%", group: "Omega fatty acids" },
  { key: "dha", re: /^DHA\b/i, name: "DHA", unit: "%", group: "Omega fatty acids" },
  { key: "aa_epa", re: /^ARACHIDONIC\s*ACID\s*\/\s*EPA\s*RATIO\b/i, name: "Arachidonic Acid/EPA Ratio", unit: "", group: "Omega fatty acids" },
  { key: "aa", re: /^ARACHIDONIC\s*ACID\b/i, name: "Arachidonic Acid", unit: "%", group: "Omega fatty acids" },
  { key: "la", re: /^LINOLEIC\s*ACID\b/i, name: "Linoleic Acid", unit: "%", group: "Omega fatty acids" },

  { key: "glucose", re: /^GLUCOSE\b/i, name: "Glucose", unit: "mg/dL", group: "Metabolic",
    si: { re: /mmol\/L/i, unit: "mg/dL", convert: (v) => v * 18.016 } },
  { key: "insulin", re: /^INSULIN\b/i, name: "Insulin", unit: "uIU/mL", group: "Metabolic" },
  { key: "hscrp", re: /^(HS[\s-]?CRP|HIGH\s*SENSITIVITY\s*CRP|C[\s-]?REACTIVE\s*PROTEIN(,?\s*CARDIAC)?|CRP[\s-]?HS)\b/i, name: "hs-CRP", unit: "mg/L", group: "Heart & inflammation" },
  { key: "homocysteine", re: /^HOMOCYSTEINE\b/i, name: "Homocysteine", unit: "umol/L", group: "Heart & inflammation" },

  { key: "bun_creat", re: /^BUN\s*\/\s*CREATININE\s*RATIO\b/i, name: "BUN/Creatinine Ratio", unit: "", group: "Kidney" },
  // The urine albumin/creatinine panel must precede the bare CREATININE and ALBUMIN patterns: otherwise a
  // "Albumin, Random Urine w/ Creatinine" panel lands in the serum slots (urine creatinine, ~100 mg/dL, as serum
  // creatinine; the ratio as serum albumin), and the real serum values that follow are then dropped as duplicates.
  { key: "uacr", re: /^(MICRO)?ALB(UMIN)?\s*\/\s*CREAT(ININE)?(\s*RATIO)?\b/i, name: "Albumin/Creatinine Ratio, Urine", unit: "mg/g", group: "Urine" },
  { key: "urine_creat", re: /^CREATININE,?\s*(RANDOM\s*|24\s*HR?\s*)?URINE\b/i, name: "Creatinine, Urine", unit: "mg/dL", group: "Urine" },
  { key: "egfr", re: /^(EGFR|GFR\s*ESTIMATED)\b/i, name: "eGFR", unit: "mL/min/1.73m2", group: "Kidney" },
  { key: "creatinine", re: /^CREATININE\b/i, name: "Creatinine", unit: "mg/dL", group: "Kidney",
    si: { re: /umol\/L|micromol\/L/i, unit: "mg/dL", convert: (v) => v / 88.42 } },
  { key: "bun", re: /^(BUN|UREA\s*NITROGEN|BLOOD\s*UREA\s*NITROGEN)\b/i, name: "BUN", unit: "mg/dL", group: "Kidney" },
  { key: "uricacid", re: /^URIC\s*ACID\b/i, name: "Uric Acid", unit: "mg/dL", group: "Kidney" },
  { key: "cystatin_c", re: /^CYSTATIN\s*C\b/i, name: "Cystatin C", unit: "mg/L", group: "Kidney" },

  { key: "ast", re: /^AST\b/i, name: "AST", unit: "U/L", group: "Liver" },
  { key: "alt", re: /^ALT\b/i, name: "ALT", unit: "U/L", group: "Liver" },
  { key: "alp", re: /^(ALKALINE(\s*PHOSPHATASE)?|ALK\s*PHOS)\b/i, name: "Alkaline Phosphatase", unit: "U/L", group: "Liver" },
  { key: "ggt", re: /^(GGT|GAMMA[\s-]?GLUTAMYL\s*TRANSFERASE)\b/i, name: "GGT", unit: "U/L", group: "Liver" },
  { key: "bilirubin", re: /^BILIRUBIN,?\s*TOTAL\b/i, name: "Bilirubin, Total", unit: "mg/dL", group: "Liver" },
  { key: "amylase", re: /^AMYLASE\b/i, name: "Amylase", unit: "U/L", group: "Liver" },
  { key: "lipase", re: /^LIPASE\b/i, name: "Lipase", unit: "U/L", group: "Liver" },

  // urine_albumin/mg_rbc must precede the bare albumin/magnesium patterns below: "ALBUMIN, URINE"
  // (a spot urine microalbumin test) and "MAGNESIUM, RBC" (the RBC/intracellular assay) share
  // the same leading word as the unrelated serum ALBUMIN and MAGNESIUM results, and in this
  // report's page order the urine albumin panel is actually printed *before* the CMP's serum
  // albumin -- so without this, the serum value would never get recorded at all.
  { key: "urine_albumin", re: /^(MICRO)?ALBUMIN,?\s*(RANDOM\s*)?URINE\b/i, name: "Albumin, Urine", unit: "mg/dL", group: "Urine" },
  { key: "ag_ratio", re: /^ALBUMIN\s*\/\s*GLOBULIN\s*RATIO\b/i, name: "Albumin/Globulin Ratio", unit: "", group: "Proteins" },
  { key: "protein", re: /^PROTEIN,?\s*TOTAL\b/i, name: "Protein, Total", unit: "g/dL", group: "Proteins" },
  { key: "albumin", re: /^ALBUMIN\b/i, name: "Albumin", unit: "g/dL", group: "Proteins" },
  { key: "globulin", re: /^GLOBULIN\b/i, name: "Globulin", unit: "g/dL", group: "Proteins" },

  { key: "sodium", re: /^SODIUM\b/i, name: "Sodium", unit: "mmol/L", group: "Electrolytes & minerals" },
  { key: "potassium", re: /^POTASSIUM\b/i, name: "Potassium", unit: "mmol/L", group: "Electrolytes & minerals" },
  { key: "chloride", re: /^CHLORIDE\b/i, name: "Chloride", unit: "mmol/L", group: "Electrolytes & minerals" },
  { key: "co2", re: /^(CARBON\s*DIOXIDE|CO2|BICARBONATE)\b/i, name: "Carbon Dioxide", unit: "mmol/L", group: "Electrolytes & minerals" },
  { key: "calcium", re: /^CALCIUM\b/i, name: "Calcium", unit: "mg/dL", group: "Electrolytes & minerals" },
  { key: "mg_rbc", re: /^MAGNESIUM,?\s*RBC\b/i, name: "Magnesium, RBC", unit: "mg/dL", group: "Electrolytes & minerals" },
  { key: "magnesium", re: /^MAGNESIUM\b/i, name: "Magnesium", unit: "mg/dL", group: "Electrolytes & minerals" },

  { key: "wbc", re: /^(WHITE\s*BLOOD\s*CELL|WBC|LEUKOCYTES?)\b/i, name: "White Blood Cell Count", unit: "Thousand/uL", group: "Blood count" },
  { key: "rbc", re: /^(RED\s*BLOOD\s*CELL|RBC)\b/i, name: "Red Blood Cell Count", unit: "Million/uL", group: "Blood count" },
  { key: "hematocrit", re: /^HEMATOCRIT\b/i, name: "Hematocrit", unit: "%", group: "Blood count" },
  { key: "mcv", re: /^MCV\b/i, name: "MCV", unit: "fL", group: "Blood count" },
  { key: "mch", re: /^MCH\b/i, name: "MCH", unit: "pg", group: "Blood count" },
  { key: "mchc", re: /^MCHC\b/i, name: "MCHC", unit: "g/dL", group: "Blood count" },
  { key: "rdw", re: /^RDW\b/i, name: "RDW", unit: "%", group: "Blood count" },
  { key: "platelets", re: /^(PLATELETS?|PLATELET\s*COUNT|PLT)\b/i, name: "Platelet Count", unit: "Thousand/uL", group: "Blood count" },
  { key: "mpv", re: /^MPV\b/i, name: "MPV", unit: "fL", group: "Blood count" },

  { key: "neut_abs", re: /^ABSOLUTE\s*NEUTROPHILS?\b/i, name: "Absolute Neutrophils", unit: "cells/uL", group: "White cell differential" },
  { key: "lymph_abs", re: /^ABSOLUTE\s*LYMPHOCYTES?\b/i, name: "Absolute Lymphocytes", unit: "cells/uL", group: "White cell differential" },
  { key: "mono_abs", re: /^ABSOLUTE\s*MONOCYTES?\b/i, name: "Absolute Monocytes", unit: "cells/uL", group: "White cell differential" },
  { key: "eos_abs", re: /^ABSOLUTE\s*EOSINOPHILS?\b/i, name: "Absolute Eosinophils", unit: "cells/uL", group: "White cell differential" },
  { key: "baso_abs", re: /^ABSOLUTE\s*BASOPHILS?\b/i, name: "Absolute Basophils", unit: "cells/uL", group: "White cell differential" },
  { key: "neut_pct", re: /^NEUTROPHILS?\b/i, name: "Neutrophils", unit: "%", group: "White cell differential" },
  { key: "lymph_pct", re: /^LYMPHOCYTES?\b/i, name: "Lymphocytes", unit: "%", group: "White cell differential" },
  { key: "mono_pct", re: /^MONOCYTES?\b/i, name: "Monocytes", unit: "%", group: "White cell differential" },
  { key: "eos_pct", re: /^EOSINOPHILS?\b/i, name: "Eosinophils", unit: "%", group: "White cell differential" },
  { key: "baso_pct", re: /^BASOPHILS?\b/i, name: "Basophils", unit: "%", group: "White cell differential" },

  { key: "tsh", re: /^(TSH|THYROID\s*STIMULATING\s*HORMONE)\b/i, name: "TSH", unit: "uIU/mL", group: "Thyroid & hormones" },
  { key: "ft4", re: /^(T4[\s,]*FREE|FREE\s*T4|THYROXINE\s*\(?T4\)?,?\s*FREE)\b/i, name: "T4, Free", unit: "ng/dL", group: "Thyroid & hormones" },
  { key: "ft3", re: /^(T3[\s,]*FREE|FREE\s*T3|TRIIODOTHYRONINE\s*\(?T3\)?,?\s*FREE)\b/i, name: "T3, Free", unit: "pg/mL", group: "Thyroid & hormones" },
  { key: "free_testosterone", re: /^(FREE\s*TESTOSTERONE|TESTOSTERONE,?\s*FREE)\b/i, name: "Testosterone, Free", unit: "pg/mL", group: "Thyroid & hormones" },
  { key: "testosterone", re: /^TESTOSTERONE\b/i, name: "Testosterone, Total", unit: "ng/dL", group: "Thyroid & hormones" },
  // "GLOBULIN" optional: some layouts wrap it onto the line *after* the data row (name print
  // order: "SEX HORMONE BINDING" <data...> "GLOBULIN").
  { key: "shbg", re: /^(SHBG|SEX\s*HORMONE[\s-]?BINDING(\s*GLOBULIN)?)\b/i, name: "SHBG", unit: "nmol/L", group: "Thyroid & hormones" },
  { key: "estradiol", re: /^ESTRADIOL\b/i, name: "Estradiol", unit: "pg/mL", group: "Thyroid & hormones" },
  { key: "dhea_s", re: /^DHEA[\s-]?S(?:ULFATE|O4)?\b/i, name: "DHEA Sulfate", unit: "ug/dL", group: "Thyroid & hormones" },
  { key: "cortisol", re: /^CORTISOL\b/i, name: "Cortisol", unit: "ug/dL", group: "Thyroid & hormones" },
  { key: "fsh", re: /^FSH\b/i, name: "FSH", unit: "mIU/mL", group: "Thyroid & hormones" },
  { key: "lh", re: /^LH\b/i, name: "LH", unit: "mIU/mL", group: "Thyroid & hormones" },
  { key: "prolactin", re: /^PROLACTIN\b/i, name: "Prolactin", unit: "ng/mL", group: "Thyroid & hormones" },
  { key: "tg_ab", re: /^THYROGLOBULIN\s*ANTIBODIES\b/i, name: "Thyroglobulin Antibodies", unit: "IU/mL", group: "Thyroid & hormones" },
  { key: "tpo_ab", re: /^THYROID\s*PEROXIDASE\b/i, name: "Thyroid Peroxidase Antibodies", unit: "IU/mL", group: "Thyroid & hormones" },
  { key: "psa_pct", re: /^PSA,?\s*%\s*FREE\b/i, name: "PSA, % Free", unit: "%", group: "Thyroid & hormones" },
  { key: "psa_free", re: /^PSA,?\s*FREE\b/i, name: "PSA, Free", unit: "ng/mL", group: "Thyroid & hormones" },
  { key: "psa", re: /^PSA,?\s*TOTAL\b/i, name: "PSA, Total", unit: "ng/mL", group: "Thyroid & hormones" },

  { key: "vitd", re: /^(VITAMIN\s*D|25[\s-]?HYDROXY\s*VITAMIN\s*D|25[\s-]?OH\s*VITAMIN\s*D)\b/i, name: "Vitamin D, 25-OH", unit: "ng/mL", group: "Vitamins & iron" },
  { key: "b12", re: /^VITAMIN\s*B[\s-]?12\b/i, name: "Vitamin B12", unit: "pg/mL", group: "Vitamins & iron" },
  { key: "folate", re: /^FOLATE\b/i, name: "Folate", unit: "ng/mL", group: "Vitamins & iron" },
  { key: "tibc", re: /^(TIBC|(?:TOTAL\s*)?IRON\s*BINDING\s*CAPACITY)\b/i, name: "TIBC", unit: "ug/dL", group: "Vitamins & iron" },
  { key: "iron_sat", re: /^(%\s*SATURATION|IRON\s*SATURATION|TRANSFERRIN\s*SATURATION)\b/i, name: "% Iron Saturation", unit: "%", group: "Vitamins & iron" },
  { key: "iron", re: /^IRON\b/i, name: "Iron, Total", unit: "ug/dL", group: "Vitamins & iron" },
  { key: "ferritin", re: /^FERRITIN\b/i, name: "Ferritin", unit: "ng/mL", group: "Vitamins & iron" },
  { key: "mma", re: /^METHYLMALONIC\s*ACID\b/i, name: "Methylmalonic Acid", unit: "nmol/L", group: "Vitamins & iron" },
  { key: "vitd2", re: /^(VITAMIN\s*D2|25[\s-]?OH\s*VITAMIN\s*D2|ERGOCALCIFEROL)\b/i, name: "Vitamin D2 (Ergocalciferol)", unit: "ng/mL", group: "Vitamins & iron" },
  { key: "vitd3", re: /^(VITAMIN\s*D3|25[\s-]?OH\s*VITAMIN\s*D3|CHOLECALCIFEROL)\b/i, name: "Vitamin D3 (Cholecalciferol)", unit: "ng/mL", group: "Vitamins & iron" },
  { key: "mercury", re: /^MERCURY\b/i, name: "Mercury, Blood", unit: "ug/L", group: "Vitamins & iron" },
  { key: "zinc", re: /^ZINC\b/i, name: "Zinc", unit: "ug/dL", group: "Vitamins & iron" },
  { key: "lead", re: /^LEAD\b/i, name: "Lead, Venous", unit: "ug/dL", group: "Vitamins & iron" },
  { key: "leptin", re: /^LEPTIN\b/i, name: "Leptin", unit: "ng/mL", group: "Vitamins & iron" },
  { key: "rf", re: /^RHEUMATOID\s*FACTOR\b/i, name: "Rheumatoid Factor", unit: "IU/mL", group: "Heart & inflammation" },

  // Normally captured through handleUrinalysisLine (inside a tracked "...URINALYSIS... Collected:"
  // section) instead of these; they're here too as a fallback for a report layout that repeats the
  // same urinalysis rows under a section title with no "Collected:" line to key off of, so a
  // same-line "SPECIFIC GRAVITY 1.021 ..."/"PH 6.0 ..." row still resolves to the canonical urine
  // key (or, once already resolved, is safely consumed) rather than leaking into `extras`.
  { key: "urine_sg", re: /^SPECIFIC\s*GRAVITY\b/i, name: "Urine Specific Gravity", unit: "", group: "Urine" },
  { key: "urine_ph", re: /^PH\b/i, name: "Urine pH", unit: "", group: "Urine" },
];

/** Human-readable canonical analyte metadata, for the UI. Mirrors ANALYTES' key/name/unit/group. */
export const CANONICAL = ANALYTES.map(({ key, name, unit, group }) => ({ key, name, unit, group }));

const UNIT_RE = /^(mg\/dL|mg\/L|mmol\/L|mmol\/mol|umol\/L|micromol\/L|mg\/g|ng\/mL|ng\/dL|pg\/mL|pg|IU\/L|IU\/mL|uIU\/mL|mIU\/L|mIU\/mL|U\/L|mL\/min\S*|mEq\/L|g\/dL|ug\/dL|ug\/L|mcg\/dL|mcg\/L|Angstrom|K\/uL|10\^?3\/uL|fL|nm|Thousand|Thousand\/uL|Million\/uL|cells\/uL|nmol\/L|umol\/L|%|\/uL|\/HPF|\/LPF)$/i;
const FLAG_RE = /^(HH|LL|H|L|A|AB|ABN|CRIT|CRITICAL)$/i;
const VALUE_TOKEN_RE = /^([<>]=?)?(-?\d+(?:\.\d+)?)(HH|LL|H|L|A)?$/i;

// Normalize operator spacing and Quest's "> OR =" / "< OR =" phrasing, drop the micro sign
// variants down to plain "u" (µIU/mL, μIU/mL, uIU/mL all become the same token), and merge
// "12 - 34" style ranges into one dash-joined token, all so the line can be split on whitespace
// and walked token by token.
function normalizeLine(line) {
  return line
    .replace(/[µμ]/g, "u")
    .replace(/([<>])\s*OR\s*=\s*/gi, "$1=")
    .replace(/([<>]=?)\s+(?=\d)/g, "$1")
    .replace(/(\d)\s*-\s*(?=\d)/g, "$1-");
}

// Data rows are a test name plus numbers, units ("mg/dL", "mmol/L", ...) and short flag letters;
// explanatory/footnote prose is ordinary mixed-case English sentences. Units are themselves
// partly lowercase ("mg/dL" is 3 of 4 letters lowercase), so a simple whole-line lowercase ratio
// misfires on short unit-only text; instead, count actual *prose words* — 4+-letter tokens that
// are mostly lowercase, which real unit abbreviations essentially never are more than one of per
// row — and reject the line only once two or more show up. This keeps result rows (however many
// units they carry) while rejecting narrative sentences (which are nothing but such words), so a
// disclaimer that happens to mention a numeric threshold is never mistaken for a real result, and
// header/footer boilerplate mentioning a patient's name or address never gets scanned as data.
function looksLikeDataRow(text) {
  const words = text.split(/\s+/);
  let proseWords = 0;
  for (const w of words) {
    // Short parenthetical annotations ("(calc)", "(NIH)") are common right next to a unit and
    // aren't prose, whatever their case.
    if (/^\(.*\)$/.test(w)) continue;
    const letters = w.match(/[A-Za-z]/g);
    if (!letters || letters.length < 4) continue;
    const lower = w.match(/[a-z]/g) || [];
    if (lower.length / letters.length > 0.6) proseWords++;
  }
  return proseWords < 2;
}

// Given the text of a line (or the tail of one) that should contain "VALUE [FLAG] [REF] [UNIT] ...",
// find the first standalone token that parses as a value and pull out what follows it. Scans the
// whole line (rather than assuming the value is the very next token after the name) since name
// patterns above only match a short prefix ("LDL", "HDL") while the full printed name is often
// longer ("LDL-CHOLESTEROL", "HDL CHOLESTEROL") with no way to know its exact length in advance.
function extractValue(line) {
  const tokens = normalizeLine(line).split(/\s+/).filter(Boolean);
  let vi = -1;
  let m = null;
  for (let i = 0; i < tokens.length; i++) {
    const mm = tokens[i].match(VALUE_TOKEN_RE);
    if (mm) { vi = i; m = mm; break; }
  }
  if (vi === -1) return null;
  const ineq = m[1] || "";
  const value = parseFloat(m[2]);
  let flag = m[3] ? m[3].toUpperCase() : null;
  let idx = vi + 1;
  if (!flag && tokens[idx] && FLAG_RE.test(tokens[idx])) { flag = tokens[idx].toUpperCase(); idx++; }
  // Ref/unit aren't always the very next tokens: some reports print filler prose in between (e.g.
  // Quest's "<0.5 See Note: mg/dL" -- the value is below the assay's detection limit, so the
  // reference range gets replaced by a pointer to a footnote), so scan forward for each rather
  // than requiring strict adjacency; whichever comes first in the line is still recorded first.
  let ref = null;
  let unit = null;
  for (let k = idx; k < tokens.length; k++) {
    if (!ref && /^[<>]=?\d/.test(tokens[k])) { ref = tokens[k]; continue; }
    if (!ref && /^-?\d+(?:\.\d+)?-\d+(?:\.\d+)?$/.test(tokens[k])) { ref = tokens[k]; continue; }
    // Nothing legitimately follows the unit column on these reports (previous-result/date/lab-code
    // are ignored entirely, not scanned for), so stop the moment a unit is found -- otherwise a
    // later, unrelated token (e.g. a genuine reference range printed *after* a below-detection-
    // limit "<0.5" value's own unit) could get mistaken for this result's range.
    if (!unit && UNIT_RE.test(tokens[k])) { unit = tokens[k]; break; }
  }
  if (!ref && ineq) ref = `${ineq}${m[2]}`;
  return { value, flag, ref, unit };
}

// Reference-range/unit token pair from a line that's mostly that (e.g. "#.#-##.# Thousand",
// "<### mg/dL", "> OR = ## mg/dL", "mg/dL (calc)", or a bare unit like "%" or "uIU/mL").
function parseRangeUnitTokens(text) {
  const tokens = normalizeLine(text).split(/\s+/).filter(Boolean);
  let ref = null;
  let unit = null;
  for (const t of tokens) {
    if (/^\(.*\)$/.test(t)) continue;
    if (!ref && /^[<>]=?\d/.test(t)) { ref = t; continue; }
    if (!ref && /^-?\d+(?:\.\d+)?-\d+(?:\.\d+)?$/.test(t)) { ref = t; continue; }
    if (!unit && UNIT_RE.test(t)) { unit = t; continue; }
  }
  return { ref, unit };
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad2 = (n) => String(n).padStart(2, "0");

function findDate(flatLines) {
  const label = /(?:Date\s*Collected|Specimen\s*Collected|Collection\s*Date|Collected)\s*:?\s*/i;
  for (const line of flatLines) {
    let m = line.match(new RegExp(label.source + "(\\d{4})-(\\d{2})-(\\d{2})", "i"));
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = line.match(new RegExp(label.source + "(\\d{1,2})[\\/-](\\d{1,2})[\\/-](\\d{2,4})", "i"));
    if (m) {
      let [, mo, da, yr] = m;
      if (yr.length === 2) yr = `20${yr}`;
      return `${yr}-${pad2(mo)}-${pad2(da)}`;
    }
    m = line.match(new RegExp(label.source + "([A-Za-z]{3,9})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})", "i"));
    if (m) {
      const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
      if (mo) return `${m[3]}-${pad2(mo)}-${pad2(m[2])}`;
    }
  }
  return null;
}

// Fallback for numeric-looking rows that don't match any known analyte: an ALL-CAPS name
// (Quest/Labcorp test names are printed in caps) immediately followed by a value.
const GENERIC_NAME_RE = /^([A-Z][A-Z0-9 ,()/.'\-]{1,40}?)\s+([<>]=?\d+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s|$)/;

// Same idea, but for a row whose "value" is text rather than a number (no known analyte matched,
// no digit anywhere on the line at all) -- an unrecognized qualitative extra.
const GENERIC_QUAL_RE = /^([A-Z][A-Z0-9 ,()/.'\-]{1,40}?)\s+(NEGATIVE|POSITIVE|NONE SEEN|NOT DETECTED|CLEAR|TRACE|REACTIVE|NON-?REACTIVE|EQUIVOCAL|INDETERMINATE)\b/i;

function slug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// ---------------------------------------------------------------------------------------------
// Section-header tracking. A section header prints as "SOME PANEL NAME Collected: <date> ...";
// used only to disambiguate the handful of test names urinalysis dipstick/microscopy shares with
// unrelated serum/blood analytes (GLUCOSE, BILIRUBIN, PROTEIN, WBC, RBC): the urinalysis versions
// are qualitative ("NEGATIVE", "NONE SEEN") and must never overwrite -- or be confused with -- the
// numeric serum/CBC result of the same bare name.
// ---------------------------------------------------------------------------------------------

const SECTION_HEADER_RE = /^([A-Z][A-Z0-9 ,()/&+.'-]{2,60}?)\s+Collected\s*:/;
function detectSectionHeader(line) {
  const m = line.match(SECTION_HEADER_RE);
  return m ? m[1].trim() : null;
}

// ---------------------------------------------------------------------------------------------
// Qualitative value vocabulary: urinalysis dipstick/microscopy results, LDL pattern, semi-
// quantitative dipstick grades ("1+"), etc. -- anything a report reports as text rather than a
// number. Picks the *earliest* matching phrase in the line (so "DARK YELLOW" wins over the
// "YELLOW" it contains), which matters because the same row often also holds an unrelated
// previous-result qualitative value later in the line.
// ---------------------------------------------------------------------------------------------

const QUAL_PHRASES = [
  "NONE SEEN", "NOT DETECTED", "SEE NOTE", "SLIGHTLY HAZY", "PALE YELLOW", "DARK YELLOW",
  "NON-REACTIVE", "NONREACTIVE", "INDETERMINATE", "EQUIVOCAL", "NEGATIVE", "POSITIVE", "DETECTED",
  "REACTIVE", "ABNORMAL", "NORMAL", "TRACE", "CLEAR", "HAZY", "TURBID", "STRAW", "YELLOW", "AMBER",
  "BROWN", "GREEN", "RED", "ORANGE",
];

function findQualitativePhrase(text) {
  const upper = text.toUpperCase();
  const candidates = [];
  // Whole words only: "CLEAR" must not match inside "NUCLEAR" (an ANA pattern), nor "RED" inside "REDUCED".
  for (const p of QUAL_PHRASES) {
    const m = upper.match(new RegExp(`(?<![A-Z])${p.replace(/[-]/g, "\\-")}(?![A-Z])`));
    if (m) candidates.push({ idx: m.index, len: p.length, text: text.substr(m.index, p.length) });
  }
  let m = text.match(/PATTERN\s*([AB])\b/i);
  if (m) candidates.push({ idx: m.index + m[0].length - m[1].length, len: m[1].length, text: m[1].toUpperCase() });
  m = text.match(/\d\+/);
  if (m) candidates.push({ idx: m.index, len: m[0].length, text: m[0] });
  // ANA-style titer notation ("1:320"), a ratio, not a plain decimal VALUE_TOKEN_RE ever matches.
  m = text.match(/\d+:\d+/);
  if (m) candidates.push({ idx: m.index, len: m[0].length, text: m[0] });
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.idx - b.idx || b.len - a.len);
  return candidates[0];
}

function isQualitativeValue(text) {
  const t = text.trim();
  if (!t) return false;
  if (findQualitativePhrase(t)?.text?.length === t.length) return true;
  return /^[AB]$/.test(t);
}

// ---------------------------------------------------------------------------------------------
// Urinalysis: a small fixed vocabulary of dipstick/microscopy test names, matched by longest name
// first (so "SQUAMOUS EPITHELIAL CELLS" isn't mistaken for a hypothetical bare "SQUAMOUS" test).
// Every one of these (other than specific gravity and pH, which are real numbers) is qualitative.
// ---------------------------------------------------------------------------------------------

// GLUCOSE/BILIRUBIN/PROTEIN/WBC/RBC are homonyms of real serum/CBC canonical keys. Inside a
// *tracked* section (inUrinalysis, below) there's no ambiguity -- they're matched here same as
// everything else. Outside one, though, only URINALYSIS_SAFE_NAMES (which excludes them) is
// consulted: a same-named row there instead falls through to the ordinary ANALYTES loop, where
// it's either claimed as the real numeric serum/blood result (first occurrence) or silently
// absorbed by the already-resolved guard (a later urine duplicate) -- see that guard's comment.
const URINALYSIS_NAMES = [
  "SPECIFIC GRAVITY", "SQUAMOUS EPITHELIAL CELLS", "LEUKOCYTE ESTERASE", "OCCULT BLOOD",
  "HYALINE CAST", "APPEARANCE", "BILIRUBIN", "BACTERIA", "KETONES", "NITRITE", "PROTEIN",
  "GLUCOSE", "COLOR", "RBC", "WBC", "PH",
].sort((a, b) => b.length - a.length);

const URINALYSIS_SAFE_NAMES = URINALYSIS_NAMES.filter(
  (n) => !["BILIRUBIN", "PROTEIN", "GLUCOSE", "RBC", "WBC"].includes(n),
);

function matchName(text, names) {
  const upper = text.toUpperCase();
  for (const name of names) {
    if (upper.startsWith(name)) return { name, rest: text.slice(name.length).trim() };
  }
  return null;
}

/** handleUrinalysisLine(line, page, values, qualitative, safeOnly) -> true if the line was one of
 * the known urinalysis dipstick/microscopy/specific-gravity/pH names (whether or not it carried a
 * usable value), so the caller knows to treat the line as fully handled either way. `safeOnly`
 * restricts matching to names with no serum/blood homonym, for use outside a tracked section. */
function handleUrinalysisLine(line, page, values, qualitative, safeOnly = false) {
  const hit = matchName(line.trim(), safeOnly ? URINALYSIS_SAFE_NAMES : URINALYSIS_NAMES);
  if (!hit || !hit.rest) return false;
  const { name, rest } = hit;

  if (name === "SPECIFIC GRAVITY" || name === "PH") {
    const found = extractValue(rest);
    if (!found) return false;
    const key = name === "PH" ? "urine_ph" : "urine_sg";
    if (!values[key]) {
      values[key] = {
        value: found.value, unit: found.unit || null, flag: found.flag || null, ref: found.ref || null,
        page, name: name === "PH" ? "Urine pH" : "Urine Specific Gravity",
      };
    }
    return true;
  }

  const key = `urine_${slug(name)}`;
  if (qualitative[key]) return true;
  const q = findQualitativePhrase(rest);
  if (q) { qualitative[key] = { name, text: q.text, page }; return true; }
  const found = extractValue(rest);
  if (found) qualitative[key] = { name, text: String(found.value), page };
  return true;
}

// ---------------------------------------------------------------------------------------------
// A few more always-qualitative, fixed-name tests whose "value" is free text no phrase vocabulary
// could reasonably enumerate in advance (an ANA immunofluorescence pattern like "Nuclear,
// Speckled" is one of dozens of possible descriptions; an ABO blood group is a bare letter that
// would otherwise be indistinguishable from a flag). Matched the same way as the urinalysis
// names (longest prefix first), independent of section-header tracking, since these reports don't
// consistently print a "Collected:" line ahead of every one of these (an appendix/requisition-style
// duplicate of the same report often just repeats the bare test name with no header at all).
// ---------------------------------------------------------------------------------------------

const QUALITATIVE_NAMES = [
  "ANA SCREEN, IFA", "ANA TITER", "ANA PATTERN", "ABO GROUP", "RH TYPE",
].sort((a, b) => b.length - a.length);

function matchQualitativeName(text) {
  const upper = text.toUpperCase();
  for (const name of QUALITATIVE_NAMES) {
    if (upper.startsWith(name)) return { name, rest: text.slice(name.length).trim() };
  }
  return null;
}

function handleQualitativeNameLine(line, qualitative, page) {
  const hit = matchQualitativeName(line.trim());
  if (!hit || !hit.rest) return false;
  const { name, rest } = hit;
  const key = slug(name);
  if (qualitative[key]) return true; // already resolved (first occurrence wins); claim it anyway

  const q = findQualitativePhrase(rest);
  if (q) { qualitative[key] = { name, text: q.text, page }; return true; }

  // No recognizable phrase (e.g. an ANA pattern description, or a bare ABO letter): take whatever
  // remains after stripping a trailing performing-lab code, so long as it isn't itself obviously
  // just leftover section-header/footnote noise (which always carries a digit in these reports --
  // an accession number, a "Collected:"-adjacent date, or a footnote/reference marker).
  if (/\d/.test(rest)) return true; // claim the line either way so it's never mistaken for extras
  const toks = rest.split(/\s+/).filter(Boolean);
  while (toks.length > 1 && isLabCodeOnly(toks[toks.length - 1])) toks.pop();
  const text = toks.join(" ").trim();
  if (text) qualitative[key] = { name, text, page };
  return true;
}

// ---------------------------------------------------------------------------------------------
// Vertical-block parser: the layout where a result's name, value, flag, reference range/unit,
// previous result, previous date and performing-lab code each print on their own line (a name may
// wrap across 1-3 lines first). Starting at a line that's either already claimed as an analyte's
// first name-line, or looks like a fresh bare test name, this walks forward consuming exactly the
// lines that belong to that one result and returns how far it got, so the caller can skip past
// them (never re-parsing "COUNT" or "TOTAL" -- a wrapped name's tail -- as if it were its own row).
// ---------------------------------------------------------------------------------------------

const DATE_ONLY_RE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;
const LAB_CODE_ONLY_RE = /^[A-Z]{1,4}$/;
const UNIT_CONTINUATION_RE = /^\/[A-Za-z0-9.]{1,12}$/;
const PREV_RESULT_RE = /^([<>]=?)?-?\d+(?:\.\d+)?(HH|LL|H|L|A)?$/i;

function isFlagOnly(text) { return FLAG_RE.test(text.trim()); }
function isDateOnly(text) { return DATE_ONLY_RE.test(text.trim()); }
function isLabCodeOnly(text) { return LAB_CODE_ONLY_RE.test(text.trim()); }
function isUnitContinuation(text) { return UNIT_CONTINUATION_RE.test(text.trim()); }

function isRangeUnitLine(text) {
  const norm = normalizeLine(text.trim());
  if (/^[<>]=?\d/.test(norm)) return true;
  if (/^-?\d+(?:\.\d+)?-\d+(?:\.\d+)?(\s|$)/.test(norm)) return true;
  if (/\(calc\)/i.test(text)) return true;
  return norm.split(/\s+/).filter(Boolean).some((t) => UNIT_RE.test(t));
}

// A bare name-wrap continuation line: an all-caps word/phrase, no digits, not itself a value,
// flag, date, lab code or range/unit fragment. Real prose (footnotes, disclaimers) is mixed-case
// and gets rejected by the lowercase-letter-ratio check.
function isNameContinuationLine(text) {
  const t = text.trim();
  if (!t || t.length > 40 || /\d/.test(t)) return false;
  if (isDateOnly(t) || isLabCodeOnly(t) || isFlagOnly(t) || isQualitativeValue(t) || isUnitContinuation(t)) return false;
  if (isRangeUnitLine(t)) return false;
  const letters = t.match(/[A-Za-z]/g);
  if (!letters || !letters.length) return false;
  const lower = t.match(/[a-z]/g) || [];
  if (lower.length / letters.length > 0.3) return false;
  return true;
}

function tryParseBlock(flat, li, page) {
  let j = li + 1;
  const nameLines = [flat[li].text];
  while (nameLines.length < 3 && flat[j] && flat[j].page === page && isNameContinuationLine(flat[j].text)) {
    nameLines.push(flat[j].text);
    j++;
  }
  if (!flat[j] || flat[j].page !== page) return null;

  const valLine = flat[j].text.trim();
  const vtok = normalizeLine(valLine).match(/^([<>]=?)?(-?\d+(?:\.\d+)?)(HH|LL|H|L|A)?$/i);
  let value = null;
  let flag = null;
  let ref = null;
  let isQual = false;
  let qualText = null;
  if (vtok) {
    value = parseFloat(vtok[2]);
    flag = vtok[3] ? vtok[3].toUpperCase() : null;
    if (vtok[1]) ref = `${vtok[1]}${vtok[2]}`;
  } else if (isQualitativeValue(valLine)) {
    isQual = true;
    qualText = valLine;
  } else {
    return null;
  }
  j++;

  if (!isQual && !flag && flat[j] && flat[j].page === page && isFlagOnly(flat[j].text)) {
    flag = flat[j].text.trim().toUpperCase();
    j++;
  }

  let unit = null;
  if (flat[j] && flat[j].page === page && isRangeUnitLine(flat[j].text)) {
    const parsed = parseRangeUnitTokens(flat[j].text);
    if (parsed.ref) ref = parsed.ref;
    if (parsed.unit) unit = parsed.unit;
    j++;
    if (flat[j] && flat[j].page === page && isUnitContinuation(flat[j].text)) {
      unit = unit ? unit + flat[j].text.trim() : flat[j].text.trim();
      j++;
    }
  }

  // Previous result (bare numeric, optional flag) -- ignored.
  if (flat[j] && flat[j].page === page && PREV_RESULT_RE.test(normalizeLine(flat[j].text.trim()))) j++;
  // Previous date -- ignored.
  if (flat[j] && flat[j].page === page && isDateOnly(flat[j].text)) j++;
  // Performing-lab code -- ignored.
  if (flat[j] && flat[j].page === page && isLabCodeOnly(flat[j].text)) j++;

  return { nameLines, value, flag, ref, unit, qualitative: isQual, qualText, endIdx: j };
}

/**
 * parseLabs(pages) -> {date, lab, values, extras, qualitative, unmatched}. `pages` is
 * extractText's output shape: [{page, lines:[string]}]. Pure/synchronous; no pdf.js involved, so
 * it's directly unit-testable.
 *
 * - `values`: canonical analyte keys (see CANONICAL/ANALYTES above), US-conventional units.
 * - `extras`: recognisable name+value results that aren't one of the canonical keys, keyed by a
 *   slug of the printed name, so nothing found on the report is ever lost.
 * - `qualitative`: text-valued results (dipstick/microscopy, LDL pattern, ...), same slug keying.
 * - `unmatched`: rare leftovers (e.g. a second, differently-valued row that collided with an
 *   already-used extras slug).
 */
export function parseLabs(pages) {
  const flat = [];
  for (const p of pages) for (const line of p.lines) flat.push({ page: p.page, text: line });

  const date = findDate(flat.map((l) => l.text));
  let lab = null;
  const allText = flat.map((l) => l.text).join(" \n ");
  if (/\bQuest\b/i.test(allText)) lab = "Quest";
  else if (/\bLabcorp\b/i.test(allText)) lab = "Labcorp";

  const values = {};
  const extras = {};
  const qualitative = {};
  const unmatched = [];
  let inUrinalysis = false;

  const setExtra = (name, found, page) => {
    const key = slug(name);
    if (!key) return;
    if (!extras[key]) {
      extras[key] = { name, value: found.value, unit: found.unit || null, flag: found.flag || null, ref: found.ref || null, page };
    } else if (extras[key].value !== found.value) {
      unmatched.push({ name, value: found.value, unit: found.unit || null, page });
    }
  };
  const setQualByName = (name, text, page) => {
    const key = slug(name);
    if (key && !qualitative[key]) qualitative[key] = { name, text, page };
  };

  for (let li = 0; li < flat.length; li++) {
    const { page, text: line } = flat[li];

    const header = detectSectionHeader(line);
    if (header) { inUrinalysis = /URINALYS/i.test(header); continue; }

    if (inUrinalysis) { handleUrinalysisLine(line, page, values, qualitative); continue; }

    // A urinalysis dipstick/microscopy row (BACTERIA, KETONES, SPECIFIC GRAVITY, ...) surfacing
    // *outside* a tracked "...URINALYSIS... Collected:" section -- e.g. a report layout that
    // repeats the whole urinalysis panel under a bare section title with no "Collected:" line to
    // key off of. None of URINALYSIS_SAFE_NAMES has any serum/blood meaning, so it's always this
    // same urine test regardless of section-tracking; route it exactly like the tracked case
    // (first occurrence wins, same "urine_..." key) instead of letting it leak into `qualitative`
    // unprefixed via the generic fallback below. GLUCOSE/BILIRUBIN/PROTEIN/WBC/RBC deliberately
    // aren't in that safe list -- a numeric "GLUCOSE 91 65-99 mg/dL" here is the CMP's serum
    // glucose, not a urine dipstick "NEGATIVE", so those fall through to the ANALYTES loop instead.
    if (handleUrinalysisLine(line, page, values, qualitative, true)) continue;

    // BILIRUBIN and PROTEIN's serum canonical patterns require a "TOTAL" qualifier the urine
    // dipstick row never has, so a bare "BILIRUBIN NEGATIVE NEGATIVE" (no digit anywhere, unlike
    // the real serum result which always carries one) can only be the urine test, unambiguously,
    // even outside a tracked section.
    const qualifiedHomonym = ["BILIRUBIN", "PROTEIN"].find((n) => line.toUpperCase().startsWith(n));
    if (qualifiedHomonym) {
      const rest = line.slice(qualifiedHomonym.length).trim();
      const q = rest && findQualitativePhrase(rest);
      if (q && !extractValue(rest)) {
        const key = `urine_${slug(qualifiedHomonym)}`;
        if (!qualitative[key]) qualitative[key] = { name: qualifiedHomonym, text: q.text, page };
        continue;
      }
    }

    if (handleQualitativeNameLine(line, qualitative, page)) continue;

    // "ABSOLUTE <n> <range> <unit> ... TP" / "NEUTROPHILS" (or LYMPHOCYTES/MONOCYTES/EOSINOPHILS/
    // BASOPHILS): this report wraps the cell-type word for the 5 absolute-count differential rows
    // onto the line AFTER the data instead of before it, so the usual "name prefix, then value"
    // regex match never sees the cell type at all. Handled as a one-off before the generic
    // ANALYTES loop so that stray "NEUTROPHILS" tail is consumed here rather than being re-read on
    // its own next iteration and mistaken for the *percentage* NEUTROPHILS result.
    const absMatch = line.match(/^ABSOLUTE\s+(\S.*)$/i);
    if (absMatch) {
      const tail = flat[li + 1];
      const ABS_CELLTYPE_KEY = {
        NEUTROPHIL: "neut_abs", NEUTROPHILS: "neut_abs",
        LYMPHOCYTE: "lymph_abs", LYMPHOCYTES: "lymph_abs",
        MONOCYTE: "mono_abs", MONOCYTES: "mono_abs",
        EOSINOPHIL: "eos_abs", EOSINOPHILS: "eos_abs",
        BASOPHIL: "baso_abs", BASOPHILS: "baso_abs",
      };
      const cellKey = tail && tail.page === page ? ABS_CELLTYPE_KEY[tail.text.trim().toUpperCase()] : null;
      if (cellKey && !values[cellKey] && looksLikeDataRow(absMatch[1])) {
        const found = extractValue(absMatch[1]);
        if (found) {
          let { value, unit, flag, ref } = found;
          let nextLi = li + 2; // the data line plus its wrapped cell-type tail
          const cont = flat[nextLi];
          if (cont && cont.page === page && isUnitContinuation(cont.text)) {
            unit = unit ? unit + cont.text.trim() : cont.text.trim();
            nextLi++;
          }
          const meta = ANALYTES.find((a) => a.key === cellKey);
          values[cellKey] = { value, unit: unit || null, flag: flag || null, ref: ref || null, page, name: meta.name };
          li = nextLi - 1;
          continue;
        }
      }
    }

    let claimedByAnAnalyte = false;

    for (const a of ANALYTES) {
      if (!a.re.test(line)) continue;
      claimedByAnAnalyte = true;
      // Already have a numeric result for this key (first occurrence wins -- see the module
      // doc comment on dedup across a report's duplicated layouts): don't overwrite, but still
      // run the normal extraction below so a wrapped/block-style duplicate's own trailing lines
      // (a wrapped name's tail, a unit continuation, ...) get consumed here instead of leaking
      // out as a spurious `extras` row on the outer loop's next iteration.
      const alreadyResolved = Boolean(values[a.key]);

      const nameMatch = line.match(a.re);
      const remainder = line.slice(nameMatch[0].length).trim();
      let found = null;
      let qual = null;
      let nextLi = li + 1;

      if (remainder && looksLikeDataRow(remainder)) {
        found = extractValue(remainder);
        if (!found) {
          const q = findQualitativePhrase(remainder);
          // `a.re` only matches a short prefix ("LDL" for "LDL PATTERN A"); rebuild the full
          // printed name (name-match prefix + whatever preceded the qualitative phrase) rather
          // than mislabeling e.g. an "LDL PATTERN A" row as plain "LDL Cholesterol".
          if (q) qual = { text: q.text, label: `${nameMatch[0]} ${remainder.slice(0, q.idx)}`.replace(/\s+/g, " ").trim() };
        }
      }

      if (!found && !qual) {
        const block = tryParseBlock(flat, li, page);
        if (block) {
          nextLi = block.endIdx;
          if (block.qualitative) qual = { text: block.qualText };
          else found = { value: block.value, unit: block.unit, flag: block.flag, ref: block.ref };
        }
      }

      if (!found && !qual) {
        // Labcorp-style: the name occupied the whole line and the *entire* result (value, unit,
        // range all together) is one single line below it -- not the vertical one-field-per-line
        // block above, just a same-line row shifted down by one line.
        const next = flat[li + 1];
        if (next && next.page === page && looksLikeDataRow(next.text)) {
          found = extractValue(next.text);
          if (found) nextLi = li + 2;
          else {
            const q2 = findQualitativePhrase(next.text);
            if (q2) { qual = q2; nextLi = li + 2; }
          }
        }
      }

      if (found) {
        let { value, unit, flag, ref } = found;
        if (nextLi === li + 1) {
          // Same-line result; a bare unit-continuation fragment ("/uL", "/1.73m2") may follow on
          // its own physical line.
          const cont = flat[li + 1];
          if (cont && cont.page === page && isUnitContinuation(cont.text)) {
            unit = unit ? unit + cont.text.trim() : cont.text.trim();
            nextLi = li + 2;
          }
        }
        if (!alreadyResolved) {
          if (a.si && unit && a.si.re.test(unit)) { value = a.si.convert(value); unit = a.si.unit; }
          // eGFR's unit ("mL/min/1.73m2") sometimes wraps mid-token across a line break in a way
          // that's impossible to reassemble reliably; it's always this one fixed string in US
          // reporting, so normalize instead of guessing at the fragment.
          if (a.key === "egfr" && unit && /^mL\/min/i.test(unit)) unit = "mL/min/1.73m2";
          values[a.key] = { value, unit: unit || null, flag: flag || null, ref: ref || null, page, name: a.name };
        }
      } else if (qual && !alreadyResolved) {
        setQualByName(qual.label || a.name, qual.text, page);
      }

      li = nextLi - 1; // outer loop's li++ carries on from nextLi
      break;
    }

    if (claimedByAnAnalyte) continue;

    if (looksLikeDataRow(line)) {
      const gm = line.match(GENERIC_NAME_RE);
      if (gm) {
        const rest = line.slice(gm[1].length).trim();
        const found = extractValue(rest);
        if (found) { setExtra(gm[1].trim(), found, page); continue; }
        const q = findQualitativePhrase(rest);
        if (q) { setQualByName(gm[1].trim(), q.text, page); continue; }
      } else {
        const gq = line.match(GENERIC_QUAL_RE);
        if (gq) { setQualByName(gq[1].trim(), gq[2].toUpperCase(), page); continue; }
      }
    }

    if (isNameContinuationLine(line)) {
      const block = tryParseBlock(flat, li, page);
      if (block) {
        const fullName = block.nameLines.join(" ").replace(/,\s*$/, "");
        if (block.qualitative) setQualByName(fullName, block.qualText, page);
        else setExtra(fullName, { value: block.value, unit: block.unit, flag: block.flag, ref: block.ref }, page);
        li = block.endIdx - 1;
      }
    }
  }

  return { date, lab, values, extras, qualitative, unmatched };
}

async function toArrayBuffer(fileOrBuffer) {
  if (fileOrBuffer instanceof ArrayBuffer) return fileOrBuffer;
  if (ArrayBuffer.isView(fileOrBuffer)) return fileOrBuffer.buffer;
  if (typeof fileOrBuffer.arrayBuffer === "function") return fileOrBuffer.arrayBuffer();
  throw new TypeError("importLabPdf expects a File/Blob or an ArrayBuffer");
}

/** async importLabPdf(file|arrayBuffer) -> parseLabs(await extractText(...)). */
export async function importLabPdf(fileOrBuffer) {
  const buf = await toArrayBuffer(fileOrBuffer);
  const pages = await extractText(buf);
  return parseLabs(pages);
}
