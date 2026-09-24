/**
 * American Heart Association PREVENT cardiovascular risk equations.
 *
 * Reference (primary source):
 *   Khan SS, Coresh J, Pencina MJ, Ndumele CE, Rangaswami J, Chow SL, Palaniappan
 *   LP, Sperling LS, Virani SS, Ho JE, Neeland IJ, Lima JAC, Carnethon MR,
 *   Greenland P, Pandey A, Morris AA, Braun LT, Ballantyne CM, Khera A, Rasmussen-
 *   Torvik LJ, Deo R, Elkind MSV, Ferdinand KC, Ho FK, Alonso A, Bansal N, Loop MS,
 *   Blankstein R, Allen NB, Grandner MA, Khera R, Turkson-Ocran RA, Rosamond WD,
 *   Vasan RS. "Development and Validation of the American Heart Association's
 *   PREVENT Equations." Circulation. 2024;149(6):430-449.
 *   doi: 10.1161/CIRCULATIONAHA.123.067626
 *   Free full text (PMC10910659): https://pmc.ncbi.nlm.nih.gov/articles/PMC10910659/
 *
 * This module implements the sex-specific, race-free logistic "regression models
 * ... developed for translation and implementation" of the PREVENT survival
 * models (Supplemental Table S12, panels A-J of the paper above), which the
 * paper states are the equations "implemented on the AHA website at
 * https://professional.heart.org/prevent" (see paper, "Secondary Analyses").
 * They approximate the underlying age-as-timescale, competing-risk-adjusted
 * survival models with R^2 >= 0.99 (10-year) / >= 0.97 (30-year) against the
 * full models (paper, same paragraph) -- i.e. small (< ~0.5 percentage point)
 * deviation from the original derivation model is expected and disclosed by
 * the paper itself, especially for 30-year heart-failure risk.
 *
 * Implemented: BASE model, and the HbA1c-only ("a1c"), UACR-only ("uacr"), and
 * combined HbA1c+UACR+SDI ("full") add-on models, each for total CVD, ASCVD,
 * and heart failure, at 10- and 30-year horizons. This module has no way to
 * collect a ZIP code / Social Deprivation Index (SDI), so SDI is always treated
 * as "missing" (its own dedicated coefficient/category in the paper's model)
 * when the "full" add-on is computed; see the `full model:` warning that is
 * added whenever `full` is returned.
 *
 * VERIFICATION (two independent sources; see research/prevent_verification.md
 * for the full coefficient-by-coefficient comparison and worked-example math):
 *   1. preventr R package (Martin G. Mayer), which states in its own build
 *      script that its coefficients come "from supplemental Excel file
 *      associated with https://doi.org/10.1161/CIRCULATIONAHA.123.067626"
 *      (i.e. Table S12A-J of the paper above):
 *        https://github.com/martingmayer/preventr
 *        R/prep_data_for_use.R  (documents the Table S12A-J provenance)
 *        R/estimate_risk.R      (prep_terms()/run_models(): exact centering,
 *                                 piecewise-spline, and logistic-risk formulas)
 *        R/helpers.R            (valid/clamp ranges for each predictor)
 *        R/sysdata.rda          (the coefficient tables themselves; fetched and
 *                                 parsed with pyreadr 2026-09-24)
 *   2. The paper's own full text (PMC10910659), which independently states:
 *        - the identical centering constants: "Models centered at age 55
 *          years, non-HDLC 3.5 mmol/L, HDLC 1.3 mmol/L, SBP 130 mmHg, BMI 25
 *          kg/m2, eGFR 90 mL/min/1.73 m2, no DM, non-smoker, no medication
 *          used, SDI decile 1-3, ACR 1 mg/g, HbA1c 5.3%" (Table 3 footnote)
 *        - the identical piecewise-spline knots (SBP 110 mmHg, eGFR 60
 *          mL/min/1.73m2, BMI 30 kg/m2) and per-unit scaling (SBP /20 mmHg,
 *          eGFR /-15 mL/min/1.73m2, BMI /5 kg/m2) (Methods, "Statistical
 *          Analysis")
 *        - the exclusion/valid-range cutoffs used when the equations were
 *          derived: "SBP<90 or >200 mm Hg, TC <130 or >320 mg/dL, and HDL-C
 *          <20 or >100 mg/dL ... BMI (<18.5 or >=40.0 kg/m2)" (Methods,
 *          "Study Population")
 *        - a fully worked BASE-model example ("a 50-year old woman with ...
 *          TC of 240 mg/dL, HDL-C of 55 mg/dL, no statin use, treated SBP of
 *          160 mmHg, no diabetes, no smoking, BMI of 35 kg/m2, and eGFR 90
 *          ml/min/1.73m2") with published 10- and 30-year CVD/ASCVD/HF risks,
 *          both non-smoking and smoking, which this module reproduces (see
 *          test/prevent.test.js and research/prevent_verification.md).
 *
 *   Table 2 of the paper (original derivation-sample hazard ratios, i.e.
 *   exp(beta) of the *non-approximated* Cox model) was also spot-checked as a
 *   directional sanity check: exponentiating the Table S12 base-model
 *   coefficients below reproduces Table 2's published hazard ratios to within
 *   the paper's own rounding for most terms, with the small remaining gaps
 *   explained by Table S12 being a separate least-squares approximation of the
 *   underlying model rather than the derivation-sample Cox coefficients
 *   themselves (see research/prevent_verification.md).
 *
 *   One discrepancy between the two sources: preventr's own input-validation
 *   range for SBP is [90, 180], narrower than the paper's own stated
 *   derivation-sample exclusion cutoff of (90, 200). Per the paper being the
 *   authoritative source, this module clamps SBP to the paper's [90, 200].
 *   eGFR/HbA1c/UACR valid ranges are not stated explicitly in the paper's main
 *   text, so this module uses preventr's ranges for those three (single-sourced;
 *   documented in research/prevent_verification.md).
 *
 * @module analytics/prevent
 */

