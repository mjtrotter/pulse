// Lab-report PDF import. Extracts text from a lab PDF (Quest/Labcorp/etc. style layouts) with
// pdf.js, then parses it into the same analyte keys Pulse's other lab tooling uses (see
// src/analytics/labs.js): tc, ldl, hdl, tg, glucose, insulin, a1c, hscrp, egfr, ... — US
// conventional units (mg/dL, %, mmol/L for electrolytes, etc.), converting from SI when the
// report shows SI units instead.
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
// pattern, since "HEMOGLOBIN A1c" would also match /^HEMOGLOBIN\b/).
//
// Note: the task's analyte list writes "uric acid" with a space; every other key is a single
// bare token (tc, ldl, hscrp, ...), so for a valid/consistent object key it's named "uricacid"
// here, matching that convention.
const ANALYTES = [
  { key: "a1c", re: /^(HEMOGLOBIN\s*A1C|HGB\s*A1C|HBA1C|A1C)\b/i, si: { re: /mmol\/mol/i, unit: "%", convert: (v) => 0.0915 * v + 2.15 } },
  { key: "hemoglobin", re: /^HEMOGLOBIN\b/i },
  { key: "tc", re: /^(CHOLESTEROL|TOTAL\s+CHOLESTEROL)\b/i, si: { re: /mmol\/L/i, unit: "mg/dL", convert: (v) => v * 38.67 } },
  { key: "ldl", re: /^LDL\b/i, si: { re: /mmol\/L/i, unit: "mg/dL", convert: (v) => v * 38.67 } },
  { key: "hdl", re: /^HDL\b/i, si: { re: /mmol\/L/i, unit: "mg/dL", convert: (v) => v * 38.67 } },
  { key: "tg", re: /^TRIGLYCERIDES?\b/i, si: { re: /mmol\/L/i, unit: "mg/dL", convert: (v) => v * 88.57 } },
  { key: "apob", re: /^(APOLIPOPROTEIN\s*B|APO\s*B|APOB)\b/i },
  { key: "lpa", re: /^(LIPOPROTEIN\s*\(?A\)?|LP\s*\(?A\)?|LPA)\b/i },
  { key: "glucose", re: /^GLUCOSE\b/i, si: { re: /mmol\/L/i, unit: "mg/dL", convert: (v) => v * 18.016 } },
  { key: "insulin", re: /^INSULIN\b/i },
  { key: "hscrp", re: /^(HS[\s-]?CRP|HIGH\s*SENSITIVITY\s*CRP|C[\s-]?REACTIVE\s*PROTEIN(,?\s*CARDIAC)?|CRP[\s-]?HS)\b/i },
  { key: "egfr", re: /^(EGFR|GFR\s*ESTIMATED)\b/i },
  { key: "creatinine", re: /^CREATININE\b/i },
  { key: "ast", re: /^AST\b/i },
  { key: "alt", re: /^ALT\b/i },
  { key: "tsh", re: /^(TSH|THYROID\s*STIMULATING\s*HORMONE)\b/i },
  { key: "vitd", re: /^(VITAMIN\s*D|25[\s-]?HYDROXY\s*VITAMIN\s*D|25[\s-]?OH\s*VITAMIN\s*D)\b/i },
  { key: "ferritin", re: /^FERRITIN\b/i },
  { key: "testosterone", re: /^TESTOSTERONE\b/i },
  { key: "uricacid", re: /^URIC\s*ACID\b/i },
  { key: "bun", re: /^(BUN|UREA\s*NITROGEN|BLOOD\s*UREA\s*NITROGEN)\b/i },
  { key: "sodium", re: /^SODIUM\b/i },
  { key: "potassium", re: /^POTASSIUM\b/i },
  { key: "wbc", re: /^(WHITE\s*BLOOD\s*CELL|WBC|LEUKOCYTES?)\b/i },
  { key: "platelets", re: /^(PLATELETS?|PLATELET\s*COUNT|PLT)\b/i },
];

const UNIT_RE = /^(mg\/dL|mg\/L|mmol\/L|mmol\/mol|ng\/mL|ng\/dL|pg\/mL|pg|IU\/L|IU\/mL|uIU\/mL|mIU\/L|mIU\/mL|U\/L|mL\/min\S*|mEq\/L|g\/dL|K\/uL|10\^?3\/uL|fL|Thousand|Million\/uL|cells\/uL|%|\/uL|\/HPF|\/LPF)$/i;
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
  let ref = null;
  if (tokens[idx] && /^[<>]=?\d/.test(tokens[idx])) { ref = tokens[idx]; idx++; }
  else if (tokens[idx] && /^-?\d+(?:\.\d+)?-\d+(?:\.\d+)?$/.test(tokens[idx])) { ref = tokens[idx]; idx++; }
  if (!ref && ineq) ref = `${ineq}${m[2]}`;
  let unit = null;
  if (tokens[idx] && UNIT_RE.test(tokens[idx])) { unit = tokens[idx]; idx++; }
  return { value, flag, ref, unit };
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

/**
 * parseLabs(pages) -> {date, lab, values, unmatched}. `pages` is extractText's output shape:
 * [{page, lines:[string]}]. Pure/synchronous; no pdf.js involved, so it's directly unit-testable.
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
  const unmatched = [];

  for (let li = 0; li < flat.length; li++) {
    const { page, text: line } = flat[li];
    let claimedByAnAnalyte = false;

    for (const a of ANALYTES) {
      if (!a.re.test(line)) continue;
      claimedByAnAnalyte = true;
      if (values[a.key]) break; // already have a numeric result for this key; don't overwrite

      let found = null;
      let foundLineIdx = li;
      const nameMatch = line.match(a.re);
      const remainder = line.slice(nameMatch[0].length).trim();
      if (remainder && looksLikeDataRow(remainder)) {
        found = extractValue(remainder);
      }
      if (!found) {
        // Either the name occupied the whole line (narrow printed column, common in Labcorp-style
        // layouts) or the same-line remainder didn't parse as a value at all (e.g. it's a section
        // header repeating the test name before "Collected: ..."). Either way, check the next
        // line down for the actual result row.
        const next = flat[li + 1];
        if (next && next.page === page && looksLikeDataRow(next.text)) {
          found = extractValue(next.text);
          if (found) foundLineIdx = li + 1;
        }
      }
      if (found) {
        let { value, unit, flag, ref } = found;
        if (a.si && unit && a.si.re.test(unit)) { value = a.si.convert(value); unit = a.si.unit; }
        values[a.key] = { value, unit: unit || null, flag: flag || null, ref: ref || null, page, line: foundLineIdx - (flat.findIndex((f) => f.page === page)) };
      }
      break; // this line belongs to at most one analyte
    }

    if (!claimedByAnAnalyte && looksLikeDataRow(line)) {
      const gm = line.match(GENERIC_NAME_RE);
      if (gm) {
        const rest = line.slice(gm[1].length).trim();
        const found = extractValue(rest);
        if (found) unmatched.push({ name: gm[1].trim(), value: found.value, unit: found.unit || null, page });
      }
    }
  }

  return { date, lab, values, unmatched };
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
