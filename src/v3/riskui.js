// Context the headline numbers can't carry on their own: the guideline's risk enhancers and the kidney grid next
// to PREVENT, home-BP detail next to the cuff chart, before/after around a change the person logged, tier chips,
// and which inputs moved a lab index. The math lives in analytics/ (riskctx, homebp, change, body, tiers).
import { egfrAt, kdigo, KDIGO_RISK, lpaStatus, riskEnhancers, uacrAt } from "../analytics/riskctx.js?v=20260925173307";
import { homeBP, ppNote, protocolWeek } from "../analytics/homebp.js?v=20260925173307";
import { attributeChange, beforeAfter, POWER_FORMS, verdict } from "../analytics/change.js?v=20260925173307";
import { bodyIndices } from "../analytics/body.js?v=20260925173307";
import { tierOf } from "../analytics/tiers.js?v=20260925173307";
import { dayOf, toMs } from "../core/time.js?v=20260925173307";
import { isUS } from "../core/units.js?v=20260925173307";
import { bpSummary } from "./bp.js?v=20260925173307";
import { css, D, esc, hm, MON, S, sign, st } from "./kit.js?v=20260925173307";

const shortDate = (date) => `${MON[+date.slice(5, 7) - 1]} ${+date.slice(8, 10)}`;
const longDate = (date) => `${shortDate(date)}, ${date.slice(0, 4)}`;

/** A small label for how much weight a number can bear (A–D, see analytics/tiers.js). */
export function tierChip(key) {
  const t = tierOf(key);
  return t ? `<span class="tier t${t.tier}" title="${esc(t.label)}">${t.short}</span>` : "";
}

// ---------- risk enhancers + kidney grid ----------
const STATUS = { present: "Present", once: "Check again", partial: "Can't tell yet", absent: "Not present", missing: "Not measured", unasked: "" };
const ORDER = ["present", "once", "partial", "missing", "unasked", "absent"];

function kidneyGrid(k) {
  const G = ["G1", "G2", "G3a", "G3b", "G4", "G5"], A = ["A1", "A2", "A3"], W0 = 300, cw = 74, rh = 19, x0 = 76, y0 = 18;
  const GRID = { G1: ["low", "moderate", "high"], G2: ["low", "moderate", "high"], G3a: ["moderate", "high", "veryhigh"], G3b: ["high", "veryhigh", "veryhigh"], G4: ["veryhigh", "veryhigh", "veryhigh"], G5: ["veryhigh", "veryhigh", "veryhigh"] };
  const col = { low: "--good", moderate: "--watch", high: "--temp", veryhigh: "--bad" };
  const GL = { G1: "≥90", G2: "60–89", G3a: "45–59", G3b: "30–44", G4: "15–29", G5: "<15" }, AL = { A1: "<30", A2: "30–300", A3: ">300" };
  let body = A.map((a, j) => `<text x="${x0 + j * cw + cw / 2}" y="11" text-anchor="middle" class="axis">${a} ${AL[a]}</text>`).join("");
  G.forEach((g, i) => {
    body += `<text x="${x0 - 6}" y="${y0 + i * rh + 13}" text-anchor="end" class="axis">${g} ${GL[g]}</text>`;
    A.forEach((a, j) => { body += `<rect x="${x0 + j * cw + 1}" y="${y0 + i * rh + 1}" width="${cw - 2}" height="${rh - 2}" rx="3" fill="${css(col[GRID[g][j]])}" opacity="${k.g === g && (!k.a || k.a === a) ? 0.9 : 0.22}"/>`; });
  });
  const i = G.indexOf(k.g);
  body += k.a ? `<rect x="${x0 + A.indexOf(k.a) * cw}" y="${y0 + i * rh}" width="${cw}" height="${rh}" rx="4" fill="none" stroke="${css("--ink")}" stroke-width="2"/>`
    : `<rect x="${x0}" y="${y0 + i * rh}" width="${cw * 3}" height="${rh}" rx="4" fill="none" stroke="${css("--ink")}" stroke-width="1.5" stroke-dasharray="4 3"/>`;
  return `<div class="kgrid">${S(W0, y0 + G.length * rh + 2, body)}</div>`;
}