// mg/dL -> mmol/L for cholesterol (standard clinical factor; preventr uses the
// same 0.02586 multiplier, equivalent to the paper's "divide by 38.67").
const MGDL_TO_MMOL_CHOL = 0.02586;

// Predictor valid/clamp ranges. TC, HDL, SBP, BMI ranges are the paper's own
// stated derivation-sample exclusion cutoffs (Methods, "Study Population");
// eGFR/HbA1c/UACR ranges are preventr's operational ranges (see module doc).
const VALID_RANGES = {
  totalChol: { lo: 130, hi: 320, label: "total cholesterol", unit: "mg/dL" },
  hdl: { lo: 20, hi: 100, label: "HDL cholesterol", unit: "mg/dL" },
  sbp: { lo: 90, hi: 200, label: "systolic blood pressure", unit: "mmHg" },
  bmi: { lo: 18.5, hi: 39.9, label: "BMI", unit: "kg/m2" },
  egfr: { lo: 15, hi: 140, label: "eGFR", unit: "mL/min/1.73m2" },
  hba1c: { lo: 4.5, hi: 15, label: "HbA1c", unit: "%" },
  uacr: { lo: 0.1, hi: 25000, label: "UACR", unit: "mg/g" },
};

const AGE_RANGE = { lo: 30, hi: 79 };

