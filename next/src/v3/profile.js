// Profile: who you are (feeds norms, goals and heart-rate zones), settings, heart risk from labs + home BP,
// labs and what they imply, the band, your data, and first-run setup. Also the bottom sheets (forms).
import { derived } from "../analytics/labs.js?v=20260924180231";
import { prevent } from "../analytics/prevent.js?v=20260924180231";
import { cmToFtIn, isUS, kg } from "../core/units.js?v=20260924180231";
import { mean, sd } from "./stats.js?v=20260924180231";
import { bpSummary } from "./measure.js?v=20260924180231";
import { css, D, esc, header, MON, pct, poly, relMin, S, sc, sign, smooth, st } from "./kit.js?v=20260924180231";

export const ANALYTES = [
  { k: "ldl", n: "LDL cholesterol", u: "mg/dL", ref: [0, 99], grp: "Lipids" },
  { k: "hdl", n: "HDL cholesterol", u: "mg/dL", ref: [40, 200], grp: "Lipids" },
  { k: "tg", n: "Triglycerides", u: "mg/dL", ref: [0, 149], grp: "Lipids" },
  { k: "tc", n: "Total cholesterol", u: "mg/dL", ref: [0, 199], grp: "Lipids" },
  { k: "apob", n: "Apolipoprotein B", u: "mg/dL", ref: [0, 89], grp: "Lipids" },
  { k: "glucose", n: "Fasting glucose", u: "mg/dL", ref: [65, 99], grp: "Metabolic" },
  { k: "insulin", n: "Fasting insulin", u: "µIU/mL", ref: [0, 18.4], grp: "Metabolic" },
  { k: "a1c", n: "HbA1c", u: "%", ref: [0, 5.6], grp: "Metabolic" },
  { k: "hscrp", n: "hs-CRP", u: "mg/L", ref: [0, 1.0], grp: "Inflammation" },
  { k: "egfr", n: "eGFR", u: "mL/min", ref: [60, 200], grp: "Kidney" },
];
export const bmiOf = (p) => (p.height && p.weight ? p.weight / (p.height / 100) ** 2 : null);
const labLabel = (date) => { const d = new Date(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)); return `${MON[d.getMonth()]} ${d.getDate()}`; };