function kidneyBlock(p) {
  const L = D.labs ?? [], today = dayOf();
  const eg = [...L].reverse().map((x) => ({ date: x.date, e: egfrAt(x, { age: p.age, sex: p.sex, today }) })).find((z) => z.e);
  if (!eg) return "";
  const ua = [...L].reverse().map((x) => ({ date: x.date, u: uacrAt(x) })).find((z) => z.u), k = kdigo(eg.e.value, ua?.u.value ?? null), r = k.risk ? KDIGO_RISK[k.risk] : null;
  return `<div class="sub-h">Kidneys · KDIGO</div>
    <div class="risk-h"><div><b>${k.g}${k.a ? ` · ${k.a}` : ""}</b> <span class="muted">eGFR ${eg.e.value} (${shortDate(eg.date)})${ua ? ` · UACR ${ua.u.value} mg/g (${shortDate(ua.date)})` : ""}</span></div>${r ? `<span class="badge ${r[1]}">${r[0]}</span>` : ""}</div>
    ${kidneyGrid(k)}
    <p class="note">Filtering (G, from eGFR: ${esc(eg.e.source)}) and leaking protein (A, from a urine albumin/creatinine ratio) together set kidney risk. ${ua ? "" : "Pulse has no urine albumin/creatinine ratio (UACR) on file, so it can only mark the row. That cheap urine test fills in the column, and it lets PREVENT use its full model. "}Kidney disease is only diagnosed when a result stays abnormal for 3 months, so one draw is never a diagnosis.</p>`;
}

export function riskContextCard(p) {
  const bp = bpSummary(D.bp ?? []), R = riskEnhancers(D.labs ?? [], p, { bp, today: dayOf() });
  // Without any lab panel, only the questions are worth listing; the lab-based rows would all read "not measured".
  const noLabs = !(D.labs ?? []).length, items = [...R.items].filter((z) => !noLabs || ["famhx", "inflam", "women", "ancestry"].includes(z.key)).sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  const shown = items.filter((z) => z.status !== "absent"), absent = items.filter((z) => z.status === "absent"), open = st.open.has("enh-absent");
  const row = (z) => `<div class="enh ${z.status}"><i></i><b>${esc(z.name)}</b>${z.status === "unasked" ? `<button class="link" data-sheet="riskq">Answer ›</button>` : `<em>${STATUS[z.status]}</em>`}${z.key === "lpa" && z.status === "missing" ? "" : `<p>${esc(z.detail)}</p>`}</div>`;
  const lp = lpaStatus(D.labs ?? []);
  const lpaLine = !lp.measured ? `<p class="note"><b>Lp(a) has never been measured.</b> It's set mostly by your genes, so one test is usually enough for life, and the 2026 ACC/AHA guideline recommends it for every adult. You could ask for it at your next blood draw.</p>`
    : lp.level !== "normal" ? `<p class="note"><b>Your Lp(a) is ${lp.level === "high" ? "high" : "elevated"}.</b> Because it's inherited, the guideline suggests testing parents, brothers, sisters and children too.</p>` : "";
  return `<div class="risk-h"><div><div class="lbl">Beyond the equation ${tierChip("enhancers")}</div><b>${R.present ? `${R.present} risk enhancer${R.present === 1 ? "" : "s"} present` : noLabs ? "Risk enhancers" : "No risk enhancers present"}</b>${!noLabs && R.once + R.missing + R.unasked ? `<span class="muted"> · ${[R.once && `${R.once} to recheck`, R.missing && `${R.missing} not measured`, R.unasked && `${R.unasked} to answer`].filter(Boolean).join(" · ")}</span>` : ""}</div></div>
    ${R.severeLdl ? `<p class="callout">LDL cholesterol of 190 or more is treated as high risk on its own, and the PREVENT number above isn't meant for it. This is worth raising with your doctor.</p>` : ""}
    <div class="enhs">${shown.map(row).join("")}${absent.length ? `<button class="more" data-expand="enh-absent">${open ? "Hide" : `${absent.length} checked, not present`}</button>${open ? absent.map(row).join("") : ""}` : ""}</div>
    ${noLabs ? `<p class="note">Add a lab panel to check cholesterol, triglycerides, hs-CRP, Lp(a), ApoB and kidney function here.</p>` : lpaLine}
    <p class="note">PREVENT doesn't include these. The guideline uses them to judge whether someone's real risk is higher than the number shows, mainly when it falls in the borderline or intermediate range. They're for a conversation with your doctor, not a diagnosis.</p>
    ${noLabs ? "" : kidneyBlock(p)}
    <p class="cite">${esc(R.cite)}</p>`;
}

// ---------- home BP detail ----------
export function bpDetail(p) {
  const rows = D.bp ?? [];
  if (!rows.length) return "";
  const r = homeBP(rows), w = protocolWeek(rows);
  if (!r.sessions) return "";
  const lvl = w.level === "complete" ? ["Full week", "good"] : w.level === "minimum" ? ["Minimum met", "watch"] : null;
  const kv = [
    ["Pulse pressure", `${r.pp} mmHg`, ppNote(r.pp, p.age)],
    ["Mean arterial pressure", `${r.map} mmHg`, "Diastolic plus a third of the pulse pressure: roughly the average pressure pushing blood through your organs. It's an estimate at rest."],
    ["Morning vs evening", r.mornEve ? `${r.mornEve.am.toFixed(0)} vs ${r.mornEve.pm.toFixed(0)} (${sign(r.mornEve.diff, 0)})` : "—", r.mornEve ? `Systolic, over ${r.mornEve.nAm} morning and ${r.mornEve.nPm} evening sittings. Most people read a little higher in the morning. The split shows which time of day drives your average.` : r.need.mornEve],
    ["Day-to-day swing", r.variability ? `±${r.variability.sd.toFixed(1)} mmHg` : "—", r.variability ? `Standard deviation of your daily systolic averages over ${r.variability.days} days (average change from one day to the next: ${r.variability.arv.toFixed(1)} mmHg). In the Ohasama study, bigger day-to-day swings in home systolic pressure went with higher cardiovascular risk, whatever the average (Kikuya 2008). There's no agreed cut-off, so watch it against your own history.` : r.need.variability],
    ["First vs second reading", r.firstReading ? `${sign(r.firstReading.diff, 1)} mmHg` : "—", r.firstReading ? `The first reading of a sitting minus the second, over ${r.firstReading.n} sittings. This is why the AHA asks for two readings, and why Pulse averages each sitting.` : r.need.firstReading],
  ];
  return `<div class="card rise" style="--i:6"><div class="risk-h"><div><div class="lbl">Home readings, last 30 days ${tierChip("pp")}</div><b>This week: ${w.days} of 7 days</b><span class="muted"> · ${w.amDays} mornings · ${w.pmDays} evenings · ${w.paired} of ${w.sessions} sittings with two readings</span></div>${lvl ? `<span class="badge ${lvl[1]}">${lvl[0]}</span>` : ""}</div>
    <div class="kv">${kv.map(([a, b, c]) => `<div><span>${a}</span><b>${esc(b)}</b><em>${esc(c)}</em></div>`).join("")}</div>
    <p class="note">AHA/AMA home method: two readings a minute apart, each morning before medication and each evening before dinner, for 7 days (3 at the least). Readings within 10 minutes count as one sitting. Cuff readings only; the band's estimate never enters these numbers.</p></div>`;
}