// ---- Coefficient tables -----------------------------------------------
// Source: preventr R package sysdata.rda (from the paper's Supplemental Table
// S12A-J), verified against the paper's stated centering/spline structure.
// See module doc and research/prevent_verification.md.
const TABLES = {
  base_10yr: {
    terms: ["age", "non_hdl_c", "hdl_c", "sbp_lt_110", "sbp_gte_110", "dm", "smoking", "bmi_lt_30", "bmi_gte_30", "egfr_lt_60", "egfr_gte_60", "bp_tx", "statin", "bp_tx_sbp_gte_110", "statin_non_hdl_c", "age_non_hdl_c", "age_hdl_c", "age_sbp_gte_110", "age_dm", "age_smoking", "age_bmi_gte_30", "age_egfr_lt_60", "constant"],
    coef: {
      female: {
        cvd: [0.7939329, 0.0305239, -0.1606857, -0.2394003, 0.3600781, 0.8667604, 0.5360739, 0, 0, 0.6045917, 0.0433769, 0.3151672, -0.1477655, -0.0663612, 0.1197879, -0.0819715, 0.0306769, -0.0946348, -0.27057, -0.078715, 0, -0.1637806, -3.307728],
        ascvd: [0.719883, 0.1176967, -0.151185, -0.0835358, 0.3592852, 0.8348585, 0.4831078, 0, 0, 0.4864619, 0.0397779, 0.2265309, -0.0592374, -0.0395762, 0.0844423, -0.0567839, 0.0325692, -0.1035985, -0.2417542, -0.0791142, 0, -0.1671492, -3.819975],
        hf: [0.8998235, 0, 0, -0.4559771, 0.3576505, 1.038346, 0.583916, -0.0072294, 0.2997706, 0.7451638, 0.0557087, 0.3534442, 0, -0.0981511, 0, 0, 0, -0.0946663, -0.3581041, -0.1159453, -0.003878, -0.1884289, -4.310409],
      },
      male: {
        cvd: [0.7688528, 0.0736174, -0.0954431, -0.4347345, 0.3362658, 0.7692857, 0.4386871, 0, 0, 0.5378979, 0.0164827, 0.288879, -0.1337349, -0.0475924, 0.150273, -0.0517874, 0.0191169, -0.1049477, -0.2251948, -0.0895067, 0, -0.1543702, -3.031168],
        ascvd: [0.7099847, 0.1658663, -0.1144285, -0.2837212, 0.3239977, 0.7189597, 0.3956973, 0, 0, 0.3690075, 0.0203619, 0.2036522, -0.0865581, -0.0322916, 0.114563, -0.0300005, 0.0232747, -0.0927024, -0.2018525, -0.0970527, 0, -0.1217081, -3.500655],
        hf: [0.8972642, 0, 0, -0.6811466, 0.3634461, 0.923776, 0.5023736, -0.0485841, 0.3726929, 0.6926917, 0.0251827, 0.2980922, 0, -0.0497731, 0, 0, 0, -0.1289201, -0.3040924, -0.1401688, 0.0068126, -0.1797778, -3.946391],
      },
    },
  },
  base_30yr: {
    terms: ["age", "age_squared", "non_hdl_c", "hdl_c", "sbp_lt_110", "sbp_gte_110", "dm", "smoking", "bmi_lt_30", "bmi_gte_30", "egfr_lt_60", "egfr_gte_60", "bp_tx", "statin", "bp_tx_sbp_gte_110", "statin_non_hdl_c", "age_non_hdl_c", "age_hdl_c", "age_sbp_gte_110", "age_dm", "age_smoking", "age_bmi_gte_30", "age_egfr_lt_60", "constant"],
    coef: {
      female: {
        cvd: [0.5503079, -0.0928369, 0.0409794, -0.1663306, -0.1628654, 0.3299505, 0.6793894, 0.3196112, 0, 0, 0.1857101, 0.0553528, 0.2894, -0.075688, -0.056367, 0.1071019, -0.0751438, 0.0301786, -0.0998776, -0.3206166, -0.1607862, 0, -0.1450788, -1.318827],
        ascvd: [0.4669202, -0.0893118, 0.1256901, -0.1542255, -0.0018093, 0.322949, 0.6296707, 0.268292, 0, 0, 0.100106, 0.0499663, 0.1875292, 0.0152476, -0.0276123, 0.0736147, -0.0521962, 0.0316918, -0.1046101, -0.2727793, -0.1530907, 0, -0.1299149, -1.974074],
        hf: [0.6254374, -0.0983038, 0, 0, -0.3919241, 0.3142295, 0.8330787, 0.3438651, 0.0594874, 0.2525536, 0.2981642, 0.0667159, 0.333921, 0, -0.0893177, 0, 0, 0, -0.0974299, -0.404855, -0.1982991, -0.0035619, -0.1564215, -2.205379],
      },
      male: {
        cvd: [0.4627309, -0.0984281, 0.0836088, -0.1029824, -0.2140352, 0.2904325, 0.5331276, 0.2141914, 0, 0, 0.1155556, 0.0603775, 0.232714, -0.0272112, -0.0384488, 0.134192, -0.0511759, 0.0165865, -0.1101437, -0.2585943, -0.1566406, 0, -0.1166776, -1.148204],
        ascvd: [0.3994099, -0.0937484, 0.1744643, -0.120203, -0.0665117, 0.2753037, 0.4790257, 0.1782635, 0, 0, -0.0218789, 0.0602553, 0.1421182, 0.0135996, -0.0218265, 0.1013148, -0.0312619, 0.020673, -0.0920935, -0.2159947, -0.1548811, 0, -0.0712547, -1.736444],
        hf: [0.5681541, -0.1048388, 0, 0, -0.4761564, 0.30324, 0.6840338, 0.2656273, 0.0833107, 0.26999, 0.2541805, 0.0638923, 0.2583631, 0, -0.0391938, 0, 0, 0, -0.1269124, -0.3273572, -0.2043019, -0.0182831, -0.1342618, -1.95751],
      },
    },
  },
  hba1c_10yr: {
    terms: ["age", "non_hdl_c", "hdl_c", "sbp_lt_110", "sbp_gte_110", "dm", "smoking", "bmi_lt_30", "bmi_gte_30", "egfr_lt_60", "egfr_gte_60", "bp_tx", "statin", "bp_tx_sbp_gte_110", "statin_non_hdl_c", "age_non_hdl_c", "age_hdl_c", "age_sbp_gte_110", "age_dm", "age_smoking", "age_bmi_gte_30", "age_egfr_lt_60", "hba1c_dm", "hba1c_no_dm", "missing_hba1c", "constant"],
    coef: {
      female: {
        cvd: [0.7858178, 0.0194438, -0.1521964, -0.2296681, 0.3465777, 0.5366241, 0.5411682, 0, 0, 0.5931898, 0.0472458, 0.3158567, -0.1535174, -0.0687752, 0.1054746, -0.0761119, 0.0307469, -0.0905966, -0.2241857, -0.080186, 0, -0.1667286, 0.1338348, 0.1622409, -0.0142496, -3.306162],
        ascvd: [0.7111831, 0.106797, -0.1425745, -0.0736824, 0.3480844, 0.5112951, 0.4880292, 0, 0, 0.4754997, 0.0438132, 0.2259093, -0.0648872, -0.0437645, 0.0697082, -0.0506382, 0.0327475, -0.0996442, -0.1924338, -0.0803539, 0, -0.1682586, 0.1339055, 0.1596461, 0.0015678, -3.838746],
        hf: [0.8997391, 0, 0, -0.4422749, 0.3378691, 0.681284, 0.5886005, -0.0148657, 0.2958374, 0.73447, 0.05926, 0.3543475, 0, -0.1002139, 0, 0, 0, -0.0878765, -0.303684, -0.1178943, -0.008345, -0.1912183, 0.1856442, 0.1833083, -0.0143112, -4.288225],
      },
      male: {
        cvd: [0.7699177, 0.0605093, -0.0888525, -0.417713, 0.3288657, 0.4759471, 0.4385663, 0, 0, 0.5334616, 0.0206431, 0.2917524, -0.1383313, -0.0482622, 0.1393796, -0.0463501, 0.0205926, -0.1037717, -0.1737697, -0.0915839, 0, -0.1637039, 0.13159, 0.1295185, -0.0128373, -3.040901],
        ascvd: [0.7064146, 0.1532267, -0.1082166, -0.2675288, 0.3173809, 0.432604, 0.3958842, 0, 0, 0.3665014, 0.0250243, 0.2061158, -0.0899988, -0.0334959, 0.1034168, -0.0255406, 0.0247538, -0.0917441, -0.1499195, -0.098089, 0, -0.1305231, 0.1157161, 0.1288303, -0.0010001, -3.51835],
        hf: [0.911787, 0, 0, -0.6568071, 0.3524645, 0.5849752, 0.5014014, -0.0512352, 0.365294, 0.6892219, 0.0292377, 0.3038296, 0, -0.0515032, 0, 0, 0, -0.1262343, -0.2449514, -0.1392217, 0.0009592, -0.1917105, 0.1652857, 0.1505859, -0.0113444, -3.961954],
      },
    },
  },
  hba1c_30yr: {
    terms: ["age", "age_squared", "non_hdl_c", "hdl_c", "sbp_lt_110", "sbp_gte_110", "dm", "smoking", "bmi_lt_30", "bmi_gte_30", "egfr_lt_60", "egfr_gte_60", "bp_tx", "statin", "bp_tx_sbp_gte_110", "statin_non_hdl_c", "age_non_hdl_c", "age_hdl_c", "age_sbp_gte_110", "age_dm", "age_smoking", "age_bmi_gte_30", "age_egfr_lt_60", "hba1c_dm", "hba1c_no_dm", "missing_hba1c", "constant"],
    coef: {
      female: {
        cvd: [0.5343493, -0.0952314, 0.0298124, -0.1578451, -0.1504488, 0.3173368, 0.4314738, 0.3209399, 0, 0, 0.1771435, 0.0582828, 0.2888947, -0.0795886, -0.0600438, 0.0920598, -0.0696108, 0.0308807, -0.0954051, -0.2763408, -0.1623944, 0, -0.1430514, 0.0940543, 0.1116486, -0.0024798, -1.341059],
        ascvd: [0.4555574, -0.0903501, 0.1148321, -0.1458754, 0.0089323, 0.3139029, 0.386281, 0.2714309, 0, 0, 0.0930987, 0.0532216, 0.1862181, 0.0106964, -0.0329713, 0.0583609, -0.0463273, 0.0324717, -0.1004777, -0.2266944, -0.1541859, 0, -0.1286005, 0.0875827, 0.1126417, 0.0124356, -2.011533],
        hf: [0.6210856, -0.1000972, 0, 0, -0.3773697, 0.295316, 0.5681692, 0.3449139, 0.0540094, 0.249767, 0.2875781, 0.0692013, 0.3334936, 0, -0.0922339, 0, 0, 0, -0.0907885, -0.3554646, -0.2008846, -0.0079611, -0.156803, 0.1448336, 0.1277838, -0.0022589, -2.193553],
      },
      male: {
        cvd: [0.4519873, -0.101624, 0.0700456, -0.0968005, -0.1923527, 0.2827043, 0.3417152, 0.2105272, 0, 0, 0.1113291, 0.0640135, 0.2334248, -0.0299421, -0.0393204, 0.1228854, -0.0463737, 0.0184599, -0.1085744, -0.2208049, -0.1577978, 0, -0.1179375, 0.0768169, 0.0777295, 0.0092204, -1.180767],
        ascvd: [0.3883267, -0.0958114, 0.1613374, -0.1144418, -0.0474338, 0.2691281, 0.2859773, 0.1759553, 0, 0, -0.0242898, 0.0644523, 0.142874, 0.0115062, -0.02333, 0.0899664, -0.0275478, 0.022573, -0.090802, -0.1771894, -0.1548847, 0, -0.0732754, 0.0591089, 0.0821158, 0.0179755, -1.777708],
        hf: [0.5703729, -0.1084544, 0, 0, -0.4471767, 0.2910152, 0.4507242, 0.259585, 0.0850676, 0.2637222, 0.2454706, 0.0675649, 0.2611991, 0, -0.0408908, 0, 0, 0, -0.1241051, -0.2849461, -0.2032308, -0.0239714, -0.138301, 0.1101184, 0.0949198, 0.0084192, -1.974999],
      },
    },
  },
  uacr_10yr: {
    terms: ["age", "non_hdl_c", "hdl_c", "sbp_lt_110", "sbp_gte_110", "dm", "smoking", "bmi_lt_30", "bmi_gte_30", "egfr_lt_60", "egfr_gte_60", "bp_tx", "statin", "bp_tx_sbp_gte_110", "statin_non_hdl_c", "age_non_hdl_c", "age_hdl_c", "age_sbp_gte_110", "age_dm", "age_smoking", "age_bmi_gte_30", "age_egfr_lt_60", "ln_uacr", "missing_uacr", "constant"],
    coef: {
      female: {
        cvd: [0.7969249, 0.0256635, -0.1588107, -0.2255701, 0.3396649, 0.8047515, 0.5285338, 0, 0, 0.4803511, 0.0434472, 0.2985207, -0.1497787, -0.0742889, 0.106756, -0.0778126, 0.0306768, -0.0907168, -0.2705122, -0.0830564, 0, -0.1389249, 0.1793037, 0.0132073, -3.738341],
        ascvd: [0.7201999, 0.1135771, -0.1493506, -0.0726677, 0.3436259, 0.7773094, 0.4746662, 0, 0, 0.3824646, 0.0394178, 0.2125182, -0.0603046, -0.0466053, 0.0733118, -0.0534262, 0.0325689, -0.0999887, -0.2411762, -0.0826941, 0, -0.1444737, 0.1501217, 0.0050257, -4.174614],
        hf: [0.9145975, 0, 0, -0.4441346, 0.3260323, 0.9611365, 0.5755787, 0.0008831, 0.2988964, 0.5915291, 0.0556823, 0.3314097, 0, -0.1078596, 0, 0, 0, -0.0875231, -0.356859, -0.1220248, -0.0053637, -0.1610389, 0.2197281, 0.0326667, -4.841506],
      },
      male: {
        cvd: [0.7768655, 0.0659949, -0.0951111, -0.420667, 0.3120151, 0.698521, 0.4314669, 0, 0, 0.3841364, 0.009384, 0.2676494, -0.1390966, -0.0579315, 0.1383719, -0.0488332, 0.0200406, -0.102454, -0.2236355, -0.089485, 0, -0.1321848, 0.1887974, 0.0916979, -3.510705],
        ascvd: [0.7141718, 0.1602194, -0.1139086, -0.2719456, 0.3058719, 0.6600631, 0.3884022, 0, 0, 0.2466316, 0.0151852, 0.186167, -0.0894395, -0.0411884, 0.1058212, -0.028089, 0.0240427, -0.0912325, -0.2004894, -0.096936, 0, -0.1022867, 0.1510073, 0.0556, -3.85146],
        hf: [0.9111795, 0, 0, -0.6693649, 0.3290082, 0.8377655, 0.4978917, -0.042749, 0.3624165, 0.5075796, 0.0137716, 0.2739963, 0, -0.0645712, 0, 0, 0, -0.1230039, -0.3013297, -0.1410318, 0.0021531, -0.1548018, 0.2306299, 0.1472194, -4.556907],
      },
    },
  },
  uacr_30yr: {
    terms: ["age", "age_squared", "non_hdl_c", "hdl_c", "sbp_lt_110", "sbp_gte_110", "dm", "smoking", "bmi_lt_30", "bmi_gte_30", "egfr_lt_60", "egfr_gte_60", "bp_tx", "statin", "bp_tx_sbp_gte_110", "statin_non_hdl_c", "age_non_hdl_c", "age_hdl_c", "age_sbp_gte_110", "age_dm", "age_smoking", "age_bmi_gte_30", "age_egfr_lt_60", "ln_uacr", "missing_uacr", "constant"],
    coef: {
      female: {
        cvd: [0.5491768, -0.0937311, 0.0359847, -0.1642965, -0.1483404, 0.313353, 0.6253766, 0.3147172, 0, 0, 0.1094663, 0.0550705, 0.2782433, -0.0786239, -0.0628947, 0.093204, -0.0710685, 0.0306363, -0.0951455, -0.3168231, -0.1636391, 0, -0.1265483, 0.1142251, -0.0055863, -1.583738],
        ascvd: [0.4629669, -0.0902777, 0.1215214, -0.1522069, 0.0092679, 0.3113609, 0.581256, 0.263167, 0, 0, 0.0391726, 0.0492959, 0.1786178, 0.0131058, -0.0325135, 0.0617093, -0.0489189, 0.0321079, -0.1003185, -0.2684574, -0.1547301, 0, -0.1130703, 0.0903471, -0.0145818, -2.178888],
        hf: [0.6319513, -0.1009284, 0, 0, -0.3787175, 0.2863393, 0.7631221, 0.3355843, 0.0677084, 0.2517238, 0.1940067, 0.0664006, 0.3171436, 0, -0.0970661, 0, 0, 0, -0.0896239, -0.400743, -0.2042041, -0.0054699, -0.13602, 0.1486028, 0.011608, -2.538952],
      },
      male: {
        cvd: [0.464491, -0.0998895, 0.0757606, -0.1031778, -0.1990714, 0.2715816, 0.4754637, 0.2069672, 0, 0, 0.0331103, 0.0540474, 0.2189911, -0.0331044, -0.04534, 0.1214535, -0.0483995, 0.0178997, -0.1059324, -0.2492861, -0.1561543, 0, -0.1012429, 0.1007571, 0.0572456, -1.398727],
        ascvd: [0.3995607, -0.094557, 0.1686692, -0.1202145, -0.0555561, 0.2633566, 0.4362036, 0.1716233, 0, 0, -0.0775282, 0.0561236, 0.1319331, 0.0102428, -0.0269294, 0.0920557, -0.0297021, 0.0217935, -0.0893347, -0.2081467, -0.1542716, 0, -0.0597254, 0.0684872, 0.0193962, -1.873449],
        hf: [0.5750236, -0.1062268, 0, 0, -0.4633994, 0.2742874, 0.612208, 0.2614987, 0.0895459, 0.2632424, 0.1430472, 0.0535184, 0.2417468, 0, -0.0498574, 0, 0, 0, -0.1193827, -0.316651, -0.2046122, -0.0216878, -0.1165637, 0.1366452, 0.1078355, -2.314872],
      },
    },
  },
  full_10yr: {
    terms: ["age", "non_hdl_c", "hdl_c", "sbp_lt_110", "sbp_gte_110", "dm", "smoking", "bmi_lt_30", "bmi_gte_30", "egfr_lt_60", "egfr_gte_60", "bp_tx", "statin", "bp_tx_sbp_gte_110", "statin_non_hdl_c", "age_non_hdl_c", "age_hdl_c", "age_sbp_gte_110", "age_dm", "age_smoking", "age_bmi_gte_30", "age_egfr_lt_60", "sdi_4_to_6", "sdi_7_to_10", "missing_sdi", "ln_uacr", "missing_uacr", "hba1c_dm", "hba1c_no_dm", "missing_hba1c", "constant"],
    coef: {
      female: {
        cvd: [0.7716794, 0.0062109, -0.1547756, -0.1933123, 0.3071217, 0.496753, 0.466605, 0, 0, 0.4780697, 0.0529077, 0.3034892, -0.1556524, -0.0667026, 0.1061825, -0.0742271, 0.0288245, -0.0875188, -0.2267102, -0.0676125, 0, -0.1493231, 0.1361989, 0.2261596, 0.1804508, 0.1645922, 0.0198413, 0.1298513, 0.1412555, -0.0031658, -3.860385],
        ascvd: [0.7023067, 0.0898765, -0.1407316, -0.0256648, 0.314511, 0.4799217, 0.4062049, 0, 0, 0.3847744, 0.0495174, 0.2133861, -0.0678552, -0.0451416, 0.0788187, -0.0535985, 0.0291762, -0.0961839, -0.2001466, -0.0586472, 0, -0.1537791, 0.1413965, 0.228136, 0.1588908, 0.1371824, 0.0061613, 0.123192, 0.1410572, 0.005866, -4.291503],
        hf: [0.884209, 0, 0, -0.421474, 0.3002919, 0.6170359, 0.5380269, -0.0191335, 0.2764302, 0.5975847, 0.0654197, 0.3313614, 0, -0.1002304, 0, 0, 0, -0.0845363, -0.2989062, -0.1111354, 0.0008104, -0.1666635, 0.1213034, 0.2314147, 0.1819138, 0.1948135, 0.0395368, 0.176668, 0.1614911, -0.0010583, -4.896524],
      },
      male: {
        cvd: [0.7847578, 0.0534485, -0.0911282, -0.4921973, 0.2972415, 0.4527054, 0.3726641, 0, 0, 0.3886854, 0.0081661, 0.2508052, -0.1538484, -0.0474695, 0.1415382, -0.0436455, 0.0199549, -0.1022686, -0.1762507, -0.0715873, 0, -0.1428668, 0.0802431, 0.275073, 0.144759, 0.1772853, 0.1095674, 0.1165698, 0.1048297, -0.0230072, -3.631387],
        ascvd: [0.7128741, 0.1465201, -0.1125794, -0.3387216, 0.2980252, 0.399583, 0.3379111, 0, 0, 0.2582604, 0.0147769, 0.1686621, -0.1073619, -0.0381038, 0.1034169, -0.0228755, 0.0267453, -0.0897449, -0.1497464, -0.077206, 0, -0.1198368, 0.0651121, 0.2676683, 0.1388492, 0.1375837, 0.0652944, 0.101282, 0.1092726, -0.0112852, -3.969788],
        hf: [0.9095703, 0, 0, -0.6765184, 0.3111651, 0.5535052, 0.4326811, -0.0854286, 0.3551736, 0.5102245, 0.015472, 0.2570964, 0, -0.0591177, 0, 0, 0, -0.1219056, -0.2437577, -0.105363, 0.0037907, -0.1660207, 0.1106372, 0.3371204, 0.1694628, 0.2164607, 0.1702805, 0.148297, 0.1234088, -0.0234637, -4.663513],
      },
    },
  },
  full_30yr: {
    terms: ["age", "age_squared", "non_hdl_c", "hdl_c", "sbp_lt_110", "sbp_gte_110", "dm", "smoking", "bmi_lt_30", "bmi_gte_30", "egfr_lt_60", "egfr_gte_60", "bp_tx", "statin", "bp_tx_sbp_gte_110", "statin_non_hdl_c", "age_non_hdl_c", "age_hdl_c", "age_sbp_gte_110", "age_dm", "age_smoking", "age_bmi_gte_30", "age_egfr_lt_60", "sdi_4_to_6", "sdi_7_to_10", "missing_sdi", "ln_uacr", "missing_uacr", "hba1c_dm", "hba1c_no_dm", "missing_hba1c", "constant"],
    coef: {
      female: {
        cvd: [0.5073749, -0.0981751, 0.0162303, -0.1617147, -0.1111241, 0.282946, 0.4004069, 0.2918701, 0, 0, 0.1017102, 0.0622643, 0.2872416, -0.0768135, -0.0557282, 0.0917585, -0.0679131, 0.029076, -0.0907755, -0.2702118, -0.1373216, 0, -0.1255864, 0.1067741, 0.1853138, 0.1567115, 0.1028065, -0.0006181, 0.0925285, 0.0975598, 0.0101713, -1.748475],
        ascvd: [0.4386739, -0.0921956, 0.0977728, -0.1453525, 0.0590925, 0.2862862, 0.3669136, 0.2354695, 0, 0, 0.0354338, 0.0573093, 0.1840085, 0.0117504, -0.0331945, 0.0664311, -0.0492826, 0.0288888, -0.0964709, -0.2279648, -0.120405, 0, -0.1157635, 0.1107632, 0.1840367, 0.1308962, 0.0810739, -0.0147785, 0.0794709, 0.1002615, 0.017301, -2.314066],
        hf: [0.5927507, -0.1028754, 0, 0, -0.3593781, 0.2628556, 0.5113472, 0.347344, 0.0564656, 0.2363857, 0.1971295, 0.0735227, 0.3219386, 0, -0.0880321, 0, 0, 0, -0.0863132, -0.3425359, -0.181405, 0.0031285, -0.1356989, 0.0847634, 0.18397, 0.1485802, 0.1273306, 0.0167008, 0.1378342, 0.1138832, 0.0138979, -2.642208],
      },
      male: {
        cvd: [0.4427595, -0.1064108, 0.0629381, -0.1015427, -0.2542326, 0.2549679, 0.333835, 0.1873833, 0, 0, 0.0246102, 0.0552014, 0.1979729, -0.0407714, -0.0365522, 0.1232822, -0.0441334, 0.0177865, -0.1046657, -0.2116113, -0.1277905, 0, -0.0955922, 0.0256704, 0.1887637, 0.089241, 0.0894596, 0.0710124, 0.0676202, 0.063409, 0.0038783, -1.504558],
        ascvd: [0.3743566, -0.0995499, 0.1544808, -0.1215297, -0.1083968, 0.2555179, 0.2696998, 0.1628432, 0, 0, -0.077507, 0.0583407, 0.1120322, -0.0025063, -0.0256116, 0.0886745, -0.0254507, 0.0244639, -0.0869146, -0.165745, -0.1244714, 0, -0.0624552, 0.015675, 0.1864231, 0.0845697, 0.0560171, 0.0252244, 0.0501422, 0.0722905, 0.0114945, -1.985368],
        hf: [0.5478829, -0.1111928, 0, 0, -0.4547346, 0.2527602, 0.4385384, 0.2397952, 0.0640931, 0.2643081, 0.1354588, 0.0570689, 0.220666, 0, -0.0436769, 0, 0, 0, -0.1168376, -0.2730055, -0.1573691, -0.0174998, -0.1128676, 0.057746, 0.2446441, 0.1076782, 0.1233486, 0.1274796, 0.0985062, 0.0804844, 0.0022806, -2.425439],
      },
    },
  },
};