// ---------- heart risk ----------
function preventInput(p, over = {}) {
  const L = D.labs[D.labs.length - 1]?.v ?? {}, bp = bpSummary(D.bp), bmi = bmiOf(p);
  return { age: p.age, sex: p.sex, totalChol: over.tc ?? L.tc, hdl: L.hdl, sbp: over.sbp ?? (bp ? Math.round(bp.sys) : null), bmi: bmi ? +bmi.toFixed(1) : null, egfr: L.egfr,
    diabetes: !!p.diabetes, smoker: !!p.smoker, bpTreatment: !!p.bpMeds, statin: !!p.statin, hba1c: L.a1c ?? null };
}
const pick = (r) => r?.a1c ?? r?.base ?? null;
const riskCat = (v) => (v < 0.05 ? ["Low", "good"] : v < 0.075 ? ["Borderline", "watch"] : v < 0.2 ? ["Intermediate", "bad"] : ["High", "bad"]);
export function preventCard(p) {
  const inp = preventInput(p), missing = [];
  if (!(p.age >= 30 && p.age <= 79)) return `<p class="note" style="margin:0">The AHA PREVENT equations cover ages 30–79${p.age ? `, so at ${p.age} Pulse can't give a number` : ""}. Your labs and home blood pressure are still tracked below.</p>`;
  if (!p.sex) missing.push("sex (Profile)");
  if (inp.totalChol == null || inp.hdl == null) missing.push("total and HDL cholesterol (Labs)");
  if (inp.egfr == null) missing.push("eGFR (Labs)");
  if (inp.sbp == null) missing.push("a week of home blood pressure (Measure)");
  if (!inp.bmi) missing.push("height and weight (Profile)");
  if (missing.length) return `<p class="note" style="margin:0">Heart risk (AHA PREVENT) needs ${missing.join(", ")}.</p>`;
  let r; try { r = prevent(inp); } catch (e) { return `<p class="note" style="margin:0">${esc(e.message)}</p>`; }
  const R = pick(r);
  if (!R) return `<p class="note" style="margin:0">${esc(r?.warnings?.[0] ?? "PREVENT couldn't use these inputs.")}</p>`;
  const wi = pick(prevent(preventInput(p, { sbp: st.whatIf.sbp ?? inp.sbp, tc: st.whatIf.tc ?? inp.totalChol })));
  const opt = pick(prevent({ ...inp, totalChol: 170, hdl: 50, sbp: 110, bmi: 25, egfr: 90, smoker: false, diabetes: false, bpTreatment: false, statin: false, hba1c: inp.hba1c != null ? 5.3 : null }));
  const k = st.horizon === "10" ? ["cvd10", "ascvd10", "hf10"] : ["cvd30", "ascvd30", "hf30"], v = R[k[0]], cat = riskCat(v);
  const W0 = 300, max = st.horizon === "10" ? 0.3 : 0.6, x = sc(0, max, 4, W0 - 4);
  const zones = st.horizon === "10" ? [[0, 0.05, "--good"], [0.05, 0.075, "--watch"], [0.075, 0.2, "--temp"], [0.2, 0.3, "--bad"]] : [];
  const changed = (st.whatIf.sbp != null && st.whatIf.sbp !== inp.sbp) || (st.whatIf.tc != null && st.whatIf.tc !== inp.totalChol);
  const lastLab = D.labs[D.labs.length - 1];
  return `<div class="risk-h"><div><div class="lbl">${st.horizon}-year risk · heart attack, stroke or heart failure</div><div class="num big2">${pct(v)}</div></div>${st.horizon === "10" ? `<span class="badge ${cat[1]}">${cat[0]}</span>` : ""}</div>
    ${S(W0, 30, `${zones.length ? zones.map(([a0, a1, c]) => `<rect x="${x(a0)}" y="10" width="${x(a1) - x(a0)}" height="8" fill="${css(c)}" opacity=".5"/>`).join("") : `<rect x="4" y="10" width="${W0 - 8}" height="8" rx="4" fill="${css("--track")}"/>`}
      ${opt ? `<line x1="${x(Math.min(max, opt[k[0]]))}" x2="${x(Math.min(max, opt[k[0]]))}" y1="6" y2="22" stroke="${css("--ink2")}" stroke-width="1.5"/>` : ""}
      <circle cx="${x(Math.min(max, v))}" cy="14" r="7" fill="${css("--ink")}" stroke="${css("--bg")}" stroke-width="2.5"/>${changed && wi ? `<circle cx="${x(Math.min(max, wi[k[0]]))}" cy="14" r="5" fill="none" stroke="${css("--act")}" stroke-width="2"/>` : ""}
      <text x="4" y="30" class="axis">0%</text><text x="${W0 - 4}" y="30" text-anchor="end" class="axis">${max * 100}%</text>`)}
    <div class="seg small">${[["10", "10 years"], ["30", "30 years"]].map(([h, l]) => `<button data-horizon="${h}" class="${st.horizon === h ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="stat3"><div><b>${pct(R[k[1]])}</b><span>heart attack or stroke</span></div><div><b>${pct(R[k[2]])}</b><span>heart failure</span></div><div><b>${opt ? pct(opt[k[0]]) : "—"}</b><span>same age, optimal numbers</span></div></div>
    <div class="sub-h">What would move it</div>
    <div class="slider"><label><span>Home systolic</span><span><b>${st.whatIf.sbp ?? inp.sbp}</b> mmHg</span></label><input type="range" min="95" max="175" step="1" value="${st.whatIf.sbp ?? inp.sbp}" data-whatif="sbp"></div>
    <div class="slider"><label><span>Total cholesterol</span><span><b>${st.whatIf.tc ?? inp.totalChol}</b> mg/dL</span></label><input type="range" min="130" max="320" step="1" value="${st.whatIf.tc ?? inp.totalChol}" data-whatif="tc"></div>
    <p class="whatif">${changed && wi ? `With these numbers: <b>${pct(wi[k[0]])}</b> (${sign((wi[k[0]] - v) * 100)} points).` : "Drag a slider to see how the equation responds."}</p>
    <div class="sub-h">Inputs</div>
    <div class="kv">${[["Age, sex", `${inp.age}, ${inp.sex}`, "Profile"], ["Total / HDL cholesterol", `${inp.totalChol} / ${inp.hdl} mg/dL`, `Labs · ${labLabel(lastLab.date)}`], ["Systolic BP", `${inp.sbp} mmHg`, "Home cuff · 7-day avg"], ["BMI", inp.bmi.toFixed(1), "Profile"], ["eGFR", `${inp.egfr}`, `Labs · ${labLabel(lastLab.date)}`], ["HbA1c", inp.hba1c != null ? `${inp.hba1c}%` : "not on file", inp.hba1c != null ? `Labs · ${labLabel(lastLab.date)}` : "adds precision"]].map(([a, b, c]) => `<div><span>${a}</span><b>${esc(b)}</b><em>${c}</em></div>`).join("")}</div>
    <p class="note">AHA PREVENT equations (Khan 2024), sex-specific${inp.hba1c != null ? " with the HbA1c add-on" : ""}, for ages 30–79 without known heart disease. It isn't a diagnosis.</p>`;
}