// ---------- before / after a logged change ----------
const BA_METRICS = [
  { k: "rhr", label: "Resting HR", f: (v) => `${v.toFixed(1)}`, u: "bpm", night: true },
  { k: "hrv", label: "Overnight HRV", f: (v) => `${v.toFixed(0)}`, u: "ms", night: true },
  { k: "sleepH", label: "Sleep", f: (v) => hm(v), u: "", night: true },
  { k: "steps", label: "Steps a day", f: (v) => Math.round(v).toLocaleString(), u: "", day: true },
  { k: "sys", label: "Home systolic", f: (v) => v.toFixed(0), u: "mmHg", bp: true },
];
function seriesFor(m) {
  if (m.bp) { const r = homeBP(D.bp ?? [], { days: 3650 }); return (r.dayRows ?? []).map((d) => ({ date: d.date, value: d.sys })); }
  const H = D.hist ?? [], today = dayOf();
  return H.filter((h) => !(m.day && h.date === today)).map((h) => ({ date: h.date, value: m.night && h.sick ? null : h[m.k] ?? null }));
}
export function beforeAfterCard() {
  const ev = [...(D.events ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1));
  const add = `<button class="cta ghost" data-sheet="event" style="margin-top:10px">Log a change</button>`;
  if (!ev.length) return `<div class="card rise" style="--i:4"><div class="lbl">Before & after ${tierChip("beforeAfter")}</div><p class="note" style="margin-top:6px">Started a medication, stopped one, or changed a routine? Log the date and Pulse compares the 4 weeks before with the 4 weeks after, for resting heart rate, HRV, sleep, steps and home blood pressure.</p>${add}</div>`;
  const cards = ev.slice(0, st.allEvents ? ev.length : 3).map((e) => {
    const res = BA_METRICS.map((m) => ({ m, r: beforeAfter(seriesFor(m), e.date, { minN: m.bp ? 4 : 7 }) }));
    const ok = res.filter((x) => x.r.ok), days = Math.round((Date.now() - toMs(e.date)) / 864e5);
    // Until there's history on both sides of enough other dates, a verdict can't be given; say that once.
    const judged = ok.some(({ r }) => r.unusual != null), dp = (m) => (m.k === "rhr" ? 1 : 0);
    const rows = ok.map(({ m, r }) => { const v = verdict(r), sh = m.k === "sleepH" ? `${sign(r.shift * 60, 0)} min` : m.k === "steps" ? `${r.shift > 0 ? "+" : r.shift < 0 ? "−" : ""}${Math.abs(Math.round(r.shift)).toLocaleString()}` : `${sign(r.shift, dp(m))}${m.u ? ` ${m.u}` : ""}`;
      return `<div><span>${m.label}</span><b>${m.f(r.before)} → ${m.f(r.after)}${m.u ? ` <small>${m.u}</small>` : ""}</b><em class="${v.kind}">${judged ? `${v.label}${r.unusual != null ? ` · a shift this size came up at ${Math.round(r.unusual * 100)}% of other dates` : ""}` : sh}</em></div>`; }).join("");
    return `<div class="ba"><div class="ba-h"><b>${esc(e.label)}</b><span class="muted">${longDate(e.date)}${e.kind ? ` · ${esc(e.kind)}` : ""}</span><button class="link" data-delevent="${esc(e.id ?? e.date)}">Remove</button></div>
      ${rows ? `<div class="kv">${rows}</div>${judged ? "" : `<p class="note" style="margin-top:6px">To say whether a shift is unusual for you, Pulse repeats the comparison at other dates in your history, which takes about 3 months of data.</p>`}` : `<p class="note" style="margin-top:4px">${days < 7 ? `Too soon to compare. Check back from ${shortDate(dayOf(new Date(toMs(e.date) + 7 * 864e5)))}.` : "Not enough data around this date yet."}</p>`}</div>`;
  }).join("");
  return `<div class="card rise" style="--i:4"><div class="lbl">Before & after ${tierChip("beforeAfter")}</div>${cards}
    ${ev.length > 3 ? `<button class="more" data-allevents>${st.allEvents ? "Show fewer" : `Show all ${ev.length}`}</button>` : ""}
    <p class="note">Median of up to 4 weeks before vs up to 4 weeks after (sick nights left out). "Clear change" means a shift this large turned up at under 5% of other dates in your own history. This shows what changed after a date, not what caused it: season, illness, travel or other changes can do the same.</p>${add}</div>`;
}