const MODELS = {
  base: { 10: TABLES.base_10yr, 30: TABLES.base_30yr },
  a1c: { 10: TABLES.hba1c_10yr, 30: TABLES.hba1c_30yr },
  uacr: { 10: TABLES.uacr_10yr, 30: TABLES.uacr_30yr },
  full: { 10: TABLES.full_10yr, 30: TABLES.full_30yr },
};

// ---- Helpers ------------------------------------------------------------

function normalizeSex(sex) {
  if (typeof sex !== "string") return null;
  const v = sex.trim().toLowerCase();
  if (v === "male" || v === "m") return "male";
  if (v === "female" || v === "f") return "female";
  return null;
}

function isFiniteNumber(x) {
  return typeof x === "number" && Number.isFinite(x);
}

/** Clamps `value` into [lo, hi], pushing a warning onto `warnings` if it had to. */
function clampWarn(value, range, warnings) {
  const { lo, hi, label, unit } = range;
  if (value < lo) {
    warnings.push(`${label} ${value} ${unit} is below PREVENT's valid range [${lo}, ${hi}]; clamped to ${lo}.`);
    return lo;
  }
  if (value > hi) {
    warnings.push(`${label} ${value} ${unit} is above PREVENT's valid range [${lo}, ${hi}]; clamped to ${hi}.`);
    return hi;
  }
  return value;
}