// ---------- labs ----------
function labsCard() {
  const Ls = D.labs;
  if (!Ls.length) return `<p class="note" style="margin:0 0 12px">No lab results yet. Add a panel's numbers (from Quest, Labcorp or Function Health) to track them over time and see what they imply.</p><button class="cta ghost" data-sheet="labs">Add lab results</button>`;
  const groups = [...new Set(ANALYTES.map((a) => a.grp))];
  const flag = (a, v) => (v > a.ref[1] ? ["H", "hi"] : v < a.ref[0] ? ["L", "lo"] : ["", ""]);
  const spark = (a) => { const v = Ls.map((d) => d.v[a.k]).filter((z) => z != null); if (v.length < 2) return S(60, 22, ""); const x = sc(0, v.length - 1, 4, 56), y = sc(Math.min(...v), Math.max(...v) + 1e-9, 18, 4); return S(60, 22, `<path d="${poly(v.map((z, i) => [x(i), y(z)]))}" fill="none" stroke="${css("--ink3")}" stroke-width="1.4"/>${v.map((z, i) => `<circle cx="${x(i)}" cy="${y(z)}" r="${i === v.length - 1 ? 3 : 2}" fill="${i === v.length - 1 ? css("--ink") : css("--ink3")}"/>`).join("")}`); };
  return `<button class="cta ghost" data-sheet="labs">Add lab results</button>` + groups.map((g) => {
    const rows = ANALYTES.filter((a) => a.grp === g && Ls.some((d) => d.v[a.k] != null));
    if (!rows.length) return "";
    return `<div class="sub-h">${g}</div>` + rows.map((a) => {
      const withV = Ls.filter((d) => d.v[a.k] != null), v = withV[withV.length - 1].v[a.k], p = withV.length > 1 ? withV[withV.length - 2].v[a.k] : null, [f, cls] = flag(a, v), id = `lab-${a.k}`;
      return `<div class="an" data-expand="${id}"><div class="an-n">${a.n}<small>ref ${a.ref[1] >= 200 ? `≥${a.ref[0]}` : a.ref[0] ? `${a.ref[0]}–${a.ref[1]}` : `<${a.ref[1]}`}</small></div>${spark(a)}<div class="an-v"><b class="${cls}">${v}${f ? `<sup>${f}</sup>` : ""}</b><small>${a.u}${p != null ? ` · ${v < p ? "↓" : v > p ? "↑" : "="} ${Math.abs(v - p).toFixed(a.k === "a1c" || a.k === "hscrp" || a.k === "insulin" ? 1 : 0)}` : ""}</small></div></div>
        ${st.open.has(id) ? `<div class="an-x">${withV.map((d) => `<span>${labLabel(d.date)}<b>${d.v[a.k]}</b></span>`).join("")}</div>` : ""}`;
    }).join("");
  }).join("") + `<p class="note">${Ls.map((d) => `<button class="link" data-dellab="${esc(d.date)}">Remove ${labLabel(d.date)}</button>`).join(" · ")}</p>`;
}
function indicesCard(p) {
  const b = bmiOf(p), all = D.labs.map((d) => derived(d.v, { bmi: b, sex: p.sex })), cur = all[all.length - 1] ?? [];
  if (!cur.length) return `<p class="note" style="margin:0">Add glucose, insulin, triglycerides and cholesterol to see insulin-resistance and lipid indices, each with its paper's formula.</p>`;
  return cur.map((d) => {
    const hist = all.map((set) => set.find((z) => z.key === d.key)?.value), id = `ix-${d.key}`;
    const dec = Math.max(0, ...hist.filter((v) => v != null).map((v) => (String(v).split(".")[1] ?? "").length)), fx = (v) => (v == null ? "—" : v.toFixed(dec));
    return `<div class="ix" data-expand="${id}"><div class="ix-n">${d.name}<small class="${d.band[1] === "good" ? "ok" : d.band[1] === "watch" ? "lo" : d.band[1] === "bad" ? "hi" : ""}">${d.band[0]}</small></div><div class="ix-t">${hist.length > 1 ? hist.map(fx).join(" → ") : ""}</div><div class="ix-v"><b>${fx(d.value)}</b>${d.unit ? `<small>${d.unit}</small>` : ""}</div></div>
      ${st.open.has(id) ? `<div class="ix-x"><code>${d.formula}</code><p>${d.note}</p><p class="cite">${d.cite}</p></div>` : ""}`;
  }).join("") + `<p class="note">Computed from your panels with each paper's own formula and cut-offs; tap a row for the math.</p>`;
}

