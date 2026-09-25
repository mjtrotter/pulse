// How much weight each number can bear. Every derived result carries one tier, stored here rather than guessed by
// the interface: A = a guideline-supported clinical model, B = an established screening or research index,
// C = a physiological calculation, D = exploratory (useful to watch, not to act on).
export const TIERS = {
  A: { label: "Validated clinical estimate", short: "Clinical" },
  B: { label: "Screening or research estimate", short: "Screening" },
  C: { label: "Derived measurement", short: "Derived" },
  D: { label: "Exploratory insight", short: "Exploratory" },
};

export const TIER_OF = {
  // guideline-supported models and categories
  prevent: "A", egfr_cr: "A", egfr_cys: "A", egfr_crcys: "A", kdigo: "A", fib4: "A", nonhdl: "A", hscrp: "A", enhancers: "A", mets: "A", lpa: "A",
  // screening and research indices
  homa_ir: "B", homa_b: "B", quicki: "B", mcauley: "B", tyg: "B", mets_ir: "B", tg_hdl: "B", aip: "B", remnant: "B",
  castelli1: "B", castelli2: "B", nafld_fs: "B", apri: "B", omega3_index: "B", fai: "B", nlr: "B", sii: "B", plr: "B",
  whtr: "B", rfm: "B", bmi: "B", stopbang: "B",
  // physiological calculations
  iron_sat_calc: "C", bun_creat_calc: "C", pp: "C", map: "C", bpv: "C", mornEve: "C", bmr: "C",
  // exploratory
  aa_epa: "D", phenoage: "D", kdm: "D", hd: "D", beforeAfter: "D",
};

/** {tier, label, short} for a result key, or null when the key isn't registered. */
export function tierOf(key) {
  const t = TIER_OF[key];
  return t ? { tier: t, ...TIERS[t] } : null;
}