function boolField(input, key, warnings) {
  const v = input[key];
  if (v === undefined || v === null) {
    warnings.push(`${key} not provided; assumed false.`);
    return false;
  }
  return Boolean(v);
}

/**
 * Builds the full predictor-term vector (paper's exact centering/spline
 * transforms; see preventr's `prep_terms()` and the module doc above).
 * `v` holds already-validated/clamped numeric and boolean fields, plus
 * optional `hba1c`/`uacr` (numbers, already clamped, or `undefined`).
 */
function buildTerms(v) {
  const age = (v.age - 55) / 10;
  const nonHdlC = (v.totalChol - v.hdl) * MGDL_TO_MMOL_CHOL - 3.5;
  const hdlC = (v.hdl * MGDL_TO_MMOL_CHOL - 1.3) / 0.3;
  const sbpLt110 = (Math.min(v.sbp, 110) - 110) / 20;
  const sbpGte110 = (Math.max(v.sbp, 110) - 130) / 20;
  const dm = v.diabetes ? 1 : 0;
  const smoking = v.smoker ? 1 : 0;
  const bmiLt30 = (Math.min(v.bmi, 30) - 25) / 5;
  const bmiGte30 = (Math.max(v.bmi, 30) - 30) / 5;
  const egfrLt60 = (Math.min(v.egfr, 60) - 60) / -15;
  const egfrGte60 = (Math.max(v.egfr, 60) - 90) / -15;
  const bpTx = v.bpTreatment ? 1 : 0;
  const statin = v.statin ? 1 : 0;
  const hasHba1c = isFiniteNumber(v.hba1c);
  const hasUacr = isFiniteNumber(v.uacr);

  return {
    age,
    age_squared: age * age,
    non_hdl_c: nonHdlC,
    hdl_c: hdlC,
    sbp_lt_110: sbpLt110,
    sbp_gte_110: sbpGte110,
    dm,
    smoking,
    bmi_lt_30: bmiLt30,
    bmi_gte_30: bmiGte30,
    egfr_lt_60: egfrLt60,
    egfr_gte_60: egfrGte60,
    bp_tx: bpTx,
    statin,
    bp_tx_sbp_gte_110: bpTx * sbpGte110,
    statin_non_hdl_c: statin * nonHdlC,
    age_non_hdl_c: age * nonHdlC,
    age_hdl_c: age * hdlC,
    age_sbp_gte_110: age * sbpGte110,
    age_dm: age * dm,
    age_smoking: age * smoking,
    age_bmi_gte_30: age * bmiGte30,
    age_egfr_lt_60: age * egfrLt60,
    hba1c_dm: hasHba1c && dm === 1 ? v.hba1c - 5.3 : 0,
    hba1c_no_dm: hasHba1c && dm === 0 ? v.hba1c - 5.3 : 0,
    missing_hba1c: hasHba1c ? 0 : 1,
    ln_uacr: hasUacr ? Math.log(v.uacr) : 0,
    missing_uacr: hasUacr ? 0 : 1,
    // No ZIP/SDI input is collected by this module, so SDI is always "missing".
    sdi_4_to_6: 0,
    sdi_7_to_10: 0,
    missing_sdi: 1,
    constant: 1,
  };
}