// ---------- lab index: which inputs moved it ----------
const INPUT_NAME = { age: "age", ast: "AST", alt: "ALT", platelets: "platelets", glucose: "glucose", insulin: "insulin", tg: "triglycerides", hdl: "HDL", tc: "total cholesterol", ldl: "LDL" };
/** One sentence on what drove the change in index `key` between the two newest panels that can compute it. */
export function whatMoved(key, age) {
  const f = POWER_FORMS[key];
  if (!f) return "";
  const today = dayOf(), withAge = (panel) => ({ ...panel.v, age: age != null ? age - (toMs(today) - toMs(panel.date)) / (365.25 * 864e5) : null });
  const usable = (D.labs ?? []).filter((x) => Object.keys(f.exp).every((k) => (k === "age" ? age != null : x.v?.[k] > 0)));
  if (usable.length < 2) return "";
  const a = usable[usable.length - 2], b = usable[usable.length - 1], r = attributeChange(key, withAge(a), withAge(b));
  if (!r || Math.abs(r.total) < 0.01) return `<p>Between ${shortDate(a.date)} and ${shortDate(b.date)} it barely moved.</p>`;
  const up = r.total > 0, top = r.parts.filter((x) => Math.abs(x.share) >= 0.1).slice(0, 3);
  const phr = (x) => `${INPUT_NAME[x.input] ?? x.input} ${x.pctChange >= 0 ? "up" : "down"} ${Math.abs(x.pctChange).toFixed(0)}% (${x.share >= 0 ? "" : "against, "}${Math.abs(Math.round(x.share * 100))}% of the change)`;
  return `<p><b>What moved it:</b> from ${shortDate(a.date)} to ${shortDate(b.date)} it went ${up ? "up" : "down"}, mostly from ${top.map(phr).join("; ")}.</p>`;
}

// ---------- body ----------
/** Waist and waist-to-height rows for the Profile card (only once a waist is on file). */
export function bodyRows(p) {
  if (!p.waist) return [["Waist", "—"]];
  const w = isUS() ? `${(p.waist / 2.54).toFixed(1)} in` : `${Math.round(p.waist)} cm`, ix = bodyIndices(p), whtr = ix.find((z) => z.key === "whtr");
  return [["Waist", w], ...(whtr ? [["Waist / height", `${whtr.value.toFixed(2)} · ${whtr.band[0].toLowerCase()}`]] : [])];
}
