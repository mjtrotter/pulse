// Profile: who you are (feeds norms, goals and heart-rate zones), settings, heart risk from labs + home BP,
// labs and what they imply, the band, your data, and first-run setup. Also the bottom sheets (forms).
import { cmToFtIn, isUS, kg } from "../core/units.js?v=20260924230628";
import { mean, sd } from "./stats.js?v=20260924230628";
import { css, D, esc, header, relMin, st } from "./kit.js?v=20260924230628";
import { ANALYTES } from "./labsui.js?v=20260924230628";

export const bmiOf = (p) => (p.height && p.weight ? p.weight / (p.height / 100) ** 2 : null);

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
export { ANALYTES };