/** Dot product of `terms` against one outcome's coefficient row, as a probability. */
function riskFromTable(terms, table, sex, outcome) {
  const coefs = table.coef[sex][outcome];
  const keys = table.terms;
  let z = 0;
  for (let i = 0; i < keys.length; i++) z += terms[keys[i]] * coefs[i];
  // Logistic sigmoid, written as 1 / (1 + exp(-z)) for numerical stability
  // (equivalent to the paper's/preventr's exp(z) / (1 + exp(z))).
  return 1 / (1 + Math.exp(-z));
}

function runModel(modelTables, sex, terms) {
  return {
    cvd10: riskFromTable(terms, modelTables[10], sex, "cvd"),
    ascvd10: riskFromTable(terms, modelTables[10], sex, "ascvd"),
    hf10: riskFromTable(terms, modelTables[10], sex, "hf"),
    cvd30: riskFromTable(terms, modelTables[30], sex, "cvd"),
    ascvd30: riskFromTable(terms, modelTables[30], sex, "ascvd"),
    hf30: riskFromTable(terms, modelTables[30], sex, "hf"),
  };
}

// ---- Public API -----------------------------------------------------------

/**
 * Computes AHA PREVENT 10- and 30-year risk of total CVD, ASCVD, and heart
 * failure for one person.
 *
 * @param {object} input
 * @param {number} input.age Age in years; must be 30-79 (PREVENT's validated range).
 * @param {"male"|"female"} input.sex
 * @param {number} input.totalChol Total cholesterol, mg/dL. Clamped to [130, 320].
 * @param {number} input.hdl HDL cholesterol, mg/dL. Clamped to [20, 100].
 * @param {number} input.sbp Systolic blood pressure, mmHg. Clamped to [90, 200].
 * @param {number} input.bmi Body mass index, kg/m^2. Clamped to [18.5, 39.9].
 * @param {number} input.egfr eGFR, mL/min/1.73m^2. Clamped to [15, 140].
 * @param {boolean} input.diabetes
 * @param {boolean} input.smoker Current smoking.
 * @param {boolean} input.bpTreatment On blood-pressure-lowering medication.
 * @param {boolean} input.statin On a statin.
 * @param {number} [input.hba1c] HbA1c, %. Optional; enables the "a1c" and
 *   contributes to the "full" model. Clamped to [4.5, 15] if given.
 * @param {number} [input.uacr] Urine albumin-to-creatinine ratio, mg/g.
 *   Optional; enables the "uacr" and contributes to the "full" model. Clamped
 *   to [0.1, 25000] if given.
 * @returns {{
 *   base: {cvd10:number, ascvd10:number, hf10:number, cvd30:number, ascvd30:number, hf30:number} | null,
 *   a1c?: {cvd10:number, ascvd10:number, hf10:number, cvd30:number, ascvd30:number, hf30:number},
 *   uacr?: {cvd10:number, ascvd10:number, hf10:number, cvd30:number, ascvd30:number, hf30:number},
 *   full?: {cvd10:number, ascvd10:number, hf10:number, cvd30:number, ascvd30:number, hf30:number},
 *   warnings: string[],
 * }} Risks are fractions in [0, 1] (multiply by 100 for a percentage). If
 *   `age` or `sex` is missing/invalid, or a required continuous predictor is
 *   missing/non-numeric, `base` (and `a1c`/`uacr`/`full`) are `null` and
 *   `warnings[0]` explains why (this is the "return null with a reason"
 *   behavior for un-computable input). `a1c`/`uacr` are only present when the
 *   corresponding optional lab value was supplied; `full` is present when
 *   either was supplied (SDI is always treated as "missing" -- see module doc).
 */