// ---------- STOP-Bang ----------
export function stopBang(p) {
  const a = p.stopbang ?? {}, bmi = bmiOf(p);
  const items = { snore: !!a.snore, tired: !!a.tired, observed: !!a.observed, pressure: !!a.pressure, bmi: bmi != null && bmi > 35, age: (p.age ?? 0) > 50, neck: !!a.neck, male: p.sex === "male" };
  const answered = ["snore", "tired", "observed", "pressure", "neck"].every((k) => a[k] != null);
  const score = Object.values(items).filter(Boolean).length;
  return { score, answered, risk: score >= 5 ? "High" : score >= 3 ? "Intermediate" : "Low", kind: score >= 5 ? "bad" : score >= 3 ? "watch" : "good" };
}

export function profile(ctx) {
  const p = ctx.profile, b = bmiOf(p), [ft, inch] = p.height ? cmToFtIn(p.height) : [null, null];
  const tog = (k, l) => `<button class="chip ${p[k] ? "on" : ""}" data-ptoggle="${k}">${l}${p[k] ? ": yes" : ": no"}</button>`;
  const sb = stopBang(p), band = D.band, connected = !!ctx.band?.connected;
  const lastSync = band?.last_sync ? relMin((Date.now() - new Date(band.last_sync.replace(" ", "T")).getTime()) / 60e3) : "never";
  const seg = (attr, opts, cur) => `<div class="seg small inline">${opts.map(([k, l]) => `<button ${attr}="${k}" class="${cur === k ? "on" : ""}">${l}</button>`).join("")}</div>`;
  const build = new URL(import.meta.url).searchParams.get("v") ?? "dev";
  return `${header(`${esc(p.name || "You")}${p.age ? ` · ${p.age}` : ""}`, "Profile", `<span class="avatar">${esc((p.name || "?")[0])}</span>`)}
    <div class="card rise tapcard" style="--i:1" data-sheet="profile"><div class="kv">${[["Name", esc(p.name || "—")], ["Age", p.age ?? "—"], ["Sex", p.sex ?? "—"], ["Height", p.height ? (isUS() ? `${ft}′${inch}″` : `${Math.round(p.height)} cm`) : "—"], ["Weight", p.weight ? (isUS() ? `${Math.round(kg(p.weight))} lb` : `${Math.round(p.weight)} kg`) : "—"], ["BMI", b ? b.toFixed(1) : "—"]].map(([a, v]) => `<div><span>${a}</span><b>${v}</b></div>`).join("")}</div>
      <p class="note">Tap to edit. Used for sleep need, step goals, heart-rate zones and population ranges, and written to the band.</p></div>
    <div class="card rise" style="--i:1"><div class="chips">${tog("betablocker", "Beta-blocker")}${tog("bpMeds", "BP medication")}${tog("statin", "Statin")}${tog("smoker", "Smoker")}${tog("diabetes", "Diabetes")}</div>
      <p class="note">Beta-blockers change heart-rate zones and workout detection; the rest feed the heart-risk estimate.</p>
      <div class="setrow" data-sheet="stopbang" style="cursor:pointer"><span>Sleep apnea screening<em>${sb.answered ? `STOP-Bang ${sb.score} of 8` : "5 quick questions (STOP-Bang)"}</em></span>${sb.answered ? `<span class="badge ${sb.kind}">${sb.risk} risk</span>` : `<span class="chev">›</span>`}</div></div>
    <div class="sec rise" style="--i:2"><h2>Settings</h2><span class="lbl">this phone</span></div>
    <div class="card rise" style="--i:2">
      <div class="setrow"><span>Appearance</span>${seg("data-theme-set", [["auto", "Auto"], ["dark", "Dark"], ["light", "Light"]], p.theme ?? "auto")}</div>
      <div class="setrow"><span>Units</span>${seg("data-units", [["us", "US"], ["metric", "Metric"]], p.units ?? "us")}</div>
      <div class="setrow"><span>Extra overnight readings<em>Oxygen and pulse recordings every 10 min (more battery)</em></span>${seg("data-dense", [["on", "On"], ["off", "Off"]], D.schedule ? "on" : "off")}</div></div>
    <div class="sec rise" style="--i:3"><h2>Heart risk</h2><span class="lbl">AHA PREVENT</span></div>
    <div class="card rise" style="--i:3" id="prevent">${preventCard(p)}</div>
    <div class="sec rise" style="--i:4" id="labs"><h2>Labs</h2><span class="lbl">${D.labs.length} panel${D.labs.length === 1 ? "" : "s"}</span></div>
    <div class="card rise" style="--i:4">${labsCard()}</div>
    ${D.labs.length ? `<div class="sec rise" style="--i:5"><h2>What your labs imply</h2><span class="lbl">derived</span></div><div class="card rise" style="--i:5">${indicesCard(p)}</div>` : ""}
    <div class="sec rise" style="--i:6"><h2>Band</h2><span class="lbl">${esc(ctx.band?.name ?? band?.name ?? "not paired")}</span></div>
    <div class="card rise" style="--i:6"><div class="kv">${[["Status", connected ? "Connected" : "Not connected"], ["Last sync", lastSync], ["Battery", band?.battery != null ? `${band.battery}% at last sync` : "—"], ["Firmware", band?.firmware ?? "—"], ["Data", "on this phone only"]].map(([a, v]) => `<div><span>${a}</span><b>${esc(v)}</b></div>`).join("")}</div>
      <div class="chips" style="margin-top:12px">${connected ? `<button class="chip" data-sync>Sync now</button><button class="chip ghost" data-disconnect>Disconnect</button>` : `<button class="chip" data-connect>Connect</button>`}</div></div>
    <div class="sec rise" style="--i:7"><h2>Your data</h2><span class="lbl">${D.counts ? `${D.counts.hr.toLocaleString()} readings` : ""}</span></div>
    <div class="card rise" style="--i:7"><div class="kv">${[["Nights recorded", D.nights.length], ["Rhythm checks", D.ecg.length], ["Blood-pressure readings", D.bp.length]].map(([a, v]) => `<div><span>${a}</span><b>${v}</b></div>`).join("")}</div>
      <div class="chips" style="margin-top:12px"><button class="chip" data-export>Back up</button><button class="chip" data-import>Restore</button>${D.liveDb ? `<button class="chip" data-copylive>Copy from main Pulse app</button>` : ""}<button class="chip ghost" data-rebuild>Rebuild analysis</button></div>
      <p class="note">Everything stays on this phone; Pulse can't send data anywhere. Back up now and then (save the file to Files or email it to yourself), because clearing the browser's data would erase it.</p></div>
    <details class="card rise log" style="--i:8"><summary>Connection log · build ${esc(build)}</summary><ol>${ctx.logLines.map((l) => `<li class="${l.isError ? "err" : ""}">${esc(l.t)}  ${esc(l.text)}</li>`).join("")}</ol></details>
    <p class="note foot">Pulse: private health analytics for the JC V8 band. Not a medical device.</p>`;
}

