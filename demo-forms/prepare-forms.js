// Prepare real IRS PDFs for Once: their AcroForm fields have cryptic names
// (topmostSubform[0].Page1[0].f1_1[0]) and no human labels. This script recovers a
// human label for each field by POSITION — reading the page text with pdf.js and
// pairing each form-field box with the nearest caption (to its left, else above) —
// then bakes that label into the field's tooltip (/TU) with pdf-lib. The extension
// reads the tooltip as the label, so the semantic engine has something to reason on.
// This is the "CommonForms-prepared AcroForm" step from the concept, done for real.
//
//   node prepare-forms.js
//   -> writes demo-forms/prepared/<name>.pdf  (labelled, still fully fillable)

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FORMS = ["fss4", "f1040", "f1041", "f56", "f8822", "f4868"];

// Pull every text run on a page with its PDF-space box {x, y, w, h, str}.
async function pageTexts(pdfjsDoc) {
  const pages = [];
  for (let p = 1; p <= pdfjsDoc.numPages; p++) {
    const page = await pdfjsDoc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = tc.items
      .filter((i) => i.str && i.str.trim())
      .map((i) => {
        // transform = [a,b,c,d,e,f]; e,f = x,y baseline in PDF space (origin bottom-left)
        const x = i.transform[4];
        const y = i.transform[5];
        return { x, y, w: i.width || 0, h: i.height || Math.abs(i.transform[3]) || 8, str: i.str.trim() };
      });
    pages.push({ items, height: vp.height });
  }
  return pages;
}

// Find the label for a widget rect on a given page's text items.
// IRS captions read left-to-right and end just before the box, e.g.
// "1  Legal name of applicant (or, see instructions)" then the input. So we join the
// whole run of text on the field's line that sits to its left.
function clean(s) {
  return s.replace(/\s+/g, " ").replace(/[.·]{2,}/g, " ").trim();
}
function labelFor(rect, items) {
  const cy = rect.y + rect.height / 2;
  const tol = Math.max(6, rect.height * 0.75);
  const sameLine = items
    .filter((t) => Math.abs(t.y + t.h / 2 - cy) <= tol && t.x < rect.x - 1)
    .sort((a, b) => a.x - b.x);
  if (sameLine.length) {
    // drop runs far to the left that belong to a previous field/box on the same line
    let runs = sameLine;
    for (let i = sameLine.length - 1; i > 0; i--) {
      if (sameLine[i].x - (sameLine[i - 1].x + sameLine[i - 1].w) > 90) { runs = sameLine.slice(i); break; }
    }
    const txt = clean(runs.map((t) => t.str).join(" "));
    if (txt && /[a-z]/i.test(txt)) return txt.slice(0, 100);
  }
  // else nearest caption above that overlaps horizontally
  const above = items
    .filter((t) => t.y > rect.y && t.x < rect.x + rect.width && t.x + t.w > rect.x - 4 && t.y - rect.y < 44)
    .sort((a, b) => a.y - b.y);
  const aboveLine = above.filter((t) => Math.abs(t.y - (above[0]?.y ?? 0)) < 3).sort((a, b) => a.x - b.x);
  if (aboveLine.length) { const txt = clean(aboveLine.map((t) => t.str).join(" ")); if (/[a-z]/i.test(txt)) return txt.slice(0, 100); }
  return "";
}

async function prepare(name) {
  const src = await readFile(join(__dirname, "irs", `${name}.pdf`));
  const pdfjsDoc = await getDocument({ data: new Uint8Array(src), useSystemFonts: true }).promise;
  const texts = await pageTexts(pdfjsDoc);

  const pdf = await PDFDocument.load(src, { ignoreEncryption: true });
  const pages = pdf.getPages();
  const pageRefKey = new Map(pages.map((pg, i) => [pg.ref.tag, i]));
  const form = pdf.getForm();

  let labelled = 0;
  for (const field of form.getFields()) {
    let widget;
    try { widget = field.acroField.getWidgets()[0]; } catch { continue; }
    if (!widget) continue;
    const rect = widget.getRectangle();
    // which page is this widget on?
    let pageIdx = 0;
    const pRef = widget.dict.get(PDFName.of("P"));
    if (pRef && pageRefKey.has(pRef.tag)) pageIdx = pageRefKey.get(pRef.tag);
    const items = texts[pageIdx]?.items || [];
    const label = labelFor(rect, items);
    if (label) {
      field.acroField.dict.set(PDFName.of("TU"), PDFString.of(label));
      labelled++;
    }
  }

  await mkdir(join(__dirname, "prepared"), { recursive: true });
  // useObjectStreams:false keeps refs plain so pdf-lib can re-parse its own output
  // reliably in the extension (some IRS files break with object streams on re-load).
  await writeFile(join(__dirname, "prepared", `${name}.pdf`), await pdf.save({ useObjectStreams: false }));
  console.log(`${name}: labelled ${labelled}/${form.getFields().length} fields`);
}

for (const f of FORMS) {
  try { await prepare(f); } catch (e) { console.log(`${f}: ERROR ${e.message}`); }
}
console.log("done.");