export function prevent(input = {}) {
  const warnings = [];

  const age = input.age;
  if (!isFiniteNumber(age) || age < AGE_RANGE.lo || age > AGE_RANGE.hi) {
    return {
      base: null,
      warnings: [
        `age must be a number between ${AGE_RANGE.lo} and ${AGE_RANGE.hi} ` +
          `(PREVENT's validated range); got ${JSON.stringify(age)}.`,
      ],
    };
  }

  const sex = normalizeSex(input.sex);
  if (!sex) {
    return {
      base: null,
      warnings: [`sex must be "male" or "female"; got ${JSON.stringify(input.sex)}.`],
    };
  }

  const requiredNumeric = ["totalChol", "hdl", "sbp", "bmi", "egfr"];
  for (const key of requiredNumeric) {
    if (!isFiniteNumber(input[key])) {
      return {
        base: null,
        warnings: [`${key} is required and must be a finite number; got ${JSON.stringify(input[key])}.`],
      };
    }
  }

  const v = {
    age,
    totalChol: clampWarn(input.totalChol, VALID_RANGES.totalChol, warnings),
    hdl: clampWarn(input.hdl, VALID_RANGES.hdl, warnings),
    sbp: clampWarn(input.sbp, VALID_RANGES.sbp, warnings),
    bmi: clampWarn(input.bmi, VALID_RANGES.bmi, warnings),
    egfr: clampWarn(input.egfr, VALID_RANGES.egfr, warnings),
    diabetes: boolField(input, "diabetes", warnings),
    smoker: boolField(input, "smoker", warnings),
    bpTreatment: boolField(input, "bpTreatment", warnings),
    statin: boolField(input, "statin", warnings),
  };

  if (isFiniteNumber(input.hba1c)) {
    v.hba1c = clampWarn(input.hba1c, VALID_RANGES.hba1c, warnings);
  } else if (input.hba1c !== undefined && input.hba1c !== null) {
    warnings.push(`hba1c ${JSON.stringify(input.hba1c)} is not a finite number; ignored (treated as missing).`);
  }

  if (isFiniteNumber(input.uacr)) {
    v.uacr = clampWarn(input.uacr, VALID_RANGES.uacr, warnings);
  } else if (input.uacr !== undefined && input.uacr !== null) {
    warnings.push(`uacr ${JSON.stringify(input.uacr)} is not a finite number; ignored (treated as missing).`);
  }

  const terms = buildTerms(v);
  const result = { base: runModel(MODELS.base, sex, terms), warnings };

  const hasHba1c = isFiniteNumber(v.hba1c);
  const hasUacr = isFiniteNumber(v.uacr);

  if (hasHba1c) result.a1c = runModel(MODELS.a1c, sex, terms);
  if (hasUacr) result.uacr = runModel(MODELS.uacr, sex, terms);
  if (hasHba1c || hasUacr) {
    result.full = runModel(MODELS.full, sex, terms);
    warnings.push(
      "full model: social deprivation index (SDI) is not collected by this module and was treated as missing."
    );
  }

  return result;
}

export { VALID_RANGES, AGE_RANGE };