// ---------- sheets ----------
export function sheet(kind, ctx) {
  const p = ctx.profile, us = isUS();
  if (kind === "bp") return `<div class="sh-h"><b>Log a blood pressure reading</b><button class="back" data-sheetclose>Cancel</button></div>
    <ol class="steps"><li>No caffeine, smoking or exercise for 30 minutes.</li><li>Sit for 5 minutes, back supported, feet flat, arm resting at heart level.</li><li>Take two readings a minute apart without talking; log both.</li></ol>
    <form data-form="bp"><div class="inputs"><label>Systolic<input name="sys" inputmode="numeric" pattern="[0-9]*" placeholder="120" required></label><label>Diastolic<input name="dia" inputmode="numeric" pattern="[0-9]*" placeholder="80" required></label><label>Pulse<input name="pulse" inputmode="numeric" pattern="[0-9]*" placeholder="opt."></label></div>
    <button class="cta" type="submit" style="margin-top:14px">Save reading</button></form>
    <p class="note">Mornings and evenings for a week gives a reliable home average (AHA).</p>`;
  if (kind === "profile") {
    const [ft, inch] = p.height ? cmToFtIn(p.height) : ["", ""];
    return `<div class="sh-h"><b>Your profile</b><button class="back" data-sheetclose>Cancel</button></div>
      <form data-form="profile" class="fform">
        <label class="full">First name<input name="name" value="${esc(p.name ?? "")}" autocomplete="given-name"></label>
        <label>Age<input name="age" inputmode="numeric" pattern="[0-9]*" value="${p.age ?? ""}" required></label>
        <label>Sex<select name="sex">${[["", "—"], ["female", "Female"], ["male", "Male"]].map(([k, l]) => `<option value="${k}" ${p.sex === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        ${us ? `<label>Height (ft)<input name="ft" inputmode="numeric" value="${ft}"></label><label>(in)<input name="in" inputmode="numeric" value="${inch}"></label>` : `<label class="full">Height (cm)<input name="cm" inputmode="numeric" value="${p.height ? Math.round(p.height) : ""}"></label>`}
        <label class="full">Weight (${us ? "lb" : "kg"})<input name="wt" inputmode="decimal" value="${p.weight ? Math.round(us ? kg(p.weight) : p.weight) : ""}"></label>
        <button class="cta full" type="submit">Save</button></form>`;
  }
  if (kind === "stopbang") {
    const a = p.stopbang ?? {};
    const qs = [["snore", "Do you snore loudly (louder than talking, or heard through a closed door)?"], ["tired", "Do you often feel tired, fatigued or sleepy during the day?"], ["observed", "Has anyone seen you stop breathing, choke or gasp during sleep?"], ["pressure", "Do you have, or are you treated for, high blood pressure?"], ["neck", p.sex === "female" ? "Is your shirt-collar size 16 in / 41 cm or more?" : "Is your shirt-collar size 17 in / 43 cm or more?"]];
    return `<div class="sh-h"><b>Sleep apnea screening</b><button class="back" data-sheetclose>Cancel</button></div>
      <p>STOP-Bang: five questions here, plus age, sex and BMI from your profile. It's the most widely validated sleep-apnea questionnaire (score 3+ catches ~90% of moderate-to-severe apnea).</p>
      <form data-form="stopbang">${qs.map(([k, q2]) => `<div class="yn"><p>${q2}</p><div class="seg small inline"><label><input type="radio" name="${k}" value="1" ${a[k] === true ? "checked" : ""}><span>Yes</span></label><label><input type="radio" name="${k}" value="0" ${a[k] === false ? "checked" : ""}><span>No</span></label></div></div>`).join("")}
      <button class="cta" type="submit" style="margin-top:14px">Save answers</button></form>`;
  }
  if (kind === "labs") return `<div class="sh-h"><b>Add lab results</b><button class="back" data-sheetclose>Cancel</button></div>
    <p>Type the numbers from your report (US units). Leave anything you don't have blank.</p>
    <form data-form="labs" class="fform"><label class="full">Date drawn<input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}" required></label>
      ${ANALYTES.map((a) => `<label>${a.n} <small>${a.u}</small><input name="${a.k}" inputmode="decimal"></label>`).join("")}
      <button class="cta full" type="submit">Save panel</button></form>`;
  return "";
}

// ---------- first run ----------
export function onboarding(ctx) {
  const step = st.obStep ?? 0, p = ctx.profile, us = isUS();
  const dots = `<div class="ob-dots">${[0, 1, 2].map((i) => `<i class="${i <= step ? "on" : ""}"></i>`).join("")}</div>`;
  if (step === 0) return `<div class="ob">${dots}<div class="ob-art"><svg viewBox="0 0 180 180"><circle cx="90" cy="90" r="74" fill="none" stroke="var(--track)" stroke-width="12"/><circle cx="90" cy="90" r="74" fill="none" stroke="var(--act)" stroke-width="12" stroke-linecap="round" stroke-dasharray="465" stroke-dashoffset="120" transform="rotate(-90 90 90)"/><path d="M48 94h20l9-22 16 44 12-30 7 8h20" fill="none" stroke="var(--ink)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
    <h1>Your heart, sleep and activity, on your phone.</h1><p class="lead">Pulse reads your band and turns it into clear daily numbers, backed by published research. Everything stays on this phone.</p>
    ${D.liveDb ? `<div class="card ob-card"><b>Pulse data found on this phone</b><p>${D.liveDb.hr.toLocaleString()} heart-rate readings${D.liveDb.name ? ` for ${esc(D.liveDb.name)}` : ""} from the main Pulse app. Bring them in so your history starts full.</p><button class="cta" data-copylive>Bring in my data</button></div>` : ""}
    <div class="grow"></div><button class="cta ${D.liveDb ? "ghost" : ""}" data-ob="1">${D.liveDb ? "Start fresh instead" : "Get started"}</button></div>`;
  if (step === 1) {
    const [ft, inch] = p.height ? cmToFtIn(p.height) : ["", ""];
    return `<div class="ob">${dots}<h1>A little about you</h1><p class="lead">Sleep needs, step goals and heart-rate zones depend on these.</p>
      <form data-form="obprofile" class="fform">
        <label class="full">First name<input name="name" value="${esc(p.name ?? "")}" autocomplete="given-name" placeholder="First name"></label>
        <label>Age<input name="age" inputmode="numeric" pattern="[0-9]*" value="${p.age ?? ""}" placeholder="60" required></label>
        <label>Sex<select name="sex" required>${[["", "Choose"], ["female", "Female"], ["male", "Male"]].map(([k, l]) => `<option value="${k}" ${p.sex === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        ${us ? `<label>Height (ft)<input name="ft" inputmode="numeric" value="${ft}" placeholder="5"></label><label>(in)<input name="in" inputmode="numeric" value="${inch}" placeholder="9"></label>` : `<label class="full">Height (cm)<input name="cm" inputmode="numeric" placeholder="175"></label>`}
        <label class="full">Weight (${us ? "lb" : "kg"})<input name="wt" inputmode="decimal" value="${p.weight ? Math.round(us ? kg(p.weight) : p.weight) : ""}" placeholder="${us ? "170" : "77"}"></label>
        <label class="full check"><input type="checkbox" name="betablocker" ${p.betablocker ? "checked" : ""}> I take a beta-blocker (metoprolol, carvedilol, atenolol…)</label>
        <button class="cta full" type="submit">Continue</button></form></div>`;
  }
  const android = /android/i.test(navigator.userAgent), hasBt = !!navigator.bluetooth;
  return `<div class="ob">${dots}<h1>Connect your band</h1>
    <ol class="steps"><li>Charge the band for about an hour first.</li><li>Keep it within arm's reach of this phone.</li><li>${android ? "When Chrome asks, allow Nearby devices." : "When Bluefy asks, allow Bluetooth."}</li><li>Tap below and choose your band: the one with your name (<b>V5 …</b>), or starting with <b>JCV8B</b>.</li></ol>
    ${hasBt ? "" : `<p class="note warn">${android ? "This browser can't use Bluetooth. Open this page in Google Chrome." : "Safari can't use Bluetooth. Open this page in the free Bluefy app."}</p>`}
    <p class="note" id="obStatus" style="text-align:center;min-height:22px">${esc(ctx.status ?? "")}</p>
    <div class="grow"></div><button class="cta" data-obconnect ${hasBt ? "" : "disabled"}>Connect my band</button><button class="link center" data-obdone>I'll connect later</button></div>`;
}
export { mean, sd, smooth };
