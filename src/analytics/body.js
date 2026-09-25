// Body measurements from a tape measure: waist-to-height ratio and relative fat mass. Height and waist are in cm.
// Both are screening estimates of central fat. Neither replaces a DXA scan.

const r2 = (x) => Math.round(x * 100) / 100;

/** [{key, name, value, unit, band, formula, note, cite}] for whatever the inputs allow. */
export function bodyIndices({ height = null, waist = null, sex = null } = {}) {
  const out = [];
  if (!(height > 0 && waist > 0)) return out;
  const whtr = waist / height;
  out.push({ key: "whtr", name: "Waist-to-height ratio", value: r2(whtr), unit: "", formula: "waist ÷ height (same units)",
    band: whtr < 0.5 ? ["No increased risk", "good"] : whtr < 0.6 ? ["Increased health risk", "watch"] : ["High health risk", "bad"],
    note: "Keep your waist under half your height. The same 0.5 boundary worked across adults of different sexes and ethnic groups. Measure midway between the lowest rib and the top of the hip bone, after breathing out.",
    cite: "Ashwell M et al., Obes Rev 2012;13(3):275-286; bands 0.5 / 0.6 from NICE CG189 (2022 update)" });
  if (sex === "female" || sex === "male") {
    const rfm = 64 - 20 * (height / waist) + (sex === "female" ? 12 : 0);
    out.push({ key: "rfm", name: "Relative fat mass", value: Math.round(rfm * 10) / 10, unit: "% body fat", formula: `64 − 20 × (height ÷ waist)${sex === "female" ? " + 12" : ""}`,
      band: ["Estimated body-fat percentage", ""],
      note: "In the development cohort it estimated DXA body fat more accurately than BMI. It's still an estimate, and a tape placed a little higher or lower changes it more than a month of real change would.",
      cite: "Woolcott OO & Bergman RN, Sci Rep 2018;8:10980" });
  }
  return out;
}
