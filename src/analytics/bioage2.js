// A second biological-age model, alongside PhenoAge (src/analytics/bioage.js): the Klemera-Doubal
// method (KDM) and, ideally, homeostatic dysregulation (HD). Both come from Levine ME, "Modeling the
// rate of senescence...", J Gerontol A Biol Sci Med Sci 2013;68(6):667-674, and are packaged for reuse
// (trained on NHANES III, projected onto later NHANES waves) by Kwon D & Belsky DW, "A toolkit for
// quantification of biological age from blood chemistry and organ function test data: BioAge",
// GeroScience 2021;43:2795-2808 (open-source R package: github.com/dayoonkwon/BioAge).
//
// KDM combines several biomarkers' own linear regressions on chronological age into one composite age.
// For each biomarker i, you first fit (in a reference/training sample): biomarker_i ~ a_i + b_i*age,
// getting a per-biomarker slope, intercept, and residual SD (s_i). KDM age is then a precision-weighted
// combination of the per-biomarker "implied ages" (age_i = (biomarker_i - a_i) / b_i), roughly:
//   KDM = [ sum_i( (biomarker_i - a_i)/b_i * b_i^2/s_i^2 ) + CA/s_BA^2 ] / [ sum_i(b_i^2/s_i^2) + 1/s_BA^2 ]
// (see Klemera P & Doubal S, Mech Ageing Dev 2006;127(3):240-248 for the derivation; s_BA and a few
// other cohort-level correction terms come out of the same fitting step). Homeostatic dysregulation is
// a Mahalanobis distance of a biomarker panel from a healthy young-adult reference sample's mean and
// covariance (Cohen AA et al., 2013).
//
// Both of those require *trained parameters specific to a reference population* (per-biomarker
// slope/intercept/residual-SD for KDM; a reference mean vector + covariance matrix for HD) -- they are
// not published formulas you can hand-code the way PhenoAge's Gompertz-model coefficients are. This
// file's kdmAge()/homeostaticDysregulation() only compute a result if real, sourced parameters are
// wired in below; otherwise they return {available: false, reason: ...} rather than guess.
//
// What was checked before concluding the parameters aren't safely obtainable here (2026-09-24):
//   - github.com/dayoonkwon/BioAge README/vignette: documents kdm_calc()'s usage and the 12-biomarker
//     default panel (albumin, alkaline phosphatase, log-CRP, total cholesterol, log-creatinine, HbA1c,
//     systolic BP, BUN, uric acid, lymphocyte %, MCV, WBC) but ships NO static coefficient table --
//     only raw NHANES III/IV survey data (NHANES3.rda, NHANES3_HDTrain.rda, NHANES4.rda) that a user
//     must run the package's own R training function (kdm_nhanes()) against to *produce* a fit.
//   - Kwon & Belsky, GeroScience 2021 (PMC8602613) main text: no coefficient table; refers to a ~4.2MB
//     supplementary PDF (11357_2021_480_MOESM1_ESM.pdf) that is gated behind a bot/proof-of-work check
//     and could not be fetched from this environment.
//   - Levine ME, J Gerontol A Biol Sci Med Sci 2013 (the original KDM-on-NHANES-III paper, which likely
//     does print a per-biomarker coefficient table): full text is paywalled (Oxford Academic); only the
//     abstract was reachable.
// Re-fitting KDM ourselves from NHANES III microdata was out of scope here (no R runtime, no NHANES
// III raw data on hand, and Pulse ships client-side JS with no build step to run that kind of offline
// training pipeline anyway). Re-implementing published coefficients from an unverified third-party
// reproduction (rather than the original paper/package) risked baking in a wrong biological age into a
// health app, which is worse than not shipping it -- so this stays a stub until real parameters can be
// sourced (e.g. by paying for full-text access to Levine 2013, or getting past the GeroScience
// supplement's bot check) and reviewed.

/** The 12-biomarker default KDM panel used by the BioAge R package, for reference/UI prompting only --
 *  Pulse doesn't have trained coefficients for it yet (see kdmAge() below). */
export const KDM_INPUTS = [
  { key: "albumin", name: "Albumin", unit: "g/dL" },
  { key: "alp", name: "Alkaline Phosphatase", unit: "U/L" },
  { key: "hscrp", name: "hs-CRP (log-transformed)", unit: "mg/L" },
  { key: "tc", name: "Total Cholesterol", unit: "mg/dL" },
  { key: "creatinine", name: "Creatinine (log-transformed)", unit: "mg/dL" },
  { key: "a1c", name: "HbA1c", unit: "%" },
  { key: "sbp", name: "Systolic Blood Pressure", unit: "mmHg" },
  { key: "bun", name: "Blood Urea Nitrogen", unit: "mg/dL" },
  { key: "uricacid", name: "Uric Acid", unit: "mg/dL" },
  { key: "lymph_pct", name: "Lymphocytes", unit: "%" },
  { key: "mcv", name: "MCV", unit: "fL" },
  { key: "wbc", name: "White Blood Cell Count", unit: "Thousand/uL" },
];

/**
 * kdmAge(values, ageYears, sex, {sbp}) -> would return {age, delta, inputs, missing, source} the way
 * phenoAge() does, computing the Klemera-Doubal biological age from KDM_INPUTS plus chronological age.
 *
 * It always returns {available: false, reason} instead: no verified, sourced set of per-biomarker
 * (slope, intercept, residual SD) trained on a reference population could be obtained in this
 * environment (see the file header for exactly what was checked). Shipping invented numbers here would
 * silently produce a wrong "biological age" -- worse than not having the feature -- so this is a
 * documented stub, not a computation, until real trained parameters are sourced and reviewed.
 */
export function kdmAge(values = {}, ageYears, sex, { sbp } = {}) {
  return {
    available: false,
    reason:
      "No verified, published set of trained per-biomarker KDM parameters (slope/intercept/residual SD, " +
      "fit on a reference population such as NHANES III) could be sourced: the BioAge R package " +
      "(github.com/dayoonkwon/BioAge) ships the raw training data and code but not a static coefficient " +
      "table; its paper's supplement was behind a bot-check page; and the original Levine 2013 paper is " +
      "paywalled. Re-deriving coefficients without one of those sources would mean guessing, which this " +
      "stub intentionally refuses to do -- see the comment at the top of bioage2.js for the full trail.",
  };
}

/**
 * homeostaticDysregulation(values, sex) -> would return a Mahalanobis-distance-based measure of how far
 * a biomarker panel sits from a healthy young-adult reference sample (Cohen AA et al., Mech Ageing Dev
 * 2013;134(3-4):110-117), as re-packaged by the same BioAge toolkit (Kwon & Belsky 2021).
 *
 * Also a documented stub: this needs an even harder-to-verify-by-hand input than KDM -- a full
 * reference mean vector *and* covariance matrix for the biomarker panel, fit on a reference population
 * -- which was not obtainable from any source reachable in this environment (see kdmAge()'s reason and
 * the file header). Returns {available: false, reason} rather than inventing a covariance matrix.
 */
export function homeostaticDysregulation(values = {}, sex) {
  return {
    available: false,
    reason:
      "Needs a reference mean vector and covariance matrix fit on a reference population (Cohen AA et " +
      "al. 2013 / BioAge package); no verifiable source for those parameters could be reached from this " +
      "environment. See bioage2.js's file header and kdmAge()'s reason for what was checked.",
  };
}
